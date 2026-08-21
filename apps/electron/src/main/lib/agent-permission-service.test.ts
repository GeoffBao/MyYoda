import { describe, expect, test } from 'bun:test'
import { AgentPermissionService } from './agent-permission-service'

describe('AgentPermissionService 生命周期', () => {
  test('clearAllPending 会拒绝并释放所有会话的挂起权限请求', async () => {
    const service = new AgentPermissionService()
    const signal = new AbortController().signal
    const first = service.requestSingleApproval(
      'session-a',
      'Bash',
      { command: 'rm -rf /' },
      { signal, toolUseID: 'tool-a' },
      () => {},
    )
    const second = service.requestSingleApproval(
      'session-b',
      'Write',
      { file_path: '/tmp/x' },
      { signal, toolUseID: 'tool-b' },
      () => {},
    )

    service.clearAllPending()

    await expect(first).resolves.toEqual({ behavior: 'deny', message: '应用正在退出' })
    await expect(second).resolves.toEqual({ behavior: 'deny', message: '应用正在退出' })
    expect(service.getPendingRequests()).toEqual([])
  })
})
