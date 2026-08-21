import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { mockElectronModule } from './__tests__/electron-mock'

type AgentWorkspaceManager = typeof import('./agent-workspace-manager')
type ConfigPathsModule = typeof import('./config-paths')
type MigrationModule = typeof import('./agent-global-scope-migration')

let manager: AgentWorkspaceManager
let configPaths: ConfigPathsModule
let migration: MigrationModule
let tempHome: string
const originalHome = process.env.HOME
const originalMyyodaDev = process.env.MYYODA_DEV

mockElectronModule({
  app: {
    isPackaged: true,
    getPath: () => join(process.env.HOME ?? tempHome, 'Library', 'Application Support'),
  },
})

mock.module('node:os', () => ({
  ...os,
  homedir: () => tempHome,
}))

beforeAll(async () => {
  tempHome = mkdtempSync(join(os.tmpdir(), 'myyoda-global-scope-migration-'))
  process.env.HOME = tempHome
  delete process.env.MYYODA_DEV
  process.env.MYYODA_DEV = '0'
  configPaths = await import('./config-paths')
  manager = await import('./agent-workspace-manager')
  migration = await import('./agent-global-scope-migration')
})

beforeEach(() => {
  const configDir = join(tempHome, configPaths.getConfigDirName())
  rmSync(configDir, { recursive: true, force: true })
  mkdirSync(configDir, { recursive: true })
})

afterAll(() => {
  if (originalHome === undefined) {
    delete process.env.HOME
  } else {
    process.env.HOME = originalHome
  }
  if (originalMyyodaDev === undefined) {
    delete process.env.MYYODA_DEV
  } else {
    process.env.MYYODA_DEV = originalMyyodaDev
  }
  rmSync(tempHome, { recursive: true, force: true })
})

/** 强制改写工作区索引里的 createdAt，用来在测试里精确控制“谁先创建”的确定性排序。 */
function setWorkspaceCreatedAt(slug: string, createdAt: number): void {
  const indexPath = configPaths.getAgentWorkspacesIndexPath()
  const raw = JSON.parse(readFileSync(indexPath, 'utf-8')) as { workspaces: Array<{ slug: string; createdAt: number }> }
  const ws = raw.workspaces.find((w) => w.slug === slug)
  if (ws) ws.createdAt = createdAt
  writeFileSync(indexPath, JSON.stringify(raw, null, 2), 'utf-8')
}

/** 在 bundled default-skills/ 快照目录写入一个测试用的预置 Skill fixture。 */
function writeDefaultSkillFixture(slug: string, name: string, version = '1.0.0'): void {
  const dir = join(configPaths.getDefaultSkillsDir(), slug)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\nversion: "${version}"\n---\n正文\n`, 'utf-8')
}

/** 在某工作区 skills/ 目录下写入一个 Skill fixture（可自定义内容，用于制造“同名但内容不同”的场景）。 */
function writeWorkspaceSkillFixture(workspaceSlug: string, skillSlug: string, name: string, body = '正文'): void {
  const dir = join(configPaths.getWorkspaceSkillsDir(workspaceSlug), skillSlug)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\nversion: "1.0.0"\n---\n${body}`, 'utf-8')
}

