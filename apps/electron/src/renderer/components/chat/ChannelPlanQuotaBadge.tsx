import * as React from 'react'
import { useAtomValue } from 'jotai'
import type { Channel, ChannelPlanQuotaResult, ChannelPlanQuotaWindow } from '@myyoda/shared'
import { supportsChannelPlanQuota, fetchChannelPlanQuota, invalidateChannelPlanQuota, channelPlanQuotaRefreshVersionAtom } from '@/lib/channel-plan-quota'

function formatWindow(window: ChannelPlanQuotaWindow): string {
  const label = window.type === '5h'
    ? '5H'
    : window.type === 'weekly'
      ? '周'
      : window.label.replace(/\s+/g, '')
  return `${label} ${window.remainingLabel ?? `${window.remainingPercent}%`}`
}

/** 余额摘要：优先 5h/周/月窗口，否则取前两个窗口或自定义窗口 */
export function buildQuotaSummary(result: ChannelPlanQuotaResult): string {
  const fiveHour = result.windows.find((window) => window.type === '5h')
  const weekly = result.windows.find((window) => window.type === 'weekly')
  const monthly = result.windows.find((window) => window.type === 'monthly')
  const custom = result.windows.find((window) => window.type === 'custom')
  const primary = [fiveHour, weekly, monthly].filter(Boolean) as ChannelPlanQuotaWindow[]
  const windows = primary.length > 0 ? primary : result.windows.slice(0, 2)
  if (windows.length === 0 && custom) return formatWindow(custom)
  return windows.map(formatWindow).join(' · ')
}

/** 完整标题：计划名 + 各窗口剩余 + 重置时间 + 附加信息（tooltip 用） */
export function buildQuotaTitle(result: ChannelPlanQuotaResult): string {
  if (!result.supported) return result.message ?? '订阅额度不可用'
  const detail = result.windows.map((window) => {
    const reset = window.resetAt
      ? `，重置 ${new Intl.DateTimeFormat(undefined, {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(window.resetAt))}`
      : ''
    return `${window.label}: 剩余 ${window.remainingLabel ?? `${window.remainingPercent}%`}${reset}`
  }).join('\n')
  return `${result.planName ?? '订阅额度'}\n${detail}${result.message ? `\n${result.message}` : ''}`
}

export function ChannelPlanQuotaBadge({ channel }: { channel: Channel }): React.ReactElement | null {
  const [quota, setQuota] = React.useState<ChannelPlanQuotaResult | null>(null)

  const refreshVersion = useAtomValue(channelPlanQuotaRefreshVersionAtom)

  React.useEffect(() => {
    if (!supportsChannelPlanQuota(channel)) return

    // 全局刷新触发时主动失效缓存，确保下次 fetch 走实时查询
    invalidateChannelPlanQuota(channel.id)

    let cancelled = false
    fetchChannelPlanQuota(channel.id, channel.updatedAt)
      .then((result) => {
        if (!cancelled) setQuota(result)
      })

    return () => {
      cancelled = true
    }
  }, [channel.id, channel.provider, channel.baseUrl, channel.updatedAt, refreshVersion])

  if (!supportsChannelPlanQuota(channel)) return null

  const isUsable = quota?.supported && quota.windows.length > 0
  const isClaudeSubscription = channel.provider === 'anthropic-oauth'
  const isLoading = quota == null
  const hasError = quota != null && !quota.supported

  // Claude Pro/Max 无余额 API，直接显示 ⚠
  if (isClaudeSubscription) {
    return (
      <span
        title={quota?.message ?? 'Claude Pro/Max 订阅额度请在 Claude Code 中运行 /usage 或 /usage-credits 查看'}
        className="ml-auto shrink-0 rounded border px-1.5 py-0.5 text-[10px] leading-none border-transparent bg-transparent text-muted-foreground/50"
      >
        ⚠
      </span>
    )
  }

  // 加载中：显示占位符，不静默消失
  if (isLoading) {
    return (
      <span
        className="ml-auto shrink-0 rounded border px-1.5 py-0.5 text-[10px] leading-none border-transparent bg-transparent text-muted-foreground/40"
      >
        ...
      </span>
    )
  }

  // 查询失败：显示简短错误信息，hover 看完整原因
  if (hasError) {
    const errorText = quota.message ?? '余额查询失败'
    // 截取前 18 个字符作为缩写，避免 UI 太长
    const shortError = errorText.length > 18 ? `${errorText.slice(0, 16)}…` : errorText
    return (
      <span
        title={errorText}
        className="ml-auto shrink-0 rounded border px-1.5 py-0.5 text-[10px] leading-none border-transparent bg-transparent text-muted-foreground/50"
      >
        {shortError}
      </span>
    )
  }

  if (!isUsable) return null

  const summary = buildQuotaSummary(quota)
  const title = buildQuotaTitle(quota)

  return (
    <span
      title={title}
      className="ml-auto shrink-0 rounded border px-1.5 py-0.5 text-[10px] leading-none border-foreground/10 bg-background/70 text-foreground/70"
    >
      {summary}
    </span>
  )
}
