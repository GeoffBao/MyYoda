/**
 * project-to-workspace-migration 纯逻辑单测
 *
 * 覆盖：可迁移项目判定与跳过原因。端到端迁移（写 agent-workspaces.json /
 * agent-sessions.json / automations.json）依赖真实配置目录，不在此触碰，
 * 由 dev 环境手动冒烟验证。
 *
 * 注意：必须用动态 import（bun 会提升静态 import 到 mock 之前，导致 electron
 * 真实模块先加载报错），与 agent-workspace-manager.test.ts 同一模式。
 */
import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mockElectronModule } from './electron-mock'

mockElectronModule({})

type MigrationModule = typeof import('../project-to-workspace-migration')

let migration: MigrationModule

function makeProject(overrides: Record<string, unknown> = {}): {
  id: string
  slug: string
  name: string
  workingDirectory?: string
  kind?: string
} {
  return {
    id: 'proj_test',
    slug: 'test-project',
    name: 'Test Project',
    ...overrides,
  }
}

describe('isMigratableProject / reasonForSkip', () => {
  it('真实项目 + 可访问目录 → 可迁移', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'migration-test-'))
    try {
      const m = migration ?? (migration = await import('../project-to-workspace-migration'))
      expect(m.isMigratableProject(makeProject({ workingDirectory: dir }), '')).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('home / ad-hoc 隐藏容器不迁移', async () => {
    const m = migration ?? (migration = await import('../project-to-workspace-migration'))
    expect(m.isMigratableProject(makeProject({ kind: 'home', workingDirectory: '/tmp' }), '')).toBe(false)
    expect(m.isMigratableProject(makeProject({ kind: 'ad-hoc', workingDirectory: '/tmp' }), '')).toBe(false)
  })

  it('无 workingDirectory 不迁移', async () => {
    const m = migration ?? (migration = await import('../project-to-workspace-migration'))
    expect(m.isMigratableProject(makeProject({ workingDirectory: undefined }), '')).toBe(false)
  })

  it('目录不存在 / 不是目录不迁移', async () => {
    const m = migration ?? (migration = await import('../project-to-workspace-migration'))
    expect(m.isMigratableProject(makeProject({ workingDirectory: '/nonexistent-path-xyz' }), '')).toBe(false)
    const base = mkdtempSync(join(tmpdir(), 'migration-test-'))
    const file = join(base, 'a.txt')
    writeFileSync(file, 'x')
    expect(m.isMigratableProject(makeProject({ workingDirectory: file }), '')).toBe(false)
    rmSync(base, { recursive: true, force: true })
  })

  it('按原因给出中文描述', async () => {
    const m = migration ?? (migration = await import('../project-to-workspace-migration'))
    expect(m.reasonForSkip(makeProject({ kind: 'home' }))).toContain('home/ad-hoc')
    expect(m.reasonForSkip(makeProject({ workingDirectory: undefined }))).toContain('未绑定工作目录')
    expect(m.reasonForSkip(makeProject({ workingDirectory: '/nonexistent-path-xyz' }))).toContain('不存在')
  })
})
