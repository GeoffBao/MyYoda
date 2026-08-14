/**
 * Repo Map 服务
 *
 * 为 Agent 会话提供「代码库地图」注入（移植自 aider-desk tree-sitter-utils，
 * 上游 Aider repo map 思路：PageRank 符号排序 + mention 感知 + 行预算）。
 *
 * 缓存设计：
 * - 目录级：cwd + git HEAD 为键，同一 worktree 内多会话共享，HEAD 变化自动失效
 * - 文件级：vendor CacheManager 按文件 mtime 缓存符号解析，跨会话复用
 *
 * 注入策略：
 * - 首条消息等待最多 waitMs（默认 2s，小仓库足够），超时后台继续生成、本条不注入
 * - 之后的消息同步读缓存注入（Promise.race + 并发去重，不重复生成）
 */
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { getRepoMap } from './vendor/src/index'

export interface RepoMapMentionContext {
  /** 对话中已提及的文件路径（绝对或相对 cwd） */
  mentionedFiles?: Set<string>
  /** 对话中已提及的标识符（如类名/函数名） */
  mentionedIdents?: Set<string>
  /** 对话中已打开/引用的文件（从地图中排除，避免重复展示） */
  chatFiles?: Set<string>
}

/** 默认行预算：约 4-6K token */
const DEFAULT_MAX_LINES = 400
/** 少于该文件数的目录不生成地图（收益低） */
const MIN_SOURCE_FILES = 3
/** 首条消息等待生成的最长时间 */
const DEFAULT_WAIT_MS = 2_000
/** 生成超时上限（后台任务也不应无限跑）；14K 文件仓库实测约 36s，放宽到 180s 防大仓库触发失败冷却 */
const GENERATE_TIMEOUT_MS = 180_000

// worktree 仓库内可能包含 .worktrees 兄弟目录，必须排除避免互相扫描
const EXCLUDE_PATTERNS = [
  '.git/**',
  'node_modules/**',
  'dist/**',
  'build/**',
  '.next/**',
  'out/**',
  'coverage/**',
  '.worktrees/**',
  '**/*.min.js',
  '**/*.min.css',
  '**/*.map',
  // 噪声目录：内置 skill 脚本/测试夹具/模板资产大量挤占符号排名，排除后核心源码靠前（2026-08-12 修复）
  '**/default-skills/**',
  '**/resources/repo-map/**',
  '**/__tests__/**',
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.spec.ts',
]

interface CachedMapEntry {
  head: string | undefined
  map: string
  generatedAt: number
}

/**
 * 地图盘上缓存（跨进程/会话共享）：同一仓库的多个 worktree 会话（同 HEAD）复用同一份 map，
 * 避免每个会话各自全量扫描（解析 3 万符号 ~25-36s/次 → N 会话卡顿）。
 * - key = git HEAD（HEAD 变化 → 不同文件，自然失效）
 * - 存储位置（方案 B 2026-08-13）：**主仓库** `.git/repo-map/maps/<sha1(key)>.map`
 *   （worktree 经 --git-common-dir 解析主仓库，所有 worktree 共享；
 *   **非 git 目录不落盘**——严格不支持，无全局回退；旧全局缓存忽略不迁移）
 * - 安全写：唯一 tmp + 目录锁（与符号缓存同款并发保护）
 */
/** 盘上 map 数量上限（LRU 按 mtime 淘汰，防无界膨胀） */
const MAX_MAP_CACHE_FILES = 200

/** 解析主仓库的 maps 缓存目录；非 git 目录返回 undefined（不落盘） */
const mapCacheDirCache = new Map<string, { dir: string | undefined; at: number }>()
const MAP_CACHE_DIR_TTL_MS = 30_000

function mapCacheDirFor(cwd: string): string | undefined {
  const now = Date.now()
  const hit = mapCacheDirCache.get(cwd)
  if (hit && now - hit.at < MAP_CACHE_DIR_TTL_MS) return hit.dir
  let dir: string | undefined
  try {
    const common = execSync('git rev-parse --path-format=absolute --git-common-dir', {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5_000,
    }).trim()
    if (common) dir = path.join(path.dirname(common), '.git', 'repo-map', 'maps')
  } catch {
    dir = undefined
  }
  // 简单 LRU 防多项目长进程无界增长
  if (mapCacheDirCache.size > 200) mapCacheDirCache.clear()
  mapCacheDirCache.set(cwd, { dir, at: now })
  return dir
}

