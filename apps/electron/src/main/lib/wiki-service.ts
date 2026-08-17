/**
 * 「帮助」Wiki 服务：GitHub Wiki（git 仓库）浅克隆 + 本地缓存
 *
 * - 源：https://github.com/GeoffBao/MyYoda.wiki.git（wiki 首次建页后仓库才存在）
 * - 首次打开帮助 tab 浅克隆到 ~/.myyoda/discover/wiki-cache/；之后 git fetch --depth 1 + reset --hard
 * - 页面树：_Sidebar.md 解析（缺失时按文件列表构建）；正文本地 .md 直读，图片经远程媒体代理
 * - git 代理：clone/fetch 时注入 -c http.proxy=<有效代理>
 * - 更新推送：后台刷新发现 commit 变化时经 sender 推 WIKI_UPDATED
 *
 * 纯逻辑（解析/重写）在 wiki-pages.ts，本文件只做 IO 编排。
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { WebContents } from 'electron'
import { DISCOVER_IPC_CHANNELS, type WikiPageContent, type WikiPagesResult, type WikiPageTree } from '@myyoda/shared'
import { getDiscoverWikiCacheDir } from './config-paths'
import { getEffectiveProxyUrl } from './proxy-settings-service'
import { registerRemoteMediaUrl } from './discover-remote-media'
import {
  buildPageTreeFromFileNames,
  isWikiPageNameSafe,
  parseSidebar,
  rewriteWikiMedia,
} from './wiki-pages'

const execFileAsync = promisify(execFile)

/** Wiki 承载仓库（与社区 Discussions 同仓库） */
export const WIKI_REPO = { owner: 'GeoffBao', repo: 'MyYoda' }

/** 默认远端 URL（测试可经参数注入本地 fixture） */
export function getDefaultWikiRemoteUrl(): string {
  return `https://github.com/${WIKI_REPO.owner}/${WIKI_REPO.repo}.wiki.git`
}

/** 执行 git（注入代理配置）；返回 stdout（trim 后） */
async function runGit(args: string[], cwd?: string): Promise<string> {
  const proxy = await getEffectiveProxyUrl()
  const gitArgs = proxy ? ['-c', `http.proxy=${proxy}`, ...args] : [...args]
  const { stdout } = await execFileAsync('git', gitArgs, cwd ? { cwd } : {})
  return stdout.trim()
}

/** 确保本地缓存存在并更新到远端最新；返回当前 commit hash */
export async function refreshWikiCache(
  cacheDir: string = getDiscoverWikiCacheDir(),
  remoteUrl: string = getDefaultWikiRemoteUrl(),
): Promise<string> {
  if (existsSync(join(cacheDir, '.git'))) {
    await runGit(['fetch', '--depth', '1', 'origin'], cacheDir)
    await runGit(['reset', '--hard', 'FETCH_HEAD'], cacheDir)
  } else {
    mkdirSync(join(cacheDir, '..'), { recursive: true })
    await runGit(['clone', '--depth', '1', remoteUrl, cacheDir])
  }
  return runGit(['rev-parse', 'HEAD'], cacheDir)
}

interface WikiMeta {
  lastFetchedAt?: number
  commitHash?: string
  error?: string
}

/** meta 文件放在缓存目录之外（避免污染 git 仓库） */
function wikiMetaPathFor(cacheDir: string): string {
  return join(cacheDir, '..', 'wiki-meta.json')
}

function readWikiMeta(cacheDir: string): WikiMeta | null {
  try {
    const raw = JSON.parse(readFileSync(wikiMetaPathFor(cacheDir), 'utf-8')) as unknown
    if (typeof raw === 'object' && raw !== null) return raw as WikiMeta
    return null
  } catch {
    return null
  }
}

function writeWikiMeta(cacheDir: string, meta: WikiMeta): void {
  const path = wikiMetaPathFor(cacheDir)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify(meta, null, 2), 'utf-8')
}

