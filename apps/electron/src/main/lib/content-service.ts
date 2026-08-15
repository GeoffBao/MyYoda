/**
 * 「发现」官方内容服务
 *
 * - 清单：raw.githubusercontent.com 拉取，失败换 jsDelivr 兜底；本地缓存 manifest-cache.json
 * - 已读状态：content-state.json（itemId -> 已看版本）
 * - 视频：下载到 video-cache/{id}-{version}.mp4，先写 .part 临时文件，校验 size 后改名
 * - article：按 contentUrl 拉取 markdown，失败换 jsDelivr 镜像
 * - 全部 HTTP 走代理感知的 getFetchFn（国内网络环境刚需）
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import type { WebContents } from 'electron'
import {
  DISCOVER_IPC_CHANNELS,
  type DiscoverContentItem,
  type DiscoverContentState,
  type DiscoverFeedResult,
  type DiscoverManifest,
  type VideoDownloadState,
} from '@myyoda/shared'
import {
  getDiscoverContentStatePath,
  getDiscoverManifestCachePath,
  getDiscoverVideoCacheDir,
} from './config-paths'
import { computeUpdateFlags, validateManifest } from './content-logic'
import { rewriteMarkdownMedia } from './media-rewrite'
import { registerRemoteMediaUrl } from './discover-remote-media'
import { getFetchFn } from './proxy-fetch'
import { getEffectiveProxyUrl } from './proxy-settings-service'

/** 内容源配置（维护者公开仓库） */
export const CONTENT_SOURCE = { owner: 'GeoffBao', repo: 'myyoda-content', branch: 'main' }

const RAW_BASE = `https://raw.githubusercontent.com/${CONTENT_SOURCE.owner}/${CONTENT_SOURCE.repo}/${CONTENT_SOURCE.branch}`
const JSDELIVR_BASE = `https://cdn.jsdelivr.net/gh/${CONTENT_SOURCE.owner}/${CONTENT_SOURCE.repo}@${CONTENT_SOURCE.branch}`
const MANIFEST_PATH = 'content.json'

/** 清单 URL 列表：raw 优先，jsDelivr 兜底 */
const MANIFEST_URLS = [`${RAW_BASE}/${MANIFEST_PATH}`, `${JSDELIVR_BASE}/${MANIFEST_PATH}`]

/** 进度推送节流间隔 */
const PROGRESS_THROTTLE_MS = 500

/** 清单内存缓存（进程内只拉一次，避免反复请求） */
let manifestMemoryCache: ManifestCacheFile | null = null

/** 视频下载进行中的 Promise 去重：itemId -> Promise */
const inflightDownloads = new Map<string, Promise<{ filePath: string }>>()

/** 获取代理感知的 fetch（与 feedback-service 同模式） */
async function getProxyFetch(): Promise<typeof globalThis.fetch> {
  return getFetchFn(await getEffectiveProxyUrl())
}

/** 按序尝试多个 URL，任一成功即返回；全部失败抛最后一个错误 */
async function fetchWithFallbacks(urls: string[], fetchFn: typeof globalThis.fetch): Promise<Response> {
  let lastError: unknown = new Error('无可用地址')
  for (const url of urls) {
    try {
      const response = await fetchFn(url, { signal: AbortSignal.timeout(30_000) })
      if (response.ok) return response
      lastError = new Error(`HTTP ${response.status}: ${url}`)
    } catch (err) {
      lastError = err
    }
  }
  throw lastError
}

/** 清单磁盘缓存文件结构（wrapper，含写入时间供离线横幅展示） */
interface ManifestCacheFile {
  fetchedAt: number
  manifest: DiscoverManifest
}

/** 读取清单缓存文件（兼容旧格式=裸 manifest）；无效返回 null */
function readManifestCacheFile(): ManifestCacheFile | null {
  try {
    const raw = JSON.parse(readFileSync(getDiscoverManifestCachePath(), 'utf-8')) as unknown
    if (typeof raw !== 'object' || raw === null) return null
    const candidate = raw as Record<string, unknown>
    // 新格式：{ fetchedAt, manifest }
    if (candidate.manifest !== undefined) {
      const result = validateManifest(candidate.manifest)
      if (!result.ok) return null
      return { fetchedAt: typeof candidate.fetchedAt === 'number' ? candidate.fetchedAt : Date.now(), manifest: result.manifest }
    }
    // 旧格式：裸 manifest（无 fetchedAt）
    const result = validateManifest(raw)
    if (!result.ok) return null
    return { fetchedAt: Date.now(), manifest: result.manifest }
  } catch {
    return null
  }
}

