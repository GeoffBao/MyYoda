/**
 * UsageSettings — 「用量」统计设置面板
 *
 * 跨会话聚合 Agent 用量：Overview（八宫格指标 + 贡献热力图）与 Models（按天堆叠柱状图
 * + 按模型明细表）。数据来自新增的主进程聚合层 getAgentUsageStats()，按 All/30d/7d 三档过滤。
 *
 * 数据口径（与聚合层一致）：
 * - Total tokens / 成本只从 result 消息累加（权威的每次运行用量）
 * - Messages = user + assistant 消息数
 * - 热力图 / 按天堆叠 / streak / peak hour 均由 _createdAt 推导
 */

import * as React from 'react'
import { BarChart3, RefreshCw, Activity, Layers, MessageSquare, Flame, TrendingUp, Clock, Star, Hash, Sun, Database } from 'lucide-react'
import { PROVIDER_LABELS, type ProviderType } from '@myyoda/shared'
import {
  SettingsSection,
  SettingsCard,
} from './primitives'
import { Button } from '../ui/button'
import { cn } from '@/lib/utils'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs'
import { ChannelBalanceSection } from './ChannelBalanceSection'

/** 时间范围 */
type UsageRange = 'all' | '30d' | '7d' | 'month'

/** 与主进程聚合层返回结构一致的本地类型 */
interface UsageDayPoint {
  day: string
  messages: number
  totalTokens: number
  models: Array<{ modelId: string; totalTokens: number; inputTokens: number; outputTokens: number }>
}

interface UsageModelRow {
  modelId: string
  provider?: ProviderType
  /** 该模型 result 调用次数 */
  resultCount: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  totalTokens: number
  costUsd: number
}

interface UsageOverview {
  sessions: number
  messages: number
  totalTokens: number
  cacheReadTokens: number
  activeDays: number
  currentStreak: number
  longestStreak: number
  peakHour: number
  favoriteModel?: string
}

interface UsageTodayModel {
  modelId: string
  provider?: ProviderType
  totalTokens: number
}

interface UsageToday {
  day: string
  messages: number
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  costUsd: number
  models: UsageTodayModel[]
}

interface AgentUsageStats {
  range: UsageRange
  overview: UsageOverview
  days: UsageDayPoint[]
  models: UsageModelRow[]
  today: UsageToday
  fromCache: boolean
}

const RANGE_OPTIONS: Array<{ value: UsageRange; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'month', label: '本月' },
  { value: '30d', label: '30 天' },
  { value: '7d', label: '7 天' },
]

/** 颜色池（按模型自动分配） */
const MODEL_COLORS = [
  '#6366f1', // indigo
  '#0ea5e9', // sky
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#a855f7', // purple
  '#14b8a6', // teal
  '#f97316', // orange
  '#ec4899', // pink
  '#84cc16', // lime
]

