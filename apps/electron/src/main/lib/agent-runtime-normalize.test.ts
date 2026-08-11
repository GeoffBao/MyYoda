import { describe, expect, test } from 'bun:test'
import { normalizeAgentRuntime } from './agent-runtime-normalize'

describe('Agent runtime 归一化（Claude runtime 已退役）', () => {
  test('Given 任意渠道和输入 When 归一化 Then 恒为 pi', () => {
    // Claude runtime 已于 2026-08 退役，所有执行统一走 Pi。
    // anthropic-oauth（Claude Pro/Max 订阅登录）通过 PiAgent 的 anthropic provider 桥接。
    expect(normalizeAgentRuntime()).toBe('pi')
    expect(normalizeAgentRuntime('pi')).toBe('pi')
    expect(normalizeAgentRuntime(undefined, 'anthropic-oauth')).toBe('pi')
    expect(normalizeAgentRuntime(undefined, 'openai-codex')).toBe('pi')
    expect(normalizeAgentRuntime(undefined, 'xai')).toBe('pi')
  })
})
