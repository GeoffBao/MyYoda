import { describe, expect, test } from 'bun:test'
import type { WebContents } from 'electron'
import type {
  AgentDeferredQueueMessageInput,
  AgentMoveQueuedMessageInput,
  AgentQueuedMessageStatus,
} from '@myyoda/shared'
import { AgentQueueCoordinator, type AgentQueueCoordinatorOptions } from './agent-queue-coordinator'

/** 构造测试用队列输入 */
function makeInput(sessionId: string, messageId: string): AgentDeferredQueueMessageInput {
  return {
    queueMessageId: messageId,
    sessionId,
    userMessage: `message-${messageId}`,
    rawUserMessage: `raw-${messageId}`,
    channelId: 'channel-1',
    displaySnapshot: {
      id: messageId,
      text: `raw-${messageId}`,
      createdAt: Date.now(),
    },
  }
}

/** 最小 webContents 替身 */
function makeWebContents(): WebContents {
  return { isDestroyed: () => false } as unknown as WebContents
}

/** 组装协调器实例，收集派发行为 */
function makeCoordinator(overrides: Partial<AgentQueueCoordinatorOptions> = {}) {
  const startCalls: Array<{ input: AgentDeferredQueueMessageInput; wc: WebContents }> = []
  const statusCalls: Array<{ wc: WebContents; status: AgentQueuedMessageStatus }> = []
  const coordinator = new AgentQueueCoordinator({
    isActive: () => false,
    getWebContents: () => makeWebContents(),
    startRun: async (input, wc) => { startCalls.push({ input, wc }) },
    sendStatus: (wc, status) => { statusCalls.push({ wc, status }) },
    canDispatch: () => true,
    ...overrides,
  })
  return { coordinator, startCalls, statusCalls }
}

