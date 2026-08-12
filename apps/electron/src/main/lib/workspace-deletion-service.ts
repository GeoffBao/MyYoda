interface WorkspaceRef {
  id: string
  slug: string
}

interface WorkspaceScopedRef {
  id: string
  workspaceId?: string
}

/** 工作区删除协调器的最小依赖面，便于验证守卫和级联顺序。Planning 记录不在此级联中。 */
export interface WorkspaceDeletionDependencies {
  getWorkspace: (id: string) => WorkspaceRef | undefined
  listWorkspaces: () => WorkspaceRef[]
  listSessions: () => WorkspaceScopedRef[]
  listAutomations: () => WorkspaceScopedRef[]
  isSessionActive: (sessionId: string) => boolean
  /** 只读预检查；必须在停止会话或删除任何级联资源前完成。第二参数要求无条件检查共享 Worktree。 */
  assertSessionDeletionSafe: (sessionId: string, requireWorktreeClean?: boolean) => void
  /** 工作区目录/recovery root 的只读预检查，必须早于所有 Session 副作用。 */
  assertWorkspaceDeletionSafe: (workspaceId: string) => void
  stopSession: (sessionId: string) => void
  deleteSession: (sessionId: string) => void
  deleteAutomation: (automationId: string) => void
  broadcastAutomationsChanged: () => void
  deleteWorkspace: (workspaceId: string) => void
}

/**
 * 删除 AgentWorkspace 及其运行时从属对象。
 *
 * Todo/日程记录不会在这里删除或解绑：它们可能来自系统 Calendar/Reminders，必须走独立的
 * Planning 一致性策略；UI 会明确提示删除工作区后可能需要重新归类。
 */
export function deleteWorkspaceCascade(
  workspaceId: string,
  dependencies: WorkspaceDeletionDependencies,
): void {
  const workspace = dependencies.getWorkspace(workspaceId)
  if (!workspace) {
    dependencies.deleteWorkspace(workspaceId)
    return
  }

  // 必须在任何副作用前完成守卫，避免先删会话/自动任务再失败。
  if (workspace.slug === 'default') {
    throw new Error('默认工作区不能删除')
  }
  if (dependencies.listWorkspaces().length <= 1) {
    throw new Error('至少需要保留一个工作区')
  }
  dependencies.assertWorkspaceDeletionSafe(workspaceId)

  const sessionIds = dependencies.listSessions()
    .filter((session) => session.workspaceId === workspaceId)
    .map((session) => session.id)
  const automationIds = dependencies.listAutomations()
    .filter((automation) => automation.workspaceId === workspaceId)
    .map((automation) => automation.id)

  // 先检查全部会话，避免前几个会话已删除后才在 dirty Worktree 上失败。
  for (const sessionId of sessionIds) {
    dependencies.assertSessionDeletionSafe(sessionId, true)
  }

  for (const sessionId of sessionIds) {
    if (dependencies.isSessionActive(sessionId)) {
      dependencies.stopSession(sessionId)
    }
    dependencies.deleteSession(sessionId)
  }

  for (const automationId of automationIds) {
    dependencies.deleteAutomation(automationId)
  }
  if (automationIds.length > 0) {
    dependencies.broadcastAutomationsChanged()
  }

  dependencies.deleteWorkspace(workspaceId)
}
