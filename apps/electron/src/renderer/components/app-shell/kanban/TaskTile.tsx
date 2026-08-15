import { useDraggable } from '@dnd-kit/core'
import { useAtomValue } from 'jotai'
import { Archive, ArchiveRestore, ChevronDown, Clock, MessageSquare, MoreHorizontal, Pencil, Play, Tag, Trash2, Users } from 'lucide-react'
import * as React from 'react'
import { cn } from '@/lib/utils'
import { StatusBadge } from './StatusBadge'
import { SubtaskProgress } from './SubtaskProgress'
import { SubtaskRow } from './SubtaskRow'
import { resolveDagAttention, shouldShowDoneColumnAttention } from './dag-attention'
import type { TaskWorkflow } from '@myyoda/shared/tasks'
import type { KanbanItem } from './types'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { workspaceLabelsAtom } from '@/atoms/workspace-labels-atoms'
import { LabelChips } from '@/components/labels/LabelChips'
import { formatRelativeUpdatedAt } from '../AgentSessionItem'
import { buildTaskCardViewModel } from './task-card-view-model'

interface TaskTileProps {
  item: KanbanItem
  accent?: string
  draggable?: boolean
  /** 点击卡片本体：打开对应会话（对齐 craft，与编辑是两个独立入口）。 */
  onOpen?: (item: KanbanItem) => void
  /** 铅笔按钮 / 右键菜单「编辑任务」：任何卡片都可用，不要求已绑定 task spec。 */
  onEdit?: (item: KanbanItem) => void
  /** 右键菜单「重命名」：卡片标题原地变输入框，回车提交新标题。 */
  onRename?: (item: KanbanItem, newTitle: string) => void
  /** 右键菜单「归档 / 取消归档」。 */
  onArchive?: (item: KanbanItem) => void
  /** 右键菜单「删除」：仅发起请求，确认对话框由调用方持有。 */
  onRequestDelete?: (item: KanbanItem) => void
  onOpenSubtask?: (sessionId: string) => void
  onRunTask?: (item: KanbanItem) => void
  onSetLabels?: (item: KanbanItem, labelIds: string[]) => void
  onChangeWorkflow?: (item: KanbanItem, workflow: TaskWorkflow) => void
  /** 打开任务家族会话面板（同 taskSlug 的全部关联会话） */
  onOpenTaskFamily?: (item: KanbanItem) => void
  className?: string
}

function isLiveStatus(status: string | undefined): boolean {
  return status === 'running' || status === 'in-progress' || status === 'queued'
}

