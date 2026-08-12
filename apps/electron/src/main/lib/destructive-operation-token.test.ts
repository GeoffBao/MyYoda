import { describe, expect, test } from 'bun:test'
import { consumeDestructiveOperationToken, issueDestructiveOperationToken } from './destructive-operation-token'

describe('destructive operation confirmation token', () => {
  test('一次性 token 绑定操作、目标和当前影响快照', () => {
    const token = issueDestructiveOperationToken('task-purge', 'workspace/task', 'fingerprint', 1000)

    expect(consumeDestructiveOperationToken(token, 'task-purge', 'workspace/task', 'fingerprint', 1001)).toBe(true)
    expect(consumeDestructiveOperationToken(token, 'task-purge', 'workspace/task', 'fingerprint', 1002)).toBe(false)
    expect(consumeDestructiveOperationToken(
      issueDestructiveOperationToken('task-purge', 'workspace/task', 'fingerprint-a', 1000),
      'task-purge',
      'workspace/task',
      'fingerprint-b',
      1001,
    )).toBe(false)
  })

  test('过期 token 不能授权删除', () => {
    const token = issueDestructiveOperationToken('project-purge', 'workspace/project', 'fingerprint', 1000)
    expect(consumeDestructiveOperationToken(token, 'project-purge', 'workspace/project', 'fingerprint', 301_001)).toBe(false)
  })
})
