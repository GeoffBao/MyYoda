import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai'
import { FolderKanban } from 'lucide-react'
import { toast } from 'sonner'
import {
  agentSessionsAtom,
  agentStreamingStatesAtom,
  agentWorkspacesAtom,
  currentAgentWorkspaceIdAtom,
} from '@/atoms/agent-atoms'
import {
  kanbanItemsAtom,
  kanbanSpecNodesAtom,
  kanbanTaskExpertIdsAtom,
  serverKanbanRunsAtom,
  serverKanbanSessionsAtom,
  serverTaskSummariesAtom,
  serverTeambitionBindingsAtom,
} from '@/atoms/kanban-atoms'
import {
  selectedProjectIdAtom,
  serverKanbanProjectsAtom,
} from '@/atoms/project-atoms'
import { KanbanBoardContainer } from '@/components/app-shell/kanban/KanbanBoardContainer'
import type { SpecNodeSummary } from '@/components/app-shell/kanban/subtask-merge'
import type { KanbanItem, KanbanTaskRun } from '@/components/app-shell/kanban/types'
import { useOpenSession } from '@/hooks/useOpenSession'
import { buildKanbanTaskRun } from './work-board-model'
import { matchesWorkspaceLoad, type WorkspaceLoadIdentity } from './work-board-load-guard'

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export function WorkBoardView(): React.ReactElement {
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const workspace = workspaces.find((candidate) => candidate.id === currentWorkspaceId) ?? workspaces[0] ?? null
  const [agentSessions, setAgentSessions] = useAtom(agentSessionsAtom)
  const [projects, setProjects] = useAtom(serverKanbanProjectsAtom)
  const [selectedProjectId, setSelectedProjectId] = useAtom(selectedProjectIdAtom)
  const setSessions = useSetAtom(serverKanbanSessionsAtom)
  const [taskSummaries, setTaskSummaries] = useAtom(serverTaskSummariesAtom)
  const setRuns = useSetAtom(serverKanbanRunsAtom)
  const setBindings = useSetAtom(serverTeambitionBindingsAtom)
  const setSpecNodes = useSetAtom(kanbanSpecNodesAtom)
  const setTaskExpertIds = useSetAtom(kanbanTaskExpertIdsAtom)
  const kanbanItems = useAtomValue(kanbanItemsAtom)
  const streamStates = useAtomValue(agentStreamingStatesAtom)
  const openSession = useOpenSession()
  const store = useStore()
  const [workspaceRoot, setWorkspaceRoot] = React.useState<string | null>(null)
  const activeWorkspaceLoadRef = React.useRef<WorkspaceLoadIdentity | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  // 跟踪上一次的 workspace id，避免 onWorkspaceFilesChanged 产生新引用但同一工作区时重置全部状态
  const prevWorkspaceIdRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    setSessions(agentSessions)
  }, [agentSessions, setSessions])

  React.useEffect(() => {
    let cancelled = false
    const generation = (activeWorkspaceLoadRef.current?.generation ?? 0) + 1
    activeWorkspaceLoadRef.current = workspace
      ? { generation, workspaceId: workspace.id, root: null }
      : null
    // 同一工作区（id 未变）不重置状态，避免 onWorkspaceFilesChanged 产生新对象引用导致 KanbanBoardContainer 重载
    const workspaceChanged = prevWorkspaceIdRef.current !== (workspace?.id ?? null)
    prevWorkspaceIdRef.current = workspace?.id ?? null
    if (workspaceChanged) {
      // 项目 atom 的生命周期由全局 ProjectsInitializer 管理（工作区切换时按 slug 重载），WorkBoardView 不再清空。
      // selectedProjectId 只表示 Task Board 的 Project facet；Project Page 使用独立页面身份。
      setRuns([])
      setTaskSummaries([])
      setBindings([])
      setSpecNodes(new Map())
      setTaskExpertIds(new Map())
      setWorkspaceRoot(null)
      setError(null)
    }
    if (!workspace) return () => { cancelled = true }

    setLoading(true)
    void window.electronAPI.getWorkspaceRootPath(workspace.slug)
      .then((root) => {
        if (!cancelled && activeWorkspaceLoadRef.current?.generation === generation) {
          activeWorkspaceLoadRef.current = { generation, workspaceId: workspace.id, root }
          setWorkspaceRoot(root)
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(`加载工作区失败：${errorMessage(cause)}`)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [setBindings, setRuns, setSpecNodes, setTaskExpertIds, setTaskSummaries, workspace])

  const captureWorkspaceLoad = React.useCallback((): WorkspaceLoadIdentity | null => {
    const active = activeWorkspaceLoadRef.current
    return active?.root ? { ...active } : null
  }, [])

  const isCurrentWorkspaceLoad = React.useCallback((expected: WorkspaceLoadIdentity): boolean => {
    return matchesWorkspaceLoad(activeWorkspaceLoadRef.current, expected)
  }, [])

  const refreshSessions = React.useCallback(async (): Promise<void> => {
    const sessions = await window.electronAPI.listAgentSessions()
    setAgentSessions(sessions)
  }, [setAgentSessions])

  const refreshProjects = React.useCallback(async (): Promise<void> => {
    if (!workspaceRoot) return
    const load = captureWorkspaceLoad()
    if (!load?.root) return
    const nextProjects = await window.electronAPI.projects.list(load.root)
    if (isCurrentWorkspaceLoad(load)) setProjects(nextProjects)
  }, [captureWorkspaceLoad, isCurrentWorkspaceLoad, setProjects, workspaceRoot])

  const refreshTasks = React.useCallback(async (): Promise<void> => {
    if (!workspaceRoot || !workspace) return
    const load = captureWorkspaceLoad()
    if (!load?.root || load.workspaceId !== workspace.id) return
    const summaries = await window.electronAPI.tasks.listSummaries(load.root, load.workspaceId)
    if (isCurrentWorkspaceLoad(load)) setTaskSummaries(summaries)
  }, [captureWorkspaceLoad, isCurrentWorkspaceLoad, setTaskSummaries, workspace, workspaceRoot])

  React.useEffect(() => {
    if (!selectedProjectId || projects.some((project) => project.id === selectedProjectId && !project.archivedAt)) return
    setSelectedProjectId(null)
  }, [projects, selectedProjectId, setSelectedProjectId])

  const refreshRuns = React.useCallback(async (): Promise<void> => {
    if (!workspaceRoot) return
    const load = captureWorkspaceLoad()
    if (!load?.root) return
    const taskRefs = new Map<string, { slug: string; runId?: string }>()
    for (const task of taskSummaries ?? []) {
      const linkedSession = task.orchestratorSessionId
        ? agentSessions.find((session) => session.id === task.orchestratorSessionId)
        : agentSessions.find((session) => session.taskSlug === task.taskSlug && !session.parentSessionId)
      const runId = linkedSession?.taskRunId
      const key = `${task.taskSlug}:${runId ?? ''}`
      taskRefs.set(key, { slug: task.taskSlug, ...(runId ? { runId } : {}) })
    }

    const runs = await Promise.all(Array.from(taskRefs.values()).map(async ({ slug, runId }) => {
      const results = await window.electronAPI.tasks.getResults(load.root!, slug, runId)
      return results ? buildKanbanTaskRun(slug, results) : null
    }))
    if (isCurrentWorkspaceLoad(load)) setRuns(runs.filter((run): run is KanbanTaskRun => run !== null))
  }, [agentSessions, captureWorkspaceLoad, isCurrentWorkspaceLoad, setRuns, taskSummaries, workspaceRoot])

  const refreshSpecNodes = React.useCallback(async (): Promise<void> => {
    if (!workspaceRoot) return
    const load = captureWorkspaceLoad()
    if (!load?.root) return
    const slugs = (taskSummaries ?? []).map((task) => task.taskSlug)
    const results = await Promise.all(slugs.map(async (slug) => {
      try {
        const validation = await window.electronAPI.tasks.get(load.root!, slug)
        if (!validation?.valid || !validation.spec?.nodes) {
          return { slug, nodes: [] as SpecNodeSummary[], expertId: undefined as string | undefined }
        }
        const nodes: SpecNodeSummary[] = validation.spec.nodes.map((node) => ({
          id: node.id,
          title: node.title ?? node.id,
          ...(node.model ? { model: node.model } : {}),
        }))
        const expertId = validation.spec.defaults?.expertId?.trim() || undefined
        return { slug, nodes, expertId }
      } catch {
        return { slug, nodes: [] as SpecNodeSummary[], expertId: undefined as string | undefined }
      }
    }))
    if (!isCurrentWorkspaceLoad(load)) return
    setSpecNodes(new Map(results.map((entry) => [entry.slug, entry.nodes])))
    setTaskExpertIds(new Map(
      results
        .filter((entry): entry is typeof entry & { expertId: string } => Boolean(entry.expertId))
        .map((entry) => [entry.slug, entry.expertId]),
    ))
  }, [captureWorkspaceLoad, isCurrentWorkspaceLoad, setSpecNodes, setTaskExpertIds, taskSummaries, workspaceRoot])

  const refreshBindings = React.useCallback(async (): Promise<void> => {
    if (!workspaceRoot) return
    const load = captureWorkspaceLoad()
    if (!load?.root) return
    const bindings = await window.electronAPI.teambition.listBindings(load.root)
    if (!isCurrentWorkspaceLoad(load)) return
    setBindings(bindings.map((binding) => ({
      bindingId: binding.id,
      sessionId: binding.sessionId,
      taskId: binding.remoteTaskId,
      title: binding.remoteTitle,
      ...(binding.remoteStatus ? { status: binding.remoteStatus } : {}),
      syncState: binding.syncState,
      ...(binding.error ? { error: binding.error } : {}),
    })))
  }, [captureWorkspaceLoad, isCurrentWorkspaceLoad, setBindings, workspaceRoot])

  const refreshAll = React.useCallback(async (): Promise<void> => {
    await Promise.all([refreshSessions(), refreshTasks()])
    await Promise.all([refreshProjects(), refreshRuns(), refreshBindings(), refreshSpecNodes()])
  }, [refreshBindings, refreshProjects, refreshRuns, refreshSessions, refreshSpecNodes, refreshTasks])

  // Conductor 派生子会话时主进程不会主动推列表；运行中短轮询保持卡片/进度实时
  const needsLivePoll = kanbanItems.some((item) => item.isProcessing)
    || [...streamStates.values()].some((state) => state.running)
  React.useEffect(() => {
    if (!workspaceRoot || !needsLivePoll) return
    const timer = window.setInterval(() => {
      void refreshSessions().then(() => Promise.all([refreshRuns(), refreshSpecNodes(), refreshTasks()]))
    }, 2000)
    return () => window.clearInterval(timer)
  }, [needsLivePoll, refreshRuns, refreshSessions, refreshSpecNodes, refreshTasks, workspaceRoot])

  // 最后一个 stream 结束时补一次收口读取，确保 Run 将 workflow 推到 needs-review 后立即反映。
  const previousLivePollRef = React.useRef(false)
  React.useEffect(() => {
    const wasLive = previousLivePollRef.current
    previousLivePollRef.current = needsLivePoll
    if (!workspaceRoot || !wasLive || needsLivePoll) return
    void Promise.all([refreshSessions(), refreshTasks(), refreshRuns(), refreshSpecNodes()])
  }, [needsLivePoll, refreshRuns, refreshSessions, refreshSpecNodes, refreshTasks, workspaceRoot])

  React.useEffect(() => {
    if (!workspaceRoot) return
    void refreshTasks().catch((cause: unknown) => {
      setError(`加载 Task 列表失败：${errorMessage(cause)}`)
    })
  }, [refreshTasks, workspaceRoot])

  React.useEffect(() => {
    if (!workspaceRoot) return
    void refreshRuns().catch((cause: unknown) => {
      setError(`加载任务进度失败：${errorMessage(cause)}`)
    })
  }, [refreshRuns, workspaceRoot])

  React.useEffect(() => {
    if (!workspaceRoot) return
    void refreshSpecNodes().catch((cause: unknown) => {
      setError(`加载任务定义失败：${errorMessage(cause)}`)
    })
  }, [refreshSpecNodes, workspaceRoot])

  React.useEffect(() => {
    if (!workspaceRoot) return
    void refreshBindings().catch((cause: unknown) => {
      setError(`加载 Teambition 绑定失败：${errorMessage(cause)}`)
    })
  }, [refreshBindings, workspaceRoot])

  // projects.onChanged 广播由全局 ProjectsInitializer 统一写入项目 atom，这里只处理任务生成事件
  React.useEffect(() => {
    if (!workspace) return
    const offGenerated = window.electronAPI.tasks.onGenerated((event) => {
      if (event.workspaceId === workspace.id) {
        void Promise.all([refreshSessions(), refreshTasks()])
          .then(() => Promise.all([refreshRuns(), refreshSpecNodes()]))
      }
    })
    return offGenerated
  }, [refreshRuns, refreshSessions, refreshSpecNodes, refreshTasks, workspace])

  const handleOpenItem = React.useCallback((item: KanbanItem): void => {
    const linkedSession = agentSessions.find((session) => session.id === item.session.id)
    if (!linkedSession) {
      toast.info('该 Task 暂无可打开的编排会话', {
        description: item.task?.health === 'error'
          ? '请先处理 Task 恢复诊断。'
          : 'Task 定义仍可在看板中管理。',
      })
      return
    }
    openSession('agent', linkedSession.id, linkedSession.title)
  }, [agentSessions, openSession])

  const handleOpenSubtask = React.useCallback((sessionId: string): void => {
    const session = agentSessions.find((candidate) => candidate.id === sessionId)
    if (session) openSession('agent', session.id, session.title)
  }, [agentSessions, openSession])

  const handleRefresh = async (): Promise<void> => {
    setError(null)
    setLoading(true)
    try {
      await refreshAll()
    } catch (cause) {
      setError(`刷新 Task 数据失败：${errorMessage(cause)}`)
    } finally {
      setLoading(false)
    }
  }

  if (!workspace) {
    return (
      <div className="grid h-full place-items-center bg-background p-6">
        <div className="max-w-sm text-center">
          <FolderKanban className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <h1 className="font-semibold">请先创建 Code 工作区</h1>
          <p className="mt-1 text-sm text-muted-foreground">Task 与 Project 数据按 Workspace 隔离。</p>
        </div>
      </div>
    )
  }

  if (!workspaceRoot) {
    return (
      <div className="grid h-full place-items-center bg-background p-6 text-sm text-muted-foreground">
        {loading ? '正在加载 Task 工作区…' : (error ?? '无法加载 Task 工作区')}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {error && (
          <div className="mb-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-hidden">
          <KanbanBoardContainer
            onOpenItem={handleOpenItem}
            onOpenSubtask={handleOpenSubtask}
            onSessionCreated={(session) => {
              setAgentSessions((current) => [session, ...current.filter((candidate) => candidate.id !== session.id)])
            }}
            onRefresh={handleRefresh}
            refreshing={loading}
            onTaskCreated={async (created) => {
              await refreshAll()
              if (!created?.ran || !created.sessionId) return
              const session = store.get(agentSessionsAtom).find((candidate) => candidate.id === created.sessionId)
              openSession(
                'agent',
                created.sessionId,
                session?.title ?? created.slug ?? '任务编排',
              )
            }}
          />
        </div>
      </div>
    </div>
  )
}
