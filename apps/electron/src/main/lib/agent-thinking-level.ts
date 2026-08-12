import { inferReasoningTransport, normalizeReasoningCapabilityLevel, normalizeReasoningLevel, resolveReasoningProfile, type AgentSessionMeta, type AgentThinkingLevel, type ProviderType, type ReasoningCapability } from '@myyoda/shared'
import {
  DEFAULT_AGENT_THINKING_LEVEL,
  getSessionThinkingLevel,
  isAgentThinkingLevel,
  isOpenAIReasoningMaxSupportedModel,
} from '@myyoda/shared'
import type { AppSettings } from '../../types'

type ThinkingSettings = Pick<AppSettings, 'agentThinking' | 'agentEffort' | 'defaultThinkingLevel' | 'codingMode' | 'optimizedCoding'>
type ThinkingSessionMeta = Pick<AgentSessionMeta, 'thinkingLevel' | 'reasoningLevel' | 'openAIThinkingLevel'>

/**
 * 编码优化总开关：optimizedCoding 优先，兼容旧 codingMode 字段（老用户已开启时保持开启）。
 * 默认关闭——PR37 的优化功能（repo map/B1/D2/分工指引/gated skill）在开启前不生效。
 */
export function resolveOptimizedCodingEnabled(
  settings: Pick<AppSettings, 'optimizedCoding' | 'codingMode'>,
): boolean {
  return settings.optimizedCoding ?? settings.codingMode ?? false
}

/**
 * 解析 Pi 会话本轮思考深度。
 *
 * 优先级（对齐 craft：session sticky > app default > 遗留全局 effort）：
 * 1. 会话 thinkingLevel / openAIThinkingLevel
 * 2. settings.defaultThinkingLevel
 * 3. agentThinking=disabled → off
 * 4. agentEffort（max → xhigh）
 * 5. DEFAULT_AGENT_THINKING_LEVEL
 */
export function resolvePiThinkingLevel(
  settings: ThinkingSettings,
  sessionMeta: ThinkingSessionMeta | undefined,
  _provider?: ProviderType,
  modelId?: string,
  capability?: ReasoningCapability,
): AgentThinkingLevel {
  const profile = resolveReasoningProfile({ modelId, transport: inferReasoningTransport(_provider) })
  const persistedReasoningLevel = sessionMeta?.reasoningLevel
    ?? sessionMeta?.thinkingLevel
    ?? sessionMeta?.openAIThinkingLevel
  const configuredLevel = settings.agentThinking?.type === 'disabled' ? 'off'
    : resolveOptimizedCodingEnabled(settings) ? 'max'  // 编码优化模式（总开关，兼容旧 codingMode）：未设会话级思考时默认 max
    : (settings.defaultThinkingLevel ?? settings.agentEffort)
  if (profile) return normalizeReasoningLevel(profile, persistedReasoningLevel ?? configuredLevel) ?? 'high'
  if (capability) return normalizeReasoningCapabilityLevel(capability, persistedReasoningLevel ?? configuredLevel) ?? capability.defaultLevel

  const normalizeSupportedLevel = (level: AgentThinkingLevel): AgentThinkingLevel => {
    // max 是 GPT-5.6 专属；会话持久化后切换到其他模型时，降级为 xhigh，
    // 避免 UI/会话层保留不可用档位导致 Pi 最终请求与用户预期不一致。
    if (level === 'max' && !isOpenAIReasoningMaxSupportedModel(modelId)) return 'xhigh'
    return level
  }

  const sessionLevel = persistedReasoningLevel ?? getSessionThinkingLevel(sessionMeta)
  if (sessionLevel) return normalizeSupportedLevel(sessionLevel)

  if (isAgentThinkingLevel(settings.defaultThinkingLevel)) {
    return normalizeSupportedLevel(settings.defaultThinkingLevel)
  }

  if (settings.agentThinking?.type === 'disabled') return 'off'
  if (settings.agentEffort === 'max') return 'xhigh'
  if (settings.agentEffort === 'low' || settings.agentEffort === 'medium' || settings.agentEffort === 'high') {
    return settings.agentEffort
  }

  return DEFAULT_AGENT_THINKING_LEVEL
}
