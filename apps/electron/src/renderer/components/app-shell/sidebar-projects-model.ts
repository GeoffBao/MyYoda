/**
 * sidebar-projects-model — Projects Tab 的分组/排序/聚合注意力纯函数
 *
 * 从 SidebarProjectsTab.tsx 抽出，便于 bun:test 单测（对齐 codebase 的 *-model.ts 模式）。
 */

import type { AgentSessionMeta } from '@myyoda/shared'
import type { SessionIndicatorStatus } from '@/atoms/agent-atoms'
import type { KanbanProject } from './kanban/types'
import {
  getSessionTreeActivityAt,
  getSessionTreeProjectId,
  getSessionTreeStatus,
  type AgentSessionTreeItem,
} from './sidebar-session-tree'

/** 项目行聚合注意力点优先级：blocked > running > completed（学 Synara/Superset 聚合指示） */
const ATTENTION_PRIORITY: Partial<Record<SessionIndicatorStatus, number>> = {
  blocked: 3,
  running: 2,
  completed: 1,
}

/** 取组内会话最高优先级的注意力状态；无需要关注的会话时返回 null */
export function resolveProjectAttention(
  sessions: AgentSessionMeta[],
  indicatorMap: Map<string, SessionIndicatorStatus>,
): SessionIndicatorStatus | null {
  let best: SessionIndicatorStatus | null = null
  let bestPriority = 0
  for (const session of sessions) {
    const status = indicatorMap.get(session.id)
    if (!status) continue
    const priority = ATTENTION_PRIORITY[status] ?? 0
    if (priority > bestPriority) {
      best = status
      bestPriority = priority
    }
  }
  return best
}

/** 自动任务会话的家是「自动任务」视图，不进项目分组（与 sessions tab 规则一致） */
export function isHiddenAutomationSession(session: AgentSessionMeta): boolean {
  return !!session.sourceAutomationId && !session.pinned
}

/** 过滤可入项目分组的会话：保留父子会话；置顶任务族由上方置顶区统一展示，避免重复。 */
export function filterGroupableSessions(
  sessions: AgentSessionMeta[],
  draftSessionIds: Set<string>,
  currentWorkspaceId: string | null,
): AgentSessionMeta[] {
  const visiblePinnedTreeIds = new Set(
    sessions.filter((session) => session.pinned && !session.archived).map((session) => session.id),
  )
  let changed = true
  while (changed) {
    changed = false
    for (const session of sessions) {
      if (visiblePinnedTreeIds.has(session.id)) continue
      if (session.parentSessionId && visiblePinnedTreeIds.has(session.parentSessionId)) {
        visiblePinnedTreeIds.add(session.id)
        changed = true
      }
    }
  }

  return sessions.filter((session) => {
    if (session.archived) return false
    if (draftSessionIds.has(session.id)) return false
    if (visiblePinnedTreeIds.has(session.id)) return false
    if (isHiddenAutomationSession(session)) return false
    if (currentWorkspaceId && session.workspaceId && session.workspaceId !== currentWorkspaceId) return false
    return true
  })
}

/**
 * 按 projectId 分桶，各组内按 updatedAt 倒序。
 * 无项目的会话不分桶（项目 Tab 是纯粹的「按项目浏览」视图，未归属会话统一去会话 Tab 查看/迁移）。
 */
export function groupSessionsByProject(sessions: AgentSessionMeta[]): Map<string, AgentSessionMeta[]> {
  const byProject = new Map<string, AgentSessionMeta[]>()
  for (const session of sessions) {
    if (!session.projectId) continue
    const list = byProject.get(session.projectId) ?? []
    list.push(session)
    byProject.set(session.projectId, list)
  }
  const byUpdatedDesc = (a: AgentSessionMeta, b: AgentSessionMeta) => b.updatedAt - a.updatedAt
  for (const list of byProject.values()) list.sort(byUpdatedDesc)
  return byProject
}

/** 项目排序：有会话的按最新会话活跃度排，无会话的按项目自身 updatedAt 排 */
export function sortProjectsByActivity(
  projects: KanbanProject[],
  byProject: Map<string, AgentSessionMeta[]>,
): KanbanProject[] {
  const activityOf = (project: KanbanProject): number => byProject.get(project.id)?.[0]?.updatedAt ?? 0
  return [...projects].sort((a, b) => {
    const activityA = activityOf(a)
    const activityB = activityOf(b)
    if (activityA !== activityB) return activityB - activityA
    return (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
  })
}

/** 任务树按根会话 projectId 分桶；子任务始终跟随主任务。 */
export function groupSessionTreesByProject(
  trees: readonly AgentSessionTreeItem[],
): Map<string, AgentSessionTreeItem[]> {
  const byProject = new Map<string, AgentSessionTreeItem[]>()
  for (const tree of trees) {
    const projectId = getSessionTreeProjectId(tree)
    if (!projectId) continue
    const items = byProject.get(projectId) ?? []
    items.push(tree)
    byProject.set(projectId, items)
  }
  for (const items of byProject.values()) {
    items.sort((left, right) => getSessionTreeActivityAt(right) - getSessionTreeActivityAt(left))
  }
  return byProject
}

/** 项目注意力包含主任务及其所有子任务。 */
export function resolveProjectTreeAttention(
  trees: readonly AgentSessionTreeItem[],
  indicatorMap: Map<string, SessionIndicatorStatus>,
): SessionIndicatorStatus | null {
  let best: SessionIndicatorStatus | null = null
  let bestPriority = 0
  for (const tree of trees) {
    const status = getSessionTreeStatus(tree, indicatorMap)
    const priority = ATTENTION_PRIORITY[status] ?? 0
    if (priority > bestPriority) {
      best = status
      bestPriority = priority
    }
  }
  return best
}

/** 有任务族的项目按整棵树最近活动排序；空项目按项目自身更新时间。 */
export function sortProjectsByTreeActivity(
  projects: KanbanProject[],
  byProject: Map<string, AgentSessionTreeItem[]>,
): KanbanProject[] {
  const activityOf = (project: KanbanProject): number => (
    (byProject.get(project.id) ?? []).reduce(
      (latest, tree) => Math.max(latest, getSessionTreeActivityAt(tree)),
      0,
    )
  )
  return [...projects].sort((left, right) => {
    const activityDelta = activityOf(right) - activityOf(left)
    if (activityDelta !== 0) return activityDelta
    return (right.updatedAt ?? 0) - (left.updatedAt ?? 0)
  })
}
