/**
 * activateTab — Tab 激活副作用回放（共享纯函数）
 *
 * 把 TabBar 的 handleActivate 抽成 store 驱动，供两处复用：
 * 1. TabBar 点击 Tab
 * 2. 前进/后退导航（tab-history-atoms）
 *
 * 行为必须与 TabBar 原实现逐字节等价：切 activeTabId + 关定时任务表单 +
 * 按 Tab 类型同步 appMode / currentConversationId / currentAgentSessionId /
 * 清未读 / 切 workspace 并持久化。
 */

import type { createStore } from 'jotai'
import {
  tabsAtom,
  activeTabIdAtom,
} from '@/atoms/tab-atoms'
import type { TabItem } from '@/atoms/tab-atoms'
import { currentConversationIdAtom } from '@/atoms/chat-atoms'
import {
  agentSessionsAtom,
  currentAgentSessionIdAtom,
  currentAgentWorkspaceIdAtom,
  unviewedCompletedSessionIdsAtom,
} from '@/atoms/agent-atoms'
import { appModeAtom } from '@/atoms/app-mode'
import { automationFormAtom } from '@/atoms/automation-atoms'

type Store = ReturnType<typeof createStore>

/** 激活指定 Tab 并回放全部副作用。Tab 不存在时静默 no-op。 */
export function activateTab(store: Store, tabId: string): void {
  store.set(activeTabIdAtom, tabId)
  // 点击任意 tab 都关闭定时任务编辑表单（overlay 否则会盖在内容区上）
  store.set(automationFormAtom, { open: false, draft: null })

  const tab = store.get(tabsAtom).find((t: TabItem) => t.id === tabId)
  if (!tab) return

  if (tab.type === 'chat') {
    store.set(appModeAtom, 'chat')
    store.set(currentConversationIdAtom, tab.sessionId)
  } else if (tab.type === 'agent' || tab.type === 'preview') {
    store.set(appModeAtom, 'agent')
    store.set(currentAgentSessionIdAtom, tab.sessionId)

    // 用户打开查看后只清除未读角标；是否完成由用户通过对勾确认。
    store.set(unviewedCompletedSessionIdsAtom, (prev) => {
      if (!prev.has(tab.sessionId)) return prev
      const next = new Set(prev)
      next.delete(tab.sessionId)
      return next
    })

    const session = store.get(agentSessionsAtom).find((s) => s.id === tab.sessionId)
    if (session?.workspaceId) {
      store.set(currentAgentWorkspaceIdAtom, session.workspaceId)
      window.electronAPI.updateSettings({
        agentWorkspaceId: session.workspaceId,
      }).catch(console.error)
    }
  } else if (tab.type === 'scratch' || tab.type === 'tutorial' || tab.type === 'pull-request') {
    store.set(currentConversationIdAtom, null)
    if (store.get(appModeAtom) !== 'agent') {
      store.set(currentAgentSessionIdAtom, null)
    }
  }
}
