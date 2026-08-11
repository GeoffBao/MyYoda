/**
 * WorkspaceSwitcher — Agent 侧栏顶层工作区选择器
 * 左侧 Layers 图标，右侧 Lucide ChevronDown（禁止 Unicode ▾）
 */

import * as React from 'react'
import { ChevronDown, Layers, Plus, Trash2 } from 'lucide-react'
import type { AgentWorkspace } from '@myyoda/shared'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export interface WorkspaceSwitcherProps {
  workspaces: AgentWorkspace[]
  currentWorkspaceId: string | null
  onSelect: (workspaceId: string) => void
  onCreate?: () => void
  /** 删除指定工作区（默认工作区 / 最后一个不可删由 canDeleteWorkspace 控制） */
  onRequestDelete?: (workspaceId: string) => void
  canDeleteWorkspace?: (workspace: AgentWorkspace) => boolean
  className?: string
}

export function WorkspaceSwitcher({
  workspaces,
  currentWorkspaceId,
  onSelect,
  onCreate,
  onRequestDelete,
  canDeleteWorkspace,
  className,
}: WorkspaceSwitcherProps): React.ReactElement {
  const current = workspaces.find((workspace) => workspace.id === currentWorkspaceId) ?? workspaces[0]
  const showFooter = Boolean(onCreate || onRequestDelete)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex w-full items-center gap-2 h-9 px-2.5 rounded-[10px] text-[13px] font-medium',
            'text-foreground/80 sidebar-control-surface hover:text-foreground transition-colors titlebar-no-drag',
            className,
          )}
          aria-label="切换工作区"
        >
          <Layers size={14} className="shrink-0 text-foreground/45" />
          <span className="flex-1 min-w-0 truncate text-left">
            {current?.name ?? '工作区'}
          </span>
          <ChevronDown size={14} className="shrink-0 text-foreground/35" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="z-[9999] w-[var(--radix-dropdown-menu-trigger-width)] min-w-[220px]">
        {workspaces.map((workspace) => {
          const deletable = Boolean(
            onRequestDelete
            && canDeleteWorkspace?.(workspace),
          )
          return (
            <DropdownMenuItem
              key={workspace.id}
              onSelect={() => onSelect(workspace.id)}
              className={cn('group/item pr-1', workspace.id === current?.id && 'bg-accent')}
            >
              <Layers size={14} className="mr-2 shrink-0 text-foreground/45" />
              <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
              {deletable && (
                <button
                  type="button"
                  className="ml-1 flex size-6 shrink-0 items-center justify-center rounded-md text-foreground/35 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover/item:opacity-100 focus-visible:opacity-100"
                  aria-label={`删除「${workspace.name}」`}
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    onRequestDelete?.(workspace.id)
                  }}
                  onPointerDown={(event) => {
                    // 阻止 Radix 先选中再关菜单，保证点垃圾桶直接删
                    event.preventDefault()
                    event.stopPropagation()
                  }}
                >
                  <Trash2 size={13} />
                </button>
              )}
            </DropdownMenuItem>
          )
        })}
        {showFooter && <DropdownMenuSeparator />}
        {onCreate && (
          <DropdownMenuItem
            onSelect={() => {
              // 菜单正常关闭；输入框不再靠 onBlur 关闭，避免 focus 回 trigger 时被立刻拆掉
              window.setTimeout(() => onCreate(), 0)
            }}
          >
            <Plus size={14} className="mr-2" />
            新建工作区
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
