import type { ChannelPlanQuotaResult } from '@myyoda/shared'

interface OpenRouterKeyData {
  usage?: unknown
  usage_daily?: unknown
  usage_weekly?: unknown
  usage_monthly?: unknown
  limit?: unknown
  limit_remaining?: unknown
  is_free_tier?: unknown
}

function parseAmount(value: unknown): number | undefined {
  if (value == null || value === '') return undefined
  const amount = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(amount) ? amount : undefined
}

function formatCredits(amount: number): string {
  return `$${amount.toFixed(2)}`
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

/**
 * 根据渠道 Base URL 推断 OpenRouter 余额查询地址。
 *
 * 优先使用渠道自身域名（兼容中转/代理域名），否则回退官方地址。
 */
export function getOpenRouterKeyUrl(baseUrl: string): string {
  try {
    const origin = new URL(baseUrl.trim()).origin
    if (origin.startsWith('http')) {
      return `${origin}/api/v1/auth/key`
    }
  } catch {
    // 使用官方默认查询地址
  }
  return 'https://openrouter.ai/api/v1/auth/key'
}

/**
 * 解析 OpenRouter /api/v1/auth/key（或 /api/v1/key）响应。
 *
 * OpenRouter 的余额是充值制 credits：接口返回当前 Key 的已用额度（usage）
 * 以及 Key 的消费上限（limit，未设置时为 null）。
 * - 设置了 Key 上限：展示剩余额度及百分比进度条
 * - 未设置上限：仅展示已用额度（平台不暴露账户总余额）
 */
export function parseOpenRouterKeyResponse(data: unknown): ChannelPlanQuotaResult {
  const root = data as { data?: Record<string, unknown> } | null
  const key = (root?.data ?? root) as OpenRouterKeyData | null
  const usage = parseAmount(key?.usage)
  if (usage == null) {
    return {
      supported: false,
      provider: 'openrouter',
      windows: [],
      updatedAt: Date.now(),
      message: 'OpenRouter 未返回额度数据',
    }
  }

  const limit = parseAmount(key?.limit)
  const isFreeTier = key?.is_free_tier === true
  const baseMessage = isFreeTier ? '免费用户，未充值' : undefined

  // Key 设置了消费上限：可计算剩余额度与百分比
  if (limit != null && limit > 0) {
    const limitRemaining = parseAmount(key?.limit_remaining)
    const remaining = limitRemaining != null ? limitRemaining : Math.max(0, limit - usage)
    const remainingPercent = clampPercent((remaining / limit) * 100)
    return {
      supported: true,
      provider: 'openrouter',
      planName: 'OpenRouter 账户额度',
      windows: [{
        type: 'custom',
        label: '剩余额度',
        remainingPercent,
        usedPercent: clampPercent(100 - remainingPercent),
        remainingLabel: `${formatCredits(remaining)} / ${formatCredits(limit)}`,
        showProgress: true,
      }],
      updatedAt: Date.now(),
      message: baseMessage ?? `已用 ${formatCredits(usage)}`,
    }
  }

  // 未设置 Key 上限：仅展示已用额度
  return {
    supported: true,
    provider: 'openrouter',
    planName: 'OpenRouter 已用额度',
    windows: [{
      type: 'custom',
      label: '已用额度',
      remainingPercent: 0,
      usedPercent: 0,
      remainingLabel: formatCredits(usage),
      showProgress: false,
    }],
    updatedAt: Date.now(),
    message: baseMessage ?? '该 Key 未设置消费上限，无法显示剩余额度',
  }
}
