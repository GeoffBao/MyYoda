/**
 * Browser host / errors 核心单测
 *
 * 覆盖：
 * - 错误 envelope 生成
 * - host 分发：browser_status / browser_tabs / 未打开时的错误
 * - manager 状态机：open/close/getState
 */

import { beforeAll, describe, expect, it } from 'bun:test'
import { mockElectronModule } from '../../__tests__/electron-mock'
mockElectronModule()

let BrowserAutomationHostError: typeof import('../browser-errors').BrowserAutomationHostError
let makeBrowserMcpToolErrorEnvelope: typeof import('../browser-errors').makeBrowserMcpToolErrorEnvelope
let browserHostError: typeof import('../browser-errors').browserHostError
let DesktopBrowserAutomationHost: typeof import('../browser-host').DesktopBrowserAutomationHost
let DesktopBrowserManager: typeof import('../browser-manager').DesktopBrowserManager

beforeAll(async () => {
  const errors = await import('../browser-errors')
  BrowserAutomationHostError = errors.BrowserAutomationHostError
  makeBrowserMcpToolErrorEnvelope = errors.makeBrowserMcpToolErrorEnvelope
  browserHostError = errors.browserHostError
  DesktopBrowserAutomationHost = (await import('../browser-host')).DesktopBrowserAutomationHost
  DesktopBrowserManager = (await import('../browser-manager')).DesktopBrowserManager
})

describe('browser-errors', () => {
  it('生成标准错误 envelope（含 retryable/phase）', () => {
    const envelope = makeBrowserMcpToolErrorEnvelope({
      code: 'BrowserNotOpen',
      retryable: true,
      phase: 'runtime',
    })
    expect(envelope.error.code).toBe('BrowserNotOpen')
    expect(envelope.error.retryable).toBe(true)
    expect(envelope.error.phase).toBe('runtime')
    expect(envelope.error.effectMayHaveCommitted).toBe(false)
  })

  it('browserHostError 抛出 BrowserAutomationHostError', () => {
    expect(() => browserHostError({ code: 'X', message: 'boom' })).toThrow(BrowserAutomationHostError)
  })
})

describe('DesktopBrowserManager 状态机', () => {
  it('open 前 getState 返回默认关闭态', () => {
    const manager = new DesktopBrowserManager()
    const state = manager.getState({ threadId: 's1' })
    expect(state.open).toBe(false)
    expect(state.tabs).toHaveLength(0)
    expect(state.activeTabId).toBeNull()
  })

  it('close 未打开会话是幂等的', () => {
    const manager = new DesktopBrowserManager()
    manager.close({ threadId: 's1' })
    expect(manager.getState({ threadId: 's1' }).open).toBe(false)
  })

  it('open 无窗口时返回 suspended tab（runtime 不可用路径）', async () => {
    // 无主窗口（getMainWindow 返回 null）：createRuntime 失败，tab 保持 suspended
    const manager = new DesktopBrowserManager()
    const result = await manager.open({ threadId: 's1', url: 'https://example.com' })
    expect(result.state.open).toBe(true)
    expect(result.state.tabs).toHaveLength(1)
    expect(result.state.tabs[0]!.status).toBe('suspended')
    expect(result.state.tabs[0]!.lastError).toBe('Browser runtime unavailable.')
  })
})

