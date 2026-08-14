import { describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildOutputCaptureRoots, diffOutputSnapshots, snapshotOutputFiles } from './agent-output-capture'

const tempRoot = '/tmp/myyoda-agent-output-capture-test'

function reset(): void {
  rmSync(tempRoot, { recursive: true, force: true })
  mkdirSync(tempRoot, { recursive: true })
}

describe('Agent turn output capture', () => {
  test('captures new and modified files while excluding generated dependency trees', () => {
    reset()
    const project = join(tempRoot, 'project')
    mkdirSync(join(project, 'docs'), { recursive: true })
    mkdirSync(join(project, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(project, 'docs', 'before.md'), 'before')
    writeFileSync(join(project, 'node_modules', 'pkg', 'index.js'), 'ignored')

    const before = snapshotOutputFiles([{ root: project, scope: 'project' }])
    writeFileSync(join(project, 'docs', 'before.md'), 'after')
    writeFileSync(join(project, 'docs', 'new.md'), 'new')
    writeFileSync(join(project, 'node_modules', 'pkg', 'new.js'), 'ignored')
    utimesSync(join(project, 'docs', 'before.md'), new Date(), new Date(Date.now() + 1000))

    const after = snapshotOutputFiles([{ root: project, scope: 'project' }])
    const changes = diffOutputSnapshots(before, after)

    expect(changes.map((item) => item.relativePath).sort()).toEqual(['docs/before.md', 'docs/new.md'])
    expect(changes.every((item) => !item.path.includes('node_modules'))).toBe(true)
  })

  test('deduplicates overlapping roots and does not fail for missing roots', () => {
    reset()
    const outbox = join(tempRoot, 'session-outputs', 'session-1')
    mkdirSync(outbox, { recursive: true })
    writeFileSync(join(outbox, 'report.md'), 'report')

    const snapshot = snapshotOutputFiles([
      { root: outbox, scope: 'session' },
      { root: outbox, scope: 'session' },
      { root: join(tempRoot, 'missing'), scope: 'project' },
    ])

    expect(snapshot.size).toBe(1)
    expect([...snapshot.values()][0]?.relativePath).toBe('report.md')
  })

  test('captures files created in project assets directory', () => {
    reset()
    const assets = join(tempRoot, 'assets')
    mkdirSync(assets, { recursive: true })

    const roots = {
      sessionDir: join(tempRoot, 'session-1'),
      executionCwd: join(tempRoot, 'session-1'),
      executionSource: 'project' as const,
      projectRoot: join(tempRoot, 'project'),
      projectId: 'project-1',
      projectAssetsPath: assets,
      workspaceFilesPath: join(tempRoot, 'workspace-files'),
      sessionOutboxPath: join(tempRoot, 'workspace-files', 'Outbox', 'session-1'),
    }
    const before = snapshotOutputFiles(buildOutputCaptureRoots(roots))
    writeFileSync(join(assets, 'still.jpg'), 'image')
    writeFileSync(join(assets, 'photo.webp'), 'webp')

    const after = snapshotOutputFiles(buildOutputCaptureRoots(roots))
    const changes = diffOutputSnapshots(before, after)

    expect(changes.map((item) => item.relativePath).sort()).toEqual(['photo.webp', 'still.jpg'])
    expect(changes.every((item) => item.scope === 'project')).toBe(true)
  })

  test('buildOutputCaptureRoots includes assets root only when present', () => {
    const base = {
      sessionDir: '/ws/s-1',
      executionCwd: '/ws/s-1',
      executionSource: 'sandbox' as const,
      workspaceFilesPath: '/ws/workspace-files',
    }
    expect(buildOutputCaptureRoots(base)).toHaveLength(1)

    const withAssets = { ...base, projectRoot: '/ws/p', projectId: 'p1', projectAssetsPath: '/ws/p/assets' }
    const roots = buildOutputCaptureRoots(withAssets)
    expect(roots.map((r) => r.root).sort()).toEqual(['/ws/p', '/ws/p/assets', '/ws/s-1'])
  })
})
