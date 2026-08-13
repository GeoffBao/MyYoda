import { describe, test, expect } from 'bun:test'
import { computeStreaks, computeTodayBucket, scanSessionLines } from './agent-usage'
import type { SessionUsageAgg } from './agent-usage'

function userMsg(day: string, hour = 9): string {
  const iso = `${day}T${String(hour).padStart(2, '0')}:00:00Z`
  return JSON.stringify({ type: 'user', _createdAt: Date.parse(iso), message: { content: [{ type: 'text', text: 'hi' }] } })
}

function assistantMsg(day: string, hour = 10): string {
  const iso = `${day}T${String(hour).padStart(2, '0')}:00:00Z`
  return JSON.stringify({ type: 'assistant', _createdAt: Date.parse(iso), message: { content: [{ type: 'text', text: 'hi' }] } })
}

function resultMsg(day: string, opts: { input?: number; output?: number; cacheRead?: number; cacheCreation?: number; cost?: number; model?: string; hour?: number }): string {
  const hour = opts.hour ?? 11
  const iso = `${day}T${String(hour).padStart(2, '0')}:00:00Z`
  const model = opts.model ?? 'claude-sonnet-4'
  return JSON.stringify({
    type: 'result',
    subtype: 'success',
    _createdAt: Date.parse(iso),
    total_cost_usd: opts.cost ?? 0.5,
    usage: {
      input_tokens: opts.input ?? 100,
      output_tokens: opts.output ?? 50,
      cache_read_input_tokens: opts.cacheRead ?? 20,
      cache_creation_input_tokens: opts.cacheCreation ?? 5,
    },
    modelUsage: {
      [model]: {
        inputTokens: opts.input ?? 100,
        outputTokens: opts.output ?? 50,
        cacheReadInputTokens: opts.cacheRead ?? 20,
        cacheCreationInputTokens: opts.cacheCreation ?? 5,
        costUSD: opts.cost ?? 0.5,
      },
    },
    _channelModelId: model,
    _channelProvider: 'anthropic',
  })
}

const META = { id: 's1', createdAt: Date.parse('2026-08-01T00:00:00Z'), title: 'T', channelId: 'c1', workspaceId: 'w1' }

