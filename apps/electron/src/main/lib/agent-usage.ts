/**
 * 跨会话 Agent 用量聚合层。
 *
 * 用途：设置「用量」Tab 的数据源 —— Overview（八宫格 + 贡献热力图）与
 * Models（按天堆叠 + 按模型明细表）都从这里取数。
 *
 * 数据源：
 * - `agent-sessions.json` 索引：会话元数据（id / createdAt / channelId / workspaceId）
 * - `agent-sessions/{id}.jsonl`：逐消息 SDK 记录
 *
 * 关键口径：
 * - **Token / 成本只从 `result` 消息取**：每条 `result`（subtype=success/error_*）是一次
 *   Agent 运行的权威用量，自带聚合 `usage`（input/output/cache）+ 按模型拆分的 `modelUsage`
 *   + `total_cost_usd`。把它按天累加即得到"被计费的总 token"，不会与逐消息 usage 重复计数。
 * - **「总 Token」口径 = input + output + cache_creation（新消耗），排除 cache_read**：
 *   cache_read 是模型重读历史上下文的廉价 token（通常占大头，但不代表真实新消耗），
 *   用独立的 `cacheReadTokens` 字段累计展示，与 Claude Code `/usage`（input/output/cache
 *   read/cache write 分列）一致。
 * - **Messages 数 = 真实对话**：user 排除 tool_result（工具结果回传），assistant 只计含
 *   text 的回复（纯 thinking / tool_use 的工具往返不计）。
 * - **按天 / 按小时 / streak / 热力图** 都从 `_createdAt`（毫秒）推导。
 *
 * 性能：增量聚合缓存 `~/.myyoda/agent-usage-cache.json`，以会话 JSONL 的 (size, mtimeMs)
 * 作为指纹。指纹不变直接复用缓存，只重扫有变更的会话；避免每次打开设置都全量扫描历史。
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { getAgentSessionsDir, getAgentUsageCachePath } from './config-paths'
import { readJsonFileSafe, writeJsonFileAtomic } from './safe-file'
import type { SDKAssistantMessage, SDKResultMessage, SDKUserMessage, ProviderType } from '@myyoda/shared'

/** 用量时间范围 */
export type UsageRange = 'all' | '30d' | '7d' | 'month'

/** 单个模型在某范围 / 某天的用量汇总 */
export interface UsageModelAgg {
  /** 该模型 result 调用次数（每条带 usage 的 result 归属到模型时 +1） */
  resultCount: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  costUsd: number
  /** 供应商类型，取自 result._channelProvider（SDK 每条 result 都会 stamp，无需再查渠道配置） */
  provider?: ProviderType
}

/** 单个自然日（本地时区 YYYY-MM-DD）的用量 */
export interface UsageDayAgg {
  /** 该日 user + assistant 消息数 */
  messages: number
  /** 该日 result 聚合 token（input + cache_read + cache_creation + output） */
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  costUsd: number
  /** 按模型拆分 */
  models: Record<string, UsageModelAgg>
  /** 24 个小时槽的 message 数（用于 Peak hour） */
  hourlyMessages: number[]
}

/** 单个会话的聚合结果（cache 中的一个条目） */
export interface SessionUsageAgg {
  /** 会话 id */
  id: string
  /** 指纹：会话 JSONL 的 (size, mtimeMs)，用于判断是否需要重扫 */
  fingerprint: { size: number; mtimeMs: number }
  /** 会话创建时间（毫秒） */
  createdAt: number
  /** 会话标题 */
  title: string
  channelId?: string
  workspaceId?: string
  /** 按天聚合 */
  days: Record<string, UsageDayAgg>
}

/** 增量聚合缓存文件结构 */
interface UsageCacheFile {
  version: number
  sessions: Record<string, SessionUsageAgg>
}

// v2：模型聚合新增 provider 字段（从 result._channelProvider 取），旧缓存没有该字段，
// 版本号变化触发一次全量重扫以回填，而不是让老会话永远显示"未知渠道"。
// v4：修复 aggregate 合并时漏合各天的 models，导致按模型堆叠柱状图拿不到分段数据、柱子透明。
// v3：总 Token 口径改为新消耗（排除 cache_read），消息数改为真实对话（排除工具往返），
// 旧缓存的 totalTokens/messages 口径不同，需全量重扫一次。
// v5：模型聚合新增 resultCount（result 调用次数）字段，旧缓存模型没有该字段，需重扫回填。
const CACHE_VERSION = 5

