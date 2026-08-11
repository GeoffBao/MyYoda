/**
 * SidebarProjectsTab — 会话列表「分组方式：项目」视图（Hermes 风格：项目 → 会话分组）
 *
 * 挂载于 LeftSidebar 筛选菜单 groupBy === 'project' 时（原独立的「项目」大 Tab 已取消，
 * 由紧凑筛选菜单统一接管）：
 * - 项目按最近会话活跃度排序，点击项目行展开/折叠其下会话（updatedAt 倒序，再按 sortBy 重排）
 * - hover 项目行浮现「+」（新建该项目会话）、「归档」快捷按钮与「⋯」（看板/新建任务/项目设置/归档/删除）
 * - 右键 / 双指点击项目行 = 与「⋯」相同的操作菜单（ContextMenu 与 DropdownMenu 共用同一份菜单项）
 * - 项目行右侧聚合注意力点：取组内会话最高优先级状态（blocked > running > completed）
 * - 纯粹的「按项目浏览」视图：无项目的会话不在此展示，统一去「分组方式：日期/不分组」查看/迁移
 * - 归档项目可见性对齐侧边栏统一的「状态」筛选（status prop），不再有独立开关
 * - 对齐品类收敛方向：项目分组 + 组内时间倒序（Conductor/Superset/Synara/Orca/craft 均如此）
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  Archive,
  ArchiveRestore,
  BookOpen,
  ChevronRight,
  LayoutDashboard,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import type { AgentSessionMeta, ProjectDeleteImpact, SessionGroup, SessionListSortBy, SessionListStatusFilter } from '@myyoda/shared'
import { cn } from '@/lib/utils'
import {
  agentSessionsAtom,
  agentSessionIndicatorMapAtom,
  agentWorkspacesAtom,
  currentAgentWorkspaceIdAtom,
} from '@/atoms/agent-atoms'
import { activeSessionIdAtom } from '@/atoms/tab-atoms'
import { draftSessionIdsAtom } from '@/atoms/draft-session-atoms'
import { getActiveAccelerator, getAcceleratorDisplay } from '@/lib/shortcut-registry'
import {
  activeProjectPageIdAtom,
  codeMainViewAtom,
  pendingTaskEditorTargetAtom,
  projectPageTabAtom,
  selectedProjectIdAtom,
  type ProjectPageTab,
  serverKanbanProjectsAtom,
} from '@/atoms/project-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { MarqueeText } from '@/components/ui/marquee-text'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
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
import { AgentSessionItem } from './AgentSessionItem'
import type { KanbanProject } from './kanban/types'
import {
  buildAgentSessionTrees,
  getSessionStatus,
  getSessionTreeProgress,
  getSessionTreeStatus,
  sortSessionTrees,
  treeContainsSessionId,
  type AgentSessionTreeItem,
} from './sidebar-session-tree'
import { buildProjectPageNavigation } from './code-main-view-model'
import {
  filterGroupableSessions,
  groupSessionTreesByProject,
  resolveProjectTreeAttention,
  sortProjectsByTreeActivity,
} from './sidebar-projects-model'

/** 会话行操作回调包：由 LeftSidebar 传入，与会话 Tab 共享同一批 handler，行为完全一致 */
export interface ProjectSessionHandlers {
  onSelectSession: (id: string, title: string) => void
  onRequestDelete: (id: string) => void
  onRequestMove: (id: string) => void
  onRename: (id: string, newTitle: string) => Promise<void>
  onTogglePin: (id: string, cascade: boolean) => Promise<void>
  onToggleStar: (id: string) => Promise<void>
  onToggleArchive: (id: string) => Promise<void>
  onMoveToProject: (sessionId: string, projectId?: string) => void | Promise<void>
  /** 在项目下新建会话（draft，预绑定 projectId） */
  onNewSessionInProject: (projectId: string) => void | Promise<void>
  sessionGroups: SessionGroup[]
  onMoveToGroup: (sessionId: string, groupId?: string) => void | Promise<void>
  onCreateGroup: (sessionId: string) => void
}

