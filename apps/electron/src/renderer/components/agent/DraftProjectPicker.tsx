/**
 * DraftProjectPicker — Draft 会话首条发送前可选/改绑工作区（项目=工作区）
 * 复用共享 ProjectContextPicker（session 模式可跳过）
 */

import * as React from 'react'
import { ProjectContextPicker } from '@/components/app-shell/ProjectContextPicker'
import { useBindSessionWorkspace } from '@/hooks/useBindSessionWorkspace'
import { canBindProjectBeforeSend } from './draft-session-lifecycle'

export interface DraftProjectPickerProps {
  sessionId: string
  /** 会话当前归属的工作区 ID */
  workspaceId?: string
  isDraft: boolean
  className?: string
  /** 挂载时自动展开一次「新建项目」表单（整个工作区首次建会话的引导） */
  autoOpenCreate?: boolean
  onAutoOpenHandled?: () => void
}

export function DraftProjectPicker({
  sessionId,
  workspaceId,
  isDraft,
  className,
  autoOpenCreate,
  onAutoOpenHandled,
}: DraftProjectPickerProps): React.ReactElement | null {
  const bindWorkspace = useBindSessionWorkspace(sessionId)

  if (!canBindProjectBeforeSend({ projectId: workspaceId, isDraft })) return null

  return (
    <ProjectContextPicker
      mode="session"
      selectedWorkspaceId={workspaceId}
      onSelect={bindWorkspace}
      className={className}
      autoOpenCreate={autoOpenCreate}
      onAutoOpenHandled={onAutoOpenHandled}
    />
  )
}
