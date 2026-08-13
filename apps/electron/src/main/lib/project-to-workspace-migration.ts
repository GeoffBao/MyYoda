/**
 * project-to-workspace-migration — 项目 → 工作区迁移服务（阶段二，手动触发）
 *
 * 对齐 Proma「工作区 = 项目」：把默认工作区下 projects/{slug}/ 托管项目迁移为
 * 独立 AgentWorkspace（projectRootPath = 项目 workingDirectory），并把会话 /
 * 任务 / automation 从 projectId 语义重绑定到 workspaceId。
 *
 * 设计约束：
 * - 手动触发（设置页按钮），不做启动自动迁移，避免意外改动用户数据；
 * - 执行前完整备份 workspace 目录到 ~/.myyoda/backups/（带时间戳），可整目录回滚；
 * - migration marker（~/.myyoda/.project-workspace-migration.json）保证幂等；
 * - 无 workingDirectory / 不可访问 / home / ad-hoc / 占位项目（project-*）跳过，
 *   数据留在默认工作区；
 * - 原 projects/{slug}/ 目录在成功后移入 recovery-trash（30 天可恢复）。
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { getConfigDir, getAgentWorkspacePath, getWorkspaceMcpPath, getWorkspaceSkillsDir, getInactiveSkillsDir, getWorkspaceFilesDir } from './config-paths'
import { getAgentWorkspace, createAgentWorkspace, listAgentWorkspaces, updateAgentWorkspace } from './agent-workspace-manager'
import { projectRepository } from './project-repository'
import { listAgentSessions, moveSessionToWorkspace, updateAgentSessionMeta } from './agent-session-manager'
import { listAutomations, updateAutomation } from './automation-manager'
import { quarantineForRecovery } from './recovery-trash-service'
import type { Automation } from '@myyoda/shared'
import { getProjectPath, getProjectMemoryPath } from '../../../../../packages/shared/src/projects/storage.ts'

// ===== Marker =====

interface MigrationMarker {
  version: 1
  migratedAt: number
  migratedWorkspaceIds: string[]
}

function getMarkerPath(): string {
  return join(getConfigDir(), '.project-workspace-migration.json')
}

function readMarker(): MigrationMarker | null {
  try {
    if (!existsSync(getMarkerPath())) return null
    return JSON.parse(readFileSync(getMarkerPath(), 'utf-8')) as MigrationMarker
  } catch {
    return null
  }
}

function writeMarker(marker: MigrationMarker): void {
  writeFileSync(getMarkerPath(), JSON.stringify(marker, null, 2), 'utf-8')
}

// ===== 结果类型 =====

export interface ProjectMigrationItem {
  projectId: string
  projectName: string
  workspaceId: string
  workspaceName: string
  migratedSessions: number
  migratedTasks: number
}

export interface ProjectToWorkspaceMigrationResult {
  /** 已迁移项目（成为独立工作区） */
  migrated: ProjectMigrationItem[]
  /** 跳过项目及原因 */
  skipped: Array<{ projectId: string; projectName: string; reason: string }>
  /** 全部重绑定的自动化任务数 */
  migratedAutomationCount: number
  /** 备份目录绝对路径（可整目录回滚） */
  backupPath: string
  /** 是否已由之前运行完成（幂等） */
  alreadyDone: boolean
}

// ===== 查询 =====

/** 检查默认工作区是否仍有待迁移的项目（供设置页展示迁移入口状态） */
export function getProjectToWorkspaceMigrationStatus(workspaceId: string): {
  done: boolean
  pendingCount: number
} {
  const marker = readMarker()
  const workspace = getAgentWorkspace(workspaceId)
  if (!workspace) return { done: true, pendingCount: 0 }

  const workspaceRoot = getAgentWorkspacePath(workspace.slug)
  const projects = projectRepository.listProjectsAtRoot(workspaceRoot)
  const migratable = projects.map(toMigratable).filter((p) => isMigratableProject(p, workspaceRoot))
  const done = marker !== null && marker.migratedWorkspaceIds.includes(workspaceId)
  return { done: done || migratable.length === 0, pendingCount: migratable.length }
}

interface MigratableProject {
  id: string
  slug: string
  name: string
  workingDirectory?: string
  kind?: string
}

function toMigratable(p: { config: MigratableProject }): MigratableProject {
  return p.config
}

