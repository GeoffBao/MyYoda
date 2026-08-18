import { describe, expect, test } from 'bun:test'
import { createStore } from 'jotai'
import { agentSessionDraftsAtom } from '@/atoms/agent-atoms'
import { parseDrafts, removeAgentDraft, serializeDrafts } from '../agent-draft-persistence.ts'

// bun 测试环境无 localStorage 全局，提供内存 stub
const memStore = new Map<string, string>()
globalThis.localStorage = {
  getItem: (k: string) => memStore.get(k) ?? null,
  setItem: (k: string, v: string) => { memStore.set(k, v) },
  removeItem: (k: string) => { memStore.delete(k) },
  key: () => null,
  length: 0,
  clear: () => { memStore.clear() },
}

describe('agent-draft-persistence 序列化', () => {
  test('serialize/parse 往返一致', () => {
    const drafts = new Map([['s1', '草稿内容'], ['s2', '另一条']])
    expect(parseDrafts(serializeDrafts(drafts))).toEqual(drafts)
  })

  test('parse 空字符串/非法 JSON 返回空 Map', () => {
    expect(parseDrafts(null)).toEqual(new Map())
    expect(parseDrafts('')).toEqual(new Map())
    expect(parseDrafts('{bad json')).toEqual(new Map())
  })

  test('parse 过滤空文本与非字符串值', () => {
    const raw = JSON.stringify({ s1: '   ', s2: '有效', s3: 123, s4: '' })
    expect(parseDrafts(raw)).toEqual(new Map([['s2', '有效']]))
  })
})

describe('agent-draft-persistence 删除清理', () => {
  test('removeAgentDraft 删除指定会话草稿并落盘', () => {
    const store = createStore()
    store.set(agentSessionDraftsAtom, new Map([['s1', 'a'], ['s2', 'b']]))
    removeAgentDraft(store, 's1')
    expect(store.get(agentSessionDraftsAtom)).toEqual(new Map([['s2', 'b']]))
    expect(localStorage.getItem('myyoda-agent-session-drafts')).toContain('s2')
    expect(localStorage.getItem('myyoda-agent-session-drafts')).not.toContain('s1')
  })

  test('removeAgentDraft 不存在的会话不写盘', () => {
    const store = createStore()
    store.set(agentSessionDraftsAtom, new Map([['s2', 'b']]))
    removeAgentDraft(store, 's1')
    expect(store.get(agentSessionDraftsAtom)).toEqual(new Map([['s2', 'b']]))
  })
})
