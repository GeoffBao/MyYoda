/**
 * NewTaskProjectFlowDialog — 新任务流第一步：选择 Craft Project
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
  selectedProjectIdAtom,
} from '@/atoms/project-atoms'
import { activeViewAtom } from '@/atoms/active-view'

export function NewTaskProjectFlowDialog(): React.ReactElement {
  const [open, setOpen] = useAtom(newTaskProjectFlowOpenAtom)
  const setPendingEditor = useSetAtom(pendingTaskEditorTargetAtom)
  const setSelectedProjectId = useSetAtom(selectedProjectIdAtom)
  const setCodeMainView = useSetAtom(codeMainViewAtom)
  const setActiveView = useSetAtom(activeViewAtom)

  const handleSelect = React.useCallback(async (projectId: string | null): Promise<void> => {
    setSelectedProjectId(projectId)
    setPendingEditor({ mode: 'create', initialProjectId: projectId ?? undefined })
    setCodeMainView('tasks')
    setActiveView('conversations')
    setOpen(false)
  }, [
    setActiveView,
    setCodeMainView,
    setOpen,
    setPendingEditor,
    setSelectedProjectId,
  ])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新建任务</DialogTitle>
          <DialogDescription>
            选择任务所属项目；项目由当前工作区统一管理。
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
