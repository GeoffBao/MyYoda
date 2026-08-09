import type { AgentSessionMeta } from '@myyoda/shared'
import type { TaskAggregateSummary } from '@myyoda/shared/tasks'
import { resolveExpertId } from '@myyoda/shared/experts'
import { mergeSubtaskRows, type SpecNodeSummary, type SubtaskChildRow } from './subtask-merge'
import { deriveDefaultKanbanColumn } from './status-column'
import { resolveTaskBoardScope, taskMatchesBoardFilter } from './task-board-filter-model'
import {
  DEFAULT_KANBAN_COLUMN_ID,
  type KanbanFilter,
  type KanbanItem,
  type KanbanProject,
  type KanbanTaskRun,
  type KanbanViewModel,
  type SubtaskRunState,
  type TeambitionBinding,
} from './types'

export type {
  KanbanFilter,
  KanbanItem,
  KanbanProject,
  KanbanTaskRun,
  KanbanViewModel,
  TeambitionBinding,
} from './types'

export interface BuildKanbanViewModelInput {
  projects: KanbanProject[]
  sessions: AgentSessionMeta[]
  runs: KanbanTaskRun[]
  bindings: TeambitionBinding[]
  /** 有值时启用 TaskRepository-first 投影；空数组也表示不把普通顶层 Session 当成 Task。 */
  tasks?: TaskAggregateSummary[]
  filter: KanbanFilter
  /** taskSlug → DAG nodes；缺省时仅展示 child sessions */
  specNodesBySlug?: Map<string, SpecNodeSummary[]>
  /** taskSlug → TaskSpec.defaults.expertId */
  expertIdsBySlug?: Map<string, string>
  fallbackModel?: string
}

function findTaskRun(session: AgentSessionMeta, runs: KanbanTaskRun[]): KanbanTaskRun | undefined {
  if (!session.taskSlug) return undefined
  return runs.find((run) =>
    run.taskSlug === session.taskSlug && (session.taskRunId === undefined || run.runId === session.taskRunId),
  )
}

/** 对齐 craft：closed → done；needs-review 单独成态（勿与 failed 混成红叉）；用户中断 → failed。 */
export function deriveSubtaskRunState(child: AgentSessionMeta): SubtaskRunState {
  if (child.stoppedByUser) return 'failed'
  const status = child.sessionStatus
  if (status === 'done' || status === 'completed') return 'done'
  if (status === 'needs-review') return 'needs-review'
  if (status === 'failed') return 'failed'
  if (status === 'running' || status === 'in-progress' || status === 'queued') return 'running'
  return 'pending'
}

function runStateFromNode(state: string | undefined): SubtaskRunState {
  if (state === 'done') return 'done'
  if (state === 'failed' || state === 'cancelled') return 'failed'
  if (state === 'running') return 'running'
  return 'pending'
}

function buildItem(
  session: AgentSessionMeta,
  projectsById: Map<string, KanbanProject>,
  runs: KanbanTaskRun[],
  bindingsBySessionId: Map<string, TeambitionBinding>,
  children: SubtaskChildRow[],
  specNodes: SpecNodeSummary[] | undefined,
  fallbackModel: string,
  taskExpertId: string | undefined,
): KanbanItem {
  const run = findTaskRun(session, runs)
  const totalNodes = session.taskNodeCount
    ?? specNodes?.length
    ?? (run ? Object.keys(run.nodeStates).length : 0)
  const completedNodes = run
    ? Object.values(run.nodeStates).filter((state) => state === 'done').length
    : 0
  const binding = bindingsBySessionId.get(session.id)
  // 未绑定真实 Project 的会话（含历史存量）保持 project 为空，由 workspace scope
  // （{ kind: 'workspace' } → !session.projectId）承载「未绑定」语义，不再懒归类到隐藏容器。
  const project = session.projectId ? projectsById.get(session.projectId) ?? null : null
  const expertId = resolveExpertId(taskExpertId, project?.defaultExpertId) ?? undefined

  // 有 run 节点状态但还没 child session 时，用 nodeStates 合成行标题，避免卡片只有 0/N 进度条
  const nodesForMerge = specNodes?.length
    ? specNodes
    : run
      ? Object.keys(run.nodeStates).map((id) => ({
          id,
          title: id,
          model: fallbackModel,
        }))
      : undefined

  let subtasks = mergeSubtaskRows(nodesForMerge, children, fallbackModel)
  if (run && subtasks.length > 0) {
    subtasks = subtasks.map((row) => {
      const nodeId = row.id.startsWith('node:') ? row.id.slice(5) : children.find((c) => c.id === row.id)?.taskNodeId
      if (!nodeId || !(nodeId in run.nodeStates)) return row
      return { ...row, runState: runStateFromNode(run.nodeStates[nodeId]) }
    })
  }

  return {
    id: session.id,
    title: session.title,
    columnId: session.kanbanColumn ?? DEFAULT_KANBAN_COLUMN_ID,
    session,
    hasSession: true,
    project,
    subtasks,
    ...(expertId ? { expertId } : {}),
    ...(totalNodes > 0 ? { subtaskTotal: totalNodes } : {}),
    ...(run && totalNodes > 0 ? { taskRun: { completedNodes, totalNodes } } : {}),
    ...(binding
      ? {
          teambition: {
            ...(binding.bindingId ? { bindingId: binding.bindingId } : {}),
            taskId: binding.taskId,
            ...(binding.title ? { title: binding.title } : {}),
            ...(binding.status ? { status: binding.status } : {}),
            ...(binding.syncState ? { syncState: binding.syncState } : {}),
            ...(binding.error ? { error: binding.error } : {}),
          },
        }
      : {}),
  }
}

