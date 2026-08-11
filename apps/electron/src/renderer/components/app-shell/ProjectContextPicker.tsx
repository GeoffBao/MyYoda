/**
 * ProjectContextPicker — 新会话 / 新任务流内共享的项目上下文选择器
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import {
  Check,
  ChevronDown,
  FolderKanban,
  FolderPlus,
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
import { serverKanbanProjectsAtom } from '@/atoms/project-atoms'
import { CreateProjectDialog } from '@/components/work/CreateProjectDialog'
import { cn } from '@/lib/utils'
import type { KanbanProject } from '@/components/app-shell/kanban/types'
import {
  buildPickerSections,
  shouldHonorBrowseRequest,
  type ProjectContextPickerMode,
} from './project-context-picker-model'

export interface ProjectContextPickerProps {
  mode: ProjectContextPickerMode
  /** 当前已绑定项目（session 模式） */
  selectedProjectId?: string
  /** 选中/绑定项目；null 表示无项目（仅 session） */
  onSelect: (projectId: string | null) => void | Promise<void>
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

/** 项目数超过这个数量才显示搜索框——项目少时多一行筛选框纯属噪音 */
const SEARCH_THRESHOLD = 8

function toKanbanProject(project: {
  id: string
  slug: string
  name: string
  description?: string
  workingDirectory?: string
  details?: string
  color?: string
  updatedAt: number
  archivedAt?: number
  defaultExpertId?: string
  workspaceId?: string
}): KanbanProject {
  return {
    id: project.id,
    slug: project.slug,
    name: project.name,
    description: project.description,
    workingDirectory: project.workingDirectory,
    details: project.details,
    color: project.color,
    updatedAt: project.updatedAt,
    archivedAt: project.archivedAt,
    defaultExpertId: project.defaultExpertId,
    workspaceId: project.workspaceId,
  }
}

