/**
 * 「发现」社区服务：GitHub Discussions 只读拉取 + 本地缓存
 *
 * - 列表：GET https://api.github.com/repos/GeoffBao/MyYoda/discussions（匿名限流 60 次/时/IP）
 * - 详情：GET .../discussions/{number}（含 body markdown）
 * - 缓存：磁盘 discussions-cache.json + 内存缓存，TTL 5 分钟
 * - 板块筛选在解析后按 categorySlug 过滤（REST 无分类过滤参数），未知 slug 丢弃
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type DiscussionCategorySlug,
  type DiscussionComment,
  type DiscussionDetail,
  type DiscussionListResult,
  type DiscussionSummary,
} from '@myyoda/shared'
import { getDiscoverCommunityStatePath, getDiscoverDiscussionsCachePath } from './config-paths'
import { getFetchFn } from './proxy-fetch'
import { getEffectiveProxyUrl } from './proxy-settings-service'
import { rewriteMarkdownMedia, rewriteRemoteMediaUrl } from './media-rewrite'
import { registerRemoteMediaUrl } from './discover-remote-media'

export const DISCUSSION_CACHE_TTL_MS = 5 * 60 * 1000

/** 社区承载仓库（MyYoda 主仓库） */
export const COMMUNITY_REPO = { owner: 'GeoffBao', repo: 'MyYoda' }

const KNOWN_CATEGORY_SLUGS = new Set<string>(['q-a', 'show-and-tell', 'announcements'])

interface DiscussionCacheEntry {
  fetchedAt: number
  items: DiscussionSummary[]
}

/** 社区已读状态：讨论 number -> 已看评论数与查看时间 */
export type CommunityViewedState = Record<number, { viewedCommentCount: number; viewedAt: number }>

/** 读取社区已读状态（不存在或损坏返回空对象） */
function readCommunityState(): CommunityViewedState {
  try {
    const raw = JSON.parse(readFileSync(getDiscoverCommunityStatePath(), 'utf-8')) as unknown
    if (typeof raw === 'object' && raw !== null) return raw as CommunityViewedState
    return {}
  } catch {
    return {}
  }
}

/** 写社区已读状态 */
function writeCommunityState(state: CommunityViewedState): void {
  mkdirSync(join(getDiscoverCommunityStatePath(), '..'), { recursive: true })
  writeFileSync(getDiscoverCommunityStatePath(), JSON.stringify(state, null, 2))
}

/** 判定某讨论是否有新增回复（纯逻辑：只看“看过之后新增的”） */
export function computeHasNewReplies(
  commentCount: number,
  viewed: { viewedCommentCount: number } | undefined,
): boolean {
  return viewed !== undefined && commentCount > viewed.viewedCommentCount
}

/** 记录某讨论已读（打开详情时调用，传入当前评论总数） */
export function markDiscussionViewed(number: number, commentCount: number): void {
  const state = readCommunityState()
  state[number] = { viewedCommentCount: commentCount, viewedAt: Date.now() }
  writeCommunityState(state)
}

/** 内存缓存 */
let listMemoryCache: Map<string, DiscussionCacheEntry> | null = null
const detailMemoryCache = new Map<number, { fetchedAt: number; detail: DiscussionDetail }>()

/** 读取磁盘缓存 */
function readListCache(categorySlug: string): DiscussionCacheEntry | null {
  try {
    const raw = JSON.parse(readFileSync(getDiscoverDiscussionsCachePath(), 'utf-8')) as Record<
      string,
      DiscussionCacheEntry
    >
    const entry = raw[categorySlug]
    if (entry && typeof entry.fetchedAt === 'number' && Array.isArray(entry.items)) return entry
    return null
  } catch {
    return null
  }
}

/** 写磁盘缓存（合并已有内容） */
function writeListCache(categorySlug: string, entry: DiscussionCacheEntry): void {
  let all: Record<string, DiscussionCacheEntry> = {}
  try {
    all = JSON.parse(readFileSync(getDiscoverDiscussionsCachePath(), 'utf-8')) as Record<
      string,
      DiscussionCacheEntry
    >
  } catch {
    // 文件不存在或损坏，重建
  }
  all[categorySlug] = entry
  mkdirSync(join(getDiscoverDiscussionsCachePath(), '..'), { recursive: true })
  writeFileSync(getDiscoverDiscussionsCachePath(), JSON.stringify(all, null, 2))
}

