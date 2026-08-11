import * as React from 'react'
import { useAtomValue } from 'jotai'
import { ArrowRight, Bot, FolderOpen, ListChecks, MessageSquare } from 'lucide-react'
import { agentSessionsAtom } from '@/atoms/agent-atoms'
import { serverTaskSummariesAtom } from '@/atoms/kanban-atoms'
import { Button } from '@/components/ui/button'
import type { KanbanProject } from '@/components/app-shell/kanban/types'

interface ProjectOverviewTabProps {
  project: KanbanProject
  onOpenTasks: () => void
}

function Stat({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: number | string }): React.ReactElement {
  return (
    <div className="rounded-xl border border-border/40 bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="h-4 w-4" />{label}</div>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  )
}

export function ProjectOverviewTab({ project, onOpenTasks }: ProjectOverviewTabProps): React.ReactElement {
  const tasks = useAtomValue(serverTaskSummariesAtom) ?? []
  const sessions = useAtomValue(agentSessionsAtom)
  const projectTasks = tasks.filter((task) => task.scope.kind === 'project' && task.scope.projectId === project.id)
  const projectSessions = sessions.filter((session) => session.projectId === project.id && !session.taskDraft)
  const activeTasks = projectTasks.filter((task) => task.workflow !== 'done' && task.workflow !== 'cancelled').length

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-5">
      <section className="rounded-2xl border border-border/40 bg-gradient-to-br from-card to-muted/30 p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: project.color ?? 'hsl(var(--muted-foreground))' }} />
              <h2 className="truncate text-xl font-semibold">{project.name}</h2>
            </div>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{project.description || '尚未添加项目描述。'}</p>
          </div>
          <Button size="sm" onClick={onOpenTasks}>查看任务<ArrowRight className="ml-1 h-4 w-4" /></Button>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat icon={ListChecks} label="全部 Task" value={projectTasks.length} />
        <Stat icon={Bot} label="活跃 Task" value={activeTasks} />
        <Stat icon={MessageSquare} label="关联会话" value={projectSessions.length} />
      </div>

      <section className="rounded-xl border border-border/40 bg-card p-4 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-semibold"><FolderOpen className="h-4 w-4" />工作目录</div>
        <p className="mt-2 break-all rounded-lg bg-muted/40 px-3 py-2 font-mono text-xs text-muted-foreground">
          {project.workingDirectory || '使用 Workspace 托管目录'}
        </p>
        {project.defaultExpertId ? <p className="mt-3 text-xs text-muted-foreground">默认专家：{project.defaultExpertId}</p> : null}
      </section>
    </div>
  )
}
