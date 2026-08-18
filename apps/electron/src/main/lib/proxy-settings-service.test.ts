import { describe, expect, test } from 'bun:test'
import { redactProxyUrl, resolveProxyUrlForModel } from './proxy-settings-service'

describe('proxy settings logging', () => {
  test('Given an authenticated proxy URL When formatting it for logs Then redacts both username and password', () => {
    const value = redactProxyUrl('http://alice:secret@127.0.0.1:7890')

    expect(value).not.toContain('alice')
    expect(value).not.toContain('secret')
    expect(value).toContain('127.0.0.1:7890')
  })

  test('Given a malformed proxy URL When formatting it for logs Then never returns the original value', () => {
    expect(redactProxyUrl('alice:secret@not a url')).toBe('[invalid proxy URL]')
  })
})

describe('resolveProxyUrlForModel（模型粒度代理）', () => {
  const globalStub = async (): Promise<string | undefined> => 'http://127.0.0.1:7890'

  test('useProxy===false 的模型直连，绕过全局代理', async () => {
    const url = await resolveProxyUrlForModel(
      [{ id: 'gpt-direct', useProxy: false }],
      'gpt-direct',
      globalStub,
    )
    expect(url).toBeUndefined()
  })

  test('useProxy 未设置 / true 的模型跟随全局代理', async () => {
    const unset = await resolveProxyUrlForModel([{ id: 'claude-default' }], 'claude-default', globalStub)
    expect(unset).toBe('http://127.0.0.1:7890')

    const explicit = await resolveProxyUrlForModel([{ id: 'a', useProxy: true }], 'a', globalStub)
    expect(explicit).toBe('http://127.0.0.1:7890')
  })

  test('模型不存在 / 无模型列表时仍跟随全局代理（不阻断请求）', async () => {
    const missing = await resolveProxyUrlForModel([{ id: 'a' }], 'b', globalStub)
    expect(missing).toBe('http://127.0.0.1:7890')

    const noModels = await resolveProxyUrlForModel(undefined, 'b', globalStub)
    expect(noModels).toBe('http://127.0.0.1:7890')
  })
})
