import * as React from 'react'
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Globe,
  Plug,
  Sparkles,
  Users,
  Wrench,
} from 'lucide-react'
import type { PluginCenterTab } from '@/lib/plugin-center-model'
import type {
  PluginOverviewAction,
  PluginOverviewItem,
  PluginOverviewModel,
} from '@/lib/plugin-overview-model'

interface PluginOverviewHandlers {
  onOpenTab: (tab: PluginCenterTab) => void
  onCreateExpert: () => void
  onOpenConnector?: (connectorId: string) => void
  onOpenCommunityMarket?: () => void
  onOpenMessaging?: () => void
}

interface PluginOverviewTabProps extends PluginOverviewHandlers {
  model: PluginOverviewModel
}

function dispatchOverviewItem(
  item: PluginOverviewItem,
  handlers: PluginOverviewHandlers,
): void {
  const action: PluginOverviewAction | undefined = item.action
    ?? (item.actionConnectorId ? 'open-connector' : item.actionTab ? 'open-tab' : undefined)
  switch (action) {
    case 'open-community-market':
      handlers.onOpenCommunityMarket?.()
      return
    case 'open-messaging':
      handlers.onOpenMessaging?.()
      return
    case 'create-expert':
      handlers.onCreateExpert()
      return
    case 'open-connector':
      if (item.actionConnectorId) handlers.onOpenConnector?.(item.actionConnectorId)
      return
    case 'open-tab':
      if (item.actionTab) handlers.onOpenTab(item.actionTab)
      return
    case undefined:
      if (item.id === 'new-expert') handlers.onCreateExpert()
      return
    default: {
      const _exhaustive: never = action
      return _exhaustive
    }
  }
}

export function PluginOverviewTab({
  model,
  onOpenTab,
  onCreateExpert,
  onOpenConnector,
  onOpenCommunityMarket,
  onOpenMessaging,
}: PluginOverviewTabProps): React.ReactElement {
  const handlers: PluginOverviewHandlers = {
    onOpenTab,
    onCreateExpert,
    onOpenConnector,
    onOpenCommunityMarket,
    onOpenMessaging,
  }
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-wrap gap-2">
        <StatChip
          label="已启用"
          value={model.summary.enabledPlugins}
        />
        <StatChip
          label="需配置"
          value={model.summary.connectorsNeedingAttention}
          tone={model.summary.connectorsNeedingAttention > 0 ? 'warning' : 'default'}
          onClick={() => onOpenTab('connectors')}
        />
        <StatChip
          label="可更新技能"
          value={model.summary.skillsWithUpdates}
          onClick={() => onOpenTab('skills')}
        />
        <StatChip
          label="内置能力"
          value={model.summary.builtinAbilities}
        />
      </section>

      {model.pendingItems.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionTitle>待处理</SectionTitle>
          <div className="flex flex-col gap-2">
            {model.pendingItems.map((item) => (
              <PendingRow
                key={item.id}
                item={item}
                onActivate={() => dispatchOverviewItem(item, handlers)}
              />
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <SectionTitle>快捷入口</SectionTitle>
        <div className="flex flex-wrap gap-2">
          {model.quickActions.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => dispatchOverviewItem(item, handlers)}
              className="rounded-full bg-foreground/[0.05] px-3 py-1.5 text-[13px] font-medium text-foreground/85 transition-[background-color,transform] duration-fast ease-out hover:bg-foreground/[0.08] active:scale-[var(--press-scale)]"
            >
              {item.title}
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle>推荐</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {model.recommendations.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => dispatchOverviewItem(item, handlers)}
              className="group flex flex-col gap-2 rounded-2xl border border-border/60 bg-content-area p-4 text-left transition-[border-color,box-shadow,transform] duration-fast ease-out hover:-translate-y-0.5 hover:border-border hover:shadow-md active:scale-[var(--press-scale)]"
            >
              <div className="flex size-9 items-center justify-center rounded-xl bg-foreground/[0.05] text-foreground/70">
                <RecommendationIcon id={item.id} />
              </div>
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-foreground">{item.title}</div>
                <div className="mt-0.5 line-clamp-2 text-[12px] leading-5 text-muted-foreground">
                  {item.description}
                </div>
              </div>
              <span className="text-[11px] font-medium text-primary opacity-70 transition-opacity duration-fast group-hover:opacity-100">
                {item.actionLabel ?? '查看'} →
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle>内置能力</SectionTitle>
        <div className="flex flex-wrap gap-2">
          {model.builtinAbilities.map((item) => (
            <span
              key={item.id}
              className="inline-flex items-center gap-2 rounded-full bg-foreground/[0.05] px-3 py-1.5 text-[13px] text-foreground/80"
            >
              <BuiltinIcon id={item.id} />
              <span className="font-medium">{item.title}</span>
              <span className="text-[11px] text-foreground/45">{item.description}</span>
            </span>
          ))}
        </div>
      </section>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }): React.ReactElement {
  return <h2 className="text-sm font-semibold text-foreground">{children}</h2>
}

function StatChip({
  label,
  value,
  tone = 'default',
  onClick,
}: {
  label: string
  value: number
  tone?: 'default' | 'warning'
  onClick?: () => void
}): React.ReactElement {
  const className = cnStat(tone, !!onClick)
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        <span className="text-[11px] text-foreground/50">{label}</span>
        <span className="text-[15px] font-semibold tabular-nums">{value}</span>
      </button>
    )
  }
  return (
    <div className={className}>
      <span className="text-[11px] text-foreground/50">{label}</span>
      <span className="text-[15px] font-semibold tabular-nums">{value}</span>
    </div>
  )
}

function cnStat(tone: 'default' | 'warning', clickable: boolean): string {
  return [
    'inline-flex items-center gap-2 rounded-full px-3 py-1.5',
    tone === 'warning' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400' : 'bg-foreground/[0.05] text-foreground',
    clickable ? 'transition-[background-color,transform] duration-fast ease-out hover:bg-foreground/[0.08] active:scale-[var(--press-scale)]' : '',
  ].join(' ')
}

function PendingRow({
  item,
  onActivate,
}: {
  item: PluginOverviewItem
  onActivate: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onActivate}
      className="group flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-content-area px-4 py-3 text-left transition-[border-color,background-color,transform] duration-fast ease-out hover:border-border hover:bg-foreground/[0.03] active:scale-[var(--press-scale)]"
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-foreground">{item.title}</span>
        <span className="block truncate text-[12px] text-foreground/50">{item.description}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-primary">
        {item.actionLabel ?? '去处理'}
        <ArrowRight size={14} className="transition-transform duration-fast ease-out group-hover:translate-x-0.5" />
      </span>
    </button>
  )
}

function RecommendationIcon({ id }: { id: string }): React.ReactElement {
  switch (id) {
    case 'chrome-devtools':
      return <Globe size={16} />
    case 'web-search':
      return <Sparkles size={16} />
    case 'nano-banana':
      return <Plug size={16} />
    default:
      return <CheckCircle2 size={16} />
  }
}

function BuiltinIcon({ id }: { id: string }): React.ReactElement {
  switch (id) {
    case 'automation':
      return <CalendarClock size={13} className="text-foreground/45" />
    case 'collaboration':
      return <Users size={13} className="text-foreground/45" />
    case 'create-task':
      return <ClipboardList size={13} className="text-foreground/45" />
    case 'managed-browser':
      return <Globe size={13} className="text-foreground/45" />
    case 'planning':
      return <Wrench size={13} className="text-foreground/45" />
    default:
      return <Wrench size={13} className="text-foreground/45" />
  }
}
