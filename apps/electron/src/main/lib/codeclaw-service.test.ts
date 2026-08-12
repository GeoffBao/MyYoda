import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { mockElectronModule } from './__tests__/electron-mock'

// ===== mock 边界说明 =====
// - 不能 mock './agent-service'：task-handlers / automation-scheduler /
//   bridge-command-handler 等测试通过真实模块导入它，bun mock.module 是
//   进程级跨文件共享，mock 会污染这些真实消费者（SyntaxError: Export named
//   'isAgentSessionActive' not found）。因此这里**真实加载** agent-service，
//   拿到同一个 agentEventBus 实例驱动状态机。
// - mock './codeclaw-window'：避免真实 BrowserWindow 副作用；仅 codeclaw-service
//   消费它，无其它测试文件依赖，不会造成跨文件污染。
// - 真实加载 './agent-session-manager' / './settings-service'：其它测试文件依赖
//   真实模块，不能 mock。

const SESSION_RETAIN_MS = 24 * 60 * 60_000
const SESSION_ACTIVE_MAX_MS = 7 * 24 * 60 * 60_000
const UNREAD_RETAIN_MS = 10 * 60_000

interface CapturedState { sessions: Array<{ sessionId: string; phase: string; startedAt: number; lastActivityAt: number }> }
let capturedState: CapturedState | null = null
let windowReadyCb: (() => void) | null = null

mock.module('./codeclaw-window', () => ({
  onCodeClawWindowReady: (cb: () => void) => { windowReadyCb = cb },
  showCodeClawWindow: () => undefined,
  hideCodeClawWindow: () => undefined,
  moveCodeClawWindow: () => undefined,
  setCodeClawMiniMode: () => undefined,
  setCodeClawPeek: () => undefined,
  resizeCodeClawWindow: () => undefined,
  getCodeClawSize: () => 'm',
  getCodeClawWindow: () => ({
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: (_channel: string, state: CapturedState) => { capturedState = state },
    },
  }),
}))

mockElectronModule()

let tempHome: string
const originalHome = process.env.HOME
const originalMyyodaDev = process.env.MYYODA_DEV
const realNow = Date.now

let fakeNow = 1_700_000_000_000

type CodeClawServiceModule = typeof import('./codeclaw-service')
type AgentServiceModule = typeof import('./agent-service')
let service: CodeClawServiceModule
let realEventBus: AgentServiceModule['agentEventBus']

beforeAll(async () => {
  tempHome = mkdtempSync(join(os.tmpdir(), 'myyoda-codeclaw-'))
  process.env.HOME = tempHome
  delete process.env.MYYODA_DEV
  process.env.MYYODA_DEV = '0'
  mock.module('node:os', () => ({ ...os, homedir: () => tempHome }))
  Date.now = mock(() => fakeNow)
  // 真实加载 agent-service：与 codeclaw-service 共享同一个 eventBus 实例
  const agentService = await import('./agent-service')
  realEventBus = agentService.agentEventBus
  service = await import('./codeclaw-service')
})

afterAll(() => {
  Date.now = realNow
  process.env.HOME = originalHome
  if (originalMyyodaDev === undefined) delete process.env.MYYODA_DEV
  else process.env.MYYODA_DEV = originalMyyodaDev
  rmSync(tempHome, { recursive: true, force: true })
})

beforeEach(() => {
  capturedState = null
  windowReadyCb = null
  fakeNow = 1_700_000_000_000
})

afterEach(() => {
  service.disposeCodeClawService()
})

function resultSuccess(sessionId: string) {
  return {
    kind: 'sdk_message' as const,
    message: {
      type: 'result' as const,
      subtype: 'success' as const,
      session_id: sessionId,
      usage: { input_tokens: 1, output_tokens: 1 },
    },
  }
}

function externalRun(sessionId: string) {
  return {
    kind: 'myyoda_event' as const,
    event: {
      type: 'external_run_started' as const,
      source: 'feishu' as const,
      sessionId,
      startedAt: fakeNow,
    },
  }
}

function emit(sessionId: string, payload: Parameters<AgentServiceModule['agentEventBus']['emit']>[1]): void {
  realEventBus.emit(sessionId, payload)
  service.publishCodeClawNow()
}

