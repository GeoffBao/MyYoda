import { describe, expect, test } from 'bun:test'
import { computeUpdateFlags, validateManifest } from './content-logic'

describe('validateManifest', () => {
  test('解析合法清单', () => {
    const raw = {
      version: 1,
      items: [{ id: 'a', type: 'video', title: 't', version: '1', publishedAt: 'x', video: { url: 'u' } }],
    }
    const result = validateManifest(raw)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.manifest.items).toHaveLength(1)
  })

  test('缺少 items 返回错误', () => {
    const result = validateManifest({ version: 1 })
    expect(result.ok).toBe(false)
  })

  test('video 条目缺 video 字段返回错误', () => {
    const raw = {
      version: 1,
      items: [{ id: 'a', type: 'video', title: 't', version: '1', publishedAt: 'x' }],
    }
    const result = validateManifest(raw)
    expect(result.ok).toBe(false)
  })

  test('未知内容类型返回错误', () => {
    const raw = {
      version: 1,
      items: [{ id: 'a', type: 'image', title: 't', version: '1', publishedAt: 'x' }],
    }
    const result = validateManifest(raw)
    expect(result.ok).toBe(false)
  })
})

describe('computeUpdateFlags', () => {
  test('版本不同 = 有更新；相同 = 无更新', () => {
    const items = [
      { id: 'a', type: 'video' as const, title: 'a', version: '2', publishedAt: 'x', video: { url: 'u' } },
      { id: 'b', type: 'announcement' as const, title: 'b', version: '1', publishedAt: 'x', body: 'b' },
    ]
    const state = { a: '1', b: '1' }
    const [a, b] = computeUpdateFlags(items, state)
    expect(a.hasUpdate).toBe(true)
    expect(b.hasUpdate).toBe(false)
  })

  test('未记录的条目视为有更新', () => {
    const items = [{ id: 'a', type: 'link' as const, title: 'a', version: '1', publishedAt: 'x', url: 'u' }]
    const [a] = computeUpdateFlags(items, {})
    expect(a.hasUpdate).toBe(true)
  })

  test('空清单返回空数组', () => {
    expect(computeUpdateFlags([], {})).toEqual([])
  })
})
