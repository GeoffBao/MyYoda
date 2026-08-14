/**
 * YodaSearchView 纯函数测试
 *
 * 覆盖默认态「最近会话按时间分组」的分组/标签/相对时间逻辑。
 * 注意：bun test 默认运行在 UTC 时区（生产环境为系统时区），
 * 因此所有时间都用 Date.UTC 构造，并把 now 显式传入，避免时区依赖。
 */
import { describe, expect, it } from 'bun:test'
import { formatRelativeTime, getDateGroupLabel, groupRecentByDate } from '../YodaSearchView'

/** 固定基准：2026-08-14 12:00 UTC（bun test 环境时区为 UTC） */
const NOW = Date.UTC(2026, 7, 14, 12, 0, 0)
const DAY_MS = 86_400_000

/** daysAgo 天前的 10:00 UTC */
function at(daysAgo: number, hour = 10): number {
  return NOW - daysAgo * DAY_MS + (hour - 12) * 3_600_000
}

describe('getDateGroupLabel', () => {
  it('今天：当天任意时刻', () => {
    expect(getDateGroupLabel(NOW, NOW)).toBe('今天')
    expect(getDateGroupLabel(Date.UTC(2026, 7, 14, 0, 30), NOW)).toBe('今天')
  })

  it('昨天：昨天零点至今天零点', () => {
    expect(getDateGroupLabel(at(1), NOW)).toBe('昨天')
    expect(getDateGroupLabel(Date.UTC(2026, 7, 13, 0, 0), NOW)).toBe('昨天')
  })

  it('前天：前天零点至昨天零点', () => {
    expect(getDateGroupLabel(at(2), NOW)).toBe('前天')
    expect(getDateGroupLabel(Date.UTC(2026, 7, 12, 0, 0), NOW)).toBe('前天')
  })

  it('更早：前天之前', () => {
    expect(getDateGroupLabel(at(3), NOW)).toBe('更早')
    expect(getDateGroupLabel(at(30), NOW)).toBe('更早')
  })
})

describe('groupRecentByDate', () => {
  it('按 updatedAt 分组并按 今天→更早 排序，空桶不出现', () => {
    const items = [
      { id: 'old', title: '旧', type: 'agent' as const, updatedAt: at(10) },
      { id: 'today', title: '今', type: 'chat' as const, updatedAt: NOW },
      { id: 'yesterday', title: '昨', type: 'agent' as const, updatedAt: at(1) },
    ]
    const groups = groupRecentByDate(items, NOW)
    expect(groups.map((g) => g.label)).toEqual(['今天', '昨天', '更早'])
    expect(groups[0]!.items.map((i) => i.id)).toEqual(['today'])
    expect(groups[1]!.items.map((i) => i.id)).toEqual(['yesterday'])
    expect(groups[2]!.items.map((i) => i.id)).toEqual(['old'])
  })

  it('同组内保持传入顺序（调用方已按 updatedAt 倒序）', () => {
    const items = [
      { id: 'a', title: 'A', type: 'chat' as const, updatedAt: NOW - 3_600_000 },
      { id: 'b', title: 'B', type: 'agent' as const, updatedAt: NOW },
    ]
    const groups = groupRecentByDate(items, NOW)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.label).toBe('今天')
    expect(groups[0]!.items.map((i) => i.id)).toEqual(['a', 'b'])
  })

  it('空列表返回空数组', () => {
    expect(groupRecentByDate([], NOW)).toEqual([])
  })
})

describe('formatRelativeTime', () => {
  it('今天显示 HH:MM', () => {
    const t = Date.UTC(2026, 7, 14, 9, 5)
    const formatted = formatRelativeTime(t, NOW)
    expect(formatted).toMatch(/^09:0\d$/)
  })

  it('昨天显示「昨天」', () => {
    expect(formatRelativeTime(at(1), NOW)).toBe('昨天')
  })

  it('更早显示 M月D日（本地化格式，宽松匹配）', () => {
    // toLocaleDateString 的输出随运行时 ICU 能力变化（8/4 或 8月4日），只断言包含数字
    expect(formatRelativeTime(at(10), NOW)).toMatch(/\d/)
  })
})
