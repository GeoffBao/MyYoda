import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assessOrphanCleanupIndex } from './storage-cleanup-policy'

const tempDirs: string[] = []

function createFixture(indexContent?: string, backupContent?: string, dataEntries: string[] = ['orphan.jsonl']): {
  indexPath: string
  dataDir: string
} {
  const root = mkdtempSync(join(tmpdir(), 'myyoda-storage-cleanup-'))
  tempDirs.push(root)
  const indexPath = join(root, 'index.json')
  const dataDir = join(root, 'data')
  mkdirSync(dataDir, { recursive: true })
  for (const entry of dataEntries) writeFileSync(join(dataDir, entry), 'data', 'utf8')
  if (indexContent !== undefined) writeFileSync(indexPath, indexContent, 'utf8')
  if (backupContent !== undefined) writeFileSync(`${indexPath}.bak`, backupContent, 'utf8')
  return { indexPath, dataDir }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('orphan cleanup index safety', () => {
  test('Given non-empty data and a missing index When checking cleanup safety Then fails closed', () => {
    const fixture = createFixture()

    expect(assessOrphanCleanupIndex(fixture.indexPath, fixture.dataDir, 'sessions')).toEqual({
      safe: false,
      reason: 'index_missing',
    })
  })

  test('Given non-empty data and a malformed index When checking cleanup safety Then fails closed', () => {
    const fixture = createFixture('{ broken')

    expect(assessOrphanCleanupIndex(fixture.indexPath, fixture.dataDir, 'sessions')).toEqual({
      safe: false,
      reason: 'index_unreadable',
    })
  })

  test('Given a valid backup index When checking cleanup safety Then accepts the recoverable index', () => {
    const fixture = createFixture('{ broken', JSON.stringify({ version: 1, sessions: [{ id: 'known-session' }] }))

    expect(assessOrphanCleanupIndex(fixture.indexPath, fixture.dataDir, 'sessions')).toEqual({ safe: true })
  })

  test('Given non-empty data and an empty index array When checking cleanup safety Then fails closed', () => {
    const fixture = createFixture(JSON.stringify({ version: 1, sessions: [] }))

    expect(assessOrphanCleanupIndex(fixture.indexPath, fixture.dataDir, 'sessions')).toEqual({
      safe: false,
      reason: 'index_invalid',
    })
  })

  test('Given an empty data directory When the index is missing Then cleanup remains safe', () => {
    const fixture = createFixture(undefined, undefined, [])

    expect(assessOrphanCleanupIndex(fixture.indexPath, fixture.dataDir, 'workspaces')).toEqual({ safe: true })
  })

  test('Given valid JSON with the wrong index shape When checking cleanup safety Then fails closed', () => {
    const fixture = createFixture(JSON.stringify({ version: 1, items: [] }))

    expect(assessOrphanCleanupIndex(fixture.indexPath, fixture.dataDir, 'workspaces')).toEqual({
      safe: false,
      reason: 'index_invalid',
    })
  })
})
