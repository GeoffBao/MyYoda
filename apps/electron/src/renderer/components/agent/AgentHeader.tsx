/**
 * AgentHeader — Agent 会话头部
 *
 * 复用 SessionHeader；重命名时同步更新 Tab 标题和会话列表的新鲜度排序。
 * 标题上方常驻面包屑：会话绑定了项目时显示项目名 + 工作目录；未绑定项目时回退显示
 * 所属工作区名 + 工作区文件目录，保证任意会话都能一眼看出「属于哪、在哪个地址」。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { GitBranch, Layers, Pencil } from 'lucide-react'
import { agentSessionsAtom, agentWorkspacesAtom } from '@/atoms/agent-atoms'
import { tabsAtom, updateTabTitle } from '@/atoms/tab-atoms'
import { serverKanbanProjectsAtom, codeMainViewAtom, pendingTaskEditorTargetAtom } from '@/atoms/project-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { replaceAgentSessionInFreshnessOrder } from '@/lib/agent-session-list'
import { SessionHeader } from '@/components/tabs/SessionHeader'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatSessionGitBadge } from '@/components/agent/git-context-picker-model'
import { useSessionGitBranchSync } from '@/hooks/useSessionGitBranchSync'

interface AgentHeaderProps {
  sessionId: string
}

/** 根据工作区 slug 异步取工作区文件目录绝对路径（~/.myyoda/agent-workspaces/{slug}/workspace-files），
 * 仅用于未绑定项目的会话头部面包屑回退显示。slug 变化时重新拉取，切换前不残留旧值。 */
function useWorkspaceFilesPath(workspaceSlug: string | undefined): string | null {
  const [path, setPath] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!workspaceSlug) {
      setPath(null)
      return
    }
    let cancelled = false
    setPath(null)
    window.electronAPI.getWorkspaceFilesPath(workspaceSlug)
      .then((resolved) => { if (!cancelled) setPath(resolved) })
      .catch((error) => { console.error('[AgentHeader] 获取工作区文件目录失败:', error) })
    return () => { cancelled = true }
  }, [workspaceSlug])

  return path
}

export function AgentHeader({ sessionId }: AgentHeaderProps): React.ReactElement | null {
  const sessions = useAtomValue(agentSessionsAtom)
  const session = sessions.find((s) => s.id === sessionId) ?? null
  const setAgentSessions = useSetAtom(agentSessionsAtom)
  const setTabs = useSetAtom(tabsAtom)
  const projects = useAtomValue(serverKanbanProjectsAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const setPendingTaskEditorTarget = useSetAtom(pendingTaskEditorTargetAtom)
  const setCodeMainView = useSetAtom(codeMainViewAtom)
  const setActiveView = useSetAtom(activeViewAtom)

  // 会话头部徽章只读 session.gitBranch（持久化静态值），若 Agent 绕过 UI 直接用 Bash 改动
  // 仓库分支会与实际状态漂移且无法自愈；挂载/窗口聚焦时静默核对并回写。
  useSessionGitBranchSync(session)

  const project = session?.projectId
    ? projects.find((p) => p.id === session.projectId) ?? null
    : null
  const workspace = !project && session?.workspaceId
    ? workspaces.find((w) => w.id === session.workspaceId) ?? null
    : null
  const workspacePath = useWorkspaceFilesPath(workspace?.slug)

  if (!session) return null

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
        : workspace
          ? (
            <span className="flex min-w-0 items-center gap-1 truncate" title={workspacePath ?? undefined}>
              <span className="truncate">{workspace.name}</span>
              {workspacePath ? (
                <>
                  <span className="shrink-0 text-muted-foreground/35">·</span>
                  <span className="truncate text-muted-foreground/70">{workspacePath}</span>
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
