/**
 * useDiscoverFeed — 官方精选流的加载与已读标记
 */
import * as React from 'react'
import { useAtom, useSetAtom } from 'jotai'
import {
  discoverFeedAtom,
  discoverFeedErrorAtom,
  discoverFeedLoadingAtom,
  discoverFeedSourceAtom,
  discoverFeedUnreadAtom,
} from '@/atoms/discover-atoms'

export function useDiscoverFeed(): {
  loading: boolean
  error: string | null
  fromCache: boolean
  cachedAt?: number
  refresh: () => Promise<void>
  markSeen: (itemId: string, version: string) => void
} {
  const [, setFeed] = useAtom(discoverFeedAtom)
  const [loading, setLoading] = useAtom(discoverFeedLoadingAtom)
  const [error, setError] = useAtom(discoverFeedErrorAtom)
  const [source, setSource] = useAtom(discoverFeedSourceAtom)
  const setFeedUnread = useSetAtom(discoverFeedUnreadAtom)

  const refresh = React.useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      // force=true 绕过主进程内存缓存，保证手动刷新能看到内容源的最新变化
      const result = await window.electronAPI.discoverGetFeed(true)
      setFeed(result.items)
      setFeedUnread(result.unreadCount)
      setSource({ fromCache: result.fromCache, cachedAt: result.cachedAt })
      setError(null)
    } catch (err) {
      console.warn('[DiscoverFeed] 拉取官方内容流失败:', err)
      setError(err instanceof Error ? err.message : '内容源不可用')
    } finally {
      setLoading(false)
    }
  }, [setFeed, setLoading, setError, setSource, setFeedUnread])

  const markSeen = React.useCallback(
    (itemId: string, version: string): void => {
      // 函数式更新：避免连续快速点击多个条目时基于旧 feed 覆盖彼此的已读标记
      setFeed((prev) => {
        const next = prev.map((item) =>
          item.id === itemId ? { ...item, hasUpdate: false } : item
        )
        setFeedUnread(next.filter((item) => item.hasUpdate).length)
        return next
      })
      window.electronAPI.discoverMarkSeen(itemId, version).catch((err: unknown) => {
        console.warn('[DiscoverFeed] 记录已读失败:', err)
      })
    },
    [setFeed, setFeedUnread]
  )

  return { loading, error, fromCache: source.fromCache, cachedAt: source.cachedAt, refresh, markSeen }
}
