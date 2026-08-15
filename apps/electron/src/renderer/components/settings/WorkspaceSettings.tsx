/**
 * WorkspaceSettings — 设置页「工作区」管理（高级选项）
 *
 * 按调研建议「保留 workspace 数据模型与 default，但从主 UI 收起切换器」，
 * 多工作区降级为设置页高级选项：列表 / 新建 / 切换 / 重命名 / 删除。
 * 默认单工作区（`default` 不可删），大部分用户无需进入此页。
 */

import * as React from 'react'
import { useSetAtom } from 'jotai'
import { Layers, Plus, Pencil, Trash2, Check, ChevronRight, FolderOpen, RefreshCw, AlertTriangle, ArrowRightLeft } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  agentWorkspacesAtom,
  currentAgentWorkspaceIdAtom,
  agentSessionsAtom,
} from '@/atoms/agent-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import type { AgentWorkspace, LocalProjectRootStatus } from '@myyoda/shared'
import { SettingsSection, SettingsCard } from './primitives'
import { useWorkspaceActions } from '@/hooks/useWorkspaceActions'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { WorkingDirectoryField } from '@/components/app-shell/kanban/WorkingDirectoryField'
import { WORKSPACE_TERMS } from '@/lib/workspace-project-terminology'

/** 本地项目根状态的中文提示 */
const PROJECT_ROOT_STATUS_LABEL: Record<LocalProjectRootStatus, string> = {
  available: '本地项目',
  missing: '目录缺失',
  not_directory: '不是文件夹',
  unavailable: '不可访问',
}

