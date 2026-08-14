/**
 * NewTaskProjectFlowDialog — 新任务流第一步：选择任务归属工作区（项目=工作区）
 */

import * as React from 'react'
import { useAtom, useSetAtom } from 'jotai'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { ProjectContextPicker } from '@/components/app-shell/ProjectContextPicker'
import { newTaskProjectFlowOpenAtom } from '@/atoms/project-context-picker'
import {
  codeMainViewAtom,
  pendingTaskEditorTargetAtom,
} from '@/atoms/project-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { useWorkspaceActions } from '@/hooks/useWorkspaceActions'

export function NewTaskProjectFlowDialog(): React.ReactElement {
  const [open, setOpen] = useAtom(newTaskProjectFlowOpenAtom)
  const setPendingEditor = useSetAtom(pendingTaskEditorTargetAtom)
  const setCodeMainView = useSetAtom(codeMainViewAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const { selectWorkspace } = useWorkspaceActions()

  /** 选择工作区（任务归属）：切换到该工作区，再打开任务编辑器（默认落在当前工作区） */
  const handleSelect = React.useCallback(async (workspaceId: string | null): Promise<void> => {
    if (workspaceId) selectWorkspace(workspaceId)
    setPendingEditor({ mode: 'create' })
    setCodeMainView('tasks')
    setActiveView('conversations')
    setOpen(false)
  }, [
    selectWorkspace,
    setActiveView,
    setCodeMainView,
    setOpen,
    setPendingEditor,
  ])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新建任务</DialogTitle>
          <DialogDescription>
            选择任务归属的工作区（项目）；任务会话与产物将落在此工作区。
          </DialogDescription>
        </DialogHeader>
        <ProjectContextPicker
          mode="task"
          defaultOpen
          onSelect={handleSelect}
        />
      </DialogContent>
    </Dialog>
  )
}
