import type {
  AgentStreamPayload,
  SDKAssistantMessage,
  SDKResultMessage,
  SDKUserMessage,
} from '@myyoda/shared'

/**
 * 飞书流式卡片的运行时状态机。
 *
 * 把 AgentStreamPayload（Pi assistant delta + stable sdk_message + myyoda_event）累积成一个结构化的
 * RunState，便于渲染层无时序地把状态转成 CardKit 2.0 JSON。设计参考
 * zara/feishu-claude-code-bridge `src/card/run-state.ts`，但消费的是
 * MyYoda 的 SDKMessage 形态而非 claude CLI 的 stream-json。
 *
 * 所有 reducer 是纯函数：`reduce(state, payload) → state`。
 */

export type ToolStatus = 'running' | 'done' | 'error'

export interface ToolEntry {
  id: string
  name: string
  input: unknown
  status: ToolStatus
  output?: string
}

export type Block =
  | { kind: 'text'; content: string; streaming: boolean; messageId?: string; contentIndex?: number }
  | { kind: 'tool'; tool: ToolEntry; messageId?: string; contentIndex?: number }

export type FooterStatus = 'thinking' | 'tool_running' | 'streaming' | null

export type Terminal = 'running' | 'done' | 'interrupted' | 'error' | 'idle_timeout'

interface PartialAssistantSnapshot {
  blocks: Record<number, { type: 'text' | 'thinking'; content: string }>
}

export interface RunState {
  blocks: Block[]
  reasoning: { content: string; active: boolean; messageId?: string; contentIndex?: number }
  /** Pi-native delta 按 assistant messageId 保存的已归约内容，用于 final 缺口校正。 */
  partialAssistantSnapshots: Record<string, PartialAssistantSnapshot>
  /** thinking 按 messageId/contentIndex 保存，并按 assistant 消息顺序合成单一 reasoning panel。 */
  thinkingBlocks: Record<string, Record<number, string>>
  thinkingMessageOrder: string[]
  footer: FooterStatus
  terminal: Terminal
  errorMsg?: string
  /** idle_timeout 终态下，无响应的分钟数（卡片渲染时拼"N 分钟无响应"）。 */
  idleTimeoutMinutes?: number
  startedAt: number
  /** result 消息携带的元数据，渲染卡片底部 summary 用。 */
  meta: {
    durationMs?: number
    inputTokens?: number
    outputTokens?: number
    costUsd?: number
    model?: string
  }
}

export function createInitialState(): RunState {
  return {
    blocks: [],
    reasoning: { content: '', active: false },
    partialAssistantSnapshots: {},
    thinkingBlocks: {},
    thinkingMessageOrder: [],
    footer: 'thinking',
    terminal: 'running',
    startedAt: Date.now(),
    meta: {},
  }
}

function closeStreamingText(blocks: Block[]): Block[] {
  return blocks.map((b) =>
    b.kind === 'text' && b.streaming ? { ...b, streaming: false } : b,
  )
}

function appendText(state: RunState, delta: string): RunState {
  const last = state.blocks[state.blocks.length - 1]
  if (last && last.kind === 'text' && last.streaming) {
    const next: Block = { ...last, content: last.content + delta }
    return {
      ...state,
      blocks: [...state.blocks.slice(0, -1), next],
      reasoning: { ...state.reasoning, active: false },
      footer: 'streaming',
    }
  }
  return {
    ...state,
    blocks: [...state.blocks, { kind: 'text', content: delta, streaming: true }],
    reasoning: { ...state.reasoning, active: false },
    footer: 'streaming',
  }
}

function appendThinking(state: RunState, delta: string): RunState {
  return {
    ...state,
    reasoning: { content: state.reasoning.content + delta, active: true },
    footer: 'thinking',
  }
}

function startTool(state: RunState, id: string, name: string, input: unknown): RunState {
  const existing = state.blocks.find((block) => block.kind === 'tool' && block.tool.id === id)
  if (existing?.kind === 'tool') {
    return {
      ...state,
      blocks: state.blocks.map((block) => block.kind === 'tool' && block.tool.id === id
        ? { ...block, tool: { ...block.tool, name, input } }
        : block),
      reasoning: { ...state.reasoning, active: false },
      footer: existing.tool.status === 'running' ? 'tool_running' : state.footer,
    }
  }

  const tool: ToolEntry = { id, name, input, status: 'running' }
  return {
    ...state,
    blocks: [...closeStreamingText(state.blocks), { kind: 'tool', tool }],
    reasoning: { ...state.reasoning, active: false },
    footer: 'tool_running',
  }
}

