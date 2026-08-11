import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import type { Tag } from './types';
import logger from './logger';

/**
 * 符号缓存（JSON 文件实现）。
 *
 * 遵循 MyYoda「不采用本地数据库方案」的项目原则，用单文件 JSON 存储
 * file_path → { mtime, tags } 的映射；内存 Map 加速，变更后原子落盘。
 *
 * 防膨胀设计（2026-08-11 修复）：
 * - 每条目记录 updatedAt（访问/写入时间）
 * - 条目数超过 MAX_CACHE_ENTRIES 时按 updatedAt 淘汰最旧条目（LRU 风格）
 * - 加载与持久化时都会截断，防止跨仓库/跨 worktree 无界累积（曾出现 87MB 单文件）
 */
interface FileCacheEntry {
  mtime: number
  tags: Tag[]
  /** 最近访问/写入时间戳，用于 LRU 淘汰 */
  updatedAt: number
}

/** 缓存条目上限：约 3000 个文件 ≈ 10-20MB JSON，防止无界膨胀 */
const MAX_CACHE_ENTRIES = 3_000

function getCacheDbPath(): string {
  // 统一放在 MyYoda 配置目录下，避免散落在系统缓存
  return path.join(os.homedir(), '.myyoda', 'cache', 'repo-map', 'file-cache.json')
}

export class CacheManager {
  private cache = new Map<string, FileCacheEntry>()
  private dbPath: string
  private initialized = false
  private writeTimer: ReturnType<typeof setTimeout> | undefined

  constructor(dbPath?: string) {
    this.dbPath = dbPath || getCacheDbPath()
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    this.initialized = true

    try {
      const raw = await fs.readFile(this.dbPath, 'utf-8')
      const parsed = JSON.parse(raw) as Record<string, FileCacheEntry>
      for (const [filePath, entry] of Object.entries(parsed)) {
        if (entry && Array.isArray(entry.tags) && typeof entry.mtime === 'number') {
          this.cache.set(filePath, { ...entry, updatedAt: entry.updatedAt ?? Date.now() })
        }
      }
      this.trimToLimit()
      logger.info(`[CacheManager] Cache loaded from ${this.dbPath} (${this.cache.size} entries)`)
      // 加载后若发生了截断，立即落盘一次，避免旧的大文件持续滞留
      if (this.cache.size !== Object.keys(parsed).length) {
        await this.persist()
      }
    } catch {
      // 首次运行或文件损坏：空缓存启动
    }
  }

  /** 超过上限时按 updatedAt 淘汰最旧条目（LRU 风格） */
  private trimToLimit(): void {
    if (this.cache.size <= MAX_CACHE_ENTRIES) return
    const sorted = Array.from(this.cache.entries()).sort((a, b) => a[1].updatedAt - b[1].updatedAt)
    for (let i = 0; i < sorted.length - MAX_CACHE_ENTRIES; i++) {
      this.cache.delete(sorted[i]![0])
    }
    logger.info(`[CacheManager] 缓存条目超上限，已淘汰 ${sorted.length - MAX_CACHE_ENTRIES} 条（当前 ${this.cache.size} 条）`)
  }

  private async persist(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.dbPath), { recursive: true })
      const payload = Object.fromEntries(this.cache.entries())
      // 原子写：先写临时文件再 rename
      const tmpPath = `${this.dbPath}.tmp`
      await fs.writeFile(tmpPath, JSON.stringify(payload), 'utf-8')
      await fs.rename(tmpPath, this.dbPath)
    } catch (error) {
      logger.error('[CacheManager] Failed to persist cache:', error)
    }
  }

  private schedulePersist(): void {
    if (this.writeTimer) return
    this.writeTimer = setTimeout(() => {
      this.writeTimer = undefined
      void this.persist()
    }, 500)
  }

  async getFileCache(filePath: string): Promise<{ tags: Tag[]; mtime: number } | null> {
    if (!this.initialized) await this.initialize()

    const entry = this.cache.get(filePath)
    if (!entry) return null
    entry.updatedAt = Date.now()
    return { tags: entry.tags, mtime: entry.mtime }
  }

  async setFileCache(filePath: string, mtime: number, tags: Tag[]): Promise<void> {
    if (!this.initialized) await this.initialize()

    this.cache.set(filePath, { mtime, tags, updatedAt: Date.now() })
    this.trimToLimit()
    this.schedulePersist()
    logger.debug(`[CacheManager] Cached ${tags.length} tags for ${filePath}`)
  }

  async getFileMtime(filePath: string): Promise<number | null> {
    try {
      const stats = await fs.stat(filePath)
      return stats.mtimeMs
    } catch (error) {
      logger.error(`[CacheManager] Failed to get mtime for ${filePath}:`, error)
      return null
    }
  }

  async clearCache(): Promise<void> {
    this.cache.clear()
    await this.persist()
    logger.info('[CacheManager] Cache cleared')
  }

  async close(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = undefined
    }
    await this.persist()
    logger.info('[CacheManager] Cache persisted and closed')
  }
}
