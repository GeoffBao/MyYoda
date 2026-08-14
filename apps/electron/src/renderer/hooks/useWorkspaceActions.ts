/**
 * useWorkspaceActions — AgentWorkspace 切换与创建的共享逻辑。
 *
 * 用户界面统一称为“工作区”；底层类型、IPC 和持久化字段继续沿用 workspace 命名。
 */

import * as React from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import {
  agentWorkspacesAtom,
  currentAgentWorkspaceIdAtom,
} from '@/atoms/agent-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import type { AgentWorkspace } from '@myyoda/shared'

interface UseWorkspaceActionsResult {
  workspaces: AgentWorkspace[]
  currentWorkspaceId: string | null
  /** 切换到指定工作区；已是当前工作区时无副作用。默认切回对话视图，resetView:false 可保持当前视图（如停留在 Agent 技能） */
  selectWorkspace: (workspaceId: string, opts?: { resetView?: boolean }) => void
  /** 创建并切到新工作区；成功返回新工作区，失败已 toast 并返回 null */
  createWorkspace: (name: string) => Promise<AgentWorkspace | null>
  /** 从本地文件夹创建项目（工作区）；成功返回新工作区，失败已 toast 并返回 null */
  createWorkspaceFromFolder: (projectRootPath: string) => Promise<AgentWorkspace | null>
  /** 重新关联工作区本地项目根目录 */
  relinkWorkspaceProjectRoot: (id: string, projectRootPath: string) => Promise<AgentWorkspace | null>
  /** 在缺失的原路径恢复空项目根目录 */
  restoreWorkspaceProjectRoot: (id: string) => Promise<AgentWorkspace | null>
}

export function useWorkspaceActions(): UseWorkspaceActionsResult {
  const [workspaces, setWorkspaces] = useAtom(agentWorkspacesAtom)
  const [currentWorkspaceId, setCurrentWorkspaceId] = useAtom(currentAgentWorkspaceIdAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const createInFlightRef = React.useRef(false)

  const selectWorkspace = React.useCallback(
    (workspaceId: string, opts?: { resetView?: boolean }): void => {
      if (workspaceId === currentWorkspaceId) return
      setCurrentWorkspaceId(workspaceId)
      if (opts?.resetView !== false) setActiveView('conversations')
      window.electronAPI.updateSettings({ agentWorkspaceId: workspaceId }).catch(console.error)
    },
    [currentWorkspaceId, setCurrentWorkspaceId, setActiveView],
  )

  const createWorkspace = React.useCallback(
    async (name: string): Promise<AgentWorkspace | null> => {
      const trimmed = name.trim()
      if (!trimmed) return null
      if (createInFlightRef.current) return null
      createInFlightRef.current = true

      try {
        const workspace = await window.electronAPI.createAgentWorkspace(trimmed)
        setWorkspaces((prev) => [workspace, ...prev])
        setCurrentWorkspaceId(workspace.id)
        setActiveView('conversations')
        window.electronAPI.updateSettings({ agentWorkspaceId: workspace.id }).catch(console.error)
        return workspace
      } catch (error) {
        const msg = error instanceof Error ? error.message : '创建失败'
        toast.error(msg)
        return null
      } finally {
        createInFlightRef.current = false
      }
    },
    [setWorkspaces, setCurrentWorkspaceId, setActiveView],
  )

  /** 从本地文件夹创建项目（工作区）：名称取文件夹名，projectRootPath 绑定该目录 */
  const createWorkspaceFromFolder = React.useCallback(
    async (projectRootPath: string): Promise<AgentWorkspace | null> => {
      const trimmed = projectRootPath.trim()
      if (!trimmed) return null
      if (createInFlightRef.current) return null
      createInFlightRef.current = true

      try {
        const name = trimmed.split(/[\\/]/).filter(Boolean).pop() ?? trimmed
        const workspace = await window.electronAPI.createAgentWorkspace({ name, projectRootPath: trimmed })
        setWorkspaces((prev) => [workspace, ...prev])
        setCurrentWorkspaceId(workspace.id)
        setActiveView('conversations')
        window.electronAPI.updateSettings({ agentWorkspaceId: workspace.id }).catch(console.error)
        return workspace
      } catch (error) {
        const msg = error instanceof Error ? error.message : '创建失败'
        toast.error(msg)
        return null
      } finally {
        createInFlightRef.current = false
      }
    },
    [setWorkspaces, setCurrentWorkspaceId, setActiveView],
  )

  /** 重新关联工作区本地项目根目录；成功后更新列表 */
  const relinkWorkspaceProjectRoot = React.useCallback(
    async (id: string, projectRootPath: string): Promise<AgentWorkspace | null> => {
      try {
        const updated = await window.electronAPI.relinkAgentWorkspaceProjectRoot(id, projectRootPath)
        setWorkspaces((prev) => prev.map((w) => (w.id === id ? updated : w)))
        return updated
      } catch (error) {
        const msg = error instanceof Error ? error.message : '重新关联失败'
        toast.error(msg)
        return null
      }
    },
    [setWorkspaces],
  )

  /** 在缺失的原路径恢复空项目根目录；成功后更新列表 */
  const restoreWorkspaceProjectRoot = React.useCallback(
    async (id: string): Promise<AgentWorkspace | null> => {
      try {
        const updated = await window.electronAPI.restoreAgentWorkspaceProjectRoot(id)
        setWorkspaces((prev) => prev.map((w) => (w.id === id ? updated : w)))
        return updated
      } catch (error) {
        const msg = error instanceof Error ? error.message : '恢复失败'
        toast.error(msg)
        return null
      }
    },
    [setWorkspaces],
  )

  return {
    workspaces,
    currentWorkspaceId,
    selectWorkspace,
    createWorkspace,
    createWorkspaceFromFolder,
    relinkWorkspaceProjectRoot,
    restoreWorkspaceProjectRoot,
  }
}
