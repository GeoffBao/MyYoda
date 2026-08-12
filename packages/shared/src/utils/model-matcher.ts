/**
 * 模型能力判定 — 单一事实源。
 *
 * 历史问题：DeepSeek v4 判定正则曾散布在多个文件且写法不一致
 * （agent-prompt-builder 锚定 /^deepseek-v4/i vs agent-sdk-output-limits
 * 非锚定 /deepseek-v4/i），边界 case（vendor/ 前缀别名等）可能给出不同结论。
 * 统一从这里取判定，避免语义漂移。
 *
 * 注意：reasoning-profile.ts 的 profile 匹配（按模型 ID 分 flash/pro 档位）语义不同，
 * 不归入本函数；本函数只回答"是否为 deepseek-v4 系列"。
 */

/** DeepSeek v4 系列（flash/pro 及 vendor 前缀别名，如 vendor/DeepSeek-V4-Pro[1m]） */
const DEEPSEEK_V4_PATTERN = /deepseek-v4/i

export function isDeepSeekV4(modelId: string | undefined): boolean {
  if (!modelId) return false
  return DEEPSEEK_V4_PATTERN.test(modelId)
}