export function ProjectContextPicker({
  mode,
  selectedProjectId,
  onSelect,
  className,
  defaultOpen = false,
  variant = 'chip',
  placeholderLabel,
  autoOpenCreate = false,
  onAutoOpenHandled,
}: ProjectContextPickerProps): React.ReactElement {
  const projects = useAtomValue(serverKanbanProjectsAtom)
  const setProjects = useSetAtom(serverKanbanProjectsAtom)
  const sessions = useAtomValue(agentSessionsAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)
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

  const workspace = workspaces.find((item) => item.id === currentWorkspaceId) ?? workspaces[0]

  const recentProjectIds = React.useMemo(() => {
    const ids: string[] = []
    const seen = new Set<string>()
    for (const session of [...sessions].sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt))) {
      const projectId = session.projectId
      if (!projectId || seen.has(projectId)) continue
      seen.add(projectId)
      ids.push(projectId)
      if (ids.length >= 5) break
    }
    return ids
  }, [sessions])

  const activeProjects = React.useMemo(
    () => projects.filter((project) => !project.archivedAt),
    [projects],
  )

  const sections = React.useMemo(
    () =>
      buildPickerSections({
        mode,
        projects: activeProjects.map((project) => ({
          id: project.id,
          name: project.name,
          workingDirectory: project.workingDirectory,
          updatedAt: project.updatedAt ?? 0,
          archivedAt: project.archivedAt,
        })),
        recentProjectIds,
        selectedProjectId,
      }),
    [mode, activeProjects, recentProjectIds, selectedProjectId],
  )

  const showSearch = sections.projects.length > SEARCH_THRESHOLD
  const visibleProjects = React.useMemo(() => {
    if (!showSearch || !filterText.trim()) return sections.projects
    const needle = filterText.trim().toLowerCase()
    return sections.projects.filter((project) => project.name.toLowerCase().includes(needle))
  }, [sections.projects, showSearch, filterText])

  React.useEffect(() => {
    if (!open) setFilterText('')
  }, [open])

  const selectedName = projects.find((project) => project.id === selectedProjectId)?.name

  const upsertProject = React.useCallback((project: KanbanProject): void => {
    setProjects((prev) => {
      const without = prev.filter((item) => item.id !== project.id)
      return [project, ...without]
    })
  }, [setProjects])

  const openOrCreateByPath = React.useCallback(async (folderPath: string): Promise<void> => {
    if (!workspace) {
      toast.error('请先选择工作区')
      return
    }
    setBusy(true)
    try {
      const workspaceRoot = await window.electronAPI.getWorkspaceRootPath(workspace.slug)
      const result = await window.electronAPI.projects.openOrCreateByPath(workspaceRoot, folderPath)
      const kanban = toKanbanProject(result.project)
      upsertProject(kanban)
      await onSelect(kanban.id)
      setOpen(false)
      if (result.created) {
        toast.success(`已创建项目「${kanban.name}」`)
      }
    } catch (error) {
      console.error('[ProjectContextPicker] 打开路径失败:', error)
      toast.error('打开文件夹失败', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(false)
    }
  }, [onSelect, upsertProject, workspace])

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

  const handleCreate = React.useCallback(async (
    input: Parameters<typeof window.electronAPI.projects.create>[1],
  ): Promise<void> => {
    if (!workspace) {
      toast.error('请先选择工作区')
      return
    }
    setBusy(true)
    try {
      const workspaceRoot = await window.electronAPI.getWorkspaceRootPath(workspace.slug)
      const project = await window.electronAPI.projects.create(workspaceRoot, input)
      const kanban = toKanbanProject(project)
      upsertProject(kanban)
      setCreateOpen(false)
      await onSelect(kanban.id)
      setOpen(false)
      toast.success(`已创建项目「${kanban.name}」`)
    } catch (error) {
      console.error('[ProjectContextPicker] 新建项目失败:', error)
      toast.error('创建项目失败', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(false)
    }
  }, [onSelect, upsertProject, workspace])

  const handlePick = React.useCallback(async (projectId: string | null): Promise<void> => {
    setBusy(true)
    try {
      await onSelect(projectId)
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
        // 用 100% 算面板宽会导致面板被压得很窄，装不下筛选框/长项目名
        defaultOpen ? 'w-full' : 'w-[280px]',
      )}
      role="listbox"
      aria-label="选择项目上下文"
    >
      {/* 项目多起来后才出现的筛选框，项目少的常见场景下不占地方 */}
      {showSearch && (
        <div className="shrink-0 border-b border-border/40 p-1.5">
          <div className="flex items-center gap-1.5 rounded-lg bg-foreground/[0.04] px-2 py-1">
            <Search size={12} className="shrink-0 text-foreground/35" />
            <input
              autoFocus
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="筛选项目…"
              className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-foreground/35"
            />
          </div>
        </div>
      )}

      {/* 列表：只显示项目名，完整路径进 title（对齐 Cursor/Codex）。
          最近使用的项目排前面，同一项目只出现一次。 */}
      <div className="max-h-[220px] space-y-2 overflow-y-auto p-1.5">
        <Section title="最近">
          {visibleProjects.length === 0 ? (
            <p className="px-2 py-1.5 text-[11px] text-foreground/40">
              {sections.projects.length === 0 ? '暂无项目' : '没有匹配的项目'}
            </p>
          ) : (
            visibleProjects.map((project) => (
              <PickRow
                key={project.id}
                label={project.name}
                title={project.workingDirectory}
                active={project.id === selectedProjectId}
                disabled={busy}
                onClick={() => { void handlePick(project.id) }}
              />
            ))
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
        {sections.actions.some((action) => action.id === 'skip') ? (
          <ActionRow
            icon={FolderKanban}
            label="清除项目"
            disabled={busy}
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
  active,
  disabled,
  onClick,
}: {
  label: string
  /** 完整路径等，仅作 tooltip，不占行高 */
  title?: string
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