describe('agent-usage scanSessionLines', () => {
  test('result 消息累加 token / cost，并计入按模型拆分', () => {
    const lines = [resultMsg('2026-08-01', { input: 100, output: 50, cacheRead: 20, cacheCreation: 5, cost: 0.5, model: 'claude-sonnet-4' })]
    const agg = scanSessionLines(lines, META)
    const day = agg.days['2026-08-01']
    expect(day).toBeDefined()
    expect(day!.totalTokens).toBe(100 + 50 + 5)
    expect(day!.inputTokens).toBe(100)
    expect(day!.outputTokens).toBe(50)
    expect(day!.cacheReadTokens).toBe(20)
    expect(day!.cacheCreationTokens).toBe(5)
    expect(day!.costUsd).toBe(0.5)
    expect(day!.models['claude-sonnet-4']!.inputTokens).toBe(100)
    expect(day!.models['claude-sonnet-4']!.resultCount).toBe(1)
    // result 不计 message 数
    expect(day!.messages).toBe(0)
  })

  test('同模型多条 result 累加 resultCount；modelUsage 多模型分别计数', () => {
    const a = resultMsg('2026-08-01', { model: 'claude-sonnet-4', input: 10 })
    const b = resultMsg('2026-08-01', { model: 'claude-sonnet-4', input: 20 })
    const c = resultMsg('2026-08-01', { model: 'deepseek-v4-flash', input: 30 })
    const agg = scanSessionLines([a, b, c], META)
    const day = agg.days['2026-08-01']!
    expect(day.models['claude-sonnet-4']!.resultCount).toBe(2)
    expect(day.models['deepseek-v4-flash']!.resultCount).toBe(1)
  })

  test('tool_result 回传与纯工具调用不计入真实对话消息数', () => {
    const toolResultUser = JSON.stringify({
      type: 'user',
      _createdAt: Date.parse('2026-08-01T09:00:00Z'),
      message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
    })
    const toolUseAssistant = JSON.stringify({
      type: 'assistant',
      _createdAt: Date.parse('2026-08-01T10:00:00Z'),
      message: { content: [{ type: 'tool_use', id: 't1', name: 'bash', input: {} }] },
    })
    const lines = [toolResultUser, toolUseAssistant, assistantMsg('2026-08-01', 11), userMsg('2026-08-01', 9)]
    const agg = scanSessionLines(lines, META)
    expect(agg.days['2026-08-01']!.messages).toBe(2)
  })

  test('user + assistant 消息计 message 数并写进小时槽', () => {
    const lines = [userMsg('2026-08-01', 9), assistantMsg('2026-08-01', 10)]
    const agg = scanSessionLines(lines, META)
    const day = agg.days['2026-08-01']
    expect(day!.messages).toBe(2)
    expect(day!.hourlyMessages[9]).toBe(1)
    expect(day!.hourlyMessages[10]).toBe(1)
  })

  test('isSyntheticCompactionResult 的 result 不计入（避免把压缩开销当真实用量）', () => {
    const msg = JSON.stringify({ type: 'result', subtype: 'success', isSyntheticCompactionResult: true, _createdAt: Date.parse('2026-08-01T00:00:00Z'), usage: { input_tokens: 999, output_tokens: 999 } })
    const agg = scanSessionLines([msg], META)
    expect(agg.days['2026-08-01']).toBeUndefined()
  })

  test('缺失 _createdAt 时回退到会话 createdAt', () => {
    const msg = JSON.stringify({ type: 'user', message: { role: 'user', content: [] } })
    const agg = scanSessionLines([msg], { ...META, createdAt: Date.parse('2026-08-05T00:00:00Z') })
    expect(agg.days['2026-08-05']!.messages).toBe(1)
  })

  test('损坏行被跳过，不影响其它消息', () => {
    const lines = ['{bad json', userMsg('2026-08-01'), resultMsg('2026-08-01', {})]
    const agg = scanSessionLines(lines, META)
    const day = agg.days['2026-08-01']
    expect(day!.messages).toBe(1)
    expect(day!.totalTokens).toBeGreaterThan(0)
  })

  test('modelUsage 缺失时按 _channelModelId 兜底把聚合 usage 归到该模型', () => {
    const msg = JSON.stringify({
      type: 'result',
      subtype: 'success',
      _createdAt: Date.parse('2026-08-01T00:00:00Z'),
      _channelModelId: 'claude-haiku',
      total_cost_usd: 0.1,
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2, cache_creation_input_tokens: 1 },
    })
    const agg = scanSessionLines([msg], META)
    const day = agg.days['2026-08-01']
    expect(day!.models['claude-haiku']!.inputTokens).toBe(10)
    expect(day!.models['claude-haiku']!.costUsd).toBe(0.1)
  })

  test('result._channelProvider 写入模型聚合的 provider 字段（modelUsage 路径）', () => {
    const lines = [resultMsg('2026-08-01', { model: 'claude-sonnet-4' })]
    const agg = scanSessionLines(lines, META)
    expect(agg.days['2026-08-01']!.models['claude-sonnet-4']!.provider).toBe('anthropic')
  })

  test('result._channelProvider 写入模型聚合的 provider 字段（_channelModelId 兜底路径）', () => {
    const msg = JSON.stringify({
      type: 'result',
      subtype: 'success',
      _createdAt: Date.parse('2026-08-01T00:00:00Z'),
      _channelModelId: 'claude-haiku',
      _channelProvider: 'deepseek',
      usage: { input_tokens: 10, output_tokens: 5 },
    })
    const agg = scanSessionLines([msg], META)
    expect(agg.days['2026-08-01']!.models['claude-haiku']!.provider).toBe('deepseek')
  })

  test('同一模型后续消息缺失 provider 时不覆盖已记录的值', () => {
    const lines = [
      resultMsg('2026-08-01', { model: 'claude-sonnet-4', hour: 9 }),
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        _createdAt: Date.parse('2026-08-01T10:00:00Z'),
        modelUsage: { 'claude-sonnet-4': { inputTokens: 1, outputTokens: 1 } },
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    ]
    const agg = scanSessionLines(lines, META)
    expect(agg.days['2026-08-01']!.models['claude-sonnet-4']!.provider).toBe('anthropic')
  })

  test('既无 modelUsage 也无 _channelModelId 时归到 unknown key', () => {
    const msg = JSON.stringify({
      type: 'result',
      subtype: 'success',
      _createdAt: Date.parse('2026-08-01T00:00:00Z'),
      usage: { input_tokens: 10, output_tokens: 5 },
    })
    const agg = scanSessionLines([msg], META)
    expect(agg.days['2026-08-01']!.models['unknown']).toBeDefined()
  })
})

