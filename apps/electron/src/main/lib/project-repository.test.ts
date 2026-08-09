import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getProjectWorkdirPath } from '../../../../../packages/shared/src/projects/storage.ts'
import { ProjectRepository } from './project-repository'

const tempRoots: string[] = []

function createTempWorkspaceRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'myyoda-main-project-repo-'))
  tempRoots.push(root)
  return root
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function createRepository(workspaceRoots: Record<string, string>): ProjectRepository {
  return new ProjectRepository({
    resolveWorkspaceRoot(workspaceId) {
      const root = workspaceRoots[workspaceId]
      if (!root) {
        throw new Error(`未知工作区: ${workspaceId}`)
      }
      return root
    },
  })
}

describe('ProjectRepository', () => {
  test('按 workspaceId 隔离项目列表和读取结果', () => {
    const workspaceAlpha = createTempWorkspaceRoot()
    const workspaceBeta = createTempWorkspaceRoot()
    const repository = createRepository({
      'ws-alpha': workspaceAlpha,
      'ws-beta': workspaceBeta,
    })

    const alpha = repository.createProject('ws-alpha', { name: 'Same Name' })
    const beta = repository.createProject('ws-beta', { name: 'Same Name' })

    expect(alpha.slug).toBe('same-name')
    expect(beta.slug).toBe('same-name')
    expect(repository.listProjects('ws-alpha').map((project) => project.config.slug)).toEqual(['same-name'])
    expect(repository.listProjects('ws-beta').map((project) => project.config.slug)).toEqual(['same-name'])
    expect(repository.getProject('ws-alpha', alpha.slug)?.workspaceRootPath).toBe(workspaceAlpha)
    expect(repository.getProject('ws-beta', beta.slug)?.workspaceRootPath).toBe(workspaceBeta)
  })

  test('拒绝非法 project slug 输入', () => {
    const repository = createRepository({ 'ws-alpha': createTempWorkspaceRoot() })

    expect(() => repository.getProject('ws-alpha', '../escape')).toThrow(/slug/i)
    expect(() => repository.updateProject('ws-alpha', '../escape', { name: 'bad' })).toThrow(/slug/i)
    expect(() => repository.deleteProject('ws-alpha', '../escape')).toThrow(/slug/i)
  })

  test('createProject 在委托 Shared storage 前拒绝无效运行时输入', () => {
    const repository = createRepository({ 'ws-alpha': createTempWorkspaceRoot() })

    const invalidCreateInputs = [
      [{ name: '' }, /name/i],
      [{ name: '   ' }, /name/i],
      [{ name: 'Proma', description: 123 }, /description/i],
      [{ name: 'Proma', workingDirectory: ['not-a-path'] }, /workingDirectory/i],
      [{ name: 'Proma', details: { note: 'bad' } }, /details/i],
      [{ name: 'Proma', colorTheme: true }, /colorTheme/i],
      [{ name: 'Proma', color: 8080 }, /color/i],
    ] as const

    for (const [input, errorPattern] of invalidCreateInputs) {
      expect(() => repository.createProject('ws-alpha', input as never)).toThrow(errorPattern)
    }
  })

  test('updateProject 在委托 Shared storage 前拒绝无效运行时输入', () => {
    const repository = createRepository({ 'ws-alpha': createTempWorkspaceRoot() })
    const created = repository.createProject('ws-alpha', { name: 'Proma' })

    const invalidUpdateInputs = [
      [{ name: '' }, /name/i],
      [{ description: 123 }, /description/i],
      [{ workingDirectory: ['not-a-path'] }, /workingDirectory/i],
      [{ details: { note: 'bad' } }, /details/i],
      [{ colorTheme: true }, /colorTheme/i],
      [{ color: 8080 }, /color/i],
      [{ archivedAt: 'yesterday' }, /archivedAt/i],
    ] as const

    for (const [input, errorPattern] of invalidUpdateInputs) {
      expect(() => repository.updateProject('ws-alpha', created.slug, input as never)).toThrow(errorPattern)
    }
  })

  test('通过 Shared storage 读写项目、资产和 Memory', () => {
    const repository = createRepository({ 'ws-alpha': createTempWorkspaceRoot() })

    const created = repository.createProject('ws-alpha', {
      name: 'Proma',
      description: 'bounded slice',
    })

    repository.writeProjectMemory('ws-alpha', created.slug, '# MEMORY\n- note')
    const asset = repository.uploadProjectAsset('ws-alpha', created.slug, {
      filename: 'brief.md',
      text: 'task brief',
    })
    const updated = repository.updateProject('ws-alpha', created.slug, {
      description: 'updated',
    })

    expect(repository.readProjectMemory('ws-alpha', created.slug)).toBe('# MEMORY\n- note')
    expect(repository.listProjectAssets('ws-alpha', created.slug)).toEqual([
      expect.objectContaining({
        filename: 'brief.md',
        absolutePath: asset.absolutePath,
      }),
    ])
    expect(updated.description).toBe('updated')

    repository.deleteProject('ws-alpha', created.slug)
    expect(repository.getProject('ws-alpha', created.slug)).toBeNull()
  })

  test('AtRoot API 解析 workingDirectory', () => {
    const root = createTempWorkspaceRoot()
    const external = join(createTempWorkspaceRoot(), 'repo')
    mkdirSync(external)
    const repository = createRepository({ 'ws-alpha': root })
    const created = repository.createProjectAtRoot(root, {
      name: 'Kanban Proj',
      workingDirectory: external,
    })

    expect(repository.resolveWorkingDirectory(root, created.config.id)).toBe(external)
    expect(repository.resolveEffectiveCwdForProject(root, created.config.id)).toEqual({
      status: 'external',
      cwd: external,
      displayPath: external,
    })
    const promptContext = repository.buildPromptContext(root, created.config.id)
    expect(promptContext?.name).toBe('Kanban Proj')
    expect(promptContext?.memoryPath).toBe(join(external, '.context', 'MEMORY.md'))
  })

  test('本地目录 Project 的记忆经 readProjectMemory/writeProjectMemory 全链路落在项目真实目录下', () => {
    const root = createTempWorkspaceRoot()
    const external = join(createTempWorkspaceRoot(), 'repo')
    mkdirSync(external)
    const repository = createRepository({ 'ws-alpha': root })
    const created = repository.createProjectAtRoot(root, {
      name: 'Local Memory Proj',
      workingDirectory: external,
    })

    expect(repository.readProjectMemory('ws-alpha', created.config.slug)).toBe('')
    repository.writeProjectMemory('ws-alpha', created.config.slug, '# 项目记忆\n经 repository 写入')
    expect(repository.readProjectMemory('ws-alpha', created.config.slug)).toBe('# 项目记忆\n经 repository 写入')

    const promptContext = repository.buildPromptContext(root, created.config.id)
    expect(promptContext?.memoryContent).toBe('# 项目记忆\n经 repository 写入')
    expect(promptContext?.memoryPath).toBe(join(external, '.context', 'MEMORY.md'))
  })

  test('无外部目录时 resolveWorkingDirectory 返回托管 workdir', () => {
    const root = createTempWorkspaceRoot()
    const repository = createRepository({ 'ws-alpha': root })
    const created = repository.createProjectAtRoot(root, { name: 'Managed Only' })
    const workdir = getProjectWorkdirPath(root, created.config.slug)

    expect(repository.resolveWorkingDirectory(root, created.config.id)).toBe(workdir)
    expect(repository.resolveEffectiveCwdForProject(root, created.config.id)?.status).toBe('managed')
  })

  test('存量隐藏容器 Project（kind=home/ad-hoc）仍拒绝重命名、归档和删除（保护读兼容）', () => {
    const root = createTempWorkspaceRoot()
    const repository = createRepository({ 'ws-alpha': root })
    const home = repository.createProjectAtRoot(root, { name: '首页工作区', kind: 'home' })

    expect(() => repository.updateProjectAtRoot(root, home.config.slug, { name: '改个名字' })).toThrow(/重命名/)
    expect(() => repository.updateProjectAtRoot(root, home.config.slug, { archivedAt: Date.now() })).toThrow(/归档/)
    expect(() => repository.deleteProjectAtRoot(root, home.config.slug)).toThrow(/删除/)

    // 非受限字段仍可更新，且同名重复设置（未实际改名）不应被误判为重命名
    const updated = repository.updateProjectAtRoot(root, home.config.slug, { name: '首页工作区', color: '#ff0000' })
    expect(updated.config.color).toBe('#ff0000')
  })

  test('存量隐藏容器 config（kind）仍可被读取，新建项目不产生隐藏 kind', () => {
    const root = createTempWorkspaceRoot()
    const repository = createRepository({ 'ws-alpha': root })
    const home = repository.createProjectAtRoot(root, { name: '首页工作区', kind: 'home' })
    const adHoc = repository.createProjectAtRoot(root, { name: '临时会话', kind: 'ad-hoc' })
    const regular = repository.createProjectAtRoot(root, { name: '普通项目' })

    expect(home.config.kind).toBe('home')
    expect(adHoc.config.kind).toBe('ad-hoc')
    expect(adHoc.config.workingDirectory).toBeUndefined()
    expect(regular.config.kind).toBeUndefined()

    // 读取兼容：重新加载后 kind 保留
    const reloaded = repository.getProjectAtRoot(root, home.config.slug)
    expect(reloaded?.config.kind).toBe('home')
  })

  test('外部目录不可用时 resolveWorkingDirectory 为 undefined，requireRunnable 抛错', () => {
    const root = createTempWorkspaceRoot()
    const repository = createRepository({ 'ws-alpha': root })
    const created = repository.createProjectAtRoot(root, {
      name: 'Missing Ext',
      workingDirectory: join(root, 'does-not-exist'),
    })

    expect(repository.resolveWorkingDirectory(root, created.config.id)).toBeUndefined()
    expect(repository.resolveEffectiveCwdForProject(root, created.config.id)?.status).toBe('unavailable')
    expect(() => repository.requireRunnableWorkingDirectory(root, created.config.id)).toThrow(/重新定位/)
  })
})
