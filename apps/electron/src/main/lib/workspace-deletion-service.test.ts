import { describe, expect, test } from 'bun:test'
import { deleteWorkspaceCascade, type WorkspaceDeletionDependencies } from './workspace-deletion-service'

function createDependencies(overrides: Partial<WorkspaceDeletionDependencies> = {}) {
  const calls: string[] = []
  const dependencies: WorkspaceDeletionDependencies = {
    getWorkspace: () => ({ id: 'ws-1', slug: 'client' }),
    listWorkspaces: () => [{ id: 'default', slug: 'default' }, { id: 'ws-1', slug: 'client' }],
    listSessions: () => [
      { id: 'session-active', workspaceId: 'ws-1' },
      { id: 'session-idle', workspaceId: 'ws-1' },
      { id: 'other-session', workspaceId: 'default' },
    ],
    listAutomations: () => [
      { id: 'automation-1', workspaceId: 'ws-1' },
      { id: 'other-automation', workspaceId: 'default' },
    ],
    isSessionActive: (id) => id === 'session-active',
    assertSessionDeletionSafe: () => undefined,
    assertWorkspaceDeletionSafe: () => undefined,
    stopSession: (id) => calls.push(`stop:${id}`),
    deleteSession: (id) => calls.push(`delete-session:${id}`),
    deleteAutomation: (id) => calls.push(`delete-automation:${id}`),
    broadcastAutomationsChanged: () => calls.push('broadcast-automations'),
    deleteWorkspace: (id) => calls.push(`delete-workspace:${id}`),
    ...overrides,
  }
  return { calls, dependencies }
}

describe('deleteWorkspaceCascade', () => {
  test('先守卫默认/最后工作区，不产生任何级联副作用', () => {
    const defaultCase = createDependencies({
      getWorkspace: () => ({ id: 'default', slug: 'default' }),
    })
    expect(() => deleteWorkspaceCascade('default', defaultCase.dependencies)).toThrow('默认工作区不能删除')
    expect(defaultCase.calls).toEqual([])

    const lastCase = createDependencies({
      listWorkspaces: () => [{ id: 'ws-1', slug: 'client' }],
    })
    expect(() => deleteWorkspaceCascade('ws-1', lastCase.dependencies)).toThrow('至少需要保留一个工作区')
    expect(lastCase.calls).toEqual([])
  })

  test('工作区预检查失败时不产生任何级联副作用', () => {
    const { calls, dependencies } = createDependencies({
      assertWorkspaceDeletionSafe: () => {
        throw new Error('recovery root unavailable')
      },
    })

    expect(() => deleteWorkspaceCascade('ws-1', dependencies)).toThrow('recovery root unavailable')
    expect(calls).toEqual([])
  })

  test('所有会话预检查通过后才执行停止、删除等级联副作用', () => {
    const { calls, dependencies } = createDependencies({
      assertSessionDeletionSafe: (id) => {
        if (id === 'session-idle') throw new Error('dirty worktree')
      },
    })

    expect(() => deleteWorkspaceCascade('ws-1', dependencies)).toThrow('dirty worktree')
    expect(calls).toEqual([])
  })

  test('停止活动会话、删除会话与自动任务，最后删除工作区', () => {
    const { calls, dependencies } = createDependencies()

    deleteWorkspaceCascade('ws-1', dependencies)

    expect(calls).toEqual([
      'stop:session-active',
      'delete-session:session-active',
      'delete-session:session-idle',
      'delete-automation:automation-1',
      'broadcast-automations',
      'delete-workspace:ws-1',
    ])
  })

  test('工作区索引已缺失时沿用底层删除错误，不误删其他资源', () => {
    const { calls, dependencies } = createDependencies({ getWorkspace: () => undefined })

    deleteWorkspaceCascade('missing', dependencies)

    expect(calls).toEqual(['delete-workspace:missing'])
  })
})
