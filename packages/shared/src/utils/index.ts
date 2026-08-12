/**
 * Shared utility functions for MyYoda
 */

// Placeholder - will be expanded as needed
export function noop(): void {
  // no-op
}

export { diffCapabilities } from './capabilities-diff'
export type { CapabilityChange } from './capabilities-diff'
export {
  DEFAULT_CONTEXT_WINDOW,
  ONE_MILLION_CONTEXT_WINDOW,
  CODEX_GPT_54_55_CONTEXT_WINDOW,
  CODEX_GPT_54_MINI_CONTEXT_WINDOW,
  CODEX_GPT_56_CONTEXT_WINDOW,
  inferCodexAlignedGPT5ContextWindow,
  supports1MContext,
  inferContextWindow,
  inferAgentSdkContextWindow,
  resolveAgentSdkModelId,
} from './context-window'
export { calculateContextUsageRatio } from './context-usage'
export { slugify } from './slug'
export {
  parseReleaseVersion,
  compareReleaseSemver,
  isOlderThan,
  extractReleaseHeadline,
} from './release-notes'
export {
  inferMcpTransportType,
  normalizeMcpTransportType,
} from './mcp-transport'
export {
  THINKING_SIGNATURE_ERROR_CODE,
  THINKING_SIGNATURE_ERROR_TITLE,
  THINKING_SIGNATURE_ERROR_MESSAGE,
  isThinkingSignatureError,
  formatThinkingSignatureError,
  normalizeThinkingSignatureError,
} from './thinking-signature-error'
export { normalizePathForCompare } from './normalize-path'
export { isDeepSeekV4 } from './model-matcher'
export {
  displayProjectPath,
  normalizeProjectPathForCompare,
  type PathPlatform,
} from './project-path'
export {
  getSDKCompactStatus,
  isPersistableSDKSystemMessage,
  type SDKCompactStatus,
} from './agent-system-message'
export {
  AUTOMATION_OCCURRENCE_SAMPLES_PER_DAY,
  getAutomationOccurrencesByDay,
  type AutomationOccurrenceDay,
} from './automation-schedule'
export {
  PI_AUTO_COMPACTION_THRESHOLD_RATIO,
  PI_EARLY_COMPACTION_THRESHOLD_RATIO,
  calculatePiAutoCompactionReserveTokens,
  calculatePiAutoCompactionThresholdTokens,
} from './pi-compaction'
export {
  getSkillSlugFromEntryPath,
  createSkillActivationFromPath,
  mergeSkillActivations,
  collectSuccessfulSkillReadActivations,
  collectSkillActivations,
} from './skill-usage'
