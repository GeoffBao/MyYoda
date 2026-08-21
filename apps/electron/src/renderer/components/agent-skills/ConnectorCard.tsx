/**
 * ConnectorCard — 连接器 Tab 卡片（对标小米 Mico / PR #105）
 *
 * 顶部：品牌图标 + 名称 + 「查看详情」；中部 2 行描述；底部品类 + 状态/开关。
 * 整卡可点击打开详情；开关独立响应（阻止冒泡）。不在卡片上暴露 MCP/API 技术分类。
 */

import * as React from 'react'
import { Trash2 } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { getConnectorIcon } from '@/lib/builtin-mcp-icons'
import type { ConnectorItem, ConnectorStatus } from '@/lib/connectors-model'

interface ConnectorCardProps {
  item: ConnectorItem
  onOpen: () => void
  onToggle?: (enabled: boolean) => void
  onRequestDelete?: () => void
}

const STATUS_TONE_CLASSES: Record<ConnectorStatus, string> = {
  enabled: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  needs_config: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  needs_auth: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  missing_dep: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  connect_failed: 'bg-destructive/10 text-destructive',
  disabled: 'bg-foreground/5 text-muted-foreground',
}

export function ConnectorCard({
  item,
  onOpen,
  onToggle,
  onRequestDelete,
}: ConnectorCardProps): React.ReactElement {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      className={cn(
        'group relative flex h-full flex-col gap-3 rounded-2xl border border-border/60 bg-content-area p-4 text-left',
        'cursor-pointer transition-[border-color,box-shadow,transform] duration-fast ease-out',
        'hover:-translate-y-0.5 hover:border-border hover:shadow-md',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        item.status === 'disabled' && 'opacity-70',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.04]">
          {getConnectorIcon(item)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold text-foreground">{item.name}</div>
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{item.sourceLabel}</div>
        </div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpen() }}
          className="shrink-0 rounded-md border border-border/70 px-2 py-1 text-[11px] font-medium text-foreground/80 transition-[background-color,color] duration-fast ease-out hover:bg-foreground/[0.05]"
        >
          查看详情
        </button>
      </div>

      <p className="line-clamp-2 min-h-[40px] text-[13px] leading-5 text-muted-foreground">
        {item.description || '\u00A0'}
      </p>

      <div className="mt-auto flex items-center justify-between gap-2">
        <span className="rounded-full bg-foreground/[0.05] px-2 py-0.5 text-[11px] font-medium text-foreground/70">
          {item.categoryLabel}
        </span>
        <div className="flex items-center gap-1.5">
          {item.statusLabel && (
            <span className={cn('rounded-md px-1.5 py-0.5 text-[11px] font-medium', STATUS_TONE_CLASSES[item.status])}>
              {item.statusLabel}
            </span>
          )}
          {onToggle && (
            <Switch
              checked={item.enabled}
              onCheckedChange={onToggle}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              className="shrink-0"
            />
          )}
          {onRequestDelete && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={`移除连接器 ${item.name}`}
                  onClick={(e) => { e.stopPropagation(); onRequestDelete() }}
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground/60 opacity-0 transition-[opacity,background-color,color] duration-fast ease-out hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                >
                  <Trash2 size={14} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">移除</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  )
}
