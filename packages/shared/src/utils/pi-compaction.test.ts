import { describe, expect, test } from 'bun:test'
import {
  PI_AUTO_COMPACTION_THRESHOLD_RATIO,
  PI_EARLY_COMPACTION_THRESHOLD_RATIO,
  calculatePiAutoCompactionReserveTokens,
  calculatePiAutoCompactionThresholdTokens,
} from './pi-compaction'

describe('calculatePiAutoCompactionReserveTokens', () => {
  test('默认阈值 0.8：1M 窗口预留 20%（200K）', () => {
    expect(calculatePiAutoCompactionReserveTokens(1_000_000)).toBe(200_000)
    expect(calculatePiAutoCompactionReserveTokens(1_000_000)).toBe(
      Math.ceil(1_000_000 * (1 - PI_AUTO_COMPACTION_THRESHOLD_RATIO)),
    )
  })

  test('thresholdRatio 参数化：0.7 时 1M 窗口预留 30%（300K）', () => {
    expect(calculatePiAutoCompactionReserveTokens(1_000_000, PI_EARLY_COMPACTION_THRESHOLD_RATIO)).toBe(300_000)
  })

  test('200K 窗口：默认 40K 预留 vs 参数 0.7 时 60K 预留', () => {
    expect(calculatePiAutoCompactionReserveTokens(200_000)).toBe(40_000)
    expect(calculatePiAutoCompactionReserveTokens(200_000, PI_EARLY_COMPACTION_THRESHOLD_RATIO)).toBe(60_000)
  })

  test('非法窗口抛错', () => {
    expect(() => calculatePiAutoCompactionReserveTokens(0)).toThrow(TypeError)
    expect(() => calculatePiAutoCompactionReserveTokens(Number.NaN)).toThrow(TypeError)
  })
})

describe('calculatePiAutoCompactionThresholdTokens', () => {
  test('1M 窗口默认阈值 = 800K；参数 0.7 时 = 700K', () => {
    expect(calculatePiAutoCompactionThresholdTokens(1_000_000)).toBe(800_000)
    expect(
      1_000_000 - calculatePiAutoCompactionReserveTokens(1_000_000, PI_EARLY_COMPACTION_THRESHOLD_RATIO),
    ).toBe(700_000)
  })
})
