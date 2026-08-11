import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveSafeChildPath } from './agent-file-path-policy'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'myyoda-file-policy-'))
  tempDirs.push(root)
  mkdirSync(join(root, 'nested'), { recursive: true })
  return root
}

describe('safe file path policy', () => {
  test('Given a nested relative filename When resolving Then stays under the root', () => {
    const root = createRoot()

    expect(resolveSafeChildPath(root, 'nested/report.md')).toBe(join(realpathSync(root), 'nested/report.md'))
  })

  test('Given traversal or absolute filenames When resolving Then rejects them', () => {
    const root = createRoot()

    for (const filename of ['../escape.txt', '../../escape.txt', '/tmp/escape.txt', 'C:\\tmp\\escape.txt', '\\tmp\\escape.txt']) {
      expect(() => resolveSafeChildPath(root, filename)).toThrow()
    }
  })

  test('Given a not-yet-created root When resolving Then preserves the requested root', () => {
    const parent = mkdtempSync(join(tmpdir(), 'myyoda-file-policy-parent-'))
    tempDirs.push(parent)
    const root = join(parent, 'new-root')

    expect(resolveSafeChildPath(root, 'report.md')).toBe(join(root, 'report.md'))
  })

  test('Given a symlinked parent outside the root When resolving Then rejects the escape', () => {
    const root = createRoot()
    const outside = mkdtempSync(join(tmpdir(), 'myyoda-file-policy-outside-'))
    tempDirs.push(outside)
    symlinkSync(outside, join(root, 'linked'))

    expect(() => resolveSafeChildPath(root, 'linked/escape.txt')).toThrow()
  })

  test('Given an existing symlink target outside the root When resolving Then rejects the target', () => {
    const root = createRoot()
    const outside = join(tmpdir(), `myyoda-file-policy-target-${Date.now()}.txt`)
    writeFileSync(outside, 'outside', 'utf8')
    symlinkSync(outside, join(root, 'linked.txt'))

    try {
      expect(() => resolveSafeChildPath(root, 'linked.txt')).toThrow()
    } finally {
      rmSync(outside, { force: true })
    }
  })

  test('Given a root with a similar prefix When resolving Then does not confuse the roots', () => {
    const root = createRoot()
    const sibling = `${root}-sibling`
    mkdirSync(sibling, { recursive: true })
    tempDirs.push(sibling)

    expect(() => resolveSafeChildPath(root, '../' + sibling.split('/').pop() + '/escape.txt')).toThrow()
  })
})