describe('migrateGlobalScopes - MCP 合并', () => {
  test('Given 单工作区单个 MCP 服务器 When 迁移 Then 原样进入全局配置', async () => {
    const ws = manager.createAgentWorkspace('solo')
    manager.saveWorkspaceMcpConfig(ws.slug, {
      servers: { filesystem: { type: 'stdio', command: 'solo-fs', enabled: true } },
    })

    await migration.migrateGlobalScopes()

    const global = manager.getGlobalMcpConfig()
    expect(global.servers.filesystem?.command).toBe('solo-fs')
  })

  test('Given 两个非默认工作区同名 server 冲突 When 迁移 Then 按 createdAt 升序确定谁保留原名（不依赖遍历顺序）', async () => {
    // 显式建默认工作区，避免 findDefaultWorkspace 的“slug!=='default' 时回退为 createdAt 最早”兵底规则
    // 接管 alpha/beta，干扰本用例想验证的“非默认工作区之间的确定性排序”
    manager.ensureDefaultWorkspace()
    const alpha = manager.createAgentWorkspace('alpha')
    const beta = manager.createAgentWorkspace('beta')
    // 故意让 beta（后创建、slug 字典序更大）的 createdAt 更早，验证排序真的按 createdAt 而不是创建调用顺序或 slug
    setWorkspaceCreatedAt(alpha.slug, 2_000)
    setWorkspaceCreatedAt(beta.slug, 1_000)

    manager.saveWorkspaceMcpConfig(alpha.slug, {
      servers: { filesystem: { type: 'stdio', command: 'alpha-fs', enabled: true } },
    })
    manager.saveWorkspaceMcpConfig(beta.slug, {
      servers: { filesystem: { type: 'stdio', command: 'beta-fs', enabled: true } },
    })

    await migration.migrateGlobalScopes()

    const global = manager.getGlobalMcpConfig()
    // beta createdAt 更早 → 先处理 → 占用原名；alpha 的版本加后缀保留
    expect(global.servers.filesystem?.command).toBe('beta-fs')
    expect(global.servers['filesystem@alpha']?.command).toBe('alpha-fs')
  })

  test('Given 默认工作区与其他工作区同名 server When 迁移 Then 默认工作区始终占用原名，被覆盖的旧值加 @default-overridden 保留', async () => {
    const defaultWs = manager.ensureDefaultWorkspace()
    const alpha = manager.createAgentWorkspace('alpha')
    setWorkspaceCreatedAt(defaultWs.slug, 3_000) // 默认工作区即使创建时间最晚，也应最后处理、占用原名
    setWorkspaceCreatedAt(alpha.slug, 1_000)

    manager.saveWorkspaceMcpConfig(alpha.slug, {
      servers: { filesystem: { type: 'stdio', command: 'alpha-fs', enabled: true } },
    })
    manager.saveWorkspaceMcpConfig(defaultWs.slug, {
      servers: { filesystem: { type: 'stdio', command: 'default-fs', enabled: true } },
    })

    await migration.migrateGlobalScopes()

    const global = manager.getGlobalMcpConfig()
    expect(global.servers.filesystem?.command).toBe('default-fs')
    expect(global.servers['filesystem@default-overridden']?.command).toBe('alpha-fs')
  })

  test('Given 两个工作区同名 server 但内容完全一致 When 迁移 Then 不生成冲突后缀（避免噪音）', async () => {
    const alpha = manager.createAgentWorkspace('alpha')
    const beta = manager.createAgentWorkspace('beta')
    setWorkspaceCreatedAt(alpha.slug, 1_000)
    setWorkspaceCreatedAt(beta.slug, 2_000)

    const sameEntry = { type: 'stdio' as const, command: 'shared-fs', enabled: true }
    manager.saveWorkspaceMcpConfig(alpha.slug, { servers: { filesystem: sameEntry } })
    manager.saveWorkspaceMcpConfig(beta.slug, { servers: { filesystem: sameEntry } })

    await migration.migrateGlobalScopes()

    const global = manager.getGlobalMcpConfig()
    expect(global.servers.filesystem?.command).toBe('shared-fs')
    expect(Object.keys(global.servers).filter((name) => name.includes('@'))).toEqual([])
  })

  test('Given 全局配置已持有某工作区数据但 state 未标记 mcp 步骤完成且源文件仍在 When 迁移 Then 内容相同不重复生成假冲突（幂等性防护）', async () => {
    // 直接构造“saveGlobalMcpConfig 已成功但 writeState 未来得及记录 mcp 步骤完成”这个 narrow failure window 的静态起始状态：
    // 全局配置已经持有这份数据（模拟上一轮已完成合并），工作区源文件仍然存在（模拟 mcp-rename 还没执行到），
    // 且 state 显示什么都没做过（模拟 writeState 失败或进程被杀）。不依赖“先跑一次完整迁移再重置 state”，
    // 因为完整迁移会顺便跑到 mcp-rename、把源文件改名，就无法真实复现这个窗口了。
    const ws = manager.createAgentWorkspace('solo')
    const entry = { type: 'stdio' as const, command: 'solo-fs', enabled: true }
    manager.saveWorkspaceMcpConfig(ws.slug, { servers: { filesystem: entry } })
    manager.saveGlobalMcpConfig({ servers: { filesystem: entry } })
    writeFileSync(configPaths.getGlobalScopeMigrationStatePath(), JSON.stringify({ version: 0, completedSteps: [] }, null, 2), 'utf-8')
    expect(existsSync(configPaths.getWorkspaceMcpPath(ws.slug))).toBe(true)

    await migration.migrateGlobalScopes()

    const global = manager.getGlobalMcpConfig()
    expect(global.servers.filesystem?.command).toBe('solo-fs')
    // 断言点：不应该出现 filesystem@solo 或 filesystem@default-overridden 之类的假冲突后缀
    expect(Object.keys(global.servers)).toEqual(['filesystem'])
  })

  test('Given 迁移已完整跑完一次 When 再次调用 Then 直接跳过、不产生任何告警', async () => {
    const ws = manager.createAgentWorkspace('solo')
    manager.saveWorkspaceMcpConfig(ws.slug, {
      servers: { filesystem: { type: 'stdio', command: 'solo-fs', enabled: true } },
    })

    const firstWarnings = await migration.migrateGlobalScopes()
    expect(firstWarnings).toEqual([])

    const secondWarnings = await migration.migrateGlobalScopes()
    expect(secondWarnings).toEqual([])
  })

  test('Given 迁移完整跑完 When 查询 getGlobalScopeReviewHints Then 工作区源文件已改名，无遗留提示', async () => {
    const ws = manager.createAgentWorkspace('solo')
    manager.saveWorkspaceMcpConfig(ws.slug, {
      servers: { filesystem: { type: 'stdio', command: 'solo-fs', enabled: true } },
    })

    await migration.migrateGlobalScopes()

    expect(existsSync(configPaths.getWorkspaceMcpPath(ws.slug))).toBe(false)
    expect(existsSync(`${configPaths.getWorkspaceMcpPath(ws.slug)}.migrated`)).toBe(true)

    const hints = migration.getGlobalScopeReviewHints()
    expect(hints.leftoverWorkspaceMcp).toEqual([])
  })

  test('Given 冲突迁移产生后缀 server When 查询 getGlobalScopeReviewHints Then 返回冲突后缀名清单', async () => {
    manager.ensureDefaultWorkspace()
    const alpha = manager.createAgentWorkspace('alpha')
    const beta = manager.createAgentWorkspace('beta')
    setWorkspaceCreatedAt(alpha.slug, 1_000)
    setWorkspaceCreatedAt(beta.slug, 2_000)
    manager.saveWorkspaceMcpConfig(alpha.slug, {
      servers: { filesystem: { type: 'stdio', command: 'alpha-fs', enabled: true } },
    })
    manager.saveWorkspaceMcpConfig(beta.slug, {
      servers: { filesystem: { type: 'stdio', command: 'beta-fs', enabled: true } },
    })

    await migration.migrateGlobalScopes()

    const hints = migration.getGlobalScopeReviewHints()
    expect(hints.mcpSuffixedServers).toEqual(['filesystem@beta'])
  })
})

