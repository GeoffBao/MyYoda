/**
 * Skill 调用次数统计服务
 *
 * 持久化记录每个工作区内各 Skill 被 Agent 实际调用的次数与最近调用时间，
 * 存储于 ~/.myyoda/agent-workspaces/{slug}/skill-usage.json。
 *
 * 调用检测覆盖两种 Agent 运行时：
 * - Claude runtime：显式 `Skill` 工具，`input.skill` 为 Skill 名（可能带 SDK 附加目录
 *   限定名前缀，如 `<scope>:<slug>`）
 * - Pi runtime：以普通 `Read` 工具加载 `skills/<slug>/SKILL.md`
 */

import { getWorkspaceSkillUsagePath } from './config-paths'
import { readJsonFileSafe, writeJsonFileAtomic } from './safe-file'

export interface SkillUsageEntry {
  count: number
  lastUsedAt: string
}

export type SkillUsageMap = Record<string, SkillUsageEntry>

/** 读取指定工作区的 Skill 用量统计（不存在时返回空表） */
export function readSkillUsageMap(workspaceSlug: string): SkillUsageMap {
  return readJsonFileSafe<SkillUsageMap>(getWorkspaceSkillUsagePath(workspaceSlug)) ?? {}
}

/** 累加一次调用记录并原子写回磁盘 */
export function recordSkillUsage(workspaceSlug: string, slug: string): void {
  const path = getWorkspaceSkillUsagePath(workspaceSlug)
  const map = readJsonFileSafe<SkillUsageMap>(path) ?? {}
  const prev = map[slug]
  map[slug] = { count: (prev?.count ?? 0) + 1, lastUsedAt: new Date().toISOString() }
  writeJsonFileAtomic(path, map)
}

/**
 * 从 SKILL.md 入口路径中提取 Skill slug（Pi runtime 用 Read 工具加载 SKILL.md 时命中）
 *
 * 与渲染层 `tool-phrase.ts` 里的 `skillNameFromEntryPath` 保持一致的匹配规则。
 */
function skillSlugFromEntryPath(path: string): string | null {
  const normalized = path.replace(/\\/g, '/')
  const match = normalized.match(/(?:^|\/)skills\/([^/]+)\/SKILL\.md$/i)
  return match?.[1] ?? null
}

/**
 * 从一次 tool_use 的工具名 + 输入参数中提取被调用的 Skill slug
 *
 * 无法判定（非 Skill 相关调用）时返回 null。
 */
export function extractSkillSlugFromToolUse(toolName: string, input: Record<string, unknown>): string | null {
  if (toolName === 'Skill') {
    const raw = input.skill
    if (typeof raw !== 'string' || !raw.trim()) return null
    // SDK 对附加 Skill 目录会以 `<scope>:<slug>` 的限定名列出，取冒号后的部分作为 slug
    const idx = raw.lastIndexOf(':')
    const slug = idx >= 0 ? raw.slice(idx + 1) : raw
    return slug.trim() || null
  }

  if (toolName === 'Read') {
    const fp = input.file_path ?? input.filePath
    if (typeof fp !== 'string') return null
    return skillSlugFromEntryPath(fp)
  }

  return null
}

/**
 * 从一次 tool_use 事件中检测并记录 Skill 调用（检测失败/无关工具时静默跳过）
 *
 * 用量统计属于旁路数据，任何异常都不应影响 Agent 主流程。
 */
export function recordSkillUsageFromToolUse(
  workspaceSlug: string,
  toolName: string,
  input: Record<string, unknown>,
): void {
  try {
    const slug = extractSkillSlugFromToolUse(toolName, input)
    if (!slug) return
    recordSkillUsage(workspaceSlug, slug)
  } catch (error) {
    console.warn('[Skill 用量] 记录调用失败:', error)
  }
}
