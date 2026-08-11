/**
 * Agent 会话列表项 + 共享的 SessionItemActions / 左侧状态色条工具。
 * 从 LeftSidebar 抽出为独立文件，便于复用与测试。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import {
  Pin,
  PinOff,
  Star,
  Trash2,
  Pencil,
  ArrowRightLeft,
  Archive,
  ArchiveRestore,
  MoreHorizontal,
  FolderInput,
  Tag,
  Plus,
  Clock,
  ChevronRight,
  GitBranch,
  Check,
  Settings,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { MarqueeText } from '@/components/ui/marquee-text'
import type { SessionIndicatorStatus } from '@/atoms/agent-atoms'
import {
  SessionMiniMapPopover,
  useSessionMiniMapHover,
} from '@/components/session-preview/SessionMiniMapPopover'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu'
import type { AgentSessionMeta, SessionGroup } from '@myyoda/shared'
import type { KanbanProject } from './kanban/types'
import { sessionHoverPreviewEnabledAtom } from '@/atoms/ui-preferences'

export function formatRelativeUpdatedAt(updatedAt: number, now: number): string {
  const diff = Math.max(0, now - updatedAt)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  const month = 30 * day
  const year = 365 * day

  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))} 分钟`
  if (diff < day) return `${Math.floor(diff / hour)} 小时`
  if (diff < month) return `${Math.floor(diff / day)} 天`
  if (diff < year) return `${Math.floor(diff / month)} 月`
  return `${Math.floor(diff / year)} 年`
}

// ===== 列表项操作按钮（时间/置顶/归档/三点菜单） =====

export interface SessionItemActionsProps {
  updatedAt: number
  /**
   * 行尾存在额外固定控件（如子会话展开/收起按钮）时，三点菜单需要向左让位，
   * 避免 absolute right-0 的 hover 菜单覆盖行内按钮。
   */
  reserveTrailingControl?: boolean
  menuItems: (
    MenuItem: typeof DropdownMenuItem,
    MenuSeparator: typeof DropdownMenuSeparator,
    MenuSub: typeof DropdownMenuSub,
    MenuSubTrigger: typeof DropdownMenuSubTrigger,
    MenuSubContent: typeof DropdownMenuSubContent,
  ) => React.ReactNode
  onMenuOpenChange?: (open: boolean) => void
}

/**
 * 安全 Tooltip：延迟渲染 Content，避开 Popper 初始定位 (0,0) 的闪现。
 *
 * 左侧列表项的操作按钮默认 hidden，hover 时才显示。Radix Popper 在 Content 首次挂载
 * 时若 trigger 尚未完成布局，会先把浮层放到视口左上角 (0,0)，再跳到正确位置。这里
 * 在 Radix 进入打开状态后，先让 Popper 有一小段时间完成定位，再真正渲染 Content；
 * 同时 trigger rect 为 0 时直接不打开。
 */
interface SafeTooltipProps {
  children: React.ReactElement
  content: React.ReactNode
  side?: React.ComponentPropsWithoutRef<typeof TooltipContent>['side']
}

function SafeTooltip({ children, content, side = 'top' }: SafeTooltipProps): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [showContent, setShowContent] = React.useState(false)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const getUsableTriggerRect = React.useCallback((): DOMRect | null => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0 || rect.height === 0) return null
    if (rect.right <= 0 || rect.bottom <= 0) return null
    if (rect.left >= window.innerWidth || rect.top >= window.innerHeight) return null
    return rect
  }, [])

  React.useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
      }
    }
  }, [])

  const handleOpenChange = React.useCallback((nextOpen: boolean): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }

    if (!nextOpen) {
      setOpen(false)
      setShowContent(false)
      return
    }

    // trigger 还没完成布局或已经离开视口时不打开。
    if (!getUsableTriggerRect()) return

    setOpen(true)
    // 先让 Radix 完成 Popper 定位，再渲染 Content，避免看到 (0,0) 初始位置。
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      if (!getUsableTriggerRect()) {
        setOpen(false)
        setShowContent(false)
        return
      }
      setShowContent(true)
    }, 60)
  }, [getUsableTriggerRect])

  return (
    <Tooltip open={open} onOpenChange={handleOpenChange}>
      <TooltipTrigger asChild ref={triggerRef}>
        {children}
      </TooltipTrigger>
      {showContent && <TooltipContent side={side} hideWhenDetached>{content}</TooltipContent>}
    </Tooltip>
  )
}

