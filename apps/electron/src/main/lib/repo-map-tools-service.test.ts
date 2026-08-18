/**
 * 代码图谱工具服务测试（2026-08-13）
 *
 * 聚焦可确定性验证的纯逻辑：主仓库解析、gitignore 防护、状态查询边界。
 * 真实 graphify 构建/安装依赖外部环境，不在此处跑（已在会话中手动实测）。
 */
import { describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import {
  RepoMapToolsService,
  getMainRepoRootSync,
  graphJsonPath,
} from './repo-map-tools-service'

describe('repo-map-tools-service', () => {
  test('graphJsonPath 指向主仓库 graphify-out/graph.json', () => {
    const p = graphJsonPath('D:/repos/my-project')
    expect(p.replace(/\\/g, '/')).toBe('D:/repos/my-project/graphify-out/graph.json')
  })

  test('getMainRepoRootSync：git 仓库返回自身；非 git 目录返回 undefined', () => {
    // 当前源码所在仓库（test 运行时 cwd 在 apps/electron）是 git 仓库
    const repo = getMainRepoRootSync(import.meta.dir)
    expect(repo).toBeDefined()

    const nonGit = fs.mkdtempSync(path.join(os.tmpdir(), 'non-git-'))
    expect(getMainRepoRootSync(nonGit)).toBeUndefined()
    fs.rmSync(nonGit, { recursive: true, force: true })
  })

  test('getState：无 cwd 仅返回安装状态；非 git 目录返回 unavailable', async () => {
    const service = new RepoMapToolsService()

    const noCwd = await service.getState('')
    expect(noCwd.status).toBe('idle')
    expect(typeof noCwd.graphifyInstalled).toBe('boolean')

    const nonGit = fs.mkdtempSync(path.join(os.tmpdir(), 'non-git-'))
    const unavailable = await service.getState(nonGit)
    expect(unavailable.status).toBe('unavailable')
    expect(unavailable.mainRepo).toBeUndefined()
    expect(unavailable.error).toContain('非 git')
    fs.rmSync(nonGit, { recursive: true, force: true })
  })

  test('ensureMapTools：非 git 目录直接 unavailable，不创建任何产物', async () => {
    const service = new RepoMapToolsService()
    const nonGit = fs.mkdtempSync(path.join(os.tmpdir(), 'non-git-'))
    const state = await service.ensureMapTools(nonGit)
    expect(state.status).toBe('unavailable')
    // 不创建 graphify-out（严格不支持）
    expect(fs.existsSync(path.join(nonGit, 'graphify-out'))).toBe(false)
    fs.rmSync(nonGit, { recursive: true, force: true })
  })

  test('ensureGitignore：缺条目追加（返回 true），已有条目返回 false', () => {
    const service = new RepoMapToolsService()
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitignore-'))

    // 无 .gitignore → 追加
    expect(service.ensureGitignore(dir)).toBe(true)
    let content = fs.readFileSync(path.join(dir, '.gitignore'), 'utf-8')
    expect(content).toContain('graphify-out/')

    // 已有 → 不重复
    expect(service.ensureGitignore(dir)).toBe(false)

    // 已有但无尾换行 → 正确追加
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'gitignore2-'))
    fs.writeFileSync(path.join(dir2, '.gitignore'), 'node_modules/', 'utf-8')
    expect(service.ensureGitignore(dir2)).toBe(true)
    content = fs.readFileSync(path.join(dir2, '.gitignore'), 'utf-8')
    expect(content).toContain('graphify-out/')
    expect(content.indexOf('node_modules/')).toBe(0)

    fs.rmSync(dir, { recursive: true, force: true })
    fs.rmSync(dir2, { recursive: true, force: true })
  })

  test('getState：git 仓库下 mapReady 判定稳定（真实目录纯读）', async () => {
    const service = new RepoMapToolsService()
    // 用真实源码仓库（本仓库）测试：非 git 分支不会走；只验证状态结构合法
    const state = await service.getState(import.meta.dir)
    expect(['idle', 'running', 'done', 'failed', 'unavailable']).toContain(state.status)
    expect(typeof state.mapReady).toBe('boolean')
    expect(typeof state.graphReady).toBe('boolean')
    expect(state.mainRepo).toBeDefined()
  })
})

