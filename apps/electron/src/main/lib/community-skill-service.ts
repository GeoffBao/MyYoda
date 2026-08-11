/**
 * 社区市场服务（私有市场接入）
 *
 * 默认市场为 MyYoda 自建私有市场（GeoffBao/myyoda-skills），遵循标准的 SKILL.md 目录市场规范，
 * 提供 sources.yaml 结构化清单 + skills/ 目录。本服务：
 * 1. 拉取市场 sources.yaml 解析 skill 清单（name/description/category/version/downloads/source）
 * 2. 安装本仓库托管 skill：下载市场仓库 tar.gz → 解压 → 按清单提取目标 skill 目录
 * 3. 安装外部收录 skill（source.repo）：从上游仓库下载对应目录
 * 4. 写入工作区 skills/ 并标记来源（community）
 * 5. 安装成功后上报下载统计（本地计数 + 可选远端统计服务）
 *
 * 市场地址可配置（未来接入其他市场只需换清单 URL 与仓库地址）。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import decompress from 'decompress'
import decompressTargz from 'decompress-targz'
import { load as loadYaml } from 'js-yaml'
import type { CommunitySkill as SharedCommunitySkill } from '@myyoda/shared'

/** 市场仓库配置（默认 MyYoda 私有市场） */
export const COMMUNITY_MARKET = {
  name: 'myyoda-skills',
  repo: 'GeoffBao/myyoda-skills',
  branch: 'main',
  manifestPath: 'sources.yaml',
  /** 清单解析后 skills 目录根（仓库内相对路径） */
  skillsRoot: 'skills',
} as const

/** 可选远端下载统计服务（未配置时仅本地计数） */
export const COMMUNITY_STATS_ENDPOINT = process.env.MYYODA_SKILL_STATS_URL ?? ''

/** 本地下载计数文件（~/.myyoda/community-market-stats.json，dev 模式 ~/.myyoda-dev/） */
export function getCommunityStatsPath(): string {
  // 环境变量覆盖（测试/自定义场景），与 COMMUNITY_STATS_ENDPOINT 一致的可配置模式
  if (process.env.MYYODA_SKILL_STATS_LOCAL_PATH) {
    return process.env.MYYODA_SKILL_STATS_LOCAL_PATH
  }
  const { getConfigDir } = require('./config-paths')
  return join(getConfigDir(), 'community-market-stats.json')
}

/** 读取本地下载计数（{ skill: count }），文件不存在或损坏时返回空对象。导出供测试与合并逻辑复用。 */
export function readLocalStats(): Record<string, number> {
  try {
    const path = getCommunityStatsPath()
    if (!existsSync(path)) return {}
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(parsed)) {
      const n = typeof v === 'number' ? v : Number(v)
      if (typeof n === 'number' && Number.isFinite(n) && n > 0) out[k] = Math.floor(n)
    }
    return out
  } catch {
    return {}
  }
}

/** 本地下载计数 +1 并落盘 */
function bumpLocalStats(name: string): void {
  try {
    const stats = readLocalStats()
    stats[name] = (stats[name] ?? 0) + 1
    writeFileSync(getCommunityStatsPath(), JSON.stringify(stats, null, 2), 'utf-8')
  } catch {
    // 静默
  }
}

/** 市场 skill 条目（来自 sources.yaml） */
export interface CommunitySkill extends SharedCommunitySkill {
  /** 仓库内 skill 目录相对路径（target.path） */
  path: string
}

