import { listAgentSessions } from './agent-session-manager'
import {
  getWorkspaceMemoryReviewLastPromptAt,
  getWorkspaceMemorySummary,
  recordWorkspaceMemoryReviewInvitation,
} from './agent-workspace-manager'

const DAY_MS = 24 * 60 * 60 * 1000
/** 内部固定节奏。用户只会被邀请，绝不会被自动扫描。 */
export const WORKSPACE_MEMORY_REVIEW_INTERVAL_DAYS = 3

export interface WorkspaceMemoryRefreshOpportunity {
  /** 最近一次记忆更新之前，新工作区会话累积的时间点。 */
  memoryUpdatedAt?: number
  newestSessionAt: number
  newerSessionCount: number
}

/**
 * 在前台 Agent 运行期间惰性检查工作区。归档会话刻意纳入：归档是导航选择，不是证据删除。
 */
export function claimWorkspaceMemoryRefreshOpportunity(
  workspaceSlug: string | undefined,
  now = Date.now(),
): WorkspaceMemoryRefreshOpportunity | undefined {
  if (!workspaceSlug) return undefined
  const lastPromptAt = getWorkspaceMemoryReviewLastPromptAt(workspaceSlug)

  const summary = getWorkspaceMemorySummary(workspaceSlug)
  const memoryUpdatedAt = summary.autoMemory.updatedAt
  const sessions = listAgentSessions().filter((session) => session.workspaceId === workspaceSlug)
  const newerSessions = sessions.filter((session) => session.updatedAt > (memoryUpdatedAt ?? 0))
  const newestSessionAt = newerSessions[0]?.updatedAt
  if (!newestSessionAt) return undefined

  // 即使用户跳过，也按固定内部节奏重邀，不再更频繁。
  const cooldownFrom = Math.max(memoryUpdatedAt ?? 0, lastPromptAt ?? 0)
  if (now - cooldownFrom < WORKSPACE_MEMORY_REVIEW_INTERVAL_DAYS * DAY_MS) return undefined

  recordWorkspaceMemoryReviewInvitation(workspaceSlug, now)
  return { memoryUpdatedAt, newestSessionAt, newerSessionCount: newerSessions.length }
}
