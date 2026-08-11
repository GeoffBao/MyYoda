import { appendFileSync, existsSync, mkdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'

export type RecoveryTrashKind = 'project' | 'task'

export interface RecoveryTrashRecord {
  id: string
  kind: RecoveryTrashKind
  target: string
  sourcePath: string
  quarantinePath: string
  status: 'prepared' | 'quarantined'
  createdAt: string
}

/**
 * Move a destructive target to a same-volume, journaled recovery area.
 *
 * The journal is written before the rename so a crash between the two steps
 * leaves enough information for a later manual restore. The source is never
 * removed when preparation or rename fails.
 */
export function quarantineForRecovery(
  workspaceRoot: string,
  sourcePath: string,
  kind: RecoveryTrashKind,
  target: string,
): RecoveryTrashRecord {
  const root = realpathSync(resolve(workspaceRoot))
  const source = realpathSync(resolve(sourcePath))
  if (!source.startsWith(`${root}${sep}`)) {
    throw new Error('恢复隔离目标必须位于 Workspace 根目录内')
  }
  if (source.startsWith(`${join(root, '.recovery-trash')}${sep}`)) {
    throw new Error('恢复隔离目标不能位于 recovery trash 内')
  }

  const id = randomUUID()
  const recoveryRoot = join(root, '.recovery-trash')
  const operationRoot = join(recoveryRoot, id)
  const quarantinePath = join(operationRoot, basename(source))
  const record: RecoveryTrashRecord = {
    id,
    kind,
    target,
    sourcePath: source,
    quarantinePath,
    status: 'prepared',
    createdAt: new Date().toISOString(),
  }

  mkdirSync(operationRoot, { recursive: true })
  const journalPath = join(operationRoot, 'journal.json')
  writeFileSync(journalPath, JSON.stringify(record, null, 2), 'utf-8')

  try {
    renameSync(source, quarantinePath)
  } catch (error) {
    // Keep the prepared journal for diagnosis/recovery; the source remains intact.
    throw new Error(`无法将删除目标移入恢复隔离区，源文件已保留: ${source}`, { cause: error })
  }

  const completed: RecoveryTrashRecord = { ...record, status: 'quarantined' }
  writeFileSync(journalPath, JSON.stringify(completed, null, 2), 'utf-8')
  appendFileSync(join(recoveryRoot, 'journal.jsonl'), `${JSON.stringify(completed)}\n`, 'utf-8')
  return completed
}

export function recoveryTrashPathExists(workspaceRoot: string, id: string): boolean {
  return existsSync(join(resolve(workspaceRoot), '.recovery-trash', id))
}
