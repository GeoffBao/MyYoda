import { atom } from 'jotai'
import type { KanbanProject, TaskBoardScopeFilter, TaskEditorTarget } from '@/components/app-shell/kanban/types'

/** 服务端项目快照；渲染状态不写入项目配置。 */
export const serverKanbanProjectsAtom = atom<KanbanProject[]>([])

/** Task Board scope 是唯一正式筛选状态；Project 只是其中一种可选 scope。 */
export const taskBoardScopeAtom = atom<TaskBoardScopeFilter>({ kind: 'all' })

/**
 * 旧调用方的 Project facet 投影。写入时同步到正式 scope；Workspace-only 需直接使用
 * taskBoardScopeAtom，避免再用 magic project id。
 */
export const selectedProjectIdAtom = atom(
  (get) => {
    const scope = get(taskBoardScopeAtom)
    return scope.kind === 'project' ? scope.projectId : null
  },
  (_get, set, projectId: string | null) => {
    set(taskBoardScopeAtom, projectId ? { kind: 'project', projectId } : { kind: 'all' })
  },
)

export const selectedKanbanProjectAtom = atom((get) => {
  const selectedProjectId = get(selectedProjectIdAtom)
  if (!selectedProjectId) return null
  return get(serverKanbanProjectsAtom).find((project) => project.id === selectedProjectId) ?? null
})

export type ProjectPageTab = 'overview' | 'sessions' | 'knowledge' | 'assets' | 'settings'

/** Project Page 页面身份与当前子页；与 Task Board 的 Project facet 明确分离。 */
export const activeProjectPageIdAtom = atom<string | null>(null)
export const projectPageTabAtom = atom<ProjectPageTab>('overview')

/**
 * Code（agent）模式主区视图。
 * `work` 仅保留为一轮兼容 alias；正式入口使用 `tasks`，Project 页面后续使用 `project`。
 */
export type CodeMainView = 'session' | 'tasks' | 'project' | 'work'

/** Project 模式主区视图（不持久化，启动默认会话视图；仅 agent 模式读取） */
export const codeMainViewAtom = atom<CodeMainView>('session')

/**
 * 跨视图打开 TaskEditor（如项目中心卡片「新建任务」、会话 header「编辑任务」）。
 * KanbanBoardContainer 消费后清空。直接复用 TaskEditor 自己的 target 联合类型
 * （create / edit），避免维护第二份重复定义。
 */
export const pendingTaskEditorTargetAtom = atom<TaskEditorTarget | null>(null)

/** 当前激活的 TaskEditor 目标（持久化，避免组件重载丢失状态） */
export const activeTaskEditorTargetAtom = atom<TaskEditorTarget | null>(null)