describe('migrateGlobalScopes - Skills 上浮与清理', () => {
  test('Given 工作区持有预制 Skill 副本 When 迁移 Then 副本被清理并移入备份目录（不再残留在工作区）', async () => {
    writeDefaultSkillFixture('brainstorming', '头脑风暴')
    const ws = manager.ensureDefaultWorkspace() // ensureDefaultWorkspace 会自动从 default-skills 复制一份到工作区

    const workspaceCopyPath = join(configPaths.getWorkspaceSkillsDir(ws.slug), 'brainstorming')
    expect(existsSync(workspaceCopyPath)).toBe(true)

    await migration.migrateGlobalScopes()

    // 工作区里的预制技能副本应已被搬走（不再残留，避免与全局层重复维护）
    expect(existsSync(workspaceCopyPath)).toBe(false)
    // 全局层应持有这份技能
    expect(existsSync(join(configPaths.getGlobalSkillsDir(), 'brainstorming'))).toBe(true)
  })

  test('Given 用户自建了一个与全局技能同名但内容不同的 Skill When 迁移 Then 不被误判为冗余副本、原样保留', async () => {
    writeDefaultSkillFixture('code-review', '代码审查（预置版）')
    const ws = manager.createAgentWorkspace('custom')
    // 用户在自己的工作区里，用同一个 slug 写了一份内容完全不同的自定义 Skill
    // （现实场景：用户自己取名撞上了内置 slug，不是从 default-skills 复制来的）
    writeWorkspaceSkillFixture(ws.slug, 'code-review', '我的代码审查', '这是我自己写的完全不同的内容，不是预置版本')

    await migration.migrateGlobalScopes()

    const workspaceCopyPath = join(configPaths.getWorkspaceSkillsDir(ws.slug), 'code-review')
    // code-review 在预制白名单里，按现有产品规则（白名单命中即清理）仍会被搬走——
    // 但验证点是：被搬去的是备份目录而不是被静默覆盖/丢弃，用户数据可回滚找回
    expect(existsSync(workspaceCopyPath)).toBe(false)
    const backupPath = join(configPaths.getGlobalScopeMigrationBackupDir(), 'workspace-skills', ws.slug, 'skills', 'code-review', 'SKILL.md')
    const content = readFileSync(backupPath, 'utf-8')
    expect(content).toContain('这是我自己写的完全不同的内容')
  })

  test('Given 用户自建的 Skill 恰好与某个全局“非预置白名单”技能同名但内容不同 When 迁移 Then 保留用户版本，不因同名被清理', async () => {
    // 关键区别于上一个用例：这次全局技能名字不在 getDefaultSkillSlugs 白名单里
    // （模拟用户之前已经手动把一个全局 Skill 放到了 global-skills/，不是这次 bundled 快照带来的）
    const globalDir = join(configPaths.getGlobalSkillsDir(), 'my-shared-tool')
    mkdirSync(globalDir, { recursive: true })
    writeFileSync(join(globalDir, 'SKILL.md'), '---\nname: 共享工具\nversion: "2.0.0"\n---\n全局版本内容', 'utf-8')

    const ws = manager.createAgentWorkspace('custom')
    writeWorkspaceSkillFixture(ws.slug, 'my-shared-tool', '我的同名工具', '完全不同的自定义内容，只是恰好同名')

    await migration.migrateGlobalScopes()

    const workspaceCopyPath = join(configPaths.getWorkspaceSkillsDir(ws.slug), 'my-shared-tool')
    // 不在预制白名单里，且内容与全局版本不同 → 不应被判定为“冗余副本”，必须原样保留在工作区
    expect(existsSync(workspaceCopyPath)).toBe(true)
    const content = readFileSync(join(workspaceCopyPath, 'SKILL.md'), 'utf-8')
    expect(content).toContain('完全不同的自定义内容')
  })

  test('Given 工作区技能与全局技能同名且内容完全一致 When 迁移 Then 判定为真冗余副本并清理', async () => {
    const globalDir = join(configPaths.getGlobalSkillsDir(), 'my-shared-tool')
    mkdirSync(globalDir, { recursive: true })
    const sameContent = '---\nname: 共享工具\nversion: "2.0.0"\n---\n完全相同的内容'
    writeFileSync(join(globalDir, 'SKILL.md'), sameContent, 'utf-8')

    const ws = manager.createAgentWorkspace('custom')
    const workspaceCopyPath = join(configPaths.getWorkspaceSkillsDir(ws.slug), 'my-shared-tool')
    mkdirSync(workspaceCopyPath, { recursive: true })
    writeFileSync(join(workspaceCopyPath, 'SKILL.md'), sameContent, 'utf-8')

    await migration.migrateGlobalScopes()

    // 内容完全一致 → 确认是从全局复制来的冗余副本 → 清理
    expect(existsSync(workspaceCopyPath)).toBe(false)
  })
})

