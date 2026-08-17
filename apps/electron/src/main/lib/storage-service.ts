/**
 * 存储管理服务
 *
 * 提供磁盘用量统计和临时文件清理功能。
 * 孤儿数据清理因可能误伤用户工作资料而默认关闭。
 * 由设置面板"磁盘管理"Tab 和启动时自动清理逻辑调用。
 */

import { existsSync, statSync, unlinkSync, readFileSync, readdirSync } from 'node:fs'
import { rmSyncWithRetry } from './fs-retry'
import { promises as fsPromises } from 'node:fs'
import { join, basename, relative, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import { app } from 'electron'
import {
  getConfigDir,
  getAgentSessionsDir,
  getAgentSessionsIndexPath,
  getSdkConfigDir,
  getAgentWorkspacesDir,
  getAgentWorkspacesIndexPath,
  getAttachmentsDir,
  getConversationsDir,
  getDiscoverVideoCacheDir,
} from './config-paths'
import { listAgentSessions, stripImageBlocksFromStoredMessage } from './agent-session-manager'
import { writeTextFileAtomic } from './safe-file'
import { listAgentWorkspaces } from './agent-workspace-manager'
import { isWorkspaceMetadataDir } from './storage-boundaries'
import { assessOrphanCleanupIndex } from './storage-cleanup-policy'

// ─── 类型定义 ───

export type StorageCategoryKey =
  | 'agent-sessions'
  | 'sdk-config'
  | 'workspaces'
  | 'conversations'
  | 'attachments'
  | 'temp-files'
  | 'discover-cache'

export interface StorageCategory {
  label: string
  key: StorageCategoryKey
  bytes: number
  count: number
  hasOrphans: boolean
  orphanBytes: number
  orphanCount: number
  orphanItems: StorageOrphanItem[]
  orphanItemsTruncated: boolean
  /** 体积最大的会话文件列表（仅 agent-sessions 分类填充，最多 TOP_SESSION_ITEMS 条） */
  topItems?: StorageTopItem[]
}

export interface StorageOrphanItem {
  kind: 'file' | 'directory'
  path: string
  bytes: number
  count: number
}

/** 存储分类中体积最大的会话文件（供 UI 展示「谁占了空间」） */
export interface StorageTopItem {
  sessionId: string
  title: string
  bytes: number
  archived: boolean
  updatedAt: number
}

export interface StorageStats {
  categories: StorageCategory[]
  totalBytes: number
  calculatedAt: number
}

export interface CleanupOptions {
  categories: StorageCategoryKey[]
  orphansOnly: boolean
  archivedBeforeDays: number
  /** 孤儿数据清理必须来自用户显式确认（UI 弹窗后传 true）；启动时自动清理不传。 */
  confirmedOrphanCleanup?: boolean
}

export interface PreviewCleanupResult {
  reclaimableBytes: number
  affectedCount: number
}

export interface StripImagesResult {
  freedBytes: number
  affectedSessions: number
  errors: string[]
}

export interface CleanupResult {
  freedBytes: number
  deletedCount: number
  errors: string[]
}

// ─── 工具函数 ───

// 扫描时跳过的已知大型目录，防止超大工作区阻塞主进程事件循环
const SKIP_DIRS = new Set([
  'node_modules', '.next', '.nuxt', '.git', 'dist', 'build',
  '.cache', '__pycache__', '.venv', 'venv', '.tox', 'target', '.gradle',
  '.turbo', '.parcel-cache', '.svelte-kit', '.output',
])

// 单次扫描最大文件数上限，防止超大工作区导致无限递归
const MAX_FILE_SCAN = 100_000

/** 磁盘管理页「体积最大会话」列表条数上限 */
const TOP_SESSION_ITEMS = 10
const MAX_ORPHAN_ITEM_PREVIEW = 80

// 孤儿目录无法可靠区分用户仍需保留的会话工作资料，清理必须来自用户在磁盘管理页的显式确认。
// 只读检测（大小/数量统计）不受此限制，始终执行以便 UI 展示。

const PRESERVED_ORPHAN_SESSION_DIRS = new Set([
  '.context',
])

function displayStoragePath(filePath: string): string {
  const configDir = getConfigDir()
  const rel = relative(configDir, filePath)
  if (!rel.startsWith('..') && !isAbsolute(rel)) {
    return `~/${basename(configDir)}/${rel.split(/[\\/]/).join('/')}`
  }
  return filePath
}

function addOrphanItem(items: StorageOrphanItem[], item: StorageOrphanItem): boolean {
  if (items.length >= MAX_ORPHAN_ITEM_PREVIEW) return true
  items.push(item)
  return false
}

async function getDirSize(
  dirPath: string,
  options: { skipTopLevelDirs?: Set<string> } = {}
): Promise<{ bytes: number; count: number }> {
  let bytes = 0
  let count = 0
  if (!existsSync(dirPath)) return { bytes, count }

  // limit 对象通过闭包在整个递归树内共享，作为全局文件计数上限
  const limit = { remaining: MAX_FILE_SCAN }

  async function walk(dir: string, depth: number): Promise<void> {
    try {
      const entries = await fsPromises.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (limit.remaining <= 0) return
        const fullPath = join(dir, entry.name)
        try {
          if (entry.isDirectory()) {
            if (depth === 0 && options.skipTopLevelDirs?.has(entry.name)) continue
            if (SKIP_DIRS.has(entry.name)) continue
            await walk(fullPath, depth + 1)
          } else if (entry.isFile()) {
            const stat = await fsPromises.stat(fullPath)
            bytes += stat.size
            count++
            limit.remaining--
          }
        } catch { /* skip inaccessible */ }
      }
    } catch { /* skip inaccessible dir */ }
  }

  await walk(dirPath, 0)
  return { bytes, count }
}

