/**
 * WorkspaceSettings — 设置页「工作区」管理（高级选项）
 *
 * 按调研建议「保留 workspace 数据模型与 default，但从主 UI 收起切换器」，
 * 多工作区降级为设置页高级选项：列表 / 新建 / 切换 / 重命名 / 删除。
 * 默认单工作区（`default` 不可删），大部分用户无需进入此页。
 */

import * as React from 'react'
import { useSetAtom } from 'jotai'
import { Layers, Plus, Pencil, Trash2, Check, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  agentWorkspacesAtom,
  currentAgentWorkspaceIdAtom,
  agentSessionsAtom,
} from '@/atoms/agent-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import type { AgentWorkspace } from '@myyoda/shared'
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
import { WORKSPACE_TERMS } from '@/lib/workspace-project-terminology'

export function WorkspaceSettings(): React.ReactElement {
  const { workspaces, currentWorkspaceId, selectWorkspace, createWorkspace } = useWorkspaceActions()
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
                  <div className="mt-0.5 text-[12px] text-foreground/40">
                    {editing ? '回车保存，Esc 取消' : `slug: ${workspace.slug}${isCurrent ? ' · 当前使用中' : ''}`}
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
        </div>
      </SettingsSection>

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
