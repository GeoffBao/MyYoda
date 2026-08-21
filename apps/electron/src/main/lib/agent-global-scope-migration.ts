/**
 * 全局作用域启动迁移（migrateGlobalScopes）
 *
 * 将旧的"工作区全隔离"模型一次性迁移到"MCP 全局唯一 + Skills 全局 < 工作区 < 项目三层叠加"模型：
 *
 * 1. MCP：所有工作区 mcp.json + 嵌套 Project 的 .context/mcp.json 合并进全局 ~/.myyoda/mcp.json
 *    - 同名 server 冲突：保留"默认工作区"（最早创建）版本，其余以 `{name}@{slug}` 后缀保留并告警
 * 2. Skills：~/.myyoda/default-skills/ 复制到 ~/.myyoda/global-skills/（已存在不覆盖）
 *    - 存量工作区 skills/ 中属于预制白名单（getDefaultSkillSlugs）的 skill 复制上浮到全局
 *    - 运行时三层叠加生效（getEffectiveSkillsDirs），global 优先级最高（first-wins），工作区/项目层同名仅产生 collision 诊断，不是真正的“覆盖”
 *
 * AGENTS.md 与 Memory 仍按工作区基线管理，本迁移不改动它们。
 *
 * 幂等：进度写入 ~/.myyoda/.migration-global-scope.json，重复执行跳过已完成步骤。
 * 可回滚：所有被合并的源文件先备份到 ~/.myyoda/.migration-backup/。
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { cp as cpAsync } from 'node:fs/promises'
import { basename, join } from 'node:path'
import {
  getAgentWorkspacesDir,
  getDefaultSkillsDir,
  getGlobalMcpPath,
  getGlobalScopeMigrationBackupDir,
  getGlobalScopeMigrationStatePath,
  getGlobalSkillsDir,
  getInactiveSkillsDir,
  getWorkspaceMcpPath,
  getWorkspaceSkillsDir,
  RETIRED_DEFAULT_SKILL_SLUGS,
} from './config-paths'
import {
  getDefaultSkillSlugs,
  getEnabledGlobalSkillSlugs,
  getGlobalMcpConfig,
  getWorkspaceMcpConfig,
  listAgentWorkspaces,
  normalizeWorkspaceMcpConfig,
  saveGlobalMcpConfig,
} from './agent-workspace-manager'
import { projectRepository } from './project-repository'
import {
  getProjectMcpConfigPath,
  readProjectMcpConfigRaw,
} from '@myyoda/shared/projects/storage'
import type { GlobalScopeReviewHints, WorkspaceMcpConfig } from '@myyoda/shared'

interface MigrationState {
  version: number
  completedSteps: string[]
  migratedAt?: string
}

const MIGRATION_VERSION = 3
const REQUIRED_MIGRATION_STEPS = [
  'mcp',
  'skills-default',
  'skills-lift',
  'skills-cleanup',
  'mcp-rename',
] as const

function isMigrationComplete(state: MigrationState): boolean {
  return state.version >= MIGRATION_VERSION
    && REQUIRED_MIGRATION_STEPS.every((step) => state.completedSteps.includes(step))
}

/** 复制 default-skills 时防御性过滤的元数据目录（与 config-paths 的 DEFAULT_SKILL_COPY_BLOCKLIST 对齐） */
const SKILL_COPY_BLOCKLIST = new Set([
  '.git',
  '.DS_Store',
  'node_modules',
  '.next',
  '.cache',
  '.turbo',
  '__pycache__',
])