interface SidebarProjectsTabProps {
  workspaceRoot: string | null
  sessionHandlers: ProjectSessionHandlers
  /** 状态筛选：控制归档项目是否可见（复用侧边栏统一的「状态」筛选，语义对齐原 showArchivedProjectsAtom） */
  status: SessionListStatusFilter
  /** 排序方式：只影响每个项目内会话行的顺序，项目本身仍按活跃度排序 */
  sortBy: SessionListSortBy
}

/** 项目行聚合注意力点的优先级：blocked > running > completed（学 Synara/Superset 聚合指示） */
const ATTENTION_DOT_CLASS: Record<string, string> = {
  blocked: 'bg-destructive',
  running: 'bg-amber-500 animate-pulse',
  completed: 'bg-emerald-500',
}

/** 项目分组视图每个 project 下默认展示的会话数量上限；超出部分折叠在「显示全部」按钮后 */
const PROJECT_MODE_PREVIEW_LIMIT = 8

export function SidebarProjectsTab({ workspaceRoot, sessionHandlers, status, sortBy }: SidebarProjectsTabProps): React.ReactElement {
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const workspace = workspaces.find((candidate) => candidate.id === currentWorkspaceId) ?? workspaces[0] ?? null
  const workspaceSlug = workspace?.slug ?? null

  const [projects, setProjects] = useAtom(serverKanbanProjectsAtom)
  const agentSessions = useAtomValue(agentSessionsAtom)
  const indicatorMap = useAtomValue(agentSessionIndicatorMapAtom)
  const activeSessionId = useAtomValue(activeSessionIdAtom)
  const draftSessionIds = useAtomValue(draftSessionIdsAtom)
  const setSelectedProjectId = useSetAtom(selectedProjectIdAtom)
  const setActiveProjectPageId = useSetAtom(activeProjectPageIdAtom)
  const setProjectPageTab = useSetAtom(projectPageTabAtom)
  const setCodeMainView = useSetAtom(codeMainViewAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const setPendingTaskEditorTarget = useSetAtom(pendingTaskEditorTargetAtom)
  // 归档项目的可见性对齐统一的「状态」筛选：活跃时隐藏，已归档/全部时显示
  // （会话本身的归档态与此无关——filterGroupableSessions 一直只展示未归档会话）
  const showArchived = status !== 'active'

  const [collapsedIds, setCollapsedIds] = React.useState<Set<string>>(new Set())
  /** 已完全展开的项目 ID（点击「显示全部」后展示全部任务族，不再分批） */
  const [expandedProjectIds, setExpandedProjectIds] = React.useState<Set<string>>(new Set())
  const [expandedParentIds, setExpandedParentIds] = React.useState<Set<string>>(new Set())
  const [collapsedParentIds, setCollapsedParentIds] = React.useState<Set<string>>(new Set())
  const [deleteTarget, setDeleteTarget] = React.useState<KanbanProject | null>(null)
  const [deleteImpact, setDeleteImpact] = React.useState<ProjectDeleteImpact | null>(null)
  const [impactLoading, setImpactLoading] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [relativeTimeNow, setRelativeTimeNow] = React.useState(() => Date.now())

  React.useEffect(() => {
    const timer = window.setInterval(() => setRelativeTimeNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  // 按当前工作区过滤项目
  const scopedProjects = React.useMemo(() => {
    if (!workspaceSlug) return []
    return projects.filter((project) => !project.workspaceId || project.workspaceId === workspaceSlug)
  }, [projects, workspaceSlug])

  // 归档过滤
  const visibleProjects = React.useMemo(() => {
    let result = scopedProjects
    if (!showArchived) result = result.filter((project) => !project.archivedAt)
    return result
  }, [scopedProjects, showArchived])

  /**
   * 当前工作区可入项目分组的会话：保留父子关系，排除 draft / 归档 / 自动任务会话。
   * 置顶任务族由 LeftSidebar 上方置顶区统一展示，项目区不重复渲染。
   */
  const groupableSessions = React.useMemo(
    () => filterGroupableSessions(agentSessions, draftSessionIds, workspace?.id ?? null),
    [agentSessions, draftSessionIds, workspace?.id],
  )

  const treesByProject = React.useMemo(() => {
    const byProject = groupSessionTreesByProject(buildAgentSessionTrees(groupableSessions))
    for (const [projectId, trees] of byProject) {
      byProject.set(projectId, sortSessionTrees(trees, sortBy))
    }
    return byProject
  }, [groupableSessions, sortBy])

  /** 项目排序：任务族内任一子任务活动都会提升所属项目。 */
  const sortedProjects = React.useMemo(
    () => sortProjectsByTreeActivity(visibleProjects, treesByProject),
    [visibleProjects, treesByProject],
  )

  const toggleCollapsed = React.useCallback((id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const enterWork = React.useCallback(() => {
    setCodeMainView('tasks')
    setActiveView('conversations')
  }, [setActiveView, setCodeMainView])

  const openBoard = React.useCallback((projectId: string) => {
    setSelectedProjectId(projectId)
    enterWork()
  }, [enterWork, setSelectedProjectId])

  const openCreateTask = React.useCallback((projectId: string) => {
    setSelectedProjectId(projectId)
    setPendingTaskEditorTarget({ mode: 'create', initialProjectId: projectId })
    enterWork()
  }, [enterWork, setPendingTaskEditorTarget, setSelectedProjectId])

  const openProjectPage = React.useCallback((projectId: string, tab: ProjectPageTab = 'overview') => {
    const navigation = buildProjectPageNavigation(projectId, tab)
    setActiveProjectPageId(navigation.activeProjectPageId)
    setProjectPageTab(navigation.projectPageTab)
    setCodeMainView(navigation.codeMainView)
    setActiveView(navigation.activeView)
  }, [setActiveProjectPageId, setActiveView, setCodeMainView, setProjectPageTab])


  const handleToggleArchive = React.useCallback(async (project: KanbanProject): Promise<void> => {
    if (!workspaceRoot || !project.slug) return
    try {
      const updated = await window.electronAPI.projects.update(workspaceRoot, project.slug, {
        archivedAt: project.archivedAt ? undefined : Date.now(),
      })
      setProjects((prev) => prev.map((existing) => (existing.id === updated.id ? updated : existing)))
      toast.success(project.archivedAt ? '已取消归档' : '已归档')
    } catch (cause) {
      toast.error('操作失败', {
        description: cause instanceof Error ? cause.message : String(cause),
      })
    }
  }, [setProjects, workspaceRoot])

  React.useEffect(() => {
    if (!workspaceRoot || !deleteTarget?.slug) {
      setDeleteImpact(null)
      return
    }
    let cancelled = false
    setImpactLoading(true)
    setDeleteImpact(null)
    void window.electronAPI.projects.analyzeDeleteImpact(workspaceRoot, deleteTarget.slug)
      .then((impact) => { if (!cancelled) setDeleteImpact(impact) })
      .catch((cause: unknown) => {
        if (!cancelled) toast.error('无法分析删除影响', { description: cause instanceof Error ? cause.message : String(cause) })
      })
      .finally(() => { if (!cancelled) setImpactLoading(false) })
    return () => { cancelled = true }
  }, [deleteTarget, workspaceRoot])

  const handleDeleteProject = React.useCallback(async (): Promise<void> => {
    if (!workspaceRoot || !deleteTarget?.slug || !deleteTarget.archivedAt || !deleteImpact?.canPurge) return
    setDeleting(true)
    try {
      await window.electronAPI.projects.delete(workspaceRoot, deleteTarget.slug, deleteImpact.confirmationToken)
      setProjects((prev) => prev.filter((existing) => existing.id !== deleteTarget.id))
      toast.success(`项目「${deleteTarget.name}」已删除`)
    } catch (cause) {
      toast.error('删除失败', {
        description: cause instanceof Error ? cause.message : String(cause),
      })
    } finally {
      setDeleting(false)
      setDeleteTarget(null)
    }
  }, [deleteImpact?.canPurge, deleteTarget, setProjects, workspaceRoot])

  if (!workspaceSlug || !workspaceRoot) {
    return (
      <div className="flex-1 px-4 py-10 text-center text-[13px] text-foreground/40">
        请先选择工作区
      </div>
    )
  }

  const hasProjects = scopedProjects.length > 0
  const hasVisible = sortedProjects.length > 0

  const toggleParent = (sessionId: string, expanded: boolean): void => {
    if (expanded) {
      setExpandedParentIds((prev) => { const next = new Set(prev); next.delete(sessionId); return next })
      setCollapsedParentIds((prev) => new Set(prev).add(sessionId))
      return
    }
    setCollapsedParentIds((prev) => { const next = new Set(prev); next.delete(sessionId); return next })
    setExpandedParentIds((prev) => new Set(prev).add(sessionId))
  }

  const renderSessionTree = (item: AgentSessionTreeItem): React.ReactElement => {
    const childCount = item.childSessions.length
    const childProgress = getSessionTreeProgress(item, indicatorMap)
    const delegatedChildCount = item.childSessions.filter((child) => child.parentSessionId === item.session.id && !!child.sourceDelegationId).length
    const status = getSessionTreeStatus(item, indicatorMap)
    const activeChildVisible = item.childSessions.some((child) => child.id === activeSessionId)
    const shouldAutoExpand = activeChildVisible || status === 'running' || status === 'blocked'
    const childrenExpanded = expandedParentIds.has(item.session.id)
      || (shouldAutoExpand && !collapsedParentIds.has(item.session.id))

    const renderRow = (session: AgentSessionMeta, nested = false): React.ReactElement => (
      <AgentSessionItem
        key={session.id}
        session={session}
        active={nested ? session.id === activeSessionId : treeContainsSessionId(item, activeSessionId)}
        indicatorStatus={nested ? getSessionStatus(session, indicatorMap) : status}
        showPinIcon={false}
        childSummary={!nested && childProgress.total > 0
          ? {
            ...childProgress,
            ...(childCount > 0
              ? {
                  expanded: childrenExpanded,
                  onToggle: () => toggleParent(item.session.id, childrenExpanded),
                }
              : {}),
          }
          : undefined}
        delegationChildCount={!nested ? delegatedChildCount : 0}
        projects={nested ? [] : scopedProjects}
        onMoveToProject={nested ? undefined : sessionHandlers.onMoveToProject}
        sessionGroups={nested ? undefined : sessionHandlers.sessionGroups}
        onMoveToGroup={nested ? undefined : sessionHandlers.onMoveToGroup}
        onCreateGroup={nested ? undefined : sessionHandlers.onCreateGroup}
        relativeTimeNow={relativeTimeNow}
        onSelect={sessionHandlers.onSelectSession}
        onRequestDelete={sessionHandlers.onRequestDelete}
        onRequestMove={sessionHandlers.onRequestMove}
        onRename={sessionHandlers.onRename}
        onTogglePin={sessionHandlers.onTogglePin}
        onToggleStar={sessionHandlers.onToggleStar}
        onToggleArchive={sessionHandlers.onToggleArchive}
      />
    )

    return (
      <div key={item.session.id} className="flex flex-col gap-0.5">
        {renderRow(item.session)}
        {childCount > 0 && childrenExpanded && (
          <div className="ml-3 pl-2 flex flex-col gap-0.5">
            {item.childSessions.map((child) => renderRow(child, true))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col titlebar-no-drag">

      {/* 项目 → 会话分组 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 scrollbar-thin">
        {!hasVisible ? (
          <div className="px-2 py-8 text-center text-[13px] text-foreground/35">
            {hasProjects ? '没有匹配的项目' : '暂无项目'}
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {sortedProjects.map((project) => {
              const projectTrees = treesByProject.get(project.id) ?? []
              const expanded = !collapsedIds.has(project.id)
              const archived = !!project.archivedAt
              const attention = resolveProjectTreeAttention(projectTrees, indicatorMap)

              // 项目操作菜单：⋯ 下拉菜单与右键菜单共用同一份内容，避免两处维护同一份 JSX；
              // 尺寸对齐会话行的右键菜单（text-xs + py-1 + 小图标），而不是默认的大号菜单项
              const renderProjectMenuItems = (
                MenuItem: typeof DropdownMenuItem | typeof ContextMenuItem,
                MenuSeparator: typeof DropdownMenuSeparator | typeof ContextMenuSeparator,
              ): React.ReactNode => (
                <>
                  <MenuItem className="text-xs py-1 [&>svg]:size-3.5" onSelect={() => openBoard(project.id)}>
                    <LayoutDashboard size={13} />
                    查看任务
                  </MenuItem>
                  <MenuItem className="text-xs py-1 [&>svg]:size-3.5" onSelect={() => openProjectPage(project.id)}>
                    <BookOpen size={13} />
                    项目资料
                  </MenuItem>
                  <MenuItem className="text-xs py-1 [&>svg]:size-3.5" onSelect={() => openCreateTask(project.id)}>
                    <Plus size={13} />
                    新建任务
                  </MenuItem>
                  <MenuItem className="text-xs py-1 [&>svg]:size-3.5" onSelect={() => openProjectPage(project.id, 'settings')}>
                    <Pencil size={13} />
                    项目设置
                  </MenuItem>
                  <MenuSeparator className="my-0.5" />
                  <MenuItem className="text-xs py-1 [&>svg]:size-3.5" onSelect={() => { void handleToggleArchive(project) }}>
                    {archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
                    {archived ? '取消归档' : '归档'}
                  </MenuItem>
                  <MenuItem
                    disabled={!archived}
                    className="text-xs py-1 [&>svg]:size-3.5 text-destructive focus:text-destructive"
                    onSelect={() => setDeleteTarget(project)}
                  >
                    <Trash2 size={13} />
                    永久删除…
                  </MenuItem>
                </>
              )

              return (
                <div key={project.id} className={cn('rounded-lg', archived && 'opacity-60')}>
                  {/* 项目行：点击 = 展开/折叠会话列表；右键/双指点击 = 项目操作菜单 */}
                  <ContextMenu>
                    <ContextMenuTrigger asChild>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => toggleCollapsed(project.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            toggleCollapsed(project.id)
                          }
                        }}
                        className="group relative flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-foreground/[0.04]"
                      >
                        <MarqueeText text={project.name} className="min-w-0 flex-1 text-[13px]" />

                        {/* 聚合注意力点 + 会话计数（非 hover 时显示） */}
                        {attention && (
                          <span
                            className={cn(
                              'size-1.5 shrink-0 rounded-full group-hover:hidden',
                              ATTENTION_DOT_CLASS[attention],
                            )}
                            title={attention === 'blocked' ? '有会话需要处理' : attention === 'running' ? '有会话正在运行' : '有会话已完成'}
                            aria-hidden="true"
                          />
                        )}
                        {projectTrees.length > 0 && (
                          <span className="shrink-0 text-[10px] tabular-nums text-foreground/30 group-hover:hidden">
                            {projectTrees.length}
                          </span>
                        )}

                        {/* hover 操作：新建该项目会话 + 归档 + 更多菜单。
                            用 absolute + opacity 而非 hidden/flex 切换显隐：
                            display:none 会让触发元素在打开瞬间的 rect 为 0，
                            Radix Popper 首次定位时会把浮层错误地放到视口左上角（(0,0) 起跳）。
                            改为 opacity + pointer-events 切换，触发元素始终有真实布局尺寸，定位不再跑偏。 */}
                        <span className="absolute right-1.5 top-1/2 flex shrink-0 -translate-y-1/2 items-center gap-0.5 opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto">
                          <button
                            type="button"
                            title={`在「${project.name}」下新建会话 (${getAcceleratorDisplay(getActiveAccelerator('new-session'))})`}
                            aria-label={`在「${project.name}」下新建会话`}
                            onClick={(event) => {
                              event.stopPropagation()
                              void sessionHandlers.onNewSessionInProject(project.id)
                            }}
                            className="grid size-5 place-items-center rounded text-foreground/50 hover:bg-foreground/[0.08] hover:text-foreground/80"
                          >
                            <Plus size={12} />
                          </button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                title="项目操作"
                                aria-label={`「${project.name}」项目操作`}
                                onClick={(event) => event.stopPropagation()}
                                className="grid size-5 place-items-center rounded text-foreground/50 hover:bg-foreground/[0.08] hover:text-foreground/80 data-[state=open]:bg-foreground/[0.08] data-[state=open]:text-foreground/80"
                              >
                                <MoreHorizontal size={12} />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44 z-[9999] min-w-0 p-0.5">
                              {renderProjectMenuItems(DropdownMenuItem, DropdownMenuSeparator)}
                            </DropdownMenuContent>
                          </DropdownMenu>
                          {/* 折叠按钮：对齐「分组方式：日期」的日期标题行——hover 才浮现，放在「⋯」右边 */}
                          <button
                            type="button"
                            aria-label={expanded ? `折叠${project.name}` : `展开${project.name}`}
                            onClick={(event) => {
                              event.stopPropagation()
                              toggleCollapsed(project.id)
                            }}
                            className="grid size-5 place-items-center rounded text-foreground/50 hover:bg-foreground/[0.08] hover:text-foreground/80"
                          >
                            <ChevronRight
                              size={12}
                              className={cn('transition-transform duration-fast', expanded && 'rotate-90')}
                            />
                          </button>
                        </span>
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-44 z-[9999] min-w-0 p-0.5">
                      {renderProjectMenuItems(ContextMenuItem, ContextMenuSeparator)}
                    </ContextMenuContent>
                  </ContextMenu>

                  {/* 项目下按任务族展示；预览上限按根任务计数，子任务不会挤占名额。 */}
                  {expanded && projectTrees.length > 0 && (
                    <div className="mt-0.5 flex flex-col gap-0.5 pb-1">
                      {(expandedProjectIds.has(project.id) || projectTrees.length <= PROJECT_MODE_PREVIEW_LIMIT
                        ? projectTrees
                        : projectTrees.slice(0, PROJECT_MODE_PREVIEW_LIMIT)
                      ).map(renderSessionTree)}
                      {projectTrees.length > PROJECT_MODE_PREVIEW_LIMIT && !expandedProjectIds.has(project.id) && (
                        <button
                          type="button"
                          onClick={() => setExpandedProjectIds((prev) => new Set(prev).add(project.id))}
                          className="text-left px-1.5 py-1 rounded-md text-[12px] text-foreground/35 hover:bg-foreground/[0.03] hover:text-foreground/60 transition-colors titlebar-no-drag"
                        >
                          显示全部 ({projectTrees.length})
                        </button>
                      )}
                      {expandedProjectIds.has(project.id) && projectTrees.length > PROJECT_MODE_PREVIEW_LIMIT && (
                        <button
                          type="button"
                          onClick={() => setExpandedProjectIds((prev) => { const next = new Set(prev); next.delete(project.id); return next })}
                          className="text-left px-1.5 py-1 rounded-md text-[12px] text-foreground/35 hover:bg-foreground/[0.03] hover:text-foreground/60 transition-colors titlebar-no-drag"
                        >
                          收起
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 删除确认 */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>永久删除已归档项目</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>永久删除「{deleteTarget?.name ?? ''}」不可撤销。Task、Run、会话引用和工作目录不会被静默忽略。</p>
                {impactLoading ? <p>正在分析影响…</p> : deleteImpact ? (
                  <div className="rounded-lg bg-muted/50 p-3 text-xs leading-5 text-foreground/70">
                    <p>{deleteImpact.taskCount} 个 Task · {deleteImpact.runCount} 个历史 Run · {deleteImpact.sessionCount} 个关联会话</p>
                    <p>{deleteImpact.assetCount} 个资料文件 · {deleteImpact.hasKnowledge ? '包含 Project Knowledge' : '无 Project Knowledge'}</p>
                    {deleteImpact.hasManagedWorkdir ? <p className="mt-1 font-medium text-destructive">将同时永久删除 Workspace 托管 workdir 内的全部文件</p> : null}
                    {deleteImpact.blockers.map((blocker) => <p key={blocker} className="mt-1 text-destructive">{blocker}</p>)}
                  </div>
                ) : <p className="text-destructive">未能完成影响分析，禁止删除。</p>}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting || impactLoading || !deleteImpact?.canPurge}
              onClick={(event) => { event.preventDefault(); void handleDeleteProject() }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? '删除中…' : '永久删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