/** 解析 sources.yaml 清单（基于 js-yaml，支持任意嵌套） */
export function parseSourcesYaml(text: string): CommunitySkill[] {
  let data: { skills?: Array<Record<string, unknown>> } | null = null
  try {
    data = loadYaml(text) as { skills?: Array<Record<string, unknown>> }
  } catch {
    return []
  }
  if (!data?.skills || !Array.isArray(data.skills)) return []

  const skills: CommunitySkill[] = []
  for (const entry of data.skills) {
    const name = String(entry.name ?? '').trim()
    if (!name) continue
    const target = (entry.target ?? {}) as Record<string, unknown>
    const targetPath = typeof target.path === 'string' ? target.path.trim() : ''
    if (!targetPath) continue

    // 外部收录源
    const sourceEntry = (entry.source ?? {}) as Record<string, unknown>
    const source = sourceEntry.repo
      ? {
          repo: String(sourceEntry.repo).trim(),
          path: String(sourceEntry.path ?? '').trim(),
          ref: typeof sourceEntry.ref === 'string' ? sourceEntry.ref.trim() : undefined,
        }
      : undefined

    skills.push({
      name,
      description: String(entry.description ?? '').trim(),
      displayName: typeof target.name === 'string' ? target.name.trim() : undefined,
      category: typeof target.category === 'string' ? target.category.trim() : inferCategory(targetPath),
      license: typeof entry.license === 'string' ? entry.license.trim() : undefined,
      authorName: typeof entry.author === 'object' && entry.author
        ? String((entry.author as Record<string, unknown>).name ?? '').trim() || undefined
        : undefined,
      homepage: typeof entry.homepage === 'string' ? entry.homepage.trim() : undefined,
      path: targetPath,
      version: typeof entry.version === 'string' ? entry.version.trim() : undefined,
      downloads: typeof entry.downloads === 'number' ? entry.downloads : typeof entry.downloads === 'string' ? Number(entry.downloads) || 0 : 0,
      verified: typeof entry.verified === 'boolean' ? entry.verified : undefined,
      source,
      external: Boolean(source),
    })
  }
  return skills
}

/** 拉取市场清单 */
export async function fetchCommunityManifest(): Promise<CommunitySkill[]> {
  const url = `https://raw.githubusercontent.com/${COMMUNITY_MARKET.repo}/${COMMUNITY_MARKET.branch}/${COMMUNITY_MARKET.manifestPath}`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`拉取社区市场清单失败 (${res.status})`)
  }
  const text = await res.text()
  const skills = parseSourcesYaml(text)
  // 补充 category（从 path 推断）+ 合并本地计数（始终生效）+ 合并远端统计（可选）
  const localStats = readLocalStats()
  const merged = skills.map((s) => ({
    ...s,
    category: s.category ?? inferCategory(s.path),
    // 本地安装计数为真实发生在本机的下载，覆盖静态 sources.yaml 值（保证离线/自托管也有数据）
    downloads: Math.max(s.downloads ?? 0, localStats[s.name] ?? 0),
  }))
  if (COMMUNITY_STATS_ENDPOINT) {
    try {
      const statsRes = await fetch(`${COMMUNITY_STATS_ENDPOINT}/stats`)
      if (statsRes.ok) {
        const stats = (await statsRes.json()) as Record<string, number>
        for (const s of merged) {
          if (stats[s.name] != null) s.downloads = Math.max(s.downloads ?? 0, stats[s.name] ?? 0)
        }
      }
    } catch {
      // 远端统计不可用则保留本地/静态值
    }
  }
  return merged
}

/** 从仓库内 path 推断分类 */
function inferCategory(path: string): string {
  const parts = path.split('/')
  if (parts.length >= 2) return parts[0]!
  return 'other'
}

/** 下载任意 GitHub 仓库 tar.gz 到临时目录并解压，返回解压后的仓库根目录 */
async function downloadAndExtractRepo(repo: string, branch: string): Promise<string> {
  const url = `https://codeload.github.com/${repo}/tar.gz/refs/heads/${branch}`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`下载仓库失败 ${repo} (${res.status})`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  const tmpDir = join(tmpdir(), `myyoda-market-${randomUUID()}`)
  mkdirSync(tmpDir, { recursive: true })
  try {
    await decompress(buf, tmpDir, { plugins: [decompressTargz()] })
  } catch (err) {
    rmSync(tmpDir, { recursive: true, force: true })
    throw new Error(`解压仓库失败 ${repo}: ${(err as Error).message}`)
  }
  // GitHub tar.gz 解压后目录名: <repo>-<branch>/
  const repoDirs = readdirSync(tmpDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(tmpDir, e.name))
  const repoRoot = repoDirs[0]
  if (!repoRoot) {
    rmSync(tmpDir, { recursive: true, force: true })
    throw new Error('仓库包结构异常')
  }
  return repoRoot
}

