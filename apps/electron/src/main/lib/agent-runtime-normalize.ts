/**
 * Agent runtime 归一化 — Claude runtime 已于 2026-08 退役，仅保留 Pi。
 *
 * 独立成零 Electron 依赖的小文件，方便历史对话迁移脚本复用。
 */

import type { AgentRuntime } from '@myyoda/shared'

export function normalizeAgentRuntime(_value?: unknown, _provider?: unknown): AgentRuntime {
  // Claude runtime 已退役，所有执行统一走 Pi。
  // anthropic-oauth（Claude Pro/Max 订阅登录）通过 PiAgent 的 anthropic provider 桥接：
  // OAuth token 作为 api_key 传给 Pi SDK 的 registerProvider({ apiKey, api: 'anthropic-messages', baseUrl: 'https://api.anthropic.com' })。
  return 'pi'
}
