import { describe, expect, test } from 'bun:test'
import { getOpenRouterKeyUrl, parseOpenRouterKeyResponse } from './openrouter-balance'

describe('OpenRouter balance parser', () => {
  test('根据渠道 Base URL 推断余额接口，自定义域名优先', () => {
    expect(getOpenRouterKeyUrl('https://openrouter.ai/api/v1')).toBe('https://openrouter.ai/api/v1/auth/key')
    expect(getOpenRouterKeyUrl('https://openrouter.ai')).toBe('https://openrouter.ai/api/v1/auth/key')
    expect(getOpenRouterKeyUrl('https://proxy.example.com/v1')).toBe('https://proxy.example.com/api/v1/auth/key')
    expect(getOpenRouterKeyUrl('')).toBe('https://openrouter.ai/api/v1/auth/key')
    expect(getOpenRouterKeyUrl('not-a-url')).toBe('https://openrouter.ai/api/v1/auth/key')
  })

  test('解析设置消费上限的 Key：展示剩余额度、百分比和已用信息', () => {
    const result = parseOpenRouterKeyResponse({
      data: {
        label: 'sk-or-v1-abc',
        usage: 25.5,
        limit: 100,
        limit_remaining: 74.5,
        is_free_tier: false,
      },
    })

    expect(result.supported).toBe(true)
    expect(result.provider).toBe('openrouter')
    expect(result.planName).toBe('OpenRouter 账户额度')
    expect(result.windows).toEqual([{
      type: 'custom',
      label: '剩余额度',
      remainingPercent: 75,
      usedPercent: 25,
      remainingLabel: '$74.50 / $100.00',
      showProgress: true,
    }])
    expect(result.message).toBe('已用 $25.50')
  })

  test('无 limit_remaining 时用 limit - usage 推算剩余', () => {
    const result = parseOpenRouterKeyResponse({
      data: {
        usage: 80,
        limit: 100,
      },
    })
    expect(result.windows[0]?.remainingLabel).toBe('$20.00 / $100.00')
    expect(result.windows[0]?.remainingPercent).toBe(20)
  })

  test('未设置消费上限的 Key：仅展示已用额度，说明无法显示剩余', () => {
    const result = parseOpenRouterKeyResponse({
      data: {
        label: 'sk-or-v1-abc',
        usage: 25.5,
        limit: null,
        is_free_tier: false,
      },
    })

    expect(result.supported).toBe(true)
    expect(result.planName).toBe('OpenRouter 已用额度')
    expect(result.windows).toEqual([{
      type: 'custom',
      label: '已用额度',
      remainingPercent: 0,
      usedPercent: 0,
      remainingLabel: '$25.50',
      showProgress: false,
    }])
    expect(result.message).toBe('该 Key 未设置消费上限，无法显示剩余额度')
  })

  test('兼容字符串数值和缺少 data 包裹的响应', () => {
    expect(parseOpenRouterKeyResponse({ data: { usage: '3.2', limit: '10' } }).windows[0]?.remainingLabel)
      .toBe('$6.80 / $10.00')
    expect(parseOpenRouterKeyResponse({ usage: 5, limit: null }).windows[0]?.remainingLabel).toBe('$5.00')
  })

  test('拒绝缺少 usage 的响应', () => {
    const result = parseOpenRouterKeyResponse({ data: { limit: 100 } })
    expect(result.supported).toBe(false)
    expect(result.message).toBe('OpenRouter 未返回额度数据')
  })

  test('免费用户标记', () => {
    const result = parseOpenRouterKeyResponse({ data: { usage: 0, limit: null, is_free_tier: true } })
    expect(result.message).toBe('免费用户，未充值')
  })
})
