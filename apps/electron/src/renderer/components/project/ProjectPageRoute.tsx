import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { agentWorkspacesAtom } from '@/atoms/agent-atoms'
import {
  activeProjectPageIdAtom,
  codeMainViewAtom,
} from '@/atoms/project-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { serverTaskSummariesAtom } from '@/atoms/kanban-atoms'
import { Button } from '@/components/ui/button'
import { buildTaskBoardNavigation } from '@/components/app-shell/code-main-view-model'
import { ProjectPage } from './ProjectPage'

/** 工作区详情页路由（项目=工作区）：按 activeProjectPageId（workspaceId）解析当前工作区 */
export function ProjectPageRoute(): React.ReactElement {
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const pageWorkspaceId = useAtomValue(activeProjectPageIdAtom)
  const setCodeMainView = useSetAtom(codeMainViewAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const setTaskSummaries = useSetAtom(serverTaskSummariesAtom)
  const [workspaceRoot, setWorkspaceRoot] = React.useState<string | null>(null)
  const [taskSummariesLoaded, setTaskSummariesLoaded] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // 页面目标工作区：优先 activeProjectPageId（workspaceId），回退当前工作区
  const workspace = workspaces.find((candidate) => candidate.id === pageWorkspaceId)
    ?? workspaces[0]
    ?? null

  const openTaskBoard = React.useCallback((): void => {
    const navigation = buildTaskBoardNavigation(null)
    setCodeMainView(navigation.codeMainView)
    setActiveView(navigation.activeView)
  }, [setActiveView, setCodeMainView])

  React.useEffect(() => {
    let cancelled = false
    setWorkspaceRoot(null)
    setTaskSummariesLoaded(false)
    setTaskSummaries(undefined)
    setError(null)
    if (!workspace) return () => { cancelled = true }

    void window.electronAPI.getWorkspaceRootPath(workspace.slug)
      .then(async (root) => {
        const summaries = await window.electronAPI.tasks.listSummaries(root, workspace.id)
        if (!cancelled) {
          setTaskSummaries(summaries)
          setTaskSummariesLoaded(true)
          setWorkspaceRoot(root)
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })

    return () => { cancelled = true }
  }, [setTaskSummaries, workspace])

  if (!workspace) {
    return (
      <div className="grid h-full place-items-center bg-background p-6">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">暂无工作区。</p>
          <Button className="mt-3" size="sm" onClick={openTaskBoard}>返回看板</Button>
        </div>
      </div>
    )
  }

  if (!workspaceRoot || !taskSummariesLoaded) {
    return (
      <div className="grid h-full place-items-center bg-background p-6 text-sm text-muted-foreground">
        {error ? `加载工作区失败：${error}` : '正在加载工作区…'}
      </div>
    )
  }

  return (
    <ProjectPage
      workspaceRoot={workspaceRoot}
      workspace={workspace}
      onWorkspaceChanged={() => { /* workspace atom 由上层刷新，无需本地投影 */ }}
    />
  )
}