describe('agent-usage computeTodayBucket', () => {
  test('无会话时返回全零结果', () => {
    const today = computeTodayBucket([], Date.now())
    expect(today.totalTokens).toBe(0)
    expect(today.messages).toBe(0)
    expect(today.models).toEqual([])
  })

  test('只汇总今天的数据，忽略其它日期', () => {
    const now = Date.now()
    const todayKey = toLocalDay(0)
    const yesterdayKey = toLocalDay(-1)
    const sessions: SessionUsageAgg[] = [
      {
        id: 's1',
        fingerprint: { size: 0, mtimeMs: 0 },
        createdAt: now,
        title: 'T1',
        days: {
          [todayKey]: {
            messages: 3,
            totalTokens: 155,
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 20,
            cacheCreationTokens: 5,
            costUsd: 0.5,
            models: { 'claude-sonnet-4': { resultCount: 1, inputTokens: 100, outputTokens: 50, cacheReadTokens: 20, cacheCreationTokens: 5, costUsd: 0.5, provider: 'anthropic' } },
            hourlyMessages: new Array(24).fill(0),
          },
          [yesterdayKey]: {
            messages: 99,
            totalTokens: 9999,
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            costUsd: 0,
            models: {},
            hourlyMessages: new Array(24).fill(0),
          },
        },
      },
    ]
    const today = computeTodayBucket(sessions, now)
    expect(today.day).toBe(todayKey)
    expect(today.messages).toBe(3)
    expect(today.totalTokens).toBe(155)
    expect(today.models).toEqual([{ modelId: 'claude-sonnet-4', provider: 'anthropic', totalTokens: 155 }])
  })

  test('跨多个会话累加同一天的数据', () => {
    const now = Date.now()
    const todayKey = toLocalDay(0)
    const dayFixture = {
      messages: 1,
      totalTokens: 10,
      inputTokens: 10,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 0.01,
      models: {},
      hourlyMessages: new Array(24).fill(0),
    }
    const sessions: SessionUsageAgg[] = [
      { id: 's1', fingerprint: { size: 0, mtimeMs: 0 }, createdAt: now, title: 'T1', days: { [todayKey]: dayFixture } },
      { id: 's2', fingerprint: { size: 0, mtimeMs: 0 }, createdAt: now, title: 'T2', days: { [todayKey]: dayFixture } },
    ]
    const today = computeTodayBucket(sessions, now)
    expect(today.messages).toBe(2)
    expect(today.totalTokens).toBe(20)
  })
})

describe('agent-usage computeStreaks', () => {
  test('无活跃日', () => {
    expect(computeStreaks(new Set())).toEqual({ currentStreak: 0, longestStreak: 0 })
  })

  test('最长连续与当前连续一致（含今天）', () => {
    const days = new Set([toLocalDay(-2), toLocalDay(-1), toLocalDay(0)])
    expect(computeStreaks(days).longestStreak).toBe(3)
    expect(computeStreaks(days).currentStreak).toBe(3)
  })

  test('今天没有但昨天有 → 当前连续从昨天数起', () => {
    const days = new Set([toLocalDay(-2), toLocalDay(-1)])
    expect(computeStreaks(days).currentStreak).toBe(2)
  })

  test('中断后最长连续取最大段', () => {
    // 连续段 [d-3,d-2] 长度2，[d-1,d0] 长度2 → longest 2
    const days = new Set([toLocalDay(-3), toLocalDay(-2), toLocalDay(-1), toLocalDay(0)])
    expect(computeStreaks(days).longestStreak).toBe(4)
  })

  test('完全断开时当前连续为 0', () => {
    const days = new Set([toLocalDay(-5)])
    expect(computeStreaks(days).currentStreak).toBe(0)
  })
})

/** 生成距今天 offset 天的本地 YYYY-MM-DD（computeStreaks 按本地时区） */
function toLocalDay(offsetDays: number): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + offsetDays)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