/** 启动 service（enabled=true），让事件真正进入状态机 */
function start(): void {
  service.initCodeClawService({
    enabled: () => true,
    showAndFocusMainWindow: () => undefined,
    openAgentSession: () => undefined,
  })
}

describe('CodeClaw sessions 过期回收', () => {
  test('终态 completed 会话超过 24h 无活动后被回收，重新来事件时新建', () => {
    start()
    fakeNow = 1_700_000_000_000
    emit('s1', resultSuccess('s1'))
    expect(capturedState?.sessions.map((s) => s.sessionId)).toEqual(['s1'])
    expect(capturedState?.sessions[0]?.phase).toBe('completed')
    const originalStartedAt = capturedState?.sessions[0]?.startedAt

    // 超过 24h（仍 < UNREAD_RETAIN 之外的时间点），publish 触发 prune
    fakeNow = 1_700_000_000_000 + SESSION_RETAIN_MS + 1000
    service.publishCodeClawNow()
    expect(capturedState?.sessions.map((s) => s.sessionId) ?? []).toEqual([])

    // 会话已被回收：再次收到同 session 事件会重建，startedAt 变新
    fakeNow = 1_700_000_000_000 + SESSION_RETAIN_MS + 2000
    emit('s1', externalRun('s1'))
    expect(capturedState?.sessions[0]?.sessionId).toBe('s1')
    expect(capturedState?.sessions[0]?.startedAt).toBeGreaterThan(originalStartedAt ?? 0)
  })

  test('活跃 running 会话 24h 后不再显示，但 7 天内不会被回收', () => {
    start()
    fakeNow = 1_700_000_000_000
    emit('s2', externalRun('s2'))
    const originalStartedAt = capturedState?.sessions[0]?.startedAt
    expect(capturedState?.sessions[0]?.phase).toBe('running')

    // 超过 24h 但 < 7d：不可见（不会出现在 sessions 里），但 Map 中仍保留
    fakeNow = 1_700_000_000_000 + 3 * 24 * 60 * 60_000
    service.publishCodeClawNow()
    expect(capturedState?.sessions.map((s) => s.sessionId) ?? []).toEqual([])

    // 同一会话重新活跃（<7d 内未回收）：复用原会话，startedAt 不变
    fakeNow = 1_700_000_000_000 + 3 * 24 * 60 * 60_000 + 5000
    emit('s2', externalRun('s2'))
    expect(capturedState?.sessions[0]?.sessionId).toBe('s2')
    expect(capturedState?.sessions[0]?.startedAt).toBe(originalStartedAt)
  })

  test('活跃 running 会话超过 7 天无事件后被兜底回收', () => {
    start()
    fakeNow = 1_700_000_000_000
    emit('s3', externalRun('s3'))
    const originalStartedAt = capturedState?.sessions[0]?.startedAt

    // 超过 7 天：prune 回收（即使 phase 仍是 running）
    fakeNow = 1_700_000_000_000 + SESSION_ACTIVE_MAX_MS + 1000
    service.publishCodeClawNow()
    expect(capturedState?.sessions.map((s) => s.sessionId) ?? []).toEqual([])

    // 会话已被回收：重建，startedAt 变新
    fakeNow = 1_700_000_000_000 + SESSION_ACTIVE_MAX_MS + 2000
    emit('s3', externalRun('s3'))
    expect(capturedState?.sessions[0]?.startedAt).toBeGreaterThan(originalStartedAt ?? 0)
  })

  test('completed 会话在未读保留窗口内仍可见', () => {
    start()
    fakeNow = 1_700_000_000_000
    emit('s4', resultSuccess('s4'))
    expect(capturedState?.sessions.map((s) => s.sessionId)).toEqual(['s4'])

    // 8 分钟后仍在未读保留窗口（10min）内
    fakeNow = 1_700_000_000_000 + 8 * 60_000
    service.publishCodeClawNow()
    expect(capturedState?.sessions.map((s) => s.sessionId)).toEqual(['s4'])
    expect(capturedState?.sessions[0]?.phase).toBe('completed')
  })
})
