/**
 * LocalProjectBadge — 「本地项目」徽章
 *
 * 移植自 Proma `components/agent/LocalProjectBadge.tsx`：标记一个嵌套 Project 绑定了真实本地目录
 * （`KanbanProject.workingDirectory`）。v1 只做同步的存在性判断，不做目录可用性异步探测
 * （Proma 版本支持 missing/not_directory/unavailable 三态提示，这里为了在下拉列表里零额外 IPC
 *  开销而简化为「有/无」；目录失效的场景仍可在 Project 设置页看到明确提示）。
 */

import type * as React from 'react'
import { cn } from '@/lib/utils'

interface LocalProjectBadgeProps {
  workingDirectory?: string | null
  className?: string
}

export function LocalProjectBadge({ workingDirectory, className }: LocalProjectBadgeProps): React.ReactElement | null {
  if (!workingDirectory) return null

  return (
    <span
      title={workingDirectory}
      className={cn(
        'inline-flex shrink-0 items-center rounded-full bg-secondary px-1.5 py-0 text-[10px] font-medium leading-4 text-muted-foreground',
        className,
      )}
    >
      本地项目
    </span>
  )
}
