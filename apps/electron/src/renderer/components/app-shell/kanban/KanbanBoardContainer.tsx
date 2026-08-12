import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { LayoutDashboard, Plus, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import type { AgentSessionMeta, TaskDeleteImpact } from '@myyoda/shared'
import {
  agentModelIdAtom,
  agentSessionsAtom,
  agentWorkspacesAtom,
  currentAgentWorkspaceIdAtom,
} from '@/atoms/agent-atoms'
import { tabsAtom, updateTabTitle } from '@/atoms/tab-atoms'
import { channelsAtom, channelsLoadedAtom } from '@/atoms/chat-atoms'
import {
  boardModeAtom,
  kanbanItemsAtom,
  kanbanNotificationsAtom,
  moveCardAtom,
  serverTaskSummariesAtom,
} from '@/atoms/kanban-atoms'
import {
  activeTaskEditorTargetAtom,
  pendingTaskEditorTargetAtom,
  serverKanbanProjectsAtom,
  taskBoardScopeAtom,
} from '@/atoms/project-atoms'
import {
  clearTaskBoardFiltersAtom,
  taskBoardIncludeUnlabeledAtom,
  taskBoardLabelFilterAtom,
  taskBoardWorkflowFilterAtom,
} from '@/atoms/task-board-filter-atoms'
import { Button } from '@/components/ui/button'
import { CreateProjectDialog } from '@/components/work/CreateProjectDialog'
import { workspaceLabelsAtom } from '@/atoms/workspace-labels-atoms'
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
import { useCloseTab } from '@/hooks/useCloseTab'
import { BoardListToggle } from './BoardListToggle'
import { activeBoardItems, consumeFirstNotification, DEFAULT_KANBAN_COLUMNS, type KanbanColumnDefinition } from './board-model'
import { buildKanbanModelCatalog } from './kanban-model-catalog'
import { KanbanBoard } from './KanbanBoard'
import { KanbanProjectFilter } from './KanbanProjectFilter'
import { TaskBoardFilters } from './TaskBoardFilters'
import { NewTaskComposer } from './NewTaskComposer'
import { TaskEditor } from './TaskEditor'
import { TaskFamilySheet } from './TaskFamilySheet'
import { resolveTaskEditorTarget } from './task-editor-model'
import { resolveTaskBoardEmptyState } from './task-board-empty-state'
import { filterPickableKanbanProjects, type KanbanItem, type KanbanProject, type TaskEditorTarget } from './types'
import type { TaskWorkflow } from '@myyoda/shared/tasks'
import type { KanbanColumnDef } from '@myyoda/shared/projects'

/** 任务创建/运行后回调；`ran` 为 true 时打开编排会话。 */
export interface TaskCreatedEvent {
  sessionId: string
  slug?: string
  projectId?: string
  /** 是否已触发 tasks.run（创建并运行 / 看板运行） */
  ran?: boolean
}

interface KanbanBoardContainerProps {
  onOpenItem?: (item: KanbanItem) => void
  onOpenSubtask?: (sessionId: string) => void
  onTaskCreated?: (created?: TaskCreatedEvent) => void | Promise<void>
  onSessionCreated?: (session: AgentSessionMeta) => void
  onRefresh?: () => void | Promise<void>
  refreshing?: boolean
}

export function KanbanBoardContainer({
  onOpenItem,
  onOpenSubtask,
  onTaskCreated,
  onSessionCreated,
  onRefresh,
  refreshing = false,
}: KanbanBoardContainerProps): React.ReactElement {
  const items = useAtomValue(kanbanItemsAtom)
  const projects = useAtomValue(serverKanbanProjectsAtom)
  // 隐藏容器 Project（home/ad-hoc）只用于卡片归属展示，不应出现在筛选器/任务编辑器的项目选择里。
  const pickableProjects = React.useMemo(() => filterPickableKanbanProjects(projects), [projects])
  const setProjects = useSetAtom(serverKanbanProjectsAtom)
  const [scope, setScope] = useAtom(taskBoardScopeAtom)
  const [composerOpen, setComposerOpen] = React.useState(false)
  const [createProjectOpen, setCreateProjectOpen] = React.useState(false)
  const [creatingProject, setCreatingProject] = React.useState(false)
  const [mode, setMode] = useAtom(boardModeAtom)
  const [notifications, setNotifications] = useAtom(kanbanNotificationsAtom)
  const moveCard = useSetAtom(moveCardAtom)
  const taskSummaries = useAtomValue(serverTaskSummariesAtom) ?? []
  const setTaskSummaries = useSetAtom(serverTaskSummariesAtom)
  const [workflowFilter, setWorkflowFilter] = useAtom(taskBoardWorkflowFilterAtom)
  const [labelFilter, setLabelFilter] = useAtom(taskBoardLabelFilterAtom)
  const includeUnlabeled = useAtomValue(taskBoardIncludeUnlabeledAtom)
  const workspaceLabels = useAtomValue(workspaceLabelsAtom)
  const clearFilters = useSetAtom(clearTaskBoardFiltersAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const workspace = workspaces.find((candidate) => candidate.id === currentWorkspaceId) ?? null
  const channels = useAtomValue(channelsAtom)
  const channelsLoaded = useAtomValue(channelsLoadedAtom)
  const setChannels = useSetAtom(channelsAtom)
  const setChannelsLoaded = useSetAtom(channelsLoadedAtom)
  const agentModelId = useAtomValue(agentModelIdAtom)
  const [workspaceRoot, setWorkspaceRoot] = React.useState<string | null>(null)
  // 使用持久化 atom 替代 local state，防止 KanbanBoardContainer 重载时丢失 TaskEditor
  const [editorTarget, setEditorTarget] = useAtom(activeTaskEditorTargetAtom)
  const pendingEditorTarget = useAtomValue(pendingTaskEditorTargetAtom)
  const setPendingEditorTarget = useSetAtom(pendingTaskEditorTargetAtom)
  const setAgentSessions = useSetAtom(agentSessionsAtom)
  const setTabs = useSetAtom(tabsAtom)
  const { executeClose } = useCloseTab()
  const [pendingDeleteItem, setPendingDeleteItem] = React.useState<KanbanItem | null>(null)
  const [deleteImpact, setDeleteImpact] = React.useState<TaskDeleteImpact | null>(null)
  const [impactLoading, setImpactLoading] = React.useState(false)
  // 任务家族会话面板：聚焦某张卡片的 taskSlug，列出同 slug 全部关联会话
  const [familyTarget, setFamilyTarget] = React.useState<KanbanItem | null>(null)
  const [deleting, setDeleting] = React.useState(false)

  const visibleItems = mode === 'board' ? activeBoardItems(items, workflowFilter) : items
  const emptyState = resolveTaskBoardEmptyState({
    totalCount: taskSummaries.length,
    filteredCount: visibleItems.length,
    scope,
    ...(scope.kind === 'project'
      ? { projectName: projects.find((project) => project.id === scope.projectId)?.name }
      : {}),
    hasSecondaryFilters: workflowFilter !== 'all' || labelFilter.length > 0 || includeUnlabeled,
  })

  // ---------------------------------------------------------------------------
  // 项目自定义列（对齐 craft）：仅聚焦到单个真实 Project 时使用/编辑该项目列；
  // 跨项目/工作区视图始终用默认四列，避免语义混乱。
  // ---------------------------------------------------------------------------
  const editingProject = scope.kind === 'project'
    ? projects.find((project) => project.id === scope.projectId) ?? null
    : null
  const usingProjectColumns = Boolean(editingProject?.kanbanColumns?.length)
  const activeColumns = React.useMemo<KanbanColumnDefinition[]>(() => {
    if (!usingProjectColumns || !editingProject) return DEFAULT_KANBAN_COLUMNS
    // 透传项目自定义列（含 dropStatusId），board-model 已具备去重/过滤/回退逻辑
    return editingProject.kanbanColumns ?? DEFAULT_KANBAN_COLUMNS
  }, [usingProjectColumns, editingProject])

  // 持久化项目自定义列；projects:changed 广播会刷新 atom，无需本地乐观投影
  const persistProjectColumns = React.useCallback((columns: KanbanColumnDef[]) => {
    if (!workspaceRoot || !editingProject?.slug) return
    void window.electronAPI.projects.update(workspaceRoot, editingProject.slug, { kanbanColumns: columns })
      .catch((cause: unknown) => {
        toast.error('保存看板列失败', { description: cause instanceof Error ? cause.message : String(cause) })
      })
  }, [workspaceRoot, editingProject])

  // 可编辑列：项目已有自定义列则直接改；首次定制时用当前活跃列作为种子
  // （保留内置 id，确保已有卡片位置不丢）
  const resolveEditableColumns = React.useCallback((): KanbanColumnDef[] => {
    const custom = editingProject?.kanbanColumns
    if (custom?.length) return custom.map((column) => ({ ...column }))
    return activeColumns.map((column) => ({
      id: column.id,
      name: column.name,
      color: column.color,
      dropStatusId: column.dropStatusId,
    }))
  }, [editingProject, activeColumns])

  const handleAddColumn = React.useCallback(() => {
    const base = resolveEditableColumns()
    const id = `col-${crypto.randomUUID().slice(0, 8)}`
    persistProjectColumns([...base, { id, name: '新列' }])
  }, [resolveEditableColumns, persistProjectColumns])

  const handleUpdateColumn = React.useCallback((columnId: string, patch: Partial<KanbanColumnDef>) => {
    const next = resolveEditableColumns().map((column) =>
      column.id === columnId ? { ...column, ...patch } : column,
    )
    persistProjectColumns(next)
  }, [resolveEditableColumns, persistProjectColumns])

  // 删除列：先把该列卡片逐个重分配到第一个剩余列（不丢卡片），再持久化列集合。
  const handleRemoveColumn = React.useCallback((columnId: string) => {
    const remaining = resolveEditableColumns().filter((column) => column.id !== columnId)
    const fallbackId = remaining[0]?.id
    if (fallbackId && workspaceRoot && workspace) {
      for (const item of items) {
        if (item.columnId !== columnId || !item.task || item.task.legacyIdentity) continue
        void window.electronAPI.tasks.updateMetadata(
          workspaceRoot,
          workspace.id,
          item.task.taskId,
          { kanbanColumn: fallbackId, expectedRevision: item.task.revision },
        ).then((updated) => {
          setTaskSummaries((tasks) => tasks?.map((task) => task.taskId === updated.taskId ? updated : task))
        }).catch((cause: unknown) => {
          toast.error('移动卡片失败', { description: cause instanceof Error ? cause.message : String(cause) })
        })
      }
    }
    persistProjectColumns(remaining)
  }, [resolveEditableColumns, persistProjectColumns, items, workspaceRoot, workspace, setTaskSummaries])

  const { groups: modelGroups, modelToConnection } = React.useMemo(
    () => buildKanbanModelCatalog(channels),
    [channels],
  )

  // 消费跨视图打开 TaskEditor 的请求（项目中心「新建任务」/ 会话 header「编辑任务」）
  React.useEffect(() => {
    if (!pendingEditorTarget) return
    setEditorTarget(pendingEditorTarget)
    setPendingEditorTarget(null)
  }, [pendingEditorTarget, setPendingEditorTarget])

  React.useEffect(() => {
    const validIds = new Set(workspaceLabels.map((label) => label.id))
    setLabelFilter((current) => current.filter((labelId) => validIds.has(labelId)))
  }, [setLabelFilter, workspaceLabels])

  React.useEffect(() => {
    if (channelsLoaded && channels.length > 0) return
    let cancelled = false
    void window.electronAPI.listChannels().then((next) => {
      if (cancelled) return
      setChannels(next)
      setChannelsLoaded(true)
    }).catch(console.error)
    return () => { cancelled = true }
  }, [channels.length, channelsLoaded, setChannels, setChannelsLoaded])

  React.useEffect(() => {
    if (!workspace) { setWorkspaceRoot(null); return }
    let cancelled = false
    void window.electronAPI.getWorkspaceRootPath(workspace.slug).then((root) => {
      if (!cancelled) setWorkspaceRoot(root)
    }).catch(() => {
      if (!cancelled) setWorkspaceRoot(null)
    })
    return () => { cancelled = true }
  }, [workspace])

  React.useEffect(() => {
    if (notifications.length === 0) return
    const consumed = consumeFirstNotification(notifications)
    setNotifications(consumed.remaining)
    if (consumed.notification) toast.error(consumed.notification.message)
  }, [notifications, setNotifications])

  // Task 删除影响分析：仅在选中正式 Task 时加载
  React.useEffect(() => {
    if (!workspaceRoot || !pendingDeleteItem?.task || pendingDeleteItem.task.legacyIdentity) {
      setDeleteImpact(null)
      return
    }
    let cancelled = false
    setImpactLoading(true)
    setDeleteImpact(null)
    void window.electronAPI.tasks.analyzeDeleteImpact(workspaceRoot, pendingDeleteItem.task.taskSlug)
      .then((impact) => { if (!cancelled) setDeleteImpact(impact) })
      .catch((cause: unknown) => {
        if (!cancelled) toast.error('无法分析删除影响', { description: cause instanceof Error ? cause.message : String(cause) })
      })
      .finally(() => { if (!cancelled) setImpactLoading(false) })
    return () => { cancelled = true }
  }, [pendingDeleteItem, workspaceRoot])

  // 点击卡片本体：始终打开对应会话（对齐 craft——卡片点击=查看对话，编辑是另一个
  // 独立入口，两者不再按是否绑定 task spec 二选一）。
  const openItem = (item: KanbanItem): void => {
    onOpenItem?.(item)
  }

  // 恢复诊断卡片没有真实 Session，不能把 synthetic id 当成 Session 写回。
  const editItem = (item: KanbanItem): void => {
    if (item.hasSession === false) {
      toast.info('该 Task 暂无可编辑的编排会话', { description: '请先处理 Task 恢复诊断。' })
      return
    }
    setEditorTarget(resolveTaskEditorTarget(item))
  }

  // 正式看板的标题/归档属于 Task；legacy Session 看板才继续操作 Session。
  const renameItem = (item: KanbanItem, newTitle: string): void => {
    if (item.task && !item.task.legacyIdentity && workspaceRoot && workspace) {
      void window.electronAPI.tasks.updateMetadata(workspaceRoot, workspace.id, item.task.taskId, {
        title: newTitle,
        expectedRevision: item.task.revision,
      }).then((updated) => {
        setTaskSummaries((tasks) => tasks?.map((task) => task.taskId === updated.taskId ? updated : task))
      }).catch((cause: unknown) => {
        toast.error('重命名 Task 失败', { description: cause instanceof Error ? cause.message : String(cause) })
      })
      return
    }
    void window.electronAPI.updateAgentSessionTitle(item.session.id, newTitle)
      .then((updated) => {
        setAgentSessions((prev) => prev.map((session) => session.id === updated.id ? updated : session))
        setTabs((prev) => updateTabTitle(prev, item.session.id, newTitle))
      })
      .catch((cause: unknown) => {
        toast.error('重命名失败', { description: cause instanceof Error ? cause.message : String(cause) })
      })
  }

  const archiveItem = (item: KanbanItem): void => {
    if (item.task && !item.task.legacyIdentity && workspaceRoot && workspace) {
      void window.electronAPI.tasks.updateMetadata(workspaceRoot, workspace.id, item.task.taskId, {
        archived: !item.task.archivedAt,
        expectedRevision: item.task.revision,
      }).then((updated) => {
        setTaskSummaries((tasks) => tasks?.map((task) => task.taskId === updated.taskId ? updated : task))
        toast.success(updated.archivedAt ? 'Task 已归档' : 'Task 已取消归档')
      }).catch((cause: unknown) => {
        toast.error('归档 Task 失败', { description: cause instanceof Error ? cause.message : String(cause) })
      })
      return
    }
    void window.electronAPI.toggleArchiveAgentSession(item.session.id)
      .then((updated) => {
        setAgentSessions((prev) => prev.map((session) => session.id === updated.id ? updated : session))
        if (updated.archived) executeClose(item.session.id)
        toast.success(updated.archived ? '已归档' : '已取消归档')
      })
      .catch((cause: unknown) => {
        toast.error('归档失败', { description: cause instanceof Error ? cause.message : String(cause) })
      })
  }

  // 右键菜单「删除」：先弹确认框（见下方 AlertDialog），确认后才真正删除。
  const confirmDeleteItem = (): void => {
    if (!pendingDeleteItem || deleting) return
    setDeleting(true)

    // 正式 Task：走 tasks.delete IPC
    if (pendingDeleteItem.task && !pendingDeleteItem.task.legacyIdentity) {
      if (!workspaceRoot || !workspace) return
      const taskSlug = pendingDeleteItem.task.taskSlug
      void window.electronAPI.tasks.delete(workspaceRoot, workspace.id, taskSlug, deleteImpact?.confirmationToken)
        .then(() => {
          setTaskSummaries((tasks) => tasks?.filter((t) => t.taskId !== pendingDeleteItem?.task?.taskId))
          toast.success('Task 已永久删除')
        })
        .catch((cause: unknown) => {
          toast.error('删除失败', { description: cause instanceof Error ? cause.message : String(cause) })
        })
        .finally(() => {
          setDeleting(false)
          setPendingDeleteItem(null)
        })
      return
    }

    // 旧兼容 Session
    const sessionId = pendingDeleteItem.session.id
    void window.electronAPI.deleteAgentSession(sessionId)
      .then(() => {
        setAgentSessions((prev) => prev.filter((s) => s.id !== sessionId))
        executeClose(sessionId)
        toast.success('已删除')
      })
      .catch((cause: unknown) => {
        toast.error('删除失败', { description: cause instanceof Error ? cause.message : String(cause) })
      })
      .finally(() => {
        setDeleting(false)
        setPendingDeleteItem(null)
      })
  }

  if (editorTarget && workspaceRoot && workspace) {
    const editSession = editorTarget.mode === 'edit'
      ? items.find((item) => item.id === editorTarget.sessionId)?.session
      : undefined
    const defaultModel = editSession?.modelId
      ?? agentModelId
      ?? modelGroups[0]?.models[0]?.id
      ?? ''
    return (
      <TaskEditor
        workspaceRoot={workspaceRoot}
        workspaceId={workspace.id}
        projects={pickableProjects}
        target={editorTarget}
        defaultModel={defaultModel}
        modelGroups={modelGroups}
        modelToConnection={modelToConnection}
        onClose={() => setEditorTarget(null)}
        onCreated={onTaskCreated
          ? async (created) => {
              await onTaskCreated({
                sessionId: created.sessionId,
                slug: created.slug,
                ran: created.ran,
                ...(created.projectId ? { projectId: created.projectId } : {}),
              })
            }
          : undefined}
        onOpenSession={(sessionId) => {
          const item = items.find((candidate) => candidate.id === sessionId)
          if (item) onOpenItem?.(item)
        }}
        onOpenChildSession={onOpenSubtask}
      />
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background px-4 pb-4">
      <header className="mb-4 space-y-3">
        {/* pt-14：内容整体让到 AppShell 全局 drag 层（0–50px, z-50）下方，同时避免
            与 Windows 自定义 WindowControls（fixed 右上角）视觉重叠，四个模块页面统一此规范。 */}
        <div className="titlebar-drag-region flex flex-wrap items-center justify-between gap-3 pt-14">
          <div className="titlebar-no-drag flex items-center gap-2.5">
            <LayoutDashboard className="size-6 text-foreground/70" />
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Project 看板</h1>
              <p className="text-xs text-muted-foreground">
                {taskSummaries.length === visibleItems.length
                  ? `${visibleItems.length} 个正式 Task`
                  : `${taskSummaries.length} 个 Task · 当前显示 ${visibleItems.length} 个`}
              </p>
            </div>
          </div>
          <Button size="sm" onClick={() => setComposerOpen(true)} className="titlebar-no-drag">
            <Plus className="mr-1 h-4 w-4" />
            新建任务
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="titlebar-no-drag flex flex-wrap items-center gap-2">
            <KanbanProjectFilter
              projects={pickableProjects}
              value={scope}
              onChange={setScope}
              onCreateProject={() => setCreateProjectOpen(true)}
            />
            <TaskBoardFilters />
          </div>
          <div className="titlebar-no-drag flex items-center gap-1">
            <BoardListToggle value={mode} onChange={setMode} />
            {onRefresh ? (
              <Button variant="ghost" size="icon-sm" disabled={refreshing} onClick={() => { void onRefresh() }} aria-label="刷新 Project 看板" title="刷新">
                <RefreshCw className={refreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
              </Button>
            ) : null}
          </div>
        </div>
      </header>
      {workspaceRoot && workspace ? (
        <NewTaskComposer
          open={composerOpen}
          workspaceRoot={workspaceRoot}
          workspaceId={workspace.id}
          initialProjectId={scope.kind === 'project' ? scope.projectId : null}
          onOpenChange={setComposerOpen}
          onMoreSettings={(target) => setEditorTarget(target)}
          onCreated={async (created) => {
            setScope(created.projectId
              ? { kind: 'project', projectId: created.projectId }
              : { kind: 'workspace' })
            await onTaskCreated?.(created)
          }}
        />
      ) : null}
      <KanbanBoard
        items={items}
        mode={mode}
        workflowFilter={workflowFilter}
        columns={activeColumns}
        emptyState={emptyState ? {
          title: emptyState.title,
          actionLabel: emptyState.action === 'create' ? '新建任务' : '清除筛选',
          onAction: emptyState.action === 'create'
            ? () => setComposerOpen(true)
            : () => clearFilters(),
        } : null}
        onMove={(itemId, columnId) => {
          const configuredDrop = activeColumns.find((column) => column.id === columnId)?.dropStatusId
          const dropStatusId = configuredDrop === 'todo' || configuredDrop === 'in-progress'
            || configuredDrop === 'needs-review' || configuredDrop === 'done' || configuredDrop === 'cancelled'
            ? configuredDrop
            : undefined
          void moveCard({
            itemId,
            columnId,
            ...(workspaceRoot ? { workspaceRoot } : {}),
            ...(workspace ? { workspaceId: workspace.id } : {}),
            ...(usingProjectColumns
              ? { columnPlacementMode: 'custom' as const, dropStatusId }
              : {}),
          }).then(() => {
            if (workflowFilter === 'all' || workflowFilter === columnId) return
            toast.info('任务已移动，并被当前状态筛选隐藏', {
              action: { label: '查看', onClick: () => setWorkflowFilter(columnId as typeof workflowFilter) },
            })
          })
        }}
        onOpenItem={openItem}
        onEditItem={editItem}
        onRenameItem={renameItem}
        onArchiveItem={archiveItem}
        onDeleteItem={(item) => {
          setPendingDeleteItem(item)
        }}
        onOpenSubtask={onOpenSubtask}
        onOpenTaskFamily={(item) => setFamilyTarget(item)}
        onRunTask={(item) => {
          const taskSlug = item.task?.taskSlug ?? item.session.taskSlug
          if (!workspaceRoot || !workspace || !taskSlug) return
          const orchestratorSessionId = item.hasSession === false ? undefined : item.session.id
          void window.electronAPI.tasks.run(workspaceRoot, workspace.id, taskSlug, {
            ...(orchestratorSessionId ? { orchestratorSessionId } : {}),
          })
            .then(async () => {
              toast.success('任务已开始运行')
              await onTaskCreated?.({
                sessionId: orchestratorSessionId ?? '',
                slug: taskSlug,
                ran: true,
              })
            })
            .catch((cause: unknown) => {
              toast.error('启动任务失败', {
                description: cause instanceof Error ? cause.message : String(cause),
              })
            })
        }}
        onChangeWorkflow={(item, workflow) => {
          if (!workspaceRoot || !workspace || !item.task || item.task.legacyIdentity) return
          void window.electronAPI.tasks.updateWorkflow(workspaceRoot, workspace.id, item.task.taskId, workflow, item.task.revision)
            .then((updated) => {
              setTaskSummaries((tasks) => tasks?.map((task) => task.taskId === updated.taskId ? updated : task))
            })
            .catch((cause: unknown) => {
              toast.error('更新 Task 状态失败', { description: cause instanceof Error ? cause.message : String(cause) })
            })
        }}
        onSetLabels={(item, labelIds) => {
          if (!workspaceRoot || !workspace || !item.task || item.task.legacyIdentity) return
          void window.electronAPI.labels.setTaskLabels(workspaceRoot, workspace.id, item.task.taskId, labelIds)
            .then((updated) => {
              setTaskSummaries((tasks) => tasks?.map((task) => task.taskId === updated.taskId ? updated : task))
            })
            .catch((cause: unknown) => {
              toast.error('更新 Task Labels 失败', { description: cause instanceof Error ? cause.message : String(cause) })
            })
        }}
        onRetryTeambition={(item) => {
          const bindingId = item.teambition?.bindingId
          if (!workspaceRoot || !bindingId) return
          void window.electronAPI.teambition.retrySync(workspaceRoot, bindingId)
            .then(() => onTaskCreated?.())
            .catch((cause: unknown) => {
              toast.error('重试 Teambition 同步失败', {
                description: cause instanceof Error ? cause.message : String(cause),
              })
            })
        }}
        onAddColumn={editingProject ? handleAddColumn : undefined}
        onUpdateColumn={editingProject ? handleUpdateColumn : undefined}
        onRemoveColumn={editingProject ? handleRemoveColumn : undefined}
      />
      <CreateProjectDialog
        open={createProjectOpen}
        busy={creatingProject}
        onOpenChange={setCreateProjectOpen}
        onSubmit={(input) => {
          if (!workspaceRoot || creatingProject) return
          setCreatingProject(true)
          void window.electronAPI.projects.create(workspaceRoot, input).then((project) => {
            setProjects((current) => [project, ...current.filter((candidate) => candidate.id !== project.id)])
            setScope({ kind: 'project', projectId: project.id })
            setCreateProjectOpen(false)
            toast.success(`已创建项目「${project.name}」`)
          }).catch((cause: unknown) => {
            toast.error('创建项目失败', { description: cause instanceof Error ? cause.message : String(cause) })
          }).finally(() => setCreatingProject(false))
        }}
      />
      <AlertDialog
        open={pendingDeleteItem !== null}
        onOpenChange={(open) => { if (!open && !deleting) { setPendingDeleteItem(null); setDeleteImpact(null) } }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除任务</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>删除后将无法恢复，确定要删除「{pendingDeleteItem?.title}」吗？</p>
                {pendingDeleteItem?.task && !pendingDeleteItem.task.legacyIdentity ? (
                  impactLoading ? <p className="text-muted-foreground">正在分析影响…</p> : deleteImpact ? (
                    <div className="rounded-lg bg-muted/50 p-3 text-xs leading-5 text-foreground/70">
                      <p>{deleteImpact.runCount} 个历史 Run · {deleteImpact.sessionCount} 个关联会话</p>
                      {deleteImpact.blockers.length > 0 && deleteImpact.blockers.map((b) => <p key={b} className="mt-1 text-destructive">{b}</p>)}
                    </div>
                  ) : <p className="text-destructive">未能完成影响分析，请重试。</p>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting || impactLoading || (pendingDeleteItem?.task && !pendingDeleteItem.task.legacyIdentity && !deleteImpact)}
              onClick={confirmDeleteItem}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? '删除中…' : '删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <TaskFamilySheet
        open={familyTarget !== null}
        onOpenChange={(open) => { if (!open) setFamilyTarget(null) }}
        taskSlug={familyTarget?.task?.taskSlug ?? familyTarget?.session.taskSlug ?? ''}
        orchestratorSessionId={familyTarget?.task?.orchestratorSessionId ?? familyTarget?.session.id}
        title={familyTarget?.title ?? ''}
        onOpenSession={(sessionId) => {
          setFamilyTarget(null)
          onOpenSubtask?.(sessionId)
        }}
      />
    </div>
  )
}