/** 拉取清单：内存缓存（非强制）→ 网络双源 → 磁盘缓存兜底；force 时跳过内存缓存 */
async function fetchManifestWithCache(force = false): Promise<ManifestCacheFile> {
  if (!force && manifestMemoryCache) return manifestMemoryCache
  const diskCache = readManifestCacheFile()
  try {
    const response = await fetchWithFallbacks(MANIFEST_URLS, await getProxyFetch())
    const raw: unknown = await response.json()
    const result = validateManifest(raw)
    if (!result.ok) throw new Error(result.error)
    const cacheEntry: ManifestCacheFile = { fetchedAt: Date.now(), manifest: result.manifest }
    manifestMemoryCache = cacheEntry
    mkdirSync(join(getDiscoverManifestCachePath(), '..'), { recursive: true })
    writeFileSync(getDiscoverManifestCachePath(), JSON.stringify(cacheEntry, null, 2))
    return cacheEntry
  } catch (err) {
    if (diskCache) return diskCache
    throw err
  }
}

/** 读取已读状态文件（不存在返回空对象，损坏返回空对象） */
export function readContentState(): DiscoverContentState {
  try {
    const raw = JSON.parse(readFileSync(getDiscoverContentStatePath(), 'utf-8')) as unknown
    if (typeof raw === 'object' && raw !== null) return raw as DiscoverContentState
    return {}
  } catch {
    return {}
  }
}

/** 写已读状态文件 */
function writeContentState(state: DiscoverContentState): void {
  mkdirSync(join(getDiscoverContentStatePath(), '..'), { recursive: true })
  writeFileSync(getDiscoverContentStatePath(), JSON.stringify(state, null, 2))
}

/** 拉取官方精选流（清单 + 更新标记 + 未读红点）；force 时绕过内存缓存重新拉网络 */
export async function fetchDiscoverFeed(force = false): Promise<DiscoverFeedResult> {
  const cacheEntry = await fetchManifestWithCache(force)
  const fromCache = cacheEntry !== manifestMemoryCache || !manifestMemoryCache
  const manifest = cacheEntry.manifest
  const state = readContentState()
  const items = computeUpdateFlags(manifest.items, state)
  return {
    items,
    hasUnreadUpdates: items.some((item) => item.hasUpdate),
    source: CONTENT_SOURCE,
    fromCache,
    cachedAt: fromCache ? cacheEntry.fetchedAt : undefined,
  }
}

/** 记录条目已读 */
export function markContentSeen(itemId: string, version: string): void {
  const state = readContentState()
  state[itemId] = version
  writeContentState(state)
}

/** 将 raw.githubusercontent 地址换为 jsDelivr 镜像 */
function toJsDelivrUrl(url: string): string | null {
  const prefix = `https://raw.githubusercontent.com/${CONTENT_SOURCE.owner}/${CONTENT_SOURCE.repo}/${CONTENT_SOURCE.branch}/`
  if (!url.startsWith(prefix)) return null
  return `${JSDELIVR_BASE}/${url.slice(prefix.length)}`
}

/** 拉取 article 的 markdown 正文（正文图片重写为代理转发 URL） */
export async function fetchArticleContent(contentUrl: string): Promise<string> {
  const mirrors = [contentUrl]
  const jsdelivr = toJsDelivrUrl(contentUrl)
  if (jsdelivr) mirrors.push(jsdelivr)
  const response = await fetchWithFallbacks(mirrors, await getProxyFetch())
  const markdown = await response.text()
  return rewriteMarkdownMedia(markdown, registerRemoteMediaUrl)
}

/** 视频缓存文件路径 */
function videoCachePath(itemId: string, version: string): string {
  return join(getDiscoverVideoCacheDir(), `${itemId}-${version}.mp4`)
}

/** 查询视频本地缓存状态 */
export function getVideoStatus(itemId: string, version: string, expectedSize?: number): VideoDownloadState {
  const targetPath = videoCachePath(itemId, version)
  if (existsSync(targetPath)) {
    if (expectedSize !== undefined) {
      const actual = statSync(targetPath).size
      if (actual !== expectedSize) {
        return { itemId, status: 'error', progress: 0, error: '缓存文件大小不匹配，请重新下载' }
      }
    }
    return { itemId, status: 'done', progress: 1, filePath: targetPath }
  }
  const inflight = inflightDownloads.has(itemId)
  return inflight
    ? { itemId, status: 'downloading', progress: 0.5 }
    : { itemId, status: 'not-downloaded', progress: 0 }
}

