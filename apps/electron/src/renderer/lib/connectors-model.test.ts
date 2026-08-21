import { describe, expect, test } from 'bun:test'
import type { BuiltinMcpServerSummary, ChatToolInfo, ChatToolMeta, McpServerEntry } from '@myyoda/shared'
import {
  buildConnectorItems,
  classifyConnectorBlocker,
  filterConnectorItems,
  groupConnectorItems,
  isSystemBuiltinAbility,
} from './connectors-model'

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
      categoryLabel: '我的连接',
      sourceLabel: '我的连接',
      typeLabel: 'MCP',
      nextActionLabel: '去启用',
      description: '本地命令连接器，启动后向 Agent 暴露工具。',
    })
    expect(items.find((item) => item.id === 'builtin:nano-banana')).toMatchObject({
      sourceLabel: 'MyYoda 内置',
      typeLabel: 'MCP',
      nextActionLabel: '去配置',
    })
    expect(items.find((item) => item.id === 'custom:custom-api')).toMatchObject({
      categoryLabel: '自定义',
      typeLabel: 'HTTP',
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

  test('groups connectors by user-facing category, not MCP/API kind', () => {
    const items = buildConnectorItems({
      builtinServers: [
        builtin('chrome-devtools', 'browser'),
        builtin('nano-banana', 'media'),
      ],
      userEntries: [['filesystem', { type: 'stdio', command: 'npx', enabled: true }]],
      chatTools: [
        chatTool('web-search', '联网搜索', true, true),
        chatTool('custom-api', 'Custom API', true, true, 'custom'),
      ],
    })

    expect(groupConnectorItems(items).map((group) => group.categoryLabel)).toEqual([
      '浏览器',
      '媒体',
      '搜索',
      '我的连接',
      '自定义',
    ])
  })

  test('marks default-off missing credentials as needs_config, not disabled', () => {
    const items = buildConnectorItems({
      builtinServers: [
        builtin('nano-banana', 'media', false, false, '需要配置 Gemini API Key'),
      ],
      userEntries: [],
      chatTools: [chatTool('web-search', '联网搜索', false, false)],
    })

    expect(items.find((item) => item.sourceId === 'nano-banana')).toMatchObject({
      status: 'needs_config',
      statusLabel: '需配置',
      nextActionLabel: '去配置',
    })
    expect(items.find((item) => item.sourceId === 'web-search')).toMatchObject({
      status: 'needs_config',
      statusLabel: '需配置',
    })
  })

  test('marks missing Chrome as missing_dep even when the switch is off', () => {
    const items = buildConnectorItems({
      builtinServers: [
        builtin('chrome-devtools', 'browser', false, false, '未检测到 Chrome，请安装 Google Chrome 后重试'),
      ],
      userEntries: [],
      chatTools: [],
    })

    expect(items[0]).toMatchObject({
      status: 'missing_dep',
      statusLabel: '依赖缺失',
      nextActionLabel: '去处理',
    })
  })

  test('keeps configured but switched-off connectors as disabled', () => {
    const items = buildConnectorItems({
      builtinServers: [builtin('chrome-devtools', 'browser', false, true)],
      userEntries: [],
      chatTools: [chatTool('web-search', '联网搜索', false, true)],
    })

    expect(items.map((item) => item.status)).toEqual(['disabled', 'disabled'])
  })

  test('classifies connection failure and auth separately from missing config', () => {
    expect(classifyConnectorBlocker('连接失败：ECONNREFUSED')).toBe('connect_failed')
    expect(classifyConnectorBlocker('需要登录或 OAuth 授权')).toBe('needs_auth')
    expect(classifyConnectorBlocker('需要配置 Gemini API Key')).toBe('needs_config')
  })

  test('filters connectors by lifecycle and category chips', () => {
    const items = buildConnectorItems({
      builtinServers: [
        builtin('chrome-devtools', 'browser', false, false, '未检测到 Chrome，请安装 Google Chrome 后重试'),
        builtin('nano-banana', 'media', true, false, '需要配置 Gemini API Key'),
      ],
      userEntries: [['local-db', { type: 'stdio', command: 'sqlite-mcp', enabled: false }]],
      chatTools: [chatTool('web-search', '联网搜索', true, true)],
    })

    expect(filterConnectorItems(items, '', 'needs_config').map((item) => item.id)).toEqual([
      'builtin:chrome-devtools',
      'builtin:nano-banana',
    ])
    expect(filterConnectorItems(items, '', 'search').map((item) => item.id)).toEqual([
      'api:web-search',
    ])
    expect(items.find((item) => item.sourceId === 'nano-banana')?.statusReason).toContain('Gemini')
    expect(filterConnectorItems(items, 'gemini', 'all').map((item) => item.id)).toEqual([
      'builtin:nano-banana',
    ])
    expect(filterConnectorItems(items, 'nano-banana', 'all').map((item) => item.id)).toEqual([
      'builtin:nano-banana',
    ])
  })

  test('keeps user MCP and same-name API tool as distinct namespaced items', () => {
    const items = buildConnectorItems({
      builtinServers: [],
      userEntries: [['web-search', { type: 'http', url: 'https://mcp.example', enabled: true }]],
      chatTools: [chatTool('web-search', '联网搜索', true, true)],
    })

    // 同名但不互斥：id 带 kind 命名空间，二者唯一，不会因裸 sourceId 反查串线
    expect(items.map((item) => item.id).sort()).toEqual(['api:web-search', 'mcp:web-search'])
    expect(new Set(items.map((item) => item.id)).size).toBe(2)
    expect(items.find((item) => item.id === 'mcp:web-search')?.kind).toBe('user-mcp')
  })

  test('excludes internal product tools from connector items', () => {
    const items = buildConnectorItems({
      builtinServers: [],
      userEntries: [],
      chatTools: [
        chatTool('agent-mode-recommend', 'Agent 模式推荐', true, true),
        chatTool('web-search', '联网搜索', true, true),
      ],
    })

    expect(items.map((item) => item.id)).toEqual(['api:web-search'])
  })

  test('marks enabled user MCP with failed last test as connect_failed', () => {
    const items = buildConnectorItems({
      builtinServers: [],
      userEntries: [[
        'broken-db',
        {
          type: 'stdio',
          command: 'sqlite-mcp',
          enabled: true,
          lastTestResult: { success: false, message: '连接失败：进程退出异常', timestamp: 1 },
        },
      ]],
      chatTools: [],
    })

    expect(items[0]).toMatchObject({
      id: 'mcp:broken-db',
      status: 'connect_failed',
      statusLabel: '连接失败',
      statusReason: '连接失败：进程退出异常',
      nextActionLabel: '去排查',
    })
  })

  test('groups unknown categories after the ordered ones', () => {
    const items = buildConnectorItems({
      builtinServers: [
        builtin('memory-server', 'memory'),
        builtin('chrome-devtools', 'browser'),
      ],
      userEntries: [],
      chatTools: [],
    })

    expect(groupConnectorItems(items).map((group) => group.categoryLabel)).toEqual([
      '浏览器',
      '记忆',
    ])
  })
})
