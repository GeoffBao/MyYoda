import { describe, expect, test } from 'bun:test'
import { PROVIDER_DEFAULT_URLS, PROVIDER_LABELS } from './channel'

// AGENT_COMPATIBLE_PROVIDERS / isAgentCompatibleProvider 已随 Claude runtime 退役移除。
// Pi runtime 支持所有协议，无需兼容性过滤。

describe('anthropic-oauth provider 注册', () => {
  test('Given anthropic-oauth When 查 defaultUrls/labels Then 都有条目', () => {
    expect(PROVIDER_DEFAULT_URLS['anthropic-oauth']).toBe('https://api.anthropic.com')
    expect(PROVIDER_LABELS['anthropic-oauth']).toBe('Claude Pro/Max（OAuth）')
  })
})
