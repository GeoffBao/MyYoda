import * as React from 'react'
import { useAtomValue } from 'jotai'
import { ExternalLink } from 'lucide-react'
import { agentSessionsAtom } from '@/atoms/agent-atoms'
import { useOpenSession } from '@/hooks/useOpenSession'
import type { KanbanProject } from '@/components/app-shell/kanban/types'

interface ProjectSessionsTabProps {
  workspaceRoot: string
  project: KanbanProject
  onError: (message: string | null) => void
  onOpenTasks: () => void
}

export function ProjectSessionsTab({ workspaceRoot: _workspaceRoot, project, onError: _onError, onOpenTasks }: ProjectSessionsTabProps): React.ReactElement {
  const sessions = useAtomValue(agentSessionsAtom)
  const openSession = useOpenSession()

  const projectSessions = React.useMemo(
    () => sessions
      .filter((s) => s.projectId === project.id && !s.archived && !s.parentSessionId && !s.taskDraft)
      .sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions, project.id],
  )

  return (
    <div className="space-y-4 p-4">
      <div className="rounded-xl border border-border/40 bg-muted/20 p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Project Sessions</h2>
            <p className="text-xs text-muted-foreground">
              {projectSessions.length} 个活跃会话
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenTasks}
            className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
          >
            <ExternalLink className="h-3 w-3" />
            查看 Tasks
          </button>
        </div>
        {projectSessions.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">暂无项目会话</p>
        ) : (
          <div className="space-y-0.5">
            {projectSessions.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => openSession('agent', session.id, session.title)}
                className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/50"
              >
                <span className="truncate">{session.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {new Date(session.updatedAt).toLocaleDateString()}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
