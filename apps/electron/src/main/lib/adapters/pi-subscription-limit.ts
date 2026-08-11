/**
 * Claude 订阅（Pro/Max/Team/Enterprise）窗口限流识别。
 *
 * Anthropic 对订阅套餐的 5 小时滚动窗口限流返回 429，错误体形如：
 *   {"type":"error","error":{"type":"rate_limit_error",
 *     "message":"This request would exceed your account's rate limit. Please try again later."}}
 *
 * Pi SDK 的 RETRYABLE_PROVIDER_ERROR_PATTERN 会把 "rate limit" 误判为瞬时限流，
 * 从而在 agent.continue() 循环里自动重试最多 8 次（每次指数退避 30s+）。
 * 但订阅窗口是分钟/小时级，重试毫无意义且会在 UI 连续刷屏
 * （「网络暂时中断，第 X/8 次继续当前回答」）。
 *
 * 这里在 MyYoda 层识别订阅账户级限流（区别于 API Key 的瞬时 rate limit），
 * 让 PiAgentAdapter 终止 native retry 并透传友好终态错误。
 */

/** 订阅账户级限流特征（区别于瞬时 API 限流）。 */
const CLAUDE_SUBSCRIPTION_LIMIT_PATTERNS: RegExp[] = [
  // Anthropic 订阅窗口限流标准文案（Pro/Max/Team/Enterprise）。
  /exceed your account's rate limit/i,
  /exceed (?:the )?account's? (?:usage|rate) limit/i,
  // 兜底：明确的「账户级」+ rate limit 语义（排除瞬时「请求频率」限流）。
  /account[- ]?level.*rate[- ]?limit/i,
  /rate[- ]?limit.*account/i,
]

/**
 * 判断一段或多段错误文本是否命中 Claude 订阅窗口限流。
 * 纯函数，便于单测；支持多段文本（如 detailedMessage + originalError）。
 */
export function isClaudeSubscriptionLimitError(...texts: Array<string | null | undefined>): boolean {
  const combined = texts.filter(Boolean).join('\n')
  if (!combined) return false
  return CLAUDE_SUBSCRIPTION_LIMIT_PATTERNS.some((pattern) => pattern.test(combined))
}

/**
 * 订阅限流时给用户的友好提示。
 * Pro 套餐采用 5 小时滚动窗口；Max/Team/Enterprise 档位更高但机制相同。
 */
export function buildClaudeSubscriptionLimitMessage(): string {
  return 'Claude Pro/Max 订阅已达 5 小时用量上限，窗口滚动后自动恢复（约 5 小时）。请稍后再试，或降低单次会话消耗（如切换更轻量的模型）。'
}
