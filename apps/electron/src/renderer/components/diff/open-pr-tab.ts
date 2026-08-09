/**
 * useOpenPullRequestTab — 打开 PR 详情 Tab 的统一入口
 *
 * 与 useOpenPreview 对应：任何入口（文件改动面板 PR 状态行 / 创建成功 toast /
 * 左侧栏 PR 列表）点击 PR 时，都通过这里打开独立 Tab。
 * 一个 PR 一个 Tab，可同时开多个（openTab 对 pull-request 类型只追加不替换会话）。
 */

import * as React from 'react'
import { useStore } from 'jotai'
import {
  activeTabIdAtom,
  createPullRequestTabId,
  openTab,
  tabsAtom,
} from '@/atoms/tab-atoms'

/** Jotai store 类型（从 useStore 推导，避免直接 import 内部 Store 类型） */
type JotaiStore = ReturnType<typeof useStore>

export function useOpenPullRequestTab() {
  const store = useStore()

  return React.useCallback(
    (repoPath: string, number: number, title?: string) => {
      const tabId = createPullRequestTabId(repoPath, number)
      const result = openTab(store.get(tabsAtom), {
        type: 'pull-request',
        sessionId: tabId,
        title: title ? `PR #${number} · ${title}` : `PR #${number}`,
      })
      store.set(tabsAtom, result.tabs)
      store.set(activeTabIdAtom, result.activeTabId)
    },
    [store],
  )
}
