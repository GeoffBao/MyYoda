/**
 * useDiscoverFeed — 官方精选流的加载与已读标记
 */
import * as React from 'react'
import { useAtom, useSetAtom } from 'jotai'
import {
  discoverFeedAtom,
  discoverFeedErrorAtom,
  discoverFeedLoadingAtom,
  discoverHasUnreadAtom,
} from '@/atoms/discover-atoms'

export function useDiscoverFeed(): {
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  markSeen: (itemId: string, version: string) => void
} {
  const [feed, setFeed] = useAtom(discoverFeedAtom)
  const [loading, setLoading] = useAtom(discoverFeedLoadingAtom)
  const [error, setError] = useAtom(discoverFeedErrorAtom)
  const setHasUnread = useSetAtom(discoverHasUnreadAtom)

  const refresh = React.useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      // force=true 绕过主进程内存缓存，保证手动刷新能看到内容源的最新变化
      const result = await window.electronAPI.discoverGetFeed(true)
      setFeed(result.items)
      setHasUnread(result.hasUnreadUpdates)
      setError(null)
    } catch (err) {
      console.warn('[DiscoverFeed] 拉取官方内容流失败:', err)
      setError(err instanceof Error ? err.message : '内容源不可用')
    } finally {
      setLoading(false)
    }
  }, [setFeed, setLoading, setError, setHasUnread])

  const markSeen = React.useCallback(
    (itemId: string, version: string): void => {
      const next = feed.map((item) =>
        item.id === itemId ? { ...item, hasUpdate: false } : item
      )
      setFeed(next)
      setHasUnread(next.some((item) => item.hasUpdate))
      window.electronAPI.discoverMarkSeen(itemId, version).catch((err: unknown) => {
        console.warn('[DiscoverFeed] 记录已读失败:', err)
      })
    },
    [feed, setFeed, setHasUnread]
  )

  return { loading, error, refresh, markSeen }
}
