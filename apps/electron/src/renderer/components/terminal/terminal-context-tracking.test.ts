import { describe, expect, test } from 'bun:test'
import { buildTerminalContextKey, shouldReopenTerminal } from './terminal-context-tracking'

describe('terminal context tracking', () => {
  test('首次非空上下文只锁定，不触发重开', () => {
    const decision = shouldReopenTerminal(null, 'ws-a|')
    expect(decision.reopen).toBe(false)
    expect(decision.nextLastKey).toBe('ws-a|')
  })

  test('上下文未加载（空 key）时不锁定、不重开', () => {
    const decision = shouldReopenTerminal(null, '')
    expect(decision.reopen).toBe(false)
    expect(decision.nextLastKey).toBe(null)
  })

  test('上下文不变时不重开', () => {
    const decision = shouldReopenTerminal('ws-a|', 'ws-a|')
    expect(decision.reopen).toBe(false)
    expect(decision.nextLastKey).toBe('ws-a|')
  })

  test('工作区改绑时触发重开并锁定新上下文', () => {
    const decision = shouldReopenTerminal('ws-a|', 'ws-b|')
    expect(decision.reopen).toBe(true)
    expect(decision.nextLastKey).toBe('ws-b|')
  })

  test('同工作区改绑项目也触发重开', () => {
    const decision = shouldReopenTerminal('ws-a|p1', 'ws-a|p2')
    expect(decision.reopen).toBe(true)
    expect(decision.nextLastKey).toBe('ws-a|p2')
  })

  test('锁定后短暂回到空 key 保持锁定，后续变化仍触发重开', () => {
    const transient = shouldReopenTerminal('ws-a|', '')
    expect(transient.reopen).toBe(false)
    expect(transient.nextLastKey).toBe('ws-a|')

    const rebound = shouldReopenTerminal(transient.nextLastKey, 'ws-b|')
    expect(rebound.reopen).toBe(true)
    expect(rebound.nextLastKey).toBe('ws-b|')
  })

  test('buildTerminalContextKey 由 workspaceId 与 projectId 构成', () => {
    expect(buildTerminalContextKey(undefined)).toBe('')
    expect(buildTerminalContextKey({ workspaceId: 'ws-a' })).toBe('ws-a|')
    expect(buildTerminalContextKey({ workspaceId: 'ws-a', projectId: 'p1' })).toBe('ws-a|p1')
  })
})