function safeUnlink(filePath: string): number {
  try {
    const size = statSync(filePath).size
    unlinkSync(filePath)
    return size
  } catch {
    return 0
  }
}

async function safeRmDir(dirPath: string): Promise<number> {
  try {
    const { bytes } = await getDirSize(dirPath)
    rmSyncWithRetry(dirPath, { recursive: true, force: true })
    return bytes
  } catch {
    return 0
  }
}

async function cleanupOrphanSessionWorkspaceDir(sessionDir: string): Promise<number> {
  let freedBytes = 0
  let deletedAny = false

  try {
    const entries = await fsPromises.readdir(sessionDir)
    for (const entry of entries) {
      if (PRESERVED_ORPHAN_SESSION_DIRS.has(entry)) continue
      const entryPath = join(sessionDir, entry)
      try {
        const stat = await fsPromises.lstat(entryPath)
        if (stat.isDirectory()) {
          freedBytes += await safeRmDir(entryPath)
          deletedAny = true
        } else if (stat.isFile()) {
          const freed = safeUnlink(entryPath)
          freedBytes += freed
          deletedAny = true
        }
      } catch { /* skip */ }
    }

    const remaining = await fsPromises.readdir(sessionDir)
    if (remaining.length === 0) {
      rmSyncWithRetry(sessionDir, { recursive: true, force: true })
    }
  } catch {
    return 0
  }

  return deletedAny ? freedBytes : 0
}

// ─── 统计 ───

function getActiveSessionIds(): Set<string> {
  return new Set(listAgentSessions().map((s) => s.id))
}

function getActiveSdkSessionIds(): Set<string> {
  const ids = new Set<string>()
  for (const s of listAgentSessions()) {
    if (s.sdkSessionId) ids.add(s.sdkSessionId)
    if (s.forkSourceSdkSessionId) ids.add(s.forkSourceSdkSessionId)
  }
  return ids
}

function getActiveWorkspaceSlugs(): Set<string> {
  return new Set(listAgentWorkspaces().map((w) => w.slug))
}

