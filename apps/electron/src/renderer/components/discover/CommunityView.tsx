/**
 * CommunityView — 社区讨论：GitHub Discussions 只读浏览 + 跳浏览器互动
 *
 * - 板块 tab：问题讨论 / 经验分享 / 公告
 * - 列表：标题、作者、回复数、标签、时间
 * - 详情：正文 markdown 应用内渲染，「回复」「发起讨论」跳浏览器
 */
import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { ArrowLeft, ExternalLink, Loader2, MessageSquare, Plus, RefreshCw, Sparkles } from 'lucide-react'
import { DISCUSSION_CATEGORIES, type DiscussionDetail, type DiscussionSummary } from '@myyoda/shared'
import { cn } from '@/lib/utils'
import {
  discussionCategoryAtom,
  discussionDetailAtom,
  discussionDetailLoadingAtom,
  discussionListLoadingAtom,
  discussionListResultAtom,
} from '@/atoms/discover-atoms'
import { ReleaseNoteMarkdown } from '@/components/settings/ReleaseNoteMarkdown'

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function buildDiscussionUrl(number: number): string {
  return `https://github.com/GeoffBao/MyYoda/discussions/${number}`
}

function buildNewDiscussionUrl(categorySlug: string): string {
  return `https://github.com/GeoffBao/MyYoda/discussions/new?category=${encodeURIComponent(categorySlug)}`
}