function insertOwnedBlock(
  blocks: Block[],
  block: Block,
  messageId: string,
  contentIndex: number,
): Block[] {
  const next = [...blocks]
  const firstGreater = next.findIndex((candidate) =>
    candidate.messageId === messageId
      && candidate.contentIndex != null
      && candidate.contentIndex > contentIndex
  )
  if (firstGreater >= 0) {
    next.splice(firstGreater, 0, block)
    return next
  }
  let lastOwned = -1
  for (let index = next.length - 1; index >= 0; index--) {
    if (next[index]?.messageId === messageId) {
      lastOwned = index
      break
    }
  }
  next.splice(lastOwned >= 0 ? lastOwned + 1 : next.length, 0, block)
  return next
}

function appendTextAt(
  state: RunState,
  messageId: string,
  contentIndex: number,
  delta: string,
): RunState {
  const existingIndex = state.blocks.findIndex((block) =>
    block.kind === 'text'
      && block.messageId === messageId
      && block.contentIndex === contentIndex
  )
  const blocks = existingIndex >= 0
    ? state.blocks.map((block, index) => index === existingIndex && block.kind === 'text'
      ? { ...block, content: block.content + delta, streaming: true }
      : block)
    : insertOwnedBlock(
      state.blocks,
      { kind: 'text', content: delta, streaming: true, messageId, contentIndex },
      messageId,
      contentIndex,
    )
  return {
    ...state,
    blocks,
    reasoning: { ...state.reasoning, active: false },
    footer: 'streaming',
  }
}

function composeThinking(
  thinkingBlocks: RunState['thinkingBlocks'],
  messageOrder: string[],
): string {
  return messageOrder
    .flatMap((messageId) => Object.entries(thinkingBlocks[messageId] ?? {})
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([, value]) => value))
    .join('')
}

function appendThinkingAt(
  state: RunState,
  messageId: string,
  contentIndex: number,
  delta: string,
): RunState {
  const messageBlocks = state.thinkingBlocks[messageId] ?? {}
  const thinkingBlocks = {
    ...state.thinkingBlocks,
    [messageId]: {
      ...messageBlocks,
      [contentIndex]: (messageBlocks[contentIndex] ?? '') + delta,
    },
  }
  const thinkingMessageOrder = state.thinkingMessageOrder.includes(messageId)
    ? state.thinkingMessageOrder
    : [...state.thinkingMessageOrder, messageId]
  return {
    ...state,
    thinkingBlocks,
    thinkingMessageOrder,
    reasoning: {
      content: composeThinking(thinkingBlocks, thinkingMessageOrder),
      active: true,
      messageId,
      contentIndex,
    },
    footer: 'thinking',
  }
}

function startToolAt(
  state: RunState,
  messageId: string,
  contentIndex: number,
  id: string,
  name: string,
  input: unknown,
): RunState {
  const existingIndex = state.blocks.findIndex((block) =>
    block.kind === 'tool'
      && (block.tool.id === id
        || (block.messageId === messageId && block.contentIndex === contentIndex))
  )
  if (existingIndex >= 0) {
    return {
      ...state,
      blocks: state.blocks.map((block, index) => index === existingIndex && block.kind === 'tool'
        ? { ...block, messageId, contentIndex, tool: { ...block.tool, id, name, input } }
        : block),
      reasoning: { ...state.reasoning, active: false },
      footer: 'tool_running',
    }
  }
  const tool: ToolEntry = { id, name, input, status: 'running' }
  return {
    ...state,
    blocks: insertOwnedBlock(
      closeStreamingText(state.blocks),
      { kind: 'tool', tool, messageId, contentIndex },
      messageId,
      contentIndex,
    ),
    reasoning: { ...state.reasoning, active: false },
    footer: 'tool_running',
  }
}

function completeTool(state: RunState, id: string, output: string, isError: boolean): RunState {
  const blocks = state.blocks.map((b) => {
    if (b.kind !== 'tool' || b.tool.id !== id) return b
    return {
      ...b,
      tool: { ...b.tool, status: isError ? ('error' as const) : ('done' as const), output },
    }
  })
  return { ...state, blocks }
}

function cumulativeDelta(current: string, previous: string): string {
  return current.startsWith(previous) ? current.slice(previous.length) : current
}

