/**
 * CommunityView — 社区讨论：GitHub Discussions 只读浏览 + 跳浏览器互动
 *
 * - 板块 tab：问题讨论 / 经验分享 / 公告
 * - 列表：标题、作者、回复数、标签、时间
 * - 详情：正文 markdown 应用内渲染，「回复」「发起讨论」跳浏览器
 */
import * as React from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { CloudOff, ArrowLeft, ExternalLink, Loader2, MessageSquare, Plus, RefreshCw, Sparkles } from 'lucide-react'
import { DISCUSSION_CATEGORIES, type DiscussionComment, type DiscussionDetail, type DiscussionSummary } from '@myyoda/shared'
import { cn } from '@/lib/utils'
import {
  discoverCommunityUnreadAtom,
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
          <div className="flex shrink-0 items-center gap-1.5">
            {discussion.hasNewReplies && (
              <span className="rounded-full bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
                新回复
              </span>
            )}
            <div className="flex items-center gap-1 text-[11px] text-foreground/40">
              <MessageSquare size={11} />
              <span className="tabular-nums">{discussion.commentCount}</span>
            </div>
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

/** 评论渲染：顶层评论 + 缩进的回复 */
function CommentItem({
  comment,
  isReply = false,
}: {
  comment: DiscussionComment
  isReply?: boolean
}): React.ReactElement {
  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-lg p-2.5',
        comment.isAnswer ? 'bg-emerald-500/[0.06]' : 'bg-foreground/[0.02]',
        isReply && 'ml-8'
      )}
    >
      {comment.authorAvatarUrl ? (
        <img
          src={comment.authorAvatarUrl}
          alt={comment.author}
          className="mt-0.5 size-6 shrink-0 rounded-full border border-border/60"
        />
      ) : (
        <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground/[0.06] text-[9px] font-medium text-foreground/50">
          {comment.author.slice(0, 1).toUpperCase()}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[11px] text-foreground/45">
          <span className="font-medium text-foreground/70">{comment.author}</span>
          <span>{formatDate(comment.createdAt)}</span>
          {comment.isAnswer && (
            <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
              已采纳答案
            </span>
          )}
        </div>
        <div className="mt-1.5">
          <ReleaseNoteMarkdown content={comment.bodyMarkdown} compact />
        </div>
      </div>
    </div>
  )
}

/** 讨论详情视图 */
function DiscussionDetailView({
  detail,
  onBack,
  onRefresh,
  refreshing,
}: {
  detail: DiscussionDetail
  onBack: () => void
  onRefresh: () => void
  refreshing: boolean
}): React.ReactElement {
  const topLevel = detail.comments.filter((c) => c.parentId === null)
  const repliesByParent = new Map<number, DiscussionComment[]>()
  for (const comment of detail.comments) {
    if (comment.parentId === null) continue
    const list = repliesByParent.get(comment.parentId) ?? []
    list.push(comment)
    repliesByParent.set(comment.parentId, list)
  }

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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="刷新评论"
            title="刷新正文与评论"
            className="flex items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1.5 text-xs text-foreground/60 transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw size={12} className={cn(refreshing && 'animate-spin')} />
          </button>
          <button
            type="button"
            onClick={() => void window.electronAPI.openExternal(buildDiscussionUrl(detail.number))}
            className="flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
          >
            <ExternalLink size={12} />
            在 GitHub 回复
          </button>
        </div>
      </div>

      {/* 正文 */}
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

      {/* 评论区 */}
      <div className="rounded-xl border border-border/60 bg-content-area p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[13px] font-medium text-foreground/80">
            <MessageSquare size={13} className="text-foreground/45" />
            评论与回复
            <span className="text-[11px] tabular-nums text-foreground/40">{detail.comments.length}</span>
          </div>
          <span className="text-[10.5px] text-foreground/35">在应用内查看 · 回复请跳转 GitHub</span>
        </div>
        <div className="mt-3 flex flex-col gap-1.5 border-t border-border/40 pt-3">
          {topLevel.length === 0 ? (
            <div className="py-8 text-center text-xs text-foreground/40">
              还没有评论，去 GitHub 发起第一条讨论回复吧
            </div>
          ) : (
            topLevel.map((comment) => (
              <div key={comment.id} className="flex flex-col gap-1">
                <CommentItem comment={comment} />
                {(repliesByParent.get(comment.id) ?? []).map((reply) => (
                  <CommentItem key={reply.id} comment={reply} isReply />
                ))}
              </div>
            ))
          )}
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
  const setCommunityUnread = useSetAtom(discoverCommunityUnreadAtom)
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
          fromCache: false,
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
    (number: number, force = false): void => {
      setDetailLoading(true)
      window.electronAPI
        .discoverGetDiscussion(number, force)
        .then((result) => {
          setDetail(result)
          // 打开详情即记已读：写主进程状态 + 本地列表「新回复」标记清除 + 未读计数递减
          const viewedItem = listResult.items.find((item) => item.number === number)
          if (viewedItem?.hasNewReplies) {
            setListResult((prev) => ({
              ...prev,
              items: prev.items.map((item) =>
                item.number === number ? { ...item, hasNewReplies: false } : item
              ),
            }))
            setCommunityUnread((prev) => Math.max(0, prev - 1))
          }
          window.electronAPI
            // 以列表项 commentCount 为已读基准（详情 comments 数组受 per_page=100 截断，
            // 用列表计数才能保证「新回复」标记可消除；主进程侧会取 max 防止旧值写小）
            .discoverMarkDiscussionViewed(number, viewedItem?.commentCount ?? result.comments.length)
            .catch((err: unknown) => {
              console.warn('[CommunityView] 记录讨论已读失败:', err)
            })
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
    [setDetail, setDetailLoading, listResult.items, setListResult, setCommunityUnread]
  )

  const handleRefreshDetail = React.useCallback((): void => {
    if (detail) handleOpenDiscussion(detail.number, true)
  }, [detail, handleOpenDiscussion])

  if (detail) {
    return (
      <DiscussionDetailView
        detail={detail}
        onBack={() => setDetail(null)}
        onRefresh={handleRefreshDetail}
        refreshing={detailLoading}
      />
    )
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

      {/* 提示条：离线缓存（灰）/ 限流（橙）/ 其他错误 */}
      {listResult.fromCache && !listResult.rateLimited && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-border/50 bg-foreground/[0.03] px-3 py-2.5">
          <span className="flex items-center gap-1.5 text-xs text-foreground/55">
            <CloudOff size={13} className="shrink-0" />
            离线模式：展示上次缓存的讨论列表
          </span>
          <button
            type="button"
            onClick={() => void loadList(category, true)}
            className="shrink-0 flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15"
          >
            <RefreshCw size={11} />
            重新连接
          </button>
        </div>
      )}
      {listResult.rateLimited && (
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
      {!listResult.fromCache && !listResult.rateLimited && listResult.error && (
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
