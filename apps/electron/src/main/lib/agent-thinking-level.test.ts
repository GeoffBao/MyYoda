import { describe, expect, test } from 'bun:test'
import { resolvePiThinkingLevel } from './agent-thinking-level'

describe('Pi thinking level resolver', () => {
  test('Given session override When resolving Then uses the per-session level for any provider', () => {
    expect(resolvePiThinkingLevel(
      { agentThinking: { type: 'adaptive' }, agentEffort: 'medium' },
      { thinkingLevel: 'off' },
      'anthropic',
    )).toBe('off')

    expect(resolvePiThinkingLevel(
      { agentThinking: { type: 'adaptive' }, agentEffort: 'medium' },
      { openAIThinkingLevel: 'xhigh' },
      'openai-codex',
    )).toBe('xhigh')
  })

  test('Given thinkingLevel and legacy openAIThinkingLevel When both set Then prefers thinkingLevel', () => {
    expect(resolvePiThinkingLevel(
      {},
      { thinkingLevel: 'low', openAIThinkingLevel: 'high' },
      'anthropic',
    )).toBe('low')
  })

  test.each(['openai', 'openai-responses', 'custom', 'anthropic'] as const)(
    'Given %s GPT-5.6 When session has max override Then uses it',
    (provider) => {
      expect(resolvePiThinkingLevel(
        { agentThinking: { type: 'adaptive' }, agentEffort: 'medium' },
        { thinkingLevel: 'max' },
        provider,
        'gpt-5.6-terra',
      )).toBe('max')
    },
  )

  test('Given a persisted max override When switching to a non GPT-5.6 model Then clamps it to xhigh', () => {
    expect(resolvePiThinkingLevel(
      { agentThinking: { type: 'adaptive' }, agentEffort: 'medium' },
      { thinkingLevel: 'max' },
      'custom',
      'gpt-5.5',
    )).toBe('xhigh')
  })

  test('Given no session override When defaultThinkingLevel is set Then uses app default', () => {
    expect(resolvePiThinkingLevel(
      { defaultThinkingLevel: 'medium', agentEffort: 'high' },
      undefined,
      'anthropic',
    )).toBe('medium')
  })

  test('Given defaultThinkingLevel=max on a non GPT-5.6 model When resolving Then maps it to xhigh', () => {
    expect(resolvePiThinkingLevel(
      { defaultThinkingLevel: 'max', agentEffort: 'high' },
      undefined,
      'custom',
      'gpt-5.5',
    )).toBe('xhigh')
  })

  test('Given no session override When global max effort is selected Then maps it to xhigh', () => {
    expect(resolvePiThinkingLevel(
      { agentThinking: { type: 'adaptive' }, agentEffort: 'max' },
      undefined,
      'openai-responses',
    )).toBe('xhigh')
  })

  test('Given agentThinking disabled and no session override Then returns off', () => {
    expect(resolvePiThinkingLevel(
      { agentThinking: { type: 'disabled' }, agentEffort: 'high' },
      undefined,
      'anthropic',
    )).toBe('off')
  })
})

describe('A1 Coding 模式', () => {
  test('Given codingMode 开启且无会话级覆盖 When 解析 Then 默认 max', () => {
    expect(resolvePiThinkingLevel(
      { agentThinking: { type: 'adaptive' }, codingMode: true },
      undefined,
      'deepseek',
      'deepseek-v4-pro',
    )).toBe('max')
  })

  test('Given codingMode 开启但会话级设置存在 When 解析 Then 会话级优先', () => {
    expect(resolvePiThinkingLevel(
      { agentThinking: { type: 'adaptive' }, codingMode: true },
      { thinkingLevel: 'off' },
      'deepseek',
      'deepseek-v4-pro',
    )).toBe('off')
  })

  test('Given codingMode 关闭 When 解析 Then 走默认思考深度', () => {
    expect(resolvePiThinkingLevel(
      { agentThinking: { type: 'adaptive' }, codingMode: false, defaultThinkingLevel: 'high' },
      undefined,
      'deepseek',
      'deepseek-v4-pro',
    )).toBe('high')
  })
})

describe('A1 编码优化总开关（optimizedCoding 兼容）', () => {
  test('Given optimizedCoding 开启且无会话级覆盖 When 解析 Then 默认 max', () => {
    expect(resolvePiThinkingLevel(
      { agentThinking: { type: 'adaptive' }, optimizedCoding: true },
      undefined,
      'deepseek',
      'deepseek-v4-pro',
    )).toBe('max')
  })

  test('Given optimizedCoding 优先于旧 codingMode 字段（均为 true 时一致）', () => {
    expect(resolvePiThinkingLevel(
      { agentThinking: { type: 'adaptive' }, optimizedCoding: true, codingMode: false },
      undefined,
      'deepseek',
      'deepseek-v4-pro',
    )).toBe('max')
  })

  test('Given 两个开关均未设置 When 解析 Then 走默认思考深度', () => {
    expect(resolvePiThinkingLevel(
      { agentThinking: { type: 'adaptive' }, defaultThinkingLevel: 'high' },
      undefined,
      'deepseek',
      'deepseek-v4-pro',
    )).toBe('high')
  })
})
