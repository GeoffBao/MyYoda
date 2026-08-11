import { describe, expect, test } from 'bun:test'
import { buildClaudeSubscriptionLimitMessage, isClaudeSubscriptionLimitError } from './pi-subscription-limit'

describe('isClaudeSubscriptionLimitError', () => {
  test('Given Anthropic 订阅窗口限流文案 When 判定 Then true', () => {
    expect(isClaudeSubscriptionLimitError(
      'This request would exceed your account\'s rate limit. Please try again later.',
    )).toBe(true)
  })

  test('Given 完整 API 错误 JSON（用户实测形态）When 判定 Then true', () => {
    expect(isClaudeSubscriptionLimitError(
      '429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your account\'s rate limit. Please try again later."},"request_id":"req_011CduHeDkjWsAbrKc5wWyup"}',
    )).toBe(true)
  })

  test('Given 瞬时 API 限流文案 When 判定 Then false（不应误伤）', () => {
    expect(isClaudeSubscriptionLimitError('429 rate_limit_error: Too many requests, please slow down.')).toBe(false)
    expect(isClaudeSubscriptionLimitError('rate limit exceeded')).toBe(false)
    expect(isClaudeSubscriptionLimitError('API Error: 429 Rate limit reached for anthropic')).toBe(false)
  })

  test('Given 网络/超载/无效输入 When 判定 Then false', () => {
    expect(isClaudeSubscriptionLimitError('network error: socket hang up')).toBe(false)
    expect(isClaudeSubscriptionLimitError('overloaded: 529')).toBe(false)
    expect(isClaudeSubscriptionLimitError('')).toBe(false)
    expect(isClaudeSubscriptionLimitError(undefined)).toBe(false)
    expect(isClaudeSubscriptionLimitError(null)).toBe(false)
  })
})

describe('buildClaudeSubscriptionLimitMessage', () => {
  test('Given 调用 When 返回 5 小时窗口提示', () => {
    expect(buildClaudeSubscriptionLimitMessage()).toContain('5 小时')
    expect(buildClaudeSubscriptionLimitMessage()).toContain('用量上限')
  })
})

describe('mapSDKErrorToTypedError 订阅限流映射（agent-error-utils 集成）', () => {
  test('Given 订阅窗口限流错误 When 映射 Then 返回专用提示而非「请求频率限制」', async () => {
    const { mapSDKErrorToTypedError } = await import('../agent-error-utils')
    const err = mapSDKErrorToTypedError(
      'rate_limited',
      'This request would exceed your account\'s rate limit. Please try again later.',
      '429 {"error":{"type":"rate_limit_error"}}',
    )
    expect(err.title).toBe('Claude 订阅用量已达上限')
    expect(err.message).toContain('5 小时')
    expect(err.canRetry).toBe(false)
  })

  test('Given 瞬时 API 限流错误 When 映射 Then 保持原「请求频率限制」', async () => {
    const { mapSDKErrorToTypedError } = await import('../agent-error-utils')
    const err = mapSDKErrorToTypedError('rate_limited', 'Too many requests', '429')
    expect(err.title).toBe('请求频率限制')
  })
})
