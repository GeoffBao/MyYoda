/**
 * useBindSessionProject — 会话绑定/改绑 Project 的共享逻辑
 * 供 DraftProjectPicker（composer chip）和 WelcomeEmptyState（空态问候语内联切换）共用，
 * 避免两处各自实现同一个 set_project_id IPC 调用。
 */

import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { agentSessionsAtom } from '@/atoms/agent-atoms'

export function useBindSessionProject(sessionId: string): (projectId: string | null) => Promise<void> {
  const setAgentSessions = useSetAtom(agentSessionsAtom)

  return async (nextProjectId: string | null): Promise<void> => {
    try {
      const updated = await window.electronAPI.sendSessionCommand(sessionId, {
        kind: 'set_project_id',
        projectId: nextProjectId || undefined,
      })
      setAgentSessions((prev) => prev.map((session) => (session.id === updated.id ? updated : session)))
    } catch (error) {
      console.error('[useBindSessionProject] 绑定项目失败:', error)
      toast.error('绑定项目失败')
    }
  }
}