/** 推送进度事件（节流 + 销毁保护） */
function sendProgress(webContents: WebContents, itemId: string, progress: number, lastSentAt: { t: number }): void {
  const now = Date.now()
  if (now - lastSentAt.t < PROGRESS_THROTTLE_MS && progress < 1) return
  lastSentAt.t = now
  if (webContents.isDestroyed()) return
  webContents.send(DISCOVER_IPC_CHANNELS.VIDEO_DOWNLOAD_PROGRESS, { itemId, progress } satisfies {
    itemId: string
    progress: number
  })
}

/** 校验路径位于视频缓存目录内（GET_VIDEO_URL 防任意路径注册） */
export function isPathInVideoCacheDir(filePath: string): boolean {
  const dir = getDiscoverVideoCacheDir()
  return filePath === dir || filePath.startsWith(dir.endsWith(sep) ? dir : dir + sep)
}

/** 下载单个 URL 到目标路径（返回是否大小校验通过） */
async function downloadFromUrl(
  url: string,
  targetPath: string,
  itemId: string,
  expectedSize: number | undefined,
  webContents: WebContents,
  lastSentAt: { t: number },
): Promise<boolean> {
  const response = await (await getProxyFetch())(url, { signal: AbortSignal.timeout(600_000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  if (!response.body) throw new Error('响应无内容流')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  const total = expectedSize ?? Number(response.headers.get('content-length') ?? 0)
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      received += value.length
      if (total > 0) sendProgress(webContents, itemId, received / total, lastSentAt)
    }
  }
  writeFileSync(targetPath, Buffer.concat(chunks))
  if (expectedSize !== undefined && received !== expectedSize) return false
  return true
}

/** 下载视频：进度推送、镜像重试、大小校验；完成返回缓存绝对路径 */
export async function downloadVideo(
  item: DiscoverContentItem,
  webContents: WebContents,
): Promise<{ filePath: string }> {
  const existing = inflightDownloads.get(item.id)
  if (existing) return existing

  const promise = (async (): Promise<{ filePath: string }> => {
    const video = item.video
    if (!video) throw new Error('视频条目缺少 video 字段')
    const urls = [video.url, ...(video.mirrors ?? [])]
    const cacheDir = getDiscoverVideoCacheDir()
    mkdirSync(cacheDir, { recursive: true })
    const targetPath = videoCachePath(item.id, item.version)
    const partPath = `${targetPath}.part`
    const lastSentAt = { t: 0 }
    let lastError: unknown = new Error('下载失败')

    for (const url of urls) {
      try {
        rmSync(partPath, { force: true })
        const valid = await downloadFromUrl(url, partPath, item.id, video.size, webContents, lastSentAt)
        if (!valid) throw new Error(`下载大小校验失败：期望 ${video.size} 字节`)
        renameSync(partPath, targetPath)
        try {
          pruneOldVersions(item.id, item.version)
        } catch {
          // 清理失败不影响本次下载结果（如 Windows 下旧版本文件仍被播放占用）
        }
        if (!webContents.isDestroyed()) {
          webContents.send(DISCOVER_IPC_CHANNELS.VIDEO_DOWNLOAD_DONE, { itemId: item.id, filePath: targetPath } satisfies {
            itemId: string
            filePath: string
          })
        }
        return { filePath: targetPath }
      } catch (err) {
        lastError = err
        sendProgress(webContents, item.id, 0, { t: 0 })
      }
    }
    throw lastError
  })().finally(() => {
    inflightDownloads.delete(item.id)
  })

  inflightDownloads.set(item.id, promise)
  return promise
}

/** 删除某视频的本地缓存（含下载中断残留的 .part），返回释放的字节数 */
export function deleteVideoCache(itemId: string, version: string): number {
  const targetPath = videoCachePath(itemId, version)
  let freed = 0
  if (existsSync(targetPath)) {
    freed += statSync(targetPath).size
    rmSync(targetPath, { force: true })
  }
  const partPath = `${targetPath}.part`
  if (existsSync(partPath)) {
    try {
      freed += statSync(partPath).size
    } catch {
      // 统计失败不影响删除
    }
    rmSync(partPath, { force: true })
  }
  return freed
}

/** 清理某条目的旧版本缓存（保留最新） */
function pruneOldVersions(itemId: string, keepVersion: string): void {
  const dir = getDiscoverVideoCacheDir()
  if (!existsSync(dir)) return
  const prefix = `${itemId}-`
  const keep = `${prefix}${keepVersion}.mp4`
  for (const name of readdirSync(dir)) {
    if (name.startsWith(prefix) && name.endsWith('.mp4') && name !== keep) {
      rmSync(join(dir, name), { force: true })
    }
  }
}
