/**
 * SidebarToggleButton — 折叠/展开左侧边栏（共享组件）
 *
 * 对齐 Codex / macOS Finder 心智：
 * - 侧边栏**展开**时，按钮渲染在 LeftSidebar 顶部红绿灯行右端（见 LeftSidebar.tsx）
 * - 侧边栏**收起**时，按钮渲染在 TabBar 最左（红绿灯右侧，见 TabBar.tsx）
 * 同一时刻只出现一处；⌘B 快捷键逻辑在 GlobalShortcuts.tsx，与本按钮解耦。
 *
 * 纯点击切换，无悬停自动预览（历史上悬停浮层被 z-index portal 抢事件等问题反复卡住，
 * 权衡后只保留最简单可靠的点击展开/收起，同 VS Code）。
 */

import * as React from 'react'
import { useAtom } from 'jotai'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { sidebarCollapsedAtom } from '@/atoms/tab-atoms'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export function SidebarToggleButton({ className }: { className?: string }): React.ReactElement {
  const [sidebarCollapsed, setSidebarCollapsed] = useAtom(sidebarCollapsedAtom)
  const shortcutLabel = navigator.platform.includes('Mac') ? '⌘B' : 'Ctrl+Shift+E'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={sidebarCollapsed ? `展开侧边栏 (${shortcutLabel})` : `收起侧边栏 (${shortcutLabel})`}
          className={cn('relative h-7 w-7 titlebar-no-drag', className)}
          onClick={() => setSidebarCollapsed((prev) => !prev)}
        >
          {sidebarCollapsed ? <PanelLeftOpen className="size-3.5" /> : <PanelLeftClose className="size-3.5" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {sidebarCollapsed ? `展开侧边栏 (${shortcutLabel})` : `收起侧边栏 (${shortcutLabel})`}
      </TooltipContent>
    </Tooltip>
  )
}
