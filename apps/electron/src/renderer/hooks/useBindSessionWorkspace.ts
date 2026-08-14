/**
 * useBindSessionWorkspace — 会话绑定/改绑工作区（项目=工作区）的共享逻辑
 *
 * 供 DraftProjectPicker（composer chip）和 WelcomeEmptyState（空态问候语内联切换）共用，
 * 避免两处各自实现同一个 moveAgentSessionToWorkspace IPC 调用。
 * 对齐 Proma：会话永远归属某个工作区（项目），选择工作区即把会话移入该工作区。
 */

import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { agentSessionsAtom } from '@/atoms/agent-atoms'

export function useBindSessionWorkspace(sessionId: string): (workspaceId: string | null) => Promise<void> {
  const setAgentSessions = useSetAtom(agentSessionsAtom)

  return async (nextWorkspaceId: string | null): Promise<void> => {
    if (!nextWorkspaceId) return
    try {
      const updated = await window.electronAPI.moveAgentSessionToWorkspace({
        sessionId,
        targetWorkspaceId: nextWorkspaceId,
      })
      setAgentSessions((prev) => prev.map((session) => (session.id === updated.id ? updated : session)))
    } catch (error) {
      console.error('[useBindSessionWorkspace] 绑定工作区失败:', error)
      toast.error('绑定工作区失败')
    }
  }
}
