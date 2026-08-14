import type { KanbanItem } from './types'

export interface TaskCardViewModel {
  projectName: string | null
  labelIds: string[]
  showSessionStatus: boolean
}

const IMPORTANT_SESSION_STATUSES = new Set([
  'running',
  'in-progress',
  'queued',
  'blocked',
  'failed',
  'error',
])

/**
 * 看板只突出 Task 主状态；Session/Run 是临时执行信号，正常完成后不长期与 Workflow 并列。
 * 归属显示：跨工作区视图携带 workspaceName（scope=all）→ 优先显示工作区名；
 * 存量 KanbanProject 兼容 → 项目名；工作区级任务缺省显示「工作区」。
 */
export function buildTaskCardViewModel(item: KanbanItem): TaskCardViewModel {
  const projectName = item.workspaceName
    ?? item.project?.name
    ?? (item.task?.scope.kind === 'workspace' ? '工作区' : null)
  return {
    projectName,
    labelIds: item.task?.labelIds ?? [],
    showSessionStatus: IMPORTANT_SESSION_STATUSES.has(item.session.sessionStatus ?? ''),
  }
}
