/**
 * connector-test 单测：表驱动「测试连接」的构造与判定逻辑
 */

import { describe, test, expect, mock } from 'bun:test'
import {
  CONNECTOR_TEST_SPECS,
  runConnectorTest,
  testBuiltinConnectorConnection,
} from '../builtin-mcp/connector-test'

function fakeFetch(status: number, body = ''): typeof globalThis.fetch {
  return mock(async () => new Response(body, { status })) as unknown as typeof globalThis.fetch
}

describe('内置连接器测试连接', () => {
  test('github：构造 Bearer 请求并判定 200 成功', async () => {
    const spec = CONNECTOR_TEST_SPECS['github']
    const request = spec!.build({ token: 'ghp_test' })
    expect(request?.url).toBe('https://api.github.com/user')
    expect(request?.headers.Authorization).toBe('Bearer ghp_test')

    const result = await runConnectorTest(spec!, { token: 'ghp_test' }, fakeFetch(200))
    expect(result.success).toBe(true)
  })

  test('github：Token 缺失时提示填写凭据', async () => {
    const result = await runConnectorTest(CONNECTOR_TEST_SPECS['github']!, {}, fakeFetch(200))
    expect(result.success).toBe(false)
    expect(result.message).toContain('凭据')
  })

  test('gitlab：自建实例 API 地址拼接并清理尾部斜杠', () => {
    const request = CONNECTOR_TEST_SPECS['gitlab']!.build({
      token: 'glpat_x',
      apiUrl: 'https://gitlab.example.com/api/v4/',
    })
    expect(request?.url).toBe('https://gitlab.example.com/api/v4/user')
  })

  test('notion：401 返回鉴权错误提示', async () => {
    const result = await runConnectorTest(CONNECTOR_TEST_SPECS['notion']!, { token: 'bad' }, fakeFetch(401))
    expect(result.success).toBe(false)
    expect(result.message).toContain('Token')
  })

  test('exa：POST body 包含测试查询', () => {
    const request = CONNECTOR_TEST_SPECS['exa']!.build({ apiKey: 'k' })
    expect(request?.method).toBe('POST')
    expect(request?.headers['x-api-key']).toBe('k')
    expect(JSON.parse(request?.body ?? '{}').numResults).toBe(1)
  })

  test('未知连接器：返回不支持提示', async () => {
    const result = await testBuiltinConnectorConnection('not-exists')
    expect(result.success).toBe(false)
    expect(result.message).toContain('不支持')
  })
})
