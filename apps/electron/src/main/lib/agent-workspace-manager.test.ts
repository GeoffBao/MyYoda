import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { mockElectronModule } from './__tests__/electron-mock'

// Windows 非开发者模式/非管理员下创建 symlink 会抛 EPERM，此时跳过 symlink 相关测试
let symlinkSupported = true
try {
  const probeDir = mkdtempSync(join(os.tmpdir(), 'myyoda-symlink-probe-'))
  symlinkSync(join(probeDir, 'missing'), join(probeDir, 'link'), 'dir')
  rmSync(probeDir, { recursive: true, force: true })
} catch {
  symlinkSupported = false
}

type AgentWorkspaceManager = typeof import('./agent-workspace-manager')
type ConfigPathsModule = typeof import('./config-paths')
type ProjectRepositoryModule = typeof import('./project-repository')

let manager: AgentWorkspaceManager
let configPaths: ConfigPathsModule
let projectRepositoryModule: ProjectRepositoryModule
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
  tempHome = mkdtempSync(join(os.tmpdir(), 'myyoda-agent-workspace-manager-'))
  process.env.HOME = tempHome
  delete process.env.MYYODA_DEV
  process.env.MYYODA_DEV = '0'
  configPaths = await import('./config-paths')
  manager = await import('./agent-workspace-manager')
  projectRepositoryModule = await import('./project-repository')
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

function writeWorkspaceSkill(workspaceSlug: string, skillSlug: string, name: string): void {
  const skillDir = join(configPaths.getWorkspaceSkillsDir(workspaceSlug), skillSlug)
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(join(skillDir, 'SKILL.md'), `---\nname: ${name}\n---\n`, 'utf-8')
}

describe('Agent 工作区 MCP 配置', () => {
  test('Given 工作区 MCP 包含内置保留名 When 归一化配置 Then 剔除冲突项并保留普通服务器', () => {
    const normalized = manager.normalizeWorkspaceMcpConfig({
      servers: {
        automation: {
          type: 'stdio',
          command: 'custom-automation',
          enabled: true,
        },
        nano_banana: {
          type: 'stdio',
          command: 'custom-nano',
          enabled: true,
        },
        github: {
          type: 'stdio',
          command: 'github-mcp',
          enabled: true,
        },
      },
    })

    expect(Object.keys(normalized.servers).sort()).toEqual(['github'])
    expect(normalized.servers.github?.command).toBe('github-mcp')
  })
})