describe('DesktopBrowserManager 多 tab', () => {
  it('open newTab=true 追加 tab 而非覆盖', async () => {
    const manager = new DesktopBrowserManager()
    const first = await manager.open({ threadId: 's1', url: 'https://a.example' })
    const second = await manager.open({ threadId: 's1', url: 'https://b.example', newTab: true })
    expect(first.tabId).not.toBe(second.tabId)
    expect(second.state.tabs).toHaveLength(2)
    expect(second.state.activeTabId).toBe(second.tabId)
  })

  it('open 不带 newTab 复用活动 tab（不新增）', async () => {
    const manager = new DesktopBrowserManager()
    await manager.open({ threadId: 's1', url: 'https://a.example' })
    const second = await manager.open({ threadId: 's1', url: 'https://b.example' })
    expect(second.state.tabs).toHaveLength(1)
  })

  it('closeTab 关闭活动 tab 后切到相邻 tab', async () => {
    const manager = new DesktopBrowserManager()
    const first = await manager.open({ threadId: 's1', url: 'https://a.example' })
    await manager.open({ threadId: 's1', url: 'https://b.example', newTab: true })
    const result = manager.closeTab({ threadId: 's1', tabId: first.tabId })
    expect(result.closedTabId).toBe(first.tabId)
    const state = manager.getState({ threadId: 's1' })
    expect(state.tabs).toHaveLength(1)
    expect(state.activeTabId).not.toBe(first.tabId)
  })

  it('closeTab 关闭最后一个 tab 后浏览器关闭', async () => {
    const manager = new DesktopBrowserManager()
    const first = await manager.open({ threadId: 's1', url: 'https://a.example' })
    const result = manager.closeTab({ threadId: 's1', tabId: first.tabId })
    expect(result.closedTabId).toBe(first.tabId)
    expect(manager.getState({ threadId: 's1' }).open).toBe(false)
  })

  it('syncAnnotations 在 runtime 不存在时幂等不抛错', () => {
    const manager = new DesktopBrowserManager()
    expect(() => {
      manager.syncAnnotations({ threadId: 's1', markers: [] })
      manager.clearAnnotations({ threadId: 's1' })
    }).not.toThrow()
  })

  it('getAnnotations 初始为空且清空幂等', () => {
    const manager = new DesktopBrowserManager()
    expect(manager.getAnnotations({ threadId: 's1' })).toEqual([])
    manager.clearPickedAnnotations({ threadId: 's1' })
    expect(manager.getAnnotations({ threadId: 's1' })).toEqual([])
  })

  it('onAnnotationCommitted 订阅/退订', () => {
    const manager = new DesktopBrowserManager()
    const calls: Array<{ annotation: string; threadId: string }> = []
    const unsubscribe = manager.onAnnotationCommitted((annotation, threadId) => {
      calls.push({ annotation: annotation.id, threadId })
    })
    unsubscribe()
    // 退订后无监听器可调用；不应抛错
    expect(calls).toEqual([])
  })
})

describe('DesktopBrowserAutomationHost 分发', () => {
  it('browser_status 在未打开时返回 open=false', async () => {
    const manager = new DesktopBrowserManager()
    const host = new DesktopBrowserAutomationHost(manager)
    const result = await host.executeTool({ sessionId: 's1', provider: 'claude', threadId: 's1', name: 'browser_status', arguments: {} })
    expect(result.text).toContain('"open": false')
  })

  it('browser_snapshot 未打开时报 BrowserNotOpen', async () => {
    const manager = new DesktopBrowserManager()
    const host = new DesktopBrowserAutomationHost(manager)
    let thrown: unknown
    try {
      await host.executeTool({ sessionId: 's1', provider: 'claude', threadId: 's1', name: 'browser_snapshot', arguments: {} })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(BrowserAutomationHostError)
    expect((thrown as InstanceType<typeof BrowserAutomationHostError>).browserError.code).toBe('BrowserNotOpen')
  })

  it('未知工具名抛 BrowserToolNotFound', async () => {
    const manager = new DesktopBrowserManager()
    const host = new DesktopBrowserAutomationHost(manager)
    let thrown: unknown
    try {
      await host.executeTool({ sessionId: 's1', provider: 'claude', threadId: 's1', name: 'browser_nope' as never, arguments: {} })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(BrowserAutomationHostError)
    expect((thrown as InstanceType<typeof BrowserAutomationHostError>).browserError.code).toBe('BrowserToolNotFound')
  })
})
