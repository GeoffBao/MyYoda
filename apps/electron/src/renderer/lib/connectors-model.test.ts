import { describe, expect, test } from 'bun:test'
import type { BuiltinMcpServerSummary, ChatToolInfo, ChatToolMeta, McpServerEntry } from '@myyoda/shared'
import { buildConnectorItems, isSystemBuiltinAbility } from './connectors-model'

function builtin(
  id: string,
  category: BuiltinMcpServerSummary['category'],
  enabled = true,
  available = true,
  availabilityReason?: string,
): BuiltinMcpServerSummary {
  return {
    id,
    name: id.replaceAll('-', '_'),
    displayName: id,
    description: `${id} desc`,
    category,
    enabled,
    available,
    availabilityReason,
    tools: [],
  }
}

function chatTool(
  id: string,
  name: string,
  enabled: boolean,
  available: boolean,
  category: ChatToolMeta['category'] = 'builtin',
): ChatToolInfo {
  return {
    meta: {
      id,
      name,
      description: `${name} desc`,
      params: [],
      category,
      executorType: category === 'custom' ? 'http' : 'builtin',
    },
    enabled,
    available,
  }
}

describe('connectors-model', () => {
  test('identifies Runtime system abilities', () => {
    expect(isSystemBuiltinAbility('automation')).toBe(true)
    expect(isSystemBuiltinAbility('collaboration')).toBe(true)
    expect(isSystemBuiltinAbility('create-task')).toBe(true)
    expect(isSystemBuiltinAbility('chrome-devtools')).toBe(false)
    expect(isSystemBuiltinAbility('nano-banana')).toBe(false)
  })

  test('excludes Runtime system abilities from connector items', () => {
    const items = buildConnectorItems({
      builtinServers: [
        builtin('automation', 'automation'),
        builtin('collaboration', 'collaboration'),
        builtin('create-task', 'task'),
        builtin('chrome-devtools', 'browser'),
      ],
      userEntries: [],
      chatTools: [chatTool('automation', '自动化', true, true)],
    })

    expect(items.map((item) => item.id)).toEqual(['builtin:chrome-devtools'])
  })

  test('combines builtin MCP, API tools, custom HTTP, and user MCP in that order', () => {
    const userEntries: Array<[string, McpServerEntry]> = [
      ['local-db', { type: 'stdio', command: 'sqlite-mcp', enabled: false }],
    ]
    const chatTools: ChatToolInfo[] = [
      chatTool('web-search', '联网搜索', true, true),
      chatTool('custom-api', 'Custom API', true, true, 'custom'),
    ]

    const items = buildConnectorItems({
      builtinServers: [
        builtin('automation', 'automation'),
        builtin('chrome-devtools', 'browser'),
        builtin('nano-banana', 'media', true, false, '需要配置 Gemini API Key'),
      ],
      userEntries,
      chatTools,
    })

    expect(items.map((item) => item.id)).toEqual([
      'builtin:chrome-devtools',
      'builtin:nano-banana',
      'api:web-search',
      'custom:custom-api',
      'mcp:local-db',
    ])
    expect(items.find((item) => item.id === 'builtin:chrome-devtools')).toMatchObject({
      kind: 'builtin-mcp',
      status: 'enabled',
      statusLabel: '已启用',
    })
    expect(items.find((item) => item.id === 'builtin:nano-banana')).toMatchObject({
      status: 'needs_config',
      statusLabel: '需配置',
    })
    expect(items.find((item) => item.id === 'mcp:local-db')).toMatchObject({
      kind: 'user-mcp',
      status: 'disabled',
      statusLabel: '已关闭',
      available: true,
    })
  })

  test('deduplicates matching builtin MCP and chat tool source ids with builtin priority', () => {
    const items = buildConnectorItems({
      builtinServers: [builtin('nano-banana', 'media', true, false, 'Agent 凭据缺失')],
      userEntries: [],
      chatTools: [chatTool('nano-banana', 'Nano Banana', true, true)],
    })

    expect(items.map((item) => item.id)).toEqual(['builtin:nano-banana'])
    expect(items[0]).toMatchObject({
      kind: 'builtin-mcp',
      sourceId: 'nano-banana',
      status: 'needs_config',
      statusLabel: '需配置',
    })
  })

  test('marks enabled user MCP missing command as needs_config', () => {
    const items = buildConnectorItems({
      builtinServers: [],
      userEntries: [['local-db', { type: 'stdio', enabled: true }]],
      chatTools: [],
    })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'mcp:local-db',
      kind: 'user-mcp',
      enabled: true,
      available: false,
      status: 'needs_config',
      statusLabel: '需配置',
    })
  })

  test('marks enabled http/sse user MCP missing url as needs_config', () => {
    const items = buildConnectorItems({
      builtinServers: [],
      userEntries: [
        ['remote-http', { type: 'http', enabled: true }],
        ['remote-sse', { type: 'sse', enabled: true }],
        ['ok-http', { type: 'http', url: 'https://mcp.example', enabled: true }],
      ],
      chatTools: [],
    })

    expect(items.find((item) => item.id === 'mcp:remote-http')?.status).toBe('needs_config')
    expect(items.find((item) => item.id === 'mcp:remote-sse')?.status).toBe('needs_config')
    expect(items.find((item) => item.id === 'mcp:ok-http')).toMatchObject({
      available: true,
      status: 'enabled',
      statusLabel: '已启用',
    })
  })

  test('drops isBuiltin and memos-cloud user MCP entries', () => {
    const items = buildConnectorItems({
      builtinServers: [],
      userEntries: [
        ['memos-cloud', { type: 'http', url: 'https://memos.example', enabled: true }],
        ['shadow-builtin', { type: 'stdio', command: 'echo', enabled: true, isBuiltin: true }],
        ['filesystem', { type: 'stdio', command: 'npx', enabled: true }],
      ],
      chatTools: [],
    })

    expect(items.map((item) => item.id)).toEqual(['mcp:filesystem'])
  })
})
