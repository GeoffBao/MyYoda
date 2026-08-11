import { appendFileSync, existsSync, lstatSync, mkdirSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'

export type RecoveryTrashKind = 'project' | 'task' | 'workspace'

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
  if (existsSync(recoveryRoot)) {
    const recoveryStat = lstatSync(recoveryRoot)
    if (recoveryStat.isSymbolicLink() || !recoveryStat.isDirectory()) {
      throw new Error('恢复隔离区不是安全的本地目录')
    }
  } else {
    mkdirSync(recoveryRoot, { recursive: true })
  }
  const recoveryReal = realpathSync(recoveryRoot)
  if (!recoveryReal.startsWith(`${root}${sep}`)) {
    throw new Error('恢复隔离区越出 Workspace 根目录')
  }

  const operationRoot = join(recoveryReal, id)
  mkdirSync(operationRoot, { recursive: true })
  const operationReal = realpathSync(operationRoot)
  if (!operationReal.startsWith(`${root}${sep}`) || !statSync(operationReal).isDirectory()) {
    throw new Error('恢复操作目录不在 Workspace 根目录内')
  }
  const safeQuarantinePath = join(operationReal, basename(source))
  const record: RecoveryTrashRecord = {
    id,
    kind,
    target,
    sourcePath: source,
    quarantinePath: safeQuarantinePath,
    status: 'prepared',
    createdAt: new Date().toISOString(),
  }
  const journalPath = join(operationReal, 'journal.json')
  writeFileSync(journalPath, JSON.stringify(record, null, 2), 'utf-8')

  try {
    renameSync(source, safeQuarantinePath)
  } catch (error) {
    // Keep the prepared journal for diagnosis/recovery; the source remains intact.
    throw new Error(`无法将删除目标移入恢复隔离区，源文件已保留: ${source}`, { cause: error })
  }

  const completed: RecoveryTrashRecord = { ...record, status: 'quarantined' }
  // Rename 已成功后，不能把 journal 的次级写入失败冒充为源数据删除失败：
  // 数据仍在 operation directory，prepared journal 也足以支持人工恢复扫描。
  try {
    writeFileSync(journalPath, JSON.stringify(completed, null, 2), 'utf-8')
  } catch (error) {
    console.warn(`[recovery] 完成 journal 写入失败，保留隔离目录供恢复扫描: ${operationReal}`, error)
  }
  try {
    appendFileSync(join(recoveryReal, 'journal.jsonl'), `${JSON.stringify(completed)}\n`, 'utf-8')
  } catch (error) {
    console.warn(`[recovery] recovery journal 索引追加失败，保留 operation journal: ${operationReal}`, error)
  }
  return completed
}

export function recoveryTrashPathExists(workspaceRoot: string, id: string): boolean {
  return existsSync(join(resolve(workspaceRoot), '.recovery-trash', id))
}
