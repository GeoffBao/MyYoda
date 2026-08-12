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

    // 清理历史残留（异常退出遗留的 tmp/锁文件），避免与后续写竞争
    await this.cleanupStaleArtifacts()

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
      // 缓存损坏：保留现场备份（便于定位根因），以空缓存启动并重建
      await this.backupCorruptCache()
    }
  }

  /** 备份损坏的缓存文件（保留现场，不静默丢弃） */
  private async backupCorruptCache(): Promise<void> {
    try {
      const stat = await fs.stat(this.dbPath).catch(() => null)
      if (stat) {
        // 旧备份只保留 1 份（损坏备份可达 20-30MB，长期堆积占存储）
        const dir = path.dirname(this.dbPath)
        const base = path.basename(this.dbPath)
        for (const name of await fs.readdir(dir).catch(() => [])) {
          if (name.startsWith(`${base}.corrupt-`)) {
            await fs.rm(path.join(dir, name), { force: true }).catch(() => undefined)
            logger.info(`[CacheManager] 已清理旧损坏备份: ${name}`)
          }
        }
        const backupPath = `${this.dbPath}.corrupt-${Date.now()}`
        await fs.rename(this.dbPath, backupPath)
        logger.warn(`[CacheManager] 缓存文件损坏，已备份为 ${backupPath}（${stat.size} 字节）并重建空缓存`)
      }
    } catch (error) {
      logger.error('[CacheManager] 备份损坏缓存失败（继续以空缓存运行）:', error)
    }
  }

  /** 清理异常退出遗留的 tmp/锁文件（超过 60s 视为残留） */
  private async cleanupStaleArtifacts(): Promise<void> {
    const dir = path.dirname(this.dbPath)
    const now = Date.now()
    try {
      for (const name of await fs.readdir(dir)) {
        if (!name.startsWith(path.basename(this.dbPath) + '.')) continue
        const p = path.join(dir, name)
        const st = await fs.stat(p).catch(() => null)
        if (st && now - st.mtimeMs > 60_000) {
          await fs.rm(p, { recursive: true, force: true }).catch(() => undefined)
          logger.info(`[CacheManager] 已清理残留文件: ${name}`)
        }
      }
    } catch (error) {
      logger.error('[CacheManager] 清理残留文件失败:', error)
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
    // 写锁：mkdir 原子创建（已存在则 EEXIST），跨进程串行化写盘；
    // 持锁失败时短暂重试；**锁龄 >10s 视为残留**（持锁实例异常退出）→ 删除后继续（自愈）
    const lockPath = `${this.dbPath}.lock`
    let acquired = false
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await fs.mkdir(lockPath)
        acquired = true
        break
      } catch {
        // 锁被占用：先检查是否为残留锁（超过 10s 视为异常退出遗留）
        const st = await fs.stat(lockPath).catch(() => null)
        if (st && Date.now() - st.mtimeMs > 10_000) {
          await fs.rmdir(lockPath).catch(() => undefined)
          logger.warn('[CacheManager] 检测到残留写锁（>10s），已清理并重试')
          continue
        }
        if (attempt === 4) return
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
    if (!acquired) return

    try {
      await fs.mkdir(path.dirname(this.dbPath), { recursive: true })
      // RMW：先读盘合并（若合法）——避免后写者覆盖先写者的新条目（跨实例竞态）
      const merged = new Map(this.cache.entries())
      try {
        const raw = await fs.readFile(this.dbPath, 'utf-8')
        const parsed = JSON.parse(raw) as Record<string, FileCacheEntry>
        for (const [filePath, entry] of Object.entries(parsed)) {
          if (entry && Array.isArray(entry.tags) && typeof entry.mtime === 'number' && !merged.has(filePath)) {
            merged.set(filePath, { ...entry, updatedAt: entry.updatedAt ?? Date.now() })
          }
        }
      } catch {
        // 磁盘缓存缺失/损坏：以内存 Map 为准（损坏由 initialize 备份处理）
      }
      const payload = Object.fromEntries(merged.entries())
      const serialized = JSON.stringify(payload)
      if (serialized.length === 0) return
      // 唯一 tmp 路径：彻底消除多实例同 tmp 互踩
      const tmpPath = `${this.dbPath}.${process.pid}.${Date.now()}.tmp`
      await fs.writeFile(tmpPath, serialized, 'utf-8')
      await fs.rename(tmpPath, this.dbPath)
      // 注意：不替换 this.cache——persist 是 async，await 期间 setFileCache 可能已写入新条目，
      // 用快照替换会丢失并发新条目（回归）。内存 Map 保持权威，磁盘合并结果只用于本次落盘。
      // 其他实例新写的盘上条目由内存 miss 时的 loadMapFromDisk 兜底。
    } catch (error) {
      logger.error('[CacheManager] Failed to persist cache:', error)
    } finally {
      await fs.rmdir(lockPath).catch(() => undefined)
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
