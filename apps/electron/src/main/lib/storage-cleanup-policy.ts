import { existsSync, readdirSync } from 'node:fs'
import { readJsonFileSafe } from './safe-file'

export type OrphanCleanupIndexKind = 'sessions' | 'workspaces'
export type OrphanCleanupIndexFailureReason = 'index_missing' | 'index_unreadable' | 'index_invalid'

export type OrphanCleanupIndexAssessment =
  | { safe: true }
  | { safe: false; reason: OrphanCleanupIndexFailureReason }

function hasIndexArtifact(indexPath: string): boolean {
  return [indexPath, `${indexPath}.tmp`, `${indexPath}.bak`].some((path) => existsSync(path))
}

function hasDataEntries(dataDir: string): boolean {
  if (!existsSync(dataDir)) return false
  try {
    return readdirSync(dataDir).length > 0
  } catch {
    // 无法确认目录是否为空时，必须按有数据处理，避免 fail-open 清理。
    return true
  }
}

function hasExpectedEntries(value: unknown, kind: OrphanCleanupIndexKind): boolean {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (!Number.isInteger(record.version) || (record.version as number) < 1) return false

  const entries = record[kind]
  if (!Array.isArray(entries) || entries.length === 0) return false
  return entries.every((entry) => {
    if (!entry || typeof entry !== 'object') return false
    const id = (entry as Record<string, unknown>).id
    if (typeof id !== 'string' || id.length === 0) return false
    return !id.includes('/') && !id.includes('\\') && id !== '.' && id !== '..'
  })
}

/**
 * 在 orphan cleanup 前验证所有权索引是否可安全使用。
 *
 * 索引缺失但数据目录为空属于安全空操作；只要目录里有数据，索引缺失、不可恢复
 * 或结构不符合预期都必须 fail closed，不能把空列表当成“没有活跃数据”。
 */
export function assessOrphanCleanupIndex(
  indexPath: string,
  dataDir: string,
  kind: OrphanCleanupIndexKind,
): OrphanCleanupIndexAssessment {
  if (!hasDataEntries(dataDir)) return { safe: true }
  if (!hasIndexArtifact(indexPath)) return { safe: false, reason: 'index_missing' }

  const parsed = readJsonFileSafe<unknown>(indexPath)
  if (!parsed) return { safe: false, reason: 'index_unreadable' }
  if (!hasExpectedEntries(parsed, kind)) return { safe: false, reason: 'index_invalid' }

  return { safe: true }
}
