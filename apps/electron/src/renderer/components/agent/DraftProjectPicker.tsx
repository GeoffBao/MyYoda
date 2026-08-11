/**
 * DraftProjectPicker — Draft 会话首条发送前可选/改绑 Project
 * 复用共享 ProjectContextPicker（session 模式可跳过）
 */

import * as React from 'react'
import { ProjectContextPicker } from '@/components/app-shell/ProjectContextPicker'
import { useBindSessionProject } from '@/hooks/useBindSessionProject'
import { canBindProjectBeforeSend } from './draft-session-lifecycle'

export interface DraftProjectPickerProps {
  sessionId: string
  projectId?: string
  isDraft: boolean
  className?: string
  /** 挂载时自动展开一次「新建项目」表单（整个工作区首次建会话的引导） */
  autoOpenCreate?: boolean
  onAutoOpenHandled?: () => void
}

export function DraftProjectPicker({
  sessionId,
  projectId,
  isDraft,
  className,
  autoOpenCreate,
  onAutoOpenHandled,
}: DraftProjectPickerProps): React.ReactElement | null {
  const bindProject = useBindSessionProject(sessionId)

  if (!canBindProjectBeforeSend({ projectId, isDraft })) return null

  return (
    <ProjectContextPicker
      mode="session"
      selectedProjectId={projectId}
      onSelect={bindProject}
      className={className}
      autoOpenCreate={autoOpenCreate}
      onAutoOpenHandled={onAutoOpenHandled}
    />
  )
}