describe('Agent 工作区创建', () => {
  test('Given 项目名称是 Windows 保留设备名 When 创建工作区 Then slug 避免直接使用保留名', () => {
    const workspace = manager.createAgentWorkspace('CON')

    expect(workspace.slug).toBe('workspace-con')
    expect(existsSync(configPaths.getAgentWorkspacePath(workspace.slug))).toBe(true)
  })

  test('Given 默认 Skill 包含 blocklist 目录 When 创建工作区 Then 初始化 Skills 时跳过高风险目录', () => {
    const defaultSkillDir = join(configPaths.getDefaultSkillsDir(), 'sample-skill')
    mkdirSync(join(defaultSkillDir, '.git', 'objects'), { recursive: true })
    mkdirSync(join(defaultSkillDir, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(defaultSkillDir, 'SKILL.md'), '---\nname: Sample\n---\n', 'utf-8')
    writeFileSync(join(defaultSkillDir, '.git', 'objects', 'locked'), 'skip', 'utf-8')
    writeFileSync(join(defaultSkillDir, 'node_modules', 'pkg', 'index.js'), 'skip', 'utf-8')

    const workspace = manager.createAgentWorkspace('Filtered Copy')
    const copiedSkillDir = join(configPaths.getWorkspaceSkillsDir(workspace.slug), 'sample-skill')

    expect(existsSync(join(copiedSkillDir, 'SKILL.md'))).toBe(true)
    expect(existsSync(join(copiedSkillDir, '.git'))).toBe(false)
    expect(existsSync(join(copiedSkillDir, 'node_modules'))).toBe(false)
  })

  test('Given deferSkillsCopy:true（交互式创建入口） When 创建工作区 Then 立即返回且不同步拷贝 Skills，后台异步补齐后与同步路径结果一致', async () => {
    const defaultSkillDir = join(configPaths.getDefaultSkillsDir(), 'async-sample-skill')
    mkdirSync(defaultSkillDir, { recursive: true })
    writeFileSync(join(defaultSkillDir, 'SKILL.md'), '---\nname: Async Sample\n---\n', 'utf-8')

    const workspace = manager.createAgentWorkspace({ name: '异步拷贝测试', deferSkillsCopy: true })
    const copiedSkillMd = join(configPaths.getWorkspaceSkillsDir(workspace.slug), 'async-sample-skill', 'SKILL.md')

    // 关键断言：createAgentWorkspace 本身是同步函数且已返回，但异步拷贝还没跑完（fs/promises.cp 走
    // libuv 线程池，不占用当前同步栈）——这里不对未完成状态做强时序断言（避免 flaky），
    // 只验证最终一致性：轮询等待到后台拷贝完成。
    let settled = false
    for (let i = 0; i < 50 && !settled; i++) {
      if (existsSync(copiedSkillMd)) settled = true
      else await new Promise((r) => setTimeout(r, 20))
    }

    expect(settled).toBe(true)
    expect(readFileSync(copiedSkillMd, 'utf-8')).toContain('Async Sample')
  })
})

describe('隐藏容器 Project 已移除', () => {
  test('Given 新建工作区 When 创建完成 Then 不再自动生成 home / ad-hoc 隐藏 Project', () => {
    const workspace = manager.createAgentWorkspace('隐藏容器测试')
    const projects = projectRepositoryModule.projectRepository.listProjectsAtRoot(
      configPaths.getAgentWorkspacePath(workspace.slug),
    )

    expect(projects.filter((project) => project.config.kind === 'home')).toHaveLength(0)
    expect(projects.filter((project) => project.config.kind === 'ad-hoc')).toHaveLength(0)
  })

  test('Given 存量隐藏 Project config 存在 When 列出工作区项目 Then 读取兼容且不新增', () => {
    const workspace = manager.createAgentWorkspace('隐藏容器兼容测试')
    const root = configPaths.getAgentWorkspacePath(workspace.slug)
    // 模拟历史遗留：手写一个 home 容器 config（旧版 ensureHomeProject 产物）
    const legacyDir = join(root, 'projects', 'project')
    mkdirSync(legacyDir, { recursive: true })
    writeFileSync(join(legacyDir, 'config.json'), JSON.stringify({
      id: 'proj_legacy_home',
      slug: 'project',
      name: '首页工作区',
      workingDirectory: configPaths.getWorkspaceFilesDir(workspace.slug),
      kind: 'home',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }, null, 2))

    const projects = projectRepositoryModule.projectRepository.listProjectsAtRoot(root)
    const home = projects.find((project) => project.config.kind === 'home')
    expect(home?.config.kind).toBe('home')
    expect(home?.config.workingDirectory).toBe(configPaths.getWorkspaceFilesDir(workspace.slug))
    expect(projects.filter((project) => project.config.kind === 'home')).toHaveLength(1)
  })
})

describe('ensureDefaultWorkspace', () => {
  test('新建时名称为默认工作区，不改已有自定义名称；Default Space/默认空间旧名会迁移', () => {
    const created = manager.ensureDefaultWorkspace()
    expect(created.slug).toBe('default')
    expect(created.name).toBe('默认工作区')

    manager.updateAgentWorkspace(created.id, { name: 'Default Space' })
    const migrated = manager.ensureDefaultWorkspace()
    expect(migrated.id).toBe(created.id)
    expect(migrated.name).toBe('默认工作区')

    manager.updateAgentWorkspace(created.id, { name: '默认空间' })
    const migratedChineseLegacy = manager.ensureDefaultWorkspace()
    expect(migratedChineseLegacy.name).toBe('默认工作区')

    manager.updateAgentWorkspace(created.id, { name: '我的实验室' })
    const again = manager.ensureDefaultWorkspace()
    expect(again.id).toBe(created.id)
    expect(again.name).toBe('我的实验室')
  })

  test('已有其他工作区占用默认工作区名称时保留默认项的历史名称，避免迁移产生重名', () => {
    const defaultWorkspace = manager.ensureDefaultWorkspace()
    manager.updateAgentWorkspace(defaultWorkspace.id, { name: '默认空间' })
    const existingNamedWorkspace = manager.createAgentWorkspace('默认工作区')

    const migrated = manager.ensureDefaultWorkspace()
    const workspaces = manager.listAgentWorkspaces()

    expect(migrated.name).toBe('默认空间')
    expect(workspaces.find((workspace) => workspace.id === existingNamedWorkspace.id)?.name).toBe('默认工作区')
    expect(workspaces.filter((workspace) => workspace.name === '默认工作区')).toHaveLength(1)
  })
})

describe('默认工作区目录（应用设置）', () => {
  test('Given 设置未配置 When 读取默认工作区目录 Then 回退读取默认工作区 config.json 旧值', () => {
    manager.ensureDefaultWorkspace()
    expect(manager.getAgentDefaultWorkingDirectory()).toBeUndefined()

    const legacyPath = '/tmp/legacy-project'
    writeFileSync(
      join(configPaths.getAgentWorkspacePath('default'), 'config.json'),
      JSON.stringify({ defaultWorkingDirectory: legacyPath }),
      'utf-8',
    )
    expect(manager.getAgentDefaultWorkingDirectory()).toBe(legacyPath)
    // 兼容旧签名读取（按 slug / 按 workspace root）走同一回退
    expect(manager.getWorkspaceDefaultWorkingDirectory('default')).toBe(legacyPath)
    expect(manager.getWorkspaceDefaultWorkingDirectoryAtRoot(configPaths.getAgentWorkspacePath('default'))).toBe(legacyPath)
  })

  test('Given 应用设置已配置 When 读取默认工作区目录 Then 设置优先于 config.json 旧值，并清理旧字段', () => {
    manager.ensureDefaultWorkspace()
    const legacyPath = '/tmp/legacy-project'
    writeFileSync(
      join(configPaths.getAgentWorkspacePath('default'), 'config.json'),
      JSON.stringify({ defaultWorkingDirectory: legacyPath }),
      'utf-8',
    )

    manager.setAgentDefaultWorkingDirectory('/tmp/app-level-project')
    expect(manager.getAgentDefaultWorkingDirectory()).toBe('/tmp/app-level-project')
    expect(manager.getWorkspaceDefaultWorkingDirectory('default')).toBe('/tmp/app-level-project')
    expect(manager.getWorkspaceDefaultWorkingDirectoryAtRoot(configPaths.getAgentWorkspacePath('default'))).toBe('/tmp/app-level-project')

    // 设置后清理各工作区 config.json 旧字段，避免双源
    const config = JSON.parse(readFileSync(join(configPaths.getAgentWorkspacePath('default'), 'config.json'), 'utf-8'))
    expect(config.defaultWorkingDirectory).toBeUndefined()
  })

  test('Given 清空应用设置 When 读取默认工作区目录 Then 回到未配置状态且不再回退旧值', () => {
    manager.ensureDefaultWorkspace()
    manager.setAgentDefaultWorkingDirectory('/tmp/app-level-project')
    expect(manager.getAgentDefaultWorkingDirectory()).toBe('/tmp/app-level-project')

    manager.setAgentDefaultWorkingDirectory(undefined)
    expect(manager.getAgentDefaultWorkingDirectory()).toBeUndefined()
    expect(manager.getWorkspaceDefaultWorkingDirectory('default')).toBeUndefined()
  })

  test('兼容旧 set 签名：转发到应用级设置', () => {
    manager.ensureDefaultWorkspace()
    manager.setWorkspaceDefaultWorkingDirectory('default', '/tmp/legacy-api-path')
    expect(manager.getAgentDefaultWorkingDirectory()).toBe('/tmp/legacy-api-path')
  })
})

describe('Agent 工作区删除边界', () => {
  test('删除工作区只删除 MyYoda 托管目录，不删除项目绑定的外部工作目录', () => {
    manager.ensureDefaultWorkspace()
    const workspace = manager.createAgentWorkspace('客户项目')
    const externalDir = mkdtempSync(join(os.tmpdir(), 'myyoda-external-project-'))
    const marker = join(externalDir, 'KEEP.txt')
    writeFileSync(marker, 'keep', 'utf-8')

    projectRepositoryModule.projectRepository.createProject(workspace.id, {
      name: '外部仓库',
      workingDirectory: externalDir,
    })
    const managedWorkspaceDir = configPaths.getAgentWorkspacePath(workspace.slug)

    manager.deleteAgentWorkspace(workspace.id)

    expect(existsSync(managedWorkspaceDir)).toBe(false)
    expect(existsSync(marker)).toBe(true)
    rmSync(externalDir, { recursive: true, force: true })
  })
})

describe('Agent 工作区 Skill 扫描', () => {
  test.skipIf(!symlinkSupported)('Given Skills 目录包含 broken symlink When 获取工作区 Skills Then 跳过坏条目并继续扫描后续 Skill', () => {
    const workspaceSlug = 'workspace-a'
    const skillsDir = configPaths.getWorkspaceSkillsDir(workspaceSlug)

    writeWorkspaceSkill(workspaceSlug, 'alpha', 'Alpha')
    symlinkSync(join(skillsDir, 'missing-target'), join(skillsDir, 'broken-link'), 'dir')
    writeWorkspaceSkill(workspaceSlug, 'zeta', 'Zeta')

    for (let i = 0; i < 20; i++) {
      const entryNames = readdirSync(skillsDir)
      const brokenIndex = entryNames.indexOf('broken-link')
      const hasSkillAfterBroken = entryNames.slice(brokenIndex + 1).some((name) => name !== 'missing-target')
      if (brokenIndex !== -1 && hasSkillAfterBroken) break
      writeWorkspaceSkill(workspaceSlug, `tail-${i}`, `Tail ${i}`)
    }

    const finalEntryNames = readdirSync(skillsDir)
    const finalBrokenIndex = finalEntryNames.indexOf('broken-link')
    expect(finalBrokenIndex).not.toBe(-1)
    expect(finalEntryNames.slice(finalBrokenIndex + 1).some((name) => name !== 'missing-target')).toBe(true)

    const expectedSlugs = finalEntryNames
      .filter((name) => name !== 'broken-link')
      .sort()
    const skills = manager.getWorkspaceSkills(workspaceSlug)

    expect(skills.map((skill) => skill.slug).sort()).toEqual(expectedSlugs)
  })
})

describe('Agent 工作区 Skill 批量导入', () => {
  test('Given 来源有多个 Skill When 批量导入 Then 成功复制并记录来源，重复项跳过', async () => {
    writeWorkspaceSkill('source', 'alpha', 'Alpha')
    writeWorkspaceSkill('source', 'beta', 'Beta')

    const imported = await manager.batchImportSkillsFromWorkspaces('target', [
      { sourceSlug: 'source', skillSlug: 'alpha' },
      { sourceSlug: 'source', skillSlug: 'beta' },
    ])

    expect(imported.imported).toBe(2)
    expect(imported.skipped).toBe(0)
    expect(imported.failed).toBe(0)
    expect(existsSync(join(configPaths.getWorkspaceSkillsDir('target'), 'alpha', 'SKILL.md'))).toBe(true)
    expect(JSON.parse(readFileSync(join(configPaths.getWorkspaceSkillsDir('target'), 'alpha', '.source.json'), 'utf-8'))).toMatchObject({
      sourceWorkspaceSlug: 'source',
    })

    const duplicate = await manager.batchImportSkillsFromWorkspaces('target', [
      { sourceSlug: 'source', skillSlug: 'alpha' },
    ])
    expect(duplicate.imported).toBe(0)
    expect(duplicate.skipped).toBe(1)
    expect(duplicate.failed).toBe(0)
  })

  test('Given 目标 inactive 目录已有同名 Skill When 批量导入 Then 跳过且不覆盖', async () => {
    writeWorkspaceSkill('source', 'inactive-skill', 'Source Skill')
    const inactivePath = join(configPaths.getInactiveSkillsDir('target'), 'inactive-skill')
    mkdirSync(inactivePath, { recursive: true })
    writeFileSync(join(inactivePath, 'SKILL.md'), '---\nname: Existing Skill\n---\n', 'utf-8')

    const result = await manager.batchImportSkillsFromWorkspaces('target', [
      { sourceSlug: 'source', skillSlug: 'inactive-skill' },
    ])

    expect(result.skipped).toBe(1)
    expect(result.failed).toBe(0)
    expect(readFileSync(join(inactivePath, 'SKILL.md'), 'utf-8')).toContain('Existing Skill')
  })

  test('Given 两个来源并发导入同名 Skill When 批量导入 Then 只保留第一个完成项且另一个跳过', async () => {
    writeWorkspaceSkill('source-a', 'shared-skill', 'Source A')
    writeWorkspaceSkill('source-b', 'shared-skill', 'Source B')

    const [fromA, fromB] = await Promise.all([
      manager.batchImportSkillsFromWorkspaces('target', [{ sourceSlug: 'source-a', skillSlug: 'shared-skill' }]),
      manager.batchImportSkillsFromWorkspaces('target', [{ sourceSlug: 'source-b', skillSlug: 'shared-skill' }]),
    ])

    expect(fromA.imported + fromB.imported).toBe(1)
    expect(fromA.skipped + fromB.skipped).toBe(1)
    expect(fromA.failed + fromB.failed).toBe(0)
    const importedContent = readFileSync(join(configPaths.getWorkspaceSkillsDir('target'), 'shared-skill', 'SKILL.md'), 'utf-8')
    expect(['Source A', 'Source B'].some((name) => importedContent.includes(name))).toBe(true)
  })

  test('Given 来源缺失或导入中元数据写入失败 When 批量导入 Then 返回失败且不留下目标残片', async () => {
    const missing = await manager.batchImportSkillsFromWorkspaces('target', [
      // 旧实现会因错误文案包含“已存在”而误判为 skipped。
      { sourceSlug: 'source', skillSlug: '已存在' },
    ])
    expect(missing.failed).toBe(1)
    expect(missing.skipped).toBe(0)

    const malformedSource = join(configPaths.getWorkspaceSkillsDir('source'), 'malformed')
    mkdirSync(malformedSource, { recursive: true })
    writeFileSync(join(malformedSource, 'SKILL.md'), '---\nname: Malformed\n---\n', 'utf-8')
    // cpSync 会复制该目录；随后写入 .source.json 必须失败，验证临时目录回滚。
    mkdirSync(join(malformedSource, '.source.json'))

    const result = await manager.batchImportSkillsFromWorkspaces('target', [
      { sourceSlug: 'source', skillSlug: 'malformed' },
    ])
    const targetSkillsDir = configPaths.getWorkspaceSkillsDir('target')

    expect(result.failed).toBe(1)
    expect(result.skipped).toBe(0)
    expect(existsSync(join(targetSkillsDir, 'malformed'))).toBe(false)
    expect(readdirSync(targetSkillsDir).some((name) => name.startsWith('.malformed.importing-'))).toBe(false)
  })
})

describe('跨 Project 导入 Skill（对齐 Proma “跨工作区导入”的真实粒度：他们一个 workspace = 一个仓库，等价于这里的一个嵌套 Project）', () => {
  test('Given 工作区默认 + 另一个嵌套 Project 都有 Skill，还有一个隐藏容器 Project When 获取可导入来源 Then 排除当前 Project、排除隐藏容器，来源标签正确', () => {
    const workspace = manager.createAgentWorkspace('跨项目导入测试工作区')
    const root = configPaths.getAgentWorkspacePath(workspace.slug)

    writeWorkspaceSkill(workspace.slug, 'ws-shared', '工作区共享技能')

    const current = projectRepositoryModule.projectRepository.createProject(workspace.id, { name: '当前项目' })
    const sibling = projectRepositoryModule.projectRepository.createProject(workspace.id, { name: '另一个项目' })
    const hidden = projectRepositoryModule.projectRepository.createProject(workspace.id, { name: '隐藏容器', kind: 'ad-hoc' })

    const siblingSkillsDir = projectRepositoryModule.projectRepository.ensureProjectSkillsDirAtRoot(root, sibling.id)
    mkdirSync(join(siblingSkillsDir, 'sibling-skill'), { recursive: true })
    writeFileSync(join(siblingSkillsDir, 'sibling-skill', 'SKILL.md'), '---\nname: 另项目技能\n---\n', 'utf-8')

    const hiddenSkillsDir = projectRepositoryModule.projectRepository.ensureProjectSkillsDirAtRoot(root, hidden.id)
    mkdirSync(join(hiddenSkillsDir, 'hidden-skill'), { recursive: true })
    writeFileSync(join(hiddenSkillsDir, 'hidden-skill', 'SKILL.md'), '---\nname: 隐藏技能\n---\n', 'utf-8')

    const groups = manager.getOtherProjectSkills(workspace.slug, current.id)

    expect(groups).toHaveLength(2)
    const workspaceGroup = groups.find((g) => g.sourceKind === 'workspace')
    expect(workspaceGroup?.sourceLabel).toBe('工作区默认（跨项目共享）')
    expect(workspaceGroup?.skills.map((s) => s.slug)).toEqual(['ws-shared'])

    const projectGroup = groups.find((g) => g.sourceKind === 'project')
    expect(projectGroup?.sourceProjectId).toBe(sibling.id)
    expect(projectGroup?.sourceLabel).toBe('另一个项目')
    expect(projectGroup?.skills.map((s) => s.slug)).toEqual(['sibling-skill'])

    // 隐藏容器 Project 不应出现在可导入来源里
    expect(groups.some((g) => g.sourceProjectId === hidden.id)).toBe(false)
  })

  test('Given 从工作区默认和另一个 Project 各导入一个 Skill When 批量导入 Then 都成功且不带 .source.json（项目级无导入来源追踪体系）', async () => {
    const workspace = manager.createAgentWorkspace('跨项目导入执行测试工作区')
    const root = configPaths.getAgentWorkspacePath(workspace.slug)

    writeWorkspaceSkill(workspace.slug, 'from-workspace', '来自工作区')

    const target = projectRepositoryModule.projectRepository.createProject(workspace.id, { name: '目标项目' })
    const source = projectRepositoryModule.projectRepository.createProject(workspace.id, { name: '源项目' })
    const sourceSkillsDir = projectRepositoryModule.projectRepository.ensureProjectSkillsDirAtRoot(root, source.id)
    mkdirSync(join(sourceSkillsDir, 'from-project'), { recursive: true })
    writeFileSync(join(sourceSkillsDir, 'from-project', 'SKILL.md'), '---\nname: 来自项目\n---\n', 'utf-8')

    const result = await manager.batchImportSkillsToProject(workspace.slug, target.id, [
      { sourceKind: 'workspace', skillSlug: 'from-workspace' },
      { sourceKind: 'project', sourceProjectId: source.id, skillSlug: 'from-project' },
    ])

    expect(result.imported).toBe(2)
    expect(result.skipped).toBe(0)
    expect(result.failed).toBe(0)

    const targetSkillsDir = projectRepositoryModule.projectRepository.getProjectSkillsDirPath(root, target.id)
    expect(targetSkillsDir).not.toBeNull()
    expect(existsSync(join(targetSkillsDir!, 'from-workspace', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(targetSkillsDir!, 'from-project', 'SKILL.md'))).toBe(true)
    // 关键断言：不带 .source.json，避免项目级 Skill 凭空出现“可更新”提示（项目级无导入来源追踪体系，批次 2 已定的范围）
    expect(existsSync(join(targetSkillsDir!, 'from-workspace', '.source.json'))).toBe(false)
    expect(existsSync(join(targetSkillsDir!, 'from-project', '.source.json'))).toBe(false)

    const imported = manager.getProjectSkills(workspace.slug, target.id)
    const importedFromWorkspace = imported.find((s) => s.slug === 'from-workspace')
    expect(importedFromWorkspace?.hasUpdate).toBeUndefined()
    expect(importedFromWorkspace?.importSource).toBeUndefined()
  })

  test('Given 目标 Project 已存在同名 Skill When 导入 Then 跳过且不覆盖', async () => {
    const workspace = manager.createAgentWorkspace('跨项目导入重复测试工作区')
    const root = configPaths.getAgentWorkspacePath(workspace.slug)

    writeWorkspaceSkill(workspace.slug, 'dup-skill', '来源版')

    const target = projectRepositoryModule.projectRepository.createProject(workspace.id, { name: '目标项目' })
    const targetSkillsDir = projectRepositoryModule.projectRepository.ensureProjectSkillsDirAtRoot(root, target.id)
    mkdirSync(join(targetSkillsDir, 'dup-skill'), { recursive: true })
    writeFileSync(join(targetSkillsDir, 'dup-skill', 'SKILL.md'), '---\nname: 已存在版\n---\n', 'utf-8')

    const result = await manager.batchImportSkillsToProject(workspace.slug, target.id, [
      { sourceKind: 'workspace', skillSlug: 'dup-skill' },
    ])

    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.failed).toBe(0)
    expect(readFileSync(join(targetSkillsDir, 'dup-skill', 'SKILL.md'), 'utf-8')).toContain('已存在版')
  })

  test('Given 来源 Skill 不存在 When 导入 Then 返回失败而非抛异常', async () => {
    const workspace = manager.createAgentWorkspace('跨项目导入失败测试工作区')
    const target = projectRepositoryModule.projectRepository.createProject(workspace.id, { name: '目标项目' })

    const result = await manager.batchImportSkillsToProject(workspace.slug, target.id, [
      { sourceKind: 'project', sourceProjectId: 'not-exist', skillSlug: 'ghost' },
    ])

    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(0)
    expect(result.failed).toBe(1)
  })
})

describe('项目级 Skills 目录解析（仅查看不创建）', () => {
  test('Given 本地目录绑定项目 When 仅调用 getProjectSkillsDir（未真正使用 Skills） Then 不在真实工作目录下创建 .context/skills/', () => {
    manager.ensureDefaultWorkspace()
    const workspace = manager.createAgentWorkspace('本地代码仓库项目')
    const externalDir = mkdtempSync(join(os.tmpdir(), 'myyoda-project-view-only-'))
    const project = projectRepositoryModule.projectRepository.createProject(workspace.id, {
      name: '外部仓库',
      workingDirectory: externalDir,
    })

    const dir = manager.getProjectSkillsDir(workspace.slug, project.id)

    expect(dir).toBe(join(externalDir, '.context', 'skills'))
    // 关键断言：仅查询路径不能在用户真实代码仓库里静默创建 .context/ 目录，与 readProjectMemory 只读不写的原则保持一致
    expect(existsSync(join(externalDir, '.context'))).toBe(false)

    rmSync(externalDir, { recursive: true, force: true })
  })

  test('Given 托管（无 workingDirectory）项目 When 仅调用 getProjectSkillsDir Then 同样不创建目录，仅解析路径', () => {
    manager.ensureDefaultWorkspace()
    const workspace = manager.createAgentWorkspace('托管项目工作区')
    const project = projectRepositoryModule.projectRepository.createProject(workspace.id, {
      name: '无目录绑定项目',
    })

    const dir = manager.getProjectSkillsDir(workspace.slug, project.id)

    expect(dir).toBe(join(configPaths.getAgentWorkspacePath(workspace.slug), 'projects', project.slug ?? '', 'skills'))
    expect(existsSync(dir)).toBe(false)
  })

  test('Given 项目不存在 When 调用 getProjectSkillsDir Then 返回空字符串而非抛错', () => {
    manager.ensureDefaultWorkspace()
    const workspace = manager.createAgentWorkspace('无项目工作区')

    expect(manager.getProjectSkillsDir(workspace.slug, 'not-a-real-project-id')).toBe('')
  })
})

describe('Skill slug 路径穿越防护（resolveSkillDir / resolveGlobalSkillDir / resolveProjectSkillDir 共享）', () => {
  test('Given skillSlug 包含 .. 相对路径段 When 读取工作区 Skill 内容 Then 报错而不是静默解析到目录外', () => {
    const workspaceSlug = 'workspace-a'
    writeWorkspaceSkill(workspaceSlug, 'alpha', 'Alpha')

    expect(() => manager.readWorkspaceSkillContent(workspaceSlug, '../../../../etc/passwd')).toThrow()
    expect(() => manager.readWorkspaceSkillContent(workspaceSlug, '..')).toThrow()
    expect(() => manager.readWorkspaceSkillContent(workspaceSlug, '.')).toThrow()
  })

  test('Given skillSlug 包含路径分隔符 When 读取全局 Skill 子文件列表 Then 报错（global scope 同样受保护）', () => {
    expect(() => manager.listSkillFiles('', 'foo/../../bar', 'global')).toThrow()
    expect(() => manager.listSkillFiles('', 'foo\\..\\bar', 'global')).toThrow()
  })

  test('Given 合法 slug When 调用上述函数 Then 不受影响（校验不误伤正常路径）', () => {
    const workspaceSlug = 'workspace-valid'
    writeWorkspaceSkill(workspaceSlug, 'alpha', 'Alpha')

    expect(manager.readWorkspaceSkillContent(workspaceSlug, 'alpha')).toContain('Alpha')
  })
})

describe('全局 Skills 启用/禁用/删除', () => {
  function writeGlobalSkill(slug: string, name: string): void {
    const dir = join(configPaths.getGlobalSkillsDir(), slug)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\n---\n`, 'utf-8')
  }

  test('Given 全局 Skill 处于 active When 禁用 Then 移入 global-skills-inactive/，再启用可移回', () => {
    writeGlobalSkill('shared-tool', '共享工具')

    manager.toggleGlobalSkill('shared-tool', false)
    expect(existsSync(join(configPaths.getGlobalSkillsDir(), 'shared-tool'))).toBe(false)
    expect(existsSync(join(configPaths.getGlobalInactiveSkillsDir(), 'shared-tool'))).toBe(true)

    manager.toggleGlobalSkill('shared-tool', true)
    expect(existsSync(join(configPaths.getGlobalSkillsDir(), 'shared-tool'))).toBe(true)
    expect(existsSync(join(configPaths.getGlobalInactiveSkillsDir(), 'shared-tool'))).toBe(false)
  })

  test('Given 全局 Skill 不存在 When 切换或删除 Then 报错', () => {
    expect(() => manager.toggleGlobalSkill('not-exist', false)).toThrow()
    expect(() => manager.deleteGlobalSkill('not-exist')).toThrow()
  })

  test('Given 全局 Skill 存在 When 删除 Then 真实从磁盘移除（不是移入备份目录，调用方需自行确认）', () => {
    writeGlobalSkill('to-remove', '待删除')

    manager.deleteGlobalSkill('to-remove')

    expect(existsSync(join(configPaths.getGlobalSkillsDir(), 'to-remove'))).toBe(false)
    expect(existsSync(join(configPaths.getGlobalInactiveSkillsDir(), 'to-remove'))).toBe(false)
  })
})

describe('getAllEffectiveSkills —— 全局+工作区三层合并', () => {
  test('Given 工作区技能与全局同名 When 获取合并列表 Then 两份都在且 scope 正确，工作区那份标记 shadowedByGlobal', () => {
    const workspaceSlug = 'workspace-shadow'
    const globalDir = join(configPaths.getGlobalSkillsDir(), 'code-review')
    mkdirSync(globalDir, { recursive: true })
    writeFileSync(join(globalDir, 'SKILL.md'), '---\nname: 全局版代码审查\n---\n', 'utf-8')
    writeWorkspaceSkill(workspaceSlug, 'code-review', '工作区自建同名')

    const all = manager.getAllEffectiveSkills(workspaceSlug)
    const globalOne = all.find((s) => s.slug === 'code-review' && s.scope === 'global')
    const workspaceOne = all.find((s) => s.slug === 'code-review' && s.scope === 'workspace')

    expect(globalOne).toBeDefined()
    expect(workspaceOne).toBeDefined()
    expect(globalOne?.shadowedByGlobal).toBeUndefined()
    expect(workspaceOne?.shadowedByGlobal).toBe(true)
  })

  test('Given 全局与工作区 Skill 互不同名 When 获取合并列表 Then 都不标记 shadowedByGlobal', () => {
    const workspaceSlug = 'workspace-no-shadow'
    const globalDir = join(configPaths.getGlobalSkillsDir(), 'global-only')
    mkdirSync(globalDir, { recursive: true })
    writeFileSync(join(globalDir, 'SKILL.md'), '---\nname: 仅全局\n---\n', 'utf-8')
    writeWorkspaceSkill(workspaceSlug, 'workspace-only', '仅工作区')

    const all = manager.getAllEffectiveSkills(workspaceSlug)

    expect(all.find((s) => s.slug === 'global-only')?.shadowedByGlobal).toBeUndefined()
    expect(all.find((s) => s.slug === 'workspace-only')?.shadowedByGlobal).toBeUndefined()
  })
})
