import { appendFileSync, lstatSync, mkdirSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, relative, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'

export type RecoveryTrashKind = 'project' | 'task' | 'workspace' | 'session'

export interface RecoveryTrashRecord {
  id: string
  kind: RecoveryTrashKind
  target: string
  sourcePath: string
  quarantinePath: string
  status: 'prepared' | 'quarantined'
  createdAt: string
}

function isWithinRoot(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`)
}

function assertNoSymlinkPath(root: string, candidate: string): void {
  const relativePath = relative(root, candidate)
  if (!relativePath || relativePath.startsWith(`..${sep}`) || relativePath === '..' || resolve(root, relativePath) !== candidate) {
    throw new Error('恢复隔离目标必须位于 Workspace 根目录内')
  }
  let current = root
  for (const part of relativePath.split(sep)) {
    current = join(current, part)
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error('恢复隔离目标路径不能包含符号链接')
    }
  }
}

function ensureRecoveryDirectory(path: string): void {
  let entry
  try {
    // lstat 而不是 existsSync：dangling symlink 也必须被识别为已占用路径。
    entry = lstatSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    mkdirSync(path)
    entry = lstatSync(path)
  }
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw new Error('恢复隔离区不是安全的本地目录')
  }
}

function assertSafeJournalPath(path: string): void {
  try {
    if (lstatSync(path).isSymbolicLink()) {
      throw new Error(`恢复 journal 路径不能包含符号链接: ${path}`)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

/** 只读检查 recovery root；不存在时允许后续 quarantine 创建。 */
export function assertRecoveryRootSafe(workspaceRoot: string): void {
  const root = realpathSync(resolve(workspaceRoot))
  const recoveryRoot = join(root, '.recovery-trash')
  try {
    lstatSync(recoveryRoot)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  ensureRecoveryDirectory(recoveryRoot)
  const recoveryReal = realpathSync(recoveryRoot)
  if (!isWithinRoot(root, recoveryReal)) {
    throw new Error('恢复隔离区越出 Workspace 根目录')
  }
  assertSafeJournalPath(join(recoveryReal, 'journal.jsonl'))
}

/** 只读检查一个待隔离目标；目标不存在时允许调用方按原语义跳过物理清理。 */
export function assertRecoveryTargetSafe(workspaceRoot: string, sourcePath: string): void {
  const workspaceRootCandidate = resolve(workspaceRoot)
  const root = realpathSync(workspaceRootCandidate)
  const sourceCandidate = resolve(sourcePath)
  try {
    lstatSync(sourceCandidate)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  assertNoSymlinkPath(workspaceRootCandidate, sourceCandidate)
  const source = realpathSync(sourceCandidate)
  if (!isWithinRoot(root, source) || source.startsWith(`${join(root, '.recovery-trash')}${sep}`)) {
    throw new Error('恢复隔离目标路径不安全')
  }
  assertRecoveryRootSafe(root)
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
  const workspaceRootCandidate = resolve(workspaceRoot)
  const root = realpathSync(workspaceRootCandidate)
  const sourceCandidate = resolve(sourcePath)
  assertNoSymlinkPath(workspaceRootCandidate, sourceCandidate)
  const source = realpathSync(sourceCandidate)
  if (!source.startsWith(`${root}${sep}`)) {
    throw new Error('恢复隔离目标路径不能包含符号链接')
  }
  if (source.startsWith(`${join(root, '.recovery-trash')}${sep}`)) {
    throw new Error('恢复隔离目标不能位于 recovery trash 内')
  }
  assertRecoveryRootSafe(root)

  const id = randomUUID()
  const recoveryRoot = join(root, '.recovery-trash')
  ensureRecoveryDirectory(recoveryRoot)
  const recoveryReal = realpathSync(recoveryRoot)
  if (!isWithinRoot(root, recoveryReal)) {
    throw new Error('恢复隔离区越出 Workspace 根目录')
  }
  const recoveryJournalIndex = join(recoveryReal, 'journal.jsonl')
  assertSafeJournalPath(recoveryJournalIndex)

  const operationRoot = join(recoveryReal, id)
  try {
    // 不使用 recursive mkdir：若随机 ID 恰好已被占用或被预先放入 symlink，直接失败。
    mkdirSync(operationRoot)
  } catch (error) {
    throw new Error('恢复操作目录创建失败，已保留源文件', { cause: error })
  }
  const operationReal = realpathSync(operationRoot)
  if (!isWithinRoot(root, operationReal) || !statSync(operationReal).isDirectory()) {
    throw new Error('恢复操作目录不在 Workspace 根目录内')
  }
  const sourceName = basename(source)
  // journal.json 是 operation journal 的保留名；改名后再搬入，避免源文件覆盖自身的恢复记录。
  const quarantineName = sourceName === 'journal.json' ? 'source-journal.json' : sourceName
  const safeQuarantinePath = join(operationReal, quarantineName)
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
  try {
    const root = realpathSync(resolve(workspaceRoot))
    const candidate = resolve(root, '.recovery-trash', id)
    if (!isWithinRoot(root, candidate)) return false
    const entry = lstatSync(candidate)
    if (entry.isSymbolicLink()) return false
    return isWithinRoot(root, realpathSync(candidate))
  } catch {
    return false
  }
}