/** 讨论列表卡片 */
function DiscussionItem({
  discussion,
  onOpen,
}: {
  discussion: DiscussionSummary
  onOpen: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-start gap-3 rounded-xl border border-border/60 bg-content-area p-4 text-left shadow-sm transition-colors hover:bg-accent/60"
    >
      {discussion.authorAvatarUrl ? (
        <img
          src={discussion.authorAvatarUrl}
          alt={discussion.author}
          className="mt-0.5 size-7 shrink-0 rounded-full border border-border/60"
        />
      ) : (
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground/[0.06] text-[10px] font-medium text-foreground/50">
          {discussion.author.slice(0, 1).toUpperCase()}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="truncate text-[13.5px] font-medium text-foreground/90">
            {discussion.isAnswered && <Sparkles size={12} className="mr-1 inline text-emerald-500" />}
            {discussion.title}
          </div>
          <div className="flex shrink-0 items-center gap-1 text-[11px] text-foreground/40">
            <MessageSquare size={11} />
            <span className="tabular-nums">{discussion.commentCount}</span>
          </div>
        </div>
        <div className="mt-1 flex items-center gap-2 text-[11px] text-foreground/40">
          <span>{discussion.author}</span>
          <span>·</span>
          <span>{formatDate(discussion.updatedAt)}</span>
          {discussion.labels.map((label) => (
            <span
              key={label}
              className="rounded-full bg-foreground/[0.05] px-1.5 py-0.5 text-[10px] text-foreground/50"
            >
              {label}
            </span>
          ))}
        </div>
      </div>
    </button>
  )
}

/** 讨论详情视图 */
function DiscussionDetailView({
  detail,
  onBack,
}: {
  detail: DiscussionDetail
  onBack: () => void
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft size={13} />
          返回列表
        </button>
        <button
          type="button"
          onClick={() => void window.electronAPI.openExternal(buildDiscussionUrl(detail.number))}
          className="flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
        >
          <ExternalLink size={12} />
          在 GitHub 查看与回复
        </button>
      </div>

      <div className="rounded-xl border border-border/60 bg-content-area p-5 shadow-sm">
        <h2 className="text-[16px] font-semibold text-foreground">{detail.title}</h2>
        <div className="mt-1.5 flex items-center gap-2 text-[11.5px] text-foreground/45">
          <span>{detail.author}</span>
          <span>·</span>
          <span>{formatDate(detail.createdAt)}</span>
          {detail.isAnswered && <span className="text-emerald-500">已解决</span>}
        </div>
        <div className="mt-4 border-t border-border/40 pt-4">
          <ReleaseNoteMarkdown content={detail.bodyMarkdown} />
        </div>
      </div>
    </div>
  )
}

export function CommunityView(): React.ReactElement {
  const [category, setCategory] = useAtom(discussionCategoryAtom)
  const [listResult, setListResult] = useAtom(discussionListResultAtom)
  const [listLoading, setListLoading] = useAtom(discussionListLoadingAtom)
  const [detail, setDetail] = useAtom(discussionDetailAtom)
  const [detailLoading, setDetailLoading] = useAtom(discussionDetailLoadingAtom)
  const [loadedCategory, setLoadedCategory] = React.useState<string | null>(null)

  const loadList = React.useCallback(
    async (slug: string, force = false): Promise<void> => {
      setListLoading(true)
      try {
        const result = await window.electronAPI.discoverListDiscussions(
          slug as (typeof DISCUSSION_CATEGORIES)[number]['slug'],
          force
        )
        setListResult(result)
        setLoadedCategory(slug)
      } catch (err) {
        console.warn('[CommunityView] 讨论列表拉取失败:', err)
        setListResult({
          items: [],
          error: err instanceof Error ? err.message : '社区内容拉取失败',
          rateLimited: false,
        })
        setLoadedCategory(slug)
      } finally {
        setListLoading(false)
      }
    },
    [setListLoading, setListResult]
  )

  // 首次进入或切换板块时加载（缓存内数据由主进程直接复用）
  React.useEffect(() => {
    if (loadedCategory === category) return
    void loadList(category)
  }, [category, loadedCategory, loadList])

  const handleOpenDiscussion = React.useCallback(
    (number: number): void => {
      setDetailLoading(true)
      window.electronAPI
        .discoverGetDiscussion(number)
        .then((result) => {
          setDetail(result)
        })
        .catch((err: unknown) => {
          console.warn('[CommunityView] 讨论详情拉取失败:', err)
          // 详情拉取失败时跳浏览器查看
          void window.electronAPI.openExternal(buildDiscussionUrl(number))
        })
        .finally(() => {
          setDetailLoading(false)
        })
    },
    [setDetail, setDetailLoading]
  )

  if (detail) {
    return <DiscussionDetailView detail={detail} onBack={() => setDetail(null)} />
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 板块 tab + 发起讨论 */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          {DISCUSSION_CATEGORIES.map((item) => (
            <button
              key={item.slug}
              type="button"
              onClick={() => setCategory(item.slug)}
              title={item.description}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                category === item.slug
                  ? 'bg-accent-foreground/[0.10] text-foreground'
                  : 'text-foreground/50 hover:bg-accent-foreground/[0.06] hover:text-foreground'
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void loadList(category, true)}
            aria-label="刷新讨论列表"
            className="flex items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1.5 text-xs text-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
          >
            <RefreshCw size={12} className={cn(listLoading && 'animate-spin')} />
          </button>
          <button
            type="button"
            onClick={() => void window.electronAPI.openExternal(buildNewDiscussionUrl(category))}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Plus size={12} />
            发起讨论
          </button>
        </div>
      </div>

      {/* 提示条（限流/错误） */}
      {listResult.error && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2.5">
          <span className="text-xs text-foreground/60">{listResult.error}</span>
          <button
            type="button"
            onClick={() => void loadList(category, true)}
            className="shrink-0 rounded-lg bg-primary/10 px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/15"
          >
            重试
          </button>
        </div>
      )}

      {/* 列表 */}
      {listLoading && listResult.items.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-20 text-sm text-foreground/50">
          <Loader2 size={16} className="animate-spin" />
          正在加载讨论...
        </div>
      ) : listResult.items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-20">
          <div className="text-sm text-foreground/50">这个板块还没有讨论</div>
          <div className="text-xs text-foreground/35">来发起第一个吧</div>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {listResult.items.map((discussion) => (
            <DiscussionItem
              key={discussion.number}
              discussion={discussion}
              onOpen={() => handleOpenDiscussion(discussion.number)}
            />
          ))}
        </div>
      )}

      {/* 详情加载遮罩提示 */}
      {detailLoading && (
        <div className="flex items-center justify-center gap-2 py-10 text-xs text-foreground/50">
          <Loader2 size={13} className="animate-spin" />
          正在加载讨论详情...
        </div>
      )}
    </div>
  )
}
