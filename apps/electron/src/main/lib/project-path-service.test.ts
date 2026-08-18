import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createProject, getProjectWorkdirPath } from '../../../../../packages/shared/src/projects/storage.ts'
import {
  resolveEffectiveCwd,
  findProjectByWorkingDirectory,
  openOrCreateProjectForPath,
  restoreProjectWorkingDirectory,
  findRelocationCandidates,
  isRelocationCandidate,
  type ProjectPathFs,
} from './project-path-service.ts'

const roots: string[] = []
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'lux-path-svc-'))
  roots.push(root)
  return root
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function accessibleFs(extra?: Partial<ProjectPathFs>): ProjectPathFs {
  return {
    exists: (p) => existsSync(p),
    realpath: (p) => p, // 测试用：跳过真实 symlink
    isDirectory: () => true,
    mkdir: (p) => mkdirSync(p, { recursive: true }),
    ...extra,
  }
}

describe('project-path-service', () => {
  test('无外部目录时 effectiveCwd = 托管 workdir，并按需创建', () => {
    const ws = tempRoot()
    const project = createProject(ws, { name: 'Solo' })
    const result = resolveEffectiveCwd(ws, project, accessibleFs())
    expect(result.status).toBe('managed')
    expect(result.cwd).toBe(getProjectWorkdirPath(ws, project.slug))
    expect(existsSync(result.cwd!)).toBe(true)
  })

  test('外部目录可访问时使用 workingDirectory，不回退托管目录', () => {
    const ws = tempRoot()
    const external = join(tempRoot(), 'repo')
    mkdirSync(external)
    const project = createProject(ws, { name: 'Ext', workingDirectory: external })
    const result = resolveEffectiveCwd(ws, project, accessibleFs())
    expect(result.status).toBe('external')
    expect(result.cwd).toBe(external)
  })

  test('外部目录不可访问时 status=unavailable，cwd 为空，不静默回退', () => {
    const ws = tempRoot()
    const project = createProject(ws, {
      name: 'Gone',
      workingDirectory: join(ws, 'missing-repo'),
    })
    const result = resolveEffectiveCwd(ws, project, accessibleFs({
      exists: () => false,
    }))
    expect(result.status).toBe('unavailable')
    expect(result.cwd).toBeUndefined()
  })

  test('同 Workspace 内按规范化路径复用 Project；不同路径同名则新 slug', () => {
    const ws = tempRoot()
    const pathA = join(tempRoot(), 'App')
    mkdirSync(pathA)
    const first = openOrCreateProjectForPath(ws, pathA, accessibleFs())
    const second = openOrCreateProjectForPath(ws, pathA, accessibleFs())
    expect(second.project.id).toBe(first.project.id)
    expect(second.created).toBe(false)

    const pathB = join(tempRoot(), 'App') // 同名不同路径
    mkdirSync(pathB)
    const third = openOrCreateProjectForPath(ws, pathB, accessibleFs())
    expect(third.project.id).not.toBe(first.project.id)
    expect(third.project.slug).not.toBe(first.project.slug)
  })

  test('findProjectByWorkingDirectory 使用比较规范化路径', () => {
    const ws = tempRoot()
    const external = join(tempRoot(), 'repo')
    mkdirSync(external)
    const project = createProject(ws, { name: 'R', workingDirectory: external + '/' })
    const found = findProjectByWorkingDirectory(ws, external, accessibleFs())
    expect(found?.id).toBe(project.id)
  })

  test('restoreProjectWorkingDirectory 在缺失路径重建空目录', () => {
    const ws = tempRoot()
    const missing = join(ws, 'missing-repo')
    const project = createProject(ws, { name: 'Gone', workingDirectory: missing })
    expect(existsSync(missing)).toBe(false)
    const restored = restoreProjectWorkingDirectory(ws, project.slug, accessibleFs())
    expect(restored.slug).toBe(project.slug)
    expect(existsSync(missing)).toBe(true)
  })

  test('restoreProjectWorkingDirectory 目录仍存在时拒绝执行', () => {
    const ws = tempRoot()
    const external = join(tempRoot(), 'repo')
    mkdirSync(external)
    const project = createProject(ws, { name: 'Still', workingDirectory: external })
    expect(() => restoreProjectWorkingDirectory(ws, project.slug, accessibleFs()))
      .toThrow('目录仍然存在')
  })

  test('restoreProjectWorkingDirectory 未绑定本地目录时拒绝执行', () => {
    const ws = tempRoot()
    const project = createProject(ws, { name: 'Managed' })
    expect(() => restoreProjectWorkingDirectory(ws, project.slug, accessibleFs()))
      .toThrow('未绑定本地目录')
  })
})

function makeTempParent(): string {
  const dir = mkdtempSync(join(tmpdir(), 'reloc-candidates-'))
  afterAll(() => { rmSync(dir, { recursive: true, force: true }) })
  return dir
}

describe('isRelocationCandidate', () => {
  test('完全同名（大小写不敏感）', () => {
    expect(isRelocationCandidate('LuxAgents', 'LuxAgents')).toBe(true)
    expect(isRelocationCandidate('luxagents', 'LuxAgents')).toBe(true)
  })
  test('去复数 s', () => {
    expect(isRelocationCandidate('LuxAgent', 'LuxAgents')).toBe(true)
  })
  test('前缀包含', () => {
    expect(isRelocationCandidate('LuxAgentsV2', 'LuxAgents')).toBe(true)
  })
  test('编辑距离 ≤ 2', () => {
    expect(isRelocationCandidate('LuxAgentX', 'LuxAgents')).toBe(true)
  })
  test('明显无关不匹配', () => {
    expect(isRelocationCandidate('MyYoda', 'LuxAgents')).toBe(false)
    expect(isRelocationCandidate('CoderHub', 'LuxAgents')).toBe(false)
  })
  test('过短名称不参与复数/前缀规则（防误报）', () => {
    expect(isRelocationCandidate('A', 'As')).toBe(false)
  })
})

describe('findRelocationCandidates', () => {
  test('命中父目录下的候选并返回绝对路径', () => {
    const parent = makeTempParent()
    mkdirSync(join(parent, 'LuxAgent'), { recursive: true })
    mkdirSync(join(parent, 'MyYoda'), { recursive: true })
    writeFileSync(join(parent, 'not-a-dir'), 'x')

    const result = findRelocationCandidates(join(parent, 'LuxAgents'), 'LuxAgents')
    expect(result).toEqual([join(parent, 'LuxAgent')])
  })

  test('最多返回 3 个候选', () => {
    const parent = makeTempParent()
    mkdirSync(join(parent, 'LuxAgent'), { recursive: true })
    mkdirSync(join(parent, 'LuxAgents2'), { recursive: true })
    mkdirSync(join(parent, 'LuxAgentsX'), { recursive: true })
    mkdirSync(join(parent, 'LuxAgentsY'), { recursive: true })

    const result = findRelocationCandidates(join(parent, 'LuxAgents'), 'LuxAgents')
    expect(result.length).toBe(3)
  })

  test('父目录不存在 → 空数组（不抛异常）', () => {
    const result = findRelocationCandidates(join(tmpdir(), 'no-such-parent-dir-xyz', 'LuxAgents'), 'LuxAgents')
    expect(result).toEqual([])
  })

  test('无有效输入 → 空数组', () => {
    expect(findRelocationCandidates('', 'LuxAgents')).toEqual([])
    expect(findRelocationCandidates('/a/b/c', '')).toEqual([])
  })
})
