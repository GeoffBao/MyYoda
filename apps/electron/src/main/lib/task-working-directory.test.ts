import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import {
  resolveTaskWorkingDirectory,
  type TaskWorkingDirectoryFs,
} from './task-working-directory'

const R = (p: string) => resolve(p)

function fakeFs(paths: Record<string, { directory?: boolean; writable?: boolean; realpath?: string }>): TaskWorkingDirectoryFs {
  return {
    exists: (path) => path in paths,
    isDirectory: (path) => paths[path]?.directory ?? false,
    canReadWrite: (path) => paths[path]?.writable ?? false,
    realpath: (path) => paths[path]?.realpath ?? path,
  }
}

describe('resolveTaskWorkingDirectory', () => {
  test('显式 cwd 优先并返回规范化来源', () => {
    const result = resolveTaskWorkingDirectory({
      explicitCwd: '/task-link',
      projectId: 'project-a',
      workspaceDefaultCwd: '/workspace',
      resolveProjectCwd: () => ({ status: 'resolved', cwd: R('/project') }),
      fs: fakeFs({
        [R('/task-link')]: { directory: true, writable: true, realpath: '/task-real' },
        [R('/task-real')]: { directory: true, writable: true },
      }),
    })

    expect(result).toEqual({ status: 'resolved', cwd: '/task-real', source: 'task' })
  })

  test('显式 cwd 失效时阻止运行，不静默回退 Project 或 Workspace', () => {
    const result = resolveTaskWorkingDirectory({
      explicitCwd: '/missing-task',
      projectId: 'project-a',
      workspaceDefaultCwd: '/workspace',
      resolveProjectCwd: () => ({ status: 'resolved', cwd: R('/project') }),
      fs: fakeFs({
        [R('/project')]: { directory: true, writable: true },
        [R('/workspace')]: { directory: true, writable: true },
      }),
    })

    expect(result).toEqual({
      status: 'blocked',
      reason: 'invalid-task-cwd',
      attemptedPath: '/missing-task',
    })
  })

  test('Project Task 使用有效 Project cwd，优先于 Workspace default', () => {
    const result = resolveTaskWorkingDirectory({
      projectId: 'project-a',
      workspaceDefaultCwd: '/workspace',
      resolveProjectCwd: () => ({ status: 'resolved', cwd: R('/project') }),
      fs: fakeFs({
        [R('/project')]: { directory: true, writable: true },
        [R('/workspace')]: { directory: true, writable: true },
      }),
    })

    expect(result).toEqual({ status: 'resolved', cwd: R('/project'), source: 'project' })
  })

  test('Project 缺失或 cwd 不可用时阻止运行，不降级到 Workspace default', () => {
    const missingProject = resolveTaskWorkingDirectory({
      projectId: 'missing-project',
      workspaceDefaultCwd: '/workspace',
      resolveProjectCwd: () => null,
      fs: fakeFs({ [R('/workspace')]: { directory: true, writable: true } }),
    })
    const unavailableProject = resolveTaskWorkingDirectory({
      projectId: 'project-a',
      workspaceDefaultCwd: '/workspace',
      resolveProjectCwd: () => ({ status: 'unavailable', attemptedPath: '/missing-project' }),
      fs: fakeFs({ [R('/workspace')]: { directory: true, writable: true } }),
    })

    expect(missingProject).toEqual({ status: 'blocked', reason: 'missing-project' })
    expect(unavailableProject).toEqual({
      status: 'blocked',
      reason: 'invalid-project-cwd',
      attemptedPath: '/missing-project',
    })
  })

  test('Workspace Task 回退 Workspace default cwd', () => {
    const result = resolveTaskWorkingDirectory({
      workspaceDefaultCwd: '/workspace',
      fs: fakeFs({ [R('/workspace')]: { directory: true, writable: true } }),
    })

    expect(result).toEqual({ status: 'resolved', cwd: R('/workspace'), source: 'workspace' })
  })

  test('无任何 cwd 时返回 blocked:missing-cwd', () => {
    expect(resolveTaskWorkingDirectory({ fs: fakeFs({}) })).toEqual({
      status: 'blocked',
      reason: 'missing-cwd',
    })
  })

  test('目录无读写权限时按来源返回不可运行原因', () => {
    expect(resolveTaskWorkingDirectory({
      workspaceDefaultCwd: '/readonly',
      fs: fakeFs({ [R('/readonly')]: { directory: true, writable: false } }),
    })).toEqual({
      status: 'blocked',
      reason: 'invalid-workspace-cwd',
      attemptedPath: '/readonly',
    })
  })
})
