/**
 * useBindSessionWorkspace — 会话绑定/改绑工作区（项目=工作区）的共享逻辑
 *
 * 供 DraftProjectPicker（composer chip）和 WelcomeEmptyState（空态问候语内联切换）共用，
 * 避免两处各自实现同一个 moveAgentSessionToWorkspace IPC 调用。
 * 对齐 Proma：会话永远归属某个工作区（项目），选择工作区即把会话移入该工作区。
 *
 * 改绑的是当前激活会话时，同步全局「当前工作区」（左侧栏高亮）并持久化设置，
 * 保证侧栏、终端 cwd、新建会话默认项目与会话实际归属一致。
 */

import { useSetAtom, useStore } from 'jotai'
import { toast } from 'sonner'
import { agentSessionsAtom, currentAgentWorkspaceIdAtom } from '@/atoms/agent-atoms'
import { activeSessionIdAtom } from '@/atoms/tab-atoms'

export function useBindSessionWorkspace(sessionId: string): (workspaceId: string | null) => Promise<void> {
  const store = useStore()
  const setAgentSessions = useSetAtom(agentSessionsAtom)

  return async (nextWorkspaceId: string | null): Promise<void> => {
    if (!nextWorkspaceId) return
    try {
      const updated = await window.electronAPI.moveAgentSessionToWorkspace({
        sessionId,
        targetWorkspaceId: nextWorkspaceId,
      })
      setAgentSessions((prev) => prev.map((session) => (session.id === updated.id ? updated : session)))

      // 改绑的是当前激活会话：同步全局当前工作区，避免左侧栏仍高亮旧工作区
      // （其他会话激活路径如 openSession/TabBar 均同步该 atom）。
      if (store.get(activeSessionIdAtom) === sessionId) {
        store.set(currentAgentWorkspaceIdAtom, nextWorkspaceId)
        window.electronAPI.updateSettings({ agentWorkspaceId: nextWorkspaceId }).catch(console.error)
      }
    } catch (error) {
      console.error('[useBindSessionWorkspace] 绑定工作区失败:', error)
      toast.error('绑定工作区失败')
    }
  }
}
