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
 */
interface FileCacheEntry {
  mtime: number
  tags: Tag[]
}

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
          this.cache.set(filePath, entry)
        }
      }
      logger.info(`[CacheManager] Cache loaded from ${this.dbPath} (${this.cache.size} entries)`)
    } catch {
      // 首次运行或文件损坏：空缓存启动
    }
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
    return { tags: entry.tags, mtime: entry.mtime }
  }

  async setFileCache(filePath: string, mtime: number, tags: Tag[]): Promise<void> {
    if (!this.initialized) await this.initialize()

    this.cache.set(filePath, { mtime, tags })
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
