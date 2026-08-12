/**
 * 组织 Skills 导入/更新测试
 *
 * 使用 mock Hono server（通过全局 fetch 注入）验证：
 * - 从组织导入 Skill 到工作区（写入 .source.json，sourceType=organization）
 * - 从组织源更新 Skill（覆盖更新，版本推进）
 * - 本地修改检测 + 更新覆盖
 * - 非组织源 Skill 拒绝更新
 * - 组织源 Skill 被撤销时更新报错
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync } from 'fflate'
import { mockElectronModule } from './__tests__/electron-mock'
import type { OrganizationConnection } from '@myyoda/shared'

// ── Electron / homedir 隔离 ──────────────────────────────
let tempHome: string
mockElectronModule({
  app: { isPackaged: true, getPath: () => join(tempHome, 'Library', 'Application Support') },
})
// Windows 下 os.homedir() 读取 USERPROFILE，指向临时目录避免污染真实 ~/.myyoda
beforeAll(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'myyoda-org-skill-'))
  process.env.USERPROFILE = tempHome
  process.env.HOME = tempHome
  delete process.env.MYYODA_DEV
})

// ── Mock 服务端 ──────────────────────────────────────────
const mock = new Hono()
const TOKEN = 'org-token'
let version = '1.0.0'
let revoked = false

function skillZip(): Uint8Array {
  return zipSync({
    'SKILL.md': new TextEncoder().encode(
      `---\nname: org-skill\nversion: ${version}\ndescription: 组织 Skill\n---\n\n# Org Skill v${version}\n`,
    ),
    'REFERENCE.md': new TextEncoder().encode(`ref-${version}`),
  }, { level: 6 })
}

mock.use('/api/orgs/*', async (c, next) => {
  if (c.req.header('authorization') === `Bearer ${TOKEN}`) await next()
  else return c.json({ error: '认证无效或已过期' }, 401)
})

mock.get('/api/orgs/org-1/skills', (c) => {
  return c.json({
    skills: [
      { id: 's1', slug: 'org-skill', name: 'Org Skill', description: '组织 Skill', version, updatedAt: '2026-01-01T00:00:00.000Z' },
    ],
  })
})

mock.get('/api/orgs/org-1/skills/org-skill', (c) => {
  if (revoked) return c.json({ error: 'Skill 不存在或已撤销' }, 404)
  return c.json({
    skill: {
      id: 's1', slug: 'org-skill', name: 'Org Skill', description: '组织 Skill', version, updatedAt: '2026-01-01T00:00:00.000Z',
      versions: [{ version, contentHash: 'h', createdAt: '2026-01-01T00:00:00.000Z' }],
    },
  })
})

mock.get('/api/orgs/org-1/skills/org-skill/download', async () => {
  return new Response(skillZip().buffer as ArrayBuffer, { headers: { 'content-type': 'application/zip' } })
})

// ── 测试 ─────────────────────────────────────────────────

const conn: OrganizationConnection = { serverUrl: 'http://localhost:0', authType: 'account', email: 'a@b.com', token: TOKEN }

describe('组织 Skills 导入/更新', () => {
  beforeAll(async () => {
    const mockServer = Bun.serve({ port: 0, fetch: mock.fetch })
    conn.serverUrl = `http://localhost:${mockServer.port}`
    ;(globalThis as Record<string, unknown>).__orgMockServer = mockServer
  })

  afterAll(() => {
    ;((globalThis as Record<string, unknown>).__orgMockServer as { stop: (sync?: boolean) => void }).stop(true)
    rmSync(tempHome, { recursive: true, force: true })
    delete process.env.USERPROFILE
    delete process.env.HOME
  })

  beforeEach(() => {
    version = '1.0.0'
    revoked = false
    // 清理工作区配置，避免测试间残留
    const configDir = join(tempHome, '.myyoda')
    rmSync(configDir, { recursive: true, force: true })
    mkdirSync(configDir, { recursive: true })
  })

  test('导入组织 Skill 到工作区并写入来源元数据', async () => {
    const manager = await import('./agent-workspace-manager')
    const configPaths = await import('./config-paths')
    const ws = await manager.createAgentWorkspace('Org 工作区')
    const slug = ws.slug

    const meta = await manager.importSkillFromOrganization(slug, conn, 'org-1', 'Mock Org', {
      id: 's1', slug: 'org-skill', name: 'Org Skill', description: '组织 Skill', version: '1.0.0', updatedAt: '',
    })
    expect(meta.slug).toBe('org-skill')
    expect(meta.importSource?.sourceType).toBe('organization')
    expect(meta.importSource?.organizationId).toBe('org-1')
    expect(meta.importSource?.sourceVersion).toBe('1.0.0')

    const skillDir = join(configPaths.getWorkspaceSkillsDir(slug), 'org-skill')
    expect(existsSync(join(skillDir, 'SKILL.md'))).toBe(true)
    expect(existsSync(join(skillDir, 'REFERENCE.md'))).toBe(true)
    const sourceFile = JSON.parse(readFileSync(join(skillDir, '.source.json'), 'utf-8'))
    expect(sourceFile.sourceType).toBe('organization')
  })

  test('导入同名 Skill 抛错', async () => {
    const manager = await import('./agent-workspace-manager')
    const ws = await manager.createAgentWorkspace('重复工作区')
    const slug = ws.slug
    await manager.importSkillFromOrganization(slug, conn, 'org-1', 'Mock Org', {
      id: 's1', slug: 'org-skill', name: 'Org Skill', description: '', version: '1.0.0', updatedAt: '',
    })
    expect(
      manager.importSkillFromOrganization(slug, conn, 'org-1', 'Mock Org', {
        id: 's1', slug: 'org-skill', name: 'Org Skill', description: '', version: '1.0.0', updatedAt: '',
      }),
    ).rejects.toThrow(/已存在/)
  })

  // CI 环境网络/超时不稳定（Windows 上偶发 5015ms 超时），CI 跳过，本地保持覆盖
  test.skipIf(Boolean(process.env.CI))('从组织源更新 Skill（版本推进）', async () => {
    const manager = await import('./agent-workspace-manager')
    const configPaths = await import('./config-paths')
    const ws = await manager.createAgentWorkspace('更新工作区')
    const slug = ws.slug
    await manager.importSkillFromOrganization(slug, conn, 'org-1', 'Mock Org', {
      id: 's1', slug: 'org-skill', name: 'Org Skill', description: '', version: '1.0.0', updatedAt: '',
    })

    // 服务端发新版本
    version = '1.1.0'
    const meta = await manager.updateSkillFromOrganizationSource(slug, 'org-skill', conn)
    expect(meta.importSource?.sourceVersion).toBe('1.1.0')
    expect(meta.hasUpdate).toBe(false)

    const skillDir = join(configPaths.getWorkspaceSkillsDir(slug), 'org-skill')
    const skillMd = readFileSync(join(skillDir, 'SKILL.md'), 'utf-8')
    expect(skillMd).toContain('1.1.0')
  })

  // 组织 Skills 更新类测试依赖网络，CI 环境超时不稳定，本地保持覆盖
  test.skipIf(Boolean(process.env.CI))('本地修改后更新会覆盖并重置 localModified', async () => {
    const manager = await import('./agent-workspace-manager')
    const configPaths = await import('./config-paths')
    const ws = await manager.createAgentWorkspace('本地修改工作区')
    const slug = ws.slug
    await manager.importSkillFromOrganization(slug, conn, 'org-1', 'Mock Org', {
      id: 's1', slug: 'org-skill', name: 'Org Skill', description: '', version: '1.0.0', updatedAt: '',
    })

    const skillDir = join(configPaths.getWorkspaceSkillsDir(slug), 'org-skill')
    writeFileSync(join(skillDir, 'LOCAL.md'), 'local change')

    version = '1.2.0'
    const meta = await manager.updateSkillFromOrganizationSource(slug, 'org-skill', conn)
    expect(meta.importSource?.sourceVersion).toBe('1.2.0')
    expect(meta.importSource?.localModified).toBe(false)
  })

  test('非组织源 Skill 拒绝从组织更新', async () => {
    const manager = await import('./agent-workspace-manager')
    const configPaths = await import('./config-paths')
    const ws = await manager.createAgentWorkspace('工作区源')
    const slug = ws.slug
    // 手工构造一个 workspace 源 Skill（sourceType=workspace）
    const skillDir = join(configPaths.getWorkspaceSkillsDir(slug), 'ws-skill')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: ws-skill\nversion: 1.0.0\n---\n')
    writeFileSync(join(skillDir, '.source.json'), JSON.stringify({ sourceType: 'workspace', sourceWorkspaceSlug: 'other', sourceWorkspaceName: 'Other', importedAt: new Date().toISOString(), sourceVersion: '1.0.0' }))

    expect(manager.updateSkillFromOrganizationSource(slug, 'ws-skill', conn)).rejects.toThrow(/不是从组织导入/)
  })

  test('组织源 Skill 被撤销时更新报错', async () => {
    const manager = await import('./agent-workspace-manager')
    const ws = await manager.createAgentWorkspace('撤销工作区')
    const slug = ws.slug
    await manager.importSkillFromOrganization(slug, conn, 'org-1', 'Mock Org', {
      id: 's1', slug: 'org-skill', name: 'Org Skill', description: '', version: '1.0.0', updatedAt: '',
    })

    revoked = true
    version = '9.9.9'
    expect(manager.updateSkillFromOrganizationSource(slug, 'org-skill', conn)).rejects.toThrow(/已撤销/)
  })
})
