import { describe, expect, test } from 'bun:test'
import { selectDraftSessionsWithContent, type DraftSessionSourceItem } from '../draft-recall-model.ts'

describe('selectDraftSessionsWithContent', () => {
  const sessions: DraftSessionSourceItem[] = [
    { id: 'a', title: '新 Agent 会话', workspaceId: 'ws-1', createdAt: 100 },
    { id: 'b', title: '新 Agent 会话', workspaceId: 'ws-1', createdAt: 300 },
    { id: 'c', title: '新 Agent 会话', workspaceId: 'ws-2', createdAt: 200 },
  ]

  test('无草稿 ID 时返回空', () => {
    const result = selectDraftSessionsWithContent({
      sessions,
      draftSessionIds: new Set(),
      draftTexts: new Map([['a', '写了一半']]),
    })
    expect(result).toEqual([])
  })

  test('过滤空内容草稿（未输入任何东西不算需要找回的）', () => {
    const result = selectDraftSessionsWithContent({
      sessions,
      draftSessionIds: new Set(['a']),
      draftTexts: new Map([['a', '   ']]),
    })
    expect(result).toEqual([])
  })

  test('按 createdAt 倒序排列', () => {
    const result = selectDraftSessionsWithContent({
      sessions,
      draftSessionIds: new Set(['a', 'b']),
      draftTexts: new Map([['a', '第一个草稿'], ['b', '第二个草稿']]),
    })
    expect(result.map((s) => s.id)).toEqual(['b', 'a'])
    expect(result[0]?.text).toBe('第二个草稿')
  })

  test('跨项目返回全部工作区草稿，按 createdAt 倒序并透出 workspaceId', () => {
    const result = selectDraftSessionsWithContent({
      sessions,
      draftSessionIds: new Set(['a', 'c']),
      draftTexts: new Map([['a', '本工作区'], ['c', '别的工作区']]),
    })
    expect(result.map((s) => s.id)).toEqual(['c', 'a'])
    expect(result[0]?.workspaceId).toBe('ws-2')
    expect(result[1]?.workspaceId).toBe('ws-1')
  })

  test('排除当前正打开的会话', () => {
    const result = selectDraftSessionsWithContent({
      sessions,
      draftSessionIds: new Set(['a']),
      draftTexts: new Map([['a', '正在这个会话里']]),
      excludeSessionId: 'a',
    })
    expect(result).toEqual([])
  })

  test('maxItems 限制条数', () => {
    const many: DraftSessionSourceItem[] = [
      { id: 'x1', title: 't', workspaceId: 'ws-1', createdAt: 1 },
      { id: 'x2', title: 't', workspaceId: 'ws-1', createdAt: 2 },
      { id: 'x3', title: 't', workspaceId: 'ws-2', createdAt: 3 },
      { id: 'x4', title: 't', workspaceId: 'ws-2', createdAt: 4 },
    ]
    const result = selectDraftSessionsWithContent({
      sessions: many,
      draftSessionIds: new Set(['x1', 'x2', 'x3', 'x4']),
      draftTexts: new Map([['x1', 'a'], ['x2', 'b'], ['x3', 'c'], ['x4', 'd']]),
      maxItems: 2,
    })
    expect(result.map((s) => s.id)).toEqual(['x4', 'x3'])
  })
})
