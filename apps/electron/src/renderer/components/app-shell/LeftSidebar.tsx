/**
 * LeftSidebar - 左侧导航栏
 *
 * 包含：
 * - Chat/Agent 模式切换器
 * - 导航菜单项（点击切换主内容区视图）
 * - 置顶对话区域（可展开/收起）
 * - 对话列表（新对话按钮 + 右键菜单 + 按 updatedAt 降序排列）
 */

import * as React from 'react'
import { useAtom, useSetAtom, useAtomValue, useStore } from 'jotai'
import { toast } from 'sonner'
import { Pin, PinOff, Settings, Plus, Trash2, Pencil, Search, Archive, ArchiveRestore, ArrowLeft, Bot, MoreHorizontal, Folder, FolderOpen, FolderInput, GripVertical, Clock, CalendarDays, ChevronRight, ChevronDown, ChevronUp, GitBranch, Download, Loader2, RotateCw, Layers, LayoutDashboard, PenTool, Library, House, Blocks, ClipboardList, Compass, MessagesSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { MarqueeText } from '@/components/ui/marquee-text'
import { VirtualSidebarList, type VirtualSidebarRow } from '@/components/ui/virtual-sidebar-list'
import { ReleaseNotesPopover } from '@/components/settings/ReleaseNotesPopover'
import { useReleaseNotes } from '@/hooks/useReleaseNotes'
import { SidebarToggleButton } from './SidebarToggleButton'
import { ModeSwitcher } from './ModeSwitcher'
import { TabNavigationControls } from '@/components/tabs/TabNavigationControls'
import { UserAvatar } from '@/components/chat/UserAvatar'
import { activeViewAtom, agentSkillsTabAtom } from '@/atoms/active-view'
import type { PluginCenterTab } from '@/lib/plugin-center-model'
import { discoverCommunityUnreadAtom, discoverFeedUnreadAtom } from '@/atoms/discover-atoms'
import { automationFormAtom, automationsAtom } from '@/atoms/automation-atoms'
import { planningTabAtom } from '@/atoms/planning-atoms'
import { appModeAtom, type AppMode } from '@/atoms/app-mode'
import { settingsOpenAtom, settingsTabAtom } from '@/atoms/settings-tab'
import {
  conversationsAtom,
  currentConversationIdAtom,
  selectedModelAtom,
  streamingConversationIdsAtom,
  conversationModelsAtom,
  conversationContextLengthAtom,
  conversationThinkingEnabledAtom,
  conversationParallelModeAtom,
  agentSideChatMapAtom,
} from '@/atoms/chat-atoms'
import {
  agentSessionsAtom,
  agentSDKMessagesCacheAtom,
  currentAgentSessionIdAtom,
  agentSessionIndicatorMapAtom,
  unviewedCompletedSessionIdsAtom,
  agentChannelIdAtom,
  agentModelIdAtom,
  agentSessionChannelMapAtom,
  agentSessionModelMapAtom,
  agentSessionPathMapAtom,
  currentAgentWorkspaceIdAtom,
  agentWorkspacesAtom,
  workspaceCapabilitiesVersionAtom,
  agentDiffPanelTabAtom,
  agentDiffRefreshVersionAtom,
  agentDiffUnseenChangesAtom,
  agentDiffUnseenFilesAtom,
  agentNonGitFileChangesAtom,
  agentFileChangesCurrentRunAtom,
  agentDiffDataAtom,
  agentSidePanelOpenMapAtom,
  agentStreamingStatesAtom,
  liveMessagesMapAtom,
  agentSessionPendingFilesAtom,
  agentSessionDraftsAtom,
  cleanupDeletedAgentSessionAtoms,
  automationGroupOrderAtom,
} from '@/atoms/agent-atoms'
import type { SessionIndicatorStatus } from '@/atoms/agent-atoms'
import { previewPanelOpenMapAtom, previewFileMapAtom } from '@/atoms/preview-atoms'
import { cleanupDeletedBrowserSessionAtoms } from '@/atoms/browser-atoms'
import { clearPreviewCacheForSession } from '@/components/diff/DiffTabContent'
import {
  tabsAtom,
  activeTabIdAtom,
  activeSessionIdAtom,
  sidebarCollapsedAtom,
  closeTab,
  openTab,
  TUTORIAL_TAB_ID,
  updateTabTitle,
  sessionViewStateMapAtom,
} from '@/atoms/tab-atoms'
import { userProfileAtom } from '@/atoms/user-profile'
import { selectedProjectIdAtom, serverKanbanProjectsAtom, codeMainViewAtom, pendingTaskEditorTargetAtom, taskBoardScopeAtom } from '@/atoms/project-atoms'
import { isHiddenKanbanProjectKind } from '@/components/app-shell/kanban/types'
import { serverTaskSummariesAtom } from '@/atoms/kanban-atoms'
import { sessionGroupsAtom } from '@/atoms/session-groups-atoms'
import { sessionListPreferenceAtom } from '@/atoms/session-list-preference-atoms'
import { WorkspaceLabelManagerDialog } from '@/components/labels/WorkspaceLabelManagerDialog'
import { labelManagerOpenAtom, labelManagerWorkspaceRootAtom } from '@/atoms/label-manager-atoms'
import { workspaceLabelsAtom, loadWorkspaceLabels } from '@/atoms/workspace-labels-atoms'
import type { WorkspaceLabel } from '@myyoda/shared/labels'
import { buildRecentSessionList } from './sidebar-session-views'
import { selectDraftSessionsWithContent } from './draft-recall-model'
import { removeAgentDraft } from '@/lib/agent-draft-persistence'
import {
  buildAgentSessionTrees,
  getSessionStatus,
  getSessionTreeActivityAt,
  getSessionTreeCustomGroupId,
  getSessionTreeProgress,
  getSessionTreeStatus,
  getWorkspaceGroupStatus,
  hasTaskDraftAncestor,
  isDelegatedChildSession,
  isTaskTree,
  sortSessionTrees,
  splitTaskTreeChildren,
  treeContainsSessionId,
  type AgentSessionTreeItem,
} from './sidebar-session-tree'
import { CreateSessionGroupDialog } from './CreateSessionGroupDialog'
import { sidebarViewModeAtom, MIN_LEFT_SIDEBAR_WIDTH } from '@/atoms/sidebar-atoms'
import { hasUpdateAtom, updateStatusAtom, type UpdateStatus } from '@/atoms/updater'
import { draftSessionIdsAtom } from '@/atoms/draft-session-atoms'
import { hasEnvironmentIssuesAtom } from '@/atoms/environment'
import { promptConfigAtom, selectedPromptIdAtom, conversationPromptIdAtom } from '@/atoms/system-prompt-atoms'
import { interfaceVariantAtom } from '@/atoms/theme'
import { sessionHoverPreviewEnabledAtom } from '@/atoms/ui-preferences'
import { newTaskProjectFlowOpenAtom } from '@/atoms/project-context-picker'
import { searchDialogOpenAtom } from '@/atoms/search-dialog'
import { useOpenSession } from '@/hooks/useOpenSession'
import { useCreateSession } from '@/hooks/useCreateSession'
import { useSyncActiveTabSideEffects } from '@/hooks/useSyncActiveTabSideEffects'
import { NewTaskProjectFlowDialog } from './NewTaskProjectFlowDialog'
import { CollapsedWorkspacePopover } from '@/components/agent/CollapsedWorkspacePopover'
import { MoveSessionDialog } from '@/components/agent/MoveSessionDialog'
import {
  SessionMiniMapPopover,
  useSessionMiniMapHover,
  type SessionMiniMapType,
} from '@/components/session-preview/SessionMiniMapPopover'
import { detectIsMac } from '@/lib/platform'
import { getActiveAccelerator, getAcceleratorDisplay } from '@/lib/shortcut-registry'
import {
  collectAgentSessionTreeIds,
  isAgentSessionVisibleInTrees,
  replaceAgentSessionInFreshnessOrder,
  sortAgentSessionsByUpdatedAtDesc,
} from '@/lib/agent-session-list'
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
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import type { ConversationMeta, AgentSessionMeta, AgentWorkspace, WorkspaceCapabilities, SessionGroup } from '@myyoda/shared'
import type { KanbanProject } from './kanban/types'
import { SidebarModule } from './SidebarModule'
import { SidebarProjectsTab, type ProjectSessionHandlers } from './SidebarProjectsTab'
import { formatSidebarModuleCount } from './sidebar-module-model'
import { anyFeatureActive } from './sidebar-features-model'

import { CreateProjectDialog } from '@/components/work/CreateProjectDialog'
import { AgentSessionItem, SessionItemActions, STATUS_DOT_CLASS } from './AgentSessionItem'
import { deleteAgentSessionChildren, shouldDeleteAgentParent } from './agent-deletion-model'

function getSidebarUpdateLabel(status: string, version?: string): string {
  const versionText = version ? ` v${version}` : ''
  switch (status) {
    case 'available':
      return `发现新版本${versionText}`
    case 'downloading':
      return `正在下载更新${versionText}`
    case 'downloaded':
      return `立即重启更新${versionText}`
    default:
      return '软件更新'
  }
}

function getSidebarUpdateButtonText(status: string): string {
  switch (status) {
    case 'available':
      return '查看'
    case 'downloading':
      return '下载中'
    case 'downloaded':
      return '更新'
    default:
      return '更新'
  }
}

interface SidebarUpdateButtonProps {
  status: UpdateStatus
  onClick: () => void
  tooltipSide: React.ComponentPropsWithoutRef<typeof TooltipContent>['side']
  className: string
  readyDotClassName: string
  showText?: boolean
  hideIcon?: boolean
}

function SidebarUpdateButton({
  status,
  onClick,
  tooltipSide,
  className,
  readyDotClassName,
  showText = false,
  hideIcon = false,
}: SidebarUpdateButtonProps): React.ReactElement {
  const label = getSidebarUpdateLabel(status.status, status.version)
  const buttonText = getSidebarUpdateButtonText(status.status)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          className={cn('relative bg-primary/10 text-primary transition-colors titlebar-no-drag hover:bg-primary/15', className)}
        >
          {!hideIcon && (
            status.status === 'downloading' ? (
              <Loader2 size={16} className="animate-spin" />
            ) : status.status === 'downloaded' ? (
              <RotateCw size={16} />
            ) : (
              <Download size={16} />
            )
          )}
          {showText && <span>{buttonText}</span>}
          {status.status === 'downloaded' && (
            <span className={readyDotClassName} />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide}>{label}</TooltipContent>
    </Tooltip>
  )
}


export interface LeftSidebarProps {
  /** 可选固定宽度，默认使用 CSS 响应式宽度 */
  width?: number
  /** 拖拽过程中禁用 CSS transition，保证即时响应 */
  noTransition?: boolean
}

/** 日期分组标签 */
type DateGroup = '今天' | '昨天' | '前天' | '更早'

interface AgentProjectGroup {
  workspace: AgentWorkspace
  sessions: AgentSessionMeta[]
}

/** 合成「自动任务」虚拟项目组的工作区 ID（不对应真实 workspace，仅用于聚合自动任务会话） */
const AUTOMATION_GROUP_ID = '__automations__'
/** 置顶（Agent 模式）分组在 collapsedFlatGroupIds 中的 key，与日期分组的 groupId/label 隔离 */
const PINNED_AGENT_GROUP_KEY = '__pinned-agent__'
/** 置顶会话默认最多展示数量，超出部分折叠为「显示更多」 */
const PINNED_SESSION_VISIBLE_LIMIT = 5
/** 自动任务组默认最多展示的会话数，超出部分折叠为「显示更多」，交互对齐置顶区 */
const AUTOMATION_SESSION_VISIBLE_LIMIT = 4
/** 供合成组复用 AgentProjectGroupItem 时填充无意义的 workspace 专属回调 */
const noopVoid = (): void => {}
const noopAsync = async (): Promise<void> => {}
const noopDragEvent = (_e: React.DragEvent, _workspaceId?: string): void => {}
/** 非当前工作区组的空项目列表；模块级常量保证引用稳定，不破坏 React.memo */
/** 会话列表预览数量（折叠态显示的非活跃会话上限；活跃会话不受此限制） */
const PROJECT_SESSION_PREVIEW_LIMIT = 25
/** 最近会话窗口（ms），超过此窗口的旧会话仅在"显示更多"后出现 */
const PROJECT_SESSION_RECENT_WINDOW_MS = 7 * 86_400_000
/** 「显示更多」每次点击额外展开的会话数（增量分页，可多次点击叠加，对齐 Claude 的「Show N more」） */
const PROJECT_SESSION_EXPAND_STEP = 20
/** 非当前工作区组的空项目列表；模块级常量保证引用稳定，不破坏 React.memo */
const SESSION_QUICK_SWITCH_HINT_DELAY_MS = 1000
const SESSION_QUICK_SWITCH_LIMIT = 9
const SESSION_QUICK_SWITCH_KEYDOWN_EVENT = 'myyoda:session-quick-switch-keydown'
const SESSION_QUICK_SWITCH_KEYUP_EVENT = 'myyoda:session-quick-switch-keyup'

const ACTIVE_SESSION_STATUSES: ReadonlySet<SessionIndicatorStatus> = new Set([
  'blocked',
  'running',
  'completed',
])

const ACTIVE_SESSION_STATUS_PRIORITY: Record<SessionIndicatorStatus, number> = {
  blocked: 0,
  running: 1,
  completed: 2,
  idle: 3,
}


interface QuickSwitchTarget {
  id: string
  title: string
  type: SessionMiniMapType
}

function getPrimaryModifierLabel(isMac: boolean): string {
  return isMac ? '⌘' : 'Ctrl'
}

function isPrimaryModifierKey(event: KeyboardEvent, isMac: boolean): boolean {
  if (isMac) {
    return event.key === 'Meta' || event.key === 'OS' || event.code === 'MetaLeft' || event.code === 'MetaRight'
  }
  return event.key === 'Control' || event.code === 'ControlLeft' || event.code === 'ControlRight'
}

function hasOnlyPrimaryModifier(event: KeyboardEvent, isMac: boolean): boolean {
  if (isMac) {
    return event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
  }
  return event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey
}

function getQuickSwitchNumber(event: KeyboardEvent): number | null {
  if (!/^[1-9]$/.test(event.key)) return null
  return Number(event.key)
}

function rectsIntersect(a: DOMRect, b: DOMRect): boolean {
  return a.bottom > b.top && a.top < b.bottom && a.right > b.left && a.left < b.right
}

function isQuickSwitchRowVisible(row: HTMLElement, root: HTMLElement): boolean {
  const rowRect = row.getBoundingClientRect()
  if (rowRect.width <= 0 || rowRect.height <= 0) return false
  if (!rectsIntersect(rowRect, root.getBoundingClientRect())) return false

  let parent = row.parentElement
  while (parent && parent !== root) {
    const style = window.getComputedStyle(parent)
    if (/(auto|scroll|hidden|clip)/.test(`${style.overflow}${style.overflowY}${style.overflowX}`)) {
      const parentRect = parent.getBoundingClientRect()
      if (!rectsIntersect(rowRect, parentRect)) return false
    }
    parent = parent.parentElement
  }

  return true
}

function SessionQuickSwitchKeycap(): React.ReactElement {
  return (
    <span className="session-quick-switch-keycap" aria-hidden="true">
      <span className="session-quick-switch-modifier" />
      <span className="session-quick-switch-number" />
    </span>
  )
}

/** 单条记录所属的日期分组（今天 / 昨天 / 前天 / 更早），对齐 Claude */
function getDateGroupLabel(updatedAt: number, now: number): DateGroup {
  const nowDate = new Date(now)
  const todayStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime()
  const yesterdayStart = todayStart - 86_400_000
  const dayBeforeYesterdayStart = yesterdayStart - 86_400_000
  if (updatedAt >= todayStart) return '今天'
  if (updatedAt >= yesterdayStart) return '昨天'
  if (updatedAt >= dayBeforeYesterdayStart) return '前天'
  return '更早'
}

/** 按 updatedAt 将条目分为 今天 / 昨天 / 前天 / 更早 四组 */
function groupByDate<T extends { updatedAt: number }>(items: T[]): Array<{ label: DateGroup; items: T[] }> {
  const now = Date.now()
  const today: T[] = []
  const yesterday: T[] = []
  const dayBeforeYesterday: T[] = []
  const earlier: T[] = []

  for (const item of items) {
    const label = getDateGroupLabel(item.updatedAt, now)
    if (label === '今天') today.push(item)
    else if (label === '昨天') yesterday.push(item)
    else if (label === '前天') dayBeforeYesterday.push(item)
    else earlier.push(item)
  }

  const groups: Array<{ label: DateGroup; items: T[] }> = []
  if (today.length > 0) groups.push({ label: '今天', items: today })
  if (yesterday.length > 0) groups.push({ label: '昨天', items: yesterday })
  if (dayBeforeYesterday.length > 0) groups.push({ label: '前天', items: dayBeforeYesterday })
  if (earlier.length > 0) groups.push({ label: '更早', items: earlier })
  return groups
}

const RAIL_STATUS_CLASS: Record<SessionIndicatorStatus, string> = {
  idle: 'hidden',
  running: 'border-blue-500 animate-pulse',
  blocked: 'border-orange-500',
  completed: 'border-emerald-500',
}

const SIDEBAR_DRAG_STRIP_HEIGHT = {
  collapsedMac: 50,
  expandedMac: 30,
  collapsed: 8,
  expanded: 4,
} as const

function getRailInitial(title: string): string {
  return title.trim().slice(0, 1).toUpperCase() || '·'
}

/**
 * 是否为「应从工作区会话列表隐藏」的自动任务会话：
 * 来自定时任务（sourceAutomationId）且未被置顶。
 * 这类会话的"家"是「自动任务」视图，始终不出现在普通工作区列表。
 */
function isHiddenAutomationSession(session: AgentSessionMeta): boolean {
  return !!session.sourceAutomationId && !session.pinned
}

/** collaboration 级联操作仍只处理真正的委派子会话，不随展示树语义扩大。 */
function getDirectDelegatedChildren(
  sessions: AgentSessionMeta[],
  parentSessionId: string,
): AgentSessionMeta[] {
  return sessions.filter((session) => (
    session.parentSessionId === parentSessionId
    && !!session.sourceDelegationId
  ))
}

function collectDelegatedSessionTreeIds(sessions: AgentSessionMeta[], rootSessionId: string): Set<string> {
  const ids = new Set<string>([rootSessionId])
  let changed = true

  while (changed) {
    changed = false
    for (const session of sessions) {
      if (ids.has(session.id)) continue
      // 与主进程迁移逻辑保持一致：只处理协作委派子会话。
      if (!session.sourceDelegationId) continue
      if (
        (session.parentSessionId && ids.has(session.parentSessionId))
        || session.rootSessionId === rootSessionId
      ) {
        ids.add(session.id)
        changed = true
      }
    }
  }

  return ids
}

function hasPinnedVisibleParent(
  session: AgentSessionMeta,
  sessionsById: Map<string, AgentSessionMeta>,
): boolean {
  const visited = new Set<string>([session.id])
  let parentId = session.parentSessionId
  while (parentId) {
    const parent = sessionsById.get(parentId)
    if (!parent || visited.has(parent.id)) return false
    if (parent.pinned && !parent.archived) return true
    visited.add(parent.id)
    parentId = parent.parentSessionId
  }
  return false
}

function getSyncableDelegatedChildren(
  sessions: AgentSessionMeta[],
  parentSessionId: string,
  draftSessionIds: Set<string>,
): AgentSessionMeta[] {
  return getDirectDelegatedChildren(sessions, parentSessionId).filter((child) => (
    !child.archived
    && !draftSessionIds.has(child.id)
  ))
}

/**
 * 解归档时收集应跟随父会话一起恢复的子会话：
 * 已归档、非 draft 的委派子会话。
 */
function getArchivedDelegatedChildren(
  sessions: AgentSessionMeta[],
  parentSessionId: string,
  draftSessionIds: Set<string>,
): AgentSessionMeta[] {
  return getDirectDelegatedChildren(sessions, parentSessionId).filter((child) => (
    child.archived
    && !draftSessionIds.has(child.id)
  ))
}

interface RailRecentItem {
  id: string
  title: string
  type: SessionMiniMapType
  initial: string
  active: boolean
  status: SessionIndicatorStatus
  pinned: boolean
  workspaceName?: string
  isAutomation?: boolean
  isDelegation?: boolean
}

function RailRecentButton({
  item,
  onSelect,
}: {
  item: RailRecentItem
  onSelect: (item: RailRecentItem) => void
}): React.ReactElement {
  const sessionHoverPreviewEnabled = useAtomValue(sessionHoverPreviewEnabledAtom)
  const preview = useSessionMiniMapHover(600, !sessionHoverPreviewEnabled)

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            ref={preview.setAnchorRef}
            type="button"
            aria-label={`打开${item.type === 'agent' ? 'Agent 会话' : 'Chat 对话'}：${item.title}`}
            onClick={() => onSelect(item)}
            onMouseEnter={preview.handleMouseEnter}
            onMouseLeave={preview.handleMouseLeave}
            className={cn(
              'relative size-10 flex items-center justify-center overflow-hidden rounded-[12px] transition-colors titlebar-no-drag',
              item.active
                ? 'bg-primary/10 text-foreground shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]'
                : 'text-foreground/55 hover:bg-foreground/[0.06] hover:text-foreground/80'
            )}
          >
            <span
              className={cn(
                'absolute inset-y-0 left-0 w-0 border-l-[3px] rounded-l-[12px] pointer-events-none',
                RAIL_STATUS_CLASS[item.status]
              )}
            />
            {item.isAutomation
              ? <Clock size={14} className="text-foreground/40" />
              : item.isDelegation
                ? <GitBranch size={14} className="text-foreground/40" />
                : <span className="text-[13px] font-semibold leading-none">{item.initial}</span>
            }
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">
          {item.type === 'agent' ? 'Agent' : 'Chat'} · {item.title}
        </TooltipContent>
      </Tooltip>
      <SessionMiniMapPopover
        target={{
          type: item.type,
          sessionId: item.id,
          title: item.title,
          workspaceName: item.workspaceName,
        }}
        anchorRef={preview.anchorRef}
        open={preview.isOpen}
        isLeaving={preview.isLeaving}
        onMouseEnter={preview.handlePanelMouseEnter}
        onMouseLeave={preview.handlePanelMouseLeave}
      />
    </>
  )
}

function SidebarWindowDragStrip({ height }: { height: number }): React.ReactElement {
  return (
    <div
      aria-hidden="true"
      className="sidebar-window-drag-strip"
      style={{ height }}
    />
  )
}

/** 不可变地切换 Set 中某个成员的存在状态（存在则删除，不存在则添加），返回新 Set */
function toggleSetEntry<T>(prev: Set<T>, value: T): Set<T> {
  const next = new Set(prev)
  if (next.has(value)) {
    next.delete(value)
  } else {
    next.add(value)
  }
  return next
}

/** 不可变地从 Set 中移除某个成员，若不存在则原样返回 */
function deleteSetEntry<T>(prev: Set<T>, value: T): Set<T> {
  if (!prev.has(value)) return prev
  const next = new Set(prev)
  next.delete(value)
  return next
}

