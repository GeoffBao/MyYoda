export interface AgentSessionChildrenDeletionResult {
  deletedChildIds: string[]
  failedChildIds: string[]
}

/** 只有所有固定快照中的子会话都成功删除时，才允许继续删除父会话。 */
export function shouldDeleteAgentParent(result: AgentSessionChildrenDeletionResult): boolean {
  return result.failedChildIds.length === 0
}

/** 顺序删除级联子会话，返回成功与失败的精确集合，供 UI 只清理成功项。 */
export async function deleteAgentSessionChildren(
  childIds: readonly string[],
  deleteSession: (sessionId: string) => Promise<void>,
  onFailure?: (sessionId: string, error: unknown) => void,
): Promise<AgentSessionChildrenDeletionResult> {
  const deletedChildIds: string[] = []
  const failedChildIds: string[] = []

  for (const childId of childIds) {
    try {
      await deleteSession(childId)
      deletedChildIds.push(childId)
    } catch (error) {
      onFailure?.(childId, error)
      failedChildIds.push(childId)
    }
  }

  return { deletedChildIds, failedChildIds }
}
