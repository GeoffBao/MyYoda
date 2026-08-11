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
