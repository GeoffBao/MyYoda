/**
 * ProjectContextPicker — 新会话 / 新任务流内共享的工作区（项目）上下文选择器
 *
 * 对齐 Proma「工作区 = 项目」：选择器展示工作区列表（绑定工程目录的工作区带目录徽标），
 * 选中即把会话/任务归属到该工作区；动作支持「新建项目（工作区）」「使用现有项目文件夹」。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import {
  Check,
  ChevronDown,
  FolderKanban,
  FolderPlus,
  FolderOpen,
  Search,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  agentSessionsAtom,
  agentWorkspacesAtom,
  currentAgentWorkspaceIdAtom,
} from '@/atoms/agent-atoms'
import { projectContextBrowseRequestAtom } from '@/atoms/project-context-picker'
import { CreateProjectDialog } from '@/components/work/CreateProjectDialog'
import { LocalProjectBadge } from '@/components/agent-skills/LocalProjectBadge'
import { cn } from '@/lib/utils'
import {
  buildPickerSections,
  shouldHonorBrowseRequest,
  type ProjectContextPickerMode,
} from './project-context-picker-model'

export interface ProjectContextPickerProps {
  mode: ProjectContextPickerMode
  /** 当前已绑定工作区（session 模式） */
  selectedWorkspaceId?: string
  /** 选中/绑定工作区；null 表示不改变归属（仅 session 的「清除」语义，保持当前工作区） */
  onSelect: (workspaceId: string | null) => void | Promise<void>
  className?: string
  /** 强制展开面板（新任务流对话框） */
  defaultOpen?: boolean
  /**
   * 触发器样式：'chip'（默认）是带图标/背景的小按钮，用于 composer 工具栏；
   * 'inline' 是纯文字 + 虚线下划线，字号跟随外层，用于嵌进句子里（空态问候语）。
   * 面板展开方向随 variant 自动决定：chip 向上展开（贴 composer），inline 向下展开。
   */
  variant?: 'chip' | 'inline'
  /** 未选中时的触发器文案；不传沿用各 variant 的默认值 */
  placeholderLabel?: string
  /** 挂载时自动展开一次「新建项目」表单（整个工作区首次建会话的引导），处理后应调用 onAutoOpenHandled 避免重复触发 */
  autoOpenCreate?: boolean
  onAutoOpenHandled?: () => void
}

/** 工作区数超过这个数量才显示搜索框——工作区少时多一行筛选框纯属噪音 */
const SEARCH_THRESHOLD = 8

