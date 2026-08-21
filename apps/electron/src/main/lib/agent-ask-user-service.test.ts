import { describe, expect, test } from 'bun:test'
import { AgentAskUserService } from './agent-ask-user-service'

describe('AgentAskUserService 生命周期', () => {
  test('clearAllPending 会拒绝并释放所有会话的挂起请求', async () => {
    const service = new AgentAskUserService()
    const first = service.handleAskUserQuestion(
      'session-a',
      { questions: [] },
      new AbortController().signal,
      () => {},
    )
    const second = service.handleAskUserQuestion(
      'session-b',
      { questions: [] },
      new AbortController().signal,
      () => {},
    )

    service.clearAllPending()

    await expect(first).resolves.toEqual({ behavior: 'deny', message: '应用正在退出' })
    await expect(second).resolves.toEqual({ behavior: 'deny', message: '应用正在退出' })
    expect(service.getPendingRequests()).toEqual([])
  })
})