function readState(): MigrationState {
  try {
    const raw = readFileSync(getGlobalScopeMigrationStatePath(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<MigrationState>
    return { version: parsed.version ?? 0, completedSteps: parsed.completedSteps ?? [] }
  } catch {
    return { version: 0, completedSteps: [] }
  }
}

function writeState(state: MigrationState): void {
  try {
    writeFileSync(getGlobalScopeMigrationStatePath(), JSON.stringify(state, null, 2), 'utf-8')
  } catch (error) {
    console.warn('[迁移] 写入迁移进度失败（不影响结果）:', error)
  }
}

function backupFile(sourcePath: string, label: string): void {
  try {
    if (!existsSync(sourcePath)) return
    const target = join(getGlobalScopeMigrationBackupDir(), label)
    if (!existsSync(target)) {
      copyFileSync(sourcePath, target)
    }
  } catch (error) {
    console.warn(`[迁移] 备份失败 ${label}:`, error)
  }
}

function copySkillDir(source: string, target: string): Promise<void> {
  return cpAsync(source, target, {
    recursive: true,
    filter: (src) => !SKILL_COPY_BLOCKLIST.has(src.split(/[\\/]/).pop() ?? ''),
  })
}

/**
 * 粗粒度内容相等判断：用于识别“重复合并同一份未变化的源配置”场景，避免幂等重跑时产生无意义的假冲突。
 *
 * 背景：migrateMcpToGlobal 每次运行都以当前全局配置作为 merged 的初始值。若 saveGlobalMcpConfig
 * 成功但 writeState 未能将 'mcp' 步骤标记为完成（磁盘写入失败/进程被杀等窗口），下次启动会
 * 重跑本步骤，此时工作区源文件尚未被改名（mcp-rename 是后续独立步骤），内容与上一轮完全相同，
 * 不应被当作真实冲突再次生成 xxx@xxx 后缀项。同一份未修改的磁盘 JSON 文件两次 parse 字段顺序稳定，
 * JSON.stringify 比较足够识别这种重跑场景（不追求通用深度相等，只针对这个窄义场景）。
 */
function isSameServerEntry(a: WorkspaceMcpConfig['servers'][string], b: WorkspaceMcpConfig['servers'][string]): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

// ===== 1. MCP 合并 =====

/**
 * 查找默认工作区（slug === 'default'）。
 * 如果不存在，退化为使用最后创建的工作区（按 createdAt 排序末尾）。
 */
function findDefaultWorkspace(workspaces: { slug: string; createdAt: number }[]): { slug: string; createdAt: number } | null {
  const defaultWs = workspaces.find((ws) => ws.slug === 'default')
  if (defaultWs) return defaultWs
  // 兜底：按 createdAt 升序取最早的
  return [...workspaces].sort((a, b) => a.createdAt - b.createdAt)[0] ?? null
}

/** 步骤 1：合并所有工作区与嵌套 Project 的 MCP 配置到全局 */
function migrateMcpToGlobal(): string[] {
  const warnings: string[] = []
  const workspaces = listAgentWorkspaces()
  if (workspaces.length === 0) return warnings

  // 默认工作区 = slug === 'default'，其配置作为同名冲突时的保留版本
  // 兜底：如果不存在则用最早创建的工作区
  const defaultWorkspace = findDefaultWorkspace(workspaces)
  if (!defaultWorkspace) {
    warnings.push('未找到默认工作区，跳过 MCP 迁移')
    return warnings
  }
  const merged: WorkspaceMcpConfig['servers'] = { ...getGlobalMcpConfig().servers }

  // 非默认工作区按 createdAt 升序（最早创建优先）确定性遍历：同名冲突时“谁保留原名”不再取决于
  // listAgentWorkspaces 的任意返回顺序，跨用户/跨重跑结果可复现。
  const nonDefaultWorkspaces = workspaces
    .filter((ws) => ws.slug !== defaultWorkspace.slug)
    .sort((a, b) => a.createdAt - b.createdAt)

  // 先合并非默认工作区：同名且内容不同才算真冲突（加后缀保留，不覆盖任何已有配置）；
  // 内容相同则視为重跑同一份数据，静默跳过
  for (const workspace of nonDefaultWorkspaces) {
    const workspaceMcpPath = getWorkspaceMcpPath(workspace.slug)
    if (!existsSync(workspaceMcpPath)) continue

    backupFile(workspaceMcpPath, `workspace-${workspace.slug}-mcp.json`)
    const config = getWorkspaceMcpConfig(workspace.slug)
    const servers = config.servers ?? {}
    if (Object.keys(servers).length === 0) continue

    for (const [name, entry] of Object.entries(servers)) {
      if (name in merged && !isSameServerEntry(merged[name]!, entry)) {
        const suffixedName = `${name}@${workspace.slug}`
        merged[suffixedName] = entry
        warnings.push(`MCP 服务器 "${name}"（工作区 ${workspace.slug}）与既有配置同名，已以 "${suffixedName}" 保留`)
      } else {
        merged[name] = entry
      }
    }
  }

  // 最后处理默认工作区：占用原名，被覆盖的旧配置加后缀保留（不丢数据）
  {
    const workspaceMcpPath = getWorkspaceMcpPath(defaultWorkspace.slug)
    if (existsSync(workspaceMcpPath)) {
      backupFile(workspaceMcpPath, `workspace-${defaultWorkspace.slug}-mcp.json`)
      const config = getWorkspaceMcpConfig(defaultWorkspace.slug)
      const servers = config.servers ?? {}
      for (const [name, entry] of Object.entries(servers)) {
        if (name in merged && !isSameServerEntry(merged[name]!, entry)) {
          const overridden = merged[name]!
          merged[`${name}@default-overridden`] = overridden
          warnings.push(`MCP 服务器 "${name}" 被默认工作区覆盖，旧配置已以 "${name}@default-overridden" 保留`)
        }
        merged[name] = entry
      }
    }
  }

  // 嵌套 Project 的 .context/mcp.json：工作区遍历顺序同样改为确定性排序，保持与上面一致
  for (const workspace of [...workspaces].sort((a, b) => a.createdAt - b.createdAt)) {
    const workspaceRoot = join(getAgentWorkspacesDir(), workspace.slug)
    const scannedProjectSlugs = new Set<string>()

    try {
      const projects = projectRepository.listProjectsAtRoot(workspaceRoot)
      for (const project of projects) {
        scannedProjectSlugs.add(project.config.slug)
        const projectMcpPath = getProjectMcpConfigPath(workspaceRoot, project.config.slug)
        if (!existsSync(projectMcpPath)) continue
        backupFile(projectMcpPath, `project-${workspace.slug}-${project.config.slug}-mcp.json`)
        const raw = readProjectMcpConfigRaw(workspaceRoot, project.config.slug)
        const normalized = normalizeWorkspaceMcpConfig(raw as Partial<WorkspaceMcpConfig>)
        for (const [name, entry] of Object.entries(normalized.servers ?? {})) {
          if (name in merged && !isSameServerEntry(merged[name]!, entry)) {
            const suffixedName = `${name}@project-${project.config.slug}`
            merged[suffixedName] = entry
            warnings.push(`MCP 服务器 "${name}"（项目 ${project.config.slug}）与既有配置同名，已以 "${suffixedName}" 保留`)
          } else {
            merged[name] = entry
          }
        }
      }
    } catch (error) {
      console.warn(`[迁移] 扫描工作区 ${workspace.slug} 的嵌套项目 MCP 失败:`, error)
    }

    // 兜底：直接扫描工作区根目录下所有 .context/mcp.json 文件，
    // 捕获 projectRepository 未发现的嵌套项目
    try {
      const entries = readdirSync(workspaceRoot, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue
        const contextMcpPath = join(workspaceRoot, entry.name, '.context', 'mcp.json')
        if (!existsSync(contextMcpPath)) continue
        // 跳过已扫描过的项目
        if (scannedProjectSlugs.has(entry.name)) continue
        backupFile(contextMcpPath, `project-extra-${workspace.slug}-${entry.name}-mcp.json`)
        try {
          const rawContent = readFileSync(contextMcpPath, 'utf-8')
          const raw = JSON.parse(rawContent) as Partial<WorkspaceMcpConfig>
          const normalized = normalizeWorkspaceMcpConfig(raw)
          for (const [name, serverEntry] of Object.entries(normalized.servers ?? {})) {
            if (name in merged && !isSameServerEntry(merged[name]!, serverEntry)) {
              const suffixedName = `${name}@project-extra-${entry.name}`
              merged[suffixedName] = serverEntry
              warnings.push(`MCP 服务器 "${name}"（额外扫描项目 ${entry.name}）与既有配置同名，已以 "${suffixedName}" 保留`)
            } else {
              merged[name] = serverEntry
            }
          }
        } catch (parseError) {
          warnings.push(`解析额外项目 MCP 失败 ${workspace.slug}/${entry.name}: ${parseError}`)
        }
      }
    } catch {
      // 忽略扫描错误
    }
  }

  saveGlobalMcpConfig({ servers: merged })
  if (warnings.length > 0) {
    console.warn('[迁移] MCP 合并告警:\n' + warnings.map((w) => `  - ${w}`).join('\n'))
  }
  return warnings
}

// ===== 2. Skills：default-skills → global-skills + 工作区预制 skill 上浮 =====

/** 步骤 2a：把 ~/.myyoda/default-skills/ 复制到 global-skills/（已存在不覆盖，全局优先） */
async function migrateDefaultSkillsToGlobal(): Promise<string[]> {
  const warnings: string[] = []
  const sourceDir = getDefaultSkillsDir()
  const targetDir = getGlobalSkillsDir()
  if (!existsSync(sourceDir)) return warnings

  try {
    for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const source = join(sourceDir, entry.name)
      const target = join(targetDir, entry.name)
      if (existsSync(target)) continue
      try {
        await copySkillDir(source, target)
      } catch (error) {
        warnings.push(`复制预制 skill ${entry.name} 到全局失败: ${error instanceof Error ? error.message : error}`)
      }
    }
  } catch (error) {
    warnings.push(`读取 default-skills 失败: ${error instanceof Error ? error.message : error}`)
  }
  return warnings
}

/** 步骤 2b：存量工作区中属于预制白名单的 skill 复制上浮到全局（副本随后由 2c 清理） */
async function liftWorkspaceDefaultSkillsToGlobal(): Promise<string[]> {
  const warnings: string[] = []
  const defaultSlugs = new Set(getDefaultSkillSlugs())
  if (defaultSlugs.size === 0) return warnings

  const globalEnabled = getEnabledGlobalSkillSlugs()
  const targetDir = getGlobalSkillsDir()

  for (const workspace of listAgentWorkspaces()) {
    const workspaceSkillsDir = getWorkspaceSkillsDir(workspace.slug)
    if (!existsSync(workspaceSkillsDir)) continue
    try {
      for (const entry of readdirSync(workspaceSkillsDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || !defaultSlugs.has(entry.name)) continue
        if (globalEnabled.has(entry.name)) continue // 全局已有，跳过
        const source = join(workspaceSkillsDir, entry.name)
        const target = join(targetDir, entry.name)
        if (existsSync(target)) continue
        try {
          await copySkillDir(source, target)
          console.log(`[迁移] 预制 skill 上浮到全局: ${entry.name}（工作区 ${workspace.slug}）`)
        } catch (error) {
          warnings.push(`上浮预制 skill ${entry.name}（${workspace.slug}）失败: ${error instanceof Error ? error.message : error}`)
        }
      }
    } catch (error) {
      console.warn(`[迁移] 扫描工作区 ${workspace.slug} skills 失败:`, error)
    }
  }
  return warnings
}

/**
 * 粗略判断两个 Skill 目录内容是否一致（仅比较 SKILL.md 文本）。
 * 仅用于避免把用户自建的同名 Skill（例如用户自己也写了一个叫 code-review 的 skill）误判为
 * “从 default-skills 复制的冗余副本”而被清理——只按目录名（slug）匹配不能区分这两种情况。
 */
function isSameSkillContent(dirA: string, dirB: string): boolean {
  try {
    const a = readFileSync(join(dirA, 'SKILL.md'), 'utf-8')
    const b = readFileSync(join(dirB, 'SKILL.md'), 'utf-8')
    return a === b
  } catch {
    return false
  }
}

/** 步骤 2c：清理存量工作区中的预制 skill 副本（含已退役内置，移入备份目录，不再参与运行时/UI，可回滚） */
function cleanupWorkspaceDefaultSkillCopies(): string[] {
  const warnings: string[] = []
  // 清理白名单 = 当前预制（default-skills 快照）+ 历史退役内置（避免旧副本继续残留）
  const cleanupSlugs = new Set([...getDefaultSkillSlugs(), ...RETIRED_DEFAULT_SKILL_SLUGS])
  if (cleanupSlugs.size === 0) return warnings

  const backupRoot = join(getGlobalScopeMigrationBackupDir(), 'workspace-skills')
  // 同时清理：在工作区存在但全局也已有的同名预制 skill（说明是从 default-skills 复制的冗余副本）
  const globalSkillSlugs = getEnabledGlobalSkillSlugs()
  const globalSkillsDir = getGlobalSkillsDir()

  for (const workspace of listAgentWorkspaces()) {
    const workspaceSkillsDir = getWorkspaceSkillsDir(workspace.slug)
    if (!existsSync(workspaceSkillsDir)) continue
    for (const dir of [workspaceSkillsDir, getInactiveSkillsDir(workspace.slug)]) {
      if (!existsSync(dir)) continue
      try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue
          // 清理条件：① 属于预制/退役白名单（官方名单，无需内容校验）；
          // ② 同名且内容与全局相同（真冗余副本）——仅按目录名匹配会误删用户自建的同名 Skill，必须加内容校验。
          const isRedundantGlobalCopy = globalSkillSlugs.has(entry.name)
            && isSameSkillContent(join(dir, entry.name), join(globalSkillsDir, entry.name))
          const shouldCleanup = cleanupSlugs.has(entry.name) || isRedundantGlobalCopy
          if (!shouldCleanup) continue

          const source = join(dir, entry.name)
          const targetBackupDir = join(backupRoot, workspace.slug, basename(dir), entry.name)
          try {
            mkdirSync(join(backupRoot, workspace.slug, basename(dir)), { recursive: true })
            if (existsSync(targetBackupDir)) {
              renameSync(source, join(targetBackupDir, `dup-${Date.now()}`))
            } else {
              renameSync(source, targetBackupDir)
            }
            const reason = cleanupSlugs.has(entry.name) ? '预制技能' : '全局已有内容相同的冗余副本'
            console.log(`[迁移] 已清理工作区 ${reason}: ${workspace.slug}/${entry.name} → 备份目录`)
          } catch (error) {
            warnings.push(`清理工作区预制 skill 副本 ${entry.name}（${workspace.slug}）失败: ${error instanceof Error ? error.message : error}`)
          }
        }
      } catch (error) {
        console.warn(`[迁移] 扫描工作区 ${workspace.slug} 副本目录失败:`, error)
      }
    }
  }
  return warnings
}