async function calcAgentSessionsCategory(): Promise<StorageCategory> {
  const dir = getAgentSessionsDir()
  const activeIds = getActiveSessionIds()
  const sessionMeta = new Map(listAgentSessions().map((s) => [s.id, s]))
  let bytes = 0, count = 0, orphanBytes = 0, orphanCount = 0
  const orphanItems: StorageOrphanItem[] = []
  let orphanItemsTruncated = false
  const topItems: StorageTopItem[] = []

  if (existsSync(dir)) {
    try {
      const files = await fsPromises.readdir(dir)
      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue
        const fullPath = join(dir, file)
        try {
          const stat = await fsPromises.stat(fullPath)
          const id = basename(file, '.jsonl')
          bytes += stat.size
          count++
          const meta = sessionMeta.get(id)
          if (!meta) {
            orphanBytes += stat.size
            orphanCount++
            orphanItemsTruncated = addOrphanItem(orphanItems, {
              kind: 'file',
              path: displayStoragePath(fullPath),
              bytes: stat.size,
              count: 1,
            }) || orphanItemsTruncated
          }
          // 收集体积最大的会话文件（无论是否孤儿，孤儿在元数据缺失时用文件名兜底标题）
          topItems.push({
            sessionId: id,
            title: meta?.title || id,
            bytes: stat.size,
            archived: meta?.archived === true,
            updatedAt: meta?.updatedAt ?? stat.mtimeMs,
          })
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  topItems.sort((a, b) => b.bytes - a.bytes)

  return {
    label: 'Agent 会话记录',
    key: 'agent-sessions',
    bytes, count,
    hasOrphans: orphanCount > 0,
    orphanBytes, orphanCount,
    orphanItems, orphanItemsTruncated,
    topItems: topItems.slice(0, TOP_SESSION_ITEMS),
  }
}

async function calcSdkConfigCategory(): Promise<StorageCategory> {
  const sdkDir = getSdkConfigDir()
  const activeSdkIds = getActiveSdkSessionIds()
  let bytes = 0, count = 0, orphanBytes = 0, orphanCount = 0
  const orphanItems: StorageOrphanItem[] = []
  let orphanItemsTruncated = false

  const projectsDir = join(sdkDir, 'projects')
  if (existsSync(projectsDir)) {
    try {
      const hashDirs = await fsPromises.readdir(projectsDir)
      for (const hashDir of hashDirs) {
        const projPath = join(projectsDir, hashDir)
        try {
          if (!(await fsPromises.lstat(projPath)).isDirectory()) continue
          const files = await fsPromises.readdir(projPath)
          for (const file of files) {
            if (!file.endsWith('.jsonl')) continue
            const fullPath = join(projPath, file)
            try {
              const stat = await fsPromises.stat(fullPath)
              const sdkId = basename(file, '.jsonl')
              bytes += stat.size
              count++
              if (!activeSdkIds.has(sdkId)) {
                orphanBytes += stat.size
                orphanCount++
                orphanItemsTruncated = addOrphanItem(orphanItems, {
                  kind: 'file',
                  path: displayStoragePath(fullPath),
                  bytes: stat.size,
                  count: 1,
                }) || orphanItemsTruncated
              }
            } catch { /* skip */ }
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  const fileHistoryDir = join(sdkDir, 'file-history')
  if (existsSync(fileHistoryDir)) {
    try {
      const sdkIds = await fsPromises.readdir(fileHistoryDir)
      for (const sdkId of sdkIds) {
        const histPath = join(fileHistoryDir, sdkId)
        try {
          if (!(await fsPromises.lstat(histPath)).isDirectory()) continue
          const sub = await getDirSize(histPath)
          bytes += sub.bytes
          count += sub.count
          if (!activeSdkIds.has(sdkId)) {
            orphanBytes += sub.bytes
            orphanCount += sub.count
            orphanItemsTruncated = addOrphanItem(orphanItems, {
              kind: 'directory',
              path: displayStoragePath(histPath),
              bytes: sub.bytes,
              count: sub.count,
            }) || orphanItemsTruncated
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  // sdk-config 其他子目录（sessions, backups 等）
  if (existsSync(sdkDir)) {
    try {
      const entries = await fsPromises.readdir(sdkDir)
      for (const entry of entries) {
        if (entry === 'projects' || entry === 'file-history') continue
        const fullPath = join(sdkDir, entry)
        try {
          const stat = await fsPromises.lstat(fullPath)
          if (stat.isDirectory()) {
            const sub = await getDirSize(fullPath)
            bytes += sub.bytes
            count += sub.count
          } else {
            bytes += stat.size
            count++
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  return {
    label: 'SDK 会话数据',
    key: 'sdk-config',
    bytes, count,
    hasOrphans: orphanCount > 0,
    orphanBytes, orphanCount,
    orphanItems, orphanItemsTruncated,
  }
}

async function calcWorkspacesCategory(): Promise<StorageCategory> {
  const wsDir = getAgentWorkspacesDir()
  const activeIds = getActiveSessionIds()
  const activeSlugs = getActiveWorkspaceSlugs()
  let bytes = 0, count = 0, orphanBytes = 0, orphanCount = 0
  const orphanItems: StorageOrphanItem[] = []
  let orphanItemsTruncated = false

  if (existsSync(wsDir)) {
    try {
      const slugs = await fsPromises.readdir(wsDir)
      for (const slug of slugs) {
        const slugDir = join(wsDir, slug)
        try {
          if (!(await fsPromises.lstat(slugDir)).isDirectory()) continue
          const entries = await fsPromises.readdir(slugDir)
          for (const entry of entries) {
            const entryPath = join(slugDir, entry)
            try {
              const stat = await fsPromises.lstat(entryPath)
              if (!stat.isDirectory()) {
                if (stat.isFile()) {
                  bytes += stat.size
                  count++
                }
                continue
              }
              // 工作区级元目录不属于会话目录，不能按 orphan session 清理。
              if (isWorkspaceMetadataDir(entry)) {
                const sub = await getDirSize(entryPath)
                bytes += sub.bytes
                count += sub.count
                continue
              }
              const sub = await getDirSize(entryPath)
              bytes += sub.bytes
              count += sub.count
              // session 目录的 ID 不在活跃列表中 → 孤儿（只读检测始终执行，清理需用户显式确认）
              if (!activeIds.has(entry) && !activeSlugs.has(entry)) {
                const cleanable = await getDirSize(entryPath, { skipTopLevelDirs: PRESERVED_ORPHAN_SESSION_DIRS })
                if (cleanable.count > 0) {
                  orphanBytes += cleanable.bytes
                  orphanCount++
                  orphanItemsTruncated = addOrphanItem(orphanItems, {
                    kind: 'directory',
                    path: displayStoragePath(entryPath),
                    bytes: cleanable.bytes,
                    count: cleanable.count,
                  }) || orphanItemsTruncated
                }
              }
            } catch { /* skip */ }
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  return {
    label: '工作区文件',
    key: 'workspaces',
    bytes, count,
    hasOrphans: orphanCount > 0,
    orphanBytes, orphanCount,
    orphanItems, orphanItemsTruncated,
  }
}

async function calcConversationsCategory(): Promise<StorageCategory> {
  const dir = getConversationsDir()
  const { bytes, count } = await getDirSize(dir)
  return {
    label: '对话记录',
    key: 'conversations',
    bytes, count,
    hasOrphans: false,
    orphanBytes: 0, orphanCount: 0,
    orphanItems: [], orphanItemsTruncated: false,
  }
}

async function calcAttachmentsCategory(): Promise<StorageCategory> {
  const dir = getAttachmentsDir()
  const { bytes, count } = await getDirSize(dir)
  return {
    label: '附件文件',
    key: 'attachments',
    bytes, count,
    hasOrphans: false,
    orphanBytes: 0, orphanCount: 0,
    orphanItems: [], orphanItemsTruncated: false,
  }
}

async function calcTempFilesCategory(): Promise<StorageCategory> {
  const previewDir = join(tmpdir(), 'myyoda-preview')
  const installerDir = join(app.getPath('temp'), 'myyoda-installers')
  const [preview, installer] = await Promise.all([
    getDirSize(previewDir),
    getDirSize(installerDir),
  ])
  return {
    label: '临时预览/安装文件',
    key: 'temp-files',
    bytes: preview.bytes + installer.bytes,
    count: preview.count + installer.count,
    hasOrphans: false,
    orphanBytes: 0, orphanCount: 0,
    orphanItems: [], orphanItemsTruncated: false,
  }
}

/** 「发现」面板的视频缓存（仅统计视频文件，可随时清理，重新在线播放不受影响） */
async function calcDiscoverCacheCategory(): Promise<StorageCategory> {
  const { bytes, count } = await getDirSize(getDiscoverVideoCacheDir())
  return {
    label: '发现内容缓存（视频）',
    key: 'discover-cache',
    bytes,
    count,
    hasOrphans: false,
    orphanBytes: 0, orphanCount: 0,
    orphanItems: [], orphanItemsTruncated: false,
  }
}

export async function calculateStorageStats(): Promise<StorageStats> {
  const categories = await Promise.all([
    calcAgentSessionsCategory(),
    calcSdkConfigCategory(),
    calcWorkspacesCategory(),
    calcConversationsCategory(),
    calcAttachmentsCategory(),
    calcTempFilesCategory(),
    calcDiscoverCacheCategory(),
  ])
  return {
    categories,
    totalBytes: categories.reduce((sum, c) => sum + c.bytes, 0),
    calculatedAt: Date.now(),
  }
}

// ─── 清理 ───

export async function cleanupTempFiles(): Promise<CleanupResult> {
  let freedBytes = 0, deletedCount = 0
  const errors: string[] = []
  const previewDir = join(tmpdir(), 'myyoda-preview')
  if (existsSync(previewDir)) {
    try {
      const files = await fsPromises.readdir(previewDir)
      for (const file of files) {
        const freed = safeUnlink(join(previewDir, file))
        if (freed > 0) { freedBytes += freed; deletedCount++ }
      }
    } catch (e) {
      errors.push(`清理预览文件失败: ${e}`)
    }
  }

  const installerDir = join(app.getPath('temp'), 'myyoda-installers')
  if (existsSync(installerDir)) {
    try {
      const files = await fsPromises.readdir(installerDir)
      for (const file of files) {
        const freed = safeUnlink(join(installerDir, file))
        if (freed > 0) { freedBytes += freed; deletedCount++ }
      }
    } catch (e) {
      errors.push(`清理安装文件失败: ${e}`)
    }
  }

  if (freedBytes > 0) {
    console.log(`[存储清理] 临时文件: 释放 ${(freedBytes / 1024 / 1024).toFixed(1)} MB, 删除 ${deletedCount} 个文件`)
  }
  return { freedBytes, deletedCount, errors }
}

/** 清理「发现」面板的视频缓存（全部视频文件；重新在线播放不受影响，可重新下载） */
export async function cleanupDiscoverCache(): Promise<CleanupResult> {
  let freedBytes = 0, deletedCount = 0
  const errors: string[] = []

  const dir = getDiscoverVideoCacheDir()
  if (existsSync(dir)) {
    try {
      const files = await fsPromises.readdir(dir)
      for (const file of files) {
        if (!file.endsWith('.mp4') && !file.endsWith('.mp4.part')) continue
        const freed = safeUnlink(join(dir, file))
        if (freed > 0) { freedBytes += freed; deletedCount++ }
      }
    } catch (e) {
      errors.push(`清理发现内容缓存失败: ${e}`)
    }
  }

  if (freedBytes > 0) {
    console.log(`[存储清理] 发现内容缓存: 释放 ${(freedBytes / 1024 / 1024).toFixed(1)} MB, 删除 ${deletedCount} 个文件`)
  }
  return { freedBytes, deletedCount, errors }
}

async function cleanupOrphanAgentSessions(): Promise<CleanupResult> {
  const dir = getAgentSessionsDir()
  let freedBytes = 0, deletedCount = 0
  const errors: string[] = []

  const assessment = assessOrphanCleanupIndex(getAgentSessionsIndexPath(), dir, 'sessions')
  if (!assessment.safe) {
    errors.push(`已跳过孤儿会话清理：会话索引${assessment.reason === 'index_missing' ? '缺失' : assessment.reason === 'index_invalid' ? '结构非法' : '不可恢复'}`)
    return { freedBytes, deletedCount, errors }
  }

  const activeIds = getActiveSessionIds()
  if (!existsSync(dir)) return { freedBytes, deletedCount, errors }

  try {
    const files = await fsPromises.readdir(dir)
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue
      const id = basename(file, '.jsonl')
      if (activeIds.has(id)) continue
      const freed = safeUnlink(join(dir, file))
      if (freed > 0) { freedBytes += freed; deletedCount++ }
    }
  } catch (e) {
    errors.push(`清理孤儿会话文件失败: ${e}`)
  }

  return { freedBytes, deletedCount, errors }
}

async function cleanupOrphanSdkConfig(): Promise<CleanupResult> {
  const sdkDir = getSdkConfigDir()
  const activeSdkIds = getActiveSdkSessionIds()
  let freedBytes = 0, deletedCount = 0
  const errors: string[] = []

  const projectsDir = join(sdkDir, 'projects')
  if (existsSync(projectsDir)) {
    try {
      const hashDirs = await fsPromises.readdir(projectsDir)
      for (const hashDir of hashDirs) {
        const projPath = join(projectsDir, hashDir)
        try {
          if (!(await fsPromises.lstat(projPath)).isDirectory()) continue
          const files = await fsPromises.readdir(projPath)
          for (const file of files) {
            if (!file.endsWith('.jsonl')) continue
            const sdkId = basename(file, '.jsonl')
            if (activeSdkIds.has(sdkId)) continue
            const freed = safeUnlink(join(projPath, file))
            if (freed > 0) { freedBytes += freed; deletedCount++ }
          }
          // 若目录为空则删除
          const remaining = await fsPromises.readdir(projPath)
          if (remaining.length === 0) {
            rmSyncWithRetry(projPath, { recursive: true, force: true })
          }
        } catch { /* skip */ }
      }
    } catch (e) {
      errors.push(`清理孤儿 SDK projects 失败: ${e}`)
    }
  }

  const fileHistoryDir = join(sdkDir, 'file-history')
  if (existsSync(fileHistoryDir)) {
    try {
      const sdkIds = await fsPromises.readdir(fileHistoryDir)
      for (const sdkId of sdkIds) {
        if (activeSdkIds.has(sdkId)) continue
        const histPath = join(fileHistoryDir, sdkId)
        try {
          if (!(await fsPromises.lstat(histPath)).isDirectory()) continue
          const freed = await safeRmDir(histPath)
          if (freed > 0) { freedBytes += freed; deletedCount++ }
        } catch { /* skip */ }
      }
    } catch (e) {
      errors.push(`清理孤儿 file-history 失败: ${e}`)
    }
  }

  return { freedBytes, deletedCount, errors }
}

async function cleanupOrphanWorkspaces(): Promise<CleanupResult> {
  const wsDir = getAgentWorkspacesDir()
  let freedBytes = 0, deletedCount = 0
  const errors: string[] = []

  const assessment = assessOrphanCleanupIndex(getAgentWorkspacesIndexPath(), wsDir, 'workspaces')
  if (!assessment.safe) {
    errors.push(`已跳过孤儿工作区清理：工作区索引${assessment.reason === 'index_missing' ? '缺失' : assessment.reason === 'index_invalid' ? '结构非法' : '不可恢复'}`)
    return { freedBytes, deletedCount, errors }
  }

  const activeIds = getActiveSessionIds()
  const activeSlugs = getActiveWorkspaceSlugs()
  if (!existsSync(wsDir)) return { freedBytes, deletedCount, errors }

  try {
    const slugs = await fsPromises.readdir(wsDir)
    for (const slug of slugs) {
      const slugDir = join(wsDir, slug)
      try {
        if (!(await fsPromises.lstat(slugDir)).isDirectory()) continue
        const entries = await fsPromises.readdir(slugDir)
        for (const entry of entries) {
          if (isWorkspaceMetadataDir(entry)) continue
          const entryPath = join(slugDir, entry)
          try {
            if (!(await fsPromises.lstat(entryPath)).isDirectory()) continue
            if (activeIds.has(entry) || activeSlugs.has(entry)) continue
            const freed = await cleanupOrphanSessionWorkspaceDir(entryPath)
            if (freed > 0) { freedBytes += freed; deletedCount++ }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }
  } catch (e) {
    errors.push(`清理孤儿工作区目录失败: ${e}`)
  }

  return { freedBytes, deletedCount, errors }
}

function cleanupArchivedSessions(beforeDays: number): CleanupResult {
  const cutoff = Date.now() - beforeDays * 24 * 60 * 60 * 1000
  const sessions = listAgentSessions()
  const sdkDir = getSdkConfigDir()
  let freedBytes = 0, deletedCount = 0
  const errors: string[] = []

  for (const session of sessions) {
    if (!session.archived || session.updatedAt > cutoff) continue

    // 删除 JSONL 消息文件
    const msgPath = join(getAgentSessionsDir(), `${session.id}.jsonl`)
    if (existsSync(msgPath)) {
      const freed = safeUnlink(msgPath)
      if (freed > 0) { freedBytes += freed; deletedCount++ }
    }

    // 清理 SDK file-history（同步删除，safeRmDir 的同步路径）
    if (session.sdkSessionId) {
      const histDir = join(sdkDir, 'file-history', session.sdkSessionId)
      if (existsSync(histDir)) {
        try {
          rmSyncWithRetry(histDir, { recursive: true, force: true })
          deletedCount++
        } catch { /* skip */ }
      }
    }
  }

  if (freedBytes > 0) {
    console.log(`[存储清理] 归档数据: 释放 ${(freedBytes / 1024 / 1024).toFixed(1)} MB, 删除 ${deletedCount} 项`)
  }
  return { freedBytes, deletedCount, errors }
}

export async function cleanupStorage(options: CleanupOptions): Promise<CleanupResult> {
  if (options.orphansOnly && !options.confirmedOrphanCleanup) {
    return {
      freedBytes: 0,
      deletedCount: 0,
      errors: ['孤儿数据清理需用户在磁盘管理页显式确认后执行'],
    }
  }

  let totalFreed = 0, totalDeleted = 0
  const allErrors: string[] = []

  const merge = (r: CleanupResult) => {
    totalFreed += r.freedBytes
    totalDeleted += r.deletedCount
    allErrors.push(...r.errors)
  }

  for (const cat of options.categories) {
    if (cat === 'temp-files') {
      merge(await cleanupTempFiles())
      continue
    }

    if (options.orphansOnly) {
      switch (cat) {
        case 'agent-sessions': merge(await cleanupOrphanAgentSessions()); break
        // Pi-only runtime 不再拥有可安全推导 active ownership 的 SDK orphan 索引；沿用 MyYoda，保留这些历史文件。
        case 'sdk-config': break
        case 'workspaces': merge(await cleanupOrphanWorkspaces()); break
      }
    } else if (options.archivedBeforeDays > 0) {
      if (cat === 'agent-sessions' || cat === 'sdk-config') {
        merge(cleanupArchivedSessions(options.archivedBeforeDays))
      }
    }
  }

  if (totalFreed > 0) {
    console.log(`[存储清理] 总计释放 ${(totalFreed / 1024 / 1024).toFixed(1)} MB, 删除 ${totalDeleted} 项`)
  }
  return { freedBytes: totalFreed, deletedCount: totalDeleted, errors: allErrors }
}

// ─── 归档清理预览 ───

/**
 * 预览「清理已归档会话数据」将释放的空间（dry-run，不删除任何文件）。
 *
 * 与 cleanupArchivedSessions 相同的筛选口径：已归档且超过 beforeDays 天未更新。
 */
export function previewArchivedCleanup(beforeDays: number): PreviewCleanupResult {
  const cutoff = Date.now() - beforeDays * 24 * 60 * 60 * 1000
  const sessions = listAgentSessions()
  const sdkDir = getSdkConfigDir()
  let reclaimableBytes = 0
  let affectedCount = 0

  for (const session of sessions) {
    if (!session.archived || session.updatedAt > cutoff) continue

    const msgPath = join(getAgentSessionsDir(), `${session.id}.jsonl`)
    if (existsSync(msgPath)) {
      try {
        reclaimableBytes += statSync(msgPath).size
        affectedCount++
      } catch { /* skip */ }
    }

    if (session.sdkSessionId) {
      const histDir = join(sdkDir, 'file-history', session.sdkSessionId)
      if (existsSync(histDir)) {
        try {
          // file-history 目录大小用同步估算；目录不存在或不可读时忽略。
          const entries = readdirSync(histDir)
          for (const entry of entries) {
            try {
              reclaimableBytes += statSync(join(histDir, entry)).size
            } catch { /* skip */ }
          }
          affectedCount++
        } catch { /* skip */ }
      }
    }
  }

  return { reclaimableBytes, affectedCount }
}

// ─── 存量大图剥离 ───

/** 文件级粗筛阈值：小于该体积的 JSONL 不可能有可观的图片剥离收益，直接跳过 */
const STRIP_IMAGE_MIN_BYTES = 64 * 1024

interface StripSessionResult {
  reclaimableBytes: number
  linesChanged: number
  skippedActive: boolean
}

/**
 * 对单个会话 JSONL 执行大图剥离（读 → 逐行替换 → 原子写回）。
 *
 * 写回前校验 mtime 未变化：会话仍在写入（Agent 运行中）时跳过，避免
 * 与 appendSDKMessages 的追写产生竞态丢失新消息。
 */
async function stripSessionImages(filePath: string, beforeMtime: number, beforeSize: number): Promise<StripSessionResult> {
  const result: StripSessionResult = { reclaimableBytes: 0, linesChanged: 0, skippedActive: false }
  try {
    const afterStat = statSync(filePath)
    if (afterStat.mtimeMs !== beforeMtime || afterStat.size !== beforeSize) {
      result.skippedActive = true
      return result
    }
  } catch {
    result.skippedActive = true
    return result
  }

  let raw: string
  try {
    raw = readFileSync(filePath, 'utf-8')
  } catch {
    result.skippedActive = true
    return result
  }

  const lines = raw.split('\n')
  let changed = false
  const out: string[] = []
  for (const line of lines) {
    if (!line.trim()) {
      out.push(line)
      continue
    }
    const stripped = stripImageBlocksFromStoredMessage(line)
    if (stripped === null) {
      out.push(line)
      continue
    }
    const delta = line.length - stripped.length
    if (delta > 0) {
      result.reclaimableBytes += delta
      result.linesChanged++
      changed = true
    }
    out.push(stripped)
  }

  if (changed) {
    writeTextFileAtomic(filePath, out.join('\n'))
  }
  return result
}

/**
 * 预览存量会话 JSONL 中可剥离的 base64 大图体积（dry-run，不写盘）。
 * 只统计替换后字节数会减少的行；顺带返回受影响的会话数。
 */
export function previewStripOversizedImages(): PreviewCleanupResult {
  const dir = getAgentSessionsDir()
  let reclaimableBytes = 0
  let affectedCount = 0
  if (!existsSync(dir)) return { reclaimableBytes, affectedCount }

  try {
    const files = readdirSync(dir)
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue
      const fullPath = join(dir, file)
      let sessionReclaim = 0
      try {
        const raw = readFileSync(fullPath, 'utf-8')
        for (const line of raw.split('\n')) {
          if (!line.trim()) continue
          const stripped = stripImageBlocksFromStoredMessage(line)
          if (stripped === null) continue
          const delta = line.length - stripped.length
          if (delta > 0) sessionReclaim += delta
        }
      } catch { /* skip */ }
      if (sessionReclaim > 0) {
        reclaimableBytes += sessionReclaim
        affectedCount++
      }
    }
  } catch { /* skip */ }

  return { reclaimableBytes, affectedCount }
}

/**
 * 对全部存量会话 JSONL 执行大图剥离。
 *
 * 只处理静态会话（mtime/size 在读取前后一致）；正在写入的会话自动跳过。
 * 剥离语义与 sanitizeOversizedMessage 一致：图片块替换为截断标记，
 * 渲染层不消费 image 块，视觉零损失。
 */
export async function stripOversizedImages(): Promise<StripImagesResult> {
  const dir = getAgentSessionsDir()
  const result: StripImagesResult = { freedBytes: 0, affectedSessions: 0, errors: [] }
  if (!existsSync(dir)) return result

  let files: string[]
  try {
    files = await fsPromises.readdir(dir)
  } catch (e) {
    result.errors.push(`读取会话目录失败: ${e}`)
    return result
  }

  for (const file of files) {
    if (!file.endsWith('.jsonl')) continue
    const fullPath = join(dir, file)
    try {
      const beforeStat = await fsPromises.stat(fullPath)
      // 单条图片小于阈值不可能贡献 STRIP_IMAGE_MIN_BYTES 以上的回收量，
      // 但文件级快速通道用总大小粗筛：小于阈值的文件直接跳过。
      if (beforeStat.size < STRIP_IMAGE_MIN_BYTES) continue
      const sessionResult = await stripSessionImages(fullPath, beforeStat.mtimeMs, beforeStat.size)
      if (sessionResult.reclaimableBytes > 0) {
        result.freedBytes += sessionResult.reclaimableBytes
        result.affectedSessions++
      }
    } catch (e) {
      result.errors.push(`处理 ${file} 失败: ${e}`)
    }
  }

  if (result.freedBytes > 0) {
    console.log(`[存储清理] 大图剥离: 释放 ${(result.freedBytes / 1024 / 1024).toFixed(1)} MB, 涉及 ${result.affectedSessions} 个会话`)
  }
  return result
}
