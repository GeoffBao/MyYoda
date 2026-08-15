/**
 * DiscoverInitializer — 应用启动时预拉取官方内容流（侧边栏红点数据源）
 *
 * 挂载于 main.tsx 顶层，永不卸载。面板打开时 DiscoverView 自身还会再刷新一次。
 */
import * as React from 'react'
import { useSetAtom } from 'jotai'
import { discoverFeedAtom, discoverFeedErrorAtom, discoverHasUnreadAtom } from '@/atoms/discover-atoms'

export function DiscoverInitializer(): React.ReactElement | null {
  const setFeed = useSetAtom(discoverFeedAtom)
  const setHasUnread = useSetAtom(discoverHasUnreadAtom)
  const setError = useSetAtom(discoverFeedErrorAtom)

  React.useEffect(() => {
    let cancelled = false
    window.electronAPI
      .discoverGetFeed()
      .then((result) => {
        if (cancelled) return
        setFeed(result.items)
        setHasUnread(result.hasUnreadUpdates)
        setError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        console.warn('[DiscoverInitializer] 官方内容流拉取失败:', err)
        setError(err instanceof Error ? err.message : '内容源不可用')
      })
    return () => {
      cancelled = true
    }
  }, [setFeed, setHasUnread, setError])

  return null
}
