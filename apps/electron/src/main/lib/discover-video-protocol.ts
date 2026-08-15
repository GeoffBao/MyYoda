/**
 * discover-video:// 远程视频流式转发协议
 *
 * 渲染层的 <video> 直连远程 URL 会绕过主进程的代理配置（本项目代理是 per-request 的
 * getFetchFn，非 Chromium 级），国内网络下无法播放。因此由主进程持有 token → 远程 URL
 * 映射，经代理感知 fetch 拉取上游并流式转发，Range 头透传以支持视频 seek。
 *
 * - 只允许内容仓库（GeoffBao/myyoda-content）的 Release / raw / jsDelivr 地址
 * - Content-Type 按扩展名强制修正（GitHub 资产返回 octet-stream，<video> 需要 video/*）
 */
import { randomUUID } from 'node:crypto'
import { extname } from 'node:path'
import { getFetchFn } from './proxy-fetch'
import { getEffectiveProxyUrl } from './proxy-settings-service'

/** token → 远程流条目（含注册时间，用于 TTL 清理） */
interface StreamEntry {
  url: string
  createdAt: number
}

const streamRegistry = new Map<string, StreamEntry>()
const ENTRY_TTL_MS = 60 * 60 * 1000
const MAX_ENTRIES = 200

/** 允许流式转发的远程地址前缀（内容仓库白名单） */
const ALLOWED_URL_PREFIXES = [
  'https://github.com/GeoffBao/myyoda-content/releases/download/',
  'https://raw.githubusercontent.com/GeoffBao/myyoda-content/',
  'https://cdn.jsdelivr.net/gh/GeoffBao/myyoda-content@',
]

/** 常见视频扩展名 → MIME（上游 Content-Type 不可靠时强制修正） */
const MIME_BY_EXT: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.ogv': 'video/ogg',
}

function pruneRegistry(): void {
  const now = Date.now()
  for (const [token, entry] of streamRegistry) {
    if (now - entry.createdAt > ENTRY_TTL_MS) streamRegistry.delete(token)
  }
  while (streamRegistry.size > MAX_ENTRIES) {
    const oldest = streamRegistry.keys().next().value
    if (!oldest) break
    streamRegistry.delete(oldest)
  }
}

/** 注册远程视频流，返回 opaque 的 discover-video:// URL；地址不在白名单内抛错 */
export function registerDiscoverVideoStream(remoteUrl: string): string {
  if (!ALLOWED_URL_PREFIXES.some((prefix) => remoteUrl.startsWith(prefix))) {
    throw new Error('视频地址不在内容仓库白名单内')
  }
  pruneRegistry()
  const token = randomUUID().replaceAll('-', '')
  streamRegistry.set(token, { url: remoteUrl, createdAt: Date.now() })
  return `discover-video://${token}`
}

/** 需要透传给上游的请求头（Range / If-Range 支持 seek） */
const FORWARD_HEADERS = ['range', 'if-range']

/** discover-video:// 协议处理器：代理感知拉取 + Range 透传 + MIME 修正 */
export async function handleDiscoverVideoRequest(request: Request): Promise<Response> {
  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return new Response('Bad Request', { status: 400 })
  }

  const entry = streamRegistry.get(url.hostname)
  if (!entry) {
    return new Response('Not Found', { status: 404 })
  }

  // 只支持整资源路径（无子路径）
  if (url.pathname && url.pathname !== '/') {
    return new Response('Not Found', { status: 404 })
  }

  const upstreamHeaders = new Headers()
  for (const name of FORWARD_HEADERS) {
    const value = request.headers.get(name)
    if (value) upstreamHeaders.set(name, value)
  }

  let upstream: Response
  try {
    const fetchFn = getFetchFn(await getEffectiveProxyUrl())
    upstream = await fetchFn(entry.url, { headers: upstreamHeaders, signal: AbortSignal.timeout(600_000) })
  } catch {
    return new Response('上游视频源不可达', { status: 502 })
  }
  if (!upstream.ok) {
    return new Response(null, { status: upstream.status })
  }

  const headers = new Headers()
  // MIME 按扩展名强制修正：GitHub Release 资产返回 application/octet-stream
  const ext = extname(new URL(entry.url).pathname).toLowerCase()
  headers.set('Content-Type', MIME_BY_EXT[ext] ?? 'video/mp4')
  headers.set('Accept-Ranges', 'bytes')
  const contentRange = upstream.headers.get('content-range')
  if (contentRange) headers.set('Content-Range', contentRange)
  const contentLength = upstream.headers.get('content-length')
  if (contentLength) headers.set('Content-Length', contentLength)

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  })
}
