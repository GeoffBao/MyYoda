/**
 * DiscoverView — 「发现」面板：官方精选 / 社区讨论 / 反馈
 *
 * 左侧栏「功能」分组内「发现」入口打开的主区独立面板。
 */
import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { Compass, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { discoverTabAtom, discussionCategoryAtom, discussionListResultAtom } from '@/atoms/discover-atoms'
import { useDiscoverFeed } from './use-discover-feed'
import { FeaturedFeed } from './FeaturedFeed'
import { CommunityView } from './CommunityView'
import { FeedbackSection } from './FeedbackSection'

const TABS: Array<{ key: 'featured' | 'community' | 'feedback'; label: string }> = [
  { key: 'featured', label: '官方精选' },
  { key: 'community', label: '社区讨论' },
  { key: 'feedback', label: '反馈' },
]

export function DiscoverView(): React.ReactElement {
  const [tab, setTab] = useAtom(discoverTabAtom)
  const { loading: feedLoadingState, refresh } = useDiscoverFeed()
  const discussionCategory = useAtomValue(discussionCategoryAtom)
  const setDiscussionResult = useSetAtom(discussionListResultAtom)
  const [refreshing, setRefreshing] = React.useState(false)

  const handleRefresh = React.useCallback(async (): Promise<void> => {
    setRefreshing(true)
    try {
      await refresh()
      if (tab === 'community') {
        const result = await window.electronAPI.discoverListDiscussions(discussionCategory, true)
        setDiscussionResult(result)
      }
    } finally {
      setRefreshing(false)
    }
  }, [refresh, tab, discussionCategory, setDiscussionResult])

  // 每次打开面板刷新一次（spec §8：启动 + 打开面板 + 手动刷新）
  React.useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 头部 */}
      <div className="titlebar-no-drag mx-auto flex w-full max-w-5xl shrink-0 items-center justify-between px-8 pt-14 pb-4">
        <div className="flex items-center gap-2.5">
          <Compass className="size-6 text-foreground/70" />
          <h1 className="text-2xl font-semibold text-foreground">发现</h1>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing || feedLoadingState}
          aria-label="刷新内容"
          className="flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-xs text-foreground/60 transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50 titlebar-no-drag"
        >
          <RefreshCw size={13} className={cn(refreshing && 'animate-spin')} />
          刷新
        </button>
      </div>

      {/* Tab 切换 */}
      <div className="titlebar-no-drag mx-auto flex w-full max-w-5xl shrink-0 items-center gap-1 px-8">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={cn(
              'rounded-t-lg border-b-2 px-4 py-2 text-[13px] font-medium transition-colors',
              tab === item.key
                ? 'border-primary text-foreground'
                : 'border-transparent text-foreground/50 hover:text-foreground'
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto w-full max-w-5xl px-8 pt-6 pb-16">
          {tab === 'featured' ? (
            <FeaturedFeed />
          ) : tab === 'community' ? (
            <CommunityView />
          ) : (
            <FeedbackSection />
          )}
        </div>
      </div>
    </div>
  )
}
