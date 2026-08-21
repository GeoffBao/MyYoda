/**
 * ConnectorCard — 插件中心连接器卡片（商店风）
 *
 * 整卡可点击打开详情；右上角开关独立响应（阻止冒泡）。
 * 无 `onToggle` 时不渲染 Switch。
 */

import * as React from 'react'
import { CheckCircle2, Plug, Trash2, XCircle } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { ConnectorItem, ConnectorKind, ConnectorStatus } from '@/lib/connectors-model'

interface ConnectorCardProps {
  item: ConnectorItem
  onOpen: () => void
  onToggle?: (enabled: boolean) => void
  /** 仅 user-mcp 传入；点击后由父级 ConfirmDialog 确认删除 */
  onRequestDelete?: () => void
}

/** ConnectorKind 中文徽章，禁止直接渲染 `item.kind` */
export function connectorKindLabel(kind: ConnectorKind): string {
  switch (kind) {
    case 'builtin-mcp':
      return '内置 MCP'
    case 'user-mcp':
      return '我的 MCP'
    case 'api-tool':
      return 'API 工具'
    case 'custom-http':
      return '自定义 HTTP'
    default: {
      const _exhaustive: never = kind
      return _exhaustive
    }
  }
}

function ConnectorStatusIcon({ status }: { status: ConnectorStatus }): React.ReactElement {
  switch (status) {
    case 'enabled':
      return <CheckCircle2 size={12} />
    case 'needs_config':
    case 'disabled':
      return <XCircle size={12} />
    default: {
      const _exhaustive: never = status
      return _exhaustive
    }
  }
}

export function ConnectorCard({ item, onOpen, onToggle, onRequestDelete }: ConnectorCardProps): React.ReactElement {
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
        'group relative flex h-full cursor-pointer flex-col gap-3 rounded-xl border border-border/60 bg-content-area p-4 text-left',
        'transition-[border-color,box-shadow,background-color] duration-fast ease-out',
        'hover:border-border hover:shadow-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        item.status === 'disabled' && 'opacity-55',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary shadow-sm">
          <Plug size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="line-clamp-1 text-sm font-medium text-foreground">{item.name}</div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">{item.categoryLabel}</div>
        </div>
        {onToggle && (
          <Switch
            checked={item.enabled}
            onCheckedChange={onToggle}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            className="shrink-0"
          />
        )}
      </div>

      <p className="line-clamp-2 min-h-[40px] text-[13px] leading-6 text-muted-foreground">
        {item.description || '暂无描述'}
      </p>

      <div className="mt-auto flex items-center justify-between gap-2">
        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
          {connectorKindLabel(item.kind)}
        </span>
        <div className="flex items-center gap-1">
          {onRequestDelete && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onRequestDelete() }}
                  className="rounded p-1 text-muted-foreground/50 opacity-0 transition-[opacity,color,transform] duration-fast ease-out hover:text-destructive group-hover:opacity-100"
                >
                  <Trash2 size={14} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">删除</TooltipContent>
            </Tooltip>
          )}
          <span
            className={cn(
              'flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium',
              item.status === 'enabled' && 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
              item.status === 'needs_config' && 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
              item.status === 'disabled' && 'bg-muted text-muted-foreground',
            )}
          >
            <ConnectorStatusIcon status={item.status} />
            {item.statusLabel}
          </span>
        </div>
      </div>
    </div>
  )
}
