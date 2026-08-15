/**
 * myyoda-remote:// 远程媒体转发协议（图片/头像）
 *
 * 讨论/教程里的 GitHub 图片（user-images / private-user-images / avatars 等）在渲染层
 * 由 <img> 直连加载，会绕过主进程的代理配置（本项目代理是 per-request 的 getFetchFn，
 * 非 Chromium 级），国内网络下加载失败。因此由主进程持有 token → 远程 URL 映射，
 * 经代理感知 fetch 拉取并流式转发。
 *
 * - 仅允许 https + 白名单域名（GitHub 媒体域 + 内容仓库 CDN）
 * - 图片无需 Range，透传 Content-Type / Content-Length 即可
 */
import { randomUUID } from 'node:crypto'
import { getFetchFn } from './proxy-fetch'
import { getEffectiveProxyUrl } from './proxy-settings-service'

interface RemoteMediaEntry {
  url: string
  createdAt: number
}

const mediaRegistry = new Map<string, RemoteMediaEntry>()
/** 图片 Token TTL 放宽到 24h（详情页长时间停留不失效；Chromium 自身有 HTTP 缓存） */
const ENTRY_TTL_MS = 24 * 60 * 60 * 1000
const MAX_ENTRIES = 500

/** 允许代理转发的域名白名单（GitHub 媒体域 + 内容仓库 CDN） */
const ALLOWED_HOSTS = new Set([
  'user-images.githubusercontent.com',
  'private-user-images.githubusercontent.com',
  'avatars.githubusercontent.com',
  'github.com',
  'raw.githubusercontent.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'cdn.jsdelivr.net',
])

function pruneRegistry(): void {
  const now = Date.now()
  for (const [token, entry] of mediaRegistry) {
    if (now - entry.createdAt > ENTRY_TTL_MS) mediaRegistry.delete(token)
  }
  while (mediaRegistry.size > MAX_ENTRIES) {
    const oldest = mediaRegistry.keys().next().value
    if (!oldest) break
    mediaRegistry.delete(oldest)
  }
}

/** 校验并注册远程媒体 URL，返回 opaque 的 myyoda-remote:// URL；不允许则返回 null */
export function registerRemoteMediaUrl(remoteUrl: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(remoteUrl)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null
  if (!ALLOWED_HOSTS.has(parsed.hostname)) return null
  pruneRegistry()
  const token = randomUUID().replaceAll('-', '')
  mediaRegistry.set(token, { url: remoteUrl, createdAt: Date.now() })
  return `myyoda-remote://${token}`
}

/** myyoda-remote:// 协议处理器：代理感知拉取 + 响应头透传 */
export async function handleRemoteMediaRequest(request: Request): Promise<Response> {
  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return new Response('Bad Request', { status: 400 })
  }

  const entry = mediaRegistry.get(url.hostname)
  if (!entry) {
    return new Response('Not Found', { status: 404 })
  }
  if (url.pathname && url.pathname !== '/') {
    return new Response('Not Found', { status: 404 })
  }

  let upstream: Response
  try {
    const fetchFn = getFetchFn(await getEffectiveProxyUrl())
    upstream = await fetchFn(entry.url, { signal: AbortSignal.timeout(60_000) })
  } catch {
    return new Response('远程图片源不可达', { status: 502 })
  }
  if (!upstream.ok) {
    return new Response(null, { status: upstream.status })
  }

  const headers = new Headers()
  const contentType = upstream.headers.get('content-type')
  if (contentType) headers.set('Content-Type', contentType)
  const contentLength = upstream.headers.get('content-length')
  if (contentLength) headers.set('Content-Length', contentLength)

  return new Response(upstream.body, { status: upstream.status, headers })
}