function mapCacheKeyFor(cwd: string, head: string | undefined): string {
  // 同 HEAD 的所有 worktree/主仓库共享一份 map；非 git 目录退化为 cwd
  return head ?? cwd
}

function mapCacheFileFor(key: string, cwd: string): string | undefined {
  const dir = mapCacheDirFor(cwd)
  if (!dir) return undefined
  const hash = createHash('sha1').update(key).digest('hex')
  return path.join(dir, `${hash}.map`)
}

/**
 * 从用户消息中提取 mention 上下文（文件路径 + 标识符），用于地图聚焦。
 */
export function extractMentionContext(message: string | undefined, cwd: string): RepoMapMentionContext {
  const mentionedFiles = new Set<string>()
  const mentionedIdents = new Set<string>()

  if (!message) return { mentionedFiles, mentionedIdents }

  // 文件路径：消息中出现的带扩展名路径（相对 cwd 的源码路径）
  const fileMatches = message.match(/[\w/\\.-]+\.(ts|tsx|js|jsx|py|java|go|rs|c|cpp|h|hpp|rb|php|scala|dart|cs|sh|json|md)/g) ?? []
  for (const match of fileMatches) {
    const normalized = match.replace(/\\/g, '/')
    // 相对 cwd 且实际存在 → 作为 mention 文件
    const abs = path.resolve(cwd, normalized)
    if (fs.existsSync(abs)) {
      mentionedFiles.add(abs)
      continue
    }
    // 绝对路径存在
    if (path.isAbsolute(normalized) && fs.existsSync(normalized)) {
      mentionedFiles.add(normalized)
    }
  }

  // 标识符：驼峰/大写下划线标识符（至少 3 字符）
  const identMatches = message.match(/\b[A-Z][A-Za-z0-9_]{2,}\b/g) ?? []
  for (const ident of identMatches) {
    mentionedIdents.add(ident)
  }

  return { mentionedFiles, mentionedIdents }
}

export class RepoMapService {
  private readonly mapCache = new Map<string, CachedMapEntry>()
  private readonly pending = new Map<string, Promise<string | undefined>>()
  /** 生成失败/无源码目录的冷却截止时间（避免每条消息都触发重建并白等） */
  private readonly cooldownUntil = new Map<string, number>()
  private static readonly FAILURE_COOLDOWN_MS = 5 * 60_000
  /**
   * 最近一次生成的地图（按 cwd，不限 HEAD）——SWR 兜底：HEAD 变化（commit/push）后
   * 旧 map 继续可用，后台重扫新 HEAD，避免每次提交都全量重扫卡顿。
   */
  private readonly recentMapByCwd = new Map<string, { head: string | undefined; map: string; at: number }>()
  /** recentMapByCwd 上限（LRU 淘汰最旧，防多项目长会话进程无界增长） */
  private static readonly RECENT_MAP_MAX = 50
  /** 同 cwd 后台重扫节流：HEAD 连续变化时最多 60s 重扫一次 */
  private readonly lastRegenAtByCwd = new Map<string, number>()
  private static readonly REGEN_THROTTLE_MS = 60_000
  /** git HEAD 解析器（测试可注入固定值，避免全量测试并发时被其他 git 操作干扰） */
  private readonly headProvider: (cwd: string) => string | undefined

  constructor(options?: { headProvider?: (cwd: string) => string | undefined }) {
    this.headProvider = options?.headProvider ?? this.getGitHead
  }

  /**
   * 同步读取已缓存地图（SWR）：
   * 1. 精确 HEAD 命中 → 返回
   * 2. HEAD 已变化但有最近地图 → 触发后台重扫（节流 60s）并返回旧地图（stale，0 等待）
   * 3. 无任何缓存 → undefined（触发正常生成 + 2s 等待）
   */
  getCachedMap(cwd: string): string | undefined {
    if (!cwd) return undefined
    const head = this.headProvider(cwd)
    const key = mapCacheKeyFor(cwd, head)

    const cached = this.mapCache.get(key)
    if (cached) {
      // 非 git 目录（双方 head 均为 undefined）视为命中；只有 git HEAD 发生变化才失效
      if (head !== cached.head) {
        this.mapCache.delete(key)
        return undefined
      }
      return cached.map
    }

    // 盘上缓存（其他进程/会话生成过）：命中回填内存并直接返回，跳过全量扫描
    const disk = this.loadMapFromDisk(key, cwd)
    if (disk !== undefined) {
      this.mapCache.set(key, { head, map: disk, generatedAt: Date.now() })
      this.recordRecentMap(cwd, head, disk)
      return disk
    }

    // SWR：HEAD 变化（commit/push）但最近生成过 → 后台重扫新 HEAD，先返回旧地图（0 等待）
    const recent = this.recentMapByCwd.get(cwd)
    if (recent && recent.map) {
      const lastRegen = this.lastRegenAtByCwd.get(cwd) ?? 0
      if (Date.now() - lastRegen > RepoMapService.REGEN_THROTTLE_MS) {
        this.lastRegenAtByCwd.set(cwd, Date.now())
        this.warmUp(cwd)
        console.log(`[RepoMap] HEAD 变化（${recent.head?.slice(0, 8)} → ${head?.slice(0, 8)}），后台重扫，先用旧地图（${recent.map.length} chars）`)
      }
      return recent.map
    }
    return undefined
  }