/** 解析 GitHub 原始条目为摘要（未知字段容错） */
function parseSummaryEntry(raw: Record<string, unknown>): DiscussionSummary | null {
  const number = raw.number
  const title = raw.title
  const user = raw.user as Record<string, unknown> | null | undefined
  const category = raw.category as Record<string, unknown> | null | undefined
  if (typeof number !== 'number' || typeof title !== 'string') return null
  const categorySlug = typeof category?.slug === 'string' ? category.slug : ''
  if (!KNOWN_CATEGORY_SLUGS.has(categorySlug)) return null
  const answers = Array.isArray(raw.answers) ? (raw.answers as Array<Record<string, unknown>>) : []
  const labels = Array.isArray(raw.labels)
    ? (raw.labels as Array<Record<string, unknown>>)
        .map((label) => label.name)
        .filter((name): name is string => typeof name === 'string')
    : []
  return {
    number,
    title,
    author: typeof user?.login === 'string' ? user.login : 'unknown',
    authorAvatarUrl: typeof user?.avatar_url === 'string' ? user.avatar_url : undefined,
    answerCount: answers.length,
    commentCount: typeof raw.comments === 'number' ? raw.comments : 0,
    createdAt: typeof raw.created_at === 'string' ? raw.created_at : '',
    updatedAt: typeof raw.updated_at === 'string' ? raw.updated_at : '',
    labels,
    categorySlug: categorySlug as DiscussionCategorySlug,
    isAnswered: answers.some((answer) => answer.is_answer === true),
    hasNewReplies: false,
  }
}

/** 解析讨论列表原始 JSON（无 IO，可单测） */
export function parseDiscussionList(raw: unknown): DiscussionSummary[] {
  if (!Array.isArray(raw)) return []
  const items: DiscussionSummary[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const summary = parseSummaryEntry(entry as Record<string, unknown>)
    if (summary) items.push(summary)
  }
  return items.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
}

/** 解析讨论详情原始 JSON（无 IO，可单测） */
export function parseDiscussionDetail(raw: unknown): DiscussionDetail {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('讨论详情格式错误')
  }
  const record = raw as Record<string, unknown>
  const summary = parseSummaryEntry(record)
  if (!summary) {
    throw new Error('讨论详情解析失败：板块不受支持或字段缺失')
  }
  return { ...summary, bodyMarkdown: typeof record.body === 'string' ? record.body : '', comments: [] }
}

/** 从 answer_html_url 提取被采纳评论的 id（锚点形如 #discussioncomment-123679） */
export function extractAnswerCommentId(answerHtmlUrl: string | undefined): number | null {
  if (!answerHtmlUrl) return null
  const match = /discussioncomment-(\d+)/.exec(answerHtmlUrl)
  return match ? Number(match[1]) : null
}

/** 解析讨论评论原始 JSON（无 IO，可单测；扁平原列表含回复，parentId 关联） */
export function parseDiscussionComments(raw: unknown, answerCommentId: number | null): DiscussionComment[] {
  if (!Array.isArray(raw)) return []
  const comments: DiscussionComment[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    if (typeof record.id !== 'number') continue
    const user = record.user as Record<string, unknown> | null | undefined
    const parentId = typeof record.parent_id === 'number' ? record.parent_id : null
    comments.push({
      id: record.id,
      bodyMarkdown: typeof record.body === 'string' ? record.body : '',
      author: typeof user?.login === 'string' ? user.login : 'unknown',
      authorAvatarUrl: typeof user?.avatar_url === 'string' ? user.avatar_url : undefined,
      createdAt: typeof record.created_at === 'string' ? record.created_at : '',
      isAnswer: answerCommentId !== null && record.id === answerCommentId,
      parentId,
    })
  }
  // 顶层在前、回复紧随其后（渲染层按 parentId 归组）
  return comments.sort((a, b) => {
    if (a.parentId === null && b.parentId !== null) return -1
    if (a.parentId !== null && b.parentId === null) return 1
    return a.id - b.id
  })
}

