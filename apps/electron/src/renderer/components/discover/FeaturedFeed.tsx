/**
 * FeaturedFeed — 官方精选流：视频 / 教程 / 公告 / 外链 四类内容
 *
 * - 每条带「更新」标记（hasUpdate），点击即记已读
 * - 视频：下载进度条（主进程推送）→ 完成后应用内播放
 * - 教程：点击拉取 markdown 在卡片内展开渲染
 * - 公告：直接渲染短文本
 * - 外链：跳系统浏览器
 */
import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { CloudOff, Download, ExternalLink, FileText, Link2, Loader2, Megaphone, Play, RefreshCw, Video, WifiOff } from 'lucide-react'
import type { DiscoverContentItem, DiscoverFeedItem, VideoDownloadState } from '@myyoda/shared'
import { cn } from '@/lib/utils'
import { discoverFeedAtom, videoDownloadStatesAtom } from '@/atoms/discover-atoms'
import { useDiscoverFeed } from './use-discover-feed'
import { ReleaseNoteMarkdown } from '@/components/settings/ReleaseNoteMarkdown'
import { VideoPlayerDialog } from './VideoPlayerDialog'

const TYPE_META: Record<DiscoverFeedItem['type'], { icon: React.ComponentType<{ size?: number | string; className?: string }>; label: string }> = {
  video: { icon: Video, label: '视频' },
  article: { icon: FileText, label: '教程' },
  announcement: { icon: Megaphone, label: '公告' },
  link: { icon: Link2, label: '外链' },
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function FeaturedFeed(): React.ReactElement {
  const feed = useAtomValue(discoverFeedAtom)
  const { loading, error, fromCache, cachedAt, refresh, markSeen } = useDiscoverFeed()
  const [videoStates, setVideoStates] = useAtom(videoDownloadStatesAtom)
  const [expandedArticles, setExpandedArticles] = React.useState<Map<string, string>>(new Map())
  const [articleErrors, setArticleErrors] = React.useState<Map<string, string>>(new Map())
  const [playingItem, setPlayingItem] = React.useState<DiscoverFeedItem | null>(null)

  // 订阅下载进度推送
  React.useEffect(() => {
    const offProgress = window.electronAPI.onVideoDownloadProgress((event) => {
      setVideoStates((prev) => {
        const next = new Map(prev)
        next.set(event.itemId, { itemId: event.itemId, status: 'downloading', progress: event.progress })
        return next
      })
    })
    const offDone = window.electronAPI.onVideoDownloadDone((event) => {
      setVideoStates((prev) => {
        const next = new Map(prev)
        next.set(event.itemId, { itemId: event.itemId, status: 'done', progress: 1, filePath: event.filePath })
        return next
      })
    })
    return () => {
      offProgress()
      offDone()
    }
  }, [setVideoStates])

  // 初始查询每个视频的本地缓存状态
  React.useEffect(() => {
    let cancelled = false
    for (const item of feed) {
      if (item.type !== 'video') continue
      const video = item.video
      if (!video) continue
      window.electronAPI
        .discoverGetVideoStatus(item.id, item.version, video.size)
        .then((state: VideoDownloadState) => {
          if (cancelled) return
          setVideoStates((prev) => new Map(prev).set(item.id, state))
        })
        .catch(() => {
          // 查询失败保持未下载态
        })
    }
    return () => {
      cancelled = true
    }
  }, [feed, setVideoStates])

  const handleItemClick = React.useCallback(
    (item: DiscoverFeedItem): void => {
      if (item.hasUpdate) markSeen(item.id, item.version)
    },
    [markSeen]
  )

  /** 下载视频到本地缓存并返回文件路径（不自动播放，供卡片与播放器兜底共用） */
  const handleDownload = React.useCallback(
    async (item: DiscoverFeedItem): Promise<string> => {
      setVideoStates((prev) => new Map(prev).set(item.id, { itemId: item.id, status: 'downloading', progress: 0 }))
      try {
        const { filePath } = await window.electronAPI.discoverDownloadVideo(item)
        setVideoStates((prev) =>
          new Map(prev).set(item.id, { itemId: item.id, status: 'done', progress: 1, filePath })
        )
        return filePath
      } catch (err) {
        setVideoStates((prev) =>
          new Map(prev).set(item.id, {
            itemId: item.id,
            status: 'error',
            progress: 0,
            error: err instanceof Error ? err.message : '下载失败',
          })
        )
        throw err
      }
    },
    [setVideoStates]
  )

  const downloadAndGetPath = React.useCallback(
    async (item: DiscoverContentItem): Promise<string> => handleDownload(item as DiscoverFeedItem),
    [handleDownload]
  )

  const handleToggleArticle = React.useCallback(
    async (item: DiscoverFeedItem): Promise<void> => {
      handleItemClick(item)
      if (expandedArticles.has(item.id)) {
        setExpandedArticles((prev) => {
          const next = new Map(prev)
          next.delete(item.id)
          return next
        })
        setArticleErrors((prev) => {
          const next = new Map(prev)
          next.delete(item.id)
          return next
        })
        return
      }
      const contentUrl = item.contentUrl
      if (!contentUrl) return
      setExpandedArticles((prev) => new Map(prev).set(item.id, ''))
      try {
        const markdown = await window.electronAPI.discoverGetArticle(contentUrl)
        setExpandedArticles((prev) => new Map(prev).set(item.id, markdown))
      } catch (err) {
        setExpandedArticles((prev) => {
          const next = new Map(prev)
          next.delete(item.id)
          return next
        })
        setArticleErrors((prev) =>
          new Map(prev).set(item.id, err instanceof Error ? err.message : '未知错误')
        )
      }
    },
    [expandedArticles, handleItemClick]
  )

  if (loading && feed.length === 0) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-sm text-foreground/50">
        <Loader2 size={16} className="animate-spin" />
        正在加载官方内容...
      </div>
    )
  }

  if (loading && feed.length === 0) {
    // 首次加载：骨架屏（三张卡片占位）
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="animate-pulse rounded-xl border border-border/40 bg-content-area p-4 shadow-sm"
          >
            <div className="flex items-start gap-2.5">
              <div className="mt-0.5 size-7 shrink-0 rounded-lg bg-foreground/[0.05]" />
              <div className="flex-1">
                <div className="h-3.5 w-1/3 rounded bg-foreground/[0.06]" />
                <div className="mt-2 h-2.5 w-1/2 rounded bg-foreground/[0.04]" />
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <div className="h-7 w-20 rounded-lg bg-foreground/[0.05]" />
              <div className="h-7 w-20 rounded-lg bg-foreground/[0.04]" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (error && feed.length === 0) {
    // 完全不可用：网络失败且无缓存
    return (
      <div className="flex flex-col items-center gap-4 py-24">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-foreground/[0.04]">
          <WifiOff size={24} className="text-foreground/30" />
        </div>
        <div className="flex flex-col items-center gap-1">
          <div className="text-[15px] font-medium text-foreground/85">无法加载官方内容</div>
          <div className="max-w-md text-center text-xs leading-relaxed text-foreground/45">
            {error}
            <br />
            内容源需要联网访问（GitHub 资源）。请检查网络连接；如已配置代理，可在设置中确认代理是否生效。
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          <RefreshCw size={13} />
          重试
        </button>
      </div>
    )
  }

  if (feed.length === 0) {
    return <div className="py-24 text-center text-sm text-foreground/50">暂无官方内容</div>
  }

  return (
    <>
      {/* 离线横幅：展示本地缓存（网络失败降级） */}
      {fromCache && (
        <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-border/50 bg-foreground/[0.03] px-3.5 py-2.5">
          <span className="flex items-center gap-1.5 text-xs text-foreground/55">
            <CloudOff size={13} className="shrink-0" />
            离线模式：显示上次缓存的内容
            {cachedAt && <span className="text-foreground/35">（{formatDate(new Date(cachedAt).toISOString())}）</span>}
          </span>
          <button
            type="button"
            onClick={() => void refresh()}
            className="flex shrink-0 items-center gap-1 rounded-lg bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15"
          >
            <RefreshCw size={11} />
            重新连接
          </button>
        </div>
      )}
      <div className="flex flex-col gap-3">
        {feed.map((item) => {
          const meta = TYPE_META[item.type]
          const Icon = meta.icon
          const videoState = item.type === 'video' ? videoStates.get(item.id) : undefined
          const articleMarkdown = expandedArticles.get(item.id)
          return (
            <div
              key={item.id}
              className="rounded-xl border border-border/60 bg-content-area p-4 shadow-sm transition-colors"
            >
              {/* 头部：类型徽标 + 标题 + 更新标记 */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-2.5">
                  <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.04] text-foreground/60">
                    <Icon size={14} />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-[13.5px] font-medium text-foreground/90">{item.title}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-foreground/40">
                      <span>{meta.label}</span>
                      <span>·</span>
                      <span>{formatDate(item.publishedAt)}</span>
                      {item.description && (
                        <>
                          <span>·</span>
                          <span className="truncate">{item.description}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                {item.hasUpdate && (
                  <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10.5px] font-medium text-primary">
                    更新
                  </span>
                )}
              </div>

              {/* 内容区（按类型） */}
              {item.type === 'video' && item.video && (
                <div className="mt-3 flex items-center gap-2">
                  {/* 播放：直接流式播放（主进程代理转发），无需下载 */}
                  <button
                    type="button"
                    onClick={() => {
                      handleItemClick(item)
                      setPlayingItem(item)
                    }}
                    className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
                  >
                    <Play size={12} />
                    播放
                  </button>

                  {/* 下载：离线兜底（进度在卡片上显示） */}
                  {videoState?.status === 'downloading' ? (
                    <div className="flex min-w-[120px] flex-1 items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/[0.06]">
                        <div
                          className="h-full rounded-full bg-primary transition-[width] duration-300"
                          style={{ width: `${Math.round((videoState.progress ?? 0) * 100)}%` }}
                        />
                      </div>
                      <span className="shrink-0 text-[11px] tabular-nums text-foreground/50">
                        {Math.round((videoState.progress ?? 0) * 100)}%
                      </span>
                    </div>
                  ) : videoState?.status === 'done' ? (
                    <span className="text-[11px] text-foreground/40">已缓存到本地</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleDownload(item)}
                      title="下载到本地缓存（离线可用）"
                      className="flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-xs text-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <Download size={12} />
                      下载
                      {item.video.size && (
                        <span className="text-[10.5px] text-foreground/35">{formatBytes(item.video.size)}</span>
                      )}
                    </button>
                  )}
                  {videoState?.status === 'error' && (
                    <span className="text-[11px] text-destructive">{videoState.error ?? '下载失败，可重试'}</span>
                  )}
                </div>
              )}

              {item.type === 'article' && (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => void handleToggleArticle(item)}
                    className="text-xs font-medium text-primary transition-opacity hover:opacity-80"
                  >
                    {articleMarkdown !== undefined ? '收起' : '阅读全文'}
                  </button>
                  {articleMarkdown !== undefined && (
                    <div className="mt-2 rounded-lg bg-background/60 p-3.5">
                      {articleMarkdown === '' ? (
                        <div className="flex items-center gap-2 text-xs text-foreground/50">
                          <Loader2 size={12} className="animate-spin" />
                          加载中...
                        </div>
                      ) : articleMarkdown ? (
                        <ReleaseNoteMarkdown content={articleMarkdown} compact />
                      ) : null}
                      {articleErrors.get(item.id) && (
                        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-foreground/[0.03] px-3 py-2.5">
                          <span className="text-xs text-foreground/55">教程加载失败：{articleErrors.get(item.id)}</span>
                          <button
                            type="button"
                            onClick={() => {
                              setArticleErrors((prev) => {
                                const next = new Map(prev)
                                next.delete(item.id)
                                return next
                              })
                              void handleToggleArticle(item)
                            }}
                            className="shrink-0 flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15"
                          >
                            <RefreshCw size={11} />
                            重试
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {item.type === 'announcement' && item.body && (
                <div className="mt-3">
                  <ReleaseNoteMarkdown content={item.body} compact />
                </div>
              )}

              {item.type === 'link' && item.url && (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => {
                      handleItemClick(item)
                      void window.electronAPI.openExternal(item.url ?? '')
                    }}
                    className="flex items-center gap-1.5 rounded-lg border border-border/70 px-3.5 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <ExternalLink size={12} />
                    打开链接
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {playingItem && (
        <VideoPlayerDialog
          item={playingItem}
          open
          onOpenChange={(open) => {
            if (!open) setPlayingItem(null)
          }}
          downloadAndGetPath={downloadAndGetPath}
        />
      )}
    </>
  )
}
