import type { SDKAssistantMessage, SDKMessage, SDKSystemMessage } from '@myyoda/shared'
import { isPersistableSDKSystemMessage } from '@myyoda/shared'

function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

/** 判断本轮 SDK 消息中是否包含用户最终能看到的内容。 */
export function isVisibleRunMessage(message: SDKMessage): boolean {
  const msgRecord = message as Record<string, unknown>
  if (msgRecord.isReplay) return false

  if (message.type === 'assistant') {
    const assistantMsg = message as SDKAssistantMessage
    if (assistantMsg.error) return true
    const content = assistantMsg.message?.content
    if (!Array.isArray(content)) return false
    return content.some((block) => {
      if (block.type === 'text') return isNonEmptyString((block as { text?: unknown }).text)
      if (block.type === 'thinking') return isNonEmptyString((block as { thinking?: unknown }).thinking)
      if (block.type === 'tool_use') return true
      return Object.keys(block).length > 1
    })
  }

  if (message.type === 'user') {
    const content = (message as { message?: { content?: Array<{ type: string }> } }).message?.content
    return Array.isArray(content) && content.some((block) => block.type === 'tool_result')
  }

  if (message.type === 'system') {
    const systemMessage = message as SDKSystemMessage
    return isPersistableSDKSystemMessage(systemMessage)
      || systemMessage.subtype === 'task_started'
      || systemMessage.subtype === 'task_progress'
      || systemMessage.subtype === 'task_notification'
  }

  return false
}

/**
 * 判断本轮是否"有活动但没有最终文字结论"：模型执行了工具调用等操作（因此
 * isVisibleRunMessage 已判定本轮非空），但最后一条 assistant 消息以
 * stop_reason === 'stop'（模型自认为本轮已正式结束，而非还在等待工具结果）收尾，
 * 内容里却没有任何非空 text block（thinking 不算数）。
 *
 * 这类场景下 visibleRunMessageCount 早已因为中途的 tool_use / tool_result 而大于 0，
 * 不会触发"整轮全空"的空回复保护，用户会看到一堆工具调用后戛然而止、没有任何回复。
 * 从最后一条 assistant 消息倒序查找，跳过 replay 消息与非终止态消息；
 * 若该消息已经带有 error 字段，说明已有专门的错误提示，此处不重复判定。
 */
export function isMissingFinalTextAnswer(messages: SDKMessage[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (!msg) continue
    if ((msg as Record<string, unknown>).isReplay) continue
    if (msg.type !== 'assistant') continue
    const assistantMsg = msg as SDKAssistantMessage
    if (assistantMsg.error) return false
    if (assistantMsg.message?.stop_reason !== 'stop') return false
    const content = assistantMsg.message?.content
    const hasText = Array.isArray(content)
      && content.some((block) => block.type === 'text' && isNonEmptyString((block as { text?: unknown }).text))
    return !hasText
  }
  return false
}
