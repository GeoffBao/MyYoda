/**
 * AgentHeader — Agent 会话头部
 *
 * 复用 SessionHeader；重命名时同步更新 Tab 标题和会话列表的新鲜度排序。
 * 若会话绑定了工作区，在标题旁显示工作区名 badge（含颜色圆点）。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { GitBranch, Layers, Pencil } from 'lucide-react'
import { agentSessionsAtom } from '@/atoms/agent-atoms'
import { tabsAtom, updateTabTitle } from '@/atoms/tab-atoms'
import { serverKanbanProjectsAtom, codeMainViewAtom, pendingTaskEditorTargetAtom } from '@/atoms/project-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { replaceAgentSessionInFreshnessOrder } from '@/lib/agent-session-list'
import { SessionHeader } from '@/components/tabs/SessionHeader'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatSessionGitBadge } from '@/components/agent/git-context-picker-model'

interface AgentHeaderProps {
  sessionId: string
}

export function AgentHeader({ sessionId }: AgentHeaderProps): React.ReactElement | null {
  const sessions = useAtomValue(agentSessionsAtom)
  const session = sessions.find((s) => s.id === sessionId) ?? null
  const setAgentSessions = useSetAtom(agentSessionsAtom)
  const setTabs = useSetAtom(tabsAtom)
  const projects = useAtomValue(serverKanbanProjectsAtom)
  const setPendingTaskEditorTarget = useSetAtom(pendingTaskEditorTargetAtom)
  const setCodeMainView = useSetAtom(codeMainViewAtom)
  const setActiveView = useSetAtom(activeViewAtom)

  if (!session) return null

  const project = session.projectId
    ? projects.find((p) => p.id === session.projectId) ?? null
    : null
  const gitBadgeText = formatSessionGitBadge(session)

  const handleRename = async (title: string): Promise<void> => {
    const updated = await window.electronAPI.updateAgentSessionTitle(session.id, title)
    setTabs((prev) => updateTabTitle(prev, updated.id, updated.title))
    setAgentSessions((prev) => replaceAgentSessionInFreshnessOrder(prev, updated))
  }

  // 任务编排会话（有 taskSlug 且非子任务）在 header 提供「编辑任务」入口——
  // 对齐 craft 真实做法：点击跳转看板打开该任务的完整 TaskEditor，
  // 而不是像之前那样在对话区常驻一张编排进度卡片（那是误移植了 craft 的 playground 演示组件）。
  const isTaskOrchestrator = !!session.taskSlug && !session.parentSessionId
  const handleEditTask = (): void => {
    if (!session.taskSlug) return
    setPendingTaskEditorTarget({ mode: 'edit', sessionId: session.id, taskSlug: session.taskSlug })
    setCodeMainView('tasks')
    setActiveView('conversations')
  }

  return (
    <SessionHeader
      title={session.title}
      onRename={handleRename}
      breadcrumb={project
        ? (
          <span className="flex min-w-0 items-center gap-1 truncate" title={project.workingDirectory}>
            {project.color && (
              <span
                className="inline-block size-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: project.color }}
              />
            )}
            <span className="truncate">{project.name}</span>
            {project.workingDirectory ? (
              <>
                <span className="shrink-0 text-muted-foreground/35">·</span>
                <span className="truncate text-muted-foreground/70">{project.workingDirectory}</span>
              </>
            ) : null}
          </span>
        )
        : undefined}
      badge={gitBadgeText
        ? (
          <>
            {gitBadgeText && <GitContextBadge text={gitBadgeText} worktree={session.gitExecutionMode === 'worktree'} />}
          </>
        )
        : undefined}
      actions={
        isTaskOrchestrator
          ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={handleEditTask}
                >
                  <Pencil className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom"><p>编辑任务</p></TooltipContent>
            </Tooltip>
          )
          : undefined
      }
    />
  )
}

/** 标题旁的 Git 执行上下文标签（Local/Worktree · 分支名），会话开始对话后仍持续可见 */
function GitContextBadge({ text, worktree }: { text: string; worktree: boolean }): React.ReactElement {
  const Icon = worktree ? Layers : GitBranch
  return (
    <span
      className="titlebar-no-drag shrink-0 inline-flex items-center gap-1 px-1.5 py-0 rounded-full bg-muted/60 text-muted-foreground text-[10px] leading-4 font-medium truncate max-w-[160px]"
      title={text}
    >
      <Icon className="size-2.5 shrink-0" />
      {text}
    </span>
  )
}