function stringifyToolResult(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === 'string') return c
        if (c && typeof c === 'object' && 'text' in c && typeof (c as { text: string }).text === 'string') {
          return (c as { text: string }).text
        }
        try {
          return JSON.stringify(c)
        } catch {
          return String(c)
        }
      })
      .join('\n')
  }
  try {
    return JSON.stringify(content)
  } catch {
    return String(content)
  }
}

export function reduce(state: RunState, payload: AgentStreamPayload): RunState {
  if (payload.kind === 'assistant_message_delta') {
    const previousAttempt = state.partialAssistantSnapshots[payload.messageId]
    let next = state
    if (payload.reset) {
      // Native retry 复用 messageId；删除该 attempt 拥有的全部 text/tool/thinking block。
      const blocks = previousAttempt
        ? state.blocks.filter((block) => block.messageId !== payload.messageId)
        : state.blocks
      const resetReasoning = previousAttempt && state.reasoning.messageId === payload.messageId
      const thinkingBlocks = {
        ...state.thinkingBlocks,
        [payload.messageId]: {},
      }
      next = {
        ...state,
        blocks,
        reasoning: resetReasoning
          ? { content: composeThinking(thinkingBlocks, state.thinkingMessageOrder), active: false }
          : state.reasoning,
        partialAssistantSnapshots: {
          ...state.partialAssistantSnapshots,
          [payload.messageId]: { blocks: {} },
        },
        thinkingBlocks,
        ...(payload.metadata?.model && !state.meta.model
          ? { meta: { ...state.meta, model: payload.metadata.model } }
          : {}),
      }
    }
    for (const operation of payload.operations) {
      if (operation.type === 'append_text') {
        next = appendTextAt(next, payload.messageId, operation.blockIndex, operation.text)
        const snapshot = next.partialAssistantSnapshots[payload.messageId] ?? { blocks: {} }
        const previous = snapshot.blocks[operation.blockIndex]
        next = {
          ...next,
          partialAssistantSnapshots: {
            ...next.partialAssistantSnapshots,
            [payload.messageId]: {
              blocks: {
                ...snapshot.blocks,
                [operation.blockIndex]: {
                  type: 'text',
                  content: (previous?.type === 'text' ? previous.content : '') + operation.text,
                },
              },
            },
          },
        }
      } else if (operation.type === 'append_thinking') {
        next = appendThinkingAt(next, payload.messageId, operation.blockIndex, operation.thinking)
        const snapshot = next.partialAssistantSnapshots[payload.messageId] ?? { blocks: {} }
        const previous = snapshot.blocks[operation.blockIndex]
        next = {
          ...next,
          partialAssistantSnapshots: {
            ...next.partialAssistantSnapshots,
            [payload.messageId]: {
              blocks: {
                ...snapshot.blocks,
                [operation.blockIndex]: {
                  type: 'thinking',
                  content: (previous?.type === 'thinking' ? previous.content : '') + operation.thinking,
                },
              },
            },
          },
        }
      } else if (operation.type === 'append_block' || operation.type === 'replace_block') {
        const block = operation.block
        if (block.type === 'tool_use'
          && typeof block.id === 'string'
          && typeof block.name === 'string') {
          next = startToolAt(
            next,
            payload.messageId,
            operation.blockIndex,
            block.id,
            block.name,
            block.input,
          )
        }
      }
    }
    return next
  }

  if (payload.kind === 'sdk_message') {
    const msg = payload.message

    if (msg.type === 'assistant') {
      const am = msg as SDKAssistantMessage
      const assistantId = typeof (msg as { uuid?: unknown }).uuid === 'string'
        ? (msg as { uuid: string }).uuid
        : undefined
      const previousSnapshot = assistantId ? state.partialAssistantSnapshots[assistantId] : undefined
      const useCumulativeSnapshot = previousSnapshot != null
      let next = state
      if (am.message?.model && !next.meta.model) {
        next = { ...next, meta: { ...next.meta, model: am.message.model } }
      }
      // assistant 消息上若携带顶层 error 字段，直接转为 error 终态
      // （SDK 偶尔会在 assistant 帧带 error，不走 result 路径）
      if (am.error?.message) {
        return markError(state, am.error.message)
      }

      for (const [index, block] of (am.message?.content ?? []).entries()) {
        if (block.type === 'text') {
          const text = (block as { text?: unknown }).text
          if (typeof text === 'string') {
            const previous = previousSnapshot?.blocks[index]
            const delta = useCumulativeSnapshot && previous?.type === 'text'
              ? cumulativeDelta(text, previous.content)
              : text
            if (delta) {
              next = previousSnapshot && assistantId
                ? appendTextAt(next, assistantId, index, delta)
                : appendText(next, delta)
            }
          }
        } else if (block.type === 'thinking') {
          const thinking = (block as { thinking?: unknown }).thinking
          if (typeof thinking === 'string') {
            const previous = previousSnapshot?.blocks[index]
            const delta = useCumulativeSnapshot && previous?.type === 'thinking'
              ? cumulativeDelta(thinking, previous.content)
              : thinking
            if (delta) {
              next = previousSnapshot && assistantId
                ? appendThinkingAt(next, assistantId, index, delta)
                : appendThinking(next, delta)
            }
          }
        } else if (block.type === 'tool_use') {
          const tb = block as { id?: unknown; name?: unknown; input?: unknown }
          if (typeof tb.id === 'string' && typeof tb.name === 'string') {
            next = previousSnapshot && assistantId
              ? startToolAt(next, assistantId, index, tb.id, tb.name, tb.input)
              : startTool(next, tb.id, tb.name, tb.input)
          }
        }
      }

      if (assistantId && previousSnapshot) {
        const { [assistantId]: _, ...partialAssistantSnapshots } = next.partialAssistantSnapshots
        return { ...next, partialAssistantSnapshots }
      }
      return next
    }

    if (msg.type === 'user') {
      const um = msg as SDKUserMessage
      let next = state
      for (const block of um.message?.content ?? []) {
        if (block.type === 'tool_result') {
          const trb = block as { tool_use_id?: unknown; content?: unknown; is_error?: unknown }
          if (typeof trb.tool_use_id === 'string') {
            const output = stringifyToolResult(trb.content)
            next = completeTool(next, trb.tool_use_id, output, trb.is_error === true)
          }
        }
      }
      return next
    }

    if (msg.type === 'result') {
      const rm = msg as SDKResultMessage
      const meta = {
        ...state.meta,
        durationMs: Date.now() - state.startedAt,
        inputTokens: rm.usage?.input_tokens,
        outputTokens: rm.usage?.output_tokens,
        costUsd: rm.total_cost_usd,
      }
      // result.subtype 以 'error' 开头视为错误（含 error / error_max_turns /
      // error_max_budget_usd / error_during_execution）
      const isError = typeof rm.subtype === 'string' && rm.subtype.startsWith('error')
      if (isError) {
        const errMsg = rm.errors?.[0] ?? rm.subtype ?? 'Agent 运行出错'
        return {
          ...state,
          blocks: closeStreamingText(state.blocks),
          reasoning: { ...state.reasoning, active: false },
          terminal: 'error',
          footer: null,
          errorMsg: errMsg,
          meta,
        }
      }
      return {
        ...state,
        blocks: closeStreamingText(state.blocks),
        reasoning: { ...state.reasoning, active: false },
        terminal: 'done',
        footer: null,
        meta,
      }
    }

    return state
  }

  if (payload.kind === 'myyoda_event') {
    const evt = payload.event
    if (evt.type === 'model_resolved') {
      return { ...state, meta: { ...state.meta, model: evt.model } }
    }
    return state
  }

  return state
}

export function markInterrupted(state: RunState): RunState {
  return {
    ...state,
    blocks: closeStreamingText(state.blocks),
    reasoning: { ...state.reasoning, active: false },
    terminal: 'interrupted',
    footer: null,
  }
}

export function markIdleTimeout(state: RunState, minutes: number): RunState {
  return {
    ...state,
    blocks: closeStreamingText(state.blocks),
    reasoning: { ...state.reasoning, active: false },
    terminal: 'idle_timeout',
    footer: null,
    idleTimeoutMinutes: minutes,
  }
}

export function markError(state: RunState, message: string): RunState {
  return {
    ...state,
    blocks: closeStreamingText(state.blocks),
    reasoning: { ...state.reasoning, active: false },
    terminal: 'error',
    footer: null,
    errorMsg: message,
  }
}

/** 当外部确认 run 已结束但 state 仍是 running 时，兜底收尾。 */
export function finalizeIfRunning(state: RunState): RunState {
  if (state.terminal !== 'running') return state
  return {
    ...state,
    blocks: closeStreamingText(state.blocks),
    reasoning: { ...state.reasoning, active: false },
    terminal: 'done',
    footer: null,
  }
}
