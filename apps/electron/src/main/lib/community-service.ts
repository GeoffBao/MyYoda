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
  type DiscussionDetail,
  type DiscussionListResult,
  type DiscussionSummary,
} from '@myyoda/shared'
import { getDiscoverDiscussionsCachePath } from './config-paths'
import { getFetchFn } from './proxy-fetch'
import { getEffectiveProxyUrl } from './proxy-settings-service'

export const DISCUSSION_CACHE_TTL_MS = 5 * 60 * 1000

/** 社区承载仓库（MyYoda 主仓库） */
export const COMMUNITY_REPO = { owner: 'GeoffBao', repo: 'MyYoda' }

const KNOWN_CATEGORY_SLUGS = new Set<string>(['q-a', 'show-and-tell', 'announcements'])

interface DiscussionCacheEntry {
  fetchedAt: number
  items: DiscussionSummary[]
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
  return { ...summary, bodyMarkdown: typeof record.body === 'string' ? record.body : '' }
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
    const items = all.filter((item) => item.categorySlug === categorySlug)
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

/** 拉取讨论详情正文（带缓存） */
export async function getDiscussion(number: number): Promise<DiscussionDetail> {
  const now = Date.now()
  const cached = detailMemoryCache.get(number)
  if (cached && now - cached.fetchedAt < DISCUSSION_CACHE_TTL_MS) return cached.detail

  const url = `https://api.github.com/repos/${COMMUNITY_REPO.owner}/${COMMUNITY_REPO.repo}/discussions/${number}`
  const fetchFn = getFetchFn(await getEffectiveProxyUrl())
  const response = await fetchFn(url, {
    signal: AbortSignal.timeout(20_000),
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  })
  if (!response.ok) {
    throw new Error(`讨论详情拉取失败（HTTP ${response.status}）`)
  }
  const detail = parseDiscussionDetail((await response.json()) as unknown)
  detailMemoryCache.set(number, { fetchedAt: now, detail })
  return detail
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