/** 拉取讨论列表（带缓存与限流识别） */
export async function listDiscussions(
  categorySlug: DiscussionCategorySlug,
  force = false,
): Promise<DiscussionListResult> {
  const now = Date.now()
  if (!listMemoryCache) listMemoryCache = new Map()
  const memoryEntry = listMemoryCache.get(categorySlug)
  if (!force && memoryEntry && now - memoryEntry.fetchedAt < DISCUSSION_CACHE_TTL_MS) {
    return { items: memoryEntry.items, rateLimited: false, fromCache: false }
  }
  const diskEntry = readListCache(categorySlug)
  if (!force && diskEntry && now - diskEntry.fetchedAt < DISCUSSION_CACHE_TTL_MS) {
    listMemoryCache.set(categorySlug, diskEntry)
    return { items: diskEntry.items, rateLimited: false, fromCache: false }
  }

  const url = `https://api.github.com/repos/${COMMUNITY_REPO.owner}/${COMMUNITY_REPO.repo}/discussions?per_page=100`
  try {
    const fetchFn = getFetchFn(await getEffectiveProxyUrl())
    const response = await fetchFn(url, {
      signal: AbortSignal.timeout(20_000),
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    })
    if (response.status === 403 || response.status === 429) {
      return {
        items: diskEntry?.items ?? [],
        error: 'GitHub API 访问受限（匿名限流或网络受限），请稍后再试',
        rateLimited: true,
        fromCache: diskEntry !== null,
      }
    }
    if (!response.ok) {
      // 404：仓库未开启 Discussions
      if (response.status === 404) {
        return {
          items: diskEntry?.items ?? [],
          error: '社区讨论尚未在仓库开启（GitHub Discussions）',
          rateLimited: false,
          fromCache: diskEntry !== null,
        }
      }
      throw new Error(`GitHub Discussions API 返回 HTTP ${response.status}`)
    }
    const all: DiscussionSummary[] = parseDiscussionList((await response.json()) as unknown)
    const viewedState = readCommunityState()
    const items = all
      .filter((item) => item.categorySlug === categorySlug)
      .map((item) => ({
        ...item,
        // 新回复标记（只看“看过之后新增的”）
        hasNewReplies: computeHasNewReplies(item.commentCount, viewedState[item.number]),
        // 头像走代理转发（渲染层直连 GitHub 会绕过主进程代理）
        authorAvatarUrl: rewriteRemoteMediaUrl(item.authorAvatarUrl, registerRemoteMediaUrl),
      }))
    const entry = { fetchedAt: now, items }
    listMemoryCache.set(categorySlug, entry)
    writeListCache(categorySlug, entry)
    return { items, rateLimited: false, fromCache: false }
  } catch (err) {
    if (diskEntry) {
      listMemoryCache.set(categorySlug, diskEntry)
      return { items: diskEntry.items, error: '网络不可用，展示上次缓存', rateLimited: false, fromCache: true }
    }
    return {
      items: [],
      error: err instanceof Error ? err.message : '社区内容拉取失败',
      rateLimited: false,
      fromCache: false,
    }
  }
}

