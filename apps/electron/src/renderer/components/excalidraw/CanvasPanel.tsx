/**
 * CanvasPanel — 文档槽内嵌画布面板
 *
 * 复用 ExcalidrawEditor 的受控模式，在右侧工作区"文档槽"内展示画布，
 * 不经过全屏画廊路由。每会话记住当前打开的画布文件（canvasFileMapAtom），
 * 关闭后再打开可以恢复到原来的画布。
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { agentWorkspacesAtom, currentAgentWorkspaceIdAtom } from '@/atoms/agent-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { canvasFileMapAtom, canvasPanelOpenMapAtom } from '@/atoms/canvas-panel-atoms'
import { ExcalidrawEditor } from './ExcalidrawEditor'

interface CanvasPanelProps {
  sessionId: string
}

export function CanvasPanel({ sessionId }: CanvasPanelProps): React.ReactElement {
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const workspaceSlug = React.useMemo(() => {
    if (!currentWorkspaceId) return null
    return workspaces.find((w) => w.id === currentWorkspaceId)?.slug ?? null
  }, [currentWorkspaceId, workspaces])

  const [canvasFileMap, setCanvasFileMap] = useAtom(canvasFileMapAtom)
  const setCanvasOpenMap = useSetAtom(canvasPanelOpenMapAtom)
  const setActiveView = useSetAtom(activeViewAtom)

  const current = canvasFileMap.get(sessionId) ?? null

  const handleSlugChange = React.useCallback(
    (ref: { slug: string; title: string }) => {
      if (!workspaceSlug) return
      setCanvasFileMap((prev) => {
        const next = new Map(prev)
        next.set(sessionId, { workspaceSlug, slug: ref.slug })
        return next
      })
    },
    [sessionId, workspaceSlug, setCanvasFileMap],
  )

  const handleExit = React.useCallback(() => {
    setCanvasOpenMap((prev) => {
      const next = new Map(prev)
      next.set(sessionId, false)
      return next
    })
  }, [sessionId, setCanvasOpenMap])

  const handleBrowseAll = React.useCallback(() => {
    setActiveView('excalidraw-gallery')
  }, [setActiveView])

  if (!workspaceSlug) {
    return <div className="flex items-center justify-center h-full text-foreground/40 text-sm">画布不可用：当前会话未绑定工作区</div>
  }

  return (
    <div className="flex flex-col h-full min-w-0 overflow-hidden titlebar-no-drag">
      <ExcalidrawEditor
        // sessionId 变化时整体重新挂载，避免残留上一个会话的编辑器内部状态（对齐
        // ExcalidrawView.tsx 里 key={currentWorkspaceId} 的既有约定）。
        key={sessionId}
        controlledSlug={current?.slug ?? null}
        onExit={handleExit}
        onSlugChange={handleSlugChange}
        onBrowseAll={handleBrowseAll}
      />
    </div>
  )
}