/** 步骤 1b：将已合并到全局的存量 MCP 源文件改名（.migrated），避免旧文件继续参与运行时覆盖 */
function renameMigratedMcpSources(): string[] {
  const warnings: string[] = []
  const workspaces = listAgentWorkspaces()

  const renameIfExists = (sourcePath: string, label: string): void => {
    if (!existsSync(sourcePath)) return
    try {
      renameSync(sourcePath, `${sourcePath}.migrated`)
      console.log(`[迁移] 已改名存量 MCP 源文件: ${label} → .migrated`)
    } catch (error) {
      warnings.push(`改名 MCP 源文件失败（${label}）: ${error instanceof Error ? error.message : error}`)
    }
  }

  for (const workspace of workspaces) {
    renameIfExists(getWorkspaceMcpPath(workspace.slug), `工作区 ${workspace.slug}`)
    const workspaceRoot = join(getAgentWorkspacesDir(), workspace.slug)
    try {
      const projects = projectRepository.listProjectsAtRoot(workspaceRoot)
      for (const project of projects) {
        renameIfExists(getProjectMcpConfigPath(workspaceRoot, project.config.slug), `项目 ${workspace.slug}/${project.config.slug}`)
      }
    } catch (error) {
      console.warn(`[迁移] 扫描工作区 ${workspace.slug} 的嵌套项目 MCP 失败:`, error)
    }
  }
  return warnings
}

