import type { SDKAssistantMessage, SDKMessage } from '@myyoda/shared'

/** Bridge 只消费稳定的 message_end 投影；实时 Pi delta 由各自的流式状态机处理。 */
export function extractFinalAssistantText(message: SDKMessage): string {
  if (message.type !== 'assistant') return ''

  const assistant = message as SDKAssistantMessage
  return (assistant.message?.content ?? [])
    .map((block) => block.type === 'text' && typeof block.text === 'string' ? block.text : '')
    .join('')
}
