import { FolderKanban } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { KanbanProject, TaskBoardScopeFilter } from './types'

interface KanbanProjectFilterProps {
  projects: KanbanProject[]
  value: TaskBoardScopeFilter
  onChange: (value: TaskBoardScopeFilter) => void
  /** 当前工作区名称（展示在「工作区」选项后；不传则只显示「工作区」） */
  workspaceName?: string
  className?: string
}

const ALL = '__all__'
const WORKSPACE = '__workspace__'

function scopeValue(scope: TaskBoardScopeFilter): string {
  if (scope.kind === 'all') return ALL
  if (scope.kind === 'workspace') return WORKSPACE
  return scope.projectId
}

/** Project 是 Task Board scope facet，而不是看板的强制父级。新模型下默认「当前工作区」；
 * 存量 KanbanProject 兼容保留为只读筛选维度（新建项目/工作区走侧栏与设置的正规入口）。 */
export function KanbanProjectFilter({
  projects,
  value,
  onChange,
  workspaceName,
  className,
}: KanbanProjectFilterProps): React.ReactElement {
  return (
    <label className={cn('flex min-w-0 items-center gap-2 text-xs text-muted-foreground', className)}>
      <FolderKanban className="h-4 w-4 shrink-0" />
      <select
        aria-label="筛选任务归属"
        value={scopeValue(value)}
        onChange={(event) => {
          const next = event.target.value
          if (next === ALL) onChange({ kind: 'all' })
          else if (next === WORKSPACE) onChange({ kind: 'workspace' })
          else onChange({ kind: 'project', projectId: next })
        }}
        className="h-8 min-w-0 max-w-52 rounded-lg border border-border/60 bg-card px-2 text-xs text-foreground shadow-sm outline-none focus:border-ring"
      >
        <option value={WORKSPACE}>{workspaceName ? `工作区（${workspaceName}）` : '当前工作区'}</option>
        <option value={ALL}>全部任务</option>
        {projects.filter((project) => !project.archivedAt).map((project) => (
          <option key={project.id} value={project.id}>{project.name}</option>
        ))}
      </select>
    </label>
  )
}
