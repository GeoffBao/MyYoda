/** Pi 自动压缩开始时的上下文占用比例（默认 80%）。 */
export const PI_AUTO_COMPACTION_THRESHOLD_RATIO = 0.8

/**
 * DeepSeek v4 等长上下文保持力较弱的模型提前压缩（70% 开始），
 * 避免后段质量断崖（设计报告 D2）。
 */
export const PI_EARLY_COMPACTION_THRESHOLD_RATIO = 0.7

/**
 * 将目标上下文占用比例换算为 Pi SDK 的 reserveTokens 配置。
 *
 * Pi 在 `contextTokens > contextWindow - reserveTokens` 时自动压缩，
 * 因此预留 20% 的窗口即可在约 80% 占用时开始压缩。
 *
 * @param thresholdRatio 触发压缩的上下文占用比例（默认 0.8；DeepSeek 等用 0.7）
 */
export function calculatePiAutoCompactionReserveTokens(
  contextWindow: number,
  thresholdRatio: number = PI_AUTO_COMPACTION_THRESHOLD_RATIO,
): number {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) {
    throw new TypeError('Pi context window must be a positive finite number')
  }

  return Math.round(contextWindow * (1 - thresholdRatio))
}

/** 返回 Pi SDK 会开始自动压缩的上下文 token 阈值。 */
export function calculatePiAutoCompactionThresholdTokens(contextWindow: number): number {
  return contextWindow - calculatePiAutoCompactionReserveTokens(contextWindow)
}