/** 拉取讨论详情正文与评论（带缓存；force 时绕过缓存重拉，用于详情页手动刷新） */
export async function getDiscussion(number: number, force = false): Promise<DiscussionDetail> {
  const now = Date.now()
  if (!force) {
    const cached = detailMemoryCache.get(number)
    if (cached && now - cached.fetchedAt < DISCUSSION_CACHE_TTL_MS) return cached.detail
  }

  const fetchFn = getFetchFn(await getEffectiveProxyUrl())
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
  const base = `https://api.github.com/repos/${COMMUNITY_REPO.owner}/${COMMUNITY_REPO.repo}/discussions/${number}`

  const [detailResponse, commentsResponse] = await Promise.all([
    fetchFn(base, { signal: AbortSignal.timeout(20_000), headers }),
    fetchFn(`${base}/comments?per_page=100`, { signal: AbortSignal.timeout(20_000), headers }),
  ])
  if (!detailResponse.ok) {
    throw new Error(`讨论详情拉取失败（HTTP ${detailResponse.status}）`)
  }

  const detailRaw = (await detailResponse.json()) as Record<string, unknown>
  const parsed = parseDiscussionDetail(detailRaw)
  const answerCommentId = extractAnswerCommentId(
    typeof detailRaw.answer_html_url === 'string' ? detailRaw.answer_html_url : undefined
  )

  // 评论拉取失败不阻断详情展示（降级为空评论 + 提示文案由渲染层处理）
  let comments: DiscussionComment[] = []
  if (commentsResponse.ok) {
    comments = parseDiscussionComments((await commentsResponse.json()) as unknown, answerCommentId).map(
      (comment) => ({
        ...comment,
        bodyMarkdown: rewriteMarkdownMedia(comment.bodyMarkdown, registerRemoteMediaUrl),
        authorAvatarUrl: rewriteRemoteMediaUrl(comment.authorAvatarUrl, registerRemoteMediaUrl),
      })
    )
  }

  // 正文图片与头像走代理转发；「上传未完成」占位符一并剥离
  const detail: DiscussionDetail = {
    ...parsed,
    bodyMarkdown: rewriteMarkdownMedia(parsed.bodyMarkdown, registerRemoteMediaUrl),
    authorAvatarUrl: rewriteRemoteMediaUrl(parsed.authorAvatarUrl, registerRemoteMediaUrl),
    comments,
  }
  detailMemoryCache.set(number, { fetchedAt: now, detail })
  return detail
}

/** 社区未读计数内存缓存（全板块一次拉取） */
let allUnreadMemoryCache: { fetchedAt: number; count: number } | null = null

/** 拉取社区未读讨论数（有新增回复的讨论个数；失败时返回最近一次结果或 0） */
export async function getCommunityUnreadCount(): Promise<number> {
  const now = Date.now()
  if (allUnreadMemoryCache && now - allUnreadMemoryCache.fetchedAt < DISCUSSION_CACHE_TTL_MS) {
    return allUnreadMemoryCache.count
  }
  try {
    const fetchFn = getFetchFn(await getEffectiveProxyUrl())
    const url = `https://api.github.com/repos/${COMMUNITY_REPO.owner}/${COMMUNITY_REPO.repo}/discussions?per_page=100`
    const response = await fetchFn(url, {
      signal: AbortSignal.timeout(20_000),
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    })
    if (!response.ok) throw new Error(`GitHub Discussions API 返回 HTTP ${response.status}`)
    const all = parseDiscussionList((await response.json()) as unknown)
    const viewedState = readCommunityState()
    const count = all.filter((item) => computeHasNewReplies(item.commentCount, viewedState[item.number])).length
    allUnreadMemoryCache = { fetchedAt: now, count }
    return count
  } catch {
    return allUnreadMemoryCache?.count ?? 0
  }
}

/** 构造浏览器打开的讨论 URL */
export function buildDiscussionUrl(number: number): string {
  return `https://github.com/${COMMUNITY_REPO.owner}/${COMMUNITY_REPO.repo}/discussions/${number}`
}

/** 构造新建讨论 URL（带板块预选） */
export function buildNewDiscussionUrl(categorySlug: DiscussionCategorySlug): string {
  return `https://github.com/${COMMUNITY_REPO.owner}/${COMMUNITY_REPO.repo}/discussions/new?category=${encodeURIComponent(categorySlug)}`
}

/** 清除缓存（测试/调试用；磁盘缓存文件不存在时静默） */
export function clearDiscussionCache(): void {
  listMemoryCache = null
  detailMemoryCache.clear()
  if (existsSync(getDiscoverDiscussionsCachePath())) {
    try {
      writeFileSync(getDiscoverDiscussionsCachePath(), '{}')
    } catch {
      // 忽略写失败
    }
  }
}
