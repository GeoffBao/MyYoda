/**
 * SidebarProjectsTab — 会话列表「分组方式：项目」视图（对齐 Proma：项目 = 工作区）
 *
 * 挂载于 LeftSidebar groupBy === 'project' 时：
 * - 每个工作区（项目）一个行：文件夹图标（参考 Heptabase 风格：闭合 Folder = 折叠，张开 FolderOpen = 展开，常驻显示不依赖 hover）+ 名称 + 本地目录徽标 + 会话树（updatedAt 倒序）
 * - **展开/折叠两种状态独立共存**：
 *   1. 手动展开（点击项目行 toggle）：显示该项目下全部会话（分页，超过 8 条可「显示全部」），纯手动状态，不受会话切换影响
 *   2. 默认折叠时：若右侧当前打开的会话属于该项目，则单独露出这一条（peek，纯渲染时根据 activeSessionId 实时推导，无需手动；会话切换到其他项目时旧的 peek 自动收起）；不属于该项目则什么都不显示
 * - 点击行 = 切换到该工作区（导航）+ toggle 它自己的手动展开状态（不影响其他项目）；hover 菜单：新会话 / 看板 / 重命名 / 重新关联目录 / 删除
 * - 行右侧聚合注意力点：取组内会话最高优先级状态（blocked > running > completed）
 * - 全部工作区均展示（含默认工作区）；KanbanProject 兼容层保留在看板内，不再作为侧栏分组源
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  AlertTriangle,
  ChevronRight,
  Clock,
  Folder,
  FolderOpen,
  LayoutDashboard,
  MoreHorizontal,
  Pencil,
  Plus,
  Settings,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import type { AgentSessionMeta, SessionGroup, LocalProjectRootStatus } from '@myyoda/shared'
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
  projectPageTabAtom,
} from '@/atoms/project-atoms'
import { activeViewAtom, agentSkillsTabAtom } from '@/atoms/active-view'
import { MarqueeText } from '@/components/ui/marquee-text'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useWorkspaceActions } from '@/hooks/useWorkspaceActions'
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
import { LocalProjectBadge } from '@/components/agent-skills/LocalProjectBadge'
import {
  buildAgentSessionTrees,
  getSessionStatus,
  getSessionTreeActivityAt,
  getSessionTreeProgress,
  getSessionTreeStatus,
  treeContainsSessionId,
  type AgentSessionTreeItem,
} from './sidebar-session-tree'
import {
  filterGroupableSessions,
  resolveProjectTreeAttention,
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
  onClearProjectBinding: (sessionId: string) => void | Promise<void>
  /** 在工作区/项目下新建会话（draft；workspace=项目后 projectId 语义收敛为 workspaceId） */
  onNewSessionInProject: (workspaceId: string) => void | Promise<void>
  sessionGroups: SessionGroup[]
  onMoveToGroup: (sessionId: string, groupId?: string) => void | Promise<void>
  onCreateGroup: (sessionId: string) => void
}

interface SidebarProjectsTabProps {
  sessionHandlers: ProjectSessionHandlers
}

/** 项目行聚合注意力点的优先级：blocked > running > completed（学 Synara/Superset 聚合指示） */
const ATTENTION_DOT_CLASS: Record<string, string> = {
  blocked: 'bg-destructive',
  running: 'bg-amber-500 animate-pulse',
  completed: 'bg-emerald-500',
}

/** 项目手动展开后每个 workspace 下默认展示的会话数量上限；超出部分折叠在「显示全部」按钮后 */
const PROJECT_MODE_PREVIEW_LIMIT = 8
/** 「自动任务」合成组专用折叠 key（不对应真实工作区） */
const AUTOMATION_GROUP_KEY = '__automations__'
/** 自动任务组默认最多展示的会话数，超出折叠为「显示更多」 */
const AUTOMATION_SESSION_VISIBLE_LIMIT = 4

