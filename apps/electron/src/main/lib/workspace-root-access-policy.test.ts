import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveRegisteredWorkspaceRoot } from './workspace-root-access-policy'

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function createWorkspace(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `myyoda-${name}-`))
  tempRoots.push(root)
  return root
}

describe('registered workspace root policy', () => {
  test('Given a registered workspace root When resolving Then returns its canonical workspace context', () => {
    const root = createWorkspace('workspace')

    expect(resolveRegisteredWorkspaceRoot(root, [{ id: 'workspace-1', root }])).toEqual({
      workspaceId: 'workspace-1',
      workspaceRoot: realpathSync(root),
    })
  })

  test('Given an unregistered root or a similar-prefix sibling When resolving Then rejects it', () => {
    const root = createWorkspace('workspace')
    const sibling = `${root}-sibling`
    mkdirSync(sibling)
    tempRoots.push(sibling)

    expect(resolveRegisteredWorkspaceRoot(sibling, [{ id: 'workspace-1', root }])).toBeNull()
    expect(resolveRegisteredWorkspaceRoot(join(root, '..'), [{ id: 'workspace-1', root }])).toBeNull()
  })

  test('Given a path through a symlink to a registered root When resolving Then accepts only the same canonical root', () => {
    const root = createWorkspace('workspace')
    const parent = createWorkspace('parent')
    const linked = join(parent, 'linked')
    // macOS/Linux test environment: the policy must compare canonical roots, not strings.
    symlinkSync(root, linked)
    tempRoots.push(parent)

    expect(resolveRegisteredWorkspaceRoot(linked, [{ id: 'workspace-1', root }])).toEqual({
      workspaceId: 'workspace-1',
      workspaceRoot: realpathSync(root),
    })
  })
})