/** 可迁移条件：真实项目（非 home/ad-hoc/占位）+ 有可访问的 workingDirectory */
export function isMigratableProject(project: MigratableProject, _workspaceRoot: string): boolean {
  if (project.kind === 'home' || project.kind === 'ad-hoc') return false
  if (!project.workingDirectory) return false
  // 占位项目（无真实目录的测试项目）不迁移
  if (!existsSync(project.workingDirectory)) return false
  try {
    if (!statSync(project.workingDirectory).isDirectory()) return false
  } catch {
    return false
  }
  return true
}

// ===== 迁移执行 =====

/**
 * 执行默认工作区 → 独立工作区迁移。
 * 幂等：已由 marker 记录的工作区不再重复迁移。
 */
export function runProjectToWorkspaceMigration(workspaceId: string): ProjectToWorkspaceMigrationResult {
  const marker = readMarker()
  const workspace = getAgentWorkspace(workspaceId)
  if (!workspace) {
    throw new Error(`工作区不存在: ${workspaceId}`)
  }
  if (marker?.migratedWorkspaceIds.includes(workspaceId)) {
    return {
      migrated: [],
      skipped: [],
      migratedAutomationCount: 0,
      backupPath: '',
      alreadyDone: true,
    }
  }

  const workspaceRoot = getAgentWorkspacePath(workspace.slug)
  if (!existsSync(join(workspaceRoot, 'projects'))) {
    // 没有项目层，直接标记完成（无操作）
    writeMarker({ version: 1, migratedAt: Date.now(), migratedWorkspaceIds: [workspaceId] })
    return { migrated: [], skipped: [], migratedAutomationCount: 0, backupPath: '', alreadyDone: true }
  }

  const projects = projectRepository.listProjectsAtRoot(workspaceRoot)
  const migratable = projects.map(toMigratable).filter((p) => isMigratableProject(p, workspaceRoot))
  const skipped = projects
    .map(toMigratable)
    .filter((p) => !isMigratableProject(p, workspaceRoot))
    .map((p) => ({ projectId: p.id, projectName: p.name, reason: reasonForSkip(p) }))

  // 1. 备份整个 workspace 目录（带时间戳，可整目录回滚）
  const backupRoot = join(getConfigDir(), 'backups')
  mkdirSync(backupRoot, { recursive: true })
  const backupPath = join(backupRoot, `workspace-project-migration-${workspace.slug}-${Date.now()}`)
  cpSync(workspaceRoot, backupPath, { recursive: true, force: true })

  const migrated: ProjectMigrationItem[] = []
  let migratedAutomationCount = 0

  try {
    for (const project of migratable) {
      try {
        const item = migrateOneProject(workspace, workspaceRoot, project)
        migrated.push(item)
      } catch (error) {
        // 单个项目失败（如工作区名称已存在）不中断整体迁移：跳过并记录原因，其余项目继续
        const msg = error instanceof Error ? error.message : '未知错误'
        console.warn(`[项目→工作区迁移] 「${project.name}」迁移失败，已跳过:`, error)
        skipped.push({ projectId: project.id, projectName: project.name, reason: msg })
      }
    }

    // 2. automation 重绑定：projectId === 任一已迁移项目 id → workspaceId 指向新工作区，清 projectId
    migratedAutomationCount = rebindAutomations(migrated)

    // 3. 写 marker
    const allMigratedIds = [...(marker?.migratedWorkspaceIds ?? []), workspaceId]
    writeMarker({ version: 1, migratedAt: Date.now(), migratedWorkspaceIds: allMigratedIds })

    return { migrated, skipped, migratedAutomationCount, backupPath, alreadyDone: false }
  } catch (error) {
    // 失败：保留备份，抛错由调用方提示（不写 marker，可重试）
    console.error('[项目→工作区迁移] 迁移失败，备份保留于:', backupPath, error)
    throw error
  }
}

export function reasonForSkip(project: MigratableProject): string {
  if (project.kind === 'home' || project.kind === 'ad-hoc') return '隐藏容器项目（home/ad-hoc）'
  if (!project.workingDirectory) return '未绑定工作目录'
  if (!existsSync(project.workingDirectory)) return '工作目录不存在'
  return '工作目录不可访问'
}