export function LeftSidebar({ width, noTransition }: LeftSidebarProps): React.ReactElement {
  const sessionHoverPreviewEnabled = useAtomValue(sessionHoverPreviewEnabledAtom)
  const [activeView, setActiveView] = useAtom(activeViewAtom)
  const discoverFeedUnread = useAtomValue(discoverFeedUnreadAtom)
  const discoverCommunityUnread = useAtomValue(discoverCommunityUnreadAtom)
  const discoverUnreadTotal = discoverFeedUnread + discoverCommunityUnread
  const setAgentSkillsTab = useSetAtom(agentSkillsTabAtom)
  const setAutomationForm = useSetAtom(automationFormAtom)
  const setPlanningTab = useSetAtom(planningTabAtom)
  const automations = useAtomValue(automationsAtom)
  const setAutomations = useSetAtom(automationsAtom)
  const automationCount = automations.length
  const settingsOpen = useAtomValue(settingsOpenAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const setSettingsTab = useSetAtom(settingsTabAtom)
  const [conversations, setConversations] = useAtom(conversationsAtom)
  const [currentConversationId, setCurrentConversationId] = useAtom(currentConversationIdAtom)
  const draftSessionIds = useAtomValue(draftSessionIdsAtom)
  const setDraftSessionIds = useSetAtom(draftSessionIdsAtom)
  const setAgentMessagesCache = useSetAtom(agentSDKMessagesCacheAtom)

  /** 待删除对话 ID，非空时显示确认弹窗 */
  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(null)
  /** 待删除工作区 ID，非空时显示工作区删除确认弹窗 */
  const [pendingDeleteWorkspaceId, setPendingDeleteWorkspaceId] = React.useState<string | null>(null)
  const [deletingWorkspaceId, setDeletingWorkspaceId] = React.useState<string | null>(null)
  /** 待迁移会话 ID，非空时显示迁移对话框 */
  const [moveTargetId, setMoveTargetId] = React.useState<string | null>(null)
  /** 待迁移会话所属的工作区 ID（用于对话框排除当前分区） */
  const [moveSourceWorkspaceId, setMoveSourceWorkspaceId] = React.useState<string | undefined>()
  /** 已完全展开的工作区 ID 集合（"显示更多"后展示全部剩余会话，不再分批） */
  /** 每个工作区已额外展开的会话数量（Map<workspaceId, count>）；每次「显示更多」+ PROJECT_SESSION_EXPAND_STEP，直至全量 */
  const [expandedExtraCounts, setExpandedExtraCounts] = React.useState<Map<string, number>>(new Map())
  /** 记录被用户手动折叠的工作区 ID（点击当前工作区标题时折叠/展开）。刻意不持久化：折叠被视为临时查看行为，刷新/重启后恢复默认展开 */
  const [collapsedWorkspaceIds, setCollapsedWorkspaceIds] = React.useState<Set<string>>(new Set())
  /** 记录已展开的委派母会话；默认收起，避免批量派遣后撑满侧栏 */
  const [expandedDelegationParentIds, setExpandedDelegationParentIds] = React.useState<Set<string>>(new Set())
  /** 记录用户手动收起的委派母会话；用于覆盖“当前子会话自动展开”的兜底可见性 */
  const [collapsedDelegationParentIds, setCollapsedDelegationParentIds] = React.useState<Set<string>>(new Set())
  /** 工作区拖拽排序状态 */
  const [dragProjectId, setDragProjectId] = React.useState<string | null>(null)
  const [projectDropIndicator, setProjectDropIndicator] = React.useState<{ id: string; position: 'before' | 'after' } | null>(null)
  const [automationGroupOrder, setAutomationGroupOrder] = useAtom(automationGroupOrderAtom)
  /** 新建项目输入状态；此处仅保留弹窗 busy 标志 */
  const [creatingProject, setCreatingProject] = React.useState(false)
  const [relativeTimeNow, setRelativeTimeNow] = React.useState(() => Date.now())
  const [userProfile, setUserProfile] = useAtom(userProfileAtom)
  const selectedModel = useAtomValue(selectedModelAtom)
  const streamingIds = useAtomValue(streamingConversationIdsAtom)
  const mode = useAtomValue(appModeAtom)
  const isMac = React.useMemo(() => detectIsMac(), [])
  const hasUpdate = useAtomValue(hasUpdateAtom)
  const updateStatus = useAtomValue(updateStatusAtom)
  const { version: appVersion, unseen: hasUnseenReleaseNotes, recentNotes: releaseNotesRecent, markSeen: markReleaseNotesSeen } = useReleaseNotes()
  const hasEnvironmentIssues = useAtomValue(hasEnvironmentIssuesAtom)
  const promptConfig = useAtomValue(promptConfigAtom)
  const setSelectedPromptId = useSetAtom(selectedPromptIdAtom)
  const interfaceVariant = useAtomValue(interfaceVariantAtom)
  const isClassic = interfaceVariant === 'classic'

  // Agent 模式状态
  const [agentSessions, setAgentSessions] = useAtom(agentSessionsAtom)
  const [currentAgentSessionId, setCurrentAgentSessionId] = useAtom(currentAgentSessionIdAtom)
  const agentIndicatorMap = useAtomValue(agentSessionIndicatorMapAtom)
  const unviewedCompletedSessionIds = useAtomValue(unviewedCompletedSessionIdsAtom)
  const setUnviewedCompleted = useSetAtom(unviewedCompletedSessionIdsAtom)
  const agentChannelId = useAtomValue(agentChannelIdAtom)
  const agentModelId = useAtomValue(agentModelIdAtom)
  const setSessionChannelMap = useSetAtom(agentSessionChannelMapAtom)
  const setSessionModelMap = useSetAtom(agentSessionModelMapAtom)
  const setSessionPathMap = useSetAtom(agentSessionPathMapAtom)
  const [currentWorkspaceId, setCurrentWorkspaceId] = useAtom(currentAgentWorkspaceIdAtom)
  const [workspaces, setWorkspaces] = useAtom(agentWorkspacesAtom)
  const setMode = useSetAtom(appModeAtom)

  // craft Project 状态（Work 看板同源）：侧边栏项目子分组 / 色条 / 详情跳转用
  const kanbanProjects = useAtomValue(serverKanbanProjectsAtom)
  const setKanbanProjects = useSetAtom(serverKanbanProjectsAtom)
  const setSelectedProjectId = useSetAtom(selectedProjectIdAtom)
  const setPendingTaskEditorTarget = useSetAtom(pendingTaskEditorTargetAtom)
  const [codeMainView, setCodeMainView] = useAtom(codeMainViewAtom)
  const [, setTaskBoardScope] = useAtom(taskBoardScopeAtom)

  // 当前工作区能力（MCP + Skill 计数）
  const [capabilities, setCapabilities] = React.useState<WorkspaceCapabilities | null>(null)
  // Yoda 记忆计数：由设置面板「Yoda 记忆」页自行展示，左栏无需徽标

  // 任务看板未完成任务数（仅统计非终态）
  const taskSummaries = useAtomValue(serverTaskSummariesAtom)
  const activeTaskCount = React.useMemo(() => {
    if (!taskSummaries) return 0
    return taskSummaries.filter((t) => t.workflow !== 'done' && t.workflow !== 'cancelled' && !t.archivedAt).length
  }, [taskSummaries])

  const capabilitiesVersion = useAtomValue(workspaceCapabilitiesVersionAtom)

  // Tab 状态
  const [tabs, setTabs] = useAtom(tabsAtom)
  const [activeTabId, setActiveTabId] = useAtom(activeTabIdAtom)

  const handleOpenGuide = React.useCallback((): void => {
    const result = openTab(tabs, { type: 'tutorial', sessionId: TUTORIAL_TAB_ID, title: 'MyYoda 使用指南' })
    setTabs(result.tabs)
    setActiveTabId(result.activeTabId)
    setAutomationForm({ open: false, draft: null })
    setActiveView('conversations')
    setSettingsOpen(false)
  }, [setActiveTabId, setActiveView, setAutomationForm, setSettingsOpen, setTabs, tabs])
  // 会话高亮按"激活 Tab 所属会话"判定：预览 Tab 激活时其 owner 会话仍保持高亮
  const activeSessionId = useAtomValue(activeSessionIdAtom)
  // 折叠/展开的触发按钮固定在 TabBar（紧邻第一个标签），这里只读取状态用于决定渲染哪个分支。
  const sidebarCollapsed = useAtomValue(sidebarCollapsedAtom)
  // 功能模块区（计划 / 看板 / 画布 / 插件 / 知识库）默认折叠；任一功能视图激活时自动展开。
  // 展开后保持展开（点击二级目录不自动收起），收起由用户手动点击「功能」头部。
  // 注意：「发现」是独立入口行（位于搜索与功能之间，Agent / Chat 模式均显示），不应触发功能组展开（否则双击发现会误展开功能组）。
  const featureCtx = { activeView, mode, codeMainView }
  const anyFeatureActiveValue = anyFeatureActive(featureCtx)
  const [featuresCollapsed, setFeaturesCollapsed] = React.useState(true)
  React.useEffect(() => {
    if (anyFeatureActiveValue) setFeaturesCollapsed(false)
  }, [anyFeatureActiveValue])
  const openSession = useOpenSession()
  const { createAgent } = useCreateSession()
  const setNewTaskProjectFlowOpen = useSetAtom(newTaskProjectFlowOpenAtom)
  const setSearchDialogOpen = useSetAtom(searchDialogOpenAtom)
  const syncActiveTabSideEffects = useSyncActiveTabSideEffects()
  const store = useStore()
  const sidebarRootRef = React.useRef<HTMLDivElement>(null)
  const quickSwitchTargetsRef = React.useRef<QuickSwitchTarget[]>([])
  // 快捷切换只会标注前 9 行；保留它们避免滚动时全量清理/重写所有列表行。
  const quickSwitchHintRowsRef = React.useRef<HTMLElement[]>([])
  const quickSwitchRefreshFrameRef = React.useRef<number | null>(null)
  const quickSwitchHintTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const processedQuickSwitchEventsRef = React.useRef<WeakSet<KeyboardEvent>>(new WeakSet())
  const [quickSwitchHintsVisible, setQuickSwitchHintsVisible] = React.useState(false)

  // 归档 & 搜索状态
  const [viewMode, setViewMode] = useAtom(sidebarViewModeAtom)
  // Code 侧边栏会话列表：状态筛选 / 分组方式 / 排序方式（取代原「会话|项目」大 Tab）
  const sessionListPreference = useAtomValue(sessionListPreferenceAtom)
  const setSessionListPreference = useSetAtom(sessionListPreferenceAtom)
  const { status: agentStatusFilter, groupBy: agentGroupBy, sortBy: agentSortBy } = sessionListPreference
  const [sessionGroups, setSessionGroups] = useAtom(sessionGroupsAtom)
  const [createGroupTargetSessionId, setCreateGroupTargetSessionId] = React.useState<string | null>(null)
  const [creatingSessionGroup, setCreatingSessionGroup] = React.useState(false)

  // 当前工作区根目录（Projects Tab 需要传给 SidebarProjectsTab）
  const [workspaceRoot, setWorkspaceRoot] = React.useState<string | null>(null)

  const handleOpenSettings = React.useCallback((): void => {
    setSettingsOpen(true)
  }, [setSettingsOpen])

  const handleUpdateButtonClick = React.useCallback((): void => {
    setSettingsTab('about')
    setSettingsOpen(true)
  }, [setSettingsOpen, setSettingsTab])

  React.useEffect(() => {
    const id = window.setInterval(() => setRelativeTimeNow(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [])

  // Chat 列表改由 virtualizer 按 index 定位；普通 Agent 项目列表当前仍是树状 DOM，
  // 保留既有的原生定位行为，避免打开后台 Agent 会话后选中项不可见。
  React.useEffect(() => {
    if (!activeTabId || mode !== 'agent' || viewMode !== 'active') return
    requestAnimationFrame(() => {
      const el = document.querySelector('.agent-session-item-active')
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })
  }, [activeTabId, mode, viewMode])

  // per-conversation/session Map atoms（删除时清理）
  const setConvModels = useSetAtom(conversationModelsAtom)
  const setConvContextLength = useSetAtom(conversationContextLengthAtom)
  const setConvThinking = useSetAtom(conversationThinkingEnabledAtom)
  const setConvParallel = useSetAtom(conversationParallelModeAtom)
  const setConvPromptId = useSetAtom(conversationPromptIdAtom)
  const setPreviewPanelOpen = useSetAtom(previewPanelOpenMapAtom)
  const setPreviewFile = useSetAtom(previewFileMapAtom)
  const setAgentSideChatMap = useSetAtom(agentSideChatMapAtom)
  const setDiffPanelTab = useSetAtom(agentDiffPanelTabAtom)
  const setDiffRefreshVersion = useSetAtom(agentDiffRefreshVersionAtom)
  const setDiffUnseen = useSetAtom(agentDiffUnseenChangesAtom)
  const setDiffUnseenFiles = useSetAtom(agentDiffUnseenFilesAtom)
  const setNonGitFileChanges = useSetAtom(agentNonGitFileChangesAtom)
  const setFileChangesCurrentRun = useSetAtom(agentFileChangesCurrentRunAtom)
  const setDiffData = useSetAtom(agentDiffDataAtom)
  const setAgentSidePanelOpenMap = useSetAtom(agentSidePanelOpenMapAtom)
  const setStreamingStates = useSetAtom(agentStreamingStatesAtom)
  const setLiveMessagesMap = useSetAtom(liveMessagesMapAtom)
  const setSessionPendingFiles = useSetAtom(agentSessionPendingFilesAtom)
  const setSessionViewStateMap = useSetAtom(sessionViewStateMapAtom)

  /** 清理 per-conversation/session Map atoms 条目 */
  const cleanupMapAtoms = React.useCallback((id: string) => {
    const deleteKey = <T,>(prev: Map<string, T>): Map<string, T> => {
      if (!prev.has(id)) return prev
      const map = new Map(prev)
      map.delete(id)
      return map
    }
    setConvModels(deleteKey)
    setConvContextLength(deleteKey)
    setConvThinking(deleteKey)
    setConvParallel(deleteKey)
    setConvPromptId(deleteKey)
    setPreviewPanelOpen(deleteKey)
    setPreviewFile(deleteKey)
    setAgentSideChatMap((prev) => {
      let changed = false
      const map = new Map(prev)
      if (map.delete(id)) changed = true
      for (const [sessionId, conversationId] of map) {
        if (conversationId === id) {
          map.delete(sessionId)
          changed = true
        }
      }
      return changed ? map : prev
    })
    setDiffPanelTab(deleteKey)
    setDiffRefreshVersion(deleteKey)
    setDiffUnseen(deleteKey)
    setDiffUnseenFiles(deleteKey)
    setNonGitFileChanges(deleteKey)
    setFileChangesCurrentRun(deleteKey)
    setDiffData(deleteKey)
    setAgentSidePanelOpenMap((prev) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
    setSessionChannelMap(deleteKey)
    setSessionModelMap(deleteKey)
    // 会话工作目录路径：不清理会导致右侧文件面板继续用已删除目录请求 list-directory
    setSessionPathMap(deleteKey)
    // 视图状态（预览开关 + 上次视图）：删除/归档是终态，统一清理避免孤立条目
    setSessionViewStateMap(deleteKey)

    // 重型流式数据：streamingStates（累积 content + toolActivities）与 liveMessages（SDK 消息数组）
    setStreamingStates(deleteKey)
    setLiveMessagesMap(deleteKey)

    // 待发送附件：先释放 blob URL 和 window 缓存中的 base64，再删 base map entry。
    // 与文字草稿不同，附件涉及 ObjectURL 和大体积二进制数据，删除/归档时不保留。
    const sessionPending = store.get(agentSessionPendingFilesAtom).get(id)
    if (sessionPending && sessionPending.length > 0) {
      for (const f of sessionPending) {
        if (f.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(f.previewUrl)
        window.__pendingAgentFileData?.delete(f.id)
      }
      setSessionPendingFiles(deleteKey)
    }

    // 删除/归档是会话终态，统一释放 Agent atoms 与 atomFamily 强引用缓存。
    cleanupDeletedAgentSessionAtoms(store, id)
    cleanupDeletedBrowserSessionAtoms(store, id)

    clearPreviewCacheForSession(id)
  }, [setConvModels, setConvContextLength, setConvThinking, setConvParallel, setConvPromptId, setPreviewPanelOpen, setPreviewFile, setDiffPanelTab, setDiffRefreshVersion, setDiffUnseen, setDiffUnseenFiles, setNonGitFileChanges, setFileChangesCurrentRun, setDiffData, setAgentSidePanelOpenMap, setSessionChannelMap, setSessionModelMap, setSessionPathMap, setSessionViewStateMap, setStreamingStates, setLiveMessagesMap, setSessionPendingFiles, store])

  const currentWorkspaceSlug = React.useMemo(() => {
    if (!currentWorkspaceId) return null
    return workspaces.find((w) => w.id === currentWorkspaceId)?.slug ?? null
  }, [currentWorkspaceId, workspaces])

  const workspaceNameMap = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const w of workspaces) map.set(w.id, w.name)
    return map
  }, [workspaces])

  // Excalidraw 画布计数（仅 Project 模式，走当前工作区的 excalidraw 目录）
  const [excalidrawCount, setExcalidrawCount] = React.useState(0)
  React.useEffect(() => {
    if (!currentWorkspaceSlug || mode !== 'agent') {
      setExcalidrawCount(0)
      return
    }
    window.electronAPI
      .listExcalidrawFiles(currentWorkspaceSlug)
      .then((list) => setExcalidrawCount(list.length))
      .catch(() => setExcalidrawCount(0))
  }, [currentWorkspaceSlug, mode])

  const pendingDeleteWorkspace = React.useMemo(
    () => workspaces.find((workspace) => workspace.id === pendingDeleteWorkspaceId) ?? null,
    [pendingDeleteWorkspaceId, workspaces],
  )

  /** 待删除 Agent 会话下的委派子会话数量，用于删除确认弹窗提示是否级联删除 */
  const pendingDeleteChildCount = React.useMemo<number>(() => {
    if (!pendingDeleteId || mode !== 'agent') return 0
    return getDirectDelegatedChildren(agentSessions, pendingDeleteId).length
  }, [agentSessions, mode, pendingDeleteId])

  // 注意：不再按 mode 收窄 —— Yoda 插件与 Yoda 记忆入口现已 Home / Code 共享，
  // 两模式都需要正确的角标计数（Skills / 记忆等）。
  React.useEffect(() => {
    if (!currentWorkspaceSlug) {
      setCapabilities(null)
      setWorkspaceRoot(null)
      return
    }
    window.electronAPI
      .getWorkspaceCapabilities(currentWorkspaceSlug)
      .then(setCapabilities)
      .catch(console.error)
    window.electronAPI
      .getWorkspaceRootPath(currentWorkspaceSlug)
      .then(setWorkspaceRoot)
      .catch(() => setWorkspaceRoot(null))
  }, [currentWorkspaceSlug, activeView, capabilitiesVersion])

  // 加载当前工作区 Labels
  const setWorkspaceLabels = useSetAtom(workspaceLabelsAtom)
  const workspaceLabels = useAtomValue(workspaceLabelsAtom)
  React.useEffect(() => {
    if (!workspaceRoot || mode !== 'agent') return
    const setLabels = (list: WorkspaceLabel[]) => setWorkspaceLabels(list)
    void loadWorkspaceLabels(workspaceRoot, setLabels)
  }, [workspaceRoot, mode, setWorkspaceLabels])

  // 专家数量：由设置面板 Yoda 插件页自行维护，左栏无需角标

  /** 置顶对话列表（仅活跃模式显示，排除 draft） */
  const pinnedConversations = React.useMemo(
    () => viewMode === 'active' ? conversations.filter((c) => c.pinned && !draftSessionIds.has(c.id)) : [],
    [conversations, viewMode, draftSessionIds]
  )

  /** 置顶 Agent 会话列表（仅活跃模式显示，跨项目/工作区展示，排除 draft）
   * 对齐 Proma：置顶不按当前工作区过滤，否则切换项目时置顶区会跟着变，用户会误以为
   * “置顶跟着项目走”。置顶会话统一由 AgentSessionItem 的 workspaceName 标签标注所属
   * 工作区（含当前工作区，与普通项目分组列表行为一致），点击后再切换工作区。 */
  const pinnedAgentSessions = React.useMemo(
    () => {
      if (viewMode !== 'active') return []
      const sessionsById = new Map(agentSessions.map((session) => [session.id, session]))
      const filtered = agentSessions.filter((s) =>
        s.pinned
        && !draftSessionIds.has(s.id)
        && !isDelegatedChildSession(s)
        && !hasPinnedVisibleParent(s, sessionsById)
      )
      return sortAgentSessionsByUpdatedAtDesc(filtered)
    },
    [agentSessions, viewMode, draftSessionIds]
  )

  const pinnedAgentSessionTrees = React.useMemo<AgentSessionTreeItem[]>(
    () => pinnedAgentSessions.map((session) => ({
      session,
      childSessions: getDirectDelegatedChildren(agentSessions, session.id).filter((child) => (
        !child.archived
        && !draftSessionIds.has(child.id)
        && !isHiddenAutomationSession(child)
      )),
    })),
    [agentSessions, draftSessionIds, pinnedAgentSessions],
  )

  /** 对话按日期分组（根据 viewMode 过滤归档状态，排除 draft） */
  const conversationGroups = React.useMemo(
    () => {
      const filtered = viewMode === 'archived'
        ? conversations.filter((c) => c.archived && !draftSessionIds.has(c.id))
        : conversations.filter((c) => !c.archived && !c.pinned && !draftSessionIds.has(c.id))
      return groupByDate(filtered)
    },
    [conversations, viewMode, draftSessionIds]
  )

  /** 已归档对话数量 */
  const archivedConversationCount = React.useMemo(
    () => conversations.filter((c) => c.archived).length,
    [conversations]
  )

  /** 已归档 Agent 会话数量（跨项目） */
  const archivedAgentSessionCount = React.useMemo(
    () => agentSessions.filter((s) => s.archived && !draftSessionIds.has(s.id)).length,
    [agentSessions, draftSessionIds]
  )

  // 初始加载对话列表 + 用户档案 + Agent 会话
  React.useEffect(() => {
    window.electronAPI
      .listConversations()
      .then((list) => {
        setConversations(list)
      })
      .catch(console.error)
    window.electronAPI
      .getUserProfile()
      .then(setUserProfile)
      .catch(console.error)
    window.electronAPI
      .listAgentSessions()
      .then(setAgentSessions)
      .catch(console.error)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setConversations, setUserProfile, setAgentSessions])

  // 窗口聚焦时重新同步列表，修复长时间后前后端不一致
  React.useEffect(() => {
    const handleFocus = (): void => {
      window.electronAPI.listConversations().then(setConversations).catch(console.error)
      window.electronAPI.listAgentSessions().then(setAgentSessions).catch(console.error)
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [setConversations, setAgentSessions])

  /** 打开/关闭 Task 日历（Todo / 日历 / 定时任务） */
  const handleOpenPlanning = React.useCallback((): void => {
    if (activeView === 'planning') {
      // 编辑页 → 关表单回列表；列表页 → 退出到对话
      if (store.get(automationFormAtom).open) {
        setAutomationForm({ open: false, draft: null })
        return
      }
      setActiveView('conversations')
      return
    }
    setAutomationForm({ open: false, draft: null })
    // 从侧栏进入规划中心仍以 Todo 为默认页；表单返回不会触发这条导航，因此可保留定时任务标签。
    setPlanningTab('todos')
    setActiveView('planning')
  }, [activeView, setAutomationForm, setActiveView, setPlanningTab, store])

  /** 打开/关闭 Yoda 插件中心（总览 / 专家 / 专家团 / 技能 / 连接器 / 记忆，独立左栏视图） */
  const handleOpenSkills = React.useCallback((tab?: PluginCenterTab): void => {
    if (tab) setAgentSkillsTab(tab)
    if (activeView === 'agent-skills' && !tab) {
      setActiveView('conversations')
      return
    }
    setActiveView('agent-skills')
  }, [activeView, setActiveView, setAgentSkillsTab])

  /** 打开/关闭 Yoda 知识库 视图（Project 模式知识库入口） */
  const handleOpenRepoWiki = React.useCallback((): void => {
    if (activeView === 'repo-wiki') {
      setActiveView('conversations')
      return
    }
    setActiveView('repo-wiki')
  }, [activeView, setActiveView])

  /** 打开/关闭 消息 视图（IM 集成：飞书 / 微信 / 即将上线渠道，仅 Project 模式） */
  const handleOpenMessaging = React.useCallback((): void => {
    if (activeView === 'messaging') {
      setActiveView('conversations')
      return
    }
    setActiveView('messaging')
  }, [activeView, setActiveView])

  /** 打开/关闭「发现」视图（官方内容 + 社区 + 反馈） */
  const handleOpenDiscover = React.useCallback((): void => {
    if (activeView === 'discover') {
      setActiveView('conversations')
      return
    }
    setActiveView('discover')
  }, [activeView, setActiveView])

  /** 打开唯一正式任务看板；重复点击保持当前页面，不隐式退回会话。 */
  const handleOpenTaskBoard = React.useCallback((): void => {
    if (codeMainView === 'tasks' && activeView === 'conversations') return
    setAutomationForm({ open: false, draft: null })
    // 看板默认聚焦当前工作区（项目=工作区）；旧 project facet 由 WorkBoardView 挂载时清理
    setTaskBoardScope({ kind: 'workspace' })
    setCodeMainView('tasks')
    setActiveView('conversations')
  }, [activeView, codeMainView, setActiveView, setAutomationForm, setCodeMainView, setTaskBoardScope])

  /** 打开/关闭 Excalidraw 画布 */
  const handleOpenExcalidraw = React.useCallback((): void => {
    if (activeView === 'excalidraw-gallery' || activeView === 'excalidraw-editor') {
      setActiveView('conversations')
      return
    }
    setAutomationForm({ open: false, draft: null })
    setActiveView('excalidraw-gallery')
  }, [activeView, setActiveView, setAutomationForm])

  /** 打开插件中心总览（连接器是插件的一类，不单独并列入口） */
  const handleOpenPlugins = React.useCallback((): void => {
    handleOpenSkills('overview')
  }, [handleOpenSkills])

  // 切换模式时重置归档视图：Chat 用 viewMode，Agent 用状态筛选，统一回到活跃（对齐 Proma）。
  // 首次挂载跳过（启动时偏好已归一为 active，无需再写 settings.json）。
  const initialModeRef = React.useRef(true)
  React.useEffect(() => {
    setViewMode('active')
    if (initialModeRef.current) {
      initialModeRef.current = false
      return
    }
    setSessionListPreference({ status: 'active' })
  }, [mode, setViewMode, setSessionListPreference])

  /** 创建新对话（继承当前选中的模型/渠道） */
  const handleNewConversation = async (): Promise<void> => {
    setActiveView('conversations')
    try {
      const meta = await window.electronAPI.createConversation(
        undefined,
        selectedModel?.modelId,
        selectedModel?.channelId,
      )
      setConversations((prev) => [meta, ...prev])
      // 打开新标签页
      openSession('chat', meta.id, meta.title)
      // 确保在对话视图
      setActiveView('conversations')
      // 根据默认提示词重置选中
      if (promptConfig.defaultPromptId) {
        setSelectedPromptId(promptConfig.defaultPromptId)
      }
    } catch (error) {
      console.error('[侧边栏] 创建对话失败:', error)
    }
  }

  /** 选择对话（打开或聚焦标签页） */
  const handleSelectConversation = React.useCallback((id: string, title: string): void => {
    openSession('chat', id, title)
    setActiveView('conversations')
  }, [openSession, setActiveView])

  /** 请求删除对话（弹出确认框） */
  const handleRequestDelete = React.useCallback((id: string): void => {
    setPendingDeleteId(id)
  }, [])

  /** 重命名对话标题 */
  const handleRename = React.useCallback(async (id: string, newTitle: string): Promise<void> => {
    try {
      const updated = await window.electronAPI.updateConversationTitle(id, newTitle)
      setConversations((prev) =>
        prev.map((c) => (c.id === updated.id ? updated : c))
      )
      // 同步更新标签页标题
      setTabs((prev) => updateTabTitle(prev, id, newTitle))
    } catch (error) {
      console.error('[侧边栏] 重命名对话失败:', error)
    }
  }, [setConversations, setTabs])

  /** 切换对话置顶状态 */
  const handleTogglePin = React.useCallback(async (id: string): Promise<void> => {
    try {
      const original = store.get(conversationsAtom).find((c) => c.id === id)
      const updated = await window.electronAPI.togglePinConversation(id)
      setConversations((prev) =>
        prev.map((c) => (c.id === updated.id ? updated : c))
      )
      // 归档会话被置顶时会自动取消归档
      if (original?.archived && updated.pinned && !updated.archived) {
        toast.success('已取消归档并置顶')
      }
    } catch (error) {
      console.error('[侧边栏] 切换置顶失败:', error)
    }
  }, [store, setConversations])

  /** 切换对话归档状态 */
  const handleToggleArchive = React.useCallback(async (id: string): Promise<void> => {
    try {
      const updated = await window.electronAPI.toggleArchiveConversation(id)
      setConversations((prev) =>
        prev.map((c) => (c.id === updated.id ? updated : c))
      )
      // 归档时自动关闭该对话的标签页，并同步新激活标签的副作用
      // （appMode、currentXxxId 等），避免文件面板/工具栏等 per-tab
      // 状态被遗留为旧值或被错误地置 null。
      if (updated.archived) {
        const currentTabs = store.get(tabsAtom)
        const currentActiveTabId = store.get(activeTabIdAtom)
        const wasActive = currentActiveTabId === id
        const tabResult = closeTab(currentTabs, currentActiveTabId, id)
        setTabs(tabResult.tabs)
        setActiveTabId(tabResult.activeTabId)
        cleanupMapAtoms(id)
        if (wasActive) {
          const newActiveTab = tabResult.activeTabId
            ? tabResult.tabs.find((t) => t.id === tabResult.activeTabId) ?? null
            : null
          syncActiveTabSideEffects(newActiveTab)
        }
      }
      toast.success(updated.archived ? '已归档' : '已取消归档')
    } catch (error) {
      console.error('[侧边栏] 切换归档失败:', error)
    }
  }, [store, setConversations, setTabs, setActiveTabId, cleanupMapAtoms, syncActiveTabSideEffects])

  /** 确认删除对话 */
  const handleConfirmDelete = async (cascade: boolean = false): Promise<void> => {
    if (!pendingDeleteId) return

    // Agent 会话的物理删除可能被 dirty Worktree 守卫拒绝；Agent 模式
    // 延迟 UI 清理到 IPC 成功后，普通对话沿用原有立即关闭行为。
    const applyAgentDeletionUi = (): void => {
      const currentTabs = store.get(tabsAtom)
      const currentActiveTabId = store.get(activeTabIdAtom)
      const wasActive = currentActiveTabId === pendingDeleteId
      const tabResult = closeTab(currentTabs, currentActiveTabId, pendingDeleteId)
      setTabs(tabResult.tabs)
      setActiveTabId(tabResult.activeTabId)
      if (wasActive) {
        const newActiveTab = tabResult.activeTabId
          ? tabResult.tabs.find((t) => t.id === tabResult.activeTabId) ?? null
          : null
        syncActiveTabSideEffects(newActiveTab)
      }
      setDraftSessionIds((prev: Set<string>) => {
        if (!prev.has(pendingDeleteId)) return prev
        const next = new Set(prev)
        next.delete(pendingDeleteId)
        return next
      })
      cleanupMapAtoms(pendingDeleteId)
      setExpandedDelegationParentIds((prev) => deleteSetEntry(prev, pendingDeleteId))
      setAgentMessagesCache((prev) => {
        if (!prev.has(pendingDeleteId)) return prev
        const next = new Map(prev)
        next.delete(pendingDeleteId)
        return next
      })
    }

    if (mode !== 'agent') {
      // 关闭对应的标签页：setTabs 与 setActiveTabId 成组更新，便于阅读，
      // 也避免将来在两者之间意外插入 await 导致跨渲染状态不一致。
      // （React 18 在同一事件回调中会自动批处理多次 setState，所以单次渲染
      // 的一致性由 React 保证，这里只是保持代码组织清晰。）
      const wasActive = activeTabId === pendingDeleteId
      const tabResult = closeTab(tabs, activeTabId, pendingDeleteId)
      setTabs(tabResult.tabs)
      setActiveTabId(tabResult.activeTabId)

      // 若关闭的是当前活跃标签，同步新激活标签的副作用（appMode、
      // currentXxxId、以及右侧文件面板等 per-tab 状态），保持与 TabBar
      // 关闭逻辑一致，避免删除/归档当前会话后新标签状态缺失。
      if (wasActive) {
        const newActiveTab = tabResult.activeTabId
          ? tabResult.tabs.find((t) => t.id === tabResult.activeTabId) ?? null
          : null
        syncActiveTabSideEffects(newActiveTab)
      }

      // 清理 draft 标记（如有）
      setDraftSessionIds((prev: Set<string>) => {
        if (!prev.has(pendingDeleteId)) return prev
        const next = new Set(prev)
        next.delete(pendingDeleteId)
        return next
      })

      // 清理 per-conversation/session Map atoms 条目
      cleanupMapAtoms(pendingDeleteId)
      setExpandedDelegationParentIds((prev) => deleteSetEntry(prev, pendingDeleteId))
    }

    if (mode === 'agent') {
      // Agent 模式：删除 Agent 会话
      // 注意：当前会话指针（currentAgentSessionId）已由上面的
      // syncActiveTabSideEffects 在 wasActive 分支同步到新激活标签，
      // 这里不要再按旧闭包值强制置 null，否则会覆盖新 sessionId，
      // 导致 RightSidePanel 消失（依赖 currentAgentSessionIdAtom）。
      // 级联删除时在发起 IPC 前固定子会话快照，确保删除范围与弹窗展示一致，
      // 避免弹窗打开期间新增的子会话被意外删除。
      const childIds = cascade
        ? getDirectDelegatedChildren(store.get(agentSessionsAtom), pendingDeleteId).map((child) => child.id)
        : []
      try {
        // 先删子后删父：若子会话删除中途失败，父会话仍在，UI 一致性更好。
        if (childIds.length > 0) {
          const { deletedChildIds, failedChildIds } = await deleteAgentSessionChildren(
            childIds,
            (childId) => window.electronAPI.deleteAgentSession(childId),
            (childId, error) => console.error(`[侧边栏] 级联删除子会话失败 (${childId}):`, error),
          )
          // 无论父会话是否继续删除，已经成功删除的子会话都必须先从 Renderer 收敛。
          closeArchivedAgentTabs(deletedChildIds)
          for (const childId of deletedChildIds) {
            setExpandedDelegationParentIds((prev) => deleteSetEntry(prev, childId))
            setAgentMessagesCache((prev) => {
              if (!prev.has(childId)) return prev
              const next = new Map(prev)
              next.delete(childId)
              return next
            })
          }
          if (childIds.length > 0 && !shouldDeleteAgentParent({ deletedChildIds, failedChildIds })) {
            toast.error(`部分子会话删除失败（${failedChildIds.length} 个），父会话保留，请手动清理`)
            try {
              setAgentSessions(await window.electronAPI.listAgentSessions())
            } catch (refreshError) {
              console.error('[侧边栏] 子会话部分删除后的列表刷新失败:', refreshError)
            }
            // 不继续删除父会话；否则失败子会话会留下指向已删除父会话的孤儿关系。
            return
          }
        }
        await window.electronAPI.deleteAgentSession(pendingDeleteId)
        // IPC 成功即代表后端已删除父会话；先收敛 Tab/缓存，再刷新列表。
        // 列表刷新失败不能把已经成功删除的会话继续留在 UI 中。
        applyAgentDeletionUi()
        // 清理持久化草稿（父会话 + 已删子会话；部分失败分支已提前 return，走到这里说明范围与快照一致）
        removeAgentDraft(store, pendingDeleteId)
        for (const childId of childIds) removeAgentDraft(store, childId)
        try {
          const sessions = await window.electronAPI.listAgentSessions()
          setAgentSessions(sessions)
        } catch (refreshError) {
          console.error('[侧边栏] 删除成功后的会话列表刷新失败:', refreshError)
        }
      } catch (error) {
        console.error('[侧边栏] 删除 Agent 会话失败:', error)
        // 后端可能因 dirty Worktree 等安全守卫拒绝删除；重新读取而不是
        // 乐观移除，避免 Renderer 隐藏仍然存在的会话。
        try {
          const sessions = await window.electronAPI.listAgentSessions()
          setAgentSessions(sessions)
        } catch (refreshError) {
          console.error('[侧边栏] 删除失败后的会话列表刷新失败:', refreshError)
        }
      } finally {
        setPendingDeleteId(null)
      }
      return
    }

    try {
      await window.electronAPI.deleteConversation(pendingDeleteId)
      // 全量刷新确保与后端同步
      const conversations = await window.electronAPI.listConversations()
      setConversations(conversations)
    } catch (error) {
      console.error('[侧边栏] 删除对话失败:', error)
      // 即使后端报错，也从本地列表移除（可能是对话已不存在）
      setConversations((prev) => prev.filter((c) => c.id !== pendingDeleteId))
    } finally {
      setPendingDeleteId(null)
    }
  }

  /** 在指定工作区中创建 Agent Draft 会话；未指定时使用当前工作区 */
  const createAgentSessionInWorkspace = React.useCallback(async (workspaceId?: string): Promise<void> => {
    const targetWorkspaceId = workspaceId ?? currentWorkspaceId ?? undefined
    if (targetWorkspaceId) {
      setCollapsedWorkspaceIds((prev) => deleteSetEntry(prev, targetWorkspaceId))
    }
    await createAgent({
      draft: true,
      recallDraft: true,
      workspaceId: targetWorkspaceId,
      channelId: agentChannelId || undefined,
      modelId: agentModelId || undefined,
    })
  }, [agentChannelId, agentModelId, createAgent, currentWorkspaceId])

  /** 创建新 Agent Draft 会话 */
  const handleNewAgentSession = React.useCallback(async (): Promise<void> => {
    setActiveView('conversations')
    await createAgentSessionInWorkspace()
  }, [createAgentSessionInWorkspace, setActiveView])

  /** 在项目行新建 Draft 会话；workspace=项目后 projectId 语义已收敛为 workspaceId（对齐 Proma：切到目标工作区） */
  const createAgentSessionInProject = React.useCallback(async (workspaceId: string): Promise<void> => {
    setActiveView('conversations')
    if (workspaceId) {
      setCollapsedWorkspaceIds((prev) => deleteSetEntry(prev, workspaceId))
      if (workspaceId !== currentWorkspaceId) {
        setCurrentWorkspaceId(workspaceId)
        window.electronAPI.updateSettings({ agentWorkspaceId: workspaceId }).catch(console.error)
      }
    }
    await createAgent({
      draft: true,
      workspaceId,
      channelId: agentChannelId || undefined,
      modelId: agentModelId || undefined,
    })
  }, [agentChannelId, agentModelId, createAgent, currentWorkspaceId, setActiveView])

  /** 清理存量 KanbanProject 绑定（workspace=项目后不再提供「移动到项目」列表入口） */
  const handleClearProjectBinding = React.useCallback(async (sessionId: string): Promise<void> => {
    try {
      const updated = await window.electronAPI.sendSessionCommand(sessionId, { kind: 'set_project_id', projectId: undefined })
      setAgentSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
    } catch (error) {
      console.error('[侧边栏] 移出项目失败:', error)
      toast.error('移出项目失败')
    }
  }, [setAgentSessions])

  /** 从本地文件夹创建项目（工作区，对齐 Proma）：选择文件夹 → 创建并切换到新工作区 */
  const handleCreateProjectFromFolder = React.useCallback(async (): Promise<void> => {
    const result = await window.electronAPI.openFolderDialog()
    if (!result?.path) return
    try {
      const workspace = await window.electronAPI.createAgentWorkspace({ name: result.name, projectRootPath: result.path })
      setWorkspaces((prev) => [workspace, ...prev.filter((existing) => existing.id !== workspace.id)])
      setCurrentWorkspaceId(workspace.id)
      setActiveView('conversations')
      window.electronAPI.updateSettings({ agentWorkspaceId: workspace.id }).catch(console.error)
      toast.success(`已创建项目「${workspace.name}」`)
    } catch (error) {
      const msg = error instanceof Error ? error.message : '创建失败'
      toast.error(msg)
    }
  }, [setActiveView, setCurrentWorkspaceId, setWorkspaces])

  /** 侧栏「+」新建项目（对齐 Proma：项目 = 工作区；可选绑定本地工程目录） */
  const handleCreateWorkspaceFromDialog = React.useCallback(async (input: { name: string; workingDirectory?: string }): Promise<void> => {
    setCreatingProject(true)
    try {
      const workspace = await window.electronAPI.createAgentWorkspace({
        name: input.name,
        projectRootPath: input.workingDirectory?.trim() || undefined,
      })
      setWorkspaces((prev) => [workspace, ...prev.filter((existing) => existing.id !== workspace.id)])
      setCurrentWorkspaceId(workspace.id)
      window.electronAPI.updateSettings({ agentWorkspaceId: workspace.id }).catch(console.error)
      setCreateProjectOpen(false)
      toast.success(`已创建项目「${workspace.name}」`)
      setActiveView('conversations')
    } catch (cause) {
      toast.error('创建项目失败', { description: cause instanceof Error ? cause.message : String(cause) })
    } finally {
      setCreatingProject(false)
    }
  }, [setActiveView, setCurrentWorkspaceId, setWorkspaces])

  const handleMoveToGroup = React.useCallback(async (sessionId: string, groupId?: string): Promise<void> => {
    try {
      const updated = await window.electronAPI.sendSessionCommand(sessionId, { kind: 'set_custom_group', groupId })
      setAgentSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
    } catch (error) {
      console.error('[侧边栏] 移动到分组失败:', error)
      toast.error('移动到分组失败')
    }
  }, [setAgentSessions])

  /** 打开「新建分组」对话框，记录发起会话，创建成功后自动把该会话归入新分组 */
  const handleRequestCreateGroup = React.useCallback((sessionId: string): void => {
    setCreateGroupTargetSessionId(sessionId)
  }, [])

  const handleSubmitCreateGroup = React.useCallback(async (name: string): Promise<void> => {
    if (!currentWorkspaceSlug || !createGroupTargetSessionId) return
    setCreatingSessionGroup(true)
    try {
      const group = await window.electronAPI.sessionGroups.create(currentWorkspaceSlug, name)
      setSessionGroups((prev) => [...prev, group])
      await handleMoveToGroup(createGroupTargetSessionId, group.id)
      setCreateGroupTargetSessionId(null)
      toast.success('分组已创建')
    } catch (error) {
      console.error('[侧边栏] 新建分组失败:', error)
      toast.error('新建分组失败')
    } finally {
      setCreatingSessionGroup(false)
    }
  }, [createGroupTargetSessionId, currentWorkspaceSlug, handleMoveToGroup, setSessionGroups])

  /** 设置会话标签 */
  const handleSetSessionLabels = React.useCallback(async (sessionId: string, labelIds: string[]): Promise<void> => {
    if (!workspaceRoot) return
    try {
      const updated = await window.electronAPI.labels.setSessionLabels(workspaceRoot, sessionId, labelIds)
      setAgentSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
    } catch (error) {
      console.error('[侧边栏] 设置标签失败:', error)
      toast.error('设置标签失败')
    }
  }, [setAgentSessions, workspaceRoot])

  /** 打开标签管理弹窗 */
  const handleManageLabels = React.useCallback((): void => {
    store.set(labelManagerWorkspaceRootAtom, workspaceRoot)
    store.set(labelManagerOpenAtom, true)
  }, [store, workspaceRoot])

  /** Project 行"查看任务"进入唯一任务看板并预设 Project facet。 */
  const handleOpenProjectDetail = React.useCallback((projectId: string): void => {
    setSelectedProjectId(projectId)
    setCodeMainView('tasks')
    setActiveView('conversations')
  }, [setActiveView, setCodeMainView, setSelectedProjectId])

  /** 切换当前工作区（组头 / 设置页共用）；同 ID 时不折叠 */
  const handleSwitchWorkspace = React.useCallback((workspaceId: string): void => {
    if (workspaceId === currentWorkspaceId) return
    // 切换期间先清空 Project facet 与未保存 Task 草稿，避免跨 Workspace 泄漏。
    setKanbanProjects([])
    setSelectedProjectId(null)
    setPendingTaskEditorTarget(null)
    setCurrentWorkspaceId(workspaceId)
    setActiveView('conversations')
    setCollapsedWorkspaceIds((prev) => deleteSetEntry(prev, workspaceId))
    window.electronAPI.updateSettings({ agentWorkspaceId: workspaceId }).catch(console.error)
  }, [
    currentWorkspaceId,
    setCurrentWorkspaceId,
    setActiveView,
    setKanbanProjects,
    setPendingTaskEditorTarget,
    setSelectedProjectId,
  ])

  /** 组头点击：当前工作区则折叠/展开，否则切换 */
  const handleSelectProject = React.useCallback((workspaceId: string): void => {
    if (workspaceId === currentWorkspaceId) {
      setCollapsedWorkspaceIds((prev) => toggleSetEntry(prev, workspaceId))
      return
    }
    handleSwitchWorkspace(workspaceId)
  }, [currentWorkspaceId, handleSwitchWorkspace])

  /** 侧栏「新任务」：先经工作区选择器（NewTaskProjectFlowDialog）再打开任务编辑器 */
  const handleNewTask = React.useCallback((): void => {
    setActiveView('conversations')
    setNewTaskProjectFlowOpen(true)
  }, [setActiveView, setNewTaskProjectFlowOpen])

  /** 合成「自动任务」组头部点击：仅折叠/展开，绝不切换当前工作区（它不是真实工作区） */
  const handleToggleGroupCollapse = React.useCallback((groupId: string): void => {
    setCollapsedWorkspaceIds((prev) => toggleSetEntry(prev, groupId))
  }, [])

  const handleToggleDelegationParent = React.useCallback((sessionId: string, expanded: boolean): void => {
    if (expanded) {
      setExpandedDelegationParentIds((prev) => deleteSetEntry(prev, sessionId))
      setCollapsedDelegationParentIds((prev) => {
        if (prev.has(sessionId)) return prev
        const next = new Set(prev)
        next.add(sessionId)
        return next
      })
      return
    }

    setCollapsedDelegationParentIds((prev) => deleteSetEntry(prev, sessionId))
    setExpandedDelegationParentIds((prev) => {
      if (prev.has(sessionId)) return prev
      const next = new Set(prev)
      next.add(sessionId)
      return next
    })
  }, [])

  const canDeleteWorkspace = React.useCallback(
    (workspace: AgentWorkspace): boolean => workspace.slug !== 'default' && workspaces.length > 1,
    [workspaces.length],
  )

  /** 请求删除工作区（弹出二次确认框） */
  const handleRequestDeleteWorkspace = React.useCallback((workspaceId: string): void => {
    setPendingDeleteWorkspaceId(workspaceId)
  }, [])

  /** 确认删除工作区及其绑定资源 */
  const handleConfirmDeleteWorkspace = React.useCallback(async (): Promise<void> => {
    const workspaceId = pendingDeleteWorkspaceId
    const workspace = workspaces.find((item) => item.id === workspaceId)
    if (!workspaceId || !workspace) return

    if (!canDeleteWorkspace(workspace)) {
      toast.error(workspace.slug === 'default' ? '默认工作区不能删除' : '至少需要保留一个工作区')
      setPendingDeleteWorkspaceId(null)
      return
    }

    const deletedSessionIds = new Set(
      agentSessions
        .filter((session) => session.workspaceId === workspaceId)
        .map((session) => session.id),
    )

    try {
      setDeletingWorkspaceId(workspaceId)

      await window.electronAPI.deleteAgentWorkspace(workspaceId)

      for (const sessionId of deletedSessionIds) {
        cleanupMapAtoms(sessionId)
      }

      setDraftSessionIds((prev: Set<string>) => {
        let changed = false
        const next = new Set(prev)
        for (const sessionId of deletedSessionIds) {
          if (next.delete(sessionId)) changed = true
        }
        return changed ? next : prev
      })

      setAgentMessagesCache((prev) => {
        let changed = false
        const next = new Map(prev)
        for (const sessionId of deletedSessionIds) {
          if (next.delete(sessionId)) changed = true
        }
        return changed ? next : prev
      })
      setAutomations((prev) => prev.filter((automation) => automation.workspaceId !== workspaceId))

      const currentTabs = store.get(tabsAtom)
      const currentActiveTabId = store.get(activeTabIdAtom)
      const nextTabs = currentTabs.filter((tab) => (
        (tab.type !== 'agent' && tab.type !== 'preview') || !deletedSessionIds.has(tab.sessionId)
      ))
      const nextActiveTabId = currentActiveTabId && nextTabs.some((tab) => tab.id === currentActiveTabId)
        ? currentActiveTabId
        : nextTabs[0]?.id ?? null

      setTabs(nextTabs)
      setActiveTabId(nextActiveTabId)
      syncActiveTabSideEffects(nextActiveTabId ? nextTabs.find((tab) => tab.id === nextActiveTabId) ?? null : null)

      // 后端删除成功后先按快照收敛本地列表；远端刷新失败不能把已删除工作区重新留在 UI。
      let remainingWorkspaces = workspaces.filter((item) => item.id !== workspaceId)
      let sessions = agentSessions.filter((session) => !deletedSessionIds.has(session.id))
      setWorkspaces(remainingWorkspaces)
      setAgentSessions(sessions)
      // 清理该工作区全部会话的持久化草稿
      for (const sessionId of deletedSessionIds) removeAgentDraft(store, sessionId)
      try {
        const [refreshedWorkspaces, refreshedSessions] = await Promise.all([
          window.electronAPI.listAgentWorkspaces(),
          window.electronAPI.listAgentSessions(),
        ])
        remainingWorkspaces = refreshedWorkspaces
        sessions = refreshedSessions
        setWorkspaces(remainingWorkspaces)
        setAgentSessions(sessions)
      } catch (refreshError) {
        console.error('[侧边栏] 删除成功后的工作区/会话列表刷新失败:', refreshError)
      }

      setExpandedExtraCounts((prev) => { const next = new Map(prev); next.delete(workspaceId); return next })

      setCollapsedWorkspaceIds((prev) => deleteSetEntry(prev, workspaceId))
      setExpandedDelegationParentIds((prev) => {
        let changed = false
        const next = new Set(prev)
        for (const sessionId of deletedSessionIds) {
          if (next.delete(sessionId)) changed = true
        }
        return changed ? next : prev
      })

      if (workspaceId === currentWorkspaceId) {
        const fallback = remainingWorkspaces.find((item) => item.slug === 'default') ?? remainingWorkspaces[0] ?? null
        setCurrentWorkspaceId(fallback?.id ?? null)
        if (fallback) {
          window.electronAPI.updateSettings({ agentWorkspaceId: fallback.id }).catch(console.error)
        }
      }

      toast.success('工作区已删除', {
        description: `已删除「${workspace.name}」及其绑定资源`,
      })
    } catch (error) {
      console.error('[侧边栏] 删除工作区失败:', error)
      const msg = error instanceof Error ? error.message : '删除工作区失败'
      toast.error(msg)
    } finally {
      setDeletingWorkspaceId(null)
      setPendingDeleteWorkspaceId(null)
    }
  }, [
    pendingDeleteWorkspaceId,
    workspaces,
    canDeleteWorkspace,
    agentSessions,
    cleanupMapAtoms,
    setDraftSessionIds,
    setAgentMessagesCache,
    setAutomations,
    store,
    setTabs,
    setActiveTabId,
    syncActiveTabSideEffects,
    setWorkspaces,
    setAgentSessions,
    currentWorkspaceId,
    setCurrentWorkspaceId,
  ])

  /** 展开某个工作区：每次额外展示 PROJECT_SESSION_EXPAND_STEP 条，可多次点击叠加（对齐 Claude 的「Show 20 more」增量分页） */
  const handleShowMoreSessions = React.useCallback((workspaceId: string): void => {
    setExpandedExtraCounts((prev) => {
      const next = new Map(prev)
      const current = prev.get(workspaceId) ?? 0
      next.set(workspaceId, current + PROJECT_SESSION_EXPAND_STEP)
      return next
    })
  }, [])

  /** 收起某个工作区额外展开的会话 */
  const handleCollapseExtraSessions = React.useCallback((workspaceId: string): void => {
    setExpandedExtraCounts((prev) => {
      const next = new Map(prev)
      next.delete(workspaceId)
      return next
    })
  }, [])

  /** 开始拖拽工作区排序 */
  const handleProjectDragStart = React.useCallback((e: React.DragEvent, workspaceId: string): void => {
    setDragProjectId(workspaceId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', workspaceId)
  }, [])

  /** 根据鼠标位置计算工作区插入点 */
  const handleProjectDragOver = React.useCallback((e: React.DragEvent, workspaceId: string): void => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (!dragProjectId || dragProjectId === workspaceId) {
      setProjectDropIndicator(null)
      return
    }

    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientY - rect.top) / rect.height
    const position: 'before' | 'after' = ratio < 0.5 ? 'before' : 'after'
    setProjectDropIndicator((prev) => (
      prev?.id === workspaceId && prev.position === position
        ? prev
        : { id: workspaceId, position }
    ))
  }, [dragProjectId])

  const handleProjectDragLeave = React.useCallback((e: React.DragEvent): void => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setProjectDropIndicator(null)
    }
  }, [])

  /**
   * 合成「自动任务」工作区组：聚合所有自动任务会话（跨工作区），
   * 作为这些会话在侧栏的统一归属地。会话为空时返回 null（不渲染空组）。
   */
  const automationGroup = React.useMemo<AgentProjectGroup | null>(
    () => {
      const sessions = sortAgentSessionsByUpdatedAtDesc(
        agentSessions.filter((session) =>
          !session.archived
          && !session.pinned
          && !draftSessionIds.has(session.id)
          && !!session.sourceAutomationId
        )
      )
      if (sessions.length === 0) return null
      return {
        workspace: { id: AUTOMATION_GROUP_ID, name: '自动任务', slug: AUTOMATION_GROUP_ID, createdAt: 0, updatedAt: 0 },
        sessions,
      }
    },
    [agentSessions, draftSessionIds],
  )

  /**
   * 当前侧栏视图可见的 Agent 会话 id 集合（active 视图语义，不随归档视图变化）：
   * 置顶 + 自动任务组 + 当前工作区非归档。供「未发送内容」区块跳过可见会话
   * （行标记已提示），避免与列表重复展示。
   */
  const visibleAgentSessionIds = React.useMemo(() => {
    const visible = new Set<string>()
    for (const session of pinnedAgentSessions) visible.add(session.id)
    if (automationGroup) {
      for (const session of automationGroup.sessions) visible.add(session.id)
    }
    for (const session of agentSessions) {
      if (session.archived) continue
      if (draftSessionIds.has(session.id)) continue
      if (session.workspaceId && session.workspaceId !== currentWorkspaceId) continue
      visible.add(session.id)
    }
    return visible
  }, [pinnedAgentSessions, automationGroup, agentSessions, draftSessionIds, currentWorkspaceId])

  /** 完成工作区排序并持久化（合成「自动任务」组与真实工作区一起排序，二者分别持久化） */
  const handleProjectDrop = React.useCallback((e: React.DragEvent, targetWorkspaceId: string): void => {
    e.preventDefault()
    const indicator = projectDropIndicator
    if (!dragProjectId || dragProjectId === targetWorkspaceId || !indicator || indicator.id !== targetWorkspaceId) {
      setDragProjectId(null)
      setProjectDropIndicator(null)
      return
    }

    // 构造当前显示顺序的 id 列表（真实工作区 + 按当前索引插入的合成组）
    const baseIds = workspaces.map((workspace) => workspace.id)
    const oldAutoIndex = automationGroup
      ? Math.min(Math.max(automationGroupOrder, 0), baseIds.length)
      : -1
    const displayIds = [...baseIds]
    if (oldAutoIndex >= 0) displayIds.splice(oldAutoIndex, 0, AUTOMATION_GROUP_ID)

    const fromIndex = displayIds.indexOf(dragProjectId)
    const toIndex = displayIds.indexOf(targetWorkspaceId)
    if (fromIndex === -1 || toIndex === -1) {
      setDragProjectId(null)
      setProjectDropIndicator(null)
      return
    }

    const reordered = [...displayIds]
    const [moved] = reordered.splice(fromIndex, 1)
    if (!moved) {
      setDragProjectId(null)
      setProjectDropIndicator(null)
      return
    }
    const adjustedToIndex = fromIndex < toIndex ? toIndex - 1 : toIndex
    const insertIndex = indicator.position === 'after' ? adjustedToIndex + 1 : adjustedToIndex
    reordered.splice(insertIndex, 0, moved)

    setDragProjectId(null)
    setProjectDropIndicator(null)

    // 拆分：合成组的新索引 → settings；真实工作区的新顺序 → 后端
    const newAutoIndex = reordered.indexOf(AUTOMATION_GROUP_ID)
    const newWorkspaceIds = reordered.filter((id) => id !== AUTOMATION_GROUP_ID)

    if (oldAutoIndex >= 0 && newAutoIndex !== oldAutoIndex) {
      setAutomationGroupOrder(newAutoIndex)
      window.electronAPI.updateSettings({ agentAutomationGroupOrder: newAutoIndex }).catch(console.error)
    }

    const workspaceOrderChanged = newWorkspaceIds.some((id, i) => id !== baseIds[i])
    if (workspaceOrderChanged) {
      const reorderedWorkspaces = newWorkspaceIds
        .map((id) => workspaces.find((w) => w.id === id))
        .filter((w): w is AgentWorkspace => !!w)
      setWorkspaces(reorderedWorkspaces)
      window.electronAPI
        .reorderAgentWorkspaces(newWorkspaceIds)
        .then(setWorkspaces)
        .catch((error) => {
          console.error('[侧边栏] 工作区排序失败:', error)
          setWorkspaces(workspaces)
          toast.error('工作区排序失败')
        })
    }
  }, [dragProjectId, projectDropIndicator, automationGroup, automationGroupOrder, setWorkspaces, workspaces])

  const handleProjectDragEnd = React.useCallback((): void => {
    setDragProjectId(null)
    setProjectDropIndicator(null)
  }, [])

  /** 选择 Agent 会话（打开或聚焦标签页） */
  const handleSelectAgentSession = React.useCallback((id: string, title: string): void => {
    openSession('agent', id, title)
    setActiveView('conversations')
    // 清除该会话的"已完成未查看"标记
    setUnviewedCompleted((prev: Set<string>) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [openSession, setActiveView, setUnviewedCompleted])

  const clearQuickSwitchHints = React.useCallback((): void => {
    for (const row of quickSwitchHintRowsRef.current) {
      delete row.dataset.quickSwitchLabel
      delete row.dataset.quickSwitchIndex
      row.querySelector<HTMLElement>('.session-quick-switch-modifier')?.replaceChildren()
      row.querySelector<HTMLElement>('.session-quick-switch-number')?.replaceChildren()
    }
    quickSwitchHintRowsRef.current = []
    quickSwitchTargetsRef.current = []
  }, [])

  const refreshQuickSwitchTargets = React.useCallback((): QuickSwitchTarget[] => {
    const root = sidebarRootRef.current
    if (!root) {
      clearQuickSwitchHints()
      return []
    }

    // 先完成所有布局读取，再只写入上次/本次涉及的最多 9 行，避免 write→read
    // 交错造成的 forced reflow。
    const rows = Array.from(root.querySelectorAll<HTMLElement>('.session-quick-switch-row'))
    const selectedRows: HTMLElement[] = []
    const targets: QuickSwitchTarget[] = []
    for (const row of rows) {
      if (targets.length >= SESSION_QUICK_SWITCH_LIMIT) break
      if (!isQuickSwitchRowVisible(row, root)) continue

      const { sessionSwitchId, sessionSwitchTitle, sessionSwitchType } = row.dataset
      if (
        !sessionSwitchId
        || !sessionSwitchTitle
        || (sessionSwitchType !== 'chat' && sessionSwitchType !== 'agent')
      ) continue

      selectedRows.push(row)
      targets.push({ id: sessionSwitchId, title: sessionSwitchTitle, type: sessionSwitchType })
    }

    const modifierLabel = getPrimaryModifierLabel(isMac)
    const nextRows = new Set(selectedRows)
    for (const row of quickSwitchHintRowsRef.current) {
      if (nextRows.has(row)) continue
      delete row.dataset.quickSwitchLabel
      delete row.dataset.quickSwitchIndex
      row.querySelector<HTMLElement>('.session-quick-switch-modifier')?.replaceChildren()
      row.querySelector<HTMLElement>('.session-quick-switch-number')?.replaceChildren()
    }
    selectedRows.forEach((row, index) => {
      const position = String(index + 1)
      if (row.dataset.quickSwitchIndex === position) return
      row.dataset.quickSwitchIndex = position
      row.dataset.quickSwitchLabel = `${modifierLabel}${position}`
      const modifier = row.querySelector<HTMLElement>('.session-quick-switch-modifier')
      const number = row.querySelector<HTMLElement>('.session-quick-switch-number')
      if (modifier) modifier.textContent = modifierLabel
      if (number) number.textContent = position
    })

    quickSwitchHintRowsRef.current = selectedRows
    quickSwitchTargetsRef.current = targets
    return targets
  }, [clearQuickSwitchHints, isMac])

  React.useEffect(() => {
    const root = sidebarRootRef.current
    if (!root) return

    if (!quickSwitchHintsVisible) {
      if (quickSwitchRefreshFrameRef.current !== null) {
        cancelAnimationFrame(quickSwitchRefreshFrameRef.current)
        quickSwitchRefreshFrameRef.current = null
      }
      clearQuickSwitchHints()
      return
    }

    const refresh = (): void => {
      if (quickSwitchRefreshFrameRef.current !== null) return
      quickSwitchRefreshFrameRef.current = requestAnimationFrame(() => {
        quickSwitchRefreshFrameRef.current = null
        refreshQuickSwitchTargets()
      })
    }
    refresh()
    root.addEventListener('scroll', refresh, true)
    window.addEventListener('resize', refresh)
    return () => {
      if (quickSwitchRefreshFrameRef.current !== null) {
        cancelAnimationFrame(quickSwitchRefreshFrameRef.current)
        quickSwitchRefreshFrameRef.current = null
      }
      root.removeEventListener('scroll', refresh, true)
      window.removeEventListener('resize', refresh)
    }
  }, [
    quickSwitchHintsVisible,
    clearQuickSwitchHints,
    refreshQuickSwitchTargets,
    sidebarCollapsed,
    mode,
    viewMode,
    conversations,
    agentSessions,
    pinnedConversations,
    pinnedAgentSessions,
    conversationGroups,
    expandedExtraCounts,
    collapsedWorkspaceIds,
    expandedDelegationParentIds,
    collapsedDelegationParentIds,
    activeSessionId,
  ])

  React.useEffect(() => {
    const clearHintTimer = (): void => {
      if (quickSwitchHintTimerRef.current !== null) {
        clearTimeout(quickSwitchHintTimerRef.current)
        quickSwitchHintTimerRef.current = null
      }
    }

    const hideHints = (): void => {
      clearHintTimer()
      setQuickSwitchHintsVisible(false)
    }

    // 修饰键松开的 keyup 有可能被系统截胡（例如按住 Cmd 拖拽框选区域截图、或
    // Cmd+Tab / Cmd+空格 等全局热键期间焦点短暂让渡给系统层），导致本窗口收不到
    // keyup，提示态卡死在 true——所有会话/项目行的标题会因为常驻的 44px 快捷键徽标
    // 占位而被过度截断。这里在下一次真实交互时按「修饰键实际是否按住」自愈。
    const modifierActuallyHeld = (event: { metaKey: boolean; ctrlKey: boolean }): boolean =>
      isMac ? event.metaKey : event.ctrlKey

    const handleMouseDown = (event: MouseEvent): void => {
      if (quickSwitchHintsVisible && !modifierActuallyHeld(event)) hideHints()
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (processedQuickSwitchEventsRef.current.has(event)) return
      processedQuickSwitchEventsRef.current.add(event)
      if (event.isComposing) return
      if (settingsOpen) return

      if (quickSwitchHintsVisible && !isPrimaryModifierKey(event, isMac) && !modifierActuallyHeld(event)) {
        hideHints()
      }

      const number = getQuickSwitchNumber(event)
      if (number !== null && hasOnlyPrimaryModifier(event, isMac)) {
        const targets = refreshQuickSwitchTargets()
        const target = targets[number - 1]
        if (!target) return

        event.preventDefault()
        event.stopPropagation()
        if (target.type === 'agent') {
          handleSelectAgentSession(target.id, target.title)
        } else {
          handleSelectConversation(target.id, target.title)
        }
        return
      }

      if (!isPrimaryModifierKey(event, isMac) || event.repeat) return
      clearHintTimer()
      quickSwitchHintTimerRef.current = setTimeout(() => {
        quickSwitchHintTimerRef.current = null
        if (refreshQuickSwitchTargets().length === 0) return
        setQuickSwitchHintsVisible(true)
      }, SESSION_QUICK_SWITCH_HINT_DELAY_MS)
    }

    const handleKeyUp = (event: KeyboardEvent): void => {
      if (processedQuickSwitchEventsRef.current.has(event)) return
      processedQuickSwitchEventsRef.current.add(event)
      if (isPrimaryModifierKey(event, isMac)) {
        hideHints()
      }
    }

    const handleForwardedKeyDown = (event: Event): void => {
      const forwarded = event as CustomEvent<{ event?: KeyboardEvent }>
      const originalEvent = forwarded.detail?.event
      if (originalEvent) handleKeyDown(originalEvent)
    }

    const handleForwardedKeyUp = (event: Event): void => {
      const forwarded = event as CustomEvent<{ event?: KeyboardEvent }>
      const originalEvent = forwarded.detail?.event
      if (originalEvent) handleKeyUp(originalEvent)
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)
    window.addEventListener('mousedown', handleMouseDown, true)
    window.addEventListener(SESSION_QUICK_SWITCH_KEYDOWN_EVENT, handleForwardedKeyDown)
    window.addEventListener(SESSION_QUICK_SWITCH_KEYUP_EVENT, handleForwardedKeyUp)
    window.addEventListener('blur', hideHints)
    document.addEventListener('visibilitychange', hideHints)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
      window.removeEventListener('mousedown', handleMouseDown, true)
      window.removeEventListener(SESSION_QUICK_SWITCH_KEYDOWN_EVENT, handleForwardedKeyDown)
      window.removeEventListener(SESSION_QUICK_SWITCH_KEYUP_EVENT, handleForwardedKeyUp)
      window.removeEventListener('blur', hideHints)
      document.removeEventListener('visibilitychange', hideHints)
      clearHintTimer()
    }
  }, [
    isMac,
    settingsOpen,
    activeView,
    handleSelectAgentSession,
    handleSelectConversation,
    refreshQuickSwitchTargets,
    quickSwitchHintsVisible,
  ])

  /** 重命名工作区名称 */
  const handleWorkspaceRename = React.useCallback(async (workspaceId: string, newName: string): Promise<void> => {
    try {
      const updated = await window.electronAPI.updateAgentWorkspace(workspaceId, { name: newName })
      setWorkspaces((prev) => prev.map((w) => (w.id === updated.id ? updated : w)))
    } catch (error) {
      console.error('[侧边栏] 重命名工作区失败:', error)
      const msg = error instanceof Error ? error.message : '重命名失败'
      toast.error(msg)
    }
  }, [setWorkspaces])

  /** 重命名 Agent 会话标题 */
  const handleAgentRename = React.useCallback(async (id: string, newTitle: string): Promise<void> => {
    try {
      const updated = await window.electronAPI.updateAgentSessionTitle(id, newTitle)
      setAgentSessions((prev) => replaceAgentSessionInFreshnessOrder(prev, updated))
      // 同步更新标签页标题
      setTabs((prev) => updateTabTitle(prev, id, newTitle))
    } catch (error) {
      console.error('[侧边栏] 重命名 Agent 会话失败:', error)
    }
  }, [setAgentSessions, setTabs])

  const closeArchivedAgentTabs = React.useCallback((sessionIds: string[]): void => {
    const ids = new Set(sessionIds)
    const currentTabs = store.get(tabsAtom)
    const currentActiveTabId = store.get(activeTabIdAtom)
    const nextTabs = currentTabs.filter((tab) => (
      (tab.type !== 'agent' && tab.type !== 'preview') || !ids.has(tab.sessionId)
    ))
    const nextActiveTabId = currentActiveTabId && nextTabs.some((tab) => tab.id === currentActiveTabId)
      ? currentActiveTabId
      : nextTabs[0]?.id ?? null

    setTabs(nextTabs)
    setActiveTabId(nextActiveTabId)
    for (const sessionId of ids) cleanupMapAtoms(sessionId)
    syncActiveTabSideEffects(nextActiveTabId ? nextTabs.find((tab) => tab.id === nextActiveTabId) ?? null : null)
  }, [cleanupMapAtoms, setActiveTabId, setTabs, store, syncActiveTabSideEffects])

  /** 切换 Agent 会话置顶状态 */
  const handleTogglePinAgent = React.useCallback(async (
    id: string,
    cascade: boolean = true,
  ): Promise<void> => {
    const sessions = store.get(agentSessionsAtom)
    const original = sessions.find((s) => s.id === id)
    const delegatedChildren = cascade
      ? getSyncableDelegatedChildren(sessions, id, draftSessionIds)
      : []
    try {
      const updated = await window.electronAPI.togglePinAgentSession(id)
      const targetPinned = !!updated.pinned
      for (const child of delegatedChildren) {
        if (!!child.pinned !== targetPinned) {
          await window.electronAPI.togglePinAgentSession(child.id)
        }
      }
      const refreshedSessions = delegatedChildren.length > 0
        ? await window.electronAPI.listAgentSessions()
        : null
      if (refreshedSessions) {
        setAgentSessions(refreshedSessions)
      } else {
        setAgentSessions((prev) => replaceAgentSessionInFreshnessOrder(prev, updated))
      }
      if (updated.pinned) {
        if (original?.archived && !updated.archived) {
          toast.success('已置顶', { description: '已自动取消归档' })
        } else if (delegatedChildren.length > 0) {
          toast.success('已置顶', { description: `已同步 ${delegatedChildren.length} 个子会话` })
        } else {
          toast.success('已置顶')
        }
      } else {
        toast.success(
          '已取消置顶',
          delegatedChildren.length > 0
            ? { description: `已同步 ${delegatedChildren.length} 个子会话` }
            : undefined,
        )
      }
    } catch (error) {
      console.error('[侧边栏] 切换 Agent 会话置顶失败:', error)
      // 级联可能在中途失败，导致部分子会话已切换、部分未切换。
      // 重新拉取磁盘真实状态，避免侧边栏与磁盘不一致直到下次重载。
      if (delegatedChildren.length > 0) {
        try {
          setAgentSessions(await window.electronAPI.listAgentSessions())
        } catch (refreshError) {
          console.error('[侧边栏] 置顶失败后刷新会话列表失败:', refreshError)
        }
      }
    }
  }, [draftSessionIds, store, setAgentSessions])

  /** 切换 Agent 会话星标状态 */
  const handleToggleStarAgent = React.useCallback(async (id: string): Promise<void> => {
    try {
      const updated = await window.electronAPI.toggleStarAgentSession(id)
      setAgentSessions((prev) => replaceAgentSessionInFreshnessOrder(prev, updated))
    } catch (error) {
      console.error('[侧边栏] 切换 Agent 会话星标失败:', error)
    }
  }, [setAgentSessions])

  /** 切换 Agent 会话归档状态 */
  const handleToggleArchiveAgent = React.useCallback(async (id: string): Promise<void> => {
    const sessions = store.get(agentSessionsAtom)
    // 在 try 外追踪级联状态，便于失败时重新同步与关闭已归档子会话的标签页。
    let cascaded = false
    const changedChildIds: string[] = []
    try {
      const updated = await window.electronAPI.toggleArchiveAgentSession(id)
      const targetArchived = !!updated.archived
      // 归档：同步未归档的子会话一起进归档
      // 解归档：同步已归档的子会话一起恢复（修复"归档是单向级联"问题）
      const delegatedChildren = targetArchived
        ? getSyncableDelegatedChildren(sessions, id, draftSessionIds)
        : getArchivedDelegatedChildren(sessions, id, draftSessionIds)
      cascaded = delegatedChildren.length > 0
      const failedChildIds: string[] = []
      for (const child of delegatedChildren) {
        if (!!child.archived !== targetArchived) {
          try {
            const childUpdated = await window.electronAPI.toggleArchiveAgentSession(child.id)
            changedChildIds.push(childUpdated.id)
          } catch (childError) {
            console.error(`[侧边栏] 级联归档子会话失败 (${child.id}):`, childError)
            failedChildIds.push(child.id)
          }
        }
      }
      const refreshedSessions = delegatedChildren.length > 0
        ? await window.electronAPI.listAgentSessions()
        : null
      if (refreshedSessions) {
        setAgentSessions(refreshedSessions)
      } else {
        setAgentSessions((prev) => replaceAgentSessionInFreshnessOrder(prev, updated))
      }
      // 归档时自动关闭该会话的标签页，并同步新激活标签的副作用，
      // 否则 RightSidePanel（依赖 currentAgentSessionIdAtom）会因为
      // 指针被错误置 null 而消失。
      if (updated.archived) {
        closeArchivedAgentTabs([updated.id, ...changedChildIds])
      }
      if (failedChildIds.length > 0) {
        toast.error(`部分子会话${updated.archived ? '归档' : '解归档'}失败（${failedChildIds.length} 个）`)
      } else {
        toast.success(
          updated.archived ? '已归档' : '已取消归档',
          delegatedChildren.length > 0
            ? { description: `已同步 ${delegatedChildren.length} 个子会话` }
            : undefined,
        )
      }
    } catch (error) {
      console.error('[侧边栏] 切换 Agent 会话归档失败:', error)
      // 父会话操作本身失败。已成功归档的子会话仍需关闭标签并全量刷新。
      if (cascaded) {
        if (changedChildIds.length > 0) {
          closeArchivedAgentTabs(changedChildIds)
        }
        try {
          setAgentSessions(await window.electronAPI.listAgentSessions())
        } catch (refreshError) {
          console.error('[侧边栏] 归档失败后刷新会话列表失败:', refreshError)
        }
      }
    }
  }, [closeArchivedAgentTabs, draftSessionIds, store, setAgentSessions])

  /** 请求迁移会话到其他工作区（弹出迁移对话框） */
  const handleRequestMove = React.useCallback((id: string): void => {
    setMoveTargetId(id)
    // 查找被迁移会话所属的工作区——排除分区应基于此而非当前 UI 工作区
    const session = agentSessions.find((s) => s.id === id)
    setMoveSourceWorkspaceId(session?.workspaceId)
  }, [agentSessions])

  /** 迁移会话到另一个工作区后的回调 */
  const handleSessionMoved = async (updatedSession: AgentSessionMeta, targetWorkspaceName: string): Promise<void> => {
    const movedSessionIds = collectDelegatedSessionTreeIds(store.get(agentSessionsAtom), updatedSession.id)
    try {
      const sessions = await window.electronAPI.listAgentSessions()
      setAgentSessions(sessions)
    } catch (error) {
      console.error('[侧边栏] 迁移后刷新 Agent 会话列表失败:', error)
      setAgentSessions((prev) => replaceAgentSessionInFreshnessOrder(prev, updatedSession))
    }
    const hasMovedOpenTab = tabs.some((tab) => (
      (tab.type === 'agent' || tab.type === 'preview')
      && movedSessionIds.has(tab.sessionId)
    ))
    if (hasMovedOpenTab) {
      let tabResult = { tabs, activeTabId }
      for (const sessionId of movedSessionIds) {
        tabResult = closeTab(tabResult.tabs, tabResult.activeTabId, sessionId)
        cleanupMapAtoms(sessionId)
      }
      setTabs(tabResult.tabs)
      setActiveTabId(tabResult.activeTabId)
      const nextActiveTab = tabResult.activeTabId
        ? tabResult.tabs.find((tab) => tab.id === tabResult.activeTabId) ?? null
        : null
      syncActiveTabSideEffects(nextActiveTab)
    }
    if (currentAgentSessionId && movedSessionIds.has(currentAgentSessionId)) {
      setCurrentAgentSessionId(null)
    }
    setMoveTargetId(null)
    toast.success('会话已迁移', {
      description: `已迁移到「${targetWorkspaceName}」，子会话会一起移动`,
    })
  }

  // fork 适配：Agent 归档由「状态筛选=已归档」驱动（非独立 viewMode），渲染源统一取自
  // 已包含全部会话（含归档）的 agentSessions（upstream v0.17.26 baseline 起不再懒加载归档列表）。
  const agentHistorySourceSessions = agentSessions

  /** Agent 归档视图：跨工作区按日期分组的归档会话树（含委派子树），对齐 Proma 的已归档列表 */
  const archivedAgentSessionGroups = React.useMemo(() => {
    if (agentStatusFilter !== 'archived') return []
    const archived = sortAgentSessionsByUpdatedAtDesc(
      agentHistorySourceSessions.filter((session) => session.archived && !draftSessionIds.has(session.id))
    )
    const trees = buildAgentSessionTrees(archived)
    const wrapped = trees.map((tree) => ({ updatedAt: tree.session.updatedAt, tree }))
    return groupByDate(wrapped).map((group) => ({ label: group.label, items: group.items.map((item) => item.tree) }))
  }, [agentHistorySourceSessions, agentStatusFilter, draftSessionIds])

  /** Agent 普通历史按工作区分组（排除置顶 / draft；归档状态由「筛选与排序」的状态筛选决定，
   * 不再有单独的「已归档」区块——活跃/已归档/全部统一走这套日期分组渲染） */
  const agentProjectGroups = React.useMemo<AgentProjectGroup[]>(
    () => {
      const sessionsByWorkspaceId = new Map<string, AgentSessionMeta[]>()
      for (const workspace of workspaces) {
        sessionsByWorkspaceId.set(workspace.id, [])
      }

      const sessionsById = new Map(agentHistorySourceSessions.map((session) => [session.id, session]))
      const visibleHistory = sortAgentSessionsByUpdatedAtDesc(
        agentHistorySourceSessions.filter((session) =>
          (agentStatusFilter === 'active' ? !session.archived
            : agentStatusFilter === 'archived' ? session.archived
              : true)
          && !session.pinned
          && !draftSessionIds.has(session.id)
          && !hasTaskDraftAncestor(session, sessionsById)
          // 自动任务会话不进入工作区列表，统一归到「自动任务」视图
          && !isHiddenAutomationSession(session)
          // 已被置顶母会话收纳的子会话留在置顶区的母会话下面，避免重复显示为工作区根会话
          && !hasPinnedVisibleParent(session, sessionsById)
        )
      )

      const defaultWsId = workspaces.find((ws) => ws.slug === 'default')?.id ?? workspaces[0]?.id
      for (const session of visibleHistory) {
        const targetId = session.workspaceId && sessionsByWorkspaceId.has(session.workspaceId)
          ? session.workspaceId
          : defaultWsId
        if (!targetId) continue
        sessionsByWorkspaceId.get(targetId)!.push(session)
      }

      return workspaces.map((workspace) => ({
        workspace,
        sessions: sessionsByWorkspaceId.get(workspace.id) ?? [],
      }))
    },
    [agentHistorySourceSessions, draftSessionIds, workspaces, agentStatusFilter],
  )

  /**
   * 工作区组的最终显示顺序：把合成「自动任务」组按持久化的索引插入真实工作区组中
   * （默认索引 0 = 最靠前）。合成组与真实工作区一起参与拖拽排序。
   */
  const displayProjectGroups = React.useMemo<AgentProjectGroup[]>(
    () => {
      if (!automationGroup) return agentProjectGroups
      const idx = Math.min(Math.max(automationGroupOrder, 0), agentProjectGroups.length)
      const combined = [...agentProjectGroups]
      combined.splice(idx, 0, automationGroup)
      return combined
    },
    [agentProjectGroups, automationGroup, automationGroupOrder],
  )

  /**
   * 状态 / 自定义分组 / 不分组同样消费统一任务树。分页和分桶按根任务族计数，
   * 子任务始终跟随主任务，不会因切换分组而消失或单独占满预览名额。
   */
  const agentFlatModeTrees = React.useMemo<AgentSessionTreeItem[]>(() => {
    if (agentGroupBy === 'date' || agentGroupBy === 'project') return []
    const sessionsById = new Map(agentHistorySourceSessions.map((session) => [session.id, session]))
    const visible = agentHistorySourceSessions.filter((session) => {
      if (draftSessionIds.has(session.id)) return false
      if (hasTaskDraftAncestor(session, sessionsById)) return false
      if (session.pinned || hasPinnedVisibleParent(session, sessionsById)) return false
      if (isHiddenAutomationSession(session)) return false
      if (currentWorkspaceId && session.workspaceId && session.workspaceId !== currentWorkspaceId) return false
      if (agentStatusFilter === 'active' && session.archived) return false
      if (agentStatusFilter === 'archived' && !session.archived) return false
      return true
    })
    const labelFilter = currentWorkspaceId
      ? { labelIds: sessionListPreference.labelIdsByWorkspace?.[currentWorkspaceId] ?? [], includeUnlabeled: sessionListPreference.includeUnlabeledByWorkspace?.[currentWorkspaceId] }
      : { labelIds: [], includeUnlabeled: undefined }
    return sortSessionTrees(buildAgentSessionTrees(visible, labelFilter.labelIds.length > 0 ? labelFilter : undefined), agentSortBy)
  }, [agentGroupBy, agentHistorySourceSessions, currentWorkspaceId, sessionListPreference.labelIdsByWorkspace, sessionListPreference.includeUnlabeledByWorkspace, draftSessionIds, agentStatusFilter, agentSortBy])

  const agentFlatModeGroups = React.useMemo<Array<{ label: string; groupId?: string; items: AgentSessionTreeItem[] }>>(() => {
    if (agentGroupBy === 'state') {
      const definitions: Array<{ status: SessionIndicatorStatus; label: string }> = [
        { status: 'blocked', label: '需要处理' },
        { status: 'running', label: '进行中' },
        { status: 'completed', label: '已完成' },
        { status: 'idle', label: '空闲' },
      ]
      return definitions
        .map(({ status, label }) => ({
          label,
          items: agentFlatModeTrees.filter((item) => getSessionTreeStatus(item, agentIndicatorMap) === status),
        }))
        .filter((group) => group.items.length > 0)
    }

    if (agentGroupBy === 'customGroup') {
      const groups: Array<{ label: string; groupId?: string; items: AgentSessionTreeItem[] }> = sessionGroups
        .map((group) => ({
          label: group.name,
          groupId: group.id,
          items: agentFlatModeTrees.filter((item) => getSessionTreeCustomGroupId(item) === group.id),
        }))
        .filter((group) => group.items.length > 0)
      const knownIds = new Set(sessionGroups.map((group) => group.id))
      const ungrouped = agentFlatModeTrees.filter((item) => {
        const groupId = getSessionTreeCustomGroupId(item)
        return !groupId || !knownIds.has(groupId)
      })
      if (ungrouped.length > 0) groups.push({ label: '未分组', groupId: undefined, items: ungrouped })
      return groups
    }

    return []
  }, [agentFlatModeTrees, agentGroupBy, agentIndicatorMap, sessionGroups])

  // 扁平模式（state/customGroup/none）折叠态
  const [flatModeExpanded, setFlatModeExpanded] = React.useState(false)
  /** 置顶会话溢出部分是否展开（超过 PINNED_SESSION_VISIBLE_LIMIT 的部分），Chat / Agent 置顶区共用 */
  const [pinnedOverflowExpanded, setPinnedOverflowExpanded] = React.useState(false)
  /** 置顶溢出数量：Chat 模式按置顶对话数，Agent 模式按置顶会话树数 */
  const pinnedChatOverflow = Math.max(0, pinnedConversations.length - PINNED_SESSION_VISIBLE_LIMIT)
  const pinnedAgentOverflow = Math.max(0, pinnedAgentSessionTrees.length - PINNED_SESSION_VISIBLE_LIMIT)
  /** 自动任务组溢出部分是否展开（超过 AUTOMATION_SESSION_VISIBLE_LIMIT 的部分），交互对齐置顶区 */
  const [automationOverflowExpanded, setAutomationOverflowExpanded] = React.useState(false)
  /** 自动任务组溢出数量（超出默认上限的会话数） */
  const automationOverflow = automationGroup ? Math.max(0, automationGroup.sessions.length - AUTOMATION_SESSION_VISIBLE_LIMIT) : 0
  /** 扁平模式下已折叠的分组（状态/自定义分组）标题；hover 标题行显示折叠按钮，对齐日期分组
   * 置顶分组默认展开（对齐 Proma：置顶不做默认折叠，避免用户找不到已置顶的会话），
   * 仅保留用户手动折叠的记忆状态。 */
  const [collapsedFlatGroupIds, setCollapsedFlatGroupIds] = React.useState<Set<string>>(() => new Set())
  // 置顶区若被用户手动折叠，存在 running/blocked 的置顶任务族时仍自动展开（对齐「需要处理/进行中」优先可见）
  React.useEffect(() => {
    const hasActivePinned = pinnedAgentSessions.some((session) => {
      const status = getSessionTreeStatus(
        { session, childSessions: getDirectDelegatedChildren(agentSessions, session.id) },
        agentIndicatorMap,
      )
      return status === 'running' || status === 'blocked'
    })
    if (hasActivePinned) {
      setCollapsedFlatGroupIds((prev) => {
        if (!prev.has(PINNED_AGENT_GROUP_KEY)) return prev
        const next = new Set(prev)
        next.delete(PINNED_AGENT_GROUP_KEY)
        return next
      })
    }
  }, [agentIndicatorMap, agentSessions, pinnedAgentSessions])
  // 项目模式下「新建项目」弹窗（状态已在顶层声明 creatingProject/setCreatingProject）
  const [createProjectOpen, setCreateProjectOpen] = React.useState(false)

  /** 会话项标签 Props（复用，避免每行单独计算） */
  const agentSessionItemLabelProps = React.useMemo(() => ({
    labels: workspaceLabels.length > 0 ? workspaceLabels : undefined,
    onSetLabels: handleSetSessionLabels,
    onManageLabels: handleManageLabels,
  }), [workspaceLabels, handleSetSessionLabels, handleManageLabels])

  /** Projects Tab 会话行操作包：与会话 Tab 共享同一批 handler，保证两个 Tab 行为一致 */
  const projectTabSessionHandlers = React.useMemo<ProjectSessionHandlers>(() => ({
    onSelectSession: handleSelectAgentSession,
    onRequestDelete: handleRequestDelete,
    onRequestMove: handleRequestMove,
    onRename: handleAgentRename,
    onTogglePin: handleTogglePinAgent,
    onToggleStar: handleToggleStarAgent,
    onToggleArchive: handleToggleArchiveAgent,
    onClearProjectBinding: handleClearProjectBinding,
    onNewSessionInProject: createAgentSessionInProject,
    sessionGroups,
    onMoveToGroup: handleMoveToGroup,
    onCreateGroup: handleRequestCreateGroup,
    ...agentSessionItemLabelProps,
  }), [
    createAgentSessionInProject,
    handleAgentRename,
    handleClearProjectBinding,
    handleMoveToGroup,
    handleRequestCreateGroup,
    handleRequestDelete,
    handleRequestMove,
    handleSelectAgentSession,
    handleToggleArchiveAgent,
    handleTogglePinAgent,
    handleToggleStarAgent,
    sessionGroups,
  ])

  const handleRailModeSwitch = React.useCallback((targetMode: AppMode) => {
    setViewMode('active')
    if (targetMode === mode) return

    // 遗留顶栏 Work：并入 Code 主区看板视图
    if (targetMode === 'cowork') {
      setMode('agent')
      setCodeMainView('tasks')
      setActiveView('conversations')
      return
    }

    const isChatMode = targetMode === 'chat'
    const sessions = isChatMode ? conversations : agentSessions
    const lastId = isChatMode ? currentConversationId : currentAgentSessionId

    if (lastId) {
      const match = sessions.find((s) => s.id === lastId)
      if (match) {
        openSession(targetMode as 'chat' | 'agent', match.id, match.title)
        return
      }
    }

    const tab = tabs.find((t) => t.type === targetMode as 'chat' | 'agent')
    if (tab) {
      openSession(targetMode as 'chat' | 'agent', tab.sessionId, tab.title)
      return
    }

    const agentSessionsById = isChatMode ? null : new Map(agentSessions.map((session) => [session.id, session]))
    const recent = sessions.find((s) => (
      !s.archived
      && !draftSessionIds.has(s.id)
      && (isChatMode || !hasTaskDraftAncestor(s as AgentSessionMeta, agentSessionsById!))
    ))
    if (recent) {
      openSession(targetMode as 'chat' | 'agent', recent.id, recent.title)
      return
    }

    setMode(targetMode)
  }, [
    mode,
    conversations,
    agentSessions,
    currentConversationId,
    currentAgentSessionId,
    tabs,
    draftSessionIds,
    openSession,
    setMode,
    setViewMode,
    setCodeMainView,
    setActiveView,
  ])

  const railRecentItems = React.useMemo(() => {
    if (mode === 'chat') {
      return conversations
        .filter((c) => !c.archived && !draftSessionIds.has(c.id))
        .sort((a, b) => {
          const activeDelta = Number(b.id === activeSessionId) - Number(a.id === activeSessionId)
          if (activeDelta !== 0) return activeDelta
          const streamingDelta = Number(streamingIds.has(b.id)) - Number(streamingIds.has(a.id))
          if (streamingDelta !== 0) return streamingDelta
          const pinnedDelta = Number(!!b.pinned) - Number(!!a.pinned)
          if (pinnedDelta !== 0) return pinnedDelta
          return b.updatedAt - a.updatedAt
        })
        .slice(0, 5)
        .map((conversation) => ({
          id: conversation.id,
          title: conversation.title,
          type: 'chat' as const,
          initial: getRailInitial(conversation.title),
          active: conversation.id === activeSessionId,
          status: streamingIds.has(conversation.id) ? 'running' as const : 'idle' as const,
          pinned: !!conversation.pinned,
          workspaceName: undefined,
        }))
    }

    const sessionsById = new Map(agentSessions.map((session) => [session.id, session]))
    return agentSessions
      .filter((session) =>
        !session.archived
        && !draftSessionIds.has(session.id)
        && !hasTaskDraftAncestor(session, sessionsById)
        && (!currentWorkspaceId || session.workspaceId === currentWorkspaceId)
        // 自动任务会话不出现在收起态 Rail，与展开态列表保持一致
        && !isHiddenAutomationSession(session)
      )
      .sort((a, b) => {
        const statusA = agentIndicatorMap.get(a.id) ?? (unviewedCompletedSessionIds.has(a.id) ? 'completed' : 'idle')
        const statusB = agentIndicatorMap.get(b.id) ?? (unviewedCompletedSessionIds.has(b.id) ? 'completed' : 'idle')
        const priority = (session: AgentSessionMeta, status: SessionIndicatorStatus): number => {
          if (session.id === activeSessionId) return 0
          if (status === 'blocked') return 1
          if (status === 'running') return 2
          if (session.pinned) return 3
          if (status === 'completed') return 4
          return 5
        }
        const priorityDelta = priority(a, statusA) - priority(b, statusB)
        if (priorityDelta !== 0) return priorityDelta
        return b.updatedAt - a.updatedAt
      })
      .slice(0, 5)
      .map((session) => ({
        id: session.id,
        title: session.title,
        type: 'agent' as const,
        initial: getRailInitial(session.title),
        active: session.id === activeSessionId,
        status: agentIndicatorMap.get(session.id) ?? (unviewedCompletedSessionIds.has(session.id) ? 'completed' as const : 'idle' as const),
        pinned: !!session.pinned,
        workspaceName:
          session.workspaceId && session.workspaceId !== currentWorkspaceId
            ? workspaceNameMap.get(session.workspaceId)
            : undefined,
        isAutomation: !!session.sourceAutomationId,
        isDelegation: !!session.sourceDelegationId,
      }))
  }, [
    mode,
    conversations,
    agentSessions,
    draftSessionIds,
    currentWorkspaceId,
    activeSessionId,
    streamingIds,
    agentIndicatorMap,
    unviewedCompletedSessionIds,
    workspaceNameMap,
  ])

  // 删除确认弹窗（collapsed/expanded 共享）
  const deleteDialog = (
    <AlertDialog
      open={pendingDeleteId !== null}
      onOpenChange={(open) => { if (!open) setPendingDeleteId(null) }}
    >
      <AlertDialogContent
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          // 若焦点已在某个 Action 按钮上，让按钮自身的 onClick 处理（避免重复触发）
          const target = e.target as HTMLElement
          if (target.closest('button[role="menuitem"], button[data-radix-dialog-action], button')) return
          e.preventDefault()
          // 有子会话时默认不级联，避免 Enter 误删子会话
          void handleConfirmDelete(false)
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>确认删除{mode === 'agent' ? '会话' : '对话'}</AlertDialogTitle>
          <AlertDialogDescription>
            {mode === 'agent' && pendingDeleteChildCount > 0
              ? `此会话下还有 ${pendingDeleteChildCount} 个子会话。删除后将无法恢复，请选择是否一并删除子会话。`
              : '删除后将无法恢复，确定要删除这个对话吗？'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          {mode === 'agent' && pendingDeleteChildCount > 0 ? (
            <>
              <AlertDialogAction
                onClick={() => { void handleConfirmDelete(false) }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                只删这个
              </AlertDialogAction>
              <AlertDialogAction
                onClick={() => { void handleConfirmDelete(true) }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                连子会话一起删
              </AlertDialogAction>
            </>
          ) : (
            <AlertDialogAction
              onClick={() => { void handleConfirmDelete(false) }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              删除
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  // 工作区删除确认弹窗（会同时删除其下的会话与绑定资源）
  const projectDeleteDialog = (
    <AlertDialog
      open={pendingDeleteWorkspaceId !== null}
      onOpenChange={(open) => {
        if (!open && !deletingWorkspaceId) setPendingDeleteWorkspaceId(null)
      }}
    >
      <AlertDialogContent
        onCloseAutoFocus={(event) => event.preventDefault()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !deletingWorkspaceId) {
            e.preventDefault()
            void handleConfirmDeleteWorkspace()
          }
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>确认删除工作区</AlertDialogTitle>
          <AlertDialogDescription>
            将删除「{pendingDeleteWorkspace?.name ?? '该工作区'}」及其绑定的所有会话、自动任务、MCP、Skills、工作区文件和 MyYoda 托管目录。附加目录、附加文件和项目绑定的外部工作目录只会移除引用，不会删除原始文件。Todo 与日程记录不会被删除，但之后可能需要重新归类。删除后无法恢复。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={!!deletingWorkspaceId}>取消</AlertDialogCancel>
          <AlertDialogAction
            disabled={!!deletingWorkspaceId}
            onClick={handleConfirmDeleteWorkspace}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deletingWorkspaceId ? '删除中...' : '删除工作区'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  // 迁移会话对话框（collapsed/expanded 共享）
  const moveDialog = (
    <MoveSessionDialog
      open={moveTargetId !== null}
      onOpenChange={(open) => { if (!open) setMoveTargetId(null) }}
      sessionId={moveTargetId ?? ''}
      sourceWorkspaceId={moveSourceWorkspaceId ?? undefined}
      workspaces={workspaces}
      onMoved={handleSessionMoved}
    />
  )

  // Chat 历史展平为固定行：日期标题、置顶标题和每个会话各占一行，供虚拟列表
  // 按需挂载。不要把整个日期组作为一行，否则大量会话仍会同时留在 DOM。
  const newChatShortcutLabel = getAcceleratorDisplay(getActiveAccelerator('new-session'))
  const isPinnedAgentGroupCollapsed = collapsedFlatGroupIds.has(PINNED_AGENT_GROUP_KEY)

  const chatActiveVirtualRows = React.useMemo<VirtualSidebarRow[]>(() => {
    const rows: VirtualSidebarRow[] = []
    if (pinnedConversations.length > 0) {
      rows.push({
        id: 'chat-pinned-heading',
        estimateSize: 30,
        content: <div className="pl-[18px] pr-3.5 pt-2 pb-1 text-[13px] font-medium leading-[18px] text-foreground/40 select-none">置顶</div>,
      })
      for (const conv of pinnedConversations) {
        rows.push({
          id: `chat-pinned-${conv.id}`,
          estimateSize: 34,
          content: (
            <div className="px-2">
              <div className="ml-4">
                <ConversationItem
                  conversation={conv}
                  active={conv.id === activeSessionId}
                  streaming={streamingIds.has(conv.id)}
                  showPinIcon={false}
                  relativeTimeNow={relativeTimeNow}
                  onSelect={handleSelectConversation}
                  onRequestDelete={handleRequestDelete}
                  onRename={handleRename}
                  onTogglePin={handleTogglePin}
                  onToggleArchive={handleToggleArchive}
                />
              </div>
            </div>
          ),
        })
      }
    }

    rows.push({
      id: 'chat-history-heading',
      estimateSize: 34,
      content: (
        <div className="group/chat-section relative flex items-center px-2 pt-2 pb-1">
          <span className="ml-[4px] px-1.5 text-[13px] font-medium leading-[18px] text-foreground/40 select-none">对话</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="新建对话"
                onClick={() => { void handleNewConversation() }}
                className="absolute right-2 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-foreground/30 transition-colors hover:bg-foreground/[0.055] hover:text-foreground/65 titlebar-no-drag"
              >
                <Plus size={13} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {`新建对话${newChatShortcutLabel ? ` (${newChatShortcutLabel})` : ''}`}
            </TooltipContent>
          </Tooltip>
        </div>
      ),
    })

    for (const group of conversationGroups) {
      rows.push({
        id: `chat-date-${group.label}`,
        estimateSize: 30,
        content: <div className="ml-[4px] px-3.5 pt-2 pb-1 text-[13px] font-medium leading-[18px] text-foreground/40 select-none">{group.label}</div>,
      })
      for (const conv of group.items) {
        rows.push({
          id: `chat-${conv.id}`,
          estimateSize: 34,
          content: (
            <div className="px-2">
              <ConversationItem
                conversation={conv}
                active={conv.id === activeSessionId}
                streaming={streamingIds.has(conv.id)}
                showPinIcon={!!conv.pinned}
                relativeTimeNow={relativeTimeNow}
                onSelect={handleSelectConversation}
                onRequestDelete={handleRequestDelete}
                onRename={handleRename}
                onTogglePin={handleTogglePin}
                onToggleArchive={handleToggleArchive}
              />
            </div>
          ),
        })
      }
    }
    return rows
  }, [activeSessionId, conversationGroups, handleNewConversation, handleRename, handleRequestDelete, handleSelectConversation, handleToggleArchive, handleTogglePin, newChatShortcutLabel, pinnedConversations, relativeTimeNow, streamingIds])

  const chatArchivedVirtualRows = React.useMemo<VirtualSidebarRow[]>(() => {
    const rows: VirtualSidebarRow[] = []
    for (const group of conversationGroups) {
      rows.push({
        id: `chat-archived-date-${group.label}`,
        estimateSize: 30,
        content: <div className="px-3 pt-2 pb-1 text-[13px] font-medium leading-[18px] text-foreground/40 select-none">{group.label}</div>,
      })
      for (const conv of group.items) {
        rows.push({
          id: `chat-archived-${conv.id}`,
          estimateSize: 34,
          content: (
            <div className="px-3">
              <ConversationItem
                conversation={conv}
                active={conv.id === activeSessionId}
                streaming={streamingIds.has(conv.id)}
                showPinIcon={!!conv.pinned}
                relativeTimeNow={relativeTimeNow}
                onSelect={handleSelectConversation}
                onRequestDelete={handleRequestDelete}
                onRename={handleRename}
                onTogglePin={handleTogglePin}
                onToggleArchive={handleToggleArchive}
              />
            </div>
          ),
        })
      }
    }
    return rows
  }, [activeSessionId, conversationGroups, handleRename, handleRequestDelete, handleSelectConversation, handleToggleArchive, handleTogglePin, relativeTimeNow, streamingIds])

  const agentArchivedVirtualRows = React.useMemo<VirtualSidebarRow[]>(() => {
    const rows: VirtualSidebarRow[] = []
    for (const group of archivedAgentSessionGroups) {
      rows.push({
        id: `agent-archived-date-${group.label}`,
        estimateSize: 30,
        content: <div className="px-3 pt-2 pb-1 text-[13px] font-medium leading-[18px] text-foreground/40 select-none">{group.label}</div>,
      })
      for (const item of group.items) {
        const childCount = item.childSessions.length
        const rowStatus = getSessionTreeStatus(item, agentIndicatorMap)
        const treeActive = treeContainsSessionId(item, activeSessionId)
        const activeChildVisible = item.childSessions.some((child) => child.id === activeSessionId)
        const expandedChildren = expandedDelegationParentIds.has(item.session.id)
          || (activeChildVisible && !collapsedDelegationParentIds.has(item.session.id))
        rows.push({
          id: `agent-archived-${item.session.id}`,
          estimateSize: 34,
          content: (
            <div className="px-3">
              <AgentSessionItem
                session={item.session}
                active={treeActive}
                indicatorStatus={rowStatus}
                showPinIcon={!!item.session.pinned}
                disableMiniMap={!sessionHoverPreviewEnabled}
                childSummary={childCount > 0
                  ? {
                    total: childCount,
                    completed: getSessionTreeProgress(item, agentIndicatorMap).completed,
                    expanded: expandedChildren,
                    onToggle: () => handleToggleDelegationParent(item.session.id, expandedChildren),
                  }
                  : undefined}
                workspaceName={item.session.workspaceId ? workspaceNameMap.get(item.session.workspaceId) : undefined}
                relativeTimeNow={relativeTimeNow}
                onSelect={handleSelectAgentSession}
                onRequestDelete={handleRequestDelete}
                onRequestMove={handleRequestMove}
                onRename={handleAgentRename}
                onTogglePin={handleTogglePinAgent}
                onToggleStar={handleToggleStarAgent}
                onToggleArchive={handleToggleArchiveAgent}
              />
            </div>
          ),
        })
        if (expandedChildren) {
          for (const childSession of item.childSessions) {
            rows.push({
              id: `agent-archived-child-${childSession.id}`,
              estimateSize: 34,
              content: (
                <div className="ml-6 border-l border-foreground/10 pl-2 pr-3">
                  <DelegatedChildSessionItem
                    session={childSession}
                    activeSessionId={activeSessionId}
                    agentIndicatorMap={agentIndicatorMap}
                    relativeTimeNow={relativeTimeNow}
                    workspaceName={childSession.workspaceId ? workspaceNameMap.get(childSession.workspaceId) : undefined}
                    onSelect={handleSelectAgentSession}
                    onRequestDelete={handleRequestDelete}
                    onRequestMove={handleRequestMove}
                    onRename={handleAgentRename}
                    onTogglePin={handleTogglePinAgent}
                    onToggleStar={handleToggleStarAgent}
                    onToggleArchive={handleToggleArchiveAgent}
                  />
                </div>
              ),
            })
          }
        }
      }
    }
    return rows
  }, [activeSessionId, agentIndicatorMap, archivedAgentSessionGroups, collapsedDelegationParentIds, expandedDelegationParentIds, handleAgentRename, handleRequestDelete, handleRequestMove, handleSelectAgentSession, handleToggleArchiveAgent, handleToggleDelegationParent, handleTogglePinAgent, handleToggleStarAgent, relativeTimeNow, sessionHoverPreviewEnabled, workspaceNameMap])

  const agentActiveVirtualRows = React.useMemo<VirtualSidebarRow[]>(() => {
    const rows: VirtualSidebarRow[] = []

    const pushSessionTreeRows = (
      item: AgentSessionTreeItem,
      isAutomationGroup: boolean,
      showPinIcon: boolean,
      workspaceNameMapForRow?: Map<string, string>,
      projectWorkspaceId?: string,
    ): void => {
      const childCount = item.childSessions.length
      const rowStatus = getSessionTreeStatus(item, agentIndicatorMap)
      const treeActive = treeContainsSessionId(item, activeSessionId)
      const activeChildVisible = item.childSessions.some((child) => child.id === activeSessionId)
      const expandedChildren = expandedDelegationParentIds.has(item.session.id)
        || (activeChildVisible && !collapsedDelegationParentIds.has(item.session.id))

      rows.push({
        id: `agent-${item.session.id}`,
        estimateSize: 34,
        content: (
          <div
            className="ml-4"
            onDragOver={projectWorkspaceId ? (event) => handleProjectDragOver(event, projectWorkspaceId) : undefined}
            onDragLeave={projectWorkspaceId ? handleProjectDragLeave : undefined}
            onDrop={projectWorkspaceId ? (event) => handleProjectDrop(event, projectWorkspaceId) : undefined}
          >
            <AgentSessionItem
              session={item.session}
              active={treeActive}
              indicatorStatus={rowStatus}
              showPinIcon={showPinIcon && !!item.session.pinned}
              disableMiniMap={!sessionHoverPreviewEnabled}
              childSummary={childCount > 0
                ? {
                  total: childCount,
                  completed: getSessionTreeProgress(item, agentIndicatorMap).completed,
                  expanded: expandedChildren,
                  onToggle: () => handleToggleDelegationParent(item.session.id, expandedChildren),
                }
                : undefined}
              workspaceName={isAutomationGroup && item.session.workspaceId ? workspaceNameMapForRow?.get(item.session.workspaceId) : undefined}
              relativeTimeNow={relativeTimeNow}
              onSelect={handleSelectAgentSession}
              onRequestDelete={handleRequestDelete}
              onRequestMove={handleRequestMove}
              onRename={handleAgentRename}
              onTogglePin={handleTogglePinAgent}
              onToggleStar={handleToggleStarAgent}
              onToggleArchive={handleToggleArchiveAgent}
            />
          </div>
        ),
      })

      if (childCount > 0 && expandedChildren) {
        for (const childSession of item.childSessions) {
          rows.push({
            id: `agent-child-${childSession.id}`,
            estimateSize: 34,
            content: (
              <div
                className="ml-7 border-l border-foreground/10 pl-2"
                onDragOver={projectWorkspaceId ? (event) => handleProjectDragOver(event, projectWorkspaceId) : undefined}
                onDragLeave={projectWorkspaceId ? handleProjectDragLeave : undefined}
                onDrop={projectWorkspaceId ? (event) => handleProjectDrop(event, projectWorkspaceId) : undefined}
              >
                <DelegatedChildSessionItem
                  session={childSession}
                  activeSessionId={activeSessionId}
                  agentIndicatorMap={agentIndicatorMap}
                  relativeTimeNow={relativeTimeNow}
                  workspaceName={isAutomationGroup && childSession.workspaceId ? workspaceNameMapForRow?.get(childSession.workspaceId) : undefined}
                  onSelect={handleSelectAgentSession}
                  onRequestDelete={handleRequestDelete}
                  onRequestMove={handleRequestMove}
                  onRename={handleAgentRename}
                  onTogglePin={handleTogglePinAgent}
                  onToggleStar={handleToggleStarAgent}
                  onToggleArchive={handleToggleArchiveAgent}
                />
              </div>
            ),
          })
        }
      }
    }

    if (pinnedAgentSessionTrees.length > 0) {
      rows.push({
        id: 'agent-pinned-heading',
        estimateSize: 30,
        content: (
          <div className="group/date-header flex items-center justify-between pl-[18px] pr-3.5 pt-2 pb-1">
            <span className="text-[13px] font-medium leading-[18px] text-foreground/40 select-none">置顶</span>
            <button
              type="button"
              aria-label={isPinnedAgentGroupCollapsed ? '展开置顶' : '折叠置顶'}
              onClick={() => setCollapsedFlatGroupIds((prev) => {
                const next = new Set(prev)
                if (next.has(PINNED_AGENT_GROUP_KEY)) next.delete(PINNED_AGENT_GROUP_KEY)
                else next.add(PINNED_AGENT_GROUP_KEY)
                return next
              })}
              className="grid size-5 place-items-center rounded text-foreground/45 opacity-0 transition-opacity titlebar-no-drag hover:bg-foreground/[0.08] hover:text-foreground/70 group-hover/date-header:opacity-100"
            >
              <ChevronRight
                size={12}
                className={cn('transition-transform duration-fast', isPinnedAgentGroupCollapsed ? '' : 'rotate-90')}
              />
            </button>
          </div>
        ),
      })
      if (!isPinnedAgentGroupCollapsed) {
        for (const item of pinnedAgentSessionTrees) {
          pushSessionTreeRows(item, false, false, workspaceNameMap)
        }
      }
    }

    rows.push({
      id: 'agent-project-heading',
      estimateSize: 34,
      content: (
        <div className="px-2 pt-2 pb-1 flex items-center justify-between">
          <span className="px-1.5 text-[13px] font-medium leading-[18px] text-foreground/40 select-none">项目</span>
          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => void handleCreateProjectFromFolder()}
                  className="size-6 flex items-center justify-center rounded-md text-foreground/35 hover:bg-foreground/[0.06] hover:text-foreground/60 transition-colors titlebar-no-drag"
                  aria-label="从本地文件夹创建项目"
                >
                  <FolderInput size={13} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">从本地文件夹创建项目</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setCreateProjectOpen(true)}
                  className="size-6 flex items-center justify-center rounded-md text-foreground/35 hover:bg-foreground/[0.06] hover:text-foreground/60 transition-colors titlebar-no-drag"
                  aria-label="新建空白项目"
                >
                  <Plus size={13} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">新建空白项目</TooltipContent>
            </Tooltip>
          </div>
        </div>
      ),
    })

    for (const group of displayProjectGroups) {
      const isAuto = group.workspace.id === AUTOMATION_GROUP_ID
      const collapsed = collapsedWorkspaceIds.has(group.workspace.id)
      const extraCount = expandedExtraCounts.get(group.workspace.id) ?? 0
      const visibleRaw = getVisibleAgentProjectSessions({
        group,
        activeSessionId,
        agentIndicatorMap,
        relativeTimeNow,
        extraCount,
      })
      // 自动任务组：由父组件统一「最多 4 个 + 显示更多/收起」折叠，内部不再做活跃/时间窗/分页的二次筛选，
      // 按 recency 平铺渲染，避免组内出现活跃优先排序或额外的「显示更多」按钮造成双重折叠。
      const visible = isAuto
        ? { ...visibleRaw, sessions: visibleRaw.treeItems, hiddenCount: 0 }
        : visibleRaw

      rows.push({
        id: `agent-project-${group.workspace.id}`,
        estimateSize: 34,
        content: (
          <div className="px-2">
            <AgentProjectGroupItem
              group={group}
              isAutomationGroup={isAuto}
              workspaceNameMap={isAuto ? workspaceNameMap : undefined}
              currentWorkspaceId={currentWorkspaceId}
              extraCount={extraCount}
              collapsed={collapsed}
              onClearProjectBinding={handleClearProjectBinding}
              activeSessionId={activeSessionId}
              agentIndicatorMap={agentIndicatorMap}
              expandedDelegationParentIds={expandedDelegationParentIds}
              collapsedDelegationParentIds={collapsedDelegationParentIds}
              relativeTimeNow={relativeTimeNow}
              dragging={dragProjectId === group.workspace.id}
              dropPosition={projectDropIndicator?.id === group.workspace.id ? projectDropIndicator.position : null}
              onShowMore={handleShowMoreSessions}
              onCollapseExtra={handleCollapseExtraSessions}
              onSelectProject={isAuto ? handleToggleGroupCollapse : handleSelectProject}
              onNewSession={isAuto ? noopAsync : createAgentSessionInWorkspace}
              onDragStart={handleProjectDragStart}
              onDragOver={handleProjectDragOver}
              onDragLeave={handleProjectDragLeave}
              onDrop={handleProjectDrop}
              onDragEnd={handleProjectDragEnd}
              onConfigureProject={isAuto ? noopVoid : (workspaceId) => {
                handleSelectProject(workspaceId)
                handleOpenPlugins()
              }}
              onRenameWorkspace={isAuto ? noopAsync : handleWorkspaceRename}
              onRequestDeleteWorkspace={isAuto ? noopVoid : handleRequestDeleteWorkspace}
              canDeleteWorkspace={isAuto ? false : canDeleteWorkspace(group.workspace)}
              onSelectSession={handleSelectAgentSession}
              onRequestDelete={handleRequestDelete}
              onRequestMove={handleRequestMove}
              onRename={handleAgentRename}
              onTogglePin={handleTogglePinAgent}
              onToggleStar={handleToggleStarAgent}
              onToggleArchive={handleToggleArchiveAgent}
              onToggleDelegationParent={handleToggleDelegationParent}
              hideSessions
            />
          </div>
        ),
      })

      if (!collapsed) {
        if (visible.treeItems.length === 0) {
          rows.push({
            id: `agent-project-empty-${group.workspace.id}`,
            estimateSize: 28,
            content: <div className="ml-5 px-1.5 py-0.5 text-[12px] text-foreground/22 select-none">暂无会话</div>,
          })
        } else {
          for (const item of visible.sessions) pushSessionTreeRows(item, isAuto, true, workspaceNameMap, group.workspace.id)
          if (visible.hiddenCount > 0 || extraCount > 0) {
            rows.push({
              id: `agent-project-controls-${group.workspace.id}`,
              estimateSize: 34,
              content: (
                <div className="ml-4 flex items-center gap-0.5 pt-0.5">
                  {visible.hiddenCount > 0 && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={`显示更多会话，还有 ${visible.hiddenCount} 个`}
                          onClick={() => handleShowMoreSessions(group.workspace.id)}
                          className="flex size-7 items-center justify-center rounded-md text-foreground/35 hover:bg-foreground/[0.04] hover:text-foreground/65 transition-colors titlebar-no-drag"
                        >
                          <ChevronDown size={14} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="right">{`显示更多会话（还有 ${visible.hiddenCount} 个）`}</TooltipContent>
                    </Tooltip>
                  )}
                  {extraCount > 0 && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label="收起额外会话"
                          onClick={() => handleCollapseExtraSessions(group.workspace.id)}
                          className="flex size-7 items-center justify-center rounded-md text-foreground/35 hover:bg-foreground/[0.04] hover:text-foreground/65 transition-colors titlebar-no-drag"
                        >
                          <ChevronUp size={14} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="right">收起额外会话</TooltipContent>
                    </Tooltip>
                  )}
                </div>
              ),
            })
          }
        }
      }
    }

    return rows
  }, [
    activeSessionId,
    agentIndicatorMap,
    collapsedDelegationParentIds,
    collapsedWorkspaceIds,
    createAgentSessionInWorkspace,
    displayProjectGroups,
    dragProjectId,
    expandedDelegationParentIds,
    expandedExtraCounts,
    handleAgentRename,
    handleClearProjectBinding,
    handleCollapseExtraSessions,
    handleCreateProjectFromFolder,
    handleOpenPlugins,
    handleProjectDragEnd,
    handleProjectDragLeave,
    handleProjectDragOver,
    handleProjectDragStart,
    handleProjectDrop,
    handleRequestDelete,
    handleRequestDeleteWorkspace,
    handleRequestMove,
    handleSelectAgentSession,
    handleSelectProject,
    handleShowMoreSessions,
    handleToggleArchiveAgent,
    handleToggleDelegationParent,
    handleToggleGroupCollapse,
    handleTogglePinAgent,
    handleToggleStarAgent,
    isPinnedAgentGroupCollapsed,
    handleWorkspaceRename,
    pinnedAgentSessionTrees,
    projectDropIndicator,
    relativeTimeNow,
    sessionHoverPreviewEnabled,
    setCollapsedFlatGroupIds,
    workspaceNameMap,
    currentWorkspaceId,
  ])

  const activeAgentRowId = React.useMemo(() => {
    if (!activeSessionId) return null
    const directRow = agentActiveVirtualRows.find((row) => (
      row.id === `agent-${activeSessionId}` || row.id === `agent-child-${activeSessionId}`
    ))
    if (directRow) return directRow.id

    const parentItem = [
      ...pinnedAgentSessionTrees,
      ...displayProjectGroups.flatMap((group) => buildAgentSessionTrees(group.sessions)),
    ].find((item) => treeContainsSessionId(item, activeSessionId))
    return parentItem ? `agent-${parentItem.session.id}` : null
  }, [activeSessionId, agentActiveVirtualRows, displayProjectGroups, pinnedAgentSessionTrees])

  // ===== 折叠状态：精简图标视图 =====
  // 折叠/展开按钮已迁移至 TabBar（紧邻标签标题，见 TabBar.tsx），与标签栏天然对齐，
  // 这里不重复渲染。点击该按钮才切换折叠态，不再有悬停自动预览。
  if (sidebarCollapsed) {
    return (
      <div
        ref={sidebarRootRef}
        data-session-switch-hints={quickSwitchHintsVisible ? 'true' : undefined}
        className={cn(
          'refined-sidebar relative h-full flex flex-col items-center px-2',
          !noTransition && 'transition-[width] duration-slow ease-out',
          isClassic
            ? 'bg-background rounded-2xl shadow-xl dark:shadow-md'
            : 'bg-[hsl(var(--sidebar-surface))]'
        )}
        style={{ width: 60, flexShrink: 0 }}
      >
        <SidebarWindowDragStrip
          height={isMac ? SIDEBAR_DRAG_STRIP_HEIGHT.collapsedMac : SIDEBAR_DRAG_STRIP_HEIGHT.collapsed}
        />

        {/* macOS 需要避开左上角红绿灯；边栏覆盖全局标题栏拖拽层，因此留白自身也要可拖拽。
            折叠/展开切换按钮固定放在 TabBar（紧邻第一个标签），这里不重复渲染。 */}
        <div className={cn('w-full flex-shrink-0 titlebar-drag-region', isMac ? 'h-[50px]' : 'h-2')} />


        <div className="my-3 h-px w-8 bg-border/70" />

        {/* 模式切换 */}
        <div className="flex flex-col items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="切换到 Chat 模式"
                onClick={() => handleRailModeSwitch('chat')}
                className={cn(
                  'relative size-10 flex items-center justify-center rounded-[12px] transition-colors titlebar-no-drag',
                  mode === 'chat'
                    ? 'bg-primary/10 text-foreground shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]'
                    : 'text-foreground/45 hover:bg-foreground/[0.06] hover:text-foreground/75'
                )}
              >
                <House size={17} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Chat 模式</TooltipContent>
          </Tooltip>

          <CollapsedWorkspacePopover>
            <button
              type="button"
              aria-label="切换到 Project 模式（悬停查看工作区）"
              onClick={() => handleRailModeSwitch('agent')}
              className={cn(
                'relative size-10 flex items-center justify-center rounded-[12px] transition-colors titlebar-no-drag',
                mode === 'agent'
                  ? 'bg-primary/10 text-foreground shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]'
                  : 'text-foreground/45 hover:bg-foreground/[0.06] hover:text-foreground/75'
              )}
            >
              <Bot size={18} />
            </button>
          </CollapsedWorkspacePopover>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="搜索"
                onClick={() => setSearchDialogOpen(true)}
                className="size-10 flex items-center justify-center rounded-[12px] text-foreground/45 hover:bg-foreground/[0.08] hover:text-foreground/80 transition-colors duration-fast titlebar-no-drag"
              >
                <Search size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">搜索</TooltipContent>
          </Tooltip>
        </div>

        {/* 高频操作 */}
        <div className="mt-1.5 flex flex-col items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={mode === 'agent' ? '新建 Agent 会话' : '新建 Chat 对话'}
                onClick={mode === 'agent' ? handleNewAgentSession : handleNewConversation}
                className="size-10 flex items-center justify-center rounded-[12px] text-foreground/70 sidebar-control-surface hover:text-foreground transition-[background-color,color] duration-fast titlebar-no-drag"
              >
                <Plus size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {mode === 'agent' ? '新会话' : '新对话'} ({getAcceleratorDisplay(getActiveAccelerator('new-session'))})
            </TooltipContent>
          </Tooltip>

          {mode === 'agent' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="新建任务"
                  onClick={handleNewTask}
                  className="size-10 flex items-center justify-center rounded-[12px] text-foreground/70 sidebar-control-surface hover:text-foreground transition-[background-color,color] duration-fast titlebar-no-drag"
                >
                  <ClipboardList size={16} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                新任务 ({getAcceleratorDisplay(getActiveAccelerator('new-task'))})
              </TooltipContent>
            </Tooltip>
          )}

          {mode === 'agent' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={`看板，${activeTaskCount} 个未完成`}
                  onClick={handleOpenTaskBoard}
                  className={cn(
                    'relative size-10 flex items-center justify-center rounded-[12px] transition-colors titlebar-no-drag border',
                    codeMainView === 'tasks' && activeView === 'conversations'
                      ? 'border-primary/80 bg-primary text-primary-foreground shadow-sm'
                      : 'border-border/45 bg-foreground/[0.025] text-foreground/45 hover:border-border/70 hover:bg-foreground/[0.045] hover:text-primary',
                  )}
                >
                  <LayoutDashboard size={16} />
                  {activeTaskCount > 0 && (
                    <span
                      className={cn(
                        'absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-medium tabular-nums',
                        codeMainView === 'tasks' && activeView === 'conversations'
                          ? 'bg-primary-foreground text-primary'
                          : 'bg-primary text-primary-foreground',
                      )}
                    >
                      {formatSidebarModuleCount(activeTaskCount)}
                    </span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">看板（{activeTaskCount} 个未完成）</TooltipContent>
            </Tooltip>
          )}

          {/* Yoda 画布：手绘白板，紧邻 Project 看板，仅 Project 模式可见 */}
          {mode === 'agent' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Yoda 画布"
                  onClick={handleOpenExcalidraw}
                  className={cn(
                    'relative size-10 flex items-center justify-center rounded-[12px] transition-colors titlebar-no-drag border',
                    activeView === 'excalidraw-gallery' || activeView === 'excalidraw-editor'
                      ? 'border-primary/80 bg-primary text-primary-foreground shadow-sm'
                      : 'border-border/45 bg-foreground/[0.025] text-foreground/45 hover:border-border/70 hover:bg-foreground/[0.045] hover:text-primary',
                  )}
                >
                  <PenTool size={16} />
                  {excalidrawCount > 0 && (
                    <span
                      className={cn(
                        'absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-medium tabular-nums',
                        activeView === 'excalidraw-gallery' || activeView === 'excalidraw-editor'
                          ? 'bg-primary-foreground text-primary'
                          : 'bg-primary text-primary-foreground',
                      )}
                    >
                      {formatSidebarModuleCount(excalidrawCount)}
                    </span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Yoda 画布{excalidrawCount > 0 ? `（${excalidrawCount} 个画布）` : ''}</TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={`计划，${automationCount} 个任务已创建`}
                onClick={handleOpenPlanning}
                className={cn(
                  'relative size-10 flex items-center justify-center rounded-[12px] transition-colors titlebar-no-drag border',
                  activeView === 'planning'
                    ? 'border-primary/80 bg-primary text-primary-foreground shadow-sm'
                    : 'border-border/45 bg-foreground/[0.025] text-foreground/45 hover:border-border/70 hover:bg-foreground/[0.045] hover:text-primary',
                )}
              >
                <CalendarDays size={16} />
                {automationCount > 0 && (
                  <span
                    className={cn(
                      'absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-medium tabular-nums',
                      activeView === 'planning'
                        ? 'bg-primary-foreground text-primary'
                        : 'bg-primary text-primary-foreground',
                    )}
                  >
                    {formatSidebarModuleCount(automationCount)}
                  </span>
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              计划（{automationCount} 个任务已创建）
            </TooltipContent>
          </Tooltip>

          {/* Yoda 插件中心：总览 / 专家 / 专家团 / 技能 / 连接器 / 记忆 */}
          {mode === 'agent' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Yoda 插件"
                  onClick={() => handleOpenSkills()}
                  className={cn(
                    'relative size-10 flex items-center justify-center rounded-[12px] transition-colors titlebar-no-drag border',
                    activeView === 'agent-skills'
                      ? 'border-primary/80 bg-primary text-primary-foreground shadow-sm'
                      : 'border-border/45 bg-foreground/[0.025] text-foreground/45 hover:border-border/70 hover:bg-foreground/[0.045] hover:text-primary',
                  )}
                >
                  <Blocks size={16} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Yoda 插件</TooltipContent>
            </Tooltip>
          )}

          {/* 消息：IM 集成（飞书 / 微信 / 即将上线渠道），仅 Project 模式 */}
          {mode === 'agent' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="消息"
                  onClick={handleOpenMessaging}
                  className={cn(
                    'relative size-10 flex items-center justify-center rounded-[12px] transition-colors titlebar-no-drag border',
                    activeView === 'messaging'
                      ? 'border-primary/80 bg-primary text-primary-foreground shadow-sm'
                      : 'border-border/45 bg-foreground/[0.025] text-foreground/45 hover:border-border/70 hover:bg-foreground/[0.045] hover:text-primary',
                  )}
                >
                  <MessagesSquare size={16} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">消息</TooltipContent>
            </Tooltip>
          )}

          {/* Yoda 知识库：Project 模式 LLM 知识库入口（待开发） */}
          {mode === 'agent' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Yoda 知识库"
                  onClick={handleOpenRepoWiki}
                  className={cn(
                    'relative size-10 flex items-center justify-center rounded-[12px] transition-colors titlebar-no-drag border',
                    activeView === 'repo-wiki'
                      ? 'border-primary/80 bg-primary text-primary-foreground shadow-sm'
                      : 'border-border/45 bg-foreground/[0.025] text-foreground/45 hover:border-border/70 hover:bg-foreground/[0.045] hover:text-primary',
                  )}
                >
                  <Library size={16} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Yoda 知识库（待开发）</TooltipContent>
            </Tooltip>
          )}

        </div>

        <div className="my-3 h-px w-8 bg-border/70" />

        {/* 最近/关键会话入口 */}
        <div className="flex-1 min-h-0 w-full overflow-y-auto scrollbar-thin">
          <div className="flex flex-col items-center gap-1.5 pb-2">
            {railRecentItems.map((item) => (
              <RailRecentButton
                key={`${item.type}-${item.id}`}
                item={item}
                onSelect={(selected) => {
                  if (selected.type === 'agent') {
                    handleSelectAgentSession(selected.id, selected.title)
                  } else {
                    handleSelectConversation(selected.id, selected.title)
                  }
                }}
              />
            ))}
          </div>
        </div>

        {/* 更新入口 + 用户头像（点击打开设置） */}
        <div className="flex flex-col items-center gap-1.5 pt-3 pb-3">
          {hasUpdate && (
            <SidebarUpdateButton
              status={updateStatus}
              onClick={handleUpdateButtonClick}
              tooltipSide="right"
              className="size-10 flex items-center justify-center rounded-[12px]"
              readyDotClassName="absolute top-0 right-0 w-2 h-2 rounded-full bg-primary"
            />
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="打开设置"
                onClick={handleOpenSettings}
                className="relative size-10 flex items-center justify-center rounded-[12px] transition-colors titlebar-no-drag hover:bg-foreground/5"
              >
                <UserAvatar avatar={userProfile.avatar} size={28} />
                {hasEnvironmentIssues && (
                  <span className="absolute top-0 right-0 w-2 h-2 rounded-full bg-destructive" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">设置</TooltipContent>
          </Tooltip>
        </div>

        {/* 更新日志与帮助入口（折叠窄栏） */}
        <ReleaseNotesPopover
          version={appVersion}
          unseen={hasUnseenReleaseNotes}
          recentNotes={releaseNotesRecent}
          onMarkSeen={markReleaseNotesSeen}
          triggerClassName="flex size-10 items-center justify-center rounded-[12px] text-foreground/45 transition-colors titlebar-no-drag hover:bg-foreground/5 hover:text-foreground/80"
          tooltipSide="right"
          side="right"
          align="end"
          onOpenGuide={handleOpenGuide}
        />

        {deleteDialog}
        {projectDeleteDialog}
        {moveDialog}
      </div>
    )
  }

  /** 状态 / 自定义 / 不分组模式的统一任务族行。 */
  const renderAgentFlatSessionTree = (item: AgentSessionTreeItem): React.ReactElement => {
    const { directChildren, delegationChildren } = splitTaskTreeChildren(item)
    const childCount = directChildren.length
    const childProgress = getSessionTreeProgress(item, agentIndicatorMap)
    const delegatedChildCount = delegationChildren.length
    const rowStatus = getSessionTreeStatus(item, agentIndicatorMap)
    const treeActive = treeContainsSessionId(item, activeSessionId)
    const activeChildVisible = item.childSessions.some((child) => child.id === activeSessionId)
    const shouldAutoExpand = activeChildVisible || rowStatus === 'running' || rowStatus === 'blocked'
    const expandedChildren = expandedDelegationParentIds.has(item.session.id)
      || (shouldAutoExpand && !collapsedDelegationParentIds.has(item.session.id))
    const workspaceName = item.session.workspaceId && item.session.workspaceId !== currentWorkspaceId
      ? workspaceNameMap.get(item.session.workspaceId)
      : undefined
    const taskTree = isTaskTree(item)

    const renderChildItem = (childSession: AgentSessionMeta) => (
      <ChildSessionItem
        key={childSession.id}
        session={childSession}
        activeSessionId={activeSessionId}
        agentIndicatorMap={agentIndicatorMap}
        relativeTimeNow={relativeTimeNow}
        workspaceName={workspaceName}
        onClearProjectBinding={handleClearProjectBinding}
        sessionGroups={sessionGroups}
        onMoveToGroup={handleMoveToGroup}
        onCreateGroup={handleRequestCreateGroup}
        {...agentSessionItemLabelProps}
        onSelect={handleSelectAgentSession}
        onRequestDelete={handleRequestDelete}
        onRequestMove={handleRequestMove}
        onRename={handleAgentRename}
        onTogglePin={handleTogglePinAgent}
        onToggleStar={handleToggleStarAgent}
        onToggleArchive={handleToggleArchiveAgent}
      />
    )

    return (
      <div key={item.session.id} className="flex flex-col gap-0.5">
        <AgentSessionItem
          session={item.session}
          active={treeActive}
          indicatorStatus={rowStatus}
          showPinIcon={!!item.session.pinned}
          childSummary={childProgress.total > 0
            ? {
              ...childProgress,
              ...(childCount > 0
                ? {
                    expanded: expandedChildren,
                    onToggle: () => handleToggleDelegationParent(item.session.id, expandedChildren),
                  }
                : {}),
            }
            : undefined}
          delegationChildCount={delegatedChildCount}
          workspaceName={workspaceName}
          onClearProjectBinding={handleClearProjectBinding}
          sessionGroups={sessionGroups}
          onMoveToGroup={handleMoveToGroup}
          onCreateGroup={handleRequestCreateGroup}
          {...agentSessionItemLabelProps}
          relativeTimeNow={relativeTimeNow}
          onSelect={handleSelectAgentSession}
          onRequestDelete={handleRequestDelete}
          onRequestMove={handleRequestMove}
          onRename={handleAgentRename}
          onTogglePin={handleTogglePinAgent}
          onToggleStar={handleToggleStarAgent}
          onToggleArchive={handleToggleArchiveAgent}
        />
        {childCount > 0 && expandedChildren && (
          <div className="ml-3 pl-2 flex flex-col gap-0.5">
            {directChildren.map(renderChildItem)}
            {taskTree && delegationChildren.length > 0 && (
              <>
                <div className="text-[10px] text-muted-foreground/60 pl-1 pt-1 pb-0.5">
                  协作子会话
                </div>
                {delegationChildren.map(renderChildItem)}
              </>
            )}
          </div>
        )}
      </div>
    )
  }

  // ===== 展开状态：完整侧边栏 =====

  /**
   * 渲染单个工作区组（真实工作区 or 合成「自动任务」组）。
   * 自动任务组被提升到置顶分类上方常驻显示，滚动列表只渲染当前工作区组，二者共用此渲染，避免 JSX 重复。
   */
  const renderWorkspaceGroupItem = (group: AgentProjectGroup): React.ReactElement => {
    const isAuto = group.workspace.id === AUTOMATION_GROUP_ID
    return (
      <AgentProjectGroupItem
        key={group.workspace.id}
        group={isAuto
          ? {
              ...group,
              sessions: automationOverflow > 0 && !automationOverflowExpanded
                ? group.sessions.slice(0, AUTOMATION_SESSION_VISIBLE_LIMIT)
                : group.sessions,
            }
          : {
              ...group,
              sessions: buildRecentSessionList(group.sessions),
            }}
        isAutomationGroup={isAuto}
        workspaceNameMap={isAuto ? workspaceNameMap : undefined}
        currentWorkspaceId={currentWorkspaceId}
        extraCount={expandedExtraCounts.get(group.workspace.id) ?? 0}
        collapsed={isAuto ? collapsedWorkspaceIds.has(group.workspace.id) : false}
        activeSessionId={activeSessionId}
        agentIndicatorMap={agentIndicatorMap}
        expandedDelegationParentIds={expandedDelegationParentIds}
        collapsedDelegationParentIds={collapsedDelegationParentIds}
        relativeTimeNow={relativeTimeNow}
        dragging={false}
        dropPosition={null}
        onShowMore={handleShowMoreSessions}
        onCollapseExtra={handleCollapseExtraSessions}
        onSelectProject={isAuto ? handleToggleGroupCollapse : handleSelectProject}
        onNewSession={isAuto ? noopAsync : createAgentSessionInWorkspace}
        onDragStart={noopDragEvent}
        onDragOver={noopDragEvent}
        onDragLeave={noopDragEvent}
        onDrop={noopDragEvent}
        onDragEnd={noopVoid}
        onConfigureProject={isAuto ? noopVoid : (workspaceId) => {
          handleSelectProject(workspaceId)
          handleOpenPlugins()
        }}
        onRenameWorkspace={isAuto ? noopAsync : handleWorkspaceRename}
        onRequestDeleteWorkspace={isAuto ? noopVoid : handleRequestDeleteWorkspace}
        canDeleteWorkspace={isAuto ? false : canDeleteWorkspace(group.workspace)}
        hideWorkspaceHeader={!isAuto}
        onClearProjectBinding={handleClearProjectBinding}
        sessionGroups={sessionGroups}
        onMoveToGroup={handleMoveToGroup}
        onCreateGroup={handleRequestCreateGroup}
        {...agentSessionItemLabelProps}
        onSelectSession={handleSelectAgentSession}
        onRequestDelete={handleRequestDelete}
        onRequestMove={handleRequestMove}
        onRename={handleAgentRename}
        onTogglePin={handleTogglePinAgent}
        onToggleStar={handleToggleStarAgent}
        onToggleArchive={handleToggleArchiveAgent}
        onToggleDelegationParent={handleToggleDelegationParent}
      />
    )
  }

  return (
    <div
      ref={sidebarRootRef}
      data-session-switch-hints={quickSwitchHintsVisible ? 'true' : undefined}
      className={cn(
        'relative h-full flex flex-col',
        'refined-sidebar',
        !noTransition && 'transition-[width] duration-slow ease-out',
        isClassic
          ? 'bg-background rounded-2xl shadow-xl dark:shadow-md'
          : 'bg-[hsl(var(--sidebar-surface))]'
      )}
      style={{ width: width ?? MIN_LEFT_SIDEBAR_WIDTH, minWidth: MIN_LEFT_SIDEBAR_WIDTH, flexShrink: 0 }}
    >
      <SidebarWindowDragStrip
        height={isMac ? SIDEBAR_DRAG_STRIP_HEIGHT.expandedMac : SIDEBAR_DRAG_STRIP_HEIGHT.expanded}
      />

      {/* 展开态顶部工具栏：折叠按钮 + Tab 导航（搜索入口已升级为左侧栏独立「搜索」模块，⌘⇧F 直达；
          这里不再放重复的搜索图标）。SidebarWindowDragStrip 是 z-1 的原生窗口拖拽层；
          工具栏必须 z-10 + no-drag，否则 Electron 会将点击吞为窗口拖拽，Tooltip 也不会触发。 */}
      <div className={cn('relative z-10 w-full flex-shrink-0 flex items-center justify-end gap-1 titlebar-no-drag', isMac ? 'h-[30px] pr-2' : 'h-7 pr-1.5')}>
        <SidebarToggleButton className="size-6" />
        <TabNavigationControls className="h-7 gap-0" />
      </div>

      {/* 模式切换器：Project | Chat（ModeSwitcher 自带 pt-2 + 拖拽区，这里只补水平内边距） */}
      <div className="px-3">
        <ModeSwitcher />
      </div>

      {/* 工作区切换器已按调研建议收起：默认单工作区，多工作区管理降级到设置 > 工作区（高级选项） */}

      {/* 新对话/新会话 + 新任务（看板工作区化完成后恢复快速入口） */}
      <div className="px-3 pt-2 flex items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={mode === 'agent' ? handleNewAgentSession : handleNewConversation}
              className="flex-1 flex items-center gap-2 h-9 px-3 rounded-[10px] text-[13px] font-medium text-foreground/70 sidebar-control-surface hover:text-foreground transition-[background-color,color] duration-fast titlebar-no-drag"
            >
              <Plus size={14} />
              <span>{mode === 'agent' ? '新会话' : '新对话'}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {mode === 'agent' ? '新会话' : '新对话'} ({getAcceleratorDisplay(getActiveAccelerator('new-session'))})
          </TooltipContent>
        </Tooltip>
        {mode === 'agent' && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleNewTask}
                className="flex-1 flex items-center gap-2 h-9 px-3 rounded-[10px] text-[13px] font-medium text-foreground/70 sidebar-control-surface hover:text-foreground transition-[background-color,color] duration-fast titlebar-no-drag"
              >
                <Plus size={14} />
                <span>新任务</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              新任务 ({getAcceleratorDisplay(getActiveAccelerator('new-task'))})
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* 未发送内容找回入口：点「新会话」但没发送时，内容还在，不会真的丢，但原来没有回去的路。
          跨项目展示（对齐置顶）；主区在看板等非会话视图时不过滤当前草稿，保证找回入口始终存在；
          当前视图可见的会话（行标记已提示）不重复展示。 */}
      {mode === 'agent' && (
        <DraftSessionRecallSection
          currentWorkspaceId={currentWorkspaceId}
          workspaceNameMap={workspaceNameMap}
          excludeOnSessionView={codeMainView === 'session'}
          sessions={agentSessions}
          visibleSessionIds={visibleAgentSessionIds}
          excludeSessionId={currentAgentSessionId}
          onOpen={(id, title) => openSession('agent', id, title)}
        />
      )}

      {/* 搜索：左侧栏独立模块（⌘⇧F 直达），点击打开居中搜索弹窗 */}
      <div className="sidebar-module-zone px-3 pt-2 pb-0.5">
        <SidebarModule
          icon={Search}
          title="搜索"
          onClick={() => setSearchDialogOpen(true)}
          keycapShortcutId="global-search"
          ariaLabel="搜索"
        />
      </div>

      {/* 发现：官方内容流 + 社区讨论 + 反馈（Agent / Chat 模式均显示的独立入口行，位于搜索与功能之间） */}
      <div className="sidebar-module-zone px-3 pt-0.5 pb-0.5">
        <SidebarModule
          icon={Compass}
          title="发现"
          active={activeView === 'discover'}
          count={discoverUnreadTotal > 0 ? discoverUnreadTotal : undefined}
          badgeTone="accent"
          onClick={handleOpenDiscover}
          ariaLabel="发现"
        />
      </div>

      {/* 功能模块区：Task 日历 / 看板 / 画布 / 插件 / 知识库 收敛为可折叠「功能」组（默认折叠，回归 Proma 简洁样式） */}
      <div className="sidebar-module-zone px-3 pt-1 pb-0.5">
        <SidebarModule
          icon={Layers}
          title="功能"
          collapsible
          collapsed={featuresCollapsed}
          onCollapsedChange={setFeaturesCollapsed}
          ariaLabel="功能模块"
        >
          <div className="flex flex-col gap-0.5 pt-1">
            {/* 计划：Todo / 日历 / 定时任务合一 */}
            <button
              type="button"
              onClick={handleOpenPlanning}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-[12.5px] transition-colors duration-fast titlebar-no-drag',
                activeView === 'planning'
                  ? 'bg-accent-foreground/[0.10] text-foreground'
                  : 'text-foreground/60 hover:bg-accent-foreground/[0.08] hover:text-foreground'
              )}
            >
              <CalendarDays size={13} className="shrink-0 text-foreground/45" />
              <span className="min-w-0 flex-1 truncate text-left">计划</span>
              {automationCount > 0 && (
                <span className="flex h-4 min-w-[18px] shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-medium tabular-nums bg-foreground/[0.045] text-foreground/[0.42]">
                  {formatSidebarModuleCount(automationCount)}
                </span>
              )}
            </button>

            {/* 任务看板：工作区级正式工作项入口（回归 Proma：看板按工作区展示） */}
            {mode === 'agent' && (
              <button
                type="button"
                onClick={handleOpenTaskBoard}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-[12.5px] transition-colors duration-fast titlebar-no-drag',
                  codeMainView === 'tasks' && activeView === 'conversations'
                    ? 'bg-accent-foreground/[0.10] text-foreground'
                    : 'text-foreground/60 hover:bg-accent-foreground/[0.08] hover:text-foreground'
                )}
              >
                <LayoutDashboard size={13} className="shrink-0 text-foreground/45" />
                <span className="min-w-0 flex-1 truncate text-left">看板</span>
                {activeTaskCount > 0 && (
                  <span className="flex h-4 min-w-[18px] shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-medium tabular-nums bg-foreground/[0.045] text-foreground/[0.42]">
                    {formatSidebarModuleCount(activeTaskCount)}
                  </span>
                )}
              </button>
            )}

            {/* Yoda 画布：手绘风格白板 */}
            {mode === 'agent' && (
              <button
                type="button"
                onClick={handleOpenExcalidraw}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-[12.5px] transition-colors duration-fast titlebar-no-drag',
                  activeView === 'excalidraw-gallery' || activeView === 'excalidraw-editor'
                    ? 'bg-accent-foreground/[0.10] text-foreground'
                    : 'text-foreground/60 hover:bg-accent-foreground/[0.08] hover:text-foreground'
                )}
              >
                <PenTool size={13} className="shrink-0 text-foreground/45" />
                <span className="min-w-0 flex-1 truncate text-left">画布</span>
                {excalidrawCount > 0 && (
                  <span className="flex h-4 min-w-[18px] shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-medium tabular-nums bg-foreground/[0.045] text-foreground/[0.42]">
                    {formatSidebarModuleCount(excalidrawCount)}
                  </span>
                )}
              </button>
            )}

            {/* Yoda 插件中心：总览 / 专家 / 专家团 / 技能 / 连接器 / 记忆 */}
            {mode === 'agent' && (
              <button
                type="button"
                onClick={() => handleOpenSkills()}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-[12.5px] transition-colors duration-fast titlebar-no-drag',
                  activeView === 'agent-skills'
                    ? 'bg-accent-foreground/[0.10] text-foreground'
                    : 'text-foreground/60 hover:bg-accent-foreground/[0.08] hover:text-foreground'
                )}
              >
                <Blocks size={13} className="shrink-0 text-foreground/45" />
                <span className="min-w-0 flex-1 truncate text-left">插件</span>
              </button>
            )}

            {/* 消息：IM 集成（飞书 / 微信 / 即将上线渠道），仅 Project 模式 */}
            {mode === 'agent' && (
              <button
                type="button"
                onClick={handleOpenMessaging}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-[12.5px] transition-colors duration-fast titlebar-no-drag',
                  activeView === 'messaging'
                    ? 'bg-accent-foreground/[0.10] text-foreground'
                    : 'text-foreground/60 hover:bg-accent-foreground/[0.08] hover:text-foreground'
                )}
              >
                <MessagesSquare size={13} className="shrink-0 text-foreground/45" />
                <span className="min-w-0 flex-1 truncate text-left">消息</span>
              </button>
            )}

            {/* Yoda 知识库：LLM 知识库入口（待开发） */}
            {mode === 'agent' && (
              <button
                type="button"
                onClick={handleOpenRepoWiki}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-[12.5px] transition-colors duration-fast titlebar-no-drag',
                  activeView === 'repo-wiki'
                    ? 'bg-accent-foreground/[0.10] text-foreground'
                    : 'text-foreground/60 hover:bg-accent-foreground/[0.08] hover:text-foreground'
                )}
              >
                <Library size={13} className="shrink-0 text-foreground/45" />
                <span className="min-w-0 flex-1 truncate text-left">知识库</span>
              </button>
            )}
          </div>
        </SidebarModule>
      </div>

      {/* Chat 模式 active 视图：置顶 + 对话历史，结构与 Agent active 视图保持一致 */}
      {mode === 'chat' && viewMode === 'active' ? (
        <VirtualSidebarList
          key="chat-active-list"
          className="flex-1"
          rows={chatActiveVirtualRows}
          activeRowId={activeSessionId ? `chat-${activeSessionId}` : null}
        />
      ) : mode === 'agent' && viewMode === 'active' ? (
        <VirtualSidebarList
          key="agent-active-list"
          className="flex-1 px-2 pb-3"
          rows={agentActiveVirtualRows}
          activeRowId={activeAgentRowId}
        />
      ) : (
        <>
          {/* 归档视图标题栏（仅 Chat 模式可达：Agent 模式归档已并入上方「分组方式：日期」+「状态：已归档/全部」） */}
          {viewMode === 'archived' && (
            <div className="px-6 pt-3 pb-1">
              <div className="text-[12px] font-medium text-foreground/40">
                已归档对话
              </div>
            </div>
          )}

          {/* 归档视图：单列表布局 */}
          <div className="flex-1 overflow-y-auto px-3 pt-2 pb-3 scrollbar-thin titlebar-no-drag">
            {/* Chat 归档：对话按日期分组 */}
            {conversationGroups.map((group) => (
              <div key={group.label} className="mb-1">
                <div className="px-3 pt-2 pb-1 text-[11px] font-medium text-foreground/40 select-none">
                  {group.label}
                </div>
                <div className="flex flex-col gap-0.5">
                  {group.items.map((conv) => (
                    <ConversationItem
                      key={conv.id}
                      conversation={conv}
                      active={conv.id === activeSessionId}
                      streaming={streamingIds.has(conv.id)}
                      showPinIcon={!!conv.pinned}
                      relativeTimeNow={relativeTimeNow}
                      onSelect={handleSelectConversation}
                      onRequestDelete={handleRequestDelete}
                      onRename={handleRename}
                      onTogglePin={handleTogglePin}
                      onToggleArchive={handleToggleArchive}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* 已归档入口 / 返回活跃（对齐 Proma：Chat 与 Agent 共用底部入口）
          Chat 用 viewMode，Agent 用状态筛选，两者独立互不干扰 */}
      {mode === 'chat' ? (
        <div className="px-3 pb-1">
          {viewMode === 'active' ? (
            archivedConversationCount > 0 && (
              <button
                onClick={() => setViewMode('archived')}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-[10px] text-[12px] text-foreground/40 hover:bg-foreground/[0.04] hover:text-foreground/60 transition-colors titlebar-no-drag"
              >
                <Archive size={13} className="text-foreground/30" />
                <span>已归档对话 ({archivedConversationCount})</span>
              </button>
            )
          ) : (
            <button
              onClick={() => setViewMode('active')}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-[10px] text-[12px] text-foreground/60 bg-foreground/[0.04] hover:bg-foreground/[0.07] hover:text-foreground/80 transition-colors titlebar-no-drag"
            >
              <ArrowLeft size={13} className="text-foreground/50" />
              <span>返回活跃对话</span>
            </button>
          )}
        </div>
      ) : mode === 'agent' ? (
        <div className="px-3 pb-1">
          {agentStatusFilter === 'active' ? (
            archivedAgentSessionCount > 0 && (
              <button
                onClick={() => setSessionListPreference({ status: 'archived' })}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-[10px] text-[12px] text-foreground/40 hover:bg-foreground/[0.04] hover:text-foreground/60 transition-colors titlebar-no-drag"
              >
                <Archive size={13} className="text-foreground/30" />
                <span>已归档会话 ({archivedAgentSessionCount})</span>
              </button>
            )
          ) : (
            <button
              onClick={() => setSessionListPreference({ status: 'active' })}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-[10px] text-[12px] text-foreground/60 bg-foreground/[0.04] hover:bg-foreground/[0.07] hover:text-foreground/80 transition-colors titlebar-no-drag"
            >
              <ArrowLeft size={13} className="text-foreground/50" />
              <span>返回活跃会话</span>
            </button>
          )}
        </div>
      ) : null}

      {/* 底部：用户资料 + 版本号/更新日志 + 设置入口（同一行，避免占用两行高度） */}
      <div className="sidebar-footer px-3 pb-3">
        <div className="sidebar-profile-row flex items-center gap-1 rounded-[10px] px-3 py-2 text-foreground/70 transition-colors titlebar-no-drag hover:bg-foreground/[0.04] hover:text-foreground">
          <button
            onClick={handleOpenSettings}
            className="min-w-0 flex flex-1 items-center gap-3 text-left"
          >
            <UserAvatar avatar={userProfile.avatar} size={28} />
            <span className="flex-1 text-sm truncate text-left">{userProfile.userName}</span>
          </button>
          {hasUpdate ? (
            <SidebarUpdateButton
              status={updateStatus}
              onClick={handleUpdateButtonClick}
              tooltipSide="top"
              className="h-6 flex-shrink-0 inline-flex items-center justify-center rounded-full bg-primary/10 px-2 text-[11px] font-medium leading-none text-primary hover:bg-primary/15"
              readyDotClassName="hidden"
              showText
              hideIcon
            />
          ) : (
            <ReleaseNotesPopover
              version={appVersion}
              unseen={hasUnseenReleaseNotes}
              recentNotes={releaseNotesRecent}
              onMarkSeen={markReleaseNotesSeen}
              triggerClassName="flex size-7 flex-shrink-0 items-center justify-center rounded-[8px] text-foreground/40 transition-colors hover:bg-foreground/[0.05] hover:text-foreground/70"
              tooltipSide="top"
              side="top"
              align="end"
              onOpenGuide={handleOpenGuide}
            />
          )}
          <button
            type="button"
            aria-label="打开设置"
            onClick={handleOpenSettings}
            className="relative flex size-7 flex-shrink-0 items-center justify-center rounded-[8px] text-foreground/40 transition-colors hover:bg-foreground/[0.05] hover:text-foreground/70"
          >
            <div className="relative flex-shrink-0 text-foreground/40">
              <Settings size={16} />
              {hasEnvironmentIssues && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-destructive" />
              )}
            </div>
          </button>
        </div>
      </div>

      {deleteDialog}
      {projectDeleteDialog}
      {moveDialog}
      <NewTaskProjectFlowDialog />
      <CreateSessionGroupDialog
        open={createGroupTargetSessionId !== null}
        busy={creatingSessionGroup}
        onOpenChange={(open) => { if (!open && !creatingSessionGroup) setCreateGroupTargetSessionId(null) }}
        onSubmit={(name) => { void handleSubmitCreateGroup(name) }}
      />
      {/* 项目模式下全局「+」按钮触发的新建项目弹窗 */}
      <CreateProjectDialog
        open={createProjectOpen}
        busy={creatingProject}
        onOpenChange={setCreateProjectOpen}
        onSubmit={(input) => { void handleCreateWorkspaceFromDialog(input) }}
      />
    </div>
  )
}

// ===== 对话列表项 =====

interface ConversationItemProps {
  conversation: ConversationMeta
  active: boolean
  streaming: boolean
  /** 是否在标题旁显示 Pin 图标 */
  showPinIcon: boolean
  relativeTimeNow: number
  onSelect: (id: string, title: string) => void
  onRequestDelete: (id: string) => void
  onRename: (id: string, newTitle: string) => Promise<void>
  onTogglePin: (id: string) => Promise<void>
  onToggleArchive: (id: string) => Promise<void>
}

const ConversationItem = React.memo(function ConversationItem({
  conversation,
  active,
  streaming,
  showPinIcon,
  relativeTimeNow,
  onSelect,
  onRequestDelete,
  onRename,
  onTogglePin,
  onToggleArchive,
}: ConversationItemProps): React.ReactElement {
  const [editing, setEditing] = React.useState(false)
  const [editTitle, setEditTitle] = React.useState('')
  const [menuOpen, setMenuOpen] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const justStartedEditing = React.useRef(false)
  // 菜单打开时关闭迷你地图预览，避免预览面板盖住菜单项导致点不动
  const sessionHoverPreviewEnabled = useAtomValue(sessionHoverPreviewEnabledAtom)
  const preview = useSessionMiniMapHover(600, !sessionHoverPreviewEnabled || menuOpen)

  /** 进入编辑模式 */
  const startEdit = (): void => {
    setEditTitle(conversation.title)
    setEditing(true)
    justStartedEditing.current = true
    // 延迟聚焦，等待 ContextMenu 完全关闭后再 focus
    setTimeout(() => {
      justStartedEditing.current = false
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 300)
  }

  /** 保存标题 */
  const saveTitle = async (): Promise<void> => {
    // ContextMenu 关闭导致的 blur，忽略
    if (justStartedEditing.current) return
    const trimmed = editTitle.trim()
    if (!trimmed || trimmed === conversation.title) {
      setEditing(false)
      return
    }
    await onRename(conversation.id, trimmed)
    setEditing(false)
  }

  /** 键盘事件 */
  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      saveTitle()
    } else if (e.key === 'Escape') {
      setEditing(false)
    }
  }

  const isPinned = !!conversation.pinned

  const menuItems = (
    MenuItem: typeof ContextMenuItem | typeof DropdownMenuItem,
    MenuSeparator: typeof ContextMenuSeparator | typeof DropdownMenuSeparator,
  ) => (
    <>
      <MenuItem className="text-xs py-1 [&>svg]:size-3.5" onSelect={() => onTogglePin(conversation.id)}>
        {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
        {isPinned ? '取消置顶' : '置顶对话'}
      </MenuItem>
      <MenuItem className="text-xs py-1 [&>svg]:size-3.5" onSelect={() => startEdit()}>
        <Pencil size={14} />
        重命名
      </MenuItem>
      <MenuItem className="text-xs py-1 [&>svg]:size-3.5" onSelect={() => onToggleArchive(conversation.id)}>
        {conversation.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
        {conversation.archived ? '取消归档' : '归档'}
      </MenuItem>
      <MenuSeparator className="my-0.5" />
      <MenuItem className="text-xs py-1 [&>svg]:size-3.5 text-destructive" onSelect={() => onRequestDelete(conversation.id)}>
        <Trash2 size={14} />
        删除对话
      </MenuItem>
    </>
  )

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={preview.setAnchorRef}
          role="button"
          tabIndex={0}
          data-session-switch-id={conversation.id}
          data-session-switch-title={conversation.title}
          data-session-switch-type="chat"
          onClick={() => onSelect(conversation.id, conversation.title)}
          onMouseEnter={preview.handleMouseEnter}
          onMouseLeave={preview.handleMouseLeave}
          onDoubleClick={(e) => {
            e.stopPropagation()
            startEdit()
          }}
          style={active ? undefined : {
            contentVisibility: 'auto',
            containIntrinsicSize: 'auto 30px',
          }}
          className={cn(
            'session-quick-switch-row group relative w-full flex items-center gap-1.5 rounded-md py-1 pl-2 pr-1.5 transition-colors duration-fast titlebar-no-drag text-left',
            active && 'session-item-selected',
            streaming
              ? 'text-foreground font-medium hover:bg-foreground/[0.03]'
              : 'hover:bg-foreground/[0.03]',
            active && 'bg-foreground/[0.08]',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'size-2 shrink-0 rounded-full',
              streaming ? 'bg-blue-500 animate-pulse' : 'border border-foreground/25 bg-transparent',
            )}
          />
          <div className="flex-1 min-w-0">
            {editing ? (
              <input
                ref={inputRef}
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={saveTitle}
                onClick={(e) => e.stopPropagation()}
                className="w-full bg-transparent text-[13px] leading-5 text-foreground border-b border-primary/50 outline-none px-0 py-0"
                maxLength={100}
              />
            ) : (
              <div className={cn(
                'truncate text-[13px] leading-[18px] flex items-center gap-1.5 min-w-0',
                active ? 'text-foreground' : 'text-foreground/80'
              )}>
                {/* 置顶标记 */}
                {showPinIcon && (
                  <Pin size={11} className="flex-shrink-0 text-primary/60" />
                )}
                <MarqueeText text={conversation.title} />
              </div>
            )}
          </div>

          {/* 默认显示时间，hover 时显示操作按钮 */}
          {!editing && (
            <>
              <SessionItemActions
                updatedAt={conversation.updatedAt}
                archived={!!conversation.archived}
                onToggleArchive={() => onToggleArchive(conversation.id)}
                onMenuOpenChange={setMenuOpen}
                menuItems={menuItems}
              />
              <SessionQuickSwitchKeycap />
            </>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-40 z-[9999] min-w-0 p-0.5">
        {menuItems(ContextMenuItem, ContextMenuSeparator)}
      </ContextMenuContent>
      <SessionMiniMapPopover
        target={{
          type: 'chat',
          sessionId: conversation.id,
          title: conversation.title,
        }}
        anchorRef={preview.anchorRef}
        open={preview.isOpen}
        isLeaving={preview.isLeaving}
        onMouseEnter={preview.handlePanelMouseEnter}
        onMouseLeave={preview.handlePanelMouseLeave}
      />
    </ContextMenu>
  )
})

interface ChildSessionItemProps {
  session: AgentSessionMeta
  activeSessionId: string | null
  agentIndicatorMap: Map<string, SessionIndicatorStatus>
  relativeTimeNow: number
  workspaceName?: string
  /** 存量 KanbanProject 绑定清理出口；透传给会话行「移出项目」菜单项 */
  onClearProjectBinding?: (sessionId: string) => void | Promise<void>
  /** 当前工作区自定义分组 + 移动/新建回调；透传给会话行的「移动到分组」子菜单 */
  sessionGroups?: SessionGroup[]
  onMoveToGroup?: (sessionId: string, groupId?: string) => void | Promise<void>
  onCreateGroup?: (sessionId: string) => void
  onSelect: (id: string, title: string) => void
  onRequestDelete: (id: string) => void
  onRequestMove: (id: string) => void
  onRename: (id: string, newTitle: string) => Promise<void>
  onTogglePin: (id: string, cascade: boolean) => Promise<void>
  onToggleStar: (id: string) => Promise<void>
  onToggleArchive: (id: string) => Promise<void>
}

const ChildSessionItem = React.memo(function ChildSessionItem({
  session,
  activeSessionId,
  agentIndicatorMap,
  relativeTimeNow,
  workspaceName,
  onClearProjectBinding,
  sessionGroups,
  onMoveToGroup,
  onCreateGroup,
  onSelect,
  onRequestDelete,
  onRequestMove,
  onRename,
  onTogglePin,
  onToggleStar,
  onToggleArchive,
}: ChildSessionItemProps): React.ReactElement {
  const status = getSessionStatus(session, agentIndicatorMap)

  return (
    <AgentSessionItem
      session={session}
      active={session.id === activeSessionId}
      indicatorStatus={status}
      relativeTimeNow={relativeTimeNow}
      workspaceName={workspaceName}
      sessionGroups={undefined}
      onSelect={onSelect}
      onRequestDelete={onRequestDelete}
      onRequestMove={onRequestMove}
      onRename={onRename}
      onTogglePin={onTogglePin}
      onToggleStar={onToggleStar}
      onToggleArchive={onToggleArchive}
    />
  )
})

interface DelegatedChildSessionItemProps {
  session: AgentSessionMeta
  activeSessionId: string | null
  agentIndicatorMap: Map<string, SessionIndicatorStatus>
  relativeTimeNow: number
  workspaceName?: string
  onSelect: (id: string, title: string) => void
  onRequestDelete: (id: string) => void
  onRequestMove: (id: string) => void
  onRename: (id: string, newTitle: string) => Promise<void>
  onTogglePin: (id: string, cascade: boolean) => Promise<void>
  onToggleStar: (id: string) => Promise<void>
  onToggleArchive: (id: string) => Promise<void>
}

/** 归档虚拟列表专用的轻量委派子会话行：不接入分组菜单，避免归档场景加载额外依赖。 */
const DelegatedChildSessionItem = React.memo(function DelegatedChildSessionItem({
  session,
  activeSessionId,
  agentIndicatorMap,
  relativeTimeNow,
  workspaceName,
  onSelect,
  onRequestDelete,
  onRequestMove,
  onRename,
  onTogglePin,
  onToggleStar,
  onToggleArchive,
}: DelegatedChildSessionItemProps): React.ReactElement {
  const status = getSessionStatus(session, agentIndicatorMap)

  return (
    <AgentSessionItem
      session={session}
      active={session.id === activeSessionId}
      indicatorStatus={status}
      relativeTimeNow={relativeTimeNow}
      workspaceName={workspaceName}
      onSelect={onSelect}
      onRequestDelete={onRequestDelete}
      onRequestMove={onRequestMove}
      onRename={onRename}
      onTogglePin={onTogglePin}
      onToggleStar={onToggleStar}
      onToggleArchive={onToggleArchive}
    />
  )
})

// ===== 工作区分组历史 =====

interface DraftSessionRecallSectionProps {
  currentWorkspaceId: string | null
  workspaceNameMap: Map<string, string>
  /** 仅当主区处于会话视图时排除当前打开的草稿；看板 / 计划等视图传 false，保证找回入口始终存在 */
  excludeOnSessionView: boolean
  sessions: AgentSessionMeta[]
  /** 当前侧栏视图可见的会话 id 集合（有行标记），区块跳过它们避免重复 */
  visibleSessionIds: Set<string>
  excludeSessionId: string | null
  onOpen: (id: string, title: string) => void
}

/**
 * 未发送草稿找回区块：单独抽出为叶子组件，只订阅 agentSessionDraftsAtom（每次按键都变）。
 * 若直接在 LeftSidebar 顶层订阅该 atom，整个侧边栏都会随输入框按键重渲染
 * （参考 AgentView.tsx 里同样的 atomFamily 切片注释）。
 */
const DraftSessionRecallSection = React.memo(function DraftSessionRecallSection({
  currentWorkspaceId,
  workspaceNameMap,
  excludeOnSessionView,
  sessions,
  visibleSessionIds,
  excludeSessionId,
  onOpen,
}: DraftSessionRecallSectionProps): React.ReactElement | null {
  const draftTexts = useAtomValue(agentSessionDraftsAtom)
  const items = React.useMemo(
    () => selectDraftSessionsWithContent({
      sessions,
      draftTexts,
      excludeSessionId: excludeOnSessionView ? excludeSessionId : null,
      visibleSessionIds,
    }),
    [sessions, draftTexts, excludeOnSessionView, excludeSessionId, visibleSessionIds],
  )

  if (items.length === 0) return null

  return (
    <div className="px-3 pt-2">
      <div className="px-1 pb-1 text-[11px] font-medium text-foreground/40">未发送草稿</div>
      <div className="flex flex-col gap-0.5">
        {items.map((item) => {
          const workspaceName = item.workspaceId && item.workspaceId !== currentWorkspaceId
            ? workspaceNameMap.get(item.workspaceId)
            : undefined
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onOpen(item.id, item.title)}
              title={item.text}
              className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[12.5px] text-foreground/60 transition-colors duration-fast hover:bg-foreground/[0.06] hover:text-foreground/85"
            >
              <Pencil size={12} className="shrink-0 text-foreground/35" />
              <span className="truncate">{item.text}</span>
              {workspaceName && (
                <span className="shrink-0 min-w-0 px-1.5 py-0 rounded-full bg-primary/10 text-[10px] leading-4 workspace-badge font-medium truncate max-w-[120px]">
                  {workspaceName}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
})

const PROJECT_HISTORY_ANIMATION_MS = 160

/**
 * 仅在收起动画结束后卸载会话树：避免常驻隐藏历史占用渲染与监听开销。
 * 使用 CSS grid 的固定轨道过渡，不读取内容高度，也不在动画帧中执行 JS。
 */
function ProjectSessionList({
  id,
  collapsed,
  hideWorkspaceHeader,
  children,
}: {
  id: string
  collapsed: boolean
  hideWorkspaceHeader: boolean
  children: React.ReactNode
}): React.ReactElement | null {
  const [shouldRender, setShouldRender] = React.useState(!collapsed)
  const [isOpen, setIsOpen] = React.useState(!collapsed)

  React.useEffect(() => {
    let frameId: number | undefined
    let cleanupTimer: number | undefined

    if (collapsed) {
      setIsOpen(false)
      cleanupTimer = window.setTimeout(() => setShouldRender(false), PROJECT_HISTORY_ANIMATION_MS)
    } else {
      setShouldRender(true)
      // 先以 0fr 挂载，再在下一帧展开，确保首次展开能触发 CSS 过渡。
      frameId = window.requestAnimationFrame(() => setIsOpen(true))
    }

    return () => {
      if (frameId !== undefined) window.cancelAnimationFrame(frameId)
      if (cleanupTimer !== undefined) window.clearTimeout(cleanupTimer)
    }
  }, [collapsed])

  return (
    <div
      id={id}
      className={cn(
        'sidebar-workspace-content mt-px grid transition-[grid-template-rows] duration-[160ms] ease-out motion-reduce:transition-none',
        !hideWorkspaceHeader && 'ml-4',
        isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
      )}
    >
      <div className="min-h-0 overflow-hidden">
        {shouldRender && (
          <div
            className={cn(
              'transition-[opacity,transform] duration-[160ms] ease-out motion-reduce:transition-none',
              isOpen ? 'translate-y-0 opacity-100' : '-translate-y-0.5 opacity-0',
            )}
          >
            {children}
          </div>
        )}
      </div>
    </div>
  )
}

interface VisibleAgentProjectSessions {
  treeItems: AgentSessionTreeItem[]
  sessions: AgentSessionTreeItem[]
  hiddenCount: number
  activeIds: Set<string>
}

function getVisibleAgentProjectSessions({
  group,
  activeSessionId,
  agentIndicatorMap,
  relativeTimeNow,
  extraCount,
  previousActiveIds = new Set<string>(),
}: {
  group: AgentProjectGroup
  activeSessionId: string | null
  agentIndicatorMap: Map<string, SessionIndicatorStatus>
  relativeTimeNow: number
  extraCount: number
  previousActiveIds?: ReadonlySet<string>
}): VisibleAgentProjectSessions {
  const recentCutoff = relativeTimeNow - PROJECT_SESSION_RECENT_WINDOW_MS
  const treeItems = buildAgentSessionTrees(group.sessions)
  const activeSessions = treeItems
    .filter((item) => (
      ACTIVE_SESSION_STATUSES.has(getSessionTreeStatus(item, agentIndicatorMap))
      || (item.session.id === activeSessionId && previousActiveIds.has(item.session.id))
    ))
    .slice()
    .sort((a, b) => {
      const delta = ACTIVE_SESSION_STATUS_PRIORITY[getSessionTreeStatus(a, agentIndicatorMap)]
        - ACTIVE_SESSION_STATUS_PRIORITY[getSessionTreeStatus(b, agentIndicatorMap)]
      if (delta !== 0) return delta
      return b.session.updatedAt - a.session.updatedAt
    })
  const activeIds = collectAgentSessionTreeIds(activeSessions)
  const fillSessions = treeItems
    .filter((item) => !activeIds.has(item.session.id) && item.session.updatedAt >= recentCutoff)
    .slice(0, PROJECT_SESSION_PREVIEW_LIMIT)
  const collapsedSessions = [...activeSessions, ...fillSessions]
  const collapsedIds = new Set(collapsedSessions.map((item) => item.session.id))
  const remainingSessions = treeItems.filter((item) => !collapsedIds.has(item.session.id))
  const extraSessions = remainingSessions.slice(0, extraCount)
  const sessionsWithoutPinned = [...collapsedSessions, ...extraSessions]
  const currentSession = activeSessionId && !isAgentSessionVisibleInTrees(sessionsWithoutPinned, activeSessionId)
    ? treeItems.find((item) => treeContainsSessionId(item, activeSessionId)) ?? null
    : null
  const sessions = currentSession
    ? [...activeSessions, currentSession, ...fillSessions, ...extraSessions]
    : sessionsWithoutPinned

  return {
    treeItems,
    sessions,
    hiddenCount: Math.max(0, treeItems.length - sessions.length),
    activeIds,
  }
}

/** 项目分组历史 */
interface AgentProjectGroupItemProps {
  group: AgentProjectGroup
  currentWorkspaceId: string | null
  /** 合成「自动任务」只读组：隐藏拖拽 / 新建会话 / 工作区菜单等 workspace 专属操作，会话显示来源工作区角标 */
  isAutomationGroup?: boolean
  /** 工作区 ID → 名称映射，仅合成组用来给跨工作区会话渲染角标 */
  workspaceNameMap?: Map<string, string>
  /** 用户已点击「显示更多」累积展开的额外会话数（增量分页，每次 +PROJECT_SESSION_EXPAND_STEP，对齐 Claude） */
  extraCount: number
  collapsed: boolean
  activeSessionId: string | null
  agentIndicatorMap: Map<string, SessionIndicatorStatus>
  expandedDelegationParentIds: Set<string>
  collapsedDelegationParentIds: Set<string>
  relativeTimeNow: number
  dragging: boolean
  dropPosition: 'before' | 'after' | null
  onShowMore: (workspaceId: string) => void
  onCollapseExtra: (workspaceId: string) => void
  onSelectProject: (workspaceId: string) => void
  onNewSession: (workspaceId: string) => Promise<void>
  onDragStart: (e: React.DragEvent, workspaceId: string) => void
  onDragOver: (e: React.DragEvent, workspaceId: string) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent, workspaceId: string) => void
  onDragEnd: () => void
  onConfigureProject: (workspaceId: string) => void
  onRenameWorkspace: (workspaceId: string, newName: string) => Promise<void>
  onRequestDeleteWorkspace: (workspaceId: string) => void
  canDeleteWorkspace: boolean
  /** 隐藏 Workspace 组头（当前 Workspace 已在设置 > 工作区管理） */
  hideWorkspaceHeader?: boolean
  onClearProjectBinding: (sessionId: string) => void | Promise<void>
  sessionGroups?: SessionGroup[]
  onMoveToGroup?: (sessionId: string, groupId?: string) => void | Promise<void>
  onCreateGroup?: (sessionId: string) => void
  onSelectSession: (id: string, title: string) => void
  onRequestDelete: (id: string) => void
  onRequestMove: (id: string) => void
  onRename: (id: string, newTitle: string) => Promise<void>
  onTogglePin: (id: string, cascade: boolean) => Promise<void>
  onToggleStar: (id: string) => Promise<void>
  onToggleArchive: (id: string) => Promise<void>
  onToggleDelegationParent: (id: string, expanded: boolean) => void
  /** 虚拟侧栏只复用项目头部，项目会话行由外层 VirtualSidebarList 单独挂载。 */
  hideSessions?: boolean
}

const AgentProjectGroupItem = React.memo(function AgentProjectGroupItem({
  group,
  currentWorkspaceId,
  isAutomationGroup = false,
  workspaceNameMap,
  extraCount,
  collapsed,
  activeSessionId,
  agentIndicatorMap,
  expandedDelegationParentIds,
  collapsedDelegationParentIds,
  relativeTimeNow,
  dragging,
  dropPosition,
  onShowMore,
  onCollapseExtra,
  onSelectProject,
  onNewSession,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  onConfigureProject,
  onRenameWorkspace,
  onRequestDeleteWorkspace,
  canDeleteWorkspace,
  hideWorkspaceHeader = false,
  onClearProjectBinding,
  sessionGroups,
  onMoveToGroup,
  onCreateGroup,
  onSelectSession,
  onRequestDelete,
  onRequestMove,
  onRename,
  onTogglePin,
  onToggleStar,
  onToggleArchive,
  onToggleDelegationParent,
  hideSessions = false,
}: AgentProjectGroupItemProps): React.ReactElement {
  const isCurrent = group.workspace.id === currentWorkspaceId
  /** 折叠时会话行整体隐藏，用状态点在 header 上提示「这个项目下有会话在跑」，避免看不到进行中的会话。 */
  const groupStatus = collapsed ? getWorkspaceGroupStatus(group.sessions, agentIndicatorMap) : 'idle'

  const [renamingWorkspace, setRenamingWorkspace] = React.useState(false)
  const [workspaceEditName, setWorkspaceEditName] = React.useState('')
  const workspaceEditRef = React.useRef<HTMLInputElement>(null)
  const justStartedRenamingRef = React.useRef(false)
  /** 已折叠的日期分组标签（今天/昨天/前天/更早）；hover 标题行显示折叠按钮，对齐 Claude 客户端 */
  const [collapsedDateLabels, setCollapsedDateLabels] = React.useState<Set<DateGroup>>(new Set())

  const handleStartWorkspaceRename = (): void => {
    setWorkspaceEditName(group.workspace.name)
    setRenamingWorkspace(true)
    justStartedRenamingRef.current = true
    setTimeout(() => {
      justStartedRenamingRef.current = false
      workspaceEditRef.current?.focus()
      workspaceEditRef.current?.select()
    }, 300)
  }

  const handleWorkspaceRenameCommit = async (): Promise<void> => {
    if (justStartedRenamingRef.current) return
    const trimmed = workspaceEditName.trim()
    if (!trimmed || trimmed === group.workspace.name) {
      setRenamingWorkspace(false)
      return
    }
    await onRenameWorkspace(group.workspace.id, trimmed)
    setRenamingWorkspace(false)
  }

  const handleWorkspaceRenameKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      if (e.nativeEvent.isComposing) return
      e.preventDefault()
      void handleWorkspaceRenameCommit()
    } else if (e.key === 'Escape') {
      setRenamingWorkspace(false)
    }
  }
  const prevActiveIdsRef = React.useRef<Set<string>>(new Set())
  const visibleAgentProjectSessions = getVisibleAgentProjectSessions({
    group,
    activeSessionId,
    agentIndicatorMap,
    relativeTimeNow,
    extraCount,
    previousActiveIds: prevActiveIdsRef.current,
  })
  const { treeItems, activeIds } = visibleAgentProjectSessions
  React.useEffect(() => { prevActiveIdsRef.current = activeIds })
  // 自动任务组：由父组件统一「最多 4 个 + 显示更多/收起」折叠，内部不再做活跃/时间窗/分页的二次筛选，
  // 按 recency 平铺渲染，避免组内出现活跃优先排序或额外的「显示更多」按钮造成双重折叠。
  const sessions = isAutomationGroup ? treeItems : visibleAgentProjectSessions.sessions
  const hiddenCount = isAutomationGroup ? 0 : visibleAgentProjectSessions.hiddenCount

  return (
    <section
      onDragOver={(e) => onDragOver(e, group.workspace.id)}
      onDragLeave={onDragLeave}
      onDrop={(e) => onDrop(e, group.workspace.id)}
      onDragEnd={onDragEnd}
      className={cn('sidebar-workspace-group relative py-0.5 rounded-md transition-opacity', dragging && 'opacity-45')}
    >
      {dropPosition === 'before' && (
        <div className="absolute -top-0.5 left-3 right-3 h-0.5 rounded-full bg-primary z-10" />
      )}

      {!hideWorkspaceHeader && (
      <div className="sidebar-workspace-header group/project relative flex items-center">
        <span
          draggable
          onDragStart={(e) => onDragStart(e, group.workspace.id)}
          title="拖拽排序"
          className="absolute -left-0.5 top-1/2 z-10 flex size-[18px] -translate-y-1/2 cursor-grab items-center justify-center text-foreground/20 opacity-0 transition-opacity group-hover/project:opacity-100 active:cursor-grabbing"
          aria-hidden="true"
        >
          <GripVertical size={12} />
        </span>

        {renamingWorkspace ? (
          <div
            className={cn(
              'relative flex-1 min-w-0 flex items-center gap-1 px-1 py-1 rounded-md text-left titlebar-no-drag group-hover/project:pl-4 group-hover/project:pr-11',
              isCurrent
                ? 'agent-project-item-current text-foreground'
                : 'text-foreground/65',
            )}
          >
            <FolderOpen size={13} className="flex-shrink-0 text-foreground/40" />
            <input
              ref={workspaceEditRef}
              value={workspaceEditName}
              onChange={(e) => setWorkspaceEditName(e.target.value)}
              onKeyDown={handleWorkspaceRenameKeyDown}
              onBlur={() => void handleWorkspaceRenameCommit()}
              className="flex-1 min-w-0 bg-transparent text-[13px] font-medium text-foreground border-b border-primary/50 outline-none px-0.5 leading-[18px]"
              maxLength={50}
            />
          </div>
        ) : (
          <button
            type="button"
            aria-expanded={!collapsed}
            aria-controls={hideSessions ? undefined : `project-sessions-${group.workspace.id}`}
            onClick={(e) => {
              e.stopPropagation()
              onSelectProject(group.workspace.id)
            }}
            className={cn(
              'relative flex-1 min-w-0 flex items-center gap-1 px-1 py-1 rounded-md text-left transition-[padding,color,background-color] titlebar-no-drag group-hover/project:pl-4 group-hover/project:pr-11 hover:bg-foreground/[0.025]',
              isCurrent
                ? 'agent-project-item-current text-foreground'
                : 'text-foreground/65 hover:text-foreground/88',
            )}
          >
            {isAutomationGroup
              ? <Clock size={13} className="flex-shrink-0 text-foreground/40" />
              // 参考 Heptabase：闭合 Folder = 折叠，张开 FolderOpen = 正在显示内容
              : collapsed
                ? <Folder size={13} className="flex-shrink-0 text-foreground/40" />
                : <FolderOpen size={13} className="flex-shrink-0 text-foreground/40" />
            }
            {groupStatus !== 'idle' && (
              <span
                title={groupStatus === 'running' ? '有会话正在进行' : groupStatus === 'blocked' ? '有会话等待处理' : '有会话已完成'}
                className={cn('size-1.5 flex-shrink-0 rounded-full', STATUS_DOT_CLASS[groupStatus])}
              />
            )}
            <span className="flex min-w-0 items-center">
              <MarqueeText text={group.workspace.name} className="min-w-0 text-[13px] font-medium leading-[18px]" />
              {isCurrent && (
                <span className="ml-1.5 shrink-0 rounded-full bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary">
                  当前
                </span>
              )}
            </span>
            <span className="min-w-[4px] flex-1" aria-hidden="true" />
            <ChevronRight
              size={12}
              className={cn(
                'flex-shrink-0 text-foreground/30 transition-transform duration-fast',
                collapsed ? '-rotate-90' : 'rotate-90',
              )}
            />
          </button>
        )}

        {!isAutomationGroup && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`在「${group.workspace.name}」中新建会话`}
              onClick={(e) => {
                e.stopPropagation()
                void onNewSession(group.workspace.id)
              }}
              className="absolute right-5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-foreground/30 opacity-0 transition-colors hover:bg-foreground/[0.055] hover:text-foreground/65 group-hover/project:opacity-100 titlebar-no-drag"
            >
              <Plus size={13} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">
            在此工作区中新建会话 ({getAcceleratorDisplay(getActiveAccelerator('new-session'))})
          </TooltipContent>
        </Tooltip>
        )}

        {!isAutomationGroup && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="工作区菜单"
              className="absolute right-0 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-foreground/30 opacity-0 transition-colors hover:bg-foreground/[0.055] hover:text-foreground/60 group-hover/project:opacity-100 data-[state=open]:opacity-100 titlebar-no-drag"
            >
              <MoreHorizontal size={13} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44 z-[9999] min-w-0 p-0.5">
            <DropdownMenuItem
              className="text-xs py-1 [&>svg]:size-3.5"
              onSelect={() => onSelectProject(group.workspace.id)}
            >
              <FolderOpen size={14} />
              设为当前工作区
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-xs py-1 [&>svg]:size-3.5"
              onSelect={handleStartWorkspaceRename}
            >
              <Pencil size={14} />
              重命名
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-xs py-1 [&>svg]:size-3.5"
              onSelect={() => onConfigureProject(group.workspace.id)}
            >
              <Settings size={14} />
              打开插件
            </DropdownMenuItem>
            <DropdownMenuSeparator className="my-0.5" />
            <DropdownMenuItem
              disabled={!canDeleteWorkspace}
              className={cn(
                'text-xs py-1 [&>svg]:size-3.5',
                canDeleteWorkspace && 'text-destructive focus:text-destructive',
              )}
              onSelect={() => onRequestDeleteWorkspace(group.workspace.id)}
            >
              <Trash2 size={14} />
              删除工作区
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        )}
      </div>
      )}

      {!hideSessions && (
      <ProjectSessionList
        id={`project-sessions-${group.workspace.id}`}
        collapsed={collapsed}
        hideWorkspaceHeader={hideWorkspaceHeader}
      >
        {treeItems.length > 0 ? (
          <div className="flex flex-col gap-0.5">
              {(() => {
                // 按日期插入分组标题（今天/昨天/更早），对齐 craft-agents 的会话列表排序展示；
                // 不改变 sessions 本身的排序逻辑（活跃优先 + 时间窗 + 显示更多），只在标签变化处插入标题。
                let lastDateLabel: DateGroup | null = null
                return sessions.map((item) => {
                  const { directChildren, delegationChildren } = splitTaskTreeChildren(item)
                  const childCount = directChildren.length
                  const childProgress = getSessionTreeProgress(item, agentIndicatorMap)
                  const delegatedChildCount = delegationChildren.length
                  const rowStatus = getSessionTreeStatus(item, agentIndicatorMap)
                  const treeActive = treeContainsSessionId(item, activeSessionId)
                  const activeChildVisible = item.childSessions.some((child) => child.id === activeSessionId)
                  const shouldAutoExpand = activeChildVisible || rowStatus === 'running' || rowStatus === 'blocked'
                  const expandedChildren = expandedDelegationParentIds.has(item.session.id)
                    || (shouldAutoExpand && !collapsedDelegationParentIds.has(item.session.id))
                  const dateLabel = getDateGroupLabel(getSessionTreeActivityAt(item), relativeTimeNow)
                  const showDateHeader = dateLabel !== lastDateLabel
                  lastDateLabel = dateLabel
                  const isDateCollapsed = collapsedDateLabels.has(dateLabel)
                  const taskTree = isTaskTree(item)

                  const renderChildItem = (childSession: AgentSessionMeta) => (
                    <ChildSessionItem
                      key={childSession.id}
                      session={childSession}
                      activeSessionId={activeSessionId}
                      agentIndicatorMap={agentIndicatorMap}
                      relativeTimeNow={relativeTimeNow}
                      workspaceName={isAutomationGroup && childSession.workspaceId ? workspaceNameMap?.get(childSession.workspaceId) : undefined}
                      onClearProjectBinding={onClearProjectBinding}
                      sessionGroups={sessionGroups}
                      onMoveToGroup={onMoveToGroup}
                      onCreateGroup={onCreateGroup}
                      onSelect={onSelectSession}
                      onRequestDelete={onRequestDelete}
                      onRequestMove={onRequestMove}
                      onRename={onRename}
                      onTogglePin={onTogglePin}
                      onToggleStar={onToggleStar}
                      onToggleArchive={onToggleArchive}
                    />
                  )

                  return (
                    <React.Fragment key={item.session.id}>
                      {showDateHeader && (
                        <div className="group/date-header flex items-center justify-between px-1.5 pt-2 pb-1 first:pt-0.5">
                          <span className="text-[11px] font-medium text-foreground/35 select-none">{dateLabel}</span>
                          <button
                            type="button"
                            aria-label={isDateCollapsed ? `展开${dateLabel}` : `折叠${dateLabel}`}
                            onClick={() => setCollapsedDateLabels((prev) => {
                              const next = new Set(prev)
                              if (next.has(dateLabel)) next.delete(dateLabel)
                              else next.add(dateLabel)
                              return next
                            })}
                            className="grid size-5 place-items-center rounded text-foreground/35 opacity-0 transition-opacity titlebar-no-drag hover:bg-foreground/[0.08] hover:text-foreground/70 group-hover/date-header:opacity-100"
                          >
                            <ChevronRight
                              size={12}
                              className={cn('transition-transform duration-fast', isDateCollapsed ? '' : 'rotate-90')}
                            />
                          </button>
                        </div>
                      )}
                      {!isDateCollapsed && (
                      <div className="flex flex-col gap-0.5">
                        <AgentSessionItem
                          session={item.session}
                          active={treeActive}
                          indicatorStatus={rowStatus}
                          showPinIcon={!!item.session.pinned}
                          childSummary={childProgress.total > 0
                            ? {
                              ...childProgress,
                              ...(childCount > 0
                                ? {
                                    expanded: expandedChildren,
                                    onToggle: () => onToggleDelegationParent(item.session.id, expandedChildren),
                                  }
                                : {}),
                            }
                            : undefined}
                          delegationChildCount={delegatedChildCount}
                          relativeTimeNow={relativeTimeNow}
                          workspaceName={isAutomationGroup && item.session.workspaceId ? workspaceNameMap?.get(item.session.workspaceId) : undefined}
                          onClearProjectBinding={onClearProjectBinding}
                          sessionGroups={sessionGroups}
                          onMoveToGroup={onMoveToGroup}
                          onCreateGroup={onCreateGroup}
                          onSelect={onSelectSession}
                          onRequestDelete={onRequestDelete}
                          onRequestMove={onRequestMove}
                          onRename={onRename}
                          onTogglePin={onTogglePin}
                          onToggleStar={onToggleStar}
                          onToggleArchive={onToggleArchive}
                        />

                        {childCount > 0 && expandedChildren && (
                          <div className="ml-3 pl-2 flex flex-col gap-0.5">
                            {directChildren.map(renderChildItem)}
                            {taskTree && delegationChildren.length > 0 && (
                              <>
                                <div className="text-[10px] text-muted-foreground/60 pl-1 pt-1 pb-0.5">
                                  协作子会话
                                </div>
                                {delegationChildren.map(renderChildItem)}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                      )}
                    </React.Fragment>
                  )
                })
              })()}

              {/* 「显示更多」与「收起」：增量分页（对齐 Claude 的「Show 20 more」），可多次点击 */}
              {(hiddenCount > 0 || extraCount > 0) && (
                <div className="flex items-center gap-1">
                  {hiddenCount > 0 && (
                    <button
                      type="button"
                      onClick={() => onShowMore(group.workspace.id)}
                      className={cn(
                        'text-left px-1.5 py-1 rounded-md text-[12px] text-foreground/35 hover:bg-foreground/[0.03] hover:text-foreground/60 transition-colors titlebar-no-drag',
                        extraCount > 0 ? 'flex-1' : 'w-full',
                      )}
                    >
                      显示更多 ({Math.min(PROJECT_SESSION_EXPAND_STEP, hiddenCount)})
                    </button>
                  )}
                  {extraCount > 0 && (
                    <button
                      type="button"
                      onClick={() => onCollapseExtra(group.workspace.id)}
                      className={cn(
                        'text-left px-1.5 py-1 rounded-md text-[12px] text-foreground/35 hover:bg-foreground/[0.03] hover:text-foreground/60 transition-colors titlebar-no-drag shrink-0',
                        hiddenCount === 0 && 'w-full',
                      )}
                    >
                      收起
                    </button>
                  )}
                </div>
              )}
            </div>
        ) : (
          <div className="px-1.5 py-0.5 text-[12px] text-foreground/22 select-none">
            暂无会话
          </div>
        )}
      </ProjectSessionList>
      )}
      {dropPosition === 'after' && (
        <div className="absolute -bottom-0.5 left-3 right-3 h-0.5 rounded-full bg-primary z-10" />
      )}
    </section>
  )
})