export function WorkspaceSettings(): React.ReactElement {
  const {
    workspaces,
    currentWorkspaceId,
    selectWorkspace,
    createWorkspace,
    createWorkspaceFromFolder,
    relinkWorkspaceProjectRoot,
    restoreWorkspaceProjectRoot,
  } = useWorkspaceActions()
  const setWorkspaces = useSetAtom(agentWorkspacesAtom)
  const setCurrentWorkspaceId = useSetAtom(currentAgentWorkspaceIdAtom)
  const setAgentSessions = useSetAtom(agentSessionsAtom)
  const setActiveView = useSetAtom(activeViewAtom)

  const [newName, setNewName] = React.useState('')
  const [creating, setCreating] = React.useState(false)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [editingName, setEditingName] = React.useState('')
  const [renameBusy, setRenameBusy] = React.useState(false)
  const [deleteTarget, setDeleteTarget] = React.useState<AgentWorkspace | null>(null)
  const [deleting, setDeleting] = React.useState(false)

  // 默认工作区目录（应用设置；未绑定项目的新会话回退使用）
  const [defaultWorkingDirectory, setDefaultWorkingDirectory] = React.useState('')
  const [savingDefaultWorkingDirectory, setSavingDefaultWorkingDirectory] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    void window.electronAPI.getAgentDefaultWorkingDirectory()
      .then((path) => { if (!cancelled) setDefaultWorkingDirectory(path ?? '') })
      .catch(() => { if (!cancelled) setDefaultWorkingDirectory('') })
    return () => { cancelled = true }
  }, [])

  const handleDefaultWorkingDirectoryChange = React.useCallback(async (path: string): Promise<void> => {
    setDefaultWorkingDirectory(path)
    setSavingDefaultWorkingDirectory(true)
    try {
      await window.electronAPI.setAgentDefaultWorkingDirectory(path || undefined)
    } catch (err) {
      console.error('[Workspace Settings] 保存默认工作区目录失败:', err)
      toast.error(err instanceof Error ? err.message : '保存默认工作区目录失败')
    } finally {
      setSavingDefaultWorkingDirectory(false)
    }
  }, [])

  // 项目 → 工作区迁移（阶段二，手动触发）
  const [migrationStatus, setMigrationStatus] = React.useState<{ done: boolean; pendingCount: number } | null>(null)
  const [migrationBusy, setMigrationBusy] = React.useState(false)
  const [migrationResult, setMigrationResult] = React.useState<string | null>(null)
  const [migrationConfirm, setMigrationConfirm] = React.useState(false)

  React.useEffect(() => {
    if (!currentWorkspaceId) return
    window.electronAPI.getProjectToWorkspaceMigrationStatus(currentWorkspaceId)
      .then(setMigrationStatus)
      .catch(() => setMigrationStatus(null))
  }, [currentWorkspaceId])

  const handleRunMigration = async (): Promise<void> => {
    if (!currentWorkspaceId || migrationBusy) return
    setMigrationBusy(true)
    setMigrationResult(null)
    try {
      const result = await window.electronAPI.runProjectToWorkspaceMigration(currentWorkspaceId)
      setMigrationResult(
        result.alreadyDone
          ? '该项目已迁移完成（幂等跳过）。'
          : `迁移完成：${result.migrated.length} 个项目成为独立工作区；${result.migrated.reduce((sum, m) => sum + m.migratedSessions, 0)} 个会话、${result.migrated.reduce((sum, m) => sum + m.migratedTasks, 0)} 个任务已重绑定；${result.migratedAutomationCount} 个定时任务已重绑定。备份位于：${result.backupPath || '（无）'}`,
      )
      setMigrationConfirm(false)
      setMigrationStatus({ done: true, pendingCount: 0 })
      // 刷新工作区列表（新工作区由 useWorkspaceActions 之外创建，直接重读）
      const workspaces = await window.electronAPI.listAgentWorkspaces()
      setWorkspaces(workspaces)
      if (result.migrated.length > 0) {
        toast.success(`已迁移 ${result.migrated.length} 个项目为独立工作区`)
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : '迁移失败'
      toast.error(`迁移失败：${msg}`)
      setMigrationResult(null)
    } finally {
      setMigrationBusy(false)
    }
  }

  const defaultSlug = 'default'

  const canDelete = React.useCallback(
    (workspace: AgentWorkspace): boolean =>
      workspace.slug !== defaultSlug && workspaces.length > 1,
    [workspaces.length],
  )

  /** 新建工作区（复用 useWorkspaceActions.createWorkspace，自动切换） */
  const handleCreate = async (): Promise<void> => {
    if (creating) return
    setCreating(true)
    try {
      await createWorkspace(newName)
      setNewName('')
    } finally {
      setCreating(false)
    }
  }

  /** 从本地文件夹创建项目（工作区）：对齐 Proma「从本地文件夹创建项目」 */
  const handleCreateFromFolder = async (): Promise<void> => {
    const result = await window.electronAPI.openFolderDialog()
    if (result?.path) {
      const workspace = await createWorkspaceFromFolder(result.path)
      if (workspace) setNewName('')
    }
  }

  /** 重新关联工作区本地项目根目录 */
  const handleRelink = async (workspace: AgentWorkspace): Promise<void> => {
    const result = await window.electronAPI.openFolderDialog()
    if (result?.path) {
      const updated = await relinkWorkspaceProjectRoot(workspace.id, result.path)
      if (updated) toast.success(`已重新关联「${updated.name}」的本地项目目录`)
    }
  }

  /** 在缺失的原路径恢复空项目根目录 */
  const handleRestoreRoot = async (workspace: AgentWorkspace): Promise<void> => {
    const updated = await restoreWorkspaceProjectRoot(workspace.id)
    if (updated) toast.success(`已在原路径恢复空项目目录: ${updated.projectRootPath}`)
  }

  /** 重命名工作区 */
  const handleRename = async (workspace: AgentWorkspace): Promise<void> => {
    const trimmed = editingName.trim()
    if (!trimmed || trimmed === workspace.name || renameBusy) {
      setEditingId(null)
      return
    }
    setRenameBusy(true)
    try {
      await window.electronAPI.updateAgentWorkspace(workspace.id, { name: trimmed })
      setWorkspaces((prev) => prev.map((w) => (w.id === workspace.id ? { ...w, name: trimmed } : w)))
      toast.success('工作区已重命名')
      setEditingId(null)
    } catch (error) {
      const msg = error instanceof Error ? error.message : '重命名失败'
      toast.error(msg)
    } finally {
      setRenameBusy(false)
    }
  }

  /** 删除工作区（确认后删除并清理会话引用） */
  const handleDelete = async (): Promise<void> => {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    try {
      await window.electronAPI.deleteAgentWorkspace(deleteTarget.id)
      setWorkspaces((prev) => prev.filter((w) => w.id !== deleteTarget.id))
      setAgentSessions((prev) => prev.filter((s) => s.workspaceId !== deleteTarget.id))
      if (currentWorkspaceId === deleteTarget.id) {
        const fallback = workspaces.find((w) => w.id !== deleteTarget.id)
        if (fallback) {
          setCurrentWorkspaceId(fallback.id)
          window.electronAPI.updateSettings({ agentWorkspaceId: fallback.id }).catch(console.error)
        }
      }
      setActiveView('conversations')
      toast.success(`已删除工作区「${deleteTarget.name}」`)
      setDeleteTarget(null)
    } catch (error) {
      const msg = error instanceof Error ? error.message : '删除失败'
      toast.error(msg)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-8">
      <SettingsSection
        title={WORKSPACE_TERMS.management}
        description="工作区是会话、Skills、MCP、工作区记忆、工作区文件与项目的隔离边界。大多数用户只需默认工作区；需要区分工作、私人或不同客户环境时，可在此创建并切换。"
      >
        <SettingsCard>
          {workspaces.map((workspace) => {
            const isCurrent = workspace.id === currentWorkspaceId
            const deletable = canDelete(workspace)
            const editing = editingId === workspace.id
            return (
              <div
                key={workspace.id}
                className={cn(
                  'flex items-center gap-3 px-4 py-3',
                  editing && 'bg-foreground/[0.03]',
                )}
              >
                <Layers size={16} className="shrink-0 text-foreground/45" />
                <div className="min-w-0 flex-1">
                  {editing ? (
                    <Input
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleRename(workspace)
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      autoFocus
                      className="h-7 max-w-[280px] text-[13px]"
                      maxLength={50}
                    />
                  ) : (
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-foreground/85">{workspace.name}</span>
                      {isCurrent && (
                        <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                          当前
                        </span>
                      )}
                      {workspace.slug === defaultSlug && (
                        <span className="shrink-0 rounded-full bg-foreground/[0.05] px-2 py-0.5 text-[10px] text-foreground/45">
                          默认
                        </span>
                      )}
                    </div>
                  )}
                  <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-foreground/40">
                    {editing ? '回车保存，Esc 取消' : `slug: ${workspace.slug}${isCurrent ? ' · 当前使用中' : ''}`}
                    {!editing && workspace.projectRootPath && (
                      <>
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-medium',
                            workspace.projectRootStatus === 'available'
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                              : 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
                          )}
                          title={workspace.projectRootPath}
                        >
                          {workspace.projectRootStatus !== 'available' && <AlertTriangle size={9} />}
                          {PROJECT_ROOT_STATUS_LABEL[workspace.projectRootStatus ?? 'available']}
                        </span>
                        <span className="max-w-[220px] truncate" title={workspace.projectRootPath}>
                          {workspace.projectRootPath}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {editing ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void handleRename(workspace)}
                        disabled={renameBusy}
                        className="flex size-7 items-center justify-center rounded-md text-foreground/55 transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-40"
                        aria-label="保存重命名"
                      >
                        <Check size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="flex size-7 items-center justify-center rounded-md text-foreground/45 transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
                        aria-label="取消重命名"
                      >
                        <ChevronRight size={15} className="rotate-90" />
                      </button>
                    </>
                  ) : (
                    <>
                      {!isCurrent && (
                        <button
                          type="button"
                          onClick={() => selectWorkspace(workspace.id)}
                          className="rounded-md px-2 py-1 text-[12px] font-medium text-primary transition-colors hover:bg-primary/10"
                        >
                          切换
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => { setEditingId(workspace.id); setEditingName(workspace.name) }}
                        className="flex size-7 items-center justify-center rounded-md text-foreground/45 transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
                        aria-label={`重命名「${workspace.name}」`}
                      >
                        <Pencil size={14} />
                      </button>
                      {/* 本地项目根操作：重新关联目录 / 缺失时恢复空目录 */}
                      {workspace.projectRootPath ? (
                        workspace.projectRootStatus === 'missing' ? (
                          <button
                            type="button"
                            onClick={() => void handleRestoreRoot(workspace)}
                            className="flex size-7 items-center justify-center rounded-md text-foreground/45 transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
                            title={`恢复缺失的项目目录: ${workspace.projectRootPath}`}
                            aria-label={`恢复「${workspace.name}」的项目目录`}
                          >
                            <RefreshCw size={14} />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void handleRelink(workspace)}
                            className="flex size-7 items-center justify-center rounded-md text-foreground/45 transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
                            title="重新关联本地项目目录"
                            aria-label={`重新关联「${workspace.name}」的本地项目目录`}
                          >
                            <FolderOpen size={14} />
                          </button>
                        )
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handleRelink(workspace)}
                          className="flex size-7 items-center justify-center rounded-md text-foreground/45 transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
                          title="关联本地项目目录（从本地文件夹创建项目）"
                          aria-label={`关联「${workspace.name}」的本地项目目录`}
                        >
                          <FolderOpen size={14} />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => deletable && setDeleteTarget(workspace)}
                        disabled={!deletable}
                        className={cn(
                          'flex size-7 items-center justify-center rounded-md transition-colors',
                          deletable
                            ? 'text-foreground/45 hover:bg-destructive/10 hover:text-destructive'
                            : 'cursor-not-allowed text-foreground/20',
                        )}
                        aria-label={deletable ? `删除工作区「${workspace.name}」` : '默认工作区不可删除'}
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </SettingsCard>

        <div className="flex items-center gap-2 pt-1">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate() }}
            placeholder="新工作区名称…"
            className="h-8 max-w-[280px] text-[13px]"
            maxLength={50}
          />
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={creating || !newName.trim()}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={14} />
            <span>{creating ? '创建中…' : WORKSPACE_TERMS.create}</span>
          </button>
          <button
            type="button"
            onClick={() => void handleCreateFromFolder()}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-border/70 px-3 text-[13px] font-medium text-foreground/70 transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
          >
            <FolderOpen size={14} />
            <span>从本地文件夹创建项目</span>
          </button>
        </div>
      </SettingsSection>

      {/* 默认工作区目录：应用设置，未绑定项目的会话 / Workspace Task 回退使用 */}
      <SettingsSection
        title="默认工作区目录"
        description="未绑定项目的会话 / Workspace Task 回退使用的工程代码目录；未设置时使用默认工作区。"
      >
        <SettingsCard>
          <div className="flex flex-wrap items-center gap-2 px-4 py-3">
            <div className="min-w-0 max-w-md flex-1">
              <WorkingDirectoryField
                value={defaultWorkingDirectory}
                onChange={(path) => { void handleDefaultWorkingDirectoryChange(path) }}
                className={savingDefaultWorkingDirectory ? 'opacity-60' : undefined}
              />
            </div>
          </div>
          <div className="px-4 pb-3 text-xs text-muted-foreground">
            设置后，新会话未选择或新建项目时，Agent 会把该目录作为工程代码目录的基准（不改变会话隔离目录本身）；清空后回到默认工作区。
          </div>
        </SettingsCard>
      </SettingsSection>

      {/* 项目 → 工作区迁移（阶段二：对齐 Proma「工作区=项目」，手动触发） */}
      {migrationStatus && !migrationStatus.done && migrationStatus.pendingCount > 0 && (
        <SettingsSection
          title="迁移：项目 → 独立工作区"
          description={`当前工作区下还有 ${migrationStatus.pendingCount} 个带工作目录的项目。迁移后每个项目成为独立工作区（绑定原工程目录），会话/任务/定时任务自动重绑定；迁移前会完整备份，可整目录回滚。`}
        >
          <SettingsCard>
            <div className="flex items-center gap-3 px-4 py-3">
              <ArrowRightLeft size={16} className="shrink-0 text-foreground/45" />
              <div className="min-w-0 flex-1 text-[13px] text-foreground/70">
                {migrationResult ?? '项目即工作区：每个项目独立成区，AGENTS.md 就是工程工作区的记忆。'}
              </div>
              {!migrationConfirm ? (
                <button
                  type="button"
                  onClick={() => setMigrationConfirm(true)}
                  disabled={migrationBusy}
                  className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  <ArrowRightLeft size={14} />
                  <span>开始迁移</span>
                </button>
              ) : (
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-[12px] text-destructive">将创建多个工作区，确认？</span>
                  <button
                    type="button"
                    onClick={() => void handleRunMigration()}
                    disabled={migrationBusy}
                    className="flex h-8 items-center gap-1 rounded-lg bg-destructive px-3 text-[13px] font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
                  >
                    {migrationBusy ? '迁移中…' : '确认迁移'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMigrationConfirm(false)}
                    className="h-8 rounded-lg px-2 text-[13px] text-foreground/50 transition-colors hover:bg-foreground/[0.05]"
                  >
                    取消
                  </button>
                </div>
              )}
            </div>
          </SettingsCard>
        </SettingsSection>
      )}

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除工作区「{deleteTarget?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除 MyYoda 托管的工作区数据、会话、自动任务与渠道绑定，且无法恢复；项目绑定的外部工作目录不会被删除。Todo 与日程记录不会被删除，但之后可能需要重新归类。确定要继续吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => { e.preventDefault(); void handleDelete() }}
            >
              {deleting ? '删除中…' : '删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
