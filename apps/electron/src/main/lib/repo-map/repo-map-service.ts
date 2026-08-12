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
]

interface CachedMapEntry {
  head: string | undefined
  map: string
  generatedAt: number
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
  /** git HEAD 解析器（测试可注入固定值，避免全量测试并发时被其他 git 操作干扰） */
  private readonly headProvider: (cwd: string) => string | undefined

  constructor(options?: { headProvider?: (cwd: string) => string | undefined }) {
    this.headProvider = options?.headProvider ?? this.getGitHead
  }

  /** 同步读取已缓存地图（git HEAD 变化自动失效）；无缓存返回 undefined。 */
  getCachedMap(cwd: string): string | undefined {
    if (!cwd) return undefined
    const cached = this.mapCache.get(cwd)
    if (!cached) return undefined

    const head = this.headProvider(cwd)
    // 非 git 目录（双方 head 均为 undefined）视为命中；只有 git HEAD 发生变化（或缓存被篡改）才失效
    if (head !== cached.head) {
      this.mapCache.delete(cwd)
      return undefined
    }
    return cached.map
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

    const cached = this.getCachedMap(cwd)
    if (cached !== undefined) return cached

    const promise = this.ensureMap(cwd, mention)
    this.pending.set(cwd, promise)
    try {
      return await Promise.race([
        promise,
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), waitMs)),
      ])
    } finally {
      if (this.pending.get(cwd) === promise) {
        this.pending.delete(cwd)
      }
    }
  }

  /** 后台预热（fire-and-forget），不阻塞调用方。 */
  warmUp(cwd: string, mention?: RepoMapMentionContext): void {
    if (!cwd || !this.isSuitableDirectory(cwd)) return
    if (this.isInCooldown(cwd)) return
    if (this.mapCache.has(cwd) || this.pending.has(cwd)) return
    const promise = this.ensureMap(cwd, mention)
    this.pending.set(cwd, promise)
    void promise.finally(() => {
      if (this.pending.get(cwd) === promise) {
        this.pending.delete(cwd)
      }
    })
  }

  private async ensureMap(cwd: string, mention?: RepoMapMentionContext): Promise<string | undefined> {
    const head = this.headProvider(cwd)

    // 再次检查缓存（并发请求时避免重复生成）
    const cached = this.mapCache.get(cwd)
    if (cached && (head === undefined || head === cached.head)) {
      return cached.map
    }

    try {
      const map = await Promise.race([
        getRepoMap(cwd, {
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

      this.mapCache.set(cwd, { head, map, generatedAt: Date.now() })
      this.cooldownUntil.delete(cwd)
      console.log(`[RepoMap] 已生成代码地图 ${cwd} (${map.length} chars, ${this.mapCache.size} 个目录缓存)`)
      return map
    } catch (error) {
      this.cooldownUntil.set(cwd, Date.now() + RepoMapService.FAILURE_COOLDOWN_MS)
      console.warn('[RepoMap] 生成失败（进入 5 分钟冷却）:', error)
      return undefined
    }
  }

  private isInCooldown(cwd: string): boolean {
    const until = this.cooldownUntil.get(cwd)
    if (until === undefined) return false
    if (Date.now() < until) return true
    this.cooldownUntil.delete(cwd)
    return false
  }

  /** 目录可用性快速判断：存在且非空（含至少 MIN_SOURCE_FILES 个候选源码文件时才走全量扫描） */
  private isSuitableDirectory(cwd: string): boolean {
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

  private getGitHead(cwd: string): string | undefined {
    try {
      const out = execSync('git rev-parse HEAD', {
        cwd,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 5_000,
      })
      return out.trim()
    } catch {
      return undefined
    }
  }
}

export const repoMapService = new RepoMapService()
