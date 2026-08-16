import type { AgentSessionMeta } from '@myyoda/shared'
import type { SessionIndicatorStatus } from '@/atoms/agent-atoms'

export interface AgentSessionTreeItem {
  session: AgentSessionMeta
  /** 当前侧边栏只展示一层；更深后代会扁平收纳在根会话下，保证不会消失。 */
  childSessions: AgentSessionMeta[]
}

const STATUS_PRIORITY: Record<SessionIndicatorStatus, number> = {
  idle: 0,
  completed: 1,
  running: 2,
  blocked: 3,
}

/**
 * 找到会话在当前可见集合中的根节点。
 * 父会话缺失时保留自身为根，避免隐藏会话；遇到损坏的循环关系也退化为自身。
 * 但委派子会话（isDelegatedChildSession）是例外：它们的存在意义完全依附于父会话，
 * 若父会话尚未到达 renderer（冗生启动常见时序竞态），宁可暂时不渲染也不能退化为独立根行，
 * 否则父会话到达后会瞬间从根节点切换为嵌套节点，产生可见的闪烁/重复。
 */
function findRootSessionId(
  session: AgentSessionMeta,
  byId: Map<string, AgentSessionMeta>,
): string | undefined {
  let current = session
  const visited = new Set<string>([session.id])

  while (current.parentSessionId) {
    const parent = byId.get(current.parentSessionId)
    if (!parent) {
      if (isDelegatedChildSession(current)) return undefined
      // 上层祖先被筛掉时，以最近仍可见的祖先为根，而不是把每个后代都拆成根行。
      return current.id
    }
    if (visited.has(parent.id)) return session.id
    visited.add(parent.id)
    current = parent
  }

  return current.id
}

/**
 * Task Conductor 与 collaboration 共用的侧边栏会话树。
 * 展示关系只依赖 parentSessionId；来源字段仍由各自业务逻辑处理，不改变级联操作语义。
 */
export function hasTaskDraftAncestor(
  session: AgentSessionMeta,
  byId: Map<string, AgentSessionMeta>,
): boolean {
  if (session.taskDraft) return true
  const visited = new Set<string>([session.id])
  let parentId = session.parentSessionId
  while (parentId) {
    const parent = byId.get(parentId)
    if (!parent || visited.has(parent.id)) return false
    if (parent.taskDraft) return true
    visited.add(parent.id)
    parentId = parent.parentSessionId
  }
  return false
}

export interface SessionTreeLabelFilter {
  labelIds: string[]
  includeUnlabeled: boolean | undefined
}

export function buildAgentSessionTrees(
  sessions: readonly AgentSessionMeta[],
  labelFilter?: SessionTreeLabelFilter,
): AgentSessionTreeItem[] {
  const allById = new Map(sessions.map((session) => [session.id, session]))
  const visibleSessions = sessions.filter((session) => !hasTaskDraftAncestor(session, allById))
  const byId = new Map(visibleSessions.map((session) => [session.id, session]))
  const rootIdBySessionId = new Map<string, string>()
  const childrenByRootId = new Map<string, AgentSessionMeta[]>()

  for (const session of visibleSessions) {
    const rootId = findRootSessionId(session, byId)
    // 孤儿委派子会话（父会话尚未到达）暂不进树，等父会话到达后自然挂载，避免先显示为根再合并进嵌套节点的闪烁。
    if (rootId === undefined) continue
    rootIdBySessionId.set(session.id, rootId)
    if (rootId === session.id) continue
    const children = childrenByRootId.get(rootId) ?? []
    children.push(session)
    childrenByRootId.set(rootId, children)
  }

  let trees = visibleSessions
    .filter((session) => rootIdBySessionId.get(session.id) === session.id)
    .map((session) => ({
      session,
      childSessions: childrenByRootId.get(session.id) ?? [],
    }))

  if (labelFilter && labelFilter.labelIds.length > 0) {
    trees = trees.filter((item) => {
      const matched = item.session.labelIds?.some((id) => labelFilter.labelIds.includes(id)) === true
      const childMatched = item.childSessions.some((child) =>
        child.labelIds?.some((id) => labelFilter.labelIds.includes(id)) === true,
      )
      if (matched || childMatched) return true
      return labelFilter.includeUnlabeled === true
        && (item.session.labelIds?.length ?? 0) === 0
        && !item.childSessions.some((child) => (child.labelIds?.length ?? 0) > 0)
    })
  }

  return trees
}

