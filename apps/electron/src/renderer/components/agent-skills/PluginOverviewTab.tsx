import * as React from 'react'
import {
  ArrowRight,
  Blocks,
  CheckCircle2,
  Plug,
  Sparkles,
  Wrench,
} from 'lucide-react'
import type { PluginCenterTab } from '@/lib/plugin-center-model'
import type {
  PluginOverviewItem,
  PluginOverviewModel,
} from '@/lib/plugin-overview-model'

interface PluginOverviewTabProps {
  model: PluginOverviewModel
  onOpenTab: (tab: PluginCenterTab) => void
  onCreateExpert: () => void
}

export function PluginOverviewTab({
  model,
  onOpenTab,
  onCreateExpert,
}: PluginOverviewTabProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-6">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          label="已启用插件"
          value={model.summary.enabledPlugins}
          icon={<CheckCircle2 size={16} />}
        />
        <SummaryCard
          label="需处理连接器"
          value={model.summary.connectorsNeedingAttention}
          icon={<Plug size={16} />}
        />
        <SummaryCard
          label="可更新技能"
          value={model.summary.skillsWithUpdates}
          icon={<Sparkles size={16} />}
        />
        <SummaryCard
          label="内置能力"
          value={model.summary.builtinAbilities}
          icon={<Wrench size={16} />}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.25fr_0.9fr]">
        <Panel title="待处理" empty="暂无需要处理的插件。">
          {model.pendingItems.map((item) => (
            <OverviewRow key={item.id} item={item} onOpenTab={onOpenTab} />
          ))}
        </Panel>
        <Panel title="快捷入口">
          {model.quickActions.map((item) => (
            <OverviewRow
              key={item.id}
              item={item}
              onOpenTab={onOpenTab}
              onCreateExpert={onCreateExpert}
            />
          ))}
        </Panel>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Panel title="推荐插件">
          {model.recommendations.map((item) => (
            <OverviewRow key={item.id} item={item} onOpenTab={onOpenTab} />
          ))}
        </Panel>
        <Panel title="内置能力">
          {model.builtinAbilities.map((item) => (
            <OverviewRow key={item.id} item={item} onOpenTab={onOpenTab} />
          ))}
        </Panel>
      </section>
    </div>
  )
}

interface SummaryCardProps {
  label: string
  value: number
  icon: React.ReactNode
}

function SummaryCard({ label, value, icon }: SummaryCardProps): React.ReactElement {
  return (
    <div className="rounded-2xl bg-content-area p-4 shadow-sm">
      <div className="flex items-center justify-between text-foreground/45">
        <span className="text-xs font-medium">{label}</span>
        {icon}
      </div>
      <div className="mt-3 text-2xl font-semibold text-foreground">{value}</div>
    </div>
  )
}

interface PanelProps {
  title: string
  empty?: string
  children: React.ReactNode
}

function Panel({ title, empty, children }: PanelProps): React.ReactElement {
  const hasChildren = React.Children.count(children) > 0

  return (
    <section className="rounded-2xl bg-content-area p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <Blocks size={15} className="text-foreground/45" />
        {title}
      </div>
      <div className="flex flex-col gap-2">
        {hasChildren ? children : (
          <div className="rounded-xl bg-foreground/[0.04] p-3 text-sm text-foreground/50">
            {empty ?? '暂无内容'}
          </div>
        )}
      </div>
    </section>
  )
}

interface OverviewRowProps {
  item: PluginOverviewItem
  onOpenTab: (tab: PluginCenterTab) => void
  onCreateExpert?: () => void
}

function OverviewRow({
  item,
  onOpenTab,
  onCreateExpert,
}: OverviewRowProps): React.ReactElement {
  if (item.id === 'new-expert' && onCreateExpert) {
    return <ActionRow item={item} onClick={onCreateExpert} />
  }
  if (item.actionTab) {
    const actionTab = item.actionTab
    return <ActionRow item={item} onClick={() => onOpenTab(actionTab)} />
  }
  return (
    <div className="rounded-xl bg-foreground/[0.04] px-3 py-2">
      <RowText item={item} />
    </div>
  )
}

interface ActionRowProps {
  item: PluginOverviewItem
  onClick: () => void
}

function ActionRow({ item, onClick }: ActionRowProps): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center justify-between gap-3 rounded-xl bg-foreground/[0.04] px-3 py-2 text-left transition-[background-color,transform] duration-fast ease-out hover:bg-foreground/[0.07] active:scale-[var(--press-scale)]"
    >
      <RowText item={item} />
      <ArrowRight
        size={14}
        className="shrink-0 text-foreground/40 transition-transform duration-fast ease-out group-hover:translate-x-0.5"
      />
    </button>
  )
}

interface RowTextProps {
  item: PluginOverviewItem
}

function RowText({ item }: RowTextProps): React.ReactElement {
  return (
    <span className="min-w-0">
      <span className="block truncate text-sm font-medium text-foreground/85">
        {item.title}
      </span>
      <span className="block truncate text-xs text-foreground/50">
        {item.description}
      </span>
    </span>
  )
}
