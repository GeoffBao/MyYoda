/** Agent turn 产出捕获
 *
 * 只保存轻量路径索引，不复制 Project 文件。Outbox 文件本身作为 Workspace 级
 * 持久产出，未来由 Yoda 知识库按白名单读取。
 */

import type { AgentOutputRecord, AgentSessionFileRoots } from '@myyoda/shared'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, renameSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

export interface OutputSnapshotEntry {
  path: string
  relativePath: string
  scope: AgentOutputRecord['scope']
  size: number
  mtimeMs: number
}

export type OutputSnapshot = Map<string, OutputSnapshotEntry>

export interface OutputCaptureRoot {
  root: string
  scope: AgentOutputRecord['scope']
}

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.cache',
  '__pycache__',
  '.venv',
  'venv',
  'target',
  '.turbo',
  '.next',
  '.nuxt',
  '.output',
])

/**
 * 统一构造一轮输出捕获的文件根。Outbox / session / projectRoot / projectAssets 四类根；
 * 供 turn 前后快照与终态捕获共用，保证 before/after 一致。
 */
export function buildOutputCaptureRoots(roots: AgentSessionFileRoots): OutputCaptureRoot[] {
  return [
    { root: roots.sessionDir, scope: 'session' },
    ...(roots.projectRoot ? [{ root: roots.projectRoot, scope: 'project' as const }] : []),
    ...(roots.projectAssetsPath ? [{ root: roots.projectAssetsPath, scope: 'project' as const }] : []),
  ]
}

const MAX_FILES = 10_000
const MAX_DEPTH = 12
const OUTPUT_INDEX_VERSION = 1

function scopePriority(scope: AgentOutputRecord['scope']): number {
  if (scope === 'project') return 2
  return 1
}

function normalizeRelativePath(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).join('/')
}

/** 有限深度扫描文件树，避免捕获触碰大型依赖目录。 */
export function snapshotOutputFiles(roots: OutputCaptureRoot[]): OutputSnapshot {
  const snapshot: OutputSnapshot = new Map()
  const visitedRoots = new Map<string, AgentOutputRecord['scope']>()

  for (const input of roots) {
    const root = resolve(input.root)
    const previousScope = visitedRoots.get(root)
    if (previousScope && scopePriority(previousScope) >= scopePriority(input.scope)) continue
    visitedRoots.set(root, input.scope)

    if (!existsSync(root)) continue

    const walk = (dir: string, depth: number): void => {
      if (snapshot.size >= MAX_FILES || depth > MAX_DEPTH) return
      let entries
      try {
        entries = readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }

      for (const entry of entries) {
        if (snapshot.size >= MAX_FILES) return
        if (entry.name === 'index.json') continue
        if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue
        const path = resolve(dir, entry.name)
        try {
          const stat = lstatSync(path)
          if (stat.isDirectory()) {
            walk(path, depth + 1)
            continue
          }
          if (!stat.isFile()) continue
          const relativePath = normalizeRelativePath(relative(root, path))
          if (!relativePath || relativePath.startsWith('../')) continue
          const existing = snapshot.get(path)
          if (!existing || scopePriority(input.scope) > scopePriority(existing.scope)) {
            snapshot.set(path, {
              path,
              relativePath,
              scope: input.scope,
              size: stat.size,
              mtimeMs: stat.mtimeMs,
            })
          }
        } catch {
          // 单个文件不可读时跳过，不阻断 Agent 主流程。
        }
      }
    }

    walk(root, 0)
  }

  return snapshot
}

export function diffOutputSnapshots(before: OutputSnapshot, after: OutputSnapshot): Array<OutputSnapshotEntry & { change: 'created' | 'modified' }> {
  const changes: Array<OutputSnapshotEntry & { change: 'created' | 'modified' }> = []
  for (const [path, current] of after) {
    const previous = before.get(path)
    if (!previous) {
      changes.push({ ...current, change: 'created' })
    } else if (previous.size !== current.size || previous.mtimeMs !== current.mtimeMs) {
      changes.push({ ...current, change: 'modified' })
    }
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path))
}

interface AgentOutputIndexFile {
  version: number
  records: AgentOutputRecord[]
}

function readOutputIndex(indexPath: string): AgentOutputRecord[] {
  try {
    const parsed = JSON.parse(readFileSync(indexPath, 'utf8')) as Partial<AgentOutputIndexFile>
    return Array.isArray(parsed.records) ? parsed.records : []
  } catch {
    return []
  }
}

/** 捕获一轮变更并追加到 Workspace Outbox 索引。 */
export function captureAgentTurnOutputs(
  roots: AgentSessionFileRoots,
  before: OutputSnapshot,
  context: {
    sessionId: string
    workspaceSlug: string
    projectId?: string
    turnStartedAt: number
  },
): AgentOutputRecord[] {
  const after = snapshotOutputFiles(buildOutputCaptureRoots(roots))
  const capturedAt = Date.now()
  const records = diffOutputSnapshots(before, after).map((item) => ({
    id: `${context.sessionId}:${item.path}:${context.turnStartedAt}`,
    sessionId: context.sessionId,
    workspaceSlug: context.workspaceSlug,
    ...(context.projectId ? { projectId: context.projectId } : {}),
    path: item.path,
    relativePath: item.relativePath,
    scope: item.scope,
    change: item.change,
    capturedAt,
    turnStartedAt: context.turnStartedAt,
  } satisfies AgentOutputRecord))

  return records
}

export function listSessionOutputs(_workspaceFilesPath: string, _sessionId: string): AgentOutputRecord[] {
  // 素材索引（Outbox/index.json）已随 Outbox 概念移除；保留空实现兼容 IPC 通道
  return []
}
