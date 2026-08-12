import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mockElectronModule } from './__tests__/electron-mock'

mockElectronModule({
  net: {
    fetch: async () => new Response('ok'),
  },
})

const { handleMyYodaFileRequest, registerMyYodaDirectoryPath } = await import('./local-file-protocol')
const roots: string[] = []

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
})

describe('local-file-protocol directory allowlist', () => {
  test('denies sibling files and traversal when a preview token has an allowlist', async () => {
    const root = mkdtempSync(join(tmpdir(), 'myyoda-file-protocol-'))
    roots.push(root)
    mkdirSync(join(root, 'assets'), { recursive: true })
    writeFileSync(join(root, 'index.html'), '<p>preview</p>', 'utf-8')
    writeFileSync(join(root, 'assets', 'style.css'), 'body{}', 'utf-8')
    writeFileSync(join(root, 'secret.txt'), 'do not expose', 'utf-8')

    const baseUrl = registerMyYodaDirectoryPath(root, ['index.html', 'assets/style.css'])
    const sibling = await handleMyYodaFileRequest(new Request(`${baseUrl}/secret.txt`))
    const traversal = await handleMyYodaFileRequest(new Request(`${baseUrl}/assets/../secret.txt`))

    expect(sibling.status).toBe(403)
    expect(traversal.status).toBe(403)
  })
})