export function TaskTile({
  item,
  accent,
  draggable = true,
  onOpen,
  onEdit,
  onRename,
  onArchive,
  onRequestDelete,
  onOpenSubtask,
  onRunTask,
  onSetLabels,
  onChangeWorkflow,
  onOpenTaskFamily,
  className,
}: TaskTileProps): React.ReactElement {
  const [expanded, setExpanded] = React.useState(
    () => item.subtasks.some((subtask) => subtask.runState === 'running' || subtask.runState === 'failed'),
  )
  const [renaming, setRenaming] = React.useState(false)
  const [renameValue, setRenameValue] = React.useState(item.title)
  const renameInputRef = React.useRef<HTMLInputElement>(null)
  const justStartedRenaming = React.useRef(false)
  const workspaceLabels = useAtomValue(workspaceLabelsAtom)
  const viewModel = buildTaskCardViewModel(item)
  const drag = useDraggable({ id: item.id, disabled: !draggable, data: { kind: 'kanban-item' } })
  const transform = drag.transform
    ? `translate3d(${drag.transform.x}px, ${drag.transform.y}px, 0)`
    : undefined
  const hasRunning = item.isProcessing || item.subtasks.some((subtask) => subtask.runState === 'running')
  const live = hasRunning || isLiveStatus(item.session.sessionStatus)
  const progressTotal = item.subtaskTotal ?? item.taskRun?.totalNodes ?? item.subtasks.length
  const dagAttention = resolveDagAttention(item.subtasks, progressTotal)
  const showDoneAttention = shouldShowDoneColumnAttention(item.columnId, dagAttention)
  const canRun = Boolean(onRunTask)
    && Boolean(item.task?.taskSlug ?? item.session.taskSlug)
    && !hasRunning
    && item.subtasks.some((subtask) => subtask.runState === 'pending')
  // 对齐 craft：编辑不要求已绑定 task spec，任何卡片都能打开编辑器（没有 taskSlug
  // 时编辑器从当前标题/模型起草新表单，保存即"升级"成正式任务）。
  const canEdit = Boolean(onEdit) && item.hasSession !== false
  const canRename = Boolean(onRename) && (!item.task || !item.task.legacyIdentity)
  const canArchive = Boolean(onArchive) && (!item.task || !item.task.legacyIdentity)
  const canDelete = Boolean(onRequestDelete) && (!item.task || !item.task.legacyIdentity)
  const handleEdit = (event?: React.SyntheticEvent): void => {
    event?.stopPropagation()
    onEdit?.(item)
  }

  const startRename = (): void => {
    setRenameValue(item.title)
    setRenaming(true)
    justStartedRenaming.current = true
    setTimeout(() => {
      justStartedRenaming.current = false
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    }, 0)
  }

  const saveRename = (): void => {
    if (justStartedRenaming.current) return
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== item.title) onRename?.(item, trimmed)
    setRenaming(false)
  }

  const handleRenameKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      saveRename()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setRenaming(false)
    }
  }

  const canSetLabels = Boolean(onSetLabels) && Boolean(item.task && !item.task.legacyIdentity)
  const canChangeWorkflow = Boolean(onChangeWorkflow) && Boolean(item.task && !item.task.legacyIdentity)
  const hasCardMenu = canEdit || canRename || canArchive || canDelete || canSetLabels || canChangeWorkflow
  // 任务家族入口：正式 Task（非 legacy）始终可查；普通会话有 taskSlug 也可查（对齐 craft 家族心智）
  const canOpenTaskFamily = Boolean(onOpenTaskFamily) && Boolean(item.task?.taskSlug ?? item.session.taskSlug)
  const hasAnyMenu = hasCardMenu || canOpenTaskFamily

  const card = (
    <article
      ref={drag.setNodeRef}
      style={{
        transform,
        opacity: drag.isDragging ? 0.55 : 1,
        ...(live && accent
          ? { boxShadow: `0 0 0 1px ${accent}, 0 4px 16px -4px color-mix(in srgb, ${accent} 40%, transparent)` }
          : undefined),
      }}
      {...drag.attributes}
      {...drag.listeners}
      role="button"
      tabIndex={0}
      aria-label={`打开任务：${item.title}`}
      onClick={() => onOpen?.(item)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
        event.preventDefault()
        onOpen?.(item)
      }}
      className={cn(
        'group cursor-pointer rounded-xl bg-card p-3 shadow-sm ring-1 ring-border/30 transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        live && 'ring-amber-500/40',
        showDoneAttention && dagAttention?.kind === 'has-failed' && 'ring-destructive/35',
        showDoneAttention && dagAttention?.kind === 'needs-review' && 'ring-violet-500/35',
        showDoneAttention && dagAttention?.kind === 'incomplete' && 'ring-amber-500/35',
        draggable && 'touch-none',
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <input
              ref={renameInputRef}
              value={renameValue}
              data-no-dnd
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => setRenameValue(event.target.value)}
              onBlur={saveRename}
              onKeyDown={handleRenameKeyDown}
              className="w-full rounded-md border border-border bg-background px-1.5 py-0.5 text-sm font-medium leading-5 outline-none ring-1 ring-ring"
            />
          ) : (
            <h3 className={cn(
              'line-clamp-2 text-sm font-medium leading-5',
              // 对齐 craft：done/cancelled（closed 态）标题划线，与列位置无关
              (item.task?.workflow === 'done' || item.task?.workflow === 'cancelled'
                || item.session.sessionStatus === 'done' || item.session.sessionStatus === 'cancelled')
                && 'text-foreground/55 line-through',
            )}>{item.title}</h3>
          )}
          {viewModel.projectName && <p className="mt-1 truncate text-[11px] text-muted-foreground">{viewModel.projectName}</p>}
          {viewModel.labelIds.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              <LabelChips labels={workspaceLabels} activeIds={viewModel.labelIds} max={2} />
            </div>
          )}
        </div>
        {canRun && (
          <button
            type="button"
            title="运行任务"
            aria-label="运行任务"
            data-no-dnd
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              onRunTask?.(item)
            }}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground shadow-sm"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
          </button>
        )}
        {canOpenTaskFamily && (
          <button
            type="button"
            title="查看任务全部会话"
            aria-label="查看任务全部会话"
            data-no-dnd
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              onOpenTaskFamily?.(item)
            }}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-muted/60 px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Users className="h-3.5 w-3.5" />
            会话
          </button>
        )}
        {hasCardMenu && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                title="任务操作"
                aria-label="任务操作"
                data-no-dnd
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40 z-[9999]" onClick={(event) => event.stopPropagation()}>
              {canOpenTaskFamily && (
                <DropdownMenuItem onSelect={() => onOpenTaskFamily?.(item)}>
                  <Users className="mr-2 h-3.5 w-3.5" />任务会话
                </DropdownMenuItem>
              )}
              {canEdit && (
                <DropdownMenuItem onSelect={() => handleEdit()}>
                  <Pencil className="mr-2 h-3.5 w-3.5" />编辑任务
                </DropdownMenuItem>
              )}
              {canRename && (
                <DropdownMenuItem onSelect={startRename}>
                  <Pencil className="mr-2 h-3.5 w-3.5" />重命名
                </DropdownMenuItem>
              )}
              {canChangeWorkflow && item.task && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>更改状态</DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent className="z-[10000] w-36">
                      {([
                        ['todo', '待办'],
                        ['in-progress', '进行中'],
                        ['needs-review', '待验收'],
                        ['done', '已完成'],
                        ['cancelled', '已取消'],
                      ] as Array<[TaskWorkflow, string]>).map(([workflow, label]) => (
                        <DropdownMenuCheckboxItem key={workflow} checked={item.task?.workflow === workflow} onCheckedChange={() => onChangeWorkflow?.(item, workflow)}>
                          {label}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
              )}
              {canSetLabels && workspaceLabels.length > 0 && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger><Tag className="mr-2 h-3.5 w-3.5" />Labels</DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent className="z-[10000] w-44">
                      {workspaceLabels.map((label) => {
                        const checked = viewModel.labelIds.includes(label.id)
                        return (
                          <DropdownMenuCheckboxItem
                            key={label.id}
                            checked={checked}
                            onCheckedChange={() => onSetLabels?.(item, checked
                              ? viewModel.labelIds.filter((id) => id !== label.id)
                              : [...viewModel.labelIds, label.id])}
                          >
                            <span className="mr-2 size-2 rounded-full" style={{ backgroundColor: label.color }} />{label.name}
                          </DropdownMenuCheckboxItem>
                        )
                      })}
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
              )}
              {canArchive && (
                <DropdownMenuItem onSelect={() => onArchive?.(item)}>
                  {item.task?.archivedAt ?? item.session.archived
                    ? <ArchiveRestore className="mr-2 h-3.5 w-3.5" />
                    : <Archive className="mr-2 h-3.5 w-3.5" />}
                  {item.task?.archivedAt ?? item.session.archived ? '取消归档' : '归档'}
                </DropdownMenuItem>
              )}
              {canDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive" onSelect={() => onRequestDelete?.(item)}>
                    <Trash2 className="mr-2 h-3.5 w-3.5" />删除任务
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {item.task && (
          <span className="inline-flex items-center rounded-full bg-foreground/[0.06] px-2 py-0.5 text-[11px] font-medium text-foreground/65">
            {({
              todo: '待办',
              'in-progress': '进行中',
              'needs-review': '待验收',
              done: '已完成',
              cancelled: '已取消',
            } as const)[item.task.workflow]}
          </span>
        )}
        {viewModel.showSessionStatus && <StatusBadge status={item.session.sessionStatus} live={live} />}
        {showDoneAttention && dagAttention && (
          <span
            title="列在「已完成」，但任务 DAG 尚未全部成功结束"
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
              dagAttention.kind === 'has-failed' && 'bg-destructive/10 text-destructive',
              dagAttention.kind === 'needs-review' && 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
              dagAttention.kind === 'incomplete' && 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
            )}
          >
            {dagAttention.label}
          </span>
        )}
      </div>

      {progressTotal > 0 && (
        <div className="mt-3 space-y-1.5" data-no-dnd>
          <div className="flex items-center gap-2">
            <SubtaskProgress
              subtasks={item.subtasks}
              total={progressTotal}
              accent={accent}
              className="min-w-0 flex-1"
            />
            {item.subtasks.length > 0 && (
              <button
                type="button"
                aria-label={expanded ? '收起子任务' : '展开子任务'}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  setExpanded((value) => !value)
                }}
                className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground hover:bg-muted"
              >
                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} />
              </button>
            )}
          </div>
          {expanded && item.subtasks.length > 0 && (
            <div className="space-y-0.5 rounded-lg bg-muted/35 p-1.5">
              {item.subtasks.map((subtask) => (
                <SubtaskRow
                  key={subtask.id}
                  subtask={subtask}
                  hideModelWhen={item.session.modelId}
                  onClick={subtask.sessionId && onOpenSubtask
                    ? () => onOpenSubtask(subtask.sessionId!)
                    : undefined}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-2 flex items-center justify-end gap-2.5 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {formatRelativeUpdatedAt(item.task?.updatedAt ?? item.session.updatedAt, Date.now())}
        </span>
        {typeof item.session.messageCount === 'number' && item.session.messageCount > 0 && (
          <span className="flex items-center gap-1">
            <MessageSquare className="h-3 w-3" />
            {item.session.messageCount}
          </span>
        )}
      </div>
    </article>
  )

  if (!hasAnyMenu) return card

  const archived = Boolean(item.task?.archivedAt ?? item.session.archived)

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{card}</ContextMenuTrigger>
      {/* z-[9999]：ContextMenuContent 默认 z-50，在 Kanban 这层被 app-shell 其它高层级
          元素盖住会"看起来没反应"——AgentSessionItem 的会话行右键菜单已经踩过这个坑，
          这里保持同一套覆盖值。 */}
      <ContextMenuContent className="w-40 z-[9999]">
        {canOpenTaskFamily && (
          <ContextMenuItem onSelect={() => onOpenTaskFamily?.(item)}>
            <Users className="mr-2 h-3.5 w-3.5" />
            任务会话
          </ContextMenuItem>
        )}
        {canEdit && (
          <ContextMenuItem onSelect={() => handleEdit()}>
            <Pencil className="mr-2 h-3.5 w-3.5" />
            编辑任务
          </ContextMenuItem>
        )}
        {canRename && (
          <ContextMenuItem onSelect={() => startRename()}>
            <Pencil className="mr-2 h-3.5 w-3.5" />
            重命名
          </ContextMenuItem>
        )}
        {canArchive && (
          <ContextMenuItem onSelect={() => onArchive?.(item)}>
            {archived ? <ArchiveRestore className="mr-2 h-3.5 w-3.5" /> : <Archive className="mr-2 h-3.5 w-3.5" />}
            {archived ? '取消归档' : '归档'}
          </ContextMenuItem>
        )}
        {canDelete && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem className="text-destructive" onSelect={() => onRequestDelete?.(item)}>
              <Trash2 className="mr-2 h-3.5 w-3.5" />
              删除任务
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
