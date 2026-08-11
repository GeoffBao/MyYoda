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
    expect(recoveryTrashPathExists(root, '../outside')).toBe(false)
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

  test('rejects a dangling recovery-root symlink before creating an escape path', () => {
    const root = mkdtempSync(join(tmpdir(), 'myyoda-recovery-'))
    const outside = join(tmpdir(), `myyoda-recovery-missing-${Date.now()}`)
    roots.push(root)
    const source = join(root, 'tasks', 'secret')
    mkdirSync(source, { recursive: true })
    symlinkSync(outside, join(root, '.recovery-trash'), 'dir')

    expect(() => quarantineForRecovery(root, source, 'task', 'secret')).toThrow('安全的本地目录')
    expect(existsSync(source)).toBe(true)
    expect(existsSync(outside)).toBe(false)
  })

  test('rejects a recovery journal index symlink before moving the source', () => {
    const root = mkdtempSync(join(tmpdir(), 'myyoda-recovery-'))
    const outside = mkdtempSync(join(tmpdir(), 'myyoda-recovery-outside-'))
    roots.push(root, outside)
    const source = join(root, 'tasks', 'secret')
    const recoveryRoot = join(root, '.recovery-trash')
    mkdirSync(source, { recursive: true })
    mkdirSync(recoveryRoot, { recursive: true })
    symlinkSync(join(outside, 'journal.jsonl'), join(recoveryRoot, 'journal.jsonl'), 'file')

    expect(() => quarantineForRecovery(root, source, 'task', 'secret')).toThrow('journal')
    expect(existsSync(source)).toBe(true)
    expect(existsSync(join(outside, 'journal.jsonl'))).toBe(false)
  })

  test('preserves a source named journal.json without overwriting its payload journal', () => {
    const root = mkdtempSync(join(tmpdir(), 'myyoda-recovery-'))
    roots.push(root)
    const source = join(root, 'tasks', 'journal.json')
    mkdirSync(join(root, 'tasks'), { recursive: true })
    writeFileSync(source, '{"payload":true}\n', 'utf-8')

    const record = quarantineForRecovery(root, source, 'task', 'journal')

    expect(record.quarantinePath.endsWith('/journal.json')).toBe(false)
    expect(readFileSync(record.quarantinePath, 'utf-8')).toContain('payload')
    expect(JSON.parse(readFileSync(join(root, '.recovery-trash', record.id, 'journal.json'), 'utf-8'))).toMatchObject({
      status: 'quarantined',
      sourcePath: record.sourcePath,
    })
  })

  test('rejects a symlinked source path before moving the real target', () => {
    const root = mkdtempSync(join(tmpdir(), 'myyoda-recovery-'))
    roots.push(root)
    const realSource = join(root, 'tasks', 'real')
    mkdirSync(realSource, { recursive: true })
    const symlinkSource = join(root, 'tasks', 'alias')
    symlinkSync(realSource, symlinkSource, 'dir')

    expect(() => quarantineForRecovery(root, symlinkSource, 'task', 'alias')).toThrow('符号链接')
    expect(existsSync(realSource)).toBe(true)
    expect(existsSync(symlinkSource)).toBe(true)
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