/**
 * 将服务端快照合并为纯渲染模型。排序只在这里发生，Board 与 List 共享同一顺序。
 */
export function buildKanbanViewModel(input: BuildKanbanViewModelInput): KanbanViewModel {
  const projectsById = new Map(input.projects.map((project) => [project.id, project]))
  const bindingsBySessionId = new Map(input.bindings.map((binding) => [binding.sessionId, binding]))
  const fallbackModel = input.fallbackModel ?? ''
  const childrenByParent = new Map<string, SubtaskChildRow[]>()
  for (const session of input.sessions) {
    if (!session.parentSessionId || session.archived || session.taskDraft) continue
    const row: SubtaskChildRow = {
      id: session.id,
      title: session.title,
      runState: deriveSubtaskRunState(session),
      model: session.modelId ?? fallbackModel,
      ...(session.taskNodeId ? { taskNodeId: session.taskNodeId } : {}),
      createdAt: session.createdAt,
    }
    const siblings = childrenByParent.get(session.parentSessionId)
    if (siblings) siblings.push(row)
    else childrenByParent.set(session.parentSessionId, [row])
  }

  const topLevelSessions = input.sessions.filter((session) =>
    !session.archived && !session.taskDraft && !session.parentSessionId,
  )

  const repositoryTasks = input.tasks
  if (repositoryTasks !== undefined) {
    const sessionsById = new Map(topLevelSessions.map((session) => [session.id, session]))
    const sessionsByTaskSlug = new Map(
      topLevelSessions
        .filter((session): session is AgentSessionMeta & { taskSlug: string } => Boolean(session.taskSlug))
        .map((session) => [session.taskSlug, session]),
    )
    const summaries = repositoryTasks.filter((summary) =>
      summary.archivedAt === undefined && taskMatchesBoardFilter(summary, input.filter),
    )
    const items = summaries.map((summary) => {
      const linkedSession = (summary.orchestratorSessionId
        ? sessionsById.get(summary.orchestratorSessionId)
        : undefined) ?? sessionsByTaskSlug.get(summary.taskSlug)
      const projectId = summary.scope.kind === 'project' ? summary.scope.projectId : undefined
      const session: AgentSessionMeta = {
        ...(linkedSession ?? {
          id: `task:${summary.taskId}`,
          createdAt: summary.createdAt ?? 0,
          updatedAt: summary.updatedAt ?? 0,
        }),
        title: summary.title,
        taskSlug: summary.taskSlug,
        ...(projectId ? { projectId } : { projectId: undefined }),
        kanbanColumn: summary.kanbanColumn
          ?? (summary.legacyIdentity && linkedSession?.kanbanColumn
            ? linkedSession.kanbanColumn
            : undefined)
          ?? deriveDefaultKanbanColumn(summary.workflow),
      }
      const item = buildItem(
        session,
        projectsById,
        input.runs,
        bindingsBySessionId,
        linkedSession ? childrenByParent.get(linkedSession.id) ?? [] : [],
        input.specNodesBySlug?.get(summary.taskSlug),
        fallbackModel,
        input.expertIdsBySlug?.get(summary.taskSlug),
      )
      return {
        ...item,
        id: summary.taskId,
        title: summary.title,
        task: summary,
        hasSession: linkedSession !== undefined,
      }
    }).sort((left, right) => {
      const leftUpdatedAt = left.task?.updatedAt ?? left.session.updatedAt
      const rightUpdatedAt = right.task?.updatedAt ?? right.session.updatedAt
      return rightUpdatedAt - leftUpdatedAt || left.id.localeCompare(right.id)
    })
    return { boardItems: items, listItems: items }
  }

  const scope = resolveTaskBoardScope(input.filter)
  const sessions = scope.kind === 'all'
    ? topLevelSessions
    : scope.kind === 'workspace'
      ? topLevelSessions.filter((session) => !session.projectId)
      : topLevelSessions.filter((session) => session.projectId === scope.projectId)
  const items = sessions
    .map((session) => buildItem(
      session,
      projectsById,
      input.runs,
      bindingsBySessionId,
      childrenByParent.get(session.id) ?? [],
      session.taskSlug ? input.specNodesBySlug?.get(session.taskSlug) : undefined,
      fallbackModel,
      session.taskSlug ? input.expertIdsBySlug?.get(session.taskSlug) : undefined,
    ))
    .sort((left, right) => right.session.updatedAt - left.session.updatedAt || left.id.localeCompare(right.id))

  return { boardItems: items, listItems: items }
}
