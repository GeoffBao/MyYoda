/**
 * DiscoverInitializer — 应用启动时预拉取官方内容流与未读汇总（侧边栏徽标数据源）
 *
 * 挂载于 main.tsx 顶层，永不卸载。面板打开时 DiscoverView 自身还会再刷新一次。
 */
import * as React from 'react'
import { useSetAtom } from 'jotai'
import {
  discoverCommunityUnreadAtom,
  discoverFeedAtom,
  discoverFeedErrorAtom,
  discoverFeedSourceAtom,
  discoverFeedUnreadAtom,
} from '@/atoms/discover-atoms'

export function DiscoverInitializer(): React.ReactElement | null {
  const setFeed = useSetAtom(discoverFeedAtom)
  const setFeedUnread = useSetAtom(discoverFeedUnreadAtom)
  const setCommunityUnread = useSetAtom(discoverCommunityUnreadAtom)
  const setError = useSetAtom(discoverFeedErrorAtom)
  const setSource = useSetAtom(discoverFeedSourceAtom)

  React.useEffect(() => {
    let cancelled = false
    window.electronAPI
      .discoverGetFeed()
      .then((result) => {
        if (cancelled) return
        setFeed(result.items)
        setFeedUnread(result.unreadCount)
        setSource({ fromCache: result.fromCache, cachedAt: result.cachedAt })
        setError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        console.warn('[DiscoverInitializer] 官方内容流拉取失败:', err)
        setError(err instanceof Error ? err.message : '内容源不可用')
      })
    window.electronAPI
      .discoverGetUnreadSummary()
      .then((summary) => {
        if (cancelled) return
        setCommunityUnread(summary.communityUnread)
      })
      .catch((err: unknown) => {
        console.warn('[DiscoverInitializer] 未读汇总拉取失败:', err)
      })
    return () => {
      cancelled = true
    }
  }, [setFeed, setFeedUnread, setCommunityUnread, setError, setSource])

  return null
}
