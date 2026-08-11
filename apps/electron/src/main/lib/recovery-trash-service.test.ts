import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { quarantineForRecovery, recoveryTrashPathExists } from './recovery-trash-service'

const roots: string[] = []

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
})

describe('recovery-trash-service', () => {
  test('moves a destructive target without deleting it and writes a recoverable journal', () => {
    const root = mkdtempSync(join(tmpdir(), 'myyoda-recovery-'))
    roots.push(root)
    const source = join(root, 'projects', 'alpha')
    rmSync(join(root, 'projects'), { recursive: true, force: true })
    mkdirSync(source, { recursive: true })
    writeFileSync(join(source, 'config.json'), '{}', 'utf-8')

    const record = quarantineForRecovery(root, source, 'project', 'alpha')

    expect(existsSync(source)).toBe(false)
    expect(existsSync(record.quarantinePath)).toBe(true)
    expect(recoveryTrashPathExists(root, record.id)).toBe(true)
    expect(JSON.parse(readFileSync(join(root, '.recovery-trash', record.id, 'journal.json'), 'utf-8'))).toMatchObject({
      status: 'quarantined',
      kind: 'project',
      target: 'alpha',
    })
    expect(readFileSync(join(root, '.recovery-trash', 'journal.jsonl'), 'utf-8')).toContain(record.id)
  })

  test('rejects a symlinked recovery root before moving anything', () => {
    const root = mkdtempSync(join(tmpdir(), 'myyoda-recovery-'))
    const outside = mkdtempSync(join(tmpdir(), 'myyoda-recovery-outside-'))
    roots.push(root, outside)
    const source = join(root, 'tasks', 'secret')
    mkdirSync(source, { recursive: true })
    symlinkSync(outside, join(root, '.recovery-trash'), 'dir')

    expect(() => quarantineForRecovery(root, source, 'task', 'secret')).toThrow('安全的本地目录')
    expect(existsSync(source)).toBe(true)
    expect(existsSync(join(outside, 'secret'))).toBe(false)
  })

  test('rejects a target outside the workspace before moving anything', () => {
    const root = mkdtempSync(join(tmpdir(), 'myyoda-recovery-'))
    const outside = mkdtempSync(join(tmpdir(), 'myyoda-recovery-outside-'))
    roots.push(root, outside)
    const source = join(outside, 'secret')
    mkdirSync(source, { recursive: true })

    expect(() => quarantineForRecovery(root, source, 'task', 'secret')).toThrow('Workspace 根目录内')
    expect(existsSync(source)).toBe(true)
  })
})
