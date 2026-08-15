import type {
  AgentAssistantDeltaMetadata,
  AgentAssistantDeltaOperation,
  AgentAssistantMessageDelta,
  SDKAssistantMessage,
} from '@myyoda/shared'

type TimerHandle = ReturnType<typeof setTimeout>

interface PendingAppend {
  messageId: string
  operation: Extract<AgentAssistantDeltaOperation, { type: 'append_text' | 'append_thinking' }>
  metadata?: AgentAssistantDeltaMetadata
  timer: TimerHandle
}

export interface PiNativeDeltaStreamOptions {
  runId: string
  emit: (delta: AgentAssistantMessageDelta) => void
  intervalMs?: number
  schedule?: (callback: () => void, delayMs: number) => TimerHandle
  cancel?: (timer: TimerHandle) => void
}

/**
 * Pi 原生 assistant delta 的唯一合帧层。
 *
 * 只拼接同一 block 的相邻字符串增量，绝不丢弃 delta，也不持有 Pi 的累计 partial
 * 对象。结构事件与 final 前会同步 flush，保持内容顺序。
 */
export class PiNativeDeltaStream {
  private readonly runId: string
  private readonly emitDelta: (delta: AgentAssistantMessageDelta) => void
  private readonly intervalMs: number
  private readonly schedule: (callback: () => void, delayMs: number) => TimerHandle
  private readonly cancel: (timer: TimerHandle) => void
  private readonly sequences = new Map<string, number>()
  private pending?: PendingAppend

  constructor(options: PiNativeDeltaStreamOptions) {
    this.runId = options.runId
    this.emitDelta = options.emit
    this.intervalMs = options.intervalMs ?? 50
    this.schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs))
    this.cancel = options.cancel ?? clearTimeout
  }

  reset(messageId: string, message: SDKAssistantMessage, metadata?: AgentAssistantDeltaMetadata): void {
    this.flush()
    this.publish(messageId, [], metadata, message)
  }

  appendText(messageId: string, blockIndex: number, text: string, metadata?: AgentAssistantDeltaMetadata): void {
    if (!text) return
    this.append(messageId, { type: 'append_text', blockIndex, text }, metadata)
  }

  appendThinking(messageId: string, blockIndex: number, thinking: string, metadata?: AgentAssistantDeltaMetadata): void {
    if (!thinking) return
    this.append(messageId, { type: 'append_thinking', blockIndex, thinking }, metadata)
  }

  operation(messageId: string, operation: AgentAssistantDeltaOperation, metadata?: AgentAssistantDeltaMetadata): void {
    this.flush()
    this.publish(messageId, [operation], metadata)
  }

  flush(): void {
    const pending = this.pending
    if (!pending) return
    this.pending = undefined
    this.cancel(pending.timer)
    this.publish(pending.messageId, [pending.operation], pending.metadata)
  }

  finish(messageId: string): void {
    this.flush()
    this.sequences.delete(messageId)
  }

  dispose(): void {
    this.flush()
    this.sequences.clear()
  }

  private append(
    messageId: string,
    operation: Extract<AgentAssistantDeltaOperation, { type: 'append_text' | 'append_thinking' }>,
    metadata?: AgentAssistantDeltaMetadata,
  ): void {
    const pending = this.pending
    if (
      pending
      && pending.messageId === messageId
      && pending.operation.type === operation.type
      && pending.operation.blockIndex === operation.blockIndex
    ) {
      if (operation.type === 'append_text' && pending.operation.type === 'append_text') {
        pending.operation = { ...pending.operation, text: pending.operation.text + operation.text }
      } else if (operation.type === 'append_thinking' && pending.operation.type === 'append_thinking') {
        pending.operation = { ...pending.operation, thinking: pending.operation.thinking + operation.thinking }
      }
      if (metadata) pending.metadata = metadata
      return
    }

    this.flush()
    const timer = this.schedule(() => this.flush(), this.intervalMs)
    this.pending = { messageId, operation, metadata, timer }
  }

  private publish(
    messageId: string,
    operations: AgentAssistantDeltaOperation[],
    metadata?: AgentAssistantDeltaMetadata,
    reset?: SDKAssistantMessage,
  ): void {
    const sequence = (this.sequences.get(messageId) ?? 0) + 1
    this.sequences.set(messageId, sequence)
    this.emitDelta({
      kind: 'assistant_message_delta',
      runId: this.runId,
      messageId,
      sequence,
      ...(reset && { reset }),
      operations,
      ...(metadata && { metadata }),
    })
  }
}