function formatTokens(n: number): string {
  if (n <= 0) return '0'
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`
  return `${(n / 1_000_000).toFixed(2)}M`
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US')
}

function formatCost(n: number): string {
  if (n <= 0) return '—'
  if (n < 0.01) return `$${n.toFixed(4)}`
  return `$${n.toFixed(2)}`
}

function shortModelName(modelId: string): string {
  // 没有 modelUsage 也没有 _channelModelId 时的兜底 key，不直接把英文字面量甩给用户
  if (modelId === 'unknown') return '未知模型'
  // claude-sonnet-4-5-20250929 → claude-sonnet-4-5；deepseek-chat → deepseek-chat
  const cleaned = modelId.replace(/-\d{8,}$/, '')
  if (cleaned.length <= 22) return cleaned
  return cleaned.slice(0, 20) + '…'
}

/** 供应商展示名；缺失（旧数据 / 渠道信息未落盘）时统一显示"未知渠道"，不再泄露原始 channelId */
function providerLabel(provider?: ProviderType): string {
  return provider ? PROVIDER_LABELS[provider] : '未知渠道'
}

/** 本地日期 key（YYYY-MM-DD）→ "8月8日" */
function formatTodayDate(dayKey: string): string {
  const parts = dayKey.split('-').map(Number)
  const m = parts[1] ?? 1
  const d = parts[2] ?? 1
  return `${m}月${d}日`
}

/**
 * 「今日用量」强调条：固定显示，不随 Range（All/30d/7d）或子 Tab 切换而消失 —— 这是用户
 * 最常问的"我今天到底用了多少"，不该被埋进某个筛选态里才看得到。
 */
function TodayUsageStrip({ today }: { today: UsageToday | null }): React.ReactElement {
  const hasData = !!today && today.totalTokens > 0

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-primary/15 bg-primary/[0.04] p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Sun size={16} />
        </div>
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            今日用量{today ? ` · ${formatTodayDate(today.day)}` : ''}
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold tracking-tight tabular-nums">
              {hasData ? formatTokens(today!.totalTokens) : '0'}
            </span>
            <span className="text-xs text-muted-foreground">tokens</span>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pl-12 text-xs text-muted-foreground sm:pl-0">
        <span>{formatNumber(hasData ? today!.messages : 0)} 条消息</span>
        <span>缓存读取 {hasData ? formatTokens(today!.cacheReadTokens) : '0'}</span>
        <span>{hasData ? formatCost(today!.costUsd) : '—'}</span>
        {hasData &&
          today!.models.slice(0, 3).map((m, i) => (
            <span key={m.modelId} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: MODEL_COLORS[i % MODEL_COLORS.length] }}
              />
              {shortModelName(m.modelId)}
            </span>
          ))}
      </div>
    </div>
  )
}

/** Overview 八宫格 */
function OverviewGrid({ overview }: { overview: UsageOverview }): React.ReactElement {
  const peakHourLabel = overview.peakHour === 0 ? '午夜 0 点' : `${overview.peakHour} 时`
  const cells: Array<{ icon: React.ReactNode; label: string; value: string; sub?: string }> = [
    { icon: <Layers size={16} />, label: '会话', value: formatNumber(overview.sessions), sub: 'sessions' },
    { icon: <MessageSquare size={16} />, label: '消息', value: formatNumber(overview.messages), sub: 'messages' },
    { icon: <Activity size={16} />, label: '总 Token', value: formatTokens(overview.totalTokens), sub: '新消耗' },
    { icon: <Database size={16} />, label: '缓存读取', value: formatTokens(overview.cacheReadTokens), sub: 'cache read' },
    { icon: <CalendarIcon />, label: '活跃天数', value: formatNumber(overview.activeDays), sub: 'days' },
    { icon: <Flame size={16} />, label: '当前连续', value: `${overview.currentStreak}`, sub: 'streak' },
    { icon: <TrendingUp size={16} />, label: '最长连续', value: `${overview.longestStreak}`, sub: 'streak' },
    { icon: <Clock size={16} />, label: '高峰时段', value: peakHourLabel, sub: 'peak' },
    { icon: <Star size={16} />, label: '常用模型', value: overview.favoriteModel ? shortModelName(overview.favoriteModel) : '—', sub: 'model' },
  ]

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {cells.map((cell, i) => (
        <div
          key={i}
          className="flex flex-col justify-between gap-3 rounded-lg border border-border/60 bg-card p-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{cell.icon}</span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">{cell.sub}</span>
          </div>
          <div>
            <div className="truncate text-lg font-semibold tabular-nums" title={cell.value}>{cell.value}</div>
            <div className="text-xs text-muted-foreground">{cell.label}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

/** 自定义日历图标（lucide 无直接 CalendarCheck 需求，用简单矩形） */
function CalendarIcon(): React.ReactElement {
  return <Hash size={16} />
}

/** 图例 */
function HeatmapLegend({ className }: { className?: string }): React.ReactElement {
  return (
    <div className={cn('flex items-center gap-1', className)}>
      <span className="text-[10px] text-muted-foreground/60">少</span>
      {[0, 1, 2, 3, 4].map((l) => (
        <div
          key={l}
          className={cn(
            'h-3 w-3 rounded-[3px]',
            l === 0 && 'bg-muted',
            l === 1 && 'bg-indigo-200 dark:bg-indigo-950',
            l === 2 && 'bg-indigo-400 dark:bg-indigo-700',
            l === 3 && 'bg-indigo-500 dark:bg-indigo-500',
            l === 4 && 'bg-indigo-600 dark:bg-indigo-400',
          )}
        />
      ))}
      <span className="text-[10px] text-muted-foreground/60">多</span>
    </div>
  )
}

/** 7 天范围：单行横向日历，每天一格，占满宽度，避免 GitHub 网格一列太窄 */
function WeekStrip({ days }: { days: UsageDayPoint[] }): React.ReactElement {
  const byDay = new Map<string, UsageDayPoint>()
  for (const d of days) byDay.set(d.day, d)

  const end = new Date()
  end.setHours(0, 0, 0, 0)
  const start = new Date(end)
  start.setDate(start.getDate() - 6)

  const allDays: string[] = []
  const cursor = new Date(start)
  while (cursor <= end) {
    allDays.push(dayKeyOf(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }

  const maxTokens = Math.max(1, ...Array.from(byDay.values()).map((d) => d.totalTokens))

  const levelOf = (tokens: number): number => {
    if (tokens <= 0) return 0
    const ratio = tokens / maxTokens
    if (ratio < 0.25) return 1
    if (ratio < 0.5) return 2
    if (ratio < 0.75) return 3
    return 4
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-[6px]">
        {allDays.map((day) => {
          const p = byDay.get(day)
          const level = levelOf(p?.totalTokens ?? 0)
          const date = new Date(`${day}T00:00:00`)
          return (
            <div key={day} className="flex flex-1 flex-col items-center gap-1 min-w-0">
              <div
                title={p ? `${day} · ${formatTokens(p.totalTokens)} tokens · ${p.messages} 消息` : day}
                className={cn(
                  'w-full aspect-square min-w-[24px] max-w-[56px] rounded-[4px] transition-colors',
                  level === 0 && 'bg-muted',
                  level === 1 && 'bg-indigo-200 dark:bg-indigo-950',
                  level === 2 && 'bg-indigo-400 dark:bg-indigo-700',
                  level === 3 && 'bg-indigo-500 dark:bg-indigo-500',
                  level === 4 && 'bg-indigo-600 dark:bg-indigo-400',
                )}
              />
              <span className="truncate text-[10px] text-muted-foreground/60">
                {date.getMonth() + 1}/{date.getDate()}
              </span>
            </div>
          )
        })}
      </div>
      <div className="flex justify-between px-0.5">
        {allDays.map((day) => {
          const date = new Date(`${day}T00:00:00`)
          const label = ['日', '一', '二', '三', '四', '五', '六'][date.getDay()]
          return (
            <span key={day} className="flex-1 text-center text-[10px] text-muted-foreground/60">
              {label}
            </span>
          )
        })}
      </div>
      <HeatmapLegend className="mt-1 justify-end" />
    </div>
  )
}

/** GitHub 风格周网格：30 天 / 本月 / 全部；列少时自动放大，列多时保持紧凑可滚动 */
function GitHubHeatmap({ days, range }: { days: UsageDayPoint[]; range: UsageRange }): React.ReactElement {
  const byDay = new Map<string, UsageDayPoint>()
  for (const d of days) byDay.set(d.day, d)

  const allDays: string[] = []
  const end = new Date()
  end.setHours(0, 0, 0, 0)

  // 数据最早日期（days 倒序，最后一个是最早），用于「全部」收缩热力图跨度
  const dataStartDay = days.length > 0 ? days[days.length - 1]!.day : undefined

  let start: Date
  if (range === 'all') {
    // 「全部」从数据最早日期开始，而非固定 365 天，避免数据少时出现大片空白
    start = dataStartDay ? new Date(`${dataStartDay}T00:00:00`) : new Date(end)
  } else {
    const daysBack = range === '30d' ? 30 : end.getDate()
    start = new Date(end)
    start.setDate(start.getDate() - (daysBack - 1))
  }
  start.setHours(0, 0, 0, 0)

  // 将 start 对齐到周一
  const startDow = (start.getDay() + 6) % 7 // 0=Mon
  start.setDate(start.getDate() - startDow)

  const cursor = new Date(start)
  while (cursor <= end) {
    allDays.push(dayKeyOf(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }

  // 按周分列
  const weeks: string[][] = []
  for (let i = 0; i < allDays.length; i += 7) weeks.push(allDays.slice(i, i + 7))

  const maxTokens = Math.max(1, ...Array.from(byDay.values()).map((d) => d.totalTokens))

  const levelOf = (tokens: number): number => {
    if (tokens <= 0) return 0
    const ratio = tokens / maxTokens
    if (ratio < 0.25) return 1
    if (ratio < 0.5) return 2
    if (ratio < 0.75) return 3
    return 4
  }

  const WEEKDAY_LABELS = ['一', '三', '五']

  // 列少时放大格子、列多时保持紧凑，减少右侧留白
  const cellSizeClass =
    weeks.length <= 3
      ? 'min-w-[18px] max-w-[40px]'
      : weeks.length <= 6
        ? 'min-w-[14px] max-w-[28px]'
        : 'min-w-[10px] max-w-[22px]'

  return (
    <div
      className={cn(
        'flex gap-2 overflow-x-auto pb-1',
        weeks.length <= 6 ? 'justify-center' : 'justify-start',
      )}
    >
      {/* 左侧星期标 */}
      <div className="flex flex-col gap-[3px] pt-5 pr-1 shrink-0">
        {WEEKDAY_LABELS.map((l, i) => (
          <div key={i} className="flex h-3 items-center text-[10px] leading-none text-muted-foreground/60">
            {l}
          </div>
        ))}
      </div>
      <div className="flex gap-[3px]">
        {weeks.map((week, wi) => (
          <div key={wi} className={cn('flex flex-col gap-[3px]', weeks.length > 6 && 'shrink-0')}>
            {week.map((day) => {
              const p = byDay.get(day)
              const level = levelOf(p?.totalTokens ?? 0)
              return (
                <div
                  key={day}
                  title={p ? `${day} · ${formatTokens(p.totalTokens)} tokens · ${p.messages} 消息` : day}
                  className={cn(
                    'aspect-square rounded-[3px] transition-colors',
                    cellSizeClass,
                    level === 0 && 'bg-muted',
                    level === 1 && 'bg-indigo-200 dark:bg-indigo-950',
                    level === 2 && 'bg-indigo-400 dark:bg-indigo-700',
                    level === 3 && 'bg-indigo-500 dark:bg-indigo-500',
                    level === 4 && 'bg-indigo-600 dark:bg-indigo-400',
                  )}
                />
              )
            })}
          </div>
        ))}
      </div>
      <HeatmapLegend className="ml-2 items-end pb-0.5 shrink-0" />
    </div>
  )
}

/** 贡献热力图入口：7 天用横向日历，其他用 GitHub 风格周网格 */
function ContributionHeatmap({ days, range }: { days: UsageDayPoint[]; range: UsageRange }): React.ReactElement {
  if (range === '7d') {
    return <WeekStrip days={days} />
  }
  return <GitHubHeatmap days={days} range={range} />
}

function dayKeyOf(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 按天堆叠柱状图（顶部为模型累计） */
function StackedBarChart({ days, range }: { days: UsageDayPoint[]; range: UsageRange }): React.ReactElement {
  const ordered = [...days].reverse() // 升序展示（旧→新）
  const modelOrder = React.useMemo(() => {
    const totals = new Map<string, number>()
    for (const d of days) {
      for (const m of d.models) totals.set(m.modelId, (totals.get(m.modelId) ?? 0) + m.totalTokens)
    }
    return Array.from(totals.entries()).sort((a, b) => b[1] - a[1]).map(([id]) => id)
  }, [days])

  const colorOf = (modelId: string): string => {
    const idx = modelOrder.indexOf(modelId)
    return MODEL_COLORS[(idx < 0 ? 0 : idx) % MODEL_COLORS.length] ?? MODEL_COLORS[0]!
  }

  const maxTokens = Math.max(1, ...days.map((d) => d.totalTokens))

  const labelEvery = range === '7d' ? 1 : range === '30d' || range === 'month' ? 3 : 14

  return (
    <div>
      <div className="flex items-end gap-1 overflow-x-auto pb-1" style={{ height: 160 }}>
        {ordered.map((d, i) => {
          const h = d.totalTokens > 0 ? Math.max(4, (d.totalTokens / maxTokens) * 140) : 2
          return (
            <div key={d.day} className="flex h-full min-w-[10px] flex-1 flex-col justify-end" title={`${d.day} · ${formatTokens(d.totalTokens)} tokens · ${d.messages} 消息`}>
              <div className="flex w-full flex-col justify-end overflow-hidden rounded-t-sm" style={{ height: `${h}px` }}>
                {d.models.map((m) => {
                  const segH = (m.totalTokens / d.totalTokens) * 100
                  return (
                    <div
                      key={m.modelId}
                      style={{ height: `${segH}%`, backgroundColor: colorOf(m.modelId) }}
                      className="w-full"
                    />
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      {/* 日期轴 */}
      <div className="mt-1 flex gap-1">
        {ordered.map((d, i) => (
          <div key={d.day} className="min-w-[10px] flex-1 text-center text-[10px] text-muted-foreground/60">
            {i % labelEvery === 0 ? d.day.slice(5) : ''}
          </div>
        ))}
      </div>
      {/* 图例 */}
      {modelOrder.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {modelOrder.map((id) => (
            <div key={id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: colorOf(id) }} />
              {shortModelName(id)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** 按模型明细表 */
function ModelTable({ rows }: { rows: UsageModelRow[] }): React.ReactElement {
  const [sortKey, setSortKey] = React.useState<keyof UsageModelRow>('totalTokens')
  const [asc, setAsc] = React.useState(false)

  const sorted = React.useMemo(() => {
    const arr = [...rows].sort((a, b) => {
      const va = a[sortKey] ?? 0
      const vb = b[sortKey] ?? 0
      return (va < vb ? -1 : va > vb ? 1 : 0) * (asc ? 1 : -1)
    })
    return arr
  }, [rows, sortKey, asc])

  if (rows.length === 0) {
    return <div className="px-4 py-8 text-center text-sm text-muted-foreground">当前范围内暂无模型用量数据</div>
  }

  const header = (key: keyof UsageModelRow, label: string, cls = ''): React.ReactElement => (
    <button
      type="button"
      onClick={() => {
        if (sortKey === key) setAsc((v) => !v)
        else {
          setSortKey(key)
          setAsc(false)
        }
      }}
      className={cn('inline-flex items-center gap-1 font-medium hover:text-foreground', cls)}
    >
      {label}
      {sortKey === key && <span className="text-[9px]">{asc ? '↑' : '↓'}</span>}
    </button>
  )

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
            <th className="py-2 pr-3">{header('modelId', '模型')}</th>
            <th className="py-2 pr-3">{header('provider', '渠道')}</th>
            <th className="py-2 pr-3 text-right">{header('totalTokens', '总 Token')}</th>
            <th className="py-2 pr-3 text-right">{header('inputTokens', '输入')}</th>
            <th className="py-2 pr-3 text-right">{header('outputTokens', '输出')}</th>
            <th className="py-2 pr-3 text-right">{header('cacheReadTokens', '缓存读取')}</th>
            <th className="py-2 pr-3 text-right">{header('resultCount', '调用')}</th>
            <th className="py-2 text-right">{header('costUsd', '费用')}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={row.modelId} className={cn('border-b border-border/40', i % 2 === 1 && 'bg-muted/30')}>
              <td className="py-2 pr-3">
                <span
                  className="mr-2 inline-block h-2.5 w-2.5 rounded-sm align-middle"
                  style={{ backgroundColor: MODEL_COLORS[i % MODEL_COLORS.length] }}
                />
                <span className="font-medium">{shortModelName(row.modelId)}</span>
              </td>
              <td className="py-2 pr-3 text-muted-foreground">{providerLabel(row.provider)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{formatTokens(row.totalTokens)}</td>
              <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{formatTokens(row.inputTokens)}</td>
              <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{formatTokens(row.outputTokens)}</td>
              <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{formatTokens(row.cacheReadTokens)}</td>
              <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{formatNumber(row.resultCount)}</td>
              <td className="py-2 text-right tabular-nums">{formatCost(row.costUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function UsageSettings(): React.ReactElement {
  const [range, setRange] = React.useState<UsageRange>('all')
  const [stats, setStats] = React.useState<AgentUsageStats | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [subTab, setSubTab] = React.useState<'overview' | 'models'>('overview')

  const load = React.useCallback(async (r: UsageRange) => {
    setLoading(true)
    try {
      const result = await window.electronAPI.getUsageStats(r) as AgentUsageStats
      setStats(result)
    } catch (e) {
      console.error('[用量统计] 获取失败:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load(range)
  }, [range, load])

  return (
    <div className="space-y-6">
      <SettingsSection
        title="用量统计"
        description={stats ? `跨会话 Agent 用量 · ${RANGE_OPTIONS.find((o) => o.value === range)?.label}` : '正在统计本地对话历史...'}
        action={
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg bg-muted p-1">
              {RANGE_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setRange(o.value)}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                    range === o.value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <Button variant="ghost" size="sm" onClick={() => load(range)} disabled={loading} className="gap-1.5">
              <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
              刷新
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <TodayUsageStrip today={stats?.today ?? null} />

          <Tabs value={subTab} onValueChange={(v) => setSubTab(v as 'overview' | 'models')}>
            <TabsList>
              <TabsTrigger value="overview" className="gap-1.5"><Activity size={14} />概览</TabsTrigger>
              <TabsTrigger value="models" className="gap-1.5"><BarChart3 size={14} />模型</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="pt-4 animate-in fade-in-0 slide-in-from-top-1 duration-base">
              {stats ? (
                <div className="space-y-6">
                  <OverviewGrid overview={stats.overview} />
                  <SettingsCard divided={false} className="p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h4 className="text-sm font-medium">每日 Token 贡献</h4>
                      <span className="text-xs text-muted-foreground">
                        {formatTokens(stats.overview.totalTokens)} tokens · {stats.overview.activeDays} 活跃天
                      </span>
                    </div>
                    <ContributionHeatmap days={stats.days} range={range} />
                  </SettingsCard>
                </div>
              ) : loading ? (
                <div className="animate-pulse py-16 text-center text-sm text-muted-foreground">统计中...</div>
              ) : (
                <div className="py-16 text-center text-sm text-muted-foreground">暂无数据</div>
              )}
            </TabsContent>

            <TabsContent value="models" className="pt-4 animate-in fade-in-0 slide-in-from-top-1 duration-base">
              {stats ? (
                <div className="space-y-6">
                  <SettingsCard divided={false} className="p-4">
                    <h4 className="mb-3 text-sm font-medium">按天 · 按模型堆叠</h4>
                    <StackedBarChart days={stats.days} range={range} />
                  </SettingsCard>
                  <SettingsSection title="按模型明细" description="各模型输入 / 输出 / 缓存 Token 与费用">
                    <SettingsCard divided={false} className="overflow-hidden p-0">
                      <ModelTable rows={stats.models} />
                    </SettingsCard>
                  </SettingsSection>
                </div>
              ) : loading ? (
                <div className="animate-pulse py-16 text-center text-sm text-muted-foreground">统计中...</div>
              ) : (
                <div className="py-16 text-center text-sm text-muted-foreground">暂无数据</div>
              )}
            </TabsContent>
          </Tabs>
        </div>

        {/* 底部：当前模型供应商余额 */}
        <div className="pt-2 border-t border-border/60">
          <ChannelBalanceSection />
        </div>
      </SettingsSection>
    </div>
  )
}
