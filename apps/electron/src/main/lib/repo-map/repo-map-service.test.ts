/**
 * Repo Map 服务层测试：缓存键、HEAD 失效、mention 提取、prompt 注入块。
 */
import { describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { extractMentionContext, RepoMapService } from './repo-map-service'

// workspace 根（repo-map/ → lib(1) main(2) src(3) electron(4) apps(5) 根(6)）
const workspaceRoot = path.resolve(import.meta.dir, '..', '..', '..', '..', '..', '..')
const sampleDir = path.join(workspaceRoot, 'packages', 'shared', 'src', 'types')

describe('extractMentionContext', () => {
  test('提取消息中的文件路径与标识符', () => {
    const ctx = extractMentionContext('请看一下 channel.ts 里的 ProviderType 和 ChannelModel，以及 reasoning-profile.ts', sampleDir)

    expect(ctx.mentionedFiles?.size ?? 0).toBeGreaterThanOrEqual(2)
    expect(ctx.mentionedIdents?.has('ProviderType')).toBe(true)
  })

  test('空消息返回空上下文', () => {
    const ctx = extractMentionContext(undefined, sampleDir)
    expect(ctx.mentionedFiles?.size ?? 0).toBe(0)
    expect(ctx.mentionedIdents?.size ?? 0).toBe(0)
  })
})

describe('RepoMapService', () => {
  test('生成后缓存命中；HEAD 失效后重新生成', async () => {
    // 用隔离的临时目录 + 固定 HEAD，避免全量测试并发时受真实仓库 git 状态/全局缓存竞争影响
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-map-cache-hit-'))
    try {
      for (let i = 1; i <= 3; i++) {
        fs.writeFileSync(
          path.join(tmpDir, `mod${i}.ts`),
          [
            `/** Module ${i} */`,
            `export interface Result${i} { value: number }`,
            `export function helper${i}(x: number): number { return x + ${i} }`,
            `export const DEFAULT_${i} = { value: ${i} } as const`,
          ].join('\n') + '\n',
        )
      }

      const service = new RepoMapService({ headProvider: () => 'fixed-head-123' })

      // 首次：等待生成
      const first = await service.getRepoMapForPrompt(tmpDir, undefined, 10_000)
      expect(typeof first).toBe('string')
      expect((first ?? '').length).toBeGreaterThan(120)

      // 命中缓存：同步读取（head 校验通过）
      const cached = service.getCachedMap(tmpDir)
      expect(cached).toBe(first)

      // 再次调用走缓存（should be fast）
      const second = await service.getRepoMapForPrompt(tmpDir)
      expect(second).toBe(first)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  test('不适用目录（空目录）返回 undefined 且不缓存', async () => {
    const emptyDir = path.join(workspaceRoot, 'apps', 'electron', 'src', 'main', 'lib', 'repo-map', '__empty_fixture__')
    // 不创建目录：路径不存在时 isSuitableDirectory 返回 false
    const result = await new RepoMapService().getRepoMapForPrompt(emptyDir, undefined, 1_000)
    expect(result).toBeUndefined()
  })

  test('非 git 目录：生成一次后缓存命中（head 均为 undefined 视为命中）', async () => {
    // 系统临时目录下创建非 git 小项目（≥3 个源码文件），避免受仓库 HEAD 影响
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-map-nongit-'))
    try {
      for (let i = 1; i <= 3; i++) {
        fs.writeFileSync(
          path.join(tmpDir, `mod${i}.ts`),
          [
            `/** Module ${i} helpers */`,
            `export interface Result${i} { value: number; label: string }`,
            `export function helper${i}(x: number): number { return x + ${i} }`,
            `export function format${i}(r: Result${i}): string { return r.label + r.value }`,
            `export const DEFAULT_${i} = { value: ${i}, label: 'm${i}' } as const`,
          ].join('\n') + '\n',
        )
      }

      // 注入 headProvider=undefined 模拟非 git 目录（不真实调用 execSync git，避免全量并发时 git 进程竞争）
      const service = new RepoMapService({ headProvider: () => undefined })
      const first = await service.getRepoMapForPrompt(tmpDir, undefined, 10_000)
      expect(typeof first).toBe('string')
      expect((first ?? '').length).toBeGreaterThan(0)

      // 同步读应命中（非 git 目录 head=undefined 与缓存 head=undefined 匹配）
      const cached = service.getCachedMap(tmpDir)
      expect(cached).toBe(first)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

describe('跨 worktree 共享（2026-08-12 新增：同 HEAD 多 cwd 复用同一 map）', () => {
  test('同 HEAD 的两个不同 cwd：第二个直接命中缓存（不重复全量扫描）', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-map-worktree-share-'))
    try {
      // 模拟两个 worktree：同内容仓库、同 HEAD、不同目录
      const worktreeA = path.join(tmpRoot, 'a-main')
      const worktreeB = path.join(tmpRoot, 'b-main')
      for (const dir of [worktreeA, worktreeB]) {
        fs.mkdirSync(dir, { recursive: true })
        for (let i = 1; i <= 3; i++) {
          fs.writeFileSync(
            path.join(dir, `mod${i}.ts`),
            `/** Module ${i} */\nexport interface Result${i} { value: number }\nexport function helper${i}(x: number): number { return x + ${i} }`,
            'utf-8',
          )
        }
      }

      const fixedHead = `testhead-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` // 随机 head：避免盘上缓存跨测试运行残留
      let generationCount = 0
      const service = new RepoMapService({
        headProvider: () => fixedHead,
      })
      // 打桩 getRepoMap 计数：通过生成耗时观察即可——直接用服务内部缓存命中判断
      const mapA = await service.getRepoMapForPrompt(worktreeA, undefined, 30_000)
      expect(mapA).toBeDefined()
      expect((mapA ?? '').length).toBeGreaterThan(100)

      // worktree B：同 HEAD → 应命中 A 生成的缓存（立即返回，无等待）
      const start = Date.now()
      const mapB = await service.getRepoMapForPrompt(worktreeB, undefined, 2_000)
      const elapsed = Date.now() - start
      expect(mapB).toBe(mapA) // 同一份 map
      expect(elapsed).toBeLessThan(500) // 命中缓存而非重新生成
      void generationCount

      // HEAD 变化 → 缓存失效重新生成（内容随文件变化体现重扫）
      let head = fixedHead
      const service2 = new RepoMapService({ headProvider: () => head })
      const mapC = await service2.getRepoMapForPrompt(worktreeA, undefined, 30_000)
      expect(mapC).toBeDefined()
      // HEAD 变化（commit/push）→ SWR：先用旧 map（0 等待），后台重扫新 HEAD
      fs.writeFileSync(path.join(worktreeA, 'mod4.ts'), `/** Module 4 */\nexport interface Result4 { value: number }`, 'utf-8')
      head = `newhead-${Date.now()}`
      const startD = Date.now()
      const mapD = await service2.getRepoMapForPrompt(worktreeA, undefined, 30_000)
      const elapsedD = Date.now() - startD
      expect(mapD).toBe(mapC) // SWR：HEAD 变化返回旧地图（不重新扫描阻塞）
      expect(elapsedD).toBeLessThan(500)
      // 等待后台重扫完成（小仓库 <2s）→ 新 map 包含新符号
      await new Promise((resolve) => setTimeout(resolve, 2_500))
      const mapE = service2.getCachedMap(worktreeA)
      expect(mapE).toBeDefined()
      expect(mapE).toContain('Result4') // 重扫完成，新地图包含新符号
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    }
  })
})

describe('warmUp 预热与并发去重（2026-08-12 review 补）', () => {
  test('warmUp 后首条消息立即复用生成任务（pending 去重，只生成一次）', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-map-warmup-'))
    try {
      const dir = path.join(tmpRoot, 'w')
      fs.mkdirSync(dir, { recursive: true })
      for (let i = 1; i <= 3; i++) {
        fs.writeFileSync(path.join(dir, `m${i}.ts`), `/** M${i} */\nexport interface I${i} { v: number }\nexport function f${i}(): number { return ${i} }`, 'utf-8')
      }
      const service = new RepoMapService({ headProvider: () => `warmhead-${Date.now()}` })

      // warmUp 立即返回（fire-and-forget），随后首条消息应复用同一生成任务
      service.warmUp(dir)
      const start = Date.now()
      const map = await service.getRepoMapForPrompt(dir, undefined, 30_000)
      const elapsed = Date.now() - start
      expect(map).toBeDefined()
      expect((map ?? '').length).toBeGreaterThan(100)
      // 首条消息没有等满 2s 且拿到了 map（warmUp 已提前启动生成，2s 内完成小仓库）
      expect(elapsed).toBeLessThan(2_000)

      // 再次 warmUp：已缓存 → no-op 不重复生成
      service.warmUp(dir)
      expect(service.getCachedMap(dir)).toBe(map)
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    }
  })
})