  /**
   * 获取地图（供 prompt 注入）。
   *
   * 缓存命中 → 同步返回；未命中 → 触发生成（并发去重），最多等待 waitMs，
   * 超时返回 undefined（后台继续生成，下条消息注入）。
   */
  async getRepoMapForPrompt(
    cwd: string,
    mention?: RepoMapMentionContext,
    waitMs: number = DEFAULT_WAIT_MS,
  ): Promise<string | undefined> {
    if (!cwd || !this.isSuitableDirectory(cwd)) return undefined
    if (this.isInCooldown(cwd)) return undefined

    const head = this.headProvider(cwd)
    const key = mapCacheKeyFor(cwd, head)
    const cached = this.getCachedMap(cwd)
    if (cached !== undefined) return cached

    // ensureMap 内部自带 pending 去重（同 key 生成中 → 复用），这里只负责等待
    const promise = this.ensureMap(cwd, mention)
    return Promise.race([
      promise,
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), waitMs)),
    ])
  }

  /**
   * 纯读获取地图（供 prompt 注入，设计决策 2026-08-13「首次创建仅主动」）：
   * 只读缓存（内存 + 盘上 + SWR 旧图兜底），**不触发生成**——无缓存返回 undefined。
   * SWR 分支保留：HEAD 变化但有最近地图 → 后台重扫（被动差异同步）+ 返回旧图。
   * 注入链路必须用本方法，防止会话消息被动创建（创建入口只有对话栏按钮）。
   */
  getRepoMapForPromptReadOnly(cwd: string): string | undefined {
    if (!cwd || !this.isSuitableDirectory(cwd)) return undefined
    if (this.isInCooldown(cwd)) return undefined
    return this.getCachedMap(cwd)
  }

  /** 后台预热（fire-and-forget），不阻塞调用方。 */
  warmUp(cwd: string, mention?: RepoMapMentionContext): void {
    if (!cwd || !this.isSuitableDirectory(cwd)) return
    if (this.isInCooldown(cwd)) return
    const head = this.headProvider(cwd)
    const key = mapCacheKeyFor(cwd, head)
    if (this.mapCache.has(key) || this.pending.has(key)) return
    void this.ensureMap(cwd, mention)
  }

  private async ensureMap(cwd: string, mention?: RepoMapMentionContext): Promise<string | undefined> {
    const head = this.headProvider(cwd)
    const key = mapCacheKeyFor(cwd, head)

    // 精确 key 缓存检查（不走 getCachedMap 的 SWR 分支——SWR 返回旧 map 会导致这里提前返回、新 map 永不生成）
    const exact = this.mapCache.get(key)
    if (exact && (head === undefined || head === exact.head)) {
      return exact.map
    }
    const disk = this.loadMapFromDisk(key, cwd)
    if (disk !== undefined) {
      this.mapCache.set(key, { head, map: disk, generatedAt: Date.now() })
      this.recordRecentMap(cwd, head, disk)
      return disk
    }

    // pending 去重：同 key 已在生成中 → 复用（warmUp 与首条消息并发触发时只生成一次）
    const existing = this.pending.get(key)
    if (existing) return existing

    const promise = this.generateMap(cwd, key, head, mention)
    this.pending.set(key, promise)
    try {
      return await promise
    } finally {
      if (this.pending.get(key) === promise) {
        this.pending.delete(key)
      }
    }
  }

  private async generateMap(
    cwd: string,
    key: string,
    head: string | undefined,
    mention?: RepoMapMentionContext,
  ): Promise<string | undefined> {
    try {
      // 扫描主仓库（key 为 main/master 分支引用时，内容与 key 自洽；worktree 本地分支差异不影响 map）
      const scanRoot = this.getMainRepoRootSync(cwd) ?? cwd
      const map = await Promise.race([
        getRepoMap(scanRoot, {
          maxLines: DEFAULT_MAX_LINES,
          excludePatterns: EXCLUDE_PATTERNS,
          mentionedFiles: mention?.mentionedFiles,
          mentionedIdents: mention?.mentionedIdents,
          chatFiles: mention?.chatFiles,
        }),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('repo map generation timeout')), GENERATE_TIMEOUT_MS),
        ),
      ])

      // 空/过短结果不缓存（目录可能没有可解析源码），并进入冷却避免反复重建
      if (!map || map.length < 120) {
        this.cooldownUntil.set(cwd, Date.now() + RepoMapService.FAILURE_COOLDOWN_MS)
        return undefined
      }

      this.mapCache.set(key, { head, map, generatedAt: Date.now() })
      // SWR 记录：按 cwd 保存最近地图（HEAD 变化时旧 map 兜底）
      this.recordRecentMap(cwd, head, map)
      // 无 mention 聚焦的结果才落盘（聚焦版会因对话上下文变化而不同，落盘会污染共享缓存）
      if (!mention?.mentionedFiles?.size && !mention?.mentionedIdents?.size) {
        this.saveMapToDisk(key, map, cwd)
      }
      this.cooldownUntil.delete(cwd)
      console.log(`[RepoMap] 已生成代码地图 ${cwd} (${map.length} chars, ${this.mapCache.size} 个目录缓存, key=${key.slice(0, 12)})`)
      return map
    } catch (error) {
      this.cooldownUntil.set(cwd, Date.now() + RepoMapService.FAILURE_COOLDOWN_MS)
      console.warn('[RepoMap] 生成失败（进入 5 分钟冷却）:', error)
      return undefined
    }
  }

  /** 记录最近地图（LRU 上限淘汰最旧） */
  private recordRecentMap(cwd: string, head: string | undefined, map: string): void {
    this.recentMapByCwd.set(cwd, { head, map, at: Date.now() })
    if (this.recentMapByCwd.size > RepoMapService.RECENT_MAP_MAX) {
      let oldestKey: string | undefined
      let oldestAt = Infinity
      for (const [k, v] of this.recentMapByCwd) {
        if (v.at < oldestAt) {
          oldestAt = v.at
          oldestKey = k
        }
      }
      if (oldestKey) this.recentMapByCwd.delete(oldestKey)
    }
  }

  /** 读盘上 map 缓存（跨进程共享）；不存在/过短返回 undefined */
  private loadMapFromDisk(key: string, cwd: string): string | undefined {
    const file = mapCacheFileFor(key, cwd)
    if (!file) return undefined
    try {
      const raw = fs.readFileSync(file, 'utf-8')
      if (!raw || raw.length < 120) return undefined
      return raw
    } catch {
      return undefined
    }
  }

  /** 安全写盘上 map 缓存（唯一 tmp + 目录锁；锁残留 >10s 自愈）；LRU 清理旧文件 */
  private saveMapToDisk(key: string, map: string, cwd: string): void {
    const target = mapCacheFileFor(key, cwd)
    if (!target) return
    const dir = mapCacheDirFor(cwd)
    if (!dir) return
    try {
      fs.mkdirSync(dir, { recursive: true })
      const lock = `${target}.lock`
      let acquired = false
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          fs.mkdirSync(lock)
          acquired = true
          break
        } catch {
          const st = fs.statSync(lock)
          if (st && Date.now() - st.mtimeMs > 10_000) {
            fs.rmdirSync(lock)
            continue
          }
          break
        }
      }
      if (!acquired) return
      try {
        const tmp = `${target}.${process.pid}.${Date.now()}.tmp`
        fs.writeFileSync(tmp, map, 'utf-8')
        fs.renameSync(tmp, target)
      } finally {
        fs.rmdirSync(lock)
      }
      this.trimMapDiskCache(dir)
    } catch {
      // 盘上缓存失败不影响主流程
    }
  }

  /** 盘上 map LRU：超过上限按 mtime 淘汰最旧 */
  private trimMapDiskCache(dir: string): void {
    try {
      const files = fs.readdirSync(dir)
        .filter((name) => name.endsWith('.map'))
        .map((name) => ({ name, mtime: fs.statSync(path.join(dir, name)).mtimeMs }))
        .sort((a, b) => a.mtime - b.mtime)
      while (files.length > MAX_MAP_CACHE_FILES) {
        const oldest = files.shift()
        if (oldest) fs.rmSync(path.join(dir, oldest.name), { force: true })
      }
    } catch {
      // ignore
    }
  }

  private isInCooldown(cwd: string): boolean {
    const until = this.cooldownUntil.get(cwd)
    if (until === undefined) return false
    if (Date.now() < until) return true
    this.cooldownUntil.delete(cwd)
    return false
  }

  /** 目录可用性快速判断：存在且非空（含至少 MIN_SOURCE_FILES 个候选源码文件时才走全量扫描）。
   * 结果短缓存 30s（目录属性几乎不变），避免每条消息 readdirSync 阻塞主进程。 */
  private readonly suitableCache = new Map<string, { ok: boolean; at: number }>()
  private static readonly SUITABLE_CACHE_TTL_MS = 30_000

  private isSuitableDirectory(cwd: string): boolean {
    const now = Date.now()
    const hit = this.suitableCache.get(cwd)
    if (hit && now - hit.at < RepoMapService.SUITABLE_CACHE_TTL_MS) return hit.ok
    const ok = this.checkSuitableDirectory(cwd)
    this.suitableCache.set(cwd, { ok, at: now })
    return ok
  }

  private checkSuitableDirectory(cwd: string): boolean {
    try {
      const stat = fs.statSync(cwd)
      if (!stat.isDirectory()) return false

      // 快速抽样：目录下直接子文件数（源码文件常见于根或一级子目录）
      let count = 0
      for (const entry of fs.readdirSync(cwd, { withFileTypes: true })) {
        if (entry.isFile()) count += 1
        if (count >= MIN_SOURCE_FILES) return true
      }
      // 一级子目录也抽样（如 src/、packages/）
      for (const entry of fs.readdirSync(cwd, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
          try {
            count += fs.readdirSync(path.join(cwd, entry.name)).length
          } catch {
            // ignore
          }
          if (count >= MIN_SOURCE_FILES) return true
        }
      }
      return false
    } catch {
      return false
    }
  }

  /**
   * 地图 key 解析（设计决策 2026-08-12）：
   * **整个项目的所有 worktree/本地分支共用 main 分支的 repo map**。
   * - 本地 commit/push（worktree HEAD 变化）不触发重扫（key 不变，不卡顿）
   * - 仅 main 同步新代码（pull/checkout 更新 refs/heads/main）时 key 变化 → 后台增量重扫
   * - 无 main/master 分支的仓库退化为当前 HEAD；非 git 目录返回 undefined（key=cwd）
   */
  /** 主仓库根解析（同步）：worktree 的 --git-common-dir 指向主仓库 .git，其父目录即主仓库根。 */
  private getMainRepoRootSync(cwd: string): string | undefined {
    try {
      const common = execSync('git rev-parse --path-format=absolute --git-common-dir', {
        cwd,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 5_000,
      }).trim()
      if (!common) return undefined
      return path.dirname(common)
    } catch {
      return undefined
    }
  }

  /** getGitHead 结果短缓存（5s TTL）：main 引用不会秒变，避免每条消息多次 execSync 阻塞主进程 */
  private readonly headCache = new Map<string, { head: string | undefined; at: number }>()
  private static readonly HEAD_CACHE_TTL_MS = 5_000

  private getGitHead(cwd: string): string | undefined {
    const now = Date.now()
    const hit = this.headCache.get(cwd)
    if (hit && now - hit.at < RepoMapService.HEAD_CACHE_TTL_MS) return hit.head

    // 快检：非 git 目录（无 .git 目录/文件）直接返回，避免每条消息 3 次 execSync 失败阻塞主进程
    try {
      const gitMarker = path.join(cwd, '.git')
      const st = fs.statSync(gitMarker)
      if (!st.isDirectory() && !st.isFile()) return undefined
    } catch {
      return undefined
    }
    let resolved: string | undefined
    for (const ref of ['refs/heads/main', 'refs/heads/master', 'HEAD']) {
      try {
        const out = execSync(`git rev-parse ${ref}`, {
          cwd,
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 5_000,
        })
        const value = out.trim()
        if (value) {
          resolved = value
          break
        }
      } catch {
        // try next ref
      }
    }
    this.headCache.set(cwd, { head: resolved, at: now })
    if (this.headCache.size > 100) {
      let oldestKey: string | undefined
      let oldestAt = Infinity
      for (const [k, v] of this.headCache) {
        if (v.at < oldestAt) { oldestAt = v.at; oldestKey = k }
      }
      if (oldestKey) this.headCache.delete(oldestKey)
    }
    return resolved
  }
}

export const repoMapService = new RepoMapService()
