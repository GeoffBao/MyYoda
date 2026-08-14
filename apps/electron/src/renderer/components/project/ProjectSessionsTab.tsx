import * as React from 'react'
import { useAtomValue } from 'jotai'
import { ExternalLink, MessageSquare } from 'lucide-react'
import { agentSessionsAtom } from '@/atoms/agent-atoms'
import { useOpenSession } from '@/hooks/useOpenSession'
import type { AgentWorkspace } from '@myyoda/shared'

interface ProjectSessionsTabProps {
  workspaceRoot: string
  workspace: AgentWorkspace
  onError: (message: string | null) => void
  onOpenTasks: () => void
}

/** 工作区会话列表（项目=工作区：会话归属工作区） */
export function ProjectSessionsTab({ workspaceRoot: _workspaceRoot, workspace, onError: _onError, onOpenTasks }: ProjectSessionsTabProps): React.ReactElement {
  const sessions = useAtomValue(agentSessionsAtom)
  const openSession = useOpenSession()

  const workspaceSessions = React.useMemo(
    () => sessions
      .filter((s) => s.workspaceId === workspace.id && !s.archived && !s.parentSessionId && !s.taskDraft)
      .sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions, workspace.id],
  )

  return (
    <div className="space-y-4 p-4">
      <div className="rounded-xl border border-border/40 bg-muted/20 p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">工作区会话</h2>
            <p className="text-xs text-muted-foreground">
              {workspaceSessions.length} 个活跃会话
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
        {workspaceSessions.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">暂无会话</p>
        ) : (
          <div className="space-y-0.5">
            {workspaceSessions.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => openSession('agent', session.id, session.title)}
                className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/50"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{session.title}</span>
                </span>
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
