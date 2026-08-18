import { existsSync, mkdirSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import type { ProjectConfig } from '@myyoda/shared/projects'
import {
  createProject,
  ensureProjectWorkdir,
  loadWorkspaceProjects,
  updateProject,
} from '../../../../../packages/shared/src/projects/storage.ts'
import {
  displayProjectPath,
  normalizeProjectPathForCompare,
} from '@myyoda/shared/utils'

export type EffectiveCwdStatus = 'managed' | 'external' | 'unavailable'

export interface EffectiveCwdResult {
  status: EffectiveCwdStatus
  cwd?: string
  displayPath?: string
}

export interface ProjectPathFs {
  exists: (path: string) => boolean
  realpath: (path: string) => string
  isDirectory: (path: string) => boolean
  mkdir: (path: string) => void
}

export const defaultProjectPathFs: ProjectPathFs = {
  exists: existsSync,
  realpath: (p) => realpathSync(p),
  isDirectory: (p) => statSync(p).isDirectory(),
  mkdir: (p) => { mkdirSync(p, { recursive: true }) },
}

export function canonicalizeForCompare(path: string, fs: ProjectPathFs = defaultProjectPathFs): string {
  const absolute = resolve(displayProjectPath(path))
  const real = fs.exists(absolute) ? fs.realpath(absolute) : absolute
  return normalizeProjectPathForCompare(real)
}

export function resolveEffectiveCwd(
  workspaceRoot: string,
  project: ProjectConfig,
  fs: ProjectPathFs = defaultProjectPathFs,
): EffectiveCwdResult {
  const external = project.workingDirectory?.trim()
  if (!external) {
    const cwd = ensureProjectWorkdir(workspaceRoot, project.slug)
    return { status: 'managed', cwd, displayPath: cwd }
  }
  const absolute = resolve(external)
  if (!fs.exists(absolute) || !fs.isDirectory(absolute)) {
    return { status: 'unavailable', displayPath: external }
  }
  return { status: 'external', cwd: absolute, displayPath: external }
}

export function findProjectByWorkingDirectory(
  workspaceRoot: string,
  folderPath: string,
  fs: ProjectPathFs = defaultProjectPathFs,
): ProjectConfig | null {
  const target = canonicalizeForCompare(folderPath, fs)
  for (const loaded of loadWorkspaceProjects(workspaceRoot)) {
    const wd = loaded.config.workingDirectory?.trim()
    if (!wd) continue
    if (canonicalizeForCompare(wd, fs) === target) return loaded.config
  }
  return null
}

export function openOrCreateProjectForPath(
  workspaceRoot: string,
  folderPath: string,
  fs: ProjectPathFs = defaultProjectPathFs,
): { project: ProjectConfig; created: boolean } {
  const absolute = resolve(displayProjectPath(folderPath))
  if (!fs.exists(absolute) || !fs.isDirectory(absolute)) {
    throw new Error(`目录不可访问: ${folderPath}`)
  }
  const existing = findProjectByWorkingDirectory(workspaceRoot, absolute, fs)
  if (existing) return { project: existing, created: false }
  const name = basename(absolute) || 'Project'
  const project = createProject(workspaceRoot, {
    name,
    workingDirectory: absolute,
  })
  ensureProjectWorkdir(workspaceRoot, project.slug)
  return { project, created: true }
}

export function relocateProjectWorkingDirectory(
  workspaceRoot: string,
  projectSlug: string,
  newPath: string,
  fs: ProjectPathFs = defaultProjectPathFs,
): ProjectConfig {
  const absolute = resolve(displayProjectPath(newPath))
  if (!fs.exists(absolute) || !fs.isDirectory(absolute)) {
    throw new Error(`目录不可访问: ${newPath}`)
  }
  const conflict = findProjectByWorkingDirectory(workspaceRoot, absolute, fs)
  if (conflict && conflict.slug !== projectSlug) {
    throw new Error('该路径已绑定其他 Project')
  }
  return updateProject(workspaceRoot, projectSlug, {
    workingDirectory: absolute,
  })
}

/**
 * 在本地项目原路径重建一个空目录。仅当路径确实缺失时才允许执行，
 * 避免误清空一个只是暂时不可访问（如权限问题）的真实目录。
 */
export function restoreProjectWorkingDirectory(
  workspaceRoot: string,
  projectSlug: string,
  fs: ProjectPathFs = defaultProjectPathFs,
): ProjectConfig {
  const loaded = loadWorkspaceProjects(workspaceRoot).find((p) => p.config.slug === projectSlug)
  if (!loaded) throw new Error(`Project 不存在: ${projectSlug}`)
  const target = loaded.config.workingDirectory?.trim()
  if (!target) throw new Error('该 Project 未绑定本地目录，无需恢复')
  const absolute = resolve(displayProjectPath(target))
  if (fs.exists(absolute)) {
    throw new Error('目录仍然存在，无需恢复；如需切换目录请使用重新关联')
  }
  fs.mkdir(absolute)
  return loaded.config
}

/** Agent / Task 运行前校验：不可用主目录不得静默回退 */
export function assertRunnableCwd(result: EffectiveCwdResult): string {
  if (result.status === 'unavailable' || !result.cwd) {
    throw new Error('工作区主目录不可用，请重新定位后再运行 Agent')
  }
  return result.cwd
}

/** 编辑距离（Levenshtein），用于目录名模糊匹配 */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return dp[n]
}

/**
 * 目录名是否为项目名的重命名候选。
 * 规则（大小写不敏感）：完全同名 / 去复数 s / 前缀包含 / 编辑距离 ≤ 2。
 * 项目名过短（<3）时只允许完全同名，防误报。
 */
export function isRelocationCandidate(name: string, projectName: string): boolean {
  const n = name.toLowerCase()
  const p = projectName.toLowerCase()
  if (n === p) return true
  if (p.length < 3) return false
  const singular = p.endsWith('s') ? p.slice(0, -1) : p
  if (singular.length >= 3 && n === singular) return true
  if (n.length > p.length && n.startsWith(p)) return true
  return levenshteinDistance(n, p) <= 2
}

/**
 * 扫描失效 workingDirectory 的父目录，找出可能被重命名/移动后的候选目录。
 * 只返回目录项，最多 3 个；readdir 异常或输入无效返回空数组（绝不抛错）。
 */
export function findRelocationCandidates(displayPath: string, projectName: string): string[] {
  if (!displayPath || !projectName) return []
  const parent = dirname(displayPath)
  let entries: string[]
  try {
    entries = readdirSync(parent, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch {
    return []
  }
  const hits = entries
    .filter((name) => name !== basename(displayPath) && isRelocationCandidate(name, projectName))
    .sort()
    .map((name) => join(parent, name))
  return hits.slice(0, 3)
}