/** 汇总后的单模型行（供 Models Tab 明细表） */
export interface UsageModelRow {
  modelId: string
  /** 供应商类型，缺失时前端展示"未知渠道"（不再回退到无意义的 channelId UUID） */
  provider?: ProviderType
  /** 该模型 result 调用次数 */
  resultCount: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  totalTokens: number
  costUsd: number
}

/** 汇总后的按天序列（供热力图 + 按天堆叠柱状图） */
export interface UsageDayPoint {
  day: string
  messages: number
  totalTokens: number
  /** 按模型拆分（仅包含范围内有量的模型） */
  models: Array<{ modelId: string; totalTokens: number; inputTokens: number; outputTokens: number }>
}

/** 单个模型在"今天"的用量（供今日用量卡片） */
export interface UsageTodayModel {
  modelId: string
  provider?: ProviderType
  totalTokens: number
}

/** "今天"（本地时区自然日）的用量汇总，不受 Range（All/30d/7d）选择器影响 */
export interface UsageToday {
  day: string
  messages: number
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  costUsd: number
  models: UsageTodayModel[]
}

/** Overview 八宫格指标 */
export interface UsageOverview {
  sessions: number
  messages: number
  totalTokens: number
  /** 缓存读取 token 汇总（重读历史上下文的廉价 token，不计入 totalTokens） */
  cacheReadTokens: number
  activeDays: number
  currentStreak: number
  longestStreak: number
  /** 0-23 */
  peakHour: number
  favoriteModel?: string
}

/** 「用量」Tab 的完整聚合响应 */
export interface AgentUsageStats {
  range: UsageRange
  overview: UsageOverview
  /** 按天序列（倒序，最新在前） */
  days: UsageDayPoint[]
  /** 按模型明细（倒序，token 多者在前） */
  models: UsageModelRow[]
  /** 今天（本地自然日）的用量，固定统计，不受 range 过滤 */
  today: UsageToday
  /** 是否命中缓存（调试/展示用） */
  fromCache: boolean
}

/** 时间范围 → 起始日（本地零点毫秒）；all 返回 0 */
function rangeStart(range: UsageRange, now: number): number {
  if (range === 'all') return 0
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  if (range === 'month') {
    // 自然月：本月 1 号零点
    start.setDate(1)
    return start.getTime()
  }
  const days = range === '30d' ? 30 : 7
  start.setDate(start.getDate() - (days - 1))
  return start.getTime()
}

/** 本地时区 dayKey：YYYY-MM-DD */
function toDayKey(ts: number): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function newDayAgg(): UsageDayAgg {
  return {
    messages: 0,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0,
    models: {},
    hourlyMessages: new Array(24).fill(0),
  }
}

function ensureModel(day: UsageDayAgg, modelId: string): UsageModelAgg {
  let m = day.models[modelId]
  if (!m) {
    m = {
      resultCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 0,
    }
    day.models[modelId] = m
  }
  return m
}

/** 首次遇到某模型时记下它的供应商；同一 modelId 后续出现 provider 缺失也不覆盖已知值 */
function stampProvider(agg: UsageModelAgg, provider: ProviderType | undefined): void {
  if (!agg.provider && provider) agg.provider = provider
}

/** 是否含 tool_result 内容块（工具结果回传，非真实用户输入） */
function isToolResultUser(user: SDKUserMessage): boolean {
  const blocks = user.message?.content ?? []
  return blocks.some((block) => block.type === 'tool_result')
}

/** 是否含 text 内容块（有实际文本输出，而非纯思考 / 工具调用） */
function hasTextBlock(asst: SDKAssistantMessage): boolean {
  const blocks = asst.message?.content ?? []
  return blocks.some((block) => block.type === 'text')
}

/** 新消耗 token：新输入 + 新写缓存 + 输出，排除缓存读取（重读旧上下文） */
function sumFreshTokens(agg: { inputTokens: number; outputTokens: number; cacheCreationTokens: number }): number {
  return agg.inputTokens + agg.outputTokens + agg.cacheCreationTokens
}