/** 上报下载统计（远端可选 + 本地始终落盘），失败静默。导出供测试与潜在外部调用。 */
export async function reportDownload(name: string): Promise<void> {
  // 本地计数始终落盘（离线/自托管场景也能展示本机安装次数）
  bumpLocalStats(name)
  // 远端统计服务（可选）
  try {
    if (COMMUNITY_STATS_ENDPOINT) {
      await fetch(`${COMMUNITY_STATS_ENDPOINT}/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skill: name }),
      }).catch(() => {})
    }
  } catch {
    // 静默
  }
}

/**
 * 从社区市场下载 skill 并安装到工作区 skills/ 目录。
 * 返回安装后的 skill 元数据（name/slug/version）。
 */
export async function installCommunitySkill(
  workspaceSkillsDir: string,
  skill: CommunitySkill,
): Promise<{ slug: string; name: string; version: string }> {
  // 目标路径冲突检查
  const targetPath = join(workspaceSkillsDir, skill.name)
  if (existsSync(targetPath)) {
    throw new Error(`当前空间已存在同名 Skill: ${skill.name}`)
  }

  // 外部收录：从上游仓库下载；本仓库托管：从市场仓库下载
  const repo = skill.source?.repo ?? COMMUNITY_MARKET.repo
  const branch = skill.source?.ref ?? COMMUNITY_MARKET.branch
  const skillPath = skill.source ? (skill.source.path || skill.path) : skill.path

  const repoRoot = await downloadAndExtractRepo(repo, branch)
  try {
    const sourceDir = join(repoRoot, skillPath)
    // 兼容：SKILL.md 可能在 <dir>/skills/<name>/ 嵌套目录
    const nestedSkillDir = join(sourceDir, 'skills', skill.name)
    let actualSkillDir = sourceDir
    if (existsSync(join(sourceDir, 'SKILL.md'))) {
      actualSkillDir = sourceDir
    } else if (existsSync(join(nestedSkillDir, 'SKILL.md'))) {
      actualSkillDir = nestedSkillDir
    } else {
      // 兜底：扫描目录内任意一层含 SKILL.md 的子目录
      const found = scanForSkillDir(sourceDir)
      if (found) actualSkillDir = found
      else throw new Error(`社区 Skill 缺少 SKILL.md: ${skill.name}`)
    }

    // 复制到工作区
    const fs = await import('node:fs')
    fs.cpSync(actualSkillDir, targetPath, { recursive: true })

    // 写入来源标记
    const sourceMeta = {
      sourceType: 'community',
      communityName: COMMUNITY_MARKET.name,
      communityRepo: skill.source?.repo ?? COMMUNITY_MARKET.repo,
      communitySkill: skill.name,
      external: Boolean(skill.source),
      importedAt: new Date().toISOString(),
      license: skill.license,
      version: skill.version,
    }
    writeFileSync(join(targetPath, '.source.json'), JSON.stringify(sourceMeta, null, 2), 'utf-8')

    // 读取 SKILL.md frontmatter
    const skillMd = readFileSync(join(targetPath, 'SKILL.md'), 'utf-8')
    const frontmatch = skillMd.match(/^---\s*\n([\s\S]*?)\n---/)
    const getField = (key: string): string | undefined => {
      const m = frontmatch?.[1]?.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
      return m?.[1]?.trim()
    }
    const name = getField('name') ?? skill.displayName ?? skill.name
    const version = getField('version') ?? skill.version ?? '0.0.0'
    const slug = getField('slug') ?? skill.name

    // 下载统计上报（异步，不阻塞安装）
    void reportDownload(skill.name)

    console.log(`[社区市场] 已安装 Skill: ${skill.name} (${version}) → ${workspaceSkillsDir}`)
    return { slug, name, version }
  } finally {
    rmSync(repoRoot, { recursive: true, force: true })
  }
}

/** 扫描目录树找含 SKILL.md 的 skill 目录（兜底） */
function scanForSkillDir(rootDir: string): string | null {
  const { readdirSync, statSync } = require('node:fs')
  const queue: string[] = [rootDir]
  let guard = 0
  while (queue.length > 0 && guard < 200) {
    guard++
    const dir = queue.shift()!
    if (existsSync(join(dir, 'SKILL.md'))) return dir
    try {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) queue.push(full)
      }
    } catch {
      /* 忽略不可读目录 */
    }
  }
  return null
}