/** 本地目录状态徽标文案 */
const PROJECT_ROOT_STATUS_LABEL: Record<LocalProjectRootStatus, string> = {
  available: '本地项目',
  missing: '目录缺失',
  not_directory: '不是文件夹',
  unavailable: '不可访问',
}

export function SidebarProjectsTab({ sessionHandlers }: SidebarProjectsTabProps): React.ReactElement {
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const { selectWorkspace, relinkWorkspaceProjectRoot, restoreWorkspaceProjectRoot } = useWorkspaceActions()

  const agentSessions = useAtomValue(agentSessionsAtom)
  const indicatorMap = useAtomValue(agentSessionIndicatorMapAtom)
  const activeSessionId = useAtomValue(activeSessionIdAtom)
  const draftSessionIds = useAtomValue(draftSessionIdsAtom)
  const setCodeMainView = useSetAtom(codeMainViewAtom)
  const setActiveProjectPageId = useSetAtom(activeProjectPageIdAtom)
  const setProjectPageTab = useSetAtom(projectPageTabAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const setAgentSkillsTab = useSetAtom(agentSkillsTabAtom)

  const [collapsedIds, setCollapsedIds] = React.useState<Set<string>>(new Set())
  /** 用户手动展开的工作区（项目行）集合：默认都是折叠（空集合），展开后显示全部会话；
   * 与会话 peek（折叠时露出当前激活会话的那一条）独立不干扰。 */
  const [manuallyExpandedWorkspaceIds, setManuallyExpandedWorkspaceIds] = React.useState<Set<string>>(new Set())
  /** 已完全展开的工作区（点击「显示全部」后展示全部任务族，不再分批） */
  const [expandedWorkspaceIds, setExpandedWorkspaceIds] = React.useState<Set<string>>(new Set())
  const [expandedParentIds, setExpandedParentIds] = React.useState<Set<string>>(new Set())
  const [collapsedParentIds, setCollapsedParentIds] = React.useState<Set<string>>(new Set())
  const [relativeTimeNow, setRelativeTimeNow] = React.useState(() => Date.now())

  React.useEffect(() => {
    const timer = window.setInterval(() => setRelativeTimeNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  /** 全部工作区（项目）行：保持索引顺序，default 也作为一行 */
  const visibleWorkspaces = React.useMemo(() => workspaces.slice(), [workspaces])

  /**
   * 可入分组的会话（跨全部工作区，按各自 workspaceId 归组；对齐 Proma：侧栏项目区
   * 展示所有项目=工作区，每个组展开自己的会话）。置顶任务族由上方置顶区统一展示。
   */
  const groupableSessions = React.useMemo(
    () => filterGroupableSessions(agentSessions, draftSessionIds, null),
    [agentSessions, draftSessionIds],
  )

  const allSessionTrees = React.useMemo(
    () => buildAgentSessionTrees(groupableSessions),
    [groupableSessions],
  )

  /** workspaceId（缺失历史会话归 ''）→ 会话树，组内按最近活动倒序 */
  const treesByWorkspace = React.useMemo(() => {
    const byWorkspace = new Map<string, AgentSessionTreeItem[]>()
    for (const tree of allSessionTrees) {
      const key = tree.session.workspaceId ?? ''
      const items = byWorkspace.get(key) ?? []
      items.push(tree)
      byWorkspace.set(key, items)
    }
    for (const items of byWorkspace.values()) {
      items.sort((a, b) => getSessionTreeActivityAt(b) - getSessionTreeActivityAt(a))
    }
    return byWorkspace
  }, [allSessionTrees])

  /** 自动任务合成组（sourceAutomationId 且未置顶；置顶任务族在置顶区展示，二者互斥） */
  const automationTrees = React.useMemo(() => {
    const sessions = agentSessions.filter((session) =>
      !session.archived
      && !session.pinned
      && !draftSessionIds.has(session.id)
      && !!session.sourceAutomationId,
    )
    const trees = buildAgentSessionTrees(sessions)
    trees.sort((a, b) => getSessionTreeActivityAt(b) - getSessionTreeActivityAt(a))
    return trees
  }, [agentSessions, draftSessionIds])

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

  /** 点击工作区行：切换到该工作区（导航）+ toggle 它自己的手动展开状态（不影响其他项目）。
   * 会话 peek（折叠时露出当前激活会话那一条）与手动展开独立，完全由渲染时根据 activeSessionId 实时推导，不受此处影响。 */
  const handleSelectWorkspace = React.useCallback((workspaceId: string) => {
    selectWorkspace(workspaceId)
    setManuallyExpandedWorkspaceIds((prev) => {
      const next = new Set(prev)
      if (next.has(workspaceId)) next.delete(workspaceId)
      else next.add(workspaceId)
      return next
    })
  }, [selectWorkspace])

  /** 打开该工作区的任务看板 */
  const openWorkspaceBoard = React.useCallback((workspaceId: string) => {
    if (workspaceId !== currentWorkspaceId) selectWorkspace(workspaceId)
    enterWork()
  }, [currentWorkspaceId, enterWork, selectWorkspace])

  /** 打开该工作区的详情页（工作区资料，参考 craft ProjectInfoPage） */
  const openWorkspacePage = React.useCallback((workspaceId: string) => {
    if (workspaceId !== currentWorkspaceId) selectWorkspace(workspaceId)
    setActiveProjectPageId(workspaceId)
    setProjectPageTab('overview')
    setCodeMainView('project')
    setActiveView('conversations')
  }, [currentWorkspaceId, selectWorkspace, setActiveProjectPageId, setProjectPageTab, setCodeMainView, setActiveView])

  /** 打开该工作区的插件中心（先切到该工作区，再进入总览） */
  const openPluginCenter = React.useCallback((workspaceId: string) => {
    if (workspaceId !== currentWorkspaceId) selectWorkspace(workspaceId)
    setAgentSkillsTab('overview')
    setActiveView('agent-skills')
  }, [currentWorkspaceId, selectWorkspace, setAgentSkillsTab, setActiveView])

  /** 行菜单：重新关联本地项目目录 */
  const handleRelinkRoot = React.useCallback(async (workspaceId: string, name: string) => {
    const result = await window.electronAPI.openFolderDialog()
    if (!result?.path) return
    const updated = await relinkWorkspaceProjectRoot(workspaceId, result.path)
    if (updated) toast.success(`已重新关联「${name}」的本地项目目录`)
  }, [relinkWorkspaceProjectRoot])

  /** 行菜单：缺失目录时恢复空目录 */
  const handleRestoreRoot = React.useCallback(async (workspaceId: string, name: string) => {
    const updated = await restoreWorkspaceProjectRoot(workspaceId)
    if (updated) toast.success(`已在原路径恢复空项目目录: ${updated.projectRootPath}`)
  }, [restoreWorkspaceProjectRoot])

  /** 行菜单：删除工作区（带确认；default / 最后一个由主进程保护） */
  const handleDeleteWorkspace = React.useCallback(async (workspaceId: string, name: string) => {
    if (!window.confirm(`删除工作区「${name}」将同时删除其会话、自动任务与托管数据，且无法恢复；绑定的外部工程目录不会被删除。确定继续吗？`)) return
    try {
      await window.electronAPI.deleteAgentWorkspace(workspaceId)
      toast.success(`已删除工作区「${name}」`)
    } catch (error) {
      const msg = error instanceof Error ? error.message : '删除失败'
      toast.error(msg)
    }
  }, [])

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
        onClearProjectBinding={nested ? undefined : sessionHandlers.onClearProjectBinding}
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

      {/* 工作区（项目）→ 会话分组 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 scrollbar-thin">
        <div className="flex flex-col gap-0.5">
          {/* 自动任务合成组：聚合自动任务会话，固定排在项目区顶部（方案 A：并入项目区，对齐 Proma） */}
          {automationTrees.length > 0 && (
            <div className="rounded-lg">
              <div
                role="button"
                tabIndex={0}
                onClick={() => toggleCollapsed(AUTOMATION_GROUP_KEY)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    toggleCollapsed(AUTOMATION_GROUP_KEY)
                  }
                }}
                className="group relative flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-foreground/[0.04]"
              >
                <span className="grid size-5 shrink-0 place-items-center rounded-md bg-foreground/[0.045] text-foreground/45">
                  <Clock size={13} />
                </span>
                <MarqueeText text="自动任务" className="min-w-0 flex-1 text-[13px] font-medium" />
                <span className="shrink-0 text-[10px] tabular-nums text-foreground/30">
                  {automationTrees.length}
                </span>
                <ChevronRight
                  size={12}
                  className={cn('shrink-0 text-foreground/30 transition-transform duration-fast', !collapsedIds.has(AUTOMATION_GROUP_KEY) && 'rotate-90')}
                />
              </div>
              {!collapsedIds.has(AUTOMATION_GROUP_KEY) && automationTrees.length > 0 && (
                <div className="mt-0.5 flex flex-col gap-0.5 pb-1">
                  {(expandedWorkspaceIds.has(AUTOMATION_GROUP_KEY) || automationTrees.length <= AUTOMATION_SESSION_VISIBLE_LIMIT
                    ? automationTrees
                    : automationTrees.slice(0, AUTOMATION_SESSION_VISIBLE_LIMIT)
                  ).map(renderSessionTree)}
                  {automationTrees.length > AUTOMATION_SESSION_VISIBLE_LIMIT && !expandedWorkspaceIds.has(AUTOMATION_GROUP_KEY) && (
                    <button
                      type="button"
                      onClick={() => setExpandedWorkspaceIds((prev) => new Set(prev).add(AUTOMATION_GROUP_KEY))}
                      className="text-left px-1.5 py-1 rounded-md text-[12px] text-foreground/35 hover:bg-foreground/[0.03] hover:text-foreground/60 transition-colors titlebar-no-drag"
                    >
                      显示更多 ({automationTrees.length - AUTOMATION_SESSION_VISIBLE_LIMIT})
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {visibleWorkspaces.length === 0 ? (
            <div className="px-2 py-8 text-center text-[13px] text-foreground/35">
              暂无项目
            </div>
          ) : (
          <div className="flex flex-col gap-0.5">
            {visibleWorkspaces.map((ws) => {
              const wsId = ws.id
              const isCurrent = wsId === currentWorkspaceId
              const wsTrees = treesByWorkspace.get(wsId) ?? []
              const isManuallyExpanded = manuallyExpandedWorkspaceIds.has(wsId)
              // 折叠时：只 peek 当前右侧激活会话所属的那一条（不展示该项目其他会话），随 activeSessionId 变化自动跟随；已手动展开时不需要 peek（已在全部列表里）
              const peekTree = !isManuallyExpanded && activeSessionId ? wsTrees.find((tree) => treeContainsSessionId(tree, activeSessionId)) : undefined
              // 图标/aria-expanded 反映「下面是否有内容在显示」（全部列表或 peek 都算），与「是否手动展开」区分开
              const expanded = isManuallyExpanded || !!peekTree
              const attention = resolveProjectTreeAttention(wsTrees, indicatorMap)
              const showExpandedAll = expandedWorkspaceIds.has(wsId)

              return (
                <div key={wsId} className="rounded-lg">
                  {/* 工作区行：点击 = 切换到该工作区 + toggle 手动展开/折叠（不影响其他项目）；右键/双指点击 = 操作菜单 */}
                  <ContextMenu>
                    <ContextMenuTrigger asChild>
                      <div
                        role="button"
                        tabIndex={0}
                        aria-expanded={expanded}
                        onClick={() => handleSelectWorkspace(wsId)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            handleSelectWorkspace(wsId)
                          }
                        }}
                        className={cn(
                          'group relative flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors',
                          isCurrent ? 'bg-foreground/[0.05]' : 'hover:bg-foreground/[0.04]',
                        )}
                      >
                        {/* 项目图标：参考 Heptabase，常驻显示开合状态（不依赖 hover）——闭合 Folder = 折叠（默认），张开 FolderOpen = 正在显示内容（手动展开或 peek 着激活会话） */}
                        <span className="grid size-5 shrink-0 place-items-center rounded-md bg-foreground/[0.045] text-foreground/45">
                          {expanded ? <FolderOpen size={13} /> : <Folder size={13} />}
                        </span>
                        <span className="flex min-w-0 items-center gap-1.5">
                          <MarqueeText text={ws.name} className="min-w-0 flex-1 text-[13px] font-medium" />
                          {isCurrent && (
                            <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary">
                              当前
                            </span>
                          )}
                          {ws.projectRootPath && (
                            <LocalProjectBadge workingDirectory={ws.projectRootPath} className="bg-foreground/[0.045] text-foreground/40" />
                          )}
                          {ws.projectRootStatus && ws.projectRootStatus !== 'available' && (
                            <span
                              className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-amber-500/10 px-1.5 py-px text-[10px] font-medium text-amber-600 dark:text-amber-400"
                              title={ws.projectRootPath}
                            >
                              <AlertTriangle size={9} />
                              {PROJECT_ROOT_STATUS_LABEL[ws.projectRootStatus]}
                            </span>
                          )}
                        </span>

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
                        {wsTrees.length > 0 && (
                          <span className="shrink-0 text-[10px] tabular-nums text-foreground/30 group-hover:hidden">
                            {wsTrees.length}
                          </span>
                        )}

                        {/* 占位 spacer，把 hover 操作按钮顶到右侧，避免徽章/计数被覆盖 */}
                        <span className="min-w-[4px] flex-1" aria-hidden="true" />

                        {/* hover 操作：新会话 + 更多菜单（对齐 Proma：无独立折叠按钮） */}
                        <span className="absolute right-1.5 top-1/2 flex shrink-0 -translate-y-1/2 items-center gap-0.5 opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto">
                          <button
                            type="button"
                            title={`在「${ws.name}」下新建会话`}
                            aria-label={`在「${ws.name}」下新建会话`}
                            onClick={(event) => {
                              event.stopPropagation()
                              void sessionHandlers.onNewSessionInProject(wsId)
                            }}
                            className="grid size-5 place-items-center rounded text-foreground/50 hover:bg-foreground/[0.08] hover:text-foreground/80"
                          >
                            <Plus size={12} />
                          </button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                title="工作区操作"
                                aria-label={`「${ws.name}」工作区操作`}
                                onClick={(event) => event.stopPropagation()}
                                className="grid size-5 place-items-center rounded text-foreground/50 hover:bg-foreground/[0.08] hover:text-foreground/80 data-[state=open]:bg-foreground/[0.08] data-[state=open]:text-foreground/80"
                              >
                                <MoreHorizontal size={12} />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44 z-[9999] min-w-0 p-0.5">
                              {!isCurrent && (
                                <DropdownMenuItem className="text-xs py-1 [&>svg]:size-3.5" onSelect={() => handleSelectWorkspace(wsId)}>
                                  <FolderOpen size={13} />
                                  切换到该工作区
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem className="text-xs py-1 [&>svg]:size-3.5" onSelect={() => openWorkspaceBoard(wsId)}>
                                <LayoutDashboard size={13} />
                                查看任务
                              </DropdownMenuItem>
                              <DropdownMenuItem className="text-xs py-1 [&>svg]:size-3.5" onSelect={() => openWorkspacePage(wsId)}>
                                <FolderOpen size={13} />
                                工作区资料
                              </DropdownMenuItem>
                              <DropdownMenuItem className="text-xs py-1 [&>svg]:size-3.5" onSelect={() => openPluginCenter(wsId)}>
                                <Settings size={13} />
                                打开插件
                              </DropdownMenuItem>
                              {ws.projectRootPath ? (
                                ws.projectRootStatus === 'missing' ? (
                                  <DropdownMenuItem className="text-xs py-1 [&>svg]:size-3.5" onSelect={() => void handleRestoreRoot(wsId, ws.name)}>
                                    <FolderOpen size={13} />
                                    恢复缺失的项目目录
                                  </DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem className="text-xs py-1 [&>svg]:size-3.5" onSelect={() => void handleRelinkRoot(wsId, ws.name)}>
                                    <FolderOpen size={13} />
                                    重新关联项目目录
                                  </DropdownMenuItem>
                                )
                              ) : (
                                <DropdownMenuItem className="text-xs py-1 [&>svg]:size-3.5" onSelect={() => void handleRelinkRoot(wsId, ws.name)}>
                                  <FolderOpen size={13} />
                                  关联本地项目目录
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator className="my-0.5" />
                              <DropdownMenuItem
                                className="text-xs py-1 [&>svg]:size-3.5 text-destructive focus:text-destructive"
                                onSelect={() => void handleDeleteWorkspace(wsId, ws.name)}
                              >
                                <Trash2 size={13} />
                                删除工作区…
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </span>
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-44 z-[9999] min-w-0 p-0.5">
                      {!isCurrent && (
                        <ContextMenuItem className="text-xs py-1 [&>svg]:size-3.5" onSelect={() => handleSelectWorkspace(wsId)}>
                          <FolderOpen size={13} />
                          切换到该工作区
                        </ContextMenuItem>
                      )}
                      <ContextMenuItem className="text-xs py-1 [&>svg]:size-3.5" onSelect={() => openWorkspaceBoard(wsId)}>
                        <LayoutDashboard size={13} />
                        查看任务
                      </ContextMenuItem>
                      <ContextMenuItem className="text-xs py-1 [&>svg]:size-3.5" onSelect={() => openPluginCenter(wsId)}>
                        <Settings size={13} />
                        打开插件
                      </ContextMenuItem>
                      <ContextMenuSeparator className="my-0.5" />
                      <ContextMenuItem
                        className="text-xs py-1 [&>svg]:size-3.5 text-destructive focus:text-destructive"
                        onSelect={() => void handleDeleteWorkspace(wsId, ws.name)}
                      >
                        <Trash2 size={13} />
                        删除工作区…
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>

                  {/* 手动展开时显示该工作区下全部任务族（分页）；折叠时只 peek 当前右侧激活会话那一条 */}
                  {isManuallyExpanded && wsTrees.length > 0 && (
                    <div className="mt-0.5 flex flex-col gap-0.5 pb-1">
                      {(showExpandedAll || wsTrees.length <= PROJECT_MODE_PREVIEW_LIMIT
                        ? wsTrees
                        : wsTrees.slice(0, PROJECT_MODE_PREVIEW_LIMIT)
                      ).map(renderSessionTree)}
                      {wsTrees.length > PROJECT_MODE_PREVIEW_LIMIT && !showExpandedAll && (
                        <button
                          type="button"
                          onClick={() => setExpandedWorkspaceIds((prev) => new Set(prev).add(wsId))}
                          className="text-left px-1.5 py-1 rounded-md text-[12px] text-foreground/35 hover:bg-foreground/[0.03] hover:text-foreground/60 transition-colors titlebar-no-drag"
                        >
                          显示全部 ({wsTrees.length})
                        </button>
                      )}
                      {showExpandedAll && wsTrees.length > PROJECT_MODE_PREVIEW_LIMIT && (
                        <button
                          type="button"
                          onClick={() => setExpandedWorkspaceIds((prev) => { const next = new Set(prev); next.delete(wsId); return next })}
                          className="text-left px-1.5 py-1 rounded-md text-[12px] text-foreground/35 hover:bg-foreground/[0.03] hover:text-foreground/60 transition-colors titlebar-no-drag"
                        >
                          收起
                        </button>
                      )}
                    </div>
                  )}
                  {!isManuallyExpanded && peekTree && (
                    <div className="mt-0.5 flex flex-col gap-0.5 pb-1">
                      {renderSessionTree(peekTree)}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          )}
        </div>
      </div>
    </div>
  )
}
