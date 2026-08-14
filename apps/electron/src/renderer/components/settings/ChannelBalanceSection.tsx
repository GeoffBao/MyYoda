/**
 * ChannelBalanceSection — 「供应商余额」区块（用量统计页底部）
 *
 * 展示所有已配置且支持余额/额度查询的渠道：渠道 Logo、名称、余额摘要，
 * hover 显示完整明细。数据复用渲染进程 fetchChannelPlanQuota 缓存层，
 * 同一渠道的查询结果与模型选择器里的余额徽章共享，不重复请求。
 *
 * - 只展示 supportsChannelPlanQuota 的渠道（DeepSeek / Kimi / OpenRouter / 智谱 / MiniMax / Codex...）
 * - 加载中显示占位；查询失败显示简短原因；「刷新」会失效缓存后重新查询
 * - 当前渠道列表为空或不支持任何渠道时不渲染区块
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { Wallet, RefreshCw, TriangleAlert } from 'lucide-react'
import type { Channel, ChannelPlanQuotaResult, ProviderType } from '@myyoda/shared'
import { PROVIDER_LABELS } from '@myyoda/shared'
import { channelsAtom } from '@/atoms/chat-atoms'
import { supportsChannelPlanQuota, fetchChannelPlanQuota, invalidateChannelPlanQuota } from '@/lib/channel-plan-quota'
import { getChannelLogo } from '@/lib/model-logo'
import { buildQuotaSummary, buildQuotaTitle } from '@/components/chat/ChannelPlanQuotaBadge'
import { Button } from '../ui/button'

/** 供应商展示名；缺失时统一显示"未知渠道"，不泄露原始 channelId */
function providerLabel(provider?: ProviderType): string {
  return provider ? PROVIDER_LABELS[provider] : '未知渠道'
}

function BalanceCard({ channel, refreshKey }: { channel: Channel; refreshKey: number }): React.ReactElement {
  const [quota, setQuota] = React.useState<ChannelPlanQuotaResult | null>(null)

  React.useEffect(() => {
    if (!supportsChannelPlanQuota(channel)) return

    let cancelled = false
    fetchChannelPlanQuota(channel.id, channel.updatedAt)
      .then((result) => {
        if (!cancelled) setQuota(result)
      })

    return () => {
      cancelled = true
    }
  }, [channel.id, channel.provider, channel.baseUrl, channel.updatedAt, refreshKey])

  const logo = <img src={getChannelLogo(channel)} alt={channel.name} className="size-8 shrink-0 rounded object-cover" />

  // 加载中占位
  if (quota == null) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-card p-3">
        {logo}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{channel.name}</div>
          <div className="text-xs text-muted-foreground">{providerLabel(channel.provider)}</div>
        </div>
        <div className="animate-pulse text-xs text-muted-foreground/50">查询中...</div>
      </div>
    )
  }

  // 查询失败 / 不支持
  if (!quota.supported || quota.windows.length === 0) {
    const errorText = quota.message ?? '余额查询失败'
    return (
      <div
        title={errorText}
        className="flex items-center gap-3 rounded-lg border border-border/60 bg-card p-3"
      >
        {logo}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{channel.name}</div>
          <div className="text-xs text-muted-foreground">{providerLabel(channel.provider)}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground/60">
          <TriangleAlert size={12} />
          <span className="max-w-[120px] truncate">{errorText}</span>
        </div>
      </div>
    )
  }

  // 成功：摘要 + hover 完整明细
  return (
    <div
      title={buildQuotaTitle(quota)}
      className="flex items-center gap-3 rounded-lg border border-border/60 bg-card p-3 transition-colors hover:border-primary/30"
    >
      {logo}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{channel.name}</div>
        <div className="text-xs text-muted-foreground">{providerLabel(channel.provider)}</div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-sm font-semibold tabular-nums">{buildQuotaSummary(quota)}</div>
        <div className="text-[10px] text-muted-foreground/60">{quota.planName ?? '订阅额度'}</div>
      </div>
    </div>
  )
}

/**
 * 供应商余额区块
 *
 * 只渲染「支持余额查询的渠道」；渠道列表为空或不支持任何渠道时不渲染区块。
 * 「刷新」按钮会先失效所有余额缓存，再通过 refreshKey 变化驱动卡片重新查询。
 */
export function ChannelBalanceSection(): React.ReactElement | null {
  const channels = useAtomValue(channelsAtom)
  const [refreshKey, setRefreshKey] = React.useState(0)

  const supportedChannels = React.useMemo(
    () => channels.filter((channel) => supportsChannelPlanQuota(channel)),
    [channels],
  )
  if (supportedChannels.length === 0) return null

  const handleRefresh = (): void => {
    for (const channel of supportedChannels) {
      invalidateChannelPlanQuota(channel.id)
    }
    setRefreshKey((v) => v + 1)
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wallet size={16} className="text-muted-foreground" />
          <h4 className="text-sm font-medium">供应商余额</h4>
          <span className="text-xs text-muted-foreground">共 {supportedChannels.length} 个渠道</span>
        </div>
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={handleRefresh}>
          <RefreshCw size={14} />
          刷新
        </Button>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {supportedChannels.map((channel) => (
          <BalanceCard key={channel.id} channel={channel} refreshKey={refreshKey} />
        ))}
      </div>
    </div>
  )
}
