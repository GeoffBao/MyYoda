import { atom } from 'jotai'
import type { AgentSessionMeta } from '@myyoda/shared'
import type { TaskAggregateSummary, TaskWorkflow } from '@myyoda/shared/tasks'
import { buildKanbanViewModel } from '@/components/app-shell/kanban/kanban-view-model'
import { workflowForKanbanColumn } from '@/components/app-shell/kanban/status-column'
import type { SpecNodeSummary } from '@/components/app-shell/kanban/subtask-merge'
import { taskBoardWorkflowFilterAtom, taskBoardLabelFilterAtom, taskBoardIncludeUnlabeledAtom } from './task-board-filter-atoms'
import {
  type KanbanBoardMode,
  type KanbanItem,
  type KanbanTaskRun,
  type TeambitionBinding,
} from '@/components/app-shell/kanban/types'
import { agentModelIdAtom, agentStreamingStatesAtom, agentWorkspacesAtom } from './agent-atoms'
import { serverKanbanProjectsAtom, taskBoardScopeAtom } from './project-atoms'

/** 服务端会话快照，始终保持原始 AgentSessionMeta。 */
export const serverKanbanSessionsAtom = atom<AgentSessionMeta[]>([])
/** TaskRepository-first summaries. Empty during load so ordinary chats never flash as Tasks. */
export const serverTaskSummariesAtom = atom<TaskAggregateSummary[] | undefined>([])
export const serverKanbanRunsAtom = atom<KanbanTaskRun[]>([])
export const serverTeambitionBindingsAtom = atom<TeambitionBinding[]>([])
/** taskSlug → DAG nodes，供卡片合并子任务行 */
export const kanbanSpecNodesAtom = atom<Map<string, SpecNodeSummary[]>>(new Map())
/** taskSlug → TaskSpec.defaults.expertId（未设则不入 map；展示时再与项目默认 resolve） */
export const kanbanTaskExpertIdsAtom = atom<Map<string, string>>(new Map())

/** 仅保存尚未得到服务端确认的列覆盖，避免污染服务端快照。 */
interface OptimisticKanbanColumn {
  columnId: string
  sequence: number
}

export const optimisticKanbanColumnsAtom = atom<Map<string, OptimisticKanbanColumn>>(new Map())
const kanbanMoveSequenceAtom = atom(0)
const latestKanbanMoveSequenceAtom = atom<Map<string, number>>(new Map())

export const boardModeAtom = atom<KanbanBoardMode>('board')

export interface KanbanNotification {
  level: 'error'
  message: string
}

/** 由容器转为 Sonner toast；状态层只描述通知，便于测试与复用。 */
export const kanbanNotificationsAtom = atom<KanbanNotification[]>([])

export const kanbanItemsAtom = atom<KanbanItem[]>((get) => {
  const optimisticColumns = get(optimisticKanbanColumnsAtom)
  const streamStates = get(agentStreamingStatesAtom)
  const sessions = get(serverKanbanSessionsAtom).map((session) => {
    const optimisticColumn = optimisticColumns.get(session.id)
    return optimisticColumn === undefined ? session : { ...session, kanbanColumn: optimisticColumn.columnId }
  })
  const items = buildKanbanViewModel({
    projects: get(serverKanbanProjectsAtom),
    sessions,
    runs: get(serverKanbanRunsAtom),
    bindings: get(serverTeambitionBindingsAtom),
    tasks: get(serverTaskSummariesAtom),
    filter: {
      scope: get(taskBoardScopeAtom),
      workflow: get(taskBoardWorkflowFilterAtom),
      labelIds: get(taskBoardLabelFilterAtom),
      includeUnlabeled: get(taskBoardIncludeUnlabeledAtom),
    },
    // 跨工作区视图（scope=all）时卡片携带工作区名徽标；当前工作区视图不冗余显示
    workspaceNameById: get(taskBoardScopeAtom).kind === 'all'
      ? new Map(get(agentWorkspacesAtom).map((workspace) => [workspace.id, workspace.name]))
      : undefined,
    specNodesBySlug: get(kanbanSpecNodesAtom),
    expertIdsBySlug: get(kanbanTaskExpertIdsAtom),
    fallbackModel: get(agentModelIdAtom) ?? '',
  }).listItems

  // 流式 running 覆盖到卡片：只认真实 stream，避免陈旧 sessionStatus 假 live
  return items.map((item) => {
    const childIds = item.subtasks
      .map((subtask) => subtask.sessionId)
      .filter((id): id is string => Boolean(id))
    const isProcessing = Boolean(streamStates.get(item.session.id)?.running)
      || childIds.some((id) => streamStates.get(id)?.running)
    if (!isProcessing) return item
    return {
      ...item,
      isProcessing: true,
      subtasks: item.subtasks.map((subtask) => {
        if (!subtask.sessionId || !streamStates.get(subtask.sessionId)?.running) return subtask
        return { ...subtask, runState: 'running' as const }
      }),
    }
  })
})

export interface MoveCardInput {
  /** stable taskId in TaskRepository-first mode */
  itemId?: string
  /** @deprecated legacy Session-board caller compatibility */
  sessionId?: string
  columnId: string
  workspaceRoot?: string
  workspaceId?: string
  /**
   * 'workflow'（默认/无自定义列）：列即状态，走 updateWorkflow；
   * 'custom'（项目自定义列）：列位置独立持久化到 kanbanColumn，可选按 dropStatusId 联动状态。
   */
  columnPlacementMode?: 'workflow' | 'custom'
  /** 自定义列模式下，落列后自动套用的目标状态（可选，undefined 表示不改变状态） */
  dropStatusId?: TaskWorkflow
}

function toErrorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : '移动看板卡片失败'
}

/**
 * 先更新本地列，再通过 nested preload bridge 持久化。所有异步回写都必须属于该卡片的最新请求。
 */
export const moveCardAtom = atom(
  null,
  async (get, set, input: MoveCardInput): Promise<void> => {
    const itemId = input.itemId ?? input.sessionId
    if (!itemId) throw new Error('移动卡片缺少 itemId')
    const sequence = get(kanbanMoveSequenceAtom) + 1
    set(kanbanMoveSequenceAtom, sequence)
    set(latestKanbanMoveSequenceAtom, (sequences) => {
      const next = new Map(sequences)
      next.set(itemId, sequence)
      return next
    })

    const task = get(serverTaskSummariesAtom)?.find((candidate) => candidate.taskId === itemId)
    if (task && !task.legacyIdentity) {
      if (!input.workspaceRoot || !input.workspaceId) {
        set(kanbanNotificationsAtom, (notifications) => [
          ...notifications,
          { level: 'error', message: 'Task Workflow 更新缺少 Workspace 上下文' },
        ])
        return
      }

      // 项目自定义列路径：列位置独立持久化，可选 dropStatusId 联动状态
      if (input.columnPlacementMode === 'custom') {
        const previous = task
        set(serverTaskSummariesAtom, (tasks) => tasks?.map((candidate) =>
          candidate.taskId === task.taskId ? { ...candidate, kanbanColumn: input.columnId } : candidate,
        ))
        try {
          let updated = await window.electronAPI.tasks.updateMetadata(
            input.workspaceRoot,
            input.workspaceId,
            task.taskId,
            { kanbanColumn: input.columnId, expectedRevision: task.revision },
          )
          if (get(latestKanbanMoveSequenceAtom).get(itemId) !== sequence) return
          // 落列后按 dropStatusId 链式联动 workflow（仅当目标与当前状态不同）
          if (input.dropStatusId && input.dropStatusId !== updated.workflow) {
            const workflowUpdated = await window.electronAPI.tasks.updateWorkflow(
              input.workspaceRoot,
              input.workspaceId,
              task.taskId,
              input.dropStatusId,
              updated.revision,
            )
            if (get(latestKanbanMoveSequenceAtom).get(itemId) !== sequence) return
            updated = workflowUpdated
          }
          set(serverTaskSummariesAtom, (tasks) => tasks?.map((candidate) =>
            candidate.taskId === task.taskId ? updated : candidate,
          ))
        } catch (cause) {
          if (get(latestKanbanMoveSequenceAtom).get(itemId) !== sequence) return
          set(serverTaskSummariesAtom, (tasks) => tasks?.map((candidate) =>
            candidate.taskId === task.taskId ? previous : candidate,
          ))
          set(kanbanNotificationsAtom, (notifications) => [
            ...notifications,
            { level: 'error', message: toErrorMessage(cause) },
          ])
        }
        return
      }

      const workflow = workflowForKanbanColumn(input.columnId)
      set(serverTaskSummariesAtom, (tasks) => tasks?.map((candidate) =>
        candidate.taskId === task.taskId ? { ...candidate, workflow } : candidate,
      ))
      try {
        const updated = await window.electronAPI.tasks.updateWorkflow(
          input.workspaceRoot,
          input.workspaceId,
          task.taskId,
          workflow,
          task.revision,
        )
        if (get(latestKanbanMoveSequenceAtom).get(itemId) !== sequence) return
        set(serverTaskSummariesAtom, (tasks) => tasks?.map((candidate) =>
          candidate.taskId === task.taskId ? updated : candidate,
        ))
      } catch (cause) {
        if (get(latestKanbanMoveSequenceAtom).get(itemId) !== sequence) return
        set(serverTaskSummariesAtom, (tasks) => tasks?.map((candidate) =>
          candidate.taskId === task.taskId ? task : candidate,
        ))
        set(kanbanNotificationsAtom, (notifications) => [
          ...notifications,
          { level: 'error', message: toErrorMessage(cause) },
        ])
      }
      return
    }

    const sessionId = task?.orchestratorSessionId
      ?? get(serverKanbanSessionsAtom).find((session) => session.taskSlug === task?.taskSlug && !session.parentSessionId)?.id
      ?? itemId
    const currentOptimisticColumns = get(optimisticKanbanColumnsAtom)
    const nextOptimisticColumns = new Map(currentOptimisticColumns)
    nextOptimisticColumns.set(sessionId, { columnId: input.columnId, sequence })
    set(optimisticKanbanColumnsAtom, nextOptimisticColumns)

    try {
      const updated = await window.electronAPI.sessions.move(sessionId, input.columnId)
      if (get(latestKanbanMoveSequenceAtom).get(itemId) !== sequence) return
      set(serverKanbanSessionsAtom, (sessions) =>
        sessions.map((item) => item.id === sessionId ? updated : item),
      )
      set(optimisticKanbanColumnsAtom, (columns) => {
        if (columns.get(sessionId)?.sequence !== sequence) return columns
        const next = new Map(columns)
        next.delete(sessionId)
        return next
      })
    } catch (cause) {
      if (get(latestKanbanMoveSequenceAtom).get(itemId) !== sequence) return
      set(optimisticKanbanColumnsAtom, (columns) => {
        if (columns.get(sessionId)?.sequence !== sequence) return columns
        const next = new Map(columns)
        next.delete(sessionId)
        return next
      })
      set(kanbanNotificationsAtom, (notifications) => [
        ...notifications,
        { level: 'error', message: toErrorMessage(cause) },
      ])
    }
  },
)
