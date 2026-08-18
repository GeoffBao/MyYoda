/**
 * agent-draft-persistence — Agent 会话未发送草稿的持久化副作用
 *
 * agentSessionDraftsAtom 保持内存 Map（输入时即时更新，避免写盘抖动）；
 * 本模块负责：启动加载（localStorage → atom）、防抖写盘（atom → localStorage）、
 * 退出 flush、删除清理。只持久化纯文本；HTML 富文本不持久化（重启后由纯文本重建）。
 */

import type { Store } from 'jotai/vanilla/store'
import { agentSessionDraftsAtom } from '@/atoms/agent-atoms'

const STORAGE_KEY = 'myyoda-agent-session-drafts'
/** 防抖窗口：停止输入多久后落盘 */
const PERSIST_DEBOUNCE_MS = 1500

/** 序列化：Map → 普通对象字符串（localStorage 友好） */
export function serializeDrafts(drafts: Map<string, string>): string {
  return JSON.stringify(Object.fromEntries(drafts))
}

/** 解析：对象字符串 → Map；非法输入 / 空文本 / 非字符串值一律丢弃 */
export function parseDrafts(raw: string | null): Map<string, string> {
  if (!raw) return new Map()
  try {
    const obj: unknown = JSON.parse(raw)
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return new Map()
    const result = new Map<string, string>()
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof value === 'string' && value.trim().length > 0) result.set(key, value)
    }
    return result
  } catch {
    return new Map()
  }
}

function writeDrafts(store: Store): void {
  try {
    localStorage.setItem(STORAGE_KEY, serializeDrafts(store.get(agentSessionDraftsAtom)))
  } catch {
    // localStorage 超限等写盘失败：忽略，内存草稿不受影响
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null

/** 防抖写盘：停止输入 1.5s 后落盘；timer 独立于组件生命周期（切换会话不丢盘） */
export function schedulePersistAgentDrafts(store: Store): void {
  if (persistTimer !== null) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    writeDrafts(store)
  }, PERSIST_DEBOUNCE_MS)
}

/** 立即落盘（beforeunload / 兜底） */
export function flushAgentDrafts(store: Store): void {
  if (persistTimer !== null) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  writeDrafts(store)
}

/** 启动加载：localStorage → atom（合并进现有内存数据） */
export function loadAgentSessionDrafts(store: Store): void {
  try {
    const drafts = parseDrafts(localStorage.getItem(STORAGE_KEY))
    if (drafts.size === 0) return
    store.set(agentSessionDraftsAtom, (prev) => {
      const next = new Map(prev)
      for (const [id, text] of drafts) next.set(id, text)
      return next
    })
  } catch {
    // 读盘失败忽略
  }
}

/** 删除单个会话草稿并立即落盘（会话/工作区删除时调用） */
export function removeAgentDraft(store: Store, sessionId: string): void {
  const current = store.get(agentSessionDraftsAtom)
  if (!current.has(sessionId)) return
  const next = new Map(current)
  next.delete(sessionId)
  store.set(agentSessionDraftsAtom, next)
  writeDrafts(store)
}
