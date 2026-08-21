import { describe, expect, test } from 'bun:test'
import { AgentExitPlanService } from './agent-exit-plan-service'

describe('AgentExitPlanService 生命周期', () => {
  test('clearAllPending 会拒绝并释放所有会话的挂起计划审批', async () => {
    const service = new AgentExitPlanService()
    const signal = new AbortController().signal
    const first = service.handleExitPlanMode('session-a', {}, signal, () => {})
    const second = service.handleExitPlanMode('session-b', {}, signal, () => {})

    service.clearAllPending()

    await expect(first).resolves.toEqual({ behavior: 'deny', message: '应用正在退出' })
    await expect(second).resolves.toEqual({ behavior: 'deny', message: '应用正在退出' })
    expect(service.getPendingRequests()).toEqual([])
  })
})