/** Task 子会话与 collaboration 子会话都使用同一个轻量分支标识。 */
export function isChildSession(session: AgentSessionMeta): boolean {
  return Boolean(session.parentSessionId)
}

/** 委派子会话必须跟随父会话展示，不能在父会话尚未加载时降级为根会话。 */
export function isDelegatedChildSession(session: AgentSessionMeta): boolean {
  return !!session.parentSessionId && !!session.sourceDelegationId
}

function fallbackSessionStatus(session: AgentSessionMeta): SessionIndicatorStatus {
  if (session.delegationStatus === 'running') return 'running'
  if (session.delegationStatus === 'failed') return 'blocked'
  if (session.sessionStatus === 'running' || session.sessionStatus === 'in-progress' || session.sessionStatus === 'queued') {
    return 'running'
  }
  if (session.sessionStatus === 'needs-review' || session.sessionStatus === 'failed') return 'blocked'
  return 'idle'
}

export function getSessionStatus(
  session: AgentSessionMeta,
  indicatorMap: Map<string, SessionIndicatorStatus>,
): SessionIndicatorStatus {
  return indicatorMap.get(session.id) ?? fallbackSessionStatus(session)
}

/** 父行显示自身与所有子会话中的最高优先级状态。 */
export function getSessionTreeStatus(
  item: AgentSessionTreeItem,
  indicatorMap: Map<string, SessionIndicatorStatus>,
): SessionIndicatorStatus {
  let best = getSessionStatus(item.session, indicatorMap)
  for (const child of item.childSessions) {
    const status = getSessionStatus(child, indicatorMap)
    if (STATUS_PRIORITY[status] > STATUS_PRIORITY[best]) best = status
  }
  return best
}

/** 整个项目分组内所有会话（含委派子会话）中的最高优先级状态；用于项目折叠时在 header 上给出状态提示。 */
export function getWorkspaceGroupStatus(
  sessions: readonly AgentSessionMeta[],
  indicatorMap: Map<string, SessionIndicatorStatus>,
): SessionIndicatorStatus {
  let best: SessionIndicatorStatus = 'idle'
  for (const session of sessions) {
    const status = getSessionStatus(session, indicatorMap)
    if (STATUS_PRIORITY[status] > STATUS_PRIORITY[best]) best = status
  }
  return best
}

/** 用任务族最近活动时间排序/分日期，避免运行中的子任务被旧的主任务时间压到后面。 */
export function getSessionTreeActivityAt(item: AgentSessionTreeItem): number {
  return item.childSessions.reduce(
    (latest, child) => Math.max(latest, child.updatedAt),
    item.session.updatedAt,
  )
}

function isCompletedSession(
  session: AgentSessionMeta,
  indicatorMap: Map<string, SessionIndicatorStatus>,
): boolean {
  if (session.delegationStatus === 'completed') return true
  if (session.sessionStatus === 'done' || session.sessionStatus === 'completed') return true
  return indicatorMap.get(session.id) === 'completed'
}

/**
 * Task 进度按 taskNodeId 的最新运行去重；协作会话按直接子会话计数。
 * 总数优先使用 orchestrator 持久化的 taskNodeCount，因此尚未 spawn 的节点也计入分母。
 */