describe('getEffectiveSkillsDirs / getAllEffectiveSkills - 运行时接入', () => {
  test('Given 全局与工作区各有 Skills When 计算生效目录 Then 全局目录排首位（first-wins 优先级最高）', () => {
    const ws = manager.createAgentWorkspace('rt')
    const dirs = manager.getEffectiveSkillsDirs(ws.slug)
    expect(dirs[0]).toBe(configPaths.getGlobalSkillsDir())
    expect(dirs).toContain(configPaths.getWorkspaceSkillsDir(ws.slug))
  })

  test('Given 工作区技能与全局同名 When 获取生效技能列表 Then 工作区副本标记 shadowedByGlobal', () => {
    const globalDir = join(configPaths.getGlobalSkillsDir(), 'shared-skill')
    mkdirSync(globalDir, { recursive: true })
    writeFileSync(join(globalDir, 'SKILL.md'), '---\nname: 共享技能\n---\n', 'utf-8')

    const ws = manager.createAgentWorkspace('rt2')
    writeWorkspaceSkillFixture(ws.slug, 'shared-skill', '工作区版本')

    const all = manager.getAllEffectiveSkills(ws.slug)
    const globalOne = all.find((s) => s.slug === 'shared-skill' && s.scope === 'global')
    const workspaceOne = all.find((s) => s.slug === 'shared-skill' && s.scope === 'workspace')
    expect(globalOne?.shadowedByGlobal).toBeUndefined()
    expect(workspaceOne?.shadowedByGlobal).toBe(true)
  })
})