describe('AgentQueueCoordinator（排队消息主进程调度）', () => {
  test('Given 会话空闲 When 入队 Then 立即派发并推送 started 状态', () => {
    const { coordinator, startCalls, statusCalls } = makeCoordinator()
    const input = makeInput('s1', 'm1')

    coordinator.enqueue(input)

    expect(startCalls).toHaveLength(1)
    expect(startCalls[0]?.input.queueMessageId).toBe('m1')
    expect(typeof startCalls[0]?.input.startedAt).toBe('number')
    expect(statusCalls).toHaveLength(1)
    expect(statusCalls[0]?.status).toMatchObject({ sessionId: 's1', messageId: 'm1', status: 'started' })
  })

  test('Given 会话运行中 When 入队 Then 不派发，run 完成后自动派发', async () => {
    let active = true
    const { coordinator, startCalls } = makeCoordinator({ isActive: () => active })

    coordinator.enqueue(makeInput('s1', 'm1'))
    expect(startCalls).toHaveLength(0)

    active = false
    coordinator.onRunComplete('s1', undefined, false, false)
    expect(startCalls).toHaveLength(1)
    expect(startCalls[0]?.input.queueMessageId).toBe('m1')
  })

  test('Given 安全检查未通过（canDispatch=false）When run 完成 Then 保持队列不派发', () => {
    const { coordinator, startCalls } = makeCoordinator({ canDispatch: () => false })
    coordinator.enqueue(makeInput('s1', 'm1'))
    coordinator.enqueue(makeInput('s1', 'm2'))
    expect(startCalls).toHaveLength(0)

    coordinator.onRunComplete('s1', undefined, false, false)
    expect(startCalls).toHaveLength(0)
  })

  test('Given run 完成但后台任务待续（backgroundTasksPending）When task_notification 到达 Then 唤醒派发', () => {
    let active = true
    const { coordinator, startCalls } = makeCoordinator({ isActive: () => active })
    coordinator.enqueue(makeInput('s1', 'm1'))
    expect(startCalls).toHaveLength(0)

    // 第一段完成：后台任务还在飞，保持等待
    coordinator.onRunComplete('s1', undefined, true, false)
    active = false
    expect(startCalls).toHaveLength(0)

    // 后台任务完成：唤醒
    coordinator.onBackgroundTaskComplete('s1')
    expect(startCalls).toHaveLength(1)
  })

  test('Given 用户手动停止（stoppedByUser）When run 完成 Then 不自动续发', () => {
    let active = true
    const { coordinator, startCalls } = makeCoordinator({ isActive: () => active })
    coordinator.enqueue(makeInput('s1', 'm1'))
    expect(startCalls).toHaveLength(0)

    active = false
    coordinator.onRunComplete('s1', undefined, false, true)
    expect(startCalls).toHaveLength(0)
  })

  test('Given 派发失败 When onRunFailed Then 放回队首并抑制自动重试，直到用户调整队列', () => {
    const { coordinator, startCalls, statusCalls } = makeCoordinator()
    coordinator.enqueue(makeInput('s1', 'm1'))
    coordinator.enqueue(makeInput('s1', 'm2'))
    expect(startCalls).toHaveLength(1)
    expect(startCalls[0]?.input.queueMessageId).toBe('m1')

    // m1 派发后失败
    coordinator.onRunFailed('s1', 'm1')
    const failedStatus = statusCalls.find((call) => call.status.status === 'failed')
    expect(failedStatus?.status.messageId).toBe('m1')

    // 队首回到 m1 且被抑制：任何触发都不重试
    coordinator.onRunComplete('s1', undefined, false, false)
    coordinator.onBackgroundTaskComplete('s1')
    coordinator.pokeAll()
    expect(startCalls).toHaveLength(1)

    // 用户把 m2 移到队首：抑制解除，派发 m2
    const moveInput: AgentMoveQueuedMessageInput = { sessionId: 's1', sourceId: 'm2', targetId: 'm1', placement: 'before' }
    coordinator.move(moveInput)
    expect(startCalls).toHaveLength(2)
    expect(startCalls[1]?.input.queueMessageId).toBe('m2')
  })

  test('Given webContents 已销毁 When 派发 Then 消息放回队列且不启动 run', () => {
    const { coordinator, startCalls } = makeCoordinator({
      getWebContents: () => ({ isDestroyed: () => true }) as unknown as WebContents,
    })
    coordinator.enqueue(makeInput('s1', 'm1'))
    expect(startCalls).toHaveLength(0)

    // 恢复 webContents 后重新触发（poke）→ 正常派发
    coordinator.pokeAll()
    expect(startCalls).toHaveLength(0)
  })

  test('Given 重复入队相同消息 When enqueue Then 去重不重复派发', () => {
    const { coordinator, startCalls } = makeCoordinator()
    const input = makeInput('s1', 'm1')
    coordinator.enqueue(input)
    coordinator.enqueue(input)
    expect(startCalls).toHaveLength(1)
  })

  test('Given cancel/move/clear 操作 When 生效 Then 同步维护主进程队列', () => {
    let active = true
    const { coordinator, startCalls } = makeCoordinator({ isActive: () => active })
    coordinator.enqueue(makeInput('s1', 'm1'))
    coordinator.enqueue(makeInput('s1', 'm2'))
    coordinator.enqueue(makeInput('s1', 'm3'))
    expect(startCalls).toHaveLength(0)

    // 取消 m2
    expect(coordinator.cancel({ sessionId: 's1', messageId: 'm2' })).toBe(true)
    expect(coordinator.cancel({ sessionId: 's1', messageId: 'm2' })).toBe(false)

    // m3 移到 m1 前
    expect(coordinator.move({ sessionId: 's1', sourceId: 'm3', targetId: 'm1', placement: 'before' })).toBe(true)

    active = false
    coordinator.onRunComplete('s1', undefined, false, false)
    expect(startCalls.map((call) => call.input.queueMessageId)).toEqual(['m3'])

    // m3 的 run 完成后，继续派发 m1
    coordinator.onRunComplete('s1', 'm3', false, false)
    expect(startCalls.map((call) => call.input.queueMessageId)).toEqual(['m3', 'm1'])

    coordinator.clear('s1')
    coordinator.onRunComplete('s1', 'm1', false, false)
    expect(startCalls).toHaveLength(2)
  })

  test('Given 同一会话顺序派发 When 前一条完成 Then 自动派发下一条', () => {
    let active = true
    const { coordinator, startCalls } = makeCoordinator({ isActive: () => active })
    coordinator.enqueue(makeInput('s1', 'm1'))
    coordinator.enqueue(makeInput('s1', 'm2'))
    expect(startCalls).toHaveLength(0)

    active = false
    // 第一段 run 完成（queueMessageId 匹配当前派发中的 m1）
    coordinator.onRunComplete('s1', 'm1', false, false)
    expect(startCalls).toHaveLength(1)
    expect(startCalls[0]?.input.queueMessageId).toBe('m1')

    // m1 的 run 真正结束后再次派发 m2
    coordinator.onRunComplete('s1', 'm1', false, false)
    expect(startCalls).toHaveLength(2)
    expect(startCalls[1]?.input.queueMessageId).toBe('m2')
  })

  test('Given 展示投影随入队暂存 When listSnapshots Then 按队列顺序返回未派发消息（供 renderer 重载重建 UI）', () => {
    let active = true
    const { coordinator } = makeCoordinator({ isActive: () => active })
    coordinator.enqueue(makeInput('s1', 'm1'))
    coordinator.enqueue(makeInput('s1', 'm2'))

    expect(coordinator.listSnapshots('s1').map((snapshot) => snapshot.id)).toEqual(['m1', 'm2'])
    expect(coordinator.listSnapshots('unknown')).toEqual([])

    // 派发中的消息不再出现在快照里（renderer 拉取时不会把已 started 的消息加回队列）
    active = false
    coordinator.onRunComplete('s1', undefined, false, false)
    expect(coordinator.listSnapshots('s1').map((snapshot) => snapshot.id)).toEqual(['m2'])

    // 取消后不再返回
    coordinator.cancel({ sessionId: 's1', messageId: 'm2' })
    expect(coordinator.listSnapshots('s1')).toEqual([])
  })

  test('Given 派发失败放回队首 When listSnapshots Then 快照包含失败消息的展示投影', () => {
    const { coordinator } = makeCoordinator()
    coordinator.enqueue(makeInput('s1', 'm1'))
    coordinator.onRunFailed('s1', 'm1')

    const snapshots = coordinator.listSnapshots('s1')
    expect(snapshots.map((snapshot) => snapshot.id)).toEqual(['m1'])
    expect(snapshots[0]?.text).toBe('raw-m1')
  })

  test('Given 入队时未带展示投影 When listSnapshots Then 过滤该条目不返回', () => {
    let active = true
    const { coordinator } = makeCoordinator({ isActive: () => active })
    const withoutSnapshot = { ...makeInput('s1', 'm1') }
    delete withoutSnapshot.displaySnapshot
    coordinator.enqueue(withoutSnapshot)
    coordinator.enqueue(makeInput('s1', 'm2'))

    expect(coordinator.listSnapshots('s1').map((snapshot) => snapshot.id)).toEqual(['m2'])
  })

  test('Given clearAll 后 When 再入队或 pokeAll Then 不再派发', () => {
    const { coordinator, startCalls } = makeCoordinator()
    coordinator.enqueue(makeInput('s1', 'm1'))
    expect(startCalls).toHaveLength(1)

    coordinator.clearAll()
    coordinator.enqueue(makeInput('s1', 'm2'))
    coordinator.pokeAll()

    expect(startCalls).toHaveLength(1)
    expect(coordinator.listSnapshots('s1')).toEqual([])
  })
})
