export interface AgentUploadWorkspaceRegistration {
  id: string
  slug: string
}

export interface AgentUploadSessionRegistration {
  id: string
  workspaceId?: string
}

export function resolveRegisteredUploadWorkspace(
  requestedSlug: unknown,
  registrations: readonly AgentUploadWorkspaceRegistration[],
): AgentUploadWorkspaceRegistration | null {
  if (typeof requestedSlug !== 'string' || requestedSlug.length === 0) return null
  return registrations.find((workspace) => workspace.slug === requestedSlug) ?? null
}

export function assertRegisteredSessionUpload(
  requestedSlug: unknown,
  requestedSessionId: unknown,
  workspaces: readonly AgentUploadWorkspaceRegistration[],
  sessions: readonly AgentUploadSessionRegistration[],
): { workspace: AgentUploadWorkspaceRegistration; session: AgentUploadSessionRegistration } {
  const workspace = resolveRegisteredUploadWorkspace(requestedSlug, workspaces)
  if (!workspace) throw new Error('Workspace slug 未注册')
  if (typeof requestedSessionId !== 'string' || requestedSessionId.length === 0) {
    throw new Error('Agent 会话 ID 无效')
  }

  const session = sessions.find((candidate) => candidate.id === requestedSessionId)
  if (!session || session.workspaceId !== workspace.id) {
    throw new Error('Agent 会话不属于当前 Workspace')
  }
  return { workspace, session }
}
