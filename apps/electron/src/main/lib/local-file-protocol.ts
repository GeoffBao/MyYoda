/**
 * Token-gated local file protocol support for inline previews.
 *
 * The renderer never receives raw myyoda-file:// absolute paths. Main process
 * code registers an already-authorized file or directory and gets back an
 * opaque URL that the protocol handler can resolve.
 */

import { randomUUID } from 'node:crypto'
import { createReadStream, existsSync, realpathSync, statSync } from 'node:fs'
import { extname, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { net } from 'electron'

type RegisteredEntry = {
  root: string
  isDirectory: boolean
  /** Optional least-privilege allowlist for relative paths under a directory root. */
  allowedRelativePaths?: ReadonlySet<string>
  createdAt: number
}

const registeredEntries = new Map<string, RegisteredEntry>()
const ENTRY_TTL_MS = 60 * 60 * 1000
const MAX_ENTRIES = 500

function pruneEntries(): void {
  const now = Date.now()
  for (const [token, entry] of registeredEntries) {
    if (now - entry.createdAt > ENTRY_TTL_MS) {
      registeredEntries.delete(token)
    }
  }

  while (registeredEntries.size > MAX_ENTRIES) {
    const oldest = registeredEntries.keys().next().value
    if (!oldest) break
    registeredEntries.delete(oldest)
  }
}

function realpathExisting(path: string): string {
  const resolved = realpathSync(resolve(path))
  if (!existsSync(resolved)) {
    throw new Error(`文件不存在: ${path}`)
  }
  return resolved
}

function isInsideDirectory(target: string, root: string): boolean {
  return target === root || target.startsWith(root.endsWith(sep) ? root : root + sep)
}

// ─── Range 支持（视频 seek / PDF 分页加载） ───

/** 常见扩展名 → MIME，Range 分支无法依赖 net.fetch 自动推断时使用 */
const MIME_BY_EXT: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.ogv': 'video/ogg',
  '.ogg': 'video/ogg',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.pdf': 'application/pdf',
  '.xml': 'application/xml',
  '.wasm': 'application/wasm',
}

const RANGE_RE = /^bytes=(\d*)-(\d*)$/

/**
 * 处理 HTTP Range 请求：解析 bytes= 语法，用文件流返回 206 分段响应。
 * 无法解析 / 请求超出文件范围时返回 null（调用方回落到全量响应）。
 */
function createRangeResponse(target: string, rangeHeader: string, size: number): Response | null {
  const match = RANGE_RE.exec(rangeHeader.trim())
  if (!match) return null

  let start: number
  let end: number
  if (match[1] === '' && match[2] !== '') {
    // 后缀形式 bytes=-N：取最后 N 字节
    const suffix = Number(match[2])
    if (!Number.isFinite(suffix) || suffix <= 0) return null
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = match[1] === '' ? 0 : Number(match[1])
    const hasEnd = match[2] !== ''
    end = hasEnd ? Number(match[2]) : size - 1
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < 0) return null
    if (hasEnd && end < start) return null
  }

  // 起始位置超出文件范围 → 416（suffix 分支 size=0 时也会命中）
  if (start >= size) {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${size}` },
    })
  }

  end = Math.min(end, size - 1)
  const stream = createReadStream(target, { start, end })
  return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
    status: 206,
    headers: {
      'Content-Type': MIME_BY_EXT[extname(target).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
    },
  })
}

function normalizeRelativePath(path: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(path).replaceAll('\\', '/')
  } catch {
    return null
  }
  if (!decoded || decoded.startsWith('/')) return null
  const normalized = decoded.replace(/^\.\//, '')
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) return null
  return normalized
}

function registerEntry(path: string, isDirectory: boolean, allowedRelativePaths?: readonly string[]): string {
  pruneEntries()
  const root = realpathExisting(path)
  const st = statSync(root)
  if (isDirectory && !st.isDirectory()) {
    throw new Error(`不是目录: ${path}`)
  }
  if (!isDirectory && !st.isFile()) {
    throw new Error(`不是文件: ${path}`)
  }

  const token = randomUUID()
  registeredEntries.set(token, {
    root,
    isDirectory,
    allowedRelativePaths: allowedRelativePaths
      ? new Set(allowedRelativePaths.map(normalizeRelativePath).filter((value): value is string => value !== null))
      : undefined,
    createdAt: Date.now(),
  })
  return `myyoda-file://${token}`
}

export function registerMyYodaFilePath(path: string): string {
  return registerEntry(path, false)
}

export function registerMyYodaDirectoryPath(path: string, allowedRelativePaths?: readonly string[]): string {
  return registerEntry(path, true, allowedRelativePaths)
}

export function handleMyYodaFileRequest(request: Request): Promise<Response> | Response {
  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return new Response('Bad Request', { status: 400 })
  }

  const token = url.hostname
  const entry = registeredEntries.get(token)
  if (!entry) {
    return new Response('Not Found', { status: 404 })
  }

  let target = entry.root
  if (entry.isDirectory) {
    const relativePath = url.pathname.replace(/^\/+/, '')
    const normalizedRelativePath = normalizeRelativePath(relativePath)
    if (!normalizedRelativePath) return new Response('Forbidden', { status: 403 })
    if (entry.allowedRelativePaths && !entry.allowedRelativePaths.has(normalizedRelativePath)) {
      return new Response('Forbidden', { status: 403 })
    }
    try {
      target = realpathSync(resolve(entry.root, normalizedRelativePath))
    } catch {
      return new Response('Not Found', { status: 404 })
    }
    if (!isInsideDirectory(target, entry.root)) {
      return new Response('Forbidden', { status: 403 })
    }
  } else if (url.pathname && url.pathname !== '/') {
    return new Response('Not Found', { status: 404 })
  }

  // 有 Range 请求时走分段响应（视频 seek / PDF 分页）；
  // 无 Range 保持 net.fetch 全量，MIME 由 Chromium 自动推断，对现有预览零影响。
  const rangeHeader = request.headers.get('range')
  if (rangeHeader) {
    try {
      const st = statSync(target)
      if (st.isFile()) {
        const rangeResponse = createRangeResponse(target, rangeHeader, st.size)
        if (rangeResponse) return rangeResponse
      }
    } catch {
      // stat 失败（文件不存在等）回落到 net.fetch，由它决定 404
    }
  }

  return net.fetch(pathToFileURL(target).toString())
}
