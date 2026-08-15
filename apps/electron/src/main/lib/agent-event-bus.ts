/**
 * AgentEventBus — run-scoped canonical 事件总线
 *
 * Producer 仍只提交 payload；EventBus 是 runId/sequence 的唯一分配者，并把同一
 * AgentRunEvent 同时交给 renderer、Bridge、协作与 Agent Island。旧消费者可继续
 * 忽略第三个 envelope 参数，避免兼容投影重新进入实时热路径。
 */

import type { AgentRunEvent, AgentStreamPayload } from '@myyoda/shared'

/** 事件监听器 */
export type AgentEventHandler = (
  sessionId: string,
  payload: AgentStreamPayload,
  runEvent: AgentRunEvent,
) => void

/** 中间件：可执行副作用，调用 next() 继续链路。 */
export type AgentEventMiddleware = (
  sessionId: string,
  payload: AgentStreamPayload,
  next: () => void,
  runEvent: AgentRunEvent,
) => void

interface RunSequenceState {
  runId: string
  startedAt: number
  sequence: number
}

export class AgentEventBus {
  private handlers: Set<AgentEventHandler> = new Set()
  private middlewares: AgentEventMiddleware[] = []
  private runStates = new Map<string, RunSequenceState>()
  private endedRunKeys = new Set<string>()
  private static readonly MAX_ENDED_RUN_TOMBSTONES = 256

  emit(sessionId: string, payload: AgentStreamPayload): void {
    const explicitRunId = getExplicitRunId(payload)
    const runStart = payload.kind === 'myyoda_event'
      && (payload.event.type === 'run_started' || payload.event.type === 'external_run_started')
      ? payload.event
      : undefined
    let state = this.runStates.get(sessionId)

    // 只有显式 run start 能建立/替换 scope。迟到 delta/run_stopped 不得劫持后续
    // permission、AskUser、Plan 等无显式 runId 的产品事件。
    if (runStart) {
      const runKey = `${sessionId}\u0000${runStart.runId}`
      if (this.endedRunKeys.has(runKey) || state?.runId === runStart.runId) {
        console.warn(`[AgentEventBus] 丢弃重复 run start: session=${sessionId}, run=${runStart.runId}`)
        return
      }
      // 不允许不同 run 抢占 active scope；正常新 run 必须先由完成路径 endRun。
      const canStart = !state
      if (!canStart) {
        console.warn(`[AgentEventBus] 丢弃迟到 run start: session=${sessionId}, active=${state?.runId}, incoming=${runStart.runId}`)
        return
      }
      if (state?.runId !== runStart.runId) {
        state = { runId: runStart.runId, startedAt: runStart.startedAt, sequence: 0 }
        this.runStates.set(sessionId, state)
      }
    } else if (explicitRunId && (!state || state.runId !== explicitRunId)) {
      console.warn(`[AgentEventBus] 丢弃不匹配 run 事件: session=${sessionId}, active=${state?.runId}, incoming=${explicitRunId}`)
      return
    }

    const runId = explicitRunId ?? state?.runId
    const runEvent: AgentRunEvent = {
      sessionId,
      ...(runId ? { runId } : {}),
      ...(state && runId === state.runId ? { sequence: ++state.sequence } : {}),
      occurredAt: Date.now(),
      payload,
    }

    const dispatch = (): void => {
      for (const handler of this.handlers) {
        try {
          handler(sessionId, payload, runEvent)
        } catch (error) {
          console.error('[AgentEventBus] 事件处理器错误:', error)
        }
      }
    }

    if (this.middlewares.length === 0) {
      dispatch()
      return
    }

    let index = this.middlewares.length - 1
    let chain = dispatch
    while (index >= 0) {
      const middleware = this.middlewares[index]!
      const next = chain
      chain = () => {
        try {
          middleware(sessionId, payload, next, runEvent)
        } catch (error) {
          console.error('[AgentEventBus] 中间件错误:', error)
          next()
        }
      }
      index--
    }

    chain()
  }

  /** 只结束精确匹配的 run；被拒绝的并发请求不能清掉当前 sequence scope。 */
  endRun(sessionId: string, runId: string): void {
    if (this.runStates.get(sessionId)?.runId !== runId) return
    this.runStates.delete(sessionId)
    const runKey = `${sessionId}\u0000${runId}`
    this.endedRunKeys.add(runKey)
    if (this.endedRunKeys.size > AgentEventBus.MAX_ENDED_RUN_TOMBSTONES) {
      const oldest = this.endedRunKeys.values().next().value
      if (oldest) this.endedRunKeys.delete(oldest)
    }
  }

  on(handler: AgentEventHandler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  use(middleware: AgentEventMiddleware): void {
    this.middlewares.push(middleware)
  }

  dispose(): void {
    this.handlers.clear()
    this.middlewares = []
    this.runStates.clear()
    this.endedRunKeys.clear()
  }
}

function getExplicitRunId(payload: AgentStreamPayload): string | undefined {
  if (payload.kind === 'assistant_message_delta') return payload.runId
  if (payload.kind === 'myyoda_event'
    && (payload.event.type === 'run_started'
      || payload.event.type === 'external_run_started'
      || payload.event.type === 'run_stopped')) {
    return payload.event.runId
  }
  return undefined
}
