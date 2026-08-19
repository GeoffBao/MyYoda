/**
 * ConnectorCard — 连接器 Tab 的卡片（对标小米 Mico 连接器市场）
 *
 * 布局：顶部图标 + 名称 + 「查看详情」按钮；中部 2 行描述；底部品类标签 + 状态徽标/开关。
 * 整卡可点击打开详情；开关独立响应（阻止冒泡）。
 */

import * as React from 'react'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

export type ConnectorStatusTone = 'success' | 'warning' | 'muted'

interface ConnectorCardProps {
  /** 卡片唯一标识（React key 之外用于无障碍） */
  id: string
  name: string
  description?: string
  /** 品牌图标节点（预置连接器必须传官方图标） */
  icon: React.ReactNode
  /** 底部品类标签文案，如「协作办公」「研发与交付」 */
  categoryLabel: string
  /** 状态徽标文案，如「已启用」「需配置」「可用」 */
  statusLabel?: string
  statusTone?: ConnectorStatusTone
  /** 来源标注（官方/自研），显示在名称旁 */
  vendorLabel?: string
  /** 开关状态（不传 onToggle 则不渲染开关） */
  enabled?: boolean
  onOpen: () => void
  onToggle?: (enabled: boolean) => void
}

const STATUS_TONE_CLASSES: Record<ConnectorStatusTone, string> = {
  success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  muted: 'bg-foreground/5 text-muted-foreground',
}

export function ConnectorCard({
  id,
  name,
  description,
  icon,
  categoryLabel,
  statusLabel,
  statusTone = 'muted',
  vendorLabel,
  enabled,
  onOpen,
  onToggle,
}: ConnectorCardProps): React.ReactElement {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${name}，查看详情`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      className={cn(
        'group relative flex h-full flex-col gap-3 rounded-2xl border border-border/60 bg-background p-4 text-left',
        'transition-[border-color,box-shadow,transform] duration-fast cursor-pointer',
        'hover:-translate-y-0.5 hover:border-border hover:shadow-md',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
      )}
      data-connector-card={id}
    >
      {/* 顶部：图标 + 名称 + 查看详情 */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-content-area shadow-sm">
            {icon}
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <h3 className="line-clamp-2 min-h-[2.625rem] text-[15px] font-semibold leading-snug text-foreground">{name}</h3>
            {vendorLabel && (
              <span
                className={cn(
                  'w-fit rounded px-1 py-px text-[10px] font-medium',
                  vendorLabel === '官方'
                    ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                    : 'bg-foreground/5 text-muted-foreground',
                )}
              >
                {vendorLabel}
              </span>
            )}
          </div>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-lg border border-border/70 bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground',
            'opacity-0 transition-opacity duration-fast group-hover:opacity-100',
          )}
        >
          查看详情
        </span>
      </div>

      {/* 描述 */}
      <p className="line-clamp-2 min-h-[2.25rem] text-[13px] leading-snug text-muted-foreground">
        {description || '\u00A0'}
      </p>

      {/* 底部：品类标签 + 状态/开关 */}
      <div className="mt-auto flex items-center justify-between gap-2">
        <span className="truncate rounded-full bg-accent/60 px-2 py-0.5 text-[11px] font-medium text-accent-foreground">
          {categoryLabel}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          {statusLabel && (
            <span className={cn('rounded-md px-1.5 py-0.5 text-[11px] font-medium', STATUS_TONE_CLASSES[statusTone])}>
              {statusLabel}
            </span>
          )}
          {onToggle && (
            <Switch
              checked={enabled ?? false}
              onCheckedChange={onToggle}
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </div>
      </div>
    </div>
  )
}
