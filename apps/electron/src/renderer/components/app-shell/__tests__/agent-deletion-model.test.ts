import { describe, expect, test } from 'bun:test'
import { deleteAgentSessionChildren, shouldDeleteAgentParent } from '../agent-deletion-model'

describe('agent deletion model', () => {
  test('级联删除只返回实际成功的子会话，失败项保留给 UI 刷新', async () => {
    const calls: string[] = []

    const result = await deleteAgentSessionChildren(
      ['child-a', 'child-b', 'child-c'],
      async (sessionId) => {
        calls.push(sessionId)
        if (sessionId === 'child-b') throw new Error('dirty worktree')
      },
    )

    expect(calls).toEqual(['child-a', 'child-b', 'child-c'])
    expect(result.deletedChildIds).toEqual(['child-a', 'child-c'])
    expect(result.failedChildIds).toEqual(['child-b'])
    expect(shouldDeleteAgentParent(result)).toBe(false)
    expect(shouldDeleteAgentParent({ deletedChildIds: ['child-a'], failedChildIds: [] })).toBe(true)
  })
})
