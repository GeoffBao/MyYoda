/**
 * Agent Provider 适配器接口
 *
 * 定义 MyYoda 自己的 Agent 接口层，让底层 SDK 可替换。
 * 当前实现：PiAgentAdapter 单 runtime（Claude runtime 已于 2026-08 退役）。
 */

import type { AgentAssistantMessageDelta, SDKMessage } from './agent'

/** Agent runtime 实现（仅保留 Pi；Claude runtime 已退役） */
export type AgentRuntime = 'pi'

/** Pi runtime 的实时增量与稳定 transcript 边界事件。 */
export type PiRunSourceEvent =
  | { kind: 'sdk_message'; message: SDKMessage }
  | AgentAssistantMessageDelta

/** Pi 活跃 session 的队列消息输入。 */
export interface PiQueuedUserMessageInput {
  type: 'user'
  message: { role: 'user'; content: string }
  /** 未注入动态上下文/工具提示的用户原文，仅用于 canonical transcript boundary。 */
  raw_content?: string
  parent_tool_use_id: null
  priority?: 'now' | 'next' | 'later'
  uuid?: string
  session_id: string
}

/** 队列消息注入选项 */
export interface SendQueuedMessageOptions {
  /** 先取消当前 turn，再把消息作为新一轮用户输入发送 */
  interrupt?: boolean
  /** 当前用户输入显式引用的 Skill name（兼容历史 slug 已在编排层归一化） */
  skillMentions?: string[]
  /** runtime/adapter 已接收消息后回调；用于调用方区分失败时是否可回滚本地历史 */
  onAccepted?: () => void
}

/** Pi run source 的最小查询输入。 */
export interface PiRunQueryInput {
  /** 会话 ID */
  sessionId: string
  /** 顶层 run 的唯一身份；retry 与 compaction continuation 期间保持不变。 */
  runId: string
  /** 用户 prompt（已包含上下文注入） */
  prompt: string
  /** 模型 ID */
  model?: string
  /** Agent 工作目录 */
  cwd?: string
  /** 中止信号 */
  abortSignal?: AbortSignal
}
