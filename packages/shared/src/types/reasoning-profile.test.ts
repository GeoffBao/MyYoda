import { describe, expect, test } from 'bun:test'
import {
  normalizeReasoningLevel,
  resolveReasoningCapability,
  resolveReasoningProfile,
} from './reasoning-profile'

describe('reasoning profiles', () => {
  test('keeps transport-specific profiles isolated', () => {
    expect(resolveReasoningProfile({ modelId: 'gpt-5.6-luna', transport: 'openai-responses' })?.id).toBe('openai-reasoning-max')
    expect(resolveReasoningProfile({ modelId: 'gpt-5.6-luna', transport: 'anthropic-messages' })).toBeUndefined()
    expect(resolveReasoningProfile({ modelId: 'gpt-5.6-chat-latest', transport: 'openai-responses' })).toBeUndefined()
  })

  test('normalizes model-specific levels without losing off', () => {
    const profile = resolveReasoningProfile({ modelId: 'kimi-k3', transport: 'openai-completions' })
    expect(profile?.id).toBe('kimi-k3')
    expect(normalizeReasoningLevel(profile, 'medium')).toBe('high')
    expect(normalizeReasoningLevel(profile, 'off')).toBe('off')
  })

  test('routes glm-5.3 to its own zai-toggle profile, not glm-5.2', () => {
    const glm53 = resolveReasoningProfile({ modelId: 'glm-5.3', transport: 'openai-completions' })
    expect(glm53?.id).toBe('glm-5.3')
    expect(glm53?.encodings['openai-completions']?.kind).toBe('zai-toggle')

    // GLM-5.2 must keep the reasoning_effort protocol; 5.3 must not fall into it.
    const glm52 = resolveReasoningProfile({ modelId: 'glm-5.2', transport: 'openai-completions' })
    expect(glm52?.encodings['openai-completions']?.kind).toBe('zai-thinking-effort')

    // Anthropic-compatible transport also resolves for glm-5.3.
    expect(resolveReasoningProfile({ modelId: 'glm-5.3', transport: 'anthropic-messages' })?.id).toBe('glm-5.3')
  })

  test('glm-5.3 collapses every non-off level to high', () => {
    const profile = resolveReasoningProfile({ modelId: 'glm-5.3', transport: 'openai-completions' })
    expect(normalizeReasoningLevel(profile, undefined)).toBe('high')
    expect(normalizeReasoningLevel(profile, 'off')).toBe('off')
    expect(normalizeReasoningLevel(profile, 'low')).toBe('high')
    expect(normalizeReasoningLevel(profile, 'max')).toBe('high')
  })

  test('prefers an explicit profile over catalog capability', () => {
    const profile = resolveReasoningProfile({ modelId: 'glm-5.2', transport: 'openai-completions' })
    const capability = resolveReasoningCapability({
      profile,
      catalog: { reasoning: true, thinkingLevelMap: { off: 'none', low: 'low' } },
    })
    expect(capability?.source).toBe('profile')
    expect(capability?.levels).toContain('max')
  })
})
