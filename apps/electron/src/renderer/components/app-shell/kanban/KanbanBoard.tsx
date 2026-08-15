import { DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { Plus } from 'lucide-react'
import { activeBoardItems, buildKanbanBoardModel, type KanbanColumnDefinition } from './board-model'
import { KanbanColumn } from './KanbanColumn'
import { TaskListRow } from './TaskListRow'
import type { TaskWorkflow } from '@myyoda/shared/tasks'
import type { KanbanColumnDef } from '@myyoda/shared/projects'
import type { KanbanBoardMode, KanbanItem } from './types'

export interface KanbanBoardEmptyStateView {
  title: string
  actionLabel: string
  onAction: () => void
}

interface KanbanBoardProps {
  items: KanbanItem[]
  mode: KanbanBoardMode
  workflowFilter: 'all' | TaskWorkflow
  columns?: KanbanColumnDefinition[]
  onMove: (sessionId: string, columnId: string) => void
  onOpenItem?: (item: KanbanItem) => void
  onEditItem?: (item: KanbanItem) => void
  onRenameItem?: (item: KanbanItem, newTitle: string) => void
  onArchiveItem?: (item: KanbanItem) => void
  onDeleteItem?: (item: KanbanItem) => void
  onOpenSubtask?: (sessionId: string) => void
  onOpenTaskFamily?: (item: KanbanItem) => void
  onRunTask?: (item: KanbanItem) => void
  onSetLabels?: (item: KanbanItem, labelIds: string[]) => void
  onChangeWorkflow?: (item: KanbanItem, workflow: TaskWorkflow) => void
  emptyState?: KanbanBoardEmptyStateView | null
  /** 项目自定义列的编辑入口（仅聚焦单个 Project 时由容器传入） */
  onAddColumn?: () => void
  onUpdateColumn?: (columnId: string, patch: Partial<KanbanColumnDef>) => void
  onRemoveColumn?: (columnId: string) => void
}

function dropColumnId(event: DragEndEvent): string | null {
  const value: unknown = event.over?.data.current?.columnId
  return typeof value === 'string' ? value : null
}

export function KanbanBoard({ items, mode, workflowFilter, columns, onMove, onOpenItem, onEditItem, onRenameItem, onArchiveItem, onDeleteItem, onOpenSubtask, onOpenTaskFamily, onRunTask, onSetLabels, onChangeWorkflow, emptyState, onAddColumn, onUpdateColumn, onRemoveColumn }: KanbanBoardProps): React.ReactElement {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  )
  const model = buildKanbanBoardModel(items, columns)
  const activeColumns = workflowFilter === 'cancelled'
    ? [{ id: 'done', name: '已取消', color: '#94a3b8' }]
    : columns
  const activeModel = buildKanbanBoardModel(activeBoardItems(items, workflowFilter), activeColumns)
  const handleDragEnd = (event: DragEndEvent): void => {
    const columnId = dropColumnId(event)
    if (!columnId) return
    const item = items.find((candidate) => candidate.id === String(event.active.id))
    if (!item || item.columnId === columnId) return
    onMove(item.id, columnId)
  }

  if ((mode === 'list' ? model.listItems.length : activeModel.listItems.length) === 0 && emptyState) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center rounded-2xl border border-dashed border-border/60 bg-muted/20 p-8 text-center">
        <div>
          <p className="text-sm font-medium">{emptyState.title}</p>
          <button type="button" onClick={emptyState.onAction} className="mt-3 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90">
            {emptyState.actionLabel}
          </button>
        </div>
      </div>
    )
  }

  if (mode === 'list') {
    return (
      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border/40 bg-card/40">
        {model.listItems.length > 0 ? (
          <>
            <div className="sticky top-0 z-10 grid min-w-[820px] grid-cols-[minmax(220px,2fr)_minmax(110px,1fr)_100px_minmax(140px,1fr)_80px_90px_36px] gap-3 border-b border-border/50 bg-background/95 px-3 py-2 text-[11px] font-medium text-muted-foreground backdrop-blur">
              <span>任务</span><span>归属</span><span>状态</span><span>Labels</span><span>进度</span><span>更新</span><span />
            </div>
            {model.listItems.map((item) => (
              <TaskListRow
                key={item.id}
                item={item}
                onOpen={onOpenItem}
                onEdit={onEditItem}
                onRename={onRenameItem}
                onArchive={onArchiveItem}
                onRequestDelete={onDeleteItem}
                onRunTask={onRunTask}
                onSetLabels={onSetLabels}
                onChangeWorkflow={onChangeWorkflow}
              />
            ))}
          </>
        ) : null}
      </div>
    )
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto pb-3">
        {activeModel.columns.map((column) => (
          <KanbanColumn
            key={column.id}
            column={column}
            onOpenItem={onOpenItem}
            onEditItem={onEditItem}
            onRenameItem={onRenameItem}
            onArchiveItem={onArchiveItem}
            onDeleteItem={onDeleteItem}
            onOpenSubtask={onOpenSubtask}
            onOpenTaskFamily={onOpenTaskFamily}
            onRunTask={onRunTask}
            onSetLabels={onSetLabels}
            onChangeWorkflow={onChangeWorkflow}
            onUpdateColumn={onUpdateColumn}
            onRemoveColumn={activeModel.columns.length > 1 ? onRemoveColumn : undefined}
          />
        ))}
        {onAddColumn ? (
          <button
            type="button"
            data-no-dnd="true"
            onClick={onAddColumn}
            title="新增列"
            aria-label="新增列"
            className="flex min-h-[64px] w-[180px] shrink-0 items-center justify-center gap-1.5 self-start rounded-2xl border border-dashed border-border/60 text-sm text-muted-foreground transition-colors hover:border-foreground/25 hover:bg-muted/50 hover:text-foreground"
          >
            <Plus className="h-4 w-4" />
            新增列
          </button>
        ) : null}
      </div>
    </DndContext>
  )
}
