import type { TabItem } from '@/atoms/tab-atoms'
import type { AgentSessionMeta, AgentStreamCompletePayload } from '@myyoda/shared'

export interface AgentCompletionPresenceInput {
  tabs: TabItem[]
  activeTabId: string | null
  currentAgentSessionId: string | null
  sessionId: string
  /** 委派子会话 / Task 节点由父会话汇总，不计入用户级未读完成。 */
  session?: Pick<AgentSessionMeta, 'sourceDelegationId' | 'taskNodeId'>
  /** 完成发生时应用窗口是否处于前台。窗口失焦时即使是当前 Tab 也不算"正在查看"。 */
  documentHasFocus: boolean
}

export interface AgentCompletionMarkers {
  markUnviewedCompleted: boolean
}

export interface AgentCompletionNotificationInput {
  completion: Pick<AgentStreamCompletePayload, 'triggeredBy' | 'sourceDelegationId' | 'taskNodeId' | 'stoppedByUser' | 'resultSubtype' | 'backgroundTasksPending'>
  session?: Pick<AgentSessionMeta, 'sourceDelegationId' | 'taskNodeId'>
  hasStreamError: boolean
}

export interface NotifyAgentCompletionInput extends AgentCompletionNotificationInput {
  notify: () => void
}

/** 判断 Agent 完成时用户是否仍停留在该会话入口 */
export function isAgentSessionActiveForCompletion({
  tabs,
  activeTabId,
  currentAgentSessionId,
  sessionId,
  documentHasFocus,
}: AgentCompletionPresenceInput): boolean {
  // 窗口不在前台时用户不可能正在查看，一律按"未查看"处理，
  // 与角标清除端（依赖 document.hasFocus()）的语义保持对齐。
  if (!documentHasFocus) return false

  const activeTab = activeTabId ? tabs.find((tab) => tab.id === activeTabId) : null
  if (activeTab) {
    return (activeTab.type === 'agent' || activeTab.type === 'preview') && activeTab.sessionId === sessionId
  }

  return currentAgentSessionId === sessionId
}

/** 计算 Agent 完成后是否需要写入侧边栏完成提醒 */
export function getAgentCompletionMarkers(input: AgentCompletionPresenceInput): AgentCompletionMarkers {
  const isActiveSession = isAgentSessionActiveForCompletion(input)
  return {
    // 委派子会话 / Task 节点由父会话汇总，不进入用户级未读完成角标（与 shouldNotifyAgentCompletion 语义一致）。
    markUnviewedCompleted: !input.session?.sourceDelegationId && !input.session?.taskNodeId && !isActiveSession,
  }
}

/** 顶层用户任务完成才触发桌面完成提醒；父 Agent 管理的子会话 / Task 节点不单独打扰用户。 */
export function shouldNotifyAgentCompletion({
  completion,
  session,
  hasStreamError,
}: AgentCompletionNotificationInput): boolean {
  const isSuccessfulCompletion = !completion.stoppedByUser &&
    !hasStreamError &&
    (!completion.resultSubtype || completion.resultSubtype === 'success')

  if (completion.backgroundTasksPending || !isSuccessfulCompletion) return false
  if (completion.triggeredBy === 'delegation') return false
  if (completion.sourceDelegationId || session?.sourceDelegationId) return false
  if (completion.taskNodeId || session?.taskNodeId) return false
  return true
}

/** 仅在真正成功、无需等待后台任务，且属于顶层用户任务边界时调用完成通知 callback。 */
export function notifyAgentCompletion({
  notify,
  ...input
}: NotifyAgentCompletionInput): void {
  if (shouldNotifyAgentCompletion(input)) notify()
}
