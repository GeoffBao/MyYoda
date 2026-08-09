import type { AgentSessionMeta } from '@myyoda/shared'
import type { KanbanColumnDef } from '@myyoda/shared/projects'
import type { TaskAggregateSummary, TaskWorkflow } from '@myyoda/shared/tasks'

/** 历史遗留的收件箱列 ID；列已下线，存量值由 board fallback 归入待办。 */
export const INBOX_COLUMN_ID = 'inbox'

/** 新会话的默认看板列：待办（对齐 craft/Synara/Orca——新会话落低承诺默认态，不做收件箱 triage）。 */
export const DEFAULT_KANBAN_COLUMN_ID = 'todo'

export type KanbanBoardMode = 'board' | 'list'
export type KanbanNodeState = 'pending' | 'running' | 'done' | 'failed' | 'cancelled' | 'skipped'
export type SubtaskRunState = 'done' | 'running' | 'pending' | 'failed' | 'needs-review'

/**
 * TaskEditor 的创建目标或已绑定会话目标。
 *
 * edit 模式的 taskSlug 可选：对齐 craft——看板上的卡片不要求都有 task spec（可能是
 * 侧边栏「新会话」/看板轻量输入创建的普通会话），任何卡片都能打开编辑器。没有
 * taskSlug 时编辑器不读取既有 spec，直接用 initialTitle/initialModel 起草一份新
 * 表单；保存即把这个普通会话「升级」成正式任务（生成新 slug 并绑定回同一会话）。
 */
export type TaskEditorTarget =
  | {
      mode: 'create'
      initialProjectId?: string
      /** 由渐进式 Composer 带入，避免进入完整编辑器时丢稿。 */
      initialTitle?: string
      initialGoal?: string
    }
  | { mode: 'edit'; sessionId: string; taskSlug?: string; initialTitle?: string; initialModel?: string }

export interface KanbanSubtask {
  id: string
  sessionId?: string
  title: string
  runState: SubtaskRunState
  model: string
}

/** 渲染进程使用的项目摘要；列表可含 workingDirectory，供详情编辑；路径仅桌面端本地使用。 */
export interface KanbanProject {
  id: string
  slug?: string
  name: string
  description?: string
  details?: string
  /** 项目绑定工作目录；新会话可继承（主进程 set_project_id） */
  workingDirectory?: string
  color?: string
  archivedAt?: number
  /** 项目最近更新时间（侧边栏子分组排序用；preload 透传 ProjectConfig.updatedAt） */
  updatedAt?: number
  /** 项目默认 Agent 专家 slug；任务未指定时由 TaskRunner 注入 */
  defaultExpertId?: string
  workspaceId?: string
  /**
   * 缺省（undefined）等价于 'project'。'home' / 'ad-hoc' 是历史遗留的隐藏容器 Project
   * kind（存量 config 读兼容）；新建项目不再产生这两种 kind。
   */
  kind?: 'project' | 'home' | 'ad-hoc'
  /** 项目自定义看板列（ProjectConfig.kanbanColumns 透传）；未设置时看板用全局默认列 */
  kanbanColumns?: KanbanColumnDef[]
}

/** 隐藏容器 Project（home / ad-hoc）判定；用于从"选择/管理项目"类 UI 中排除它们。 */
export function isHiddenKanbanProjectKind(kind: KanbanProject['kind']): boolean {
  return kind === 'home' || kind === 'ad-hoc'
}

/** 过滤掉隐藏容器 Project，得到用户可见/可选择的真实 Project 列表。 */
export function filterPickableKanbanProjects(projects: readonly KanbanProject[]): KanbanProject[] {
  return projects.filter((project) => !isHiddenKanbanProjectKind(project.kind))
}

/** 从任务运行快照归一化后的最小节点状态。 */
export interface KanbanTaskRun {
  taskSlug: string
  runId: string
  nodeStates: Record<string, KanbanNodeState>
}

/** 可安全展示的 Teambition 绑定字段。 */
export interface TeambitionBinding {
  bindingId?: string
  sessionId: string
  taskId: string
  title?: string
  status?: string
  syncState?: 'synced' | 'pending' | 'conflict' | 'stale' | 'needs-reauth'
  error?: string
}

export type TaskBoardScopeFilter =
  | { kind: 'all' }
  | { kind: 'workspace' }
  | { kind: 'project'; projectId: string }

export interface KanbanFilter {
  /** 显式 Task scope facet；新调用优先使用它，而不是旧 projectId 表示。 */
  scope?: TaskBoardScopeFilter
  /** @deprecated null 表示全部，字符串表示 Project；仅保留用于会话看板兼容。 */
  projectId?: string | null
  /** 'all' 或省略表示不限制 workflow。 */
  workflow?: 'all' | TaskWorkflow
  /** 多个选中 Label 按 OR 匹配。 */
  labelIds?: readonly string[]
  /** true 时把无标签 Task 纳入结果；未选 Label 时表示仅看无标签。 */
  includeUnlabeled?: boolean
}

export interface KanbanNodeProgress {
  completedNodes: number
  totalNodes: number
}

export interface KanbanTeambitionFields {
  bindingId?: string
  taskId: string
  title?: string
  status?: string
  syncState?: 'synced' | 'pending' | 'conflict' | 'stale' | 'needs-reauth'
  error?: string
}

/** 仅用于渲染的卡片；不会回写到 AgentSessionMeta。 */
export interface KanbanItem {
  id: string
  title: string
  columnId: string
  session: AgentSessionMeta
  /** 是否有可打开/可继续执行的真实 orchestrator Session；false 时 session 仅为诊断卡片展示适配。 */
  hasSession?: boolean
  /** 正式 TaskRepository 投影；旧 Session 看板兼容项缺省。 */
  task?: TaskAggregateSummary
  project: KanbanProject | null
  /** craft 对齐：卡片上展开的子任务行（spec nodes ∪ child sessions） */
  subtasks: KanbanSubtask[]
  /** Conductor 总节点数；进度分母在 subtasks 尚未填满时保持稳定 */
  subtaskTotal?: number
  /** 编排器或任一子任务正在流式执行 */
  isProcessing?: boolean
  /** 解析后的专家 slug（任务 defaults ∨ 项目默认） */
  expertId?: string
  taskRun?: KanbanNodeProgress
  teambition?: KanbanTeambitionFields
}

export interface KanbanViewModel {
  /** Board 与 List 共用这一排序后的数组，避免两种视图顺序漂移。 */
  boardItems: KanbanItem[]
  listItems: KanbanItem[]
}

/** 看板模型选择器中的单个模型项。 */
export interface KanbanModelOption {
  id: string
  name: string
  /** 提供该模型的渠道 ID（写入 spec.llmConnection） */
  channelId: string
}

/**
 * 按渠道分组的可选模型（对应 craft 的 provider groups；
 * MyYoda 用 Channel 充当 connection，llmConnection = channelId）。
 */
export interface KanbanModelProviderGroup {
  provider: string
  label: string
  models: KanbanModelOption[]
}