export function getSessionTreeProgress(
  item: AgentSessionTreeItem,
  indicatorMap: Map<string, SessionIndicatorStatus>,
): { completed: number; total: number } {
  const isTaskTree = Boolean(item.session.taskSlug || item.session.taskNodeCount !== undefined)
  if (!isTaskTree) {
    return {
      completed: item.childSessions.filter((child) => isCompletedSession(child, indicatorMap)).length,
      total: item.childSessions.length,
    }
  }

  const taskChildren = item.childSessions.filter((child) => (
    Boolean(child.taskNodeId)
    || (Boolean(child.taskSlug) && child.taskSlug === item.session.taskSlug)
  ))
  const latestByNodeId = new Map<string, AgentSessionMeta>()
  const unkeyedChildren: AgentSessionMeta[] = []

  for (const child of taskChildren) {
    if (!child.taskNodeId) {
      unkeyedChildren.push(child)
      continue
    }
    const current = latestByNodeId.get(child.taskNodeId)
    if (!current || child.createdAt > current.createdAt) latestByNodeId.set(child.taskNodeId, child)
  }

  const latestChildren = [...latestByNodeId.values(), ...unkeyedChildren]
  const inferredTotal = latestByNodeId.size + unkeyedChildren.length
  const total = item.session.taskNodeCount ?? inferredTotal
  return {
    completed: Math.min(total, latestChildren.filter((child) => isCompletedSession(child, indicatorMap)).length),
    total,
  }
}

function latestChildValue(
  item: AgentSessionTreeItem,
  pick: (session: AgentSessionMeta) => string | undefined,
): string | undefined {
  let value: string | undefined
  let latest = -Infinity
  for (const child of item.childSessions) {
    const candidate = pick(child)
    if (candidate && child.updatedAt >= latest) {
      value = candidate
      latest = child.updatedAt
    }
  }
  return value
}

/** 根绑定代表整个任务族；历史根缺字段时回退到最近子会话，避免项目模式丢失整棵树。 */
export function getSessionTreeProjectId(item: AgentSessionTreeItem): string | undefined {
  return item.session.projectId ?? latestChildValue(item, (session) => session.projectId)
}

export function getSessionTreeCustomGroupId(item: AgentSessionTreeItem): string | undefined {
  return item.session.customGroupId ?? latestChildValue(item, (session) => session.customGroupId)
}

export function treeContainsSessionId(item: AgentSessionTreeItem, sessionId: string | null): boolean {
  if (!sessionId) return false
  return item.session.id === sessionId || item.childSessions.some((session) => session.id === sessionId)
}

/** 判断 tree item 是否为看板任务树（orchestrator + task nodes）。 */
export function isTaskTree(item: AgentSessionTreeItem): boolean {
  return Boolean(item.session.taskSlug || item.session.taskNodeCount !== undefined)
}

/**
 * 拆分 task tree 的 childSessions：
 * - directChildren：parentSessionId 匹配根会话的直接子会话（task nodes）
 * - delegationChildren：扁平化混入的孙子辈委派会话（sourceDelegationId）
 *
 * 非 task tree 不拆分，全部归入 directChildren。
 */
export function splitTaskTreeChildren(
  item: AgentSessionTreeItem,
): { directChildren: AgentSessionMeta[]; delegationChildren: AgentSessionMeta[] } {
  if (!isTaskTree(item)) {
    return { directChildren: item.childSessions, delegationChildren: [] }
  }
  const directChildren: AgentSessionMeta[] = []
  const delegationChildren: AgentSessionMeta[] = []
  for (const child of item.childSessions) {
    if (child.parentSessionId === item.session.id) {
      directChildren.push(child)
    } else if (child.sourceDelegationId) {
      delegationChildren.push(child)
    } else {
      // 非直属且非委派（极少情况）也放 direct，保持可见
      directChildren.push(child)
    }
  }
  return { directChildren, delegationChildren }
}

export function sortSessionTrees(
  items: readonly AgentSessionTreeItem[],
  sortBy: 'recency' | 'alphabetical' | 'createdAt',
): AgentSessionTreeItem[] {
  const compareSessions = (left: AgentSessionMeta, right: AgentSessionMeta): number => {
    if (sortBy === 'alphabetical') return left.title.localeCompare(right.title, 'zh-CN')
    if (sortBy === 'createdAt') return right.createdAt - left.createdAt
    return right.updatedAt - left.updatedAt
  }
  const sorted = items.map((item) => ({
    ...item,
    childSessions: [...item.childSessions].sort(compareSessions),
  }))
  if (sortBy === 'alphabetical') {
    return sorted.sort((left, right) => compareSessions(left.session, right.session))
  }
  if (sortBy === 'createdAt') {
    return sorted.sort((left, right) => compareSessions(left.session, right.session))
  }
  return sorted.sort((left, right) => getSessionTreeActivityAt(right) - getSessionTreeActivityAt(left))
}
