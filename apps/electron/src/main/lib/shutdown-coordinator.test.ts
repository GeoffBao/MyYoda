import { describe, expect, test } from 'bun:test'
import { createShutdownCoordinator } from './shutdown-coordinator'

describe('shutdown coordinator', () => {
  test('同步清理失败仍会等待异步清理并再次请求退出', async () => {
    const calls: string[] = []
    const coordinator = createShutdownCoordinator({
      syncCleanupTasks: [
        { name: 'broken', run: () => { throw new Error('cleanup failed') } },
        { name: 'next', run: () => { calls.push('next') } },
      ],
      asyncCleanup: async () => { calls.push('async') },
      requestQuit: () => { calls.push('quit') },
      timeoutMs: 100,
      reportError: (name) => { calls.push(`error:${name}`) },
    })
    let prevented = 0

    coordinator.handleBeforeQuit({ preventDefault: () => { prevented += 1 } })
    await coordinator.waitForCompletion()

    expect(prevented).toBe(1)
    expect(calls).toEqual(['error:broken', 'next', 'async', 'quit'])
  })

  test('清理完成后的第二次退出直接放行', async () => {
    let quitRequests = 0
    const coordinator = createShutdownCoordinator({
      syncCleanupTasks: [],
      asyncCleanup: async () => {},
      requestQuit: () => { quitRequests += 1 },
      timeoutMs: 100,
      reportError: () => {},
    })
    let prevented = 0
    const event = { preventDefault: () => { prevented += 1 } }

    coordinator.handleBeforeQuit(event)
    await coordinator.waitForCompletion()
    coordinator.handleBeforeQuit(event)

    expect(prevented).toBe(1)
    expect(quitRequests).toBe(1)
  })

  test('清理进行中的第二次 before-quit 仍 preventDefault，且不重跑同步任务', async () => {
    const calls: string[] = []
    let resolveAsync!: () => void
    const asyncGate = new Promise<void>((resolve) => { resolveAsync = resolve })
    const coordinator = createShutdownCoordinator({
      syncCleanupTasks: [{ name: 'sync', run: () => { calls.push('sync') } }],
      asyncCleanup: () => asyncGate,
      requestQuit: () => { calls.push('quit') },
      timeoutMs: 5_000,
      reportError: () => {},
    })
    let prevented = 0
    const event = { preventDefault: () => { prevented += 1 } }

    coordinator.handleBeforeQuit(event)
    coordinator.handleBeforeQuit(event)
    expect(prevented).toBe(2)
    expect(calls).toEqual(['sync'])

    resolveAsync()
    await coordinator.waitForCompletion()
    expect(calls).toEqual(['sync', 'quit'])
  })
})
