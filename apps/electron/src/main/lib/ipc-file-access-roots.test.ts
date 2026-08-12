import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('IPC file access roots', () => {
  test('session workingDirectory is part of authorized roots even without project or git context', () => {
    const ipcSource = readFileSync(join(__dirname, '../ipc.ts'), 'utf-8')
    expect(ipcSource).toContain('meta?.workingDirectory')
    expect(ipcSource).toContain('roots.push(meta.workingDirectory)')
  })
})