/**
 * 列表项右侧操作区：默认显示相对更新时间，hover 时切换为「三点菜单」触发按钮。
 * 置顶 / 星标 / 归档等操作不再占用行内固定位置，全部收进同一份 menuItems
 * （三点菜单与右键/双指点按的上下文菜单共用），把行内空间留给标题本身。
 */
function SessionQuickSwitchKeycap(): React.ReactElement {
  return (
    <span className="session-quick-switch-keycap" aria-hidden="true">
      <span className="session-quick-switch-modifier" />
      <span className="session-quick-switch-number" />
    </span>
  )
}

export function SessionItemActions({
  updatedAt,
  reserveTrailingControl = false,
  menuItems,
  onMenuOpenChange,
}: SessionItemActionsProps): React.ReactElement {
  // 菜单打开时强制保持触发按钮可见：按钮始终保留布局，只切换透明度和 pointer-events。
  // 这样 Radix Popper 不会在 hover 切换瞬间读到 display:none 的 0 尺寸 trigger。
  const [menuOpen, setMenuOpen] = React.useState(false)

  const closeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleMenuOpenChange = (open: boolean): void => {
    if (open) {
      if (closeTimerRef.current !== null) {
        clearTimeout(closeTimerRef.current)
        closeTimerRef.current = null
      }
      setMenuOpen(true)
    } else {
      // Delay hiding the trigger so Radix Popper can still read its rect during the close animation (~150ms).
      closeTimerRef.current = setTimeout(() => {
        closeTimerRef.current = null
        setMenuOpen(false)
      }, 200)
    }
    onMenuOpenChange?.(open)
  }

  React.useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) clearTimeout(closeTimerRef.current)
    }
  }, [])

  const forceVisible = menuOpen

  return (
    <div
      className={cn(
        'session-item-actions pointer-events-none absolute top-1/2 z-[7] flex h-[18px] -translate-y-1/2 items-center',
        reserveTrailingControl ? 'right-6' : 'right-0',
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {/* 置顶/星标/归档不再占用行内固定位置——全部收进这个「...」菜单（以及同一份
          menuItems 供的右键/双指点按菜单），把行内空间留给标题。相对时间戳也不再常驻展示，
          完整时间通过本容器的 title 属性 hover 呈现。按钮整体 absolute 悬浮在行右侧，
          不占布局宽度——标题因此可以顶到行尾。 */}
      <div
        className={cn(
          'flex items-center transition-opacity duration-fast',
          forceVisible
            ? 'opacity-100 pointer-events-auto'
            : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto',
        )}
      >
        <DropdownMenu onOpenChange={handleMenuOpenChange}>
          <DropdownMenuTrigger asChild>
            <button
              title={`最后更新：${new Date(updatedAt).toLocaleString('zh-CN')}`}
              className={cn(
                'p-0.5 rounded text-foreground/30 hover:bg-foreground/[0.08] hover:text-foreground/60 transition-colors',
                'data-[state=open]:bg-foreground/[0.08] data-[state=open]:text-foreground/60',
              )}
            >
              <MoreHorizontal size={14} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-40 z-[9999] min-w-0 p-0.5">
            {menuItems(DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent)}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

// ===== Agent 会话列表项 =====

/**
 * 会话行状态点（对齐 Claude 客户端：无竖条，只有小圆点）：
 * idle=空心圆（占位对齐），running=蓝点脉冲，blocked=橙点，completed=绿点。
 * 原 leftAccent 3px 状态竖条 / projectColor 2px 项目色条 / blocked 行底色已下线。
 */
const STATUS_DOT_CLASS: Record<SessionIndicatorStatus, string> = {
  idle: 'border border-foreground/25 bg-transparent',
  running: 'bg-blue-500 animate-pulse',
  blocked: 'bg-orange-500',
  completed: 'bg-green-500',
}

const DELEGATION_STATUS_ICON_CLASS: Record<SessionIndicatorStatus, string> = {
  idle: 'text-foreground/40',
  running: 'text-blue-500',
  blocked: 'text-orange-500',
  completed: 'text-green-500',
}

export interface AgentSessionItemProps {
  session: AgentSessionMeta
  active: boolean
  indicatorStatus: SessionIndicatorStatus
  showPinIcon?: boolean
  /** 任务或协作会话族的紧凑进度；无 onToggle 时只显示进度。 */
  childSummary?: {
    total: number
    completed: number
    expanded?: boolean
    onToggle?: () => void
  }
  /** 仅用于菜单中的 collaboration 级联操作，不能把 Task 子任务误算进来。 */
  delegationChildCount?: number
  /** 行左侧状态色块（已移除：状态统一由行首小圆点表达）
   * @deprecated 不再渲染任何色条 */
  leftAccent?: never
  /** 是否禁用悬浮 Mini 地图 */
  disableMiniMap?: boolean
  /** 工作区名称 Badge（跨工作区列表时显示） */
  workspaceName?: string
  /** 所属项目主题色（已移除：原左缘 2px 色条随竖条一起去掉）
   * @deprecated 不再渲染任何色条 */
  projectColor?: never
  /** 当前项目列表；空数组时不渲染「移动到项目」入口 */
  projects?: KanbanProject[]
  onMoveToProject?: (sessionId: string, projectId?: string) => void | Promise<void>
  /** 当前工作区自定义分组列表；undefined 时不渲染「移动到分组」入口 */
  sessionGroups?: SessionGroup[]
  onMoveToGroup?: (sessionId: string, groupId?: string) => void | Promise<void>
  /** 打开「新建分组」对话框（点击「+ 新建分组...」时调用，创建后由调用方自行归组） */
  onCreateGroup?: (sessionId: string) => void
  /** Workspace Labels for assignment submenu */
  labels?: import('@myyoda/shared/labels').WorkspaceLabel[]
  onSetLabels?: (sessionId: string, labelIds: string[]) => Promise<void>
  onManageLabels?: () => void
  /** 用同一个时间戳刷新相对时间，避免每行独立计时 */
  relativeTimeNow: number
  onSelect: (id: string, title: string) => void
  onRequestDelete: (id: string) => void
  onRequestMove: (id: string) => void
  onRename: (id: string, newTitle: string) => Promise<void>
  onTogglePin: (id: string, cascade: boolean) => Promise<void>
  onToggleStar: (id: string) => Promise<void>
  onToggleArchive: (id: string) => Promise<void>
}

export const AgentSessionItem = React.memo(function AgentSessionItem({
  session,
  active,
  indicatorStatus,
  showPinIcon,
  childSummary,
  delegationChildCount = 0,
  disableMiniMap,
  workspaceName,
  projects,
  onMoveToProject,
  sessionGroups,
  onMoveToGroup,
  onCreateGroup,
  labels,
  onSetLabels,
  onManageLabels,
  relativeTimeNow,
  onSelect,
  onRequestDelete,
  onRequestMove,
  onRename,
  onTogglePin,
  onToggleStar,
  onToggleArchive,
}: AgentSessionItemProps): React.ReactElement {
  const [editing, setEditing] = React.useState(false)
  const [editTitle, setEditTitle] = React.useState('')
  const [menuOpen, setMenuOpen] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const justStartedEditing = React.useRef(false)
  // 菜单打开时关闭迷你地图预览，避免预览面板盖住菜单项导致点不动
  const sessionHoverPreviewEnabled = useAtomValue(sessionHoverPreviewEnabledAtom)
  const preview = useSessionMiniMapHover(600, !sessionHoverPreviewEnabled || disableMiniMap || menuOpen)

  const startEdit = (): void => {
    setEditTitle(session.title)
    setEditing(true)
    justStartedEditing.current = true
    setTimeout(() => {
      justStartedEditing.current = false
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 300)
  }

  const saveTitle = async (): Promise<void> => {
    if (justStartedEditing.current) return
    const trimmed = editTitle.trim()
    if (!trimmed || trimmed === session.title) {
      setEditing(false)
      return
    }
    await onRename(session.id, trimmed)
    setEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      saveTitle()
    } else if (e.key === 'Escape') {
      setEditing(false)
    }
  }

  const canMove = indicatorStatus === 'idle' || indicatorStatus === 'completed'

  const hasDelegatedChildren = delegationChildCount > 0
  const pinLabel = session.pinned ? '取消置顶' : '置顶会话'
  const cascadePinLabel = session.pinned
    ? `取消置顶(含 ${delegationChildCount} 个子会话)`
    : `置顶会话(含 ${delegationChildCount} 个子会话)`

  // 同一份菜单在 DropdownMenu（三点按钮）和 ContextMenu（右键）里渲染，
  // Sub 组件必须与所在菜单同源，因此由调用方注入对应实现。
  const menuItems = (
    MenuItem: typeof ContextMenuItem | typeof DropdownMenuItem,
    MenuSeparator: typeof ContextMenuSeparator | typeof DropdownMenuSeparator,
    MenuSub: typeof ContextMenuSub | typeof DropdownMenuSub,
    MenuSubTrigger: typeof ContextMenuSubTrigger | typeof DropdownMenuSubTrigger,
    MenuSubContent: typeof ContextMenuSubContent | typeof DropdownMenuSubContent,
  ) => (
    <>
      <MenuItem className="text-xs py-1 [&>svg]:size-3.5" onSelect={() => void onToggleStar(session.id)}>
        <Star size={14} fill={session.starred ? 'currentColor' : 'none'} className={session.starred ? 'text-amber-500' : undefined} />
        {session.starred ? '取消星标' : '添加星标'}
      </MenuItem>
      {hasDelegatedChildren ? (
        <>
          <MenuItem className="text-xs py-1 [&>svg]:size-3.5" onSelect={() => onTogglePin(session.id, false)}>
            {session.pinned ? <PinOff size={14} /> : <Pin size={14} />}
            仅{pinLabel}
          </MenuItem>
          <MenuItem className="text-xs py-1 [&>svg]:size-3.5" onSelect={() => onTogglePin(session.id, true)}>
            {session.pinned ? <PinOff size={14} /> : <Pin size={14} />}
            {cascadePinLabel}
          </MenuItem>
        </>
      ) : (
        <MenuItem className="text-xs py-1 [&>svg]:size-3.5" onSelect={() => onTogglePin(session.id, true)}>
          {session.pinned ? <PinOff size={14} /> : <Pin size={14} />}
          {pinLabel}
        </MenuItem>
      )}
      {canMove && (
        <MenuItem className="text-xs py-1 [&>svg]:size-3.5" onSelect={() => onRequestMove(session.id)}>
          <ArrowRightLeft size={14} />
          迁移到其他工作区
        </MenuItem>
      )}
      {projects && projects.length > 0 && onMoveToProject && (
        <MenuSub>
          <MenuSubTrigger className="text-xs py-1 [&>svg]:size-3.5">
            <FolderInput size={14} />
            移动到项目
          </MenuSubTrigger>
          <MenuSubContent className="w-44 z-[9999] min-w-0 p-0.5">
            {projects.map((project) => (
              <MenuItem
                key={project.id}
                disabled={project.id === session.projectId}
                className="text-xs py-1"
                onSelect={() => onMoveToProject(session.id, project.id)}
              >
                <span className="mr-1.5 size-2 rounded-full" style={{ backgroundColor: project.color ?? 'hsl(var(--muted-foreground))' }} />
                {project.name}
              </MenuItem>
            ))}
            {session.projectId && (
              <>
                <MenuSeparator className="my-0.5" />
                <MenuItem className="text-xs py-1" onSelect={() => onMoveToProject(session.id, undefined)}>
                  移出工作区
                </MenuItem>
              </>
            )}
          </MenuSubContent>
        </MenuSub>
      )}
      {labels && labels.length > 0 && onSetLabels && (
        <MenuSub>
          <MenuSubTrigger className="text-xs py-1 [&>svg]:size-3.5">
            <Tag size={14} />
            标签
          </MenuSubTrigger>
          <MenuSubContent className="w-44 z-[9999] min-w-0 p-0.5 max-h-64 overflow-y-auto">
            {labels.filter((l) => !l.archivedAt).map((label) => (
              <MenuItem
                key={label.id}
                className="text-xs py-1"
                onSelect={() => {
                  const current = session.labelIds ?? []
                  void onSetLabels(session.id, current.includes(label.id) ? current.filter((id) => id !== label.id) : [...current, label.id])
                }}
              >
                { (session.labelIds ?? []).includes(label.id) && <Check className="mr-1 h-3 w-3" /> }
                <span className="mr-1.5 size-2 rounded-full" style={{ backgroundColor: label.color ?? '#888' }} />
                {label.name}
              </MenuItem>
            ))}
            {onManageLabels && (
              <>
                <MenuSeparator className="my-0.5" />
                <MenuItem className="text-xs py-1 [&>svg]:size-3.5" onSelect={onManageLabels}>
                  <Settings size={14} />
                  管理标签…
                </MenuItem>
              </>
            )}
          </MenuSubContent>
        </MenuSub>
      )}
      {sessionGroups && onMoveToGroup && (
        <MenuSub>
          <MenuSubTrigger className="text-xs py-1 [&>svg]:size-3.5">
            <Tag size={14} />
            移动到分组
          </MenuSubTrigger>
          <MenuSubContent className="w-44 z-[9999] min-w-0 p-0.5">
            {onCreateGroup && (
              <>
                <MenuItem className="text-xs py-1 [&>svg]:size-3.5" onSelect={() => onCreateGroup(session.id)}>
                  <Plus size={14} />
                  新建分组...
                </MenuItem>
                {sessionGroups.length > 0 && <MenuSeparator className="my-0.5" />}
              </>
            )}
            {sessionGroups.map((group) => (
              <MenuItem
                key={group.id}
                disabled={group.id === session.customGroupId}
                className="text-xs py-1"
                onSelect={() => onMoveToGroup(session.id, group.id)}
              >
                {group.name}
              </MenuItem>
            ))}
            {session.customGroupId && (
              <>
                <MenuSeparator className="my-0.5" />
                <MenuItem className="text-xs py-1" onSelect={() => onMoveToGroup(session.id, undefined)}>
                  移出分组
                </MenuItem>
              </>
            )}
          </MenuSubContent>
        </MenuSub>
      )}
      <MenuItem className="text-xs py-1 [&>svg]:size-3.5" onSelect={() => startEdit()}>
        <Pencil size={14} />
        重命名
      </MenuItem>
      <MenuItem className="text-xs py-1 [&>svg]:size-3.5" onSelect={() => onToggleArchive(session.id)}>
        {session.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
        {session.archived ? '取消归档' : '归档'}
      </MenuItem>
      <MenuSeparator className="my-0.5" />
      <MenuItem className="text-xs py-1 [&>svg]:size-3.5 text-destructive" onSelect={() => onRequestDelete(session.id)}>
        <Trash2 size={14} />
        删除会话
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
          data-session-switch-id={session.id}
          data-session-switch-title={session.title}
          data-session-switch-type="agent"
          onClick={() => onSelect(session.id, session.title)}
          onMouseEnter={preview.handleMouseEnter}
          onMouseLeave={preview.handleMouseLeave}
          className={cn(
            'session-quick-switch-row group relative w-full flex items-center gap-1.5 rounded-md py-1 pl-2 pr-1.5 transition-colors duration-fast titlebar-no-drag text-left',
            'hover:bg-foreground/[0.03]',
            active && 'agent-session-item-active',
            // 选中态背景：浅色叠加深色变深、深色叠加浅色变浅，自动适配主题。
            active && 'bg-foreground/[0.08]',
          )}
        >
          {/* 状态小圆点（对齐 Claude）：idle=空心占位，running=蓝脉冲，blocked=橙，completed=绿 */}
          <span
            aria-hidden="true"
            className={cn('size-2 shrink-0 rounded-full', STATUS_DOT_CLASS[indicatorStatus])}
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
                'truncate text-[13px] leading-[18px] flex items-center gap-1.5',
                active ? 'text-foreground' : 'text-foreground/80'
              )}>
                {showPinIcon && (
                  <Pin size={11} className="flex-shrink-0 text-primary/60" />
                )}
                {session.sourceAutomationId && !session.sourceDelegationId && (
                  <Clock size={11} className="flex-shrink-0 text-foreground/40" />
                )}
                {session.parentSessionId && (
                  <GitBranch size={11} className={cn('flex-shrink-0', DELEGATION_STATUS_ICON_CLASS[indicatorStatus])} />
                )}
                <MarqueeText
                  text={session.title}
                  className="min-w-0 flex-1"
                  onDoubleClick={(event) => {
                    event.stopPropagation()
                    startEdit()
                  }}
                />
                {/* 星标不再是行内可交互按钮——切换动作移进「...」菜单，这里只保留一个
                    静态标记，让已加星标的会话仍能一眼看出来，同时不占用标题空间。 */}
                {session.starred && (
                  <Star size={12} fill="currentColor" className="flex-shrink-0 text-amber-500" aria-hidden="true" />
                )}
                {workspaceName && (
                  <span className="flex-shrink-0 px-1.5 py-0 rounded-full bg-primary/10 text-[10px] leading-4 workspace-badge font-medium truncate max-w-[80px]">
                    {workspaceName}
                  </span>
                )}
                {childSummary && childSummary.total > 0 && (
                  <span className="flex-shrink-0 text-[11px] leading-4 text-foreground/45 tabular-nums">
                    {childSummary.completed}/{childSummary.total}
                  </span>
                )}
              </div>
            )}
          </div>

          {!editing && (
            <>
              {childSummary?.onToggle && childSummary.expanded !== undefined && (
                <SafeTooltip content={childSummary.expanded ? '收起子会话' : '展开子会话'} side="top">
                  <button
                    type="button"
                    aria-label={`${childSummary.expanded ? '收起' : '展开'}子会话`}
                    onFocus={preview.closeNow}
                    onMouseDown={(event) => {
                      event.stopPropagation()
                      preview.closeNow()
                    }}
                    onClick={(event) => {
                      event.stopPropagation()
                      preview.closeNow()
                      childSummary.onToggle?.()
                    }}
                    onDoubleClick={(event) => {
                      event.stopPropagation()
                      preview.closeNow()
                    }}
                    className="session-delegation-toggle flex-shrink-0 inline-flex size-6 -my-1 items-center justify-center rounded text-foreground/45 hover:bg-foreground/[0.055] hover:text-foreground/70 transition-colors"
                  >
                    <ChevronRight
                      size={11}
                      className={cn(
                        'transition-transform duration-fast',
                        childSummary.expanded && 'rotate-90',
                      )}
                    />
                  </button>
                </SafeTooltip>
              )}
              <SessionItemActions
                updatedAt={session.updatedAt}
                reserveTrailingControl={!!childSummary?.onToggle}
                onMenuOpenChange={setMenuOpen}
                menuItems={menuItems}
              />
              <SessionQuickSwitchKeycap />
            </>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-40 z-[9999] min-w-0 p-0.5">
        {menuItems(ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent)}
      </ContextMenuContent>
      {!disableMiniMap && (
        <SessionMiniMapPopover
          target={{
            type: 'agent',
            sessionId: session.id,
            title: session.title,
            workspaceName,
          }}
          anchorRef={preview.anchorRef}
          open={preview.isOpen}
          isLeaving={preview.isLeaving}
          onMouseEnter={preview.handlePanelMouseEnter}
          onMouseLeave={preview.handlePanelMouseLeave}
        />
      )}
    </ContextMenu>
  )
})
