import { useDroppable } from '@dnd-kit/core'
import { cn } from '@/lib/utils'
import { resolveKanbanColumnColor } from './kanban-colors'
import { KanbanColumnEditorPopover } from './KanbanColumnEditorPopover'
import { TaskTile } from './TaskTile'
import type { KanbanBoardColumn } from './board-model'
import type { KanbanColumnDef } from '@myyoda/shared/projects'
import type { TaskWorkflow } from '@myyoda/shared/tasks'
import type { KanbanItem } from './types'

interface KanbanColumnProps {
  column: KanbanBoardColumn
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
  /** 项目自定义列的编辑入口（仅聚焦单个 Project 时由容器传入） */
  onUpdateColumn?: (columnId: string, patch: Partial<KanbanColumnDef>) => void
  onRemoveColumn?: (columnId: string) => void
}

export function KanbanColumn({ column, onOpenItem, onEditItem, onRenameItem, onArchiveItem, onDeleteItem, onOpenSubtask, onOpenTaskFamily, onRunTask, onSetLabels, onChangeWorkflow, onUpdateColumn, onRemoveColumn }: KanbanColumnProps): React.ReactElement {
  const drop = useDroppable({ id: `column:${column.id}`, data: { columnId: column.id } })
  const color = resolveKanbanColumnColor(column.id, column.color)
  return (
    <section
      ref={drop.setNodeRef}
      className={cn('flex w-[min(82vw,290px)] min-w-[260px] shrink-0 flex-col rounded-2xl bg-muted/45 p-3 transition-colors xl:w-auto xl:flex-1', drop.isOver && 'bg-primary/10')}
    >
      <header className="sticky top-0 z-[1] mb-3 flex items-center gap-2 rounded-lg bg-muted/90 px-1 py-1 backdrop-blur">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
        {onUpdateColumn ? (
          <KanbanColumnEditorPopover
            column={column}
            onRename={(name) => onUpdateColumn(column.id, { name })}
            onSetColor={(nextColor) => onUpdateColumn(column.id, { color: nextColor })}
            onSelectDropStatus={(status) => onUpdateColumn(column.id, { dropStatusId: status })}
            onRemove={onRemoveColumn ? () => onRemoveColumn(column.id) : undefined}
          />
        ) : (
          <h2 className="text-sm font-medium">{column.name}</h2>
        )}
        <span className="ml-auto rounded-full bg-background/80 px-2 py-0.5 text-[11px] text-muted-foreground">{column.items.length}</span>
      </header>
      <div className="space-y-3">
        {column.items.map((item) => (
          <TaskTile
            key={item.id}
            item={item}
            accent={color}
            onOpen={onOpenItem}
            onEdit={onEditItem}
            onRename={onRenameItem}
            onArchive={onArchiveItem}
            onRequestDelete={onDeleteItem}
            onOpenSubtask={onOpenSubtask}
            onOpenTaskFamily={onOpenTaskFamily}
            onRunTask={onRunTask}
            onSetLabels={onSetLabels}
            onChangeWorkflow={onChangeWorkflow}
          />
        ))}
        {column.items.length === 0 && <div className="rounded-xl border border-dashed border-border/60 px-3 py-8 text-center text-xs text-muted-foreground">暂无任务</div>}
      </div>
    </section>
  )
}
