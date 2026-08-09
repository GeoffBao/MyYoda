/**
 * 社区市场服务（私有市场接入）
 *
 * 默认市场为 MyYoda 自建私有市场（GeoffBao/myyoda-skills），遵循标准的 SKILL.md 目录市场规范，
 * 提供 sources.yaml 结构化清单 + skills/ 目录。本服务：
 * 1. 拉取市场 sources.yaml 解析 skill 清单（name/description/source/category）
 * 2. 下载整个仓库 tar.gz → 解压 → 按清单提取目标 skill 目录
 * 3. 写入工作区 skills/ 并标记来源（community）
 *
 * 市场地址可配置（未来接入其他市场只需换清单 URL 与仓库地址）。
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import decompress from 'decompress'
import decompressTargz from 'decompress-targz'
import { load as loadYaml } from 'js-yaml'

/** 市场仓库配置（默认 MyYoda 私有市场） */
export const COMMUNITY_MARKET = {
  name: 'myyoda-skills',
  repo: 'GeoffBao/myyoda-skills',
  branch: 'main',
  manifestPath: 'sources.yaml',
  /** 清单解析后 skills 目录根（仓库内相对路径） */
  skillsRoot: 'skills',
} as const

/** 市场 skill 条目（来自 sources.yaml） */
export interface CommunitySkill {
  name: string
  description: string
  /** 显示名称（target.name） */
  displayName?: string
  /** 分类（target.category，如 tools/automation/workflow） */
  category?: string
  license?: string
  authorName?: string
  homepage?: string
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
  // 补充 category（从 path 推断）
  return skills.map((s) => ({
    ...s,
    category: s.category ?? inferCategory(s.path),
  }))
}

/** 从仓库内 path 推断分类 */
function inferCategory(path: string): string {
  const parts = path.split('/')
  if (parts.length >= 2) return parts[0]!
  return 'other'
}

/** 下载市场仓库 tar.gz 到临时目录并解压，返回解压目录 */
async function downloadAndExtractMarket(): Promise<string> {
  const url = `https://codeload.github.com/${COMMUNITY_MARKET.repo}/tar.gz/refs/heads/${COMMUNITY_MARKET.branch}`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`下载社区市场失败 (${res.status})`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  const tmpDir = join(tmpdir(), `myyoda-market-${randomUUID()}`)
  mkdirSync(tmpDir, { recursive: true })
  try {
    await decompress(buf, tmpDir, { plugins: [decompressTargz()] })
  } catch (err) {
    rmSync(tmpDir, { recursive: true, force: true })
    throw new Error(`解压社区市场失败: ${(err as Error).message}`)
  }
  return tmpDir
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

  const extractedRoot = await downloadAndExtractMarket()
  try {
    // GitHub tar.gz 解压后目录名: <repo>-<branch>/
    const repoDirs = (await import('node:fs')).readdirSync(extractedRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => join(extractedRoot, e.name))
    const repoRoot = repoDirs[0]
    if (!repoRoot) {
      throw new Error('社区市场包结构异常')
    }

    const sourceDir = join(repoRoot, skill.path)
    // 社区市场仓库遵循 Claude Code plugin 格式：SKILL.md 可能在 <dir>/skills/<name>/ 嵌套目录
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
      communityRepo: COMMUNITY_MARKET.repo,
      communitySkill: skill.name,
      importedAt: new Date().toISOString(),
      license: skill.license,
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
    const version = getField('version') ?? '0.0.0'
    const slug = getField('slug') ?? skill.name

    console.log(`[社区市场] 已安装 Skill: ${skill.name} → ${workspaceSkillsDir}`)
    return { slug, name, version }
  } finally {
    rmSync(extractedRoot, { recursive: true, force: true })
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
