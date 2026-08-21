/**
 * AddConnectorMenu — 「添加连接器」下拉：本地/远程服务 或 自定义 HTTP。
 * 不假装能从市场安装 GitHub/Notion。
 */

import * as React from 'react'
import { ChevronDown, Plus } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

interface AddConnectorMenuProps {
  onAddMcp: () => void
  onAddHttp: () => void
  className?: string
}

export function AddConnectorMenu({
  onAddMcp,
  onAddHttp,
  className,
}: AddConnectorMenuProps): React.ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground shadow-sm',
            'transition-[background-color,transform] duration-fast ease-out hover:bg-primary/90 active:scale-[var(--press-scale)]',
            className,
          )}
        >
          <Plus size={14} />
          <span>添加连接器</span>
          <ChevronDown size={12} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onAddMcp}>
          本地或远程服务
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onAddHttp}>
          自定义 HTTP
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
