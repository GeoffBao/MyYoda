/**
 * useOpenLocalFolder — 打开本地文件夹 → 复用/创建 Project → Draft Session
 */

import { useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import {
  agentWorkspacesAtom,
  currentAgentWorkspaceIdAtom,
} from '@/atoms/agent-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { codeMainViewAtom, serverKanbanProjectsAtom } from '@/atoms/project-atoms'
import { planOpenLocalFolder } from './open-local-folder-model'
import { useCreateSession } from './useCreateSession'
import type { KanbanProject } from '@/components/app-shell/kanban/types'

export function useOpenLocalFolder(): () => Promise<void> {
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const setProjects = useSetAtom(serverKanbanProjectsAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const setCodeMainView = useSetAtom(codeMainViewAtom)
  const { createAgent } = useCreateSession()

  return async (): Promise<void> => {
    const workspace = workspaces.find((candidate) => candidate.id === currentWorkspaceId) ?? workspaces[0]
    if (!workspace) {
      toast.error('请先选择工作区')
      return
    }

    try {
      const workspaceRoot = await window.electronAPI.getWorkspaceRootPath(workspace.slug)
      const dialog = await window.electronAPI.openFolderDialog()
      const plan = planOpenLocalFolder({ dialog, workspaceRoot })
      if (plan.kind === 'cancel') return

      const result = await window.electronAPI.projects.openOrCreateByPath(plan.workspaceRoot, plan.folderPath)
      const kanbanProject: KanbanProject = {
        id: result.project.id,
        slug: result.project.slug,
        name: result.project.name,
        description: result.project.description,
        workingDirectory: result.project.workingDirectory,
        details: result.project.details,
        color: result.project.color,
        updatedAt: result.project.updatedAt,
        archivedAt: result.project.archivedAt,
        defaultExpertId: result.project.defaultExpertId,
        workspaceId: result.project.workspaceId,
      }

      setProjects((prev) => {
        const without = prev.filter((project) => project.id !== kanbanProject.id)
        return [kanbanProject, ...without]
      })

      setCodeMainView('session')
      setActiveView('conversations')

      await createAgent({
        draft: true,
        projectId: kanbanProject.id,
        workspaceId: currentWorkspaceId ?? workspace.id,
      })

      if (result.created) {
        toast.success(`已创建项目「${kanbanProject.name}」`)
      }
    } catch (error) {
      console.error('[打开文件夹] 失败:', error)
      toast.error('打开文件夹失败', {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