describe('PR #56 review 回归（2026-08-14）', () => {
  const { execSync } = require('node:child_process')

  function makeGitRepo(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
    execSync('git init -q', { cwd: dir })
    return dir
  }

  test('ensureMapTools：graphify 未装且无图 → 立即 failed 终态（running 死锁修复）', async () => {
    const service = new RepoMapToolsService()
    const repo = makeGitRepo('gf-noinstall-')
    try {
      ;(service as unknown as { isGraphifyInstalled: () => Promise<boolean> }).isGraphifyInstalled = async () => false
      const state = await service.ensureMapTools(repo)
      expect(state.status).toBe('failed')
      expect(state.error).toContain('未安装 graphify')
    } finally {
      fs.rmSync(repo, { recursive: true, force: true })
    }
  })

  test('getState：running 但无待决构建时重算，不返回卡死缓存（死锁修复）', async () => {
    const service = new RepoMapToolsService()
    const repo = makeGitRepo('gf-stale-')
    try {
      // 直接塞一个无 pendingBuilds 支撑的 running 缓存
      ;(service as unknown as { states: Map<string, unknown> }).states.set(repo, {
        status: 'running',
        mapReady: false,
        graphReady: false,
        graphifyInstalled: false,
        mainRepo: repo,
      })
      const state = await service.getState(repo)
      expect(state.status).not.toBe('running')
      expect(['idle', 'done', 'failed']).toContain(state.status)
    } finally {
      fs.rmSync(repo, { recursive: true, force: true })
    }
  })

  test('ensureMapTools forceUpdate：图就绪但 graphify 未装 → failed（不卡 running）', async () => {
    const { repoMapService } = await import('./repo-map/repo-map-service')
    const service = new RepoMapToolsService()
    const repo = makeGitRepo('gf-forceupdate-')
    try {
      // 伪造 graph.json（图就绪）+ 伪造 mapReady
      fs.mkdirSync(path.join(repo, 'graphify-out'), { recursive: true })
      fs.writeFileSync(path.join(repo, 'graphify-out', 'graph.json'), '{}')
      const original = repoMapService.getRepoMapForPromptReadOnly
      repoMapService.getRepoMapForPromptReadOnly = () => 'fake-map' as never
      ;(service as unknown as { isGraphifyInstalled: () => Promise<boolean> }).isGraphifyInstalled = async () => false
      try {
        const state = await service.ensureMapTools(repo, { forceUpdate: true })
        expect(state.status).toBe('failed')
        expect(state.error).toContain('未安装 graphify')
      } finally {
        repoMapService.getRepoMapForPromptReadOnly = original
      }
    } finally {
      fs.rmSync(repo, { recursive: true, force: true })
    }
  })

  test('getState：graph.json 损坏（非 JSON 内容）→ graphReady=false（冒烟校验）', async () => {
    const service = new RepoMapToolsService()
    const repo = makeGitRepo('gf-corrupt-')
    try {
      ;(service as unknown as { isGraphifyInstalled: () => Promise<boolean> }).isGraphifyInstalled = async () => true
      fs.mkdirSync(path.join(repo, 'graphify-out'), { recursive: true })
      // 损坏内容：既不是 { 也不是 [ 开头（模拟清空/写坏/半写）
      fs.writeFileSync(path.join(repo, 'graphify-out', 'graph.json'), 'not-a-json')
      const state = await service.getState(repo)
      expect(state.graphReady).toBe(false)
    } finally {
      fs.rmSync(repo, { recursive: true, force: true })
    }

    // 空文件同样视为未就绪
    const repo2 = makeGitRepo('gf-empty-')
    try {
      ;(service as unknown as { isGraphifyInstalled: () => Promise<boolean> }).isGraphifyInstalled = async () => true
      fs.mkdirSync(path.join(repo2, 'graphify-out'), { recursive: true })
      fs.writeFileSync(path.join(repo2, 'graphify-out', 'graph.json'), '')
      const state = await service.getState(repo2)
      expect(state.graphReady).toBe(false)
    } finally {
      fs.rmSync(repo2, { recursive: true, force: true })
    }
  })

  test('getState：图谱构建后 HEAD 变化 → graphStale=true；HEAD 一致 → 不 stale', async () => {
    const { execSync } = require('node:child_process')
    const service = new RepoMapToolsService()
    const repo = makeGitRepo('gf-stale-')
    try {
      ;(service as unknown as { isGraphifyInstalled: () => Promise<boolean> }).isGraphifyInstalled = async () => true
      fs.mkdirSync(path.join(repo, 'graphify-out'), { recursive: true })
      fs.writeFileSync(path.join(repo, 'graphify-out', 'graph.json'), '{}')
      // 首次 commit（空仓库无 HEAD，先建初始提交）
      fs.writeFileSync(path.join(repo, 'init.txt'), 'x')
      execSync('git add init.txt', { cwd: repo })
      execSync('git -c user.email=t@t -c user.name=t commit -qm init', { cwd: repo })
      // 首次：.graphify_head = 当前 HEAD → 不 stale
      const head = execSync('git rev-parse HEAD', { cwd: repo, encoding: 'utf-8' }).trim()
      fs.writeFileSync(path.join(repo, 'graphify-out', '.graphify_head'), head)
      let state = await service.getState(repo)
      expect(state.graphReady).toBe(true)
      expect(state.graphStale).toBe(false)

      // HEAD 变化（新 commit）→ stale
      fs.writeFileSync(path.join(repo, 'a.txt'), 'new content')
      execSync('git add a.txt', { cwd: repo })
      execSync('git -c user.email=t@t -c user.name=t commit -qm change', { cwd: repo })
      state = await service.getState(repo)
      expect(state.graphReady).toBe(true)
      expect(state.graphStale).toBe(true)

      // 无 .graphify_head（旧图/上游工具直建）→ 不标记 stale（兼容）
      fs.rmSync(path.join(repo, 'graphify-out', '.graphify_head'))
      state = await service.getState(repo)
      expect(state.graphStale).toBe(false)
    } finally {
      fs.rmSync(repo, { recursive: true, force: true })
    }
  })
})