/** 从缓存目录构建页面树（_Sidebar 优先，缺失按文件列表） */
function buildWikiPageTreeFromCacheDir(cacheDir: string): WikiPageTree {
  const sidebarPath = join(cacheDir, '_Sidebar.md')
  if (existsSync(sidebarPath)) {
    const tree = parseSidebar(readFileSync(sidebarPath, 'utf-8'))
    if (tree.nodes.length > 0) return tree
  }
  return buildPageTreeFromFileNames(readdirSync(cacheDir))
}

/** 从当前缓存 + meta 组装结果（无 IO 副作用） */
function readWikiPages(cacheDir: string): WikiPagesResult {
  const meta = readWikiMeta(cacheDir)
  const hasCache = existsSync(join(cacheDir, '.git'))
  return {
    tree: hasCache ? buildWikiPageTreeFromCacheDir(cacheDir) : { nodes: [], fromSidebar: false },
    fetchedAt: meta?.lastFetchedAt ?? 0,
    commitHash: meta?.commitHash ?? '',
    fromCache: Boolean(meta?.error),
    error: meta?.error,
  }
}

/** 刷新并写 meta；返回是否成功 */
async function doRefresh(cacheDir: string): Promise<boolean> {
  try {
    const hash = await refreshWikiCache(cacheDir)
    writeWikiMeta(cacheDir, { lastFetchedAt: Date.now(), commitHash: hash })
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    writeWikiMeta(cacheDir, { ...readWikiMeta(cacheDir), error: `文档库拉取失败：${message}` })
    return false
  }
}

function safeSend(sender: WebContents | null, channel: string, payload: unknown): void {
  try {
    if (sender && !sender.isDestroyed()) sender.send(channel, payload)
  } catch {
    // 窗口已销毁等场景忽略
  }
}

/**
 * 拉取 Wiki 页面树。
 * - 无缓存或 force：同步刷新（首次打开帮助 tab 会阻塞到克隆完成，wiki 体量小可接受）
 * - 有缓存且非 force：立即返回缓存，后台刷新；commit 变化时推送 WIKI_UPDATED
 */
export async function getWikiPages(
  sender: WebContents | null,
  force: boolean,
  cacheDir: string = getDiscoverWikiCacheDir(),
): Promise<WikiPagesResult> {
  const hasCache = existsSync(join(cacheDir, '.git'))
  const previousHash = readWikiMeta(cacheDir)?.commitHash ?? null

  if (!hasCache || force) {
    await doRefresh(cacheDir)
    return readWikiPages(cacheDir)
  }

  // 后台刷新（不阻塞本次返回）
  void (async () => {
    const ok = await doRefresh(cacheDir)
    if (ok && previousHash) {
      const meta = readWikiMeta(cacheDir)
      if (meta?.commitHash && meta.commitHash !== previousHash) {
        safeSend(sender, DISCOVER_IPC_CHANNELS.WIKI_UPDATED, { commitHash: meta.commitHash })
      }
    }
  })()

  return readWikiPages(cacheDir)
}

/** 读取单页正文（媒体重写 + GitHub 链接） */
export function getWikiPage(
  name: string,
  cacheDir: string = getDiscoverWikiCacheDir(),
): WikiPageContent {
  if (!isWikiPageNameSafe(name)) throw new Error(`页面名不合法：${name}`)
  const filePath = join(cacheDir, `${name}.md`)
  if (!existsSync(filePath)) throw new Error(`页面不存在：${name}`)
  const markdown = rewriteWikiMedia(readFileSync(filePath, 'utf-8'), registerRemoteMediaUrl)
  const slug = name.replace(/ /g, '-')
  return {
    name,
    markdown,
    htmlUrl: `https://github.com/${WIKI_REPO.owner}/${WIKI_REPO.repo}/wiki/${encodeURIComponent(slug)}`,
  }
}