interface ResultUsage {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

interface ModelUsageEntry {
  inputTokens?: number
  outputTokens?: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
  costUSD?: number
}

/**
 * 扫描单个会话 JSONL，产出按天聚合。
 *
 * 只从 `result` 消息累加 token / cost / 模型拆分；user + assistant 计 message 数。
 */
function scanSessionFile(filePath: string, meta: { id: string; createdAt: number; title: string; channelId?: string; workspaceId?: string }): SessionUsageAgg {
  let lines: string[]
  try {
    lines = readFileSync(filePath, 'utf-8').split('\n')
  } catch {
    // 文件不可读（被删除/损坏）时返回空聚合，调用方仍会缓存指纹以跳过反复报错
    return {
      id: meta.id,
      fingerprint: { size: 0, mtimeMs: 0 },
      createdAt: meta.createdAt,
      title: meta.title,
      channelId: meta.channelId,
      workspaceId: meta.workspaceId,
      days: {},
    }
  }
  return scanSessionLines(lines, meta)
}

/**
 * 从 JSONL 行数组聚合单个会话（纯函数，便于单测）。
 */
export function scanSessionLines(
  lines: string[],
  meta: { id: string; createdAt: number; title: string; channelId?: string; workspaceId?: string },
): SessionUsageAgg {
  const days: Record<string, UsageDayAgg> = {}

  for (const line of lines) {
    if (!line || !line.trim()) continue
    let msg: { type?: string }
    try {
      msg = JSON.parse(line)
    } catch {
      continue
    }

    const ts = (msg as { _createdAt?: number })._createdAt
    const createdAt = typeof ts === 'number' ? ts : meta.createdAt
    const dayKey = toDayKey(createdAt)

    if (msg.type === 'result') {
      const result = msg as SDKResultMessage
      const usage = result.usage as ResultUsage | undefined
      if (!usage || result.isSyntheticCompactionResult) continue

      const input = usage.input_tokens ?? 0
      const output = usage.output_tokens ?? 0
      const cacheRead = usage.cache_read_input_tokens ?? 0
      const cacheCreation = usage.cache_creation_input_tokens ?? 0
      // 新消耗 token：排除缓存读取（重读旧上下文的廉价 token），与 Claude Code /usage 口径一致
      const total = input + output + cacheCreation
      const cost = result.total_cost_usd ?? 0
      const provider = result._channelProvider

      const day = days[dayKey] ?? (days[dayKey] = newDayAgg())
      day.totalTokens += total
      day.inputTokens += input
      day.outputTokens += output
      day.cacheReadTokens += cacheRead
      day.cacheCreationTokens += cacheCreation
      day.costUsd += cost

      // 按模型拆分：优先 result.modelUsage（权威），缺失时按 _channelModelId 兜底归到该模型
      const modelUsage = result.modelUsage as Record<string, ModelUsageEntry> | undefined
      if (modelUsage && Object.keys(modelUsage).length > 0) {
        for (const [modelId, entry] of Object.entries(modelUsage)) {
          const mi = ensureModel(day, modelId)
          mi.resultCount += 1
          mi.inputTokens += entry?.inputTokens ?? 0
          mi.outputTokens += entry?.outputTokens ?? 0
          mi.cacheReadTokens += entry?.cacheReadInputTokens ?? 0
          mi.cacheCreationTokens += entry?.cacheCreationInputTokens ?? 0
          mi.costUsd += entry?.costUSD ?? 0
          stampProvider(mi, provider)
          // modelUsage 是"调用发生"的记账，不重复累加 message 数（message 数统一在 user/assistant 计）
        }
      } else {
        const modelId = result._channelModelId ?? 'unknown'
        const mi = ensureModel(day, modelId)
        mi.resultCount += 1
        mi.inputTokens += input
        mi.outputTokens += output
        mi.cacheReadTokens += cacheRead
        mi.cacheCreationTokens += cacheCreation
        mi.costUsd += cost
        stampProvider(mi, provider)
      }
    } else if (msg.type === 'assistant') {
      const asst = msg as SDKAssistantMessage
      // 只统计含文本的回复；纯 thinking / tool_use 的工具往返不算真实对话消息
      if (!hasTextBlock(asst)) continue
      const day = days[dayKey] ?? (days[dayKey] = newDayAgg())
      day.messages += 1
      const hour = new Date(createdAt).getHours()
      day.hourlyMessages[hour] = (day.hourlyMessages[hour] ?? 0) + 1
    } else if (msg.type === 'user') {
      const user = msg as SDKUserMessage
      // 工具结果回传（tool_result）不算真实用户输入
      if (isToolResultUser(user)) continue
      const day = days[dayKey] ?? (days[dayKey] = newDayAgg())
      day.messages += 1
      const hour = new Date(createdAt).getHours()
      day.hourlyMessages[hour] = (day.hourlyMessages[hour] ?? 0) + 1
    }
  }

  return {
    id: meta.id,
    fingerprint: { size: 0, mtimeMs: 0 }, // 由调用方统一从 statSync 填写
    createdAt: meta.createdAt,
    title: meta.title,
    channelId: meta.channelId,
    workspaceId: meta.workspaceId,
    days,
  }
}

/** 统计自然日连续 streak（current：含今天/昨天的连续；longest：全范围最长连续） */
export function computeStreaks(activeDays: Set<string>): { currentStreak: number; longestStreak: number } {
  const sorted = Array.from(activeDays).sort()
  if (sorted.length === 0) return { currentStreak: 0, longestStreak: 0 }

  // 转成连续整数序号，便于判断相邻日
  const dayMap = new Map<string, number>()
  const epoch = new Date(sorted[0]!).getTime()
  for (const d of sorted) {
    dayMap.set(d, Math.round((new Date(d).getTime() - epoch) / 86400000))
  }
  const seq = Array.from(dayMap.values()).sort((a, b) => a - b)

  let longest = 1
  let cur = 1
  for (let i = 1; i < seq.length; i++) {
    if (seq[i] === seq[i - 1]! + 1) {
      cur += 1
      if (cur > longest) longest = cur
    } else {
      cur = 1
    }
  }

  // current streak：从今天（或昨天）往前数连续活跃日
  let currentStreak = 0
  const todayKey = toDayKey(Date.now())
  const todaySeq = dayMap.get(todayKey)
  const yesterdaySeq = dayMap.get(toDayKey(Date.now() - 86400000))
  const startSeq = todaySeq ?? yesterdaySeq
  if (startSeq !== undefined) {
    const set = new Set(seq)
    let s = startSeq
    while (set.has(s)) {
      currentStreak += 1
      s -= 1
    }
  }

  return { currentStreak, longestStreak: longest }
}

/**
 * 汇总"今天"（本地时区自然日）的用量。纯函数，不受 Range（All/30d/7d）选择器影响 ——
 * 用户切到 30d/7d 档位时依然能一眼看到当日消耗，不用切回 All 才能确认。
 */
export function computeTodayBucket(sessions: SessionUsageAgg[], now: number): UsageToday {
  const dayKey = toDayKey(now)
  const merged = newDayAgg()

  for (const sess of sessions) {
    const day = sess.days[dayKey]
    if (!day) continue
    merged.messages += day.messages
    merged.totalTokens += day.totalTokens
    merged.inputTokens += day.inputTokens
    merged.outputTokens += day.outputTokens
    merged.cacheReadTokens += day.cacheReadTokens
    merged.cacheCreationTokens += day.cacheCreationTokens
    merged.costUsd += day.costUsd
    for (const [modelId, m] of Object.entries(day.models)) {
      const target = ensureModel(merged, modelId)
      target.resultCount += m.resultCount ?? 0
      target.inputTokens += m.inputTokens
      target.outputTokens += m.outputTokens
      target.cacheReadTokens += m.cacheReadTokens
      target.cacheCreationTokens += m.cacheCreationTokens
      target.costUsd += m.costUsd
      stampProvider(target, m.provider)
    }
  }

  const models: UsageTodayModel[] = Object.entries(merged.models)
    .map(([modelId, m]) => ({
      modelId,
      provider: m.provider,
      totalTokens: sumFreshTokens(m),
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens)

  return {
    day: dayKey,
    messages: merged.messages,
    totalTokens: merged.totalTokens,
    inputTokens: merged.inputTokens,
    outputTokens: merged.outputTokens,
    cacheReadTokens: merged.cacheReadTokens,
    cacheCreationTokens: merged.cacheCreationTokens,
    costUsd: merged.costUsd,
    models,
  }
}

/** 合并某个时间范围内的所有会话聚合，产出统计响应 */
function aggregate(stats: AgentUsageStats, sessions: SessionUsageAgg[], rangeStartMs: number): AgentUsageStats {
  // 收集范围内所有有数据的 day
  const dayAggs = new Map<string, UsageDayAgg>()
  let totalSessions = 0
  let totalMessages = 0
  let totalTokens = 0
  let totalCacheRead = 0

  // 汇总所有模型行（跨天合并）
  const modelRows = new Map<string, UsageModelRow>()

  for (const sess of sessions) {
    // 会话是否在范围内（all 恒包含；否则按会话 createdAt 当天是否 ≥ rangeStart 判断，
    // 同时允许范围内有按天数据但 createdAt 早于范围的边界会话）
    for (const [dayKey, day] of Object.entries(sess.days)) {
      const dayStart = new Date(dayKey + 'T00:00:00').getTime()
      if (rangeStartMs > 0 && dayStart < rangeStartMs) continue

      let merged = dayAggs.get(dayKey)
      if (!merged) {
        merged = newDayAgg()
        dayAggs.set(dayKey, merged)
      }
      merged.messages += day.messages
      merged.totalTokens += day.totalTokens
      merged.inputTokens += day.inputTokens
      merged.outputTokens += day.outputTokens
      merged.cacheReadTokens += day.cacheReadTokens
      merged.cacheCreationTokens += day.cacheCreationTokens
      merged.costUsd += day.costUsd
      for (let h = 0; h < 24; h++) merged.hourlyMessages[h] = (merged.hourlyMessages[h] ?? 0) + (day.hourlyMessages[h] ?? 0)
      for (const [modelId, m] of Object.entries(day.models)) {
        // 合并到该日的 models（供按天堆叠柱状图使用）
        const dayModel = ensureModel(merged, modelId)
        dayModel.resultCount += m.resultCount ?? 0
        dayModel.inputTokens += m.inputTokens
        dayModel.outputTokens += m.outputTokens
        dayModel.cacheReadTokens += m.cacheReadTokens
        dayModel.cacheCreationTokens += m.cacheCreationTokens
        dayModel.costUsd += m.costUsd
        stampProvider(dayModel, m.provider)

        // 合并到全局模型明细行
        const row = modelRows.get(modelId) ?? {
          modelId,
          provider: undefined,
          resultCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          totalTokens: 0,
          costUsd: 0,
        }
        row.inputTokens += m.inputTokens
        row.outputTokens += m.outputTokens
        row.cacheReadTokens += m.cacheReadTokens
        row.cacheCreationTokens += m.cacheCreationTokens
        row.resultCount += m.resultCount ?? 0
        row.totalTokens = sumFreshTokens(row)
        row.costUsd += m.costUsd
        if (!row.provider && m.provider) row.provider = m.provider
        modelRows.set(modelId, row)
      }
      // 会话计数：该会话只要在范围内有一天的数据就计入
    }
  }

  // 会话数按"范围内有活动的会话"计
  const sessionWithActivity = new Set<string>()
  for (const sess of sessions) {
    let hasActivity = false
    for (const [dayKey] of Object.entries(sess.days)) {
      const dayStart = new Date(dayKey + 'T00:00:00').getTime()
      if (rangeStartMs === 0 || dayStart >= rangeStartMs) {
        hasActivity = true
        break
      }
    }
    if (hasActivity) sessionWithActivity.add(sess.id)
  }
  totalSessions = sessionWithActivity.size

  for (const day of dayAggs.values()) {
    totalMessages += day.messages
    totalTokens += day.totalTokens
    totalCacheRead += day.cacheReadTokens
  }

  // 活跃天数 / streak
  const activeDays = new Set(dayAggs.keys())
  const streaks = computeStreaks(activeDays)

  // Peak hour
  let peakHour = 0
  let peakCount = 0
  for (let h = 0; h < 24; h++) {
    let count = 0
    for (const day of dayAggs.values()) count += day.hourlyMessages[h] ?? 0
    if (count > peakCount) {
      peakCount = count
      peakHour = h
    }
  }

  // Favorite model（token 最多）
  let favoriteModel: string | undefined
  let favTokens = 0
  for (const [modelId, row] of modelRows) {
    if (row.totalTokens > favTokens) {
      favTokens = row.totalTokens
      favoriteModel = modelId
    }
  }

  // 按天序列（倒序）
  const days: UsageDayPoint[] = Array.from(dayAggs.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([day, agg]) => ({
      day,
      messages: agg.messages,
      totalTokens: agg.totalTokens,
      models: Object.entries(agg.models)
        .map(([modelId, m]) => ({
          modelId,
          totalTokens: sumFreshTokens(m),
          inputTokens: m.inputTokens,
          outputTokens: m.outputTokens,
        }))
        .sort((a, b) => b.totalTokens - a.totalTokens),
    }))

  // 按模型明细（倒序）
  const models: UsageModelRow[] = Array.from(modelRows.values())
    .sort((a, b) => b.totalTokens - a.totalTokens)

  stats.overview = {
    sessions: totalSessions,
    messages: totalMessages,
    totalTokens,
    cacheReadTokens: totalCacheRead,
    activeDays: activeDays.size,
    currentStreak: streaks.currentStreak,
    longestStreak: streaks.longestStreak,
    peakHour,
    favoriteModel,
  }
  stats.days = days
  stats.models = models

  return stats
}

/**
 * 计算「用量」统计。
 *
 * 内部走增量缓存：先读缓存，对每个会话比对 (size, mtimeMs) 指纹，命中复用、变更重扫，
 * 然后把范围内各会话聚合合并。cache 命中与否作为副作用记录在返回里。
 */
export async function getAgentUsageStats(range: UsageRange): Promise<AgentUsageStats> {
  const now = Date.now()
  const rangeStartMs = rangeStart(range, now)

  const cache = readCache()
  // 动态 import：listAgentSessions 位于 agent-session-manager.ts，其模块加载链包含 electron，
  // 顶部静态 import 会拖垮 bun test（SyntaxError: Export named 'BrowserWindow' not found）。
  const { listAgentSessions } = await import('./agent-session-manager')
  const sessions = listAgentSessions()
  const dir = getAgentSessionsDir()
  let fromCache = true

  // 处理当前仍存在的会话
  const liveIds = new Set<string>()
  for (const meta of sessions) {
    liveIds.add(meta.id)
    const filePath = join(dir, `${meta.id}.jsonl`)
    let cached = cache.sessions[meta.id]
    let fingerprint = { size: 0, mtimeMs: 0 }
    let current: SessionUsageAgg | undefined

    if (existsSync(filePath)) {
      try {
        const st = statSync(filePath)
        fingerprint = { size: st.size, mtimeMs: st.mtimeMs }
      } catch {
        fingerprint = { size: 0, mtimeMs: 0 }
      }
    }

    if (cached && cached.fingerprint.size === fingerprint.size && cached.fingerprint.mtimeMs === fingerprint.mtimeMs) {
      current = cached
    } else {
      current = scanSessionFile(filePath, {
        id: meta.id,
        createdAt: meta.createdAt,
        title: meta.title,
        channelId: meta.channelId,
        workspaceId: meta.workspaceId,
      })
      current.fingerprint = fingerprint
      cache.sessions[meta.id] = current
      fromCache = false
    }
  }

  // 清理已删除会话的缓存条目
  for (const id of Object.keys(cache.sessions)) {
    if (!liveIds.has(id)) delete cache.sessions[id]
  }

  saveCache(cache)

  const allSessions = Object.values(cache.sessions)

  const stats: AgentUsageStats = {
    range,
    overview: {
      sessions: 0,
      messages: 0,
      totalTokens: 0,
      cacheReadTokens: 0,
      activeDays: 0,
      currentStreak: 0,
      longestStreak: 0,
      peakHour: 0,
    },
    days: [],
    models: [],
    // 「今天」固定用全量会话计算，不随 range 参数过滤 —— 用户选 7d/30d 时也能看到今日消耗
    today: computeTodayBucket(allSessions, now),
    fromCache,
  }

  return aggregate(stats, allSessions, rangeStartMs)
}

function readCache(): UsageCacheFile {
  const path = getAgentUsageCachePath()
  const cached = readJsonFileSafe<UsageCacheFile>(path)
  if (cached && cached.version === CACHE_VERSION && cached.sessions) {
    return cached
  }
  return { version: CACHE_VERSION, sessions: {} }
}

function saveCache(cache: UsageCacheFile): void {
  try {
    writeJsonFileAtomic(getAgentUsageCachePath(), cache)
  } catch (e) {
    console.warn('[用量] 缓存写入失败:', e)
  }
}
