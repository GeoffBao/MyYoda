import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import type { Store } from 'jotai/vanilla/store'
import type { BrowserViewState } from '@myyoda/shared'
import { currentAgentSessionIdAtom } from './agent-atoms'

/** 每个 Agent 会话的受管浏览器面板开关。主进程仍是状态权威。 */
export const browserPanelOpenMapAtom = atom<Map<string, boolean>>(new Map())
/** 用户最小化面板后保留浏览器 session，直到用户主动恢复或关闭。 */
export const browserPanelMinimizedMapAtom = atom<Map<string, boolean>>(new Map())
export const browserStateMapAtom = atom<Map<string, BrowserViewState>>(new Map())
/** 首次风险确认完成后自动加载的 Agent 回复链接。 */
export const browserPendingNavigationMapAtom = atom<Map<string, string>>(new Map())

/** 用户手动恢复文件面板后，该会话再次打开浏览器时不再自动收起。 */
export const browserFilePanelManualRestoreSessionIdsAtom = atomWithStorage<string[]>(
  'myyoda-browser-file-panel-manual-restore-session-ids',
  [],
)

export const currentSessionBrowserStateAtom = atom<BrowserViewState | null>((get) => {
  const sessionId = get(currentAgentSessionIdAtom)
  return sessionId ? get(browserStateMapAtom).get(sessionId) ?? null : null
})

function withoutSessionKey<T>(previous: Map<string, T>, sessionId: string): Map<string, T> {
  if (!previous.has(sessionId)) return previous
  const next = new Map(previous)
  next.delete(sessionId)
  return next
}

/** 删除/归档会话时释放浏览器面板按 sessionId 保存的运行态。 */
export function cleanupDeletedBrowserSessionAtoms(store: Store, sessionId: string): void {
  store.set(browserPanelOpenMapAtom, (prev) => withoutSessionKey(prev, sessionId))
  store.set(browserPanelMinimizedMapAtom, (prev) => withoutSessionKey(prev, sessionId))
  store.set(browserStateMapAtom, (prev) => withoutSessionKey(prev, sessionId))
  store.set(browserPendingNavigationMapAtom, (prev) => withoutSessionKey(prev, sessionId))
  store.set(browserFilePanelManualRestoreSessionIdsAtom, (prev) =>
    prev.includes(sessionId) ? prev.filter((id) => id !== sessionId) : prev,
  )
}