// ===== 入口 =====
export async function migrateGlobalScopes(): Promise<string[]> {
  const state = readState()
  if (isMigrationComplete(state)) {
    return [] // 已完成
  }

  const warnings: string[] = []

  // 首次迁移时备份全局现有配置
  if (state.completedSteps.length === 0) {
    backupFile(getGlobalMcpPath(), 'global-mcp.json')
  }

  if (!state.completedSteps.includes('mcp')) {
    warnings.push(...migrateMcpToGlobal())
    state.completedSteps.push('mcp')
    writeState(state)
  }

  if (!state.completedSteps.includes('skills-default')) {
    warnings.push(...await migrateDefaultSkillsToGlobal())
    state.completedSteps.push('skills-default')
    writeState(state)
  }

  if (!state.completedSteps.includes('skills-lift')) {
    warnings.push(...await liftWorkspaceDefaultSkillsToGlobal())
    state.completedSteps.push('skills-lift')
    writeState(state)
  }

  // v2 新增：清理工作区预制 skill 副本（避免遮蔽/重复项）
  if (!state.completedSteps.includes('skills-cleanup')) {
    warnings.push(...cleanupWorkspaceDefaultSkillCopies())
    state.completedSteps.push('skills-cleanup')
    writeState(state)
  }

  // v2 新增：改名已合并的存量 MCP 源文件（避免旧文件继续参与运行时覆盖）。
  // 仅当本次全部改名成功才标记完成；否则下次启动重试，防止工作区 mcp.json 残留
  // 持续触发迁移提示。运行时只读全局 MCP，不会加载该遗留文件。
  if (!state.completedSteps.includes('mcp-rename')) {
    const renameWarnings = renameMigratedMcpSources()
    warnings.push(...renameWarnings)
    if (renameWarnings.length === 0) {
      state.completedSteps.push('mcp-rename')
      writeState(state)
    }
  }

  if (REQUIRED_MIGRATION_STEPS.every((step) => state.completedSteps.includes(step))) {
    state.version = MIGRATION_VERSION
    state.migratedAt = new Date().toISOString()
  }
  writeState(state)

  if (warnings.length > 0) {
    console.warn('[迁移] 全局作用域迁移完成，存在告警:\n' + warnings.map((w) => `  - ${w}`).join('\n'))
  } else {
    console.log('[迁移] 全局作用域迁移完成（MCP 全局化 / 全局 Skills）')
  }
  return warnings
}

/** 给插件页的迁移后续提示：遗留 MCP、冲突后缀 */
export function getGlobalScopeReviewHints(): GlobalScopeReviewHints {
  const leftoverWorkspaceMcp: string[] = []
  for (const workspace of listAgentWorkspaces()) {
    if (existsSync(getWorkspaceMcpPath(workspace.slug))) {
      leftoverWorkspaceMcp.push(workspace.slug)
    }
  }

  const mcpSuffixedServers = Object.keys(getGlobalMcpConfig().servers ?? {}).filter((name) => name.includes('@'))

  return { leftoverWorkspaceMcp, mcpSuffixedServers }
}
