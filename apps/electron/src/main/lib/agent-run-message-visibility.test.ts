import { describe, expect, test } from 'bun:test'
import type { SDKMessage } from '@myyoda/shared'
import { isMissingFinalTextAnswer, isVisibleRunMessage } from './agent-run-message-visibility'

describe('Agent 本轮可见消息判定', () => {
  test.each([
    { type: 'system', subtype: 'compacting' },
    { type: 'system', subtype: 'compact_boundary' },
    { type: 'system', subtype: 'status', compact_result: 'success' },
  ] as SDKMessage[])('Given /compact 返回压缩状态 %# When 判断本轮是否有可见内容 Then 不误报空回复', (message) => {
    expect(isVisibleRunMessage(message)).toBe(true)
  })

  test('Given SDK 仅返回不可展示的 init 和 result When 判断本轮是否有可见内容 Then 仍允许空回复保护接管', () => {
    expect(isVisibleRunMessage({ type: 'system', subtype: 'init' } as SDKMessage)).toBe(false)
    expect(isVisibleRunMessage({ type: 'result', subtype: 'success' } as SDKMessage)).toBe(false)
  })
})

describe('Agent 本轮"缺失最终文字结论"判定', () => {
  test('Given 本轮做了多次工具调用，最后一条 assistant 消息 stop_reason=stop 但只有 thinking When 判断是否缺失最终答复 Then 判定为缺失（复现 kimi 中途停止场景）', () => {
    const messages = [
      { type: 'assistant', message: { stop_reason: 'toolUse', content: [{ type: 'thinking', thinking: '看看代码' }, { type: 'tool_use', id: 't1', name: 'Read', input: {} }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
      { type: 'assistant', message: { stop_reason: 'stop', content: [{ type: 'thinking', thinking: '我觉得应该这样修……让我再想想' }] } },
    ] as unknown as SDKMessage[]
    expect(isMissingFinalTextAnswer(messages)).toBe(true)
  })

  test('Given 最后一条 assistant 消息 stop_reason=stop 且带有非空 text When 判断是否缺失最终答复 Then 判定为不缺失', () => {
    const messages = [
      { type: 'assistant', message: { stop_reason: 'stop', content: [{ type: 'thinking', thinking: '分析完毕' }, { type: 'text', text: '修复完成 ✅' }] } },
    ] as unknown as SDKMessage[]
    expect(isMissingFinalTextAnswer(messages)).toBe(false)
  })

  test('Given 最后一条 assistant 消息 stop_reason=toolUse（仍在等待工具结果） When 判断是否缺失最终答复 Then 判定为不缺失（非终止态不在判定范围）', () => {
    const messages = [
      { type: 'assistant', message: { stop_reason: 'toolUse', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }] } },
    ] as unknown as SDKMessage[]
    expect(isMissingFinalTextAnswer(messages)).toBe(false)
  })

  test('Given 本轮没有任何 assistant 消息 When 判断是否缺失最终答复 Then 判定为不缺失（交给既有空回复保护处理）', () => {
    const messages = [
      { type: 'user', message: { content: [{ type: 'text', text: '你好' }] } },
    ] as unknown as SDKMessage[]
    expect(isMissingFinalTextAnswer(messages)).toBe(false)
  })

  test('Given 最后一条 assistant 消息已带有 error 字段 When 判断是否缺失最终答复 Then 判定为不缺失（避免与已有错误提示重复）', () => {
    const messages = [
      { type: 'assistant', error: { message: '网络错误', errorType: 'network_error' }, message: { stop_reason: 'stop', content: [{ type: 'thinking', thinking: '……' }] } },
    ] as unknown as SDKMessage[]
    expect(isMissingFinalTextAnswer(messages)).toBe(false)
  })

  test('Given 最后一条真实 assistant 消息之后只跟着 replay 消息 When 判断是否缺失最终答复 Then 跳过 replay 消息，仍按真实消息判定', () => {
    const messages = [
      { type: 'assistant', message: { stop_reason: 'stop', content: [{ type: 'text', text: '之前已经回答过了' }] } },
      { type: 'assistant', isReplay: true, message: { stop_reason: 'stop', content: [{ type: 'thinking', thinking: '重放的历史消息，不应影响判定' }] } },
    ] as unknown as SDKMessage[]
    expect(isMissingFinalTextAnswer(messages)).toBe(false)
  })
})
