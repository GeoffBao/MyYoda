import * as React from 'react'
import { useAtomValue } from 'jotai'
import { ArrowRight, Bot, FolderOpen, ListChecks, MessageSquare } from 'lucide-react'
import { agentSessionsAtom } from '@/atoms/agent-atoms'
import { serverTaskSummariesAtom } from '@/atoms/kanban-atoms'
import { Button } from '@/components/ui/button'
import type { AgentWorkspace } from '@myyoda/shared'
import { LocalProjectBadge } from '@/components/agent-skills/LocalProjectBadge'

interface ProjectOverviewTabProps {
  workspace: AgentWorkspace
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

/** 工作区概览（项目=工作区）：统计当前工作区的任务与会话 */
export function ProjectOverviewTab({ workspace, onOpenTasks }: ProjectOverviewTabProps): React.ReactElement {
  const tasks = useAtomValue(serverTaskSummariesAtom) ?? []
  const sessions = useAtomValue(agentSessionsAtom)
  const workspaceTasks = tasks.filter((task) => task.scope.kind === 'workspace')
  const workspaceSessions = sessions.filter((session) => session.workspaceId === workspace.id && !session.taskDraft)
  const activeTasks = workspaceTasks.filter((task) => task.workflow !== 'done' && task.workflow !== 'cancelled').length

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-5">
      <section className="rounded-2xl border border-border/40 bg-gradient-to-br from-card to-muted/30 p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-foreground/45" />
              <h2 className="truncate text-xl font-semibold">{workspace.name}</h2>
              {workspace.projectRootPath && (
                <LocalProjectBadge workingDirectory={workspace.projectRootPath} />
              )}
            </div>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              工作区即项目：会话、任务、记忆（AGENTS.md + memory/）、看板列都归属此工作区。
            </p>
          </div>
          <Button size="sm" onClick={onOpenTasks}>查看任务<ArrowRight className="ml-1 h-4 w-4" /></Button>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat icon={ListChecks} label="全部 Task" value={workspaceTasks.length} />
        <Stat icon={Bot} label="活跃 Task" value={activeTasks} />
        <Stat icon={MessageSquare} label="关联会话" value={workspaceSessions.length} />
      </div>

      <section className="rounded-xl border border-border/40 bg-card p-4 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-semibold"><FolderOpen className="h-4 w-4" />工程目录</div>
        <p className="mt-2 break-all rounded-lg bg-muted/40 px-3 py-2 font-mono text-xs text-muted-foreground">
          {workspace.projectRootPath || '使用托管目录（workspace-files/）'}
        </p>
        {workspace.kanbanColumns?.length ? (
          <p className="mt-3 text-xs text-muted-foreground">看板列：{workspace.kanbanColumns.map((column) => column.name).join(' / ')}</p>
        ) : null}
      </section>
    </div>
  )
}
