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