export function ProjectContextPicker({
  mode,
  selectedWorkspaceId,
  onSelect,
  className,
  defaultOpen = false,
  variant = 'chip',
  placeholderLabel,
  autoOpenCreate = false,
  onAutoOpenHandled,
}: ProjectContextPickerProps): React.ReactElement {
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const setWorkspaces = useSetAtom(agentWorkspacesAtom)
  const sessions = useAtomValue(agentSessionsAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const browseRequest = useAtomValue(projectContextBrowseRequestAtom)

  const [open, setOpen] = React.useState(defaultOpen)
  const [busy, setBusy] = React.useState(false)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [filterText, setFilterText] = React.useState('')
  /** null = 尚未建立基线；避免挂载时回放历史 ⌘O / 浏览请求 */
  const browseBaselineRef = React.useRef<number | null>(null)
  /** 防止 autoOpenCreate 在同一挂载周期内重复触发（例如 onAutoOpenHandled 更新的是异步 atom） */
  const autoOpenHandledRef = React.useRef(false)

  React.useEffect(() => {
    if (!autoOpenCreate || autoOpenHandledRef.current) return
    autoOpenHandledRef.current = true
    setCreateOpen(true)
    onAutoOpenHandled?.()
  }, [autoOpenCreate, onAutoOpenHandled])

  const currentWorkspace = workspaces.find((item) => item.id === currentWorkspaceId) ?? workspaces[0] ?? null

  /** 最近活跃的工作区（按会话 updatedAt 推导），排前面 */
  const recentWorkspaceIds = React.useMemo(() => {
    const ids: string[] = []
    const seen = new Set<string>()
    for (const session of [...sessions].sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt))) {
      const workspaceId = session.workspaceId
      if (!workspaceId || seen.has(workspaceId)) continue
      seen.add(workspaceId)
      ids.push(workspaceId)
      if (ids.length >= 5) break
    }
    return ids
  }, [sessions])

  const activeWorkspaces = React.useMemo(
    () => workspaces.slice(),
    [workspaces],
  )

  const sections = React.useMemo(
    () =>
      buildPickerSections({
        mode,
        projects: activeWorkspaces.map((workspace) => ({
          id: workspace.id,
          name: workspace.name,
          workingDirectory: workspace.projectRootPath,
          updatedAt: workspace.updatedAt ?? 0,
        })),
        recentProjectIds: recentWorkspaceIds,
        selectedProjectId: selectedWorkspaceId,
      }),
    [mode, activeWorkspaces, recentWorkspaceIds, selectedWorkspaceId],
  )

  const showSearch = sections.projects.length > SEARCH_THRESHOLD
  const visibleWorkspaces = React.useMemo(() => {
    if (!showSearch || !filterText.trim()) return sections.projects
    const needle = filterText.trim().toLowerCase()
    return sections.projects.filter((workspace) => workspace.name.toLowerCase().includes(needle))
  }, [sections.projects, showSearch, filterText])

  React.useEffect(() => {
    if (!open) setFilterText('')
  }, [open])

  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null
  const selectedName = selectedWorkspace?.name

  const upsertWorkspace = React.useCallback((workspace: { id: string; name: string; slug: string; projectRootPath?: string }): void => {
    setWorkspaces((prev) => {
      const without = prev.filter((item) => item.id !== workspace.id)
      return [{ ...workspace, createdAt: Date.now(), updatedAt: Date.now() }, ...without]
    })
  }, [setWorkspaces])

  /** 使用现有项目文件夹：同名同目录工作区复用（直接切换），否则创建并绑定 */
  const openOrCreateByPath = React.useCallback(async (folderPath: string): Promise<void> => {
    setBusy(true)
    try {
      const existing = workspaces.find((ws) => {
        if (!ws.projectRootPath) return false
        const normalize = (p: string): string => p.replace(/[\\/]+$/, '')
        return normalize(ws.projectRootPath) === normalize(folderPath)
      })
      let workspaceId: string
      if (existing) {
        workspaceId = existing.id
        toast.success(`已切换到「${existing.name}」`)
      } else {
        const name = folderPath.trim().replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).pop() ?? '项目'
        const created = await window.electronAPI.createAgentWorkspace({ name, projectRootPath: folderPath })
        upsertWorkspace(created)
        workspaceId = created.id
        toast.success(`已创建项目「${created.name}」`)
      }
      await onSelect(workspaceId)
      setOpen(false)
    } catch (error) {
      console.error('[ProjectContextPicker] 打开路径失败:', error)
      toast.error('打开文件夹失败', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(false)
    }
  }, [onSelect, upsertWorkspace, workspaces])

  const handleBrowse = React.useCallback(async (): Promise<void> => {
    try {
      const dialog = await window.electronAPI.openFolderDialog()
      if (!dialog?.path) return
      await openOrCreateByPath(dialog.path)
    } catch (error) {
      console.error('[ProjectContextPicker] 浏览目录失败:', error)
      toast.error('浏览目录失败')
    }
  }, [openOrCreateByPath])

  React.useEffect(() => {
    const decision = shouldHonorBrowseRequest({
      browseRequest,
      baseline: browseBaselineRef.current,
    })
    browseBaselineRef.current = decision.nextBaseline
    if (!decision.honor) return
    setOpen(true)
    void handleBrowse()
  }, [browseRequest, handleBrowse])

  /** 新建项目（工作区）：CreateProjectDialog 已改为创建 AgentWorkspace（可选绑定工程目录） */
  const handleCreate = React.useCallback(async (
    input: { name: string; workingDirectory?: string },
  ): Promise<void> => {
    setBusy(true)
    try {
      const workspace = await window.electronAPI.createAgentWorkspace({
        name: input.name,
        projectRootPath: input.workingDirectory?.trim() || undefined,
      })
      upsertWorkspace(workspace)
      setCreateOpen(false)
      await onSelect(workspace.id)
      setOpen(false)
      toast.success(`已创建项目「${workspace.name}」`)
    } catch (error) {
      console.error('[ProjectContextPicker] 新建项目失败:', error)
      toast.error('创建项目失败', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(false)
    }
  }, [onSelect, upsertWorkspace])

  const handlePick = React.useCallback(async (workspaceId: string | null): Promise<void> => {
    setBusy(true)
    try {
      await onSelect(workspaceId)
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }, [onSelect])

  const panel = (
    <div
      className={cn(
        'flex flex-col overflow-hidden rounded-xl border border-border/60 bg-background/95 shadow-lg backdrop-blur-sm',
        // 固定宽度而非跟随触发器宽度百分比：触发器（尤其 inline 变体）宽度随文字内容变化，
        // 用 100% 算面板宽会导致面板被压得很窄，装不下筛选框/长工作区名
        defaultOpen ? 'w-full' : 'w-[280px]',
      )}
      role="listbox"
      aria-label="选择工作区"
    >
      {/* 工作区多起来后才出现的筛选框，常见场景不占地方 */}
      {showSearch && (
        <div className="shrink-0 border-b border-border/40 p-1.5">
          <div className="flex items-center gap-1.5 rounded-lg bg-foreground/[0.04] px-2 py-1">
            <Search size={12} className="shrink-0 text-foreground/35" />
            <input
              autoFocus
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="筛选工作区…"
              className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-foreground/35"
            />
          </div>
        </div>
      )}

      {/* 列表：最近活跃的工作区排前面；绑定目录的工作区带「本地项目」徽标 */}
      <div className="max-h-[220px] space-y-2 overflow-y-auto p-1.5">
        <Section title="最近">
          {visibleWorkspaces.length === 0 ? (
            <p className="px-2 py-1.5 text-[11px] text-foreground/40">
              {sections.projects.length === 0 ? '暂无项目，点下方新建' : '没有匹配的工作区'}
            </p>
          ) : (
            visibleWorkspaces.map((workspace) => {
              const ws = workspaces.find((candidate) => candidate.id === workspace.id)
              return (
                <PickRow
                  key={workspace.id}
                  label={workspace.name}
                  title={workspace.workingDirectory}
                  badge={ws?.projectRootPath ? '本地项目' : undefined}
                  active={workspace.id === selectedWorkspaceId}
                  disabled={busy}
                  onClick={() => { void handlePick(workspace.id) }}
                />
              )
            })
          )}
        </Section>
      </div>

      {/* 动作钉底：新建项目始终可见，不被长列表挤出视口 */}
      <div className="shrink-0 space-y-0.5 border-t border-border/40 bg-background/90 p-1.5">
        <ActionRow
          icon={FolderPlus}
          label="新建项目…"
          disabled={busy}
          onClick={() => setCreateOpen(true)}
        />
        <ActionRow
          icon={FolderOpen}
          label="使用现有项目文件夹…"
          disabled={busy}
          onClick={() => { void handleBrowse() }}
        />
        {sections.actions.some((action) => action.id === 'skip') ? (
          <ActionRow
            icon={FolderKanban}
            label="保持当前工作区"
            disabled={busy || !currentWorkspace}
            onClick={() => { void handlePick(null) }}
          />
        ) : null}
      </div>
    </div>
  )

  const createDialog = (
    <CreateProjectDialog
      open={createOpen}
      busy={busy}
      onOpenChange={setCreateOpen}
      onSubmit={(input) => { void handleCreate(input) }}
    />
  )

  if (defaultOpen) {
    return (
      <div className={className}>
        {panel}
        {createDialog}
      </div>
    )
  }

  const defaultPlaceholder = variant === 'inline' ? '选择项目' : '选择/新建项目'
  const triggerLabel = selectedName ?? placeholderLabel ?? defaultPlaceholder
  // chip 贴在 composer 底部，面板向上展开；inline 嵌在页面中部的问候语里，向下展开更自然
  // （Radix 会在首选方向空间不够时自动翻转，这里只是首选方向）
  const preferredSide = variant === 'inline' ? 'bottom' : 'top'

  return (
    // span 而非 div：inline 变体嵌在 <h1> 句子中间，div 是块级元素会打断文字流（把一句话拆成三行）；
    // 作为 flex 容器子项时（chip 变体），span 会被自动块级化，视觉行为与之前的 div 完全一致。
    <span className={cn('relative', className)}>
      <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
        <PopoverPrimitive.Trigger asChild>
          {variant === 'inline' ? (
            <button
              type="button"
              disabled={busy}
              className={cn(
                'underline decoration-dotted decoration-1 underline-offset-4 outline-none transition-opacity hover:opacity-70 disabled:opacity-60',
              )}
              aria-label="选择/新建项目"
              title={selectedName ?? '选择或新建项目'}
            >
              {triggerLabel}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              className={cn(
                'inline-flex h-7 max-w-[200px] items-center gap-1 rounded-md px-1.5 text-[12px] text-foreground/70 outline-none hover:bg-foreground/[0.05] hover:text-foreground',
                busy && 'opacity-60',
              )}
              aria-label="选择/新建项目"
              title={selectedName ?? '选择或新建项目'}
            >
              <FolderKanban size={12} className="shrink-0 text-foreground/40" />
              <span className="truncate">{triggerLabel}</span>
              <ChevronDown size={11} className="shrink-0 text-foreground/35" />
            </button>
          )}
        </PopoverPrimitive.Trigger>
        {/* Portal 到 document.body：逃离 Conversation（overflow-y-hidden）等祖先容器的裁切；
            avoidCollisions（默认开）在首选方向空间不够时自动翻到另一侧；
            maxHeight 兜底绑定 Radix 计算出的可用高度，极端情况下面板整体可滚动，而不是被祖先无声裁掉 */}
        <PopoverPrimitive.Portal>
          {/* Portal 到 body 后与 AppShell 同级比较 z-index：AppShell 中间容器是 z-[60]，
              用 z-50 会被整个盖住（点击项目名"没反应"其实是面板被遮挡）；
              项目内 Radix dropdown 统一约定 z-[9999]（见 AgentSessionItem / LeftSidebar） */}
          <PopoverPrimitive.Content
            side={preferredSide}
            align="start"
            sideOffset={6}
            collisionPadding={12}
            className="z-[9999] overflow-y-auto outline-none"
            style={{ maxHeight: 'var(--radix-popover-content-available-height, 400px)' }}
          >
            {panel}
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
      {createDialog}
    </span>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div>
      <p className="px-2 pb-1 text-[10px] font-medium uppercase tracking-wide text-foreground/35">{title}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

function PickRow({
  label,
  title,
  badge,
  active,
  disabled,
  onClick,
}: {
  label: string
  /** 完整路径等，仅作 tooltip，不占行高 */
  title?: string
  /** 可选徽标文案（如「本地项目」） */
  badge?: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[12px] transition-colors',
        active ? 'bg-primary/10 font-medium text-foreground' : 'text-foreground/80 hover:bg-foreground/[0.05]',
        disabled && 'opacity-50',
      )}
    >
      <FolderKanban size={12} className="shrink-0 text-foreground/35" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge ? (
        <LocalProjectBadge workingDirectory={title} className="bg-foreground/[0.05] text-foreground/40" />
      ) : null}
      {active ? <Check size={12} className="shrink-0 text-primary" /> : null}
    </button>
  )
}

function ActionRow({
  icon: Icon,
  label,
  disabled,
  onClick,
}: {
  icon: LucideIcon
  label: string
  disabled?: boolean
  onClick: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] text-foreground/70 hover:bg-foreground/[0.05] hover:text-foreground',
        disabled && 'opacity-50',
      )}
    >
      <Icon size={13} className="text-foreground/40" />
      <span>{label}</span>
    </button>
  )
}