function migrateOneProject(
  sourceWorkspace: { id: string; slug: string },
  workspaceRoot: string,
  project: MigratableProject,
): ProjectMigrationItem {
  const projectDir = getProjectPath(workspaceRoot, project.slug)

  // 1. 解析目标工作区：同名且绑定同一本地目录的工作区直接复用（用户可能已手动创建过）；
  //    同名但目录不同 → 抛错由调用方跳过（不覆盖已有工作区）。
  const existing = listAgentWorkspaces().find((w) => w.name === project.name)
  let newWorkspace: { id: string; slug: string; name: string }
  if (existing && existing.projectRootPath) {
    const sameRoot = (() => {
      const real = (p: string): string => {
        try {
          return realpathSync(resolve(p))
        } catch {
          return resolve(p)
        }
      }
      return real(existing.projectRootPath!) === real(project.workingDirectory ?? '')
    })()
    if (!sameRoot) {
      throw new Error(`工作区名称「${project.name}」已存在（绑定不同目录），请重命名后重试`)
    }
    newWorkspace = { id: existing.id, slug: existing.slug, name: existing.name }
    console.log(`[项目→工作区迁移] 复用已有工作区「${existing.name}」（目录一致）`)
  } else {
    newWorkspace = createAgentWorkspace({
      name: project.name,
      projectRootPath: project.workingDirectory,
    })
  }
  const newRoot = getAgentWorkspacePath(newWorkspace.slug)

  // 2. 迁移记忆：projects/{slug}/MEMORY.md → 新工作区 memory/MEMORY.md
  const memoryDir = join(newRoot, 'memory')
  const legacyMemoryPath = getProjectMemoryPath(workspaceRoot, project.slug)
  if (existsSync(legacyMemoryPath)) {
    mkdirSync(memoryDir, { recursive: true })
    try {
      renameSync(legacyMemoryPath, join(memoryDir, 'MEMORY.md'))
    } catch {
      // 跨设备等场景回退复制
      cpSync(legacyMemoryPath, join(memoryDir, 'MEMORY.md'), { force: true })
    }
  }

  // 3. 迁移资产：projects/{slug}/assets/ → 新工作区 workspace-files/assets/
  const assetsDir = join(projectDir, 'assets')
  if (existsSync(assetsDir)) {
    const targetAssets = join(getWorkspaceFilesDir(newWorkspace.slug), 'assets')
    mkdirSync(targetAssets, { recursive: true })
    for (const entry of readdirSync(assetsDir)) {
      try {
        renameSync(join(assetsDir, entry), join(targetAssets, entry))
      } catch {
        cpSync(join(assetsDir, entry), join(targetAssets, entry), { recursive: true, force: true })
      }
    }
  }

  // 4. 迁移 Skills / MCP：项目级 → 工作区级（有则合）
  const projectSkillsDir = projectRepository.getProjectSkillsDirPath(workspaceRoot, project.slug)
  if (projectSkillsDir && existsSync(projectSkillsDir)) {
    const targetSkills = getWorkspaceSkillsDir(newWorkspace.slug)
    mkdirSync(targetSkills, { recursive: true })
    for (const entry of readdirSync(projectSkillsDir)) {
      const source = join(projectSkillsDir, entry)
      const target = join(targetSkills, entry)
      if (!existsSync(target)) {
        try {
          renameSync(source, target)
        } catch {
          cpSync(source, target, { recursive: true, force: true })
        }
      }
    }
  }
  const projectInactiveSkillsDir = projectRepository.getProjectInactiveSkillsDirPath(workspaceRoot, project.slug)
  if (projectInactiveSkillsDir && existsSync(projectInactiveSkillsDir)) {
    const targetInactive = getInactiveSkillsDir(newWorkspace.slug)
    mkdirSync(targetInactive, { recursive: true })
    for (const entry of readdirSync(projectInactiveSkillsDir)) {
      const source = join(projectInactiveSkillsDir, entry)
      const target = join(targetInactive, entry)
      if (!existsSync(target)) {
        try {
          renameSync(source, target)
        } catch {
          cpSync(source, target, { recursive: true, force: true })
        }
      }
    }
  }
  const projectMcp = projectRepository.getProjectMcpConfigRaw(workspaceRoot, project.slug)
  if (projectMcp && Object.keys(projectMcp).length > 0) {
    projectRepository.saveProjectMcpConfigRaw(newRoot, project.slug, projectMcp)
  }

  // 4.5 看板列迁移：KanbanProject.kanbanColumns → 工作区配置（自定义列不随项目丢失）
  const projectColumns = projectRepository.getProjectAtRoot(workspaceRoot, project.slug)?.config.kanbanColumns
  if (projectColumns && projectColumns.length > 0 && !(newWorkspace as { kanbanColumns?: unknown }).kanbanColumns) {
    updateAgentWorkspace(newWorkspace.id, { kanbanColumns: projectColumns })
  }

  // 5. 会话重绑定：projectId === 项目 id → 移动到新工作区 + 清除 projectId
  const sessions = listAgentSessions()
  let migratedSessions = 0
  for (const session of sessions) {
    if (session.projectId !== project.id) continue
    try {
      moveSessionToWorkspace(session.id, newWorkspace.id)
      updateAgentSessionMeta(session.id, { projectId: undefined })
      migratedSessions++
    } catch (error) {
      console.warn(`[项目→工作区迁移] 会话 ${session.id} 重绑定失败:`, error)
    }
  }

  // 6. 任务迁移：默认工作区 tasks/{slug}/task.yaml 绑定 project → 移动到新工作区 tasks/ 并清除 project 字段
  const sourceTasksDir = join(workspaceRoot, 'tasks')
  const targetTasksDir = join(newRoot, 'tasks')
  let migratedTasks = 0
  if (existsSync(sourceTasksDir)) {
    for (const taskSlug of readdirSync(sourceTasksDir)) {
      const taskDir = join(sourceTasksDir, taskSlug)
      if (!statSync(taskDir).isDirectory()) continue
      const taskYaml = join(taskDir, 'task.yaml')
      if (!existsSync(taskYaml)) continue
      const content = readFileSync(taskYaml, 'utf-8')
      // task.yaml 里 project 字段即绑定（如 "project: proj_xxx"）
      if (!new RegExp(`^project:\\s*['"]?${escapeRegExp(project.id)}`).test(content)) continue
      mkdirSync(targetTasksDir, { recursive: true })
      try {
        renameSync(taskDir, join(targetTasksDir, taskSlug))
      } catch {
        cpSync(taskDir, join(targetTasksDir, taskSlug), { recursive: true, force: true })
        rmSync(taskDir, { recursive: true, force: true })
      }
      // 清除 task.yaml 的 project 绑定（任务归 workspace）
      const cleaned = content
        .split('\n')
        .filter((line) => !/^project:\s*/.test(line))
        .join('\n')
      writeFileSync(join(targetTasksDir, taskSlug, 'task.yaml'), cleaned, 'utf-8')
      migratedTasks++
    }
  }

  // 7. 原项目目录移入 recovery-trash（30 天可恢复）
  if (existsSync(projectDir)) {
    try {
      quarantineForRecovery(workspaceRoot, projectDir, 'project', project.slug)
    } catch (error) {
      console.warn(`[项目→工作区迁移] 项目目录 ${projectDir} 移入恢复区失败（保留原处）:`, error)
    }
  }

  console.log(`[项目→工作区迁移] 已迁移「${project.name}」→ 工作区「${newWorkspace.name}」（${migratedSessions} 会话 / ${migratedTasks} 任务）`)
  return {
    projectId: project.id,
    projectName: project.name,
    workspaceId: newWorkspace.id,
    workspaceName: newWorkspace.name,
    migratedSessions,
    migratedTasks,
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** automation：projectId === 任一已迁移项目 id → workspaceId 指向新工作区 + 清 projectId */
function rebindAutomations(migrated: ProjectMigrationItem[]): number {
  if (migrated.length === 0) return 0
  const projectIdToWorkspaceId = new Map(migrated.map((m) => [m.projectId, m.workspaceId]))
  let count = 0
  const automations = listAutomations()
  for (const automation of automations) {
    const targetWorkspaceId = automation.projectId ? projectIdToWorkspaceId.get(automation.projectId) : undefined
    if (!targetWorkspaceId) continue
    const patch: Parameters<typeof updateAutomation>[0] = {
      id: automation.id,
      workspaceId: targetWorkspaceId,
      // projectId 允许传空字符串表示「解除项目挂载」
      projectId: '',
    }
    const updated = updateAutomation(patch)
    if (updated) count++
  }
  return count
}

/** 供迁移后在渲染层刷新 workspace/session 列表使用 */
export function getMigrationBackupDir(): string {
  return join(getConfigDir(), 'backups')
}

// 保证本项目文件可被 tree-shake 干净引用（避免未使用告警）
export const _migrationHelpers = { basename, resolve }
