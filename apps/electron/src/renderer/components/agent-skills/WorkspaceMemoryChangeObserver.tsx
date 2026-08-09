import * as React from 'react'
import { useSetAtom } from 'jotai'
import { workspaceMemoryChangesAtom } from '@/atoms/memory-change-atoms'

/** 即使右侧文件面板未打开，也持续观测当前选中的工作区。 */
export function WorkspaceMemoryChangeObserver({ workspaceSlug }: { workspaceSlug: string }): null {
  const setUpdatesByWorkspace = useSetAtom(workspaceMemoryChangesAtom)

  React.useEffect(() => {
    return window.electronAPI.subscribeWorkspaceMemoryChanges(workspaceSlug, (change) => {
      setUpdatesByWorkspace((previous) => {
        const next = new Map(previous)
        const existing = next.get(workspaceSlug) ?? []
        next.set(workspaceSlug, [
          change,
          ...existing.filter((item) => item.relativePath !== change.relativePath),
        ].slice(0, 8))
        return next
      })
    })
  }, [setUpdatesByWorkspace, workspaceSlug])

  return null
}
