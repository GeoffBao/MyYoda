import { describe, expect, test } from 'bun:test'
import type { ConnectorItem } from './connectors-model'
import { describeConnectorDetail } from './connector-detail-model'

const ID_PREFIX: Record<ConnectorItem['kind'], string> = {
  'builtin-mcp': 'builtin',
  'api-tool': 'api',
  'custom-http': 'custom',
  'user-mcp': 'mcp',
}

function item(overrides: Partial<ConnectorItem> & Pick<ConnectorItem, 'kind' | 'sourceId' | 'name'>): ConnectorItem {
  return {
    id: `${ID_PREFIX[overrides.kind]}:${overrides.sourceId}`,
    description: 'desc',
    categoryLabel: '浏览器',
    sourceLabel: 'MyYoda 内置',
    typeLabel: 'MCP',
    enabled: true,
    available: true,
    status: 'enabled',
    statusLabel: '已启用',
    ...overrides,
  }
}

describe('connector-detail-model', () => {
  test('describes Chrome as browser control without dumping tool names', () => {
    const meta = describeConnectorDetail(item({
      kind: 'builtin-mcp',
      sourceId: 'chrome-devtools',
      name: 'Chrome 浏览器',
    }))
    expect(meta.permissionLabel).toContain('浏览器')
    expect(meta.configMethodLabel).toContain('Chrome')
    expect(meta.capabilities.join(' ')).toContain('截图')
    expect(meta.capabilities.join(' ')).not.toContain('list_pages')
    expect(meta.nextStep).toBeUndefined()
  })

  test('gives a next step when Chrome is missing', () => {
    const meta = describeConnectorDetail(item({
      kind: 'builtin-mcp',
      sourceId: 'chrome-devtools',
      name: 'Chrome 浏览器',
      enabled: true,
      available: false,
      status: 'needs_config',
      statusLabel: '需配置',
      statusReason: '未检测到 Chrome，请安装 Google Chrome 后重试',
      nextActionLabel: '去配置',
    }))
    expect(meta.nextStep).toContain('未检测到 Chrome')
    expect(meta.nextStep).toContain('去配置')
  })

  test('describes web search and nano-banana by config method, not MCP', () => {
    expect(describeConnectorDetail(item({
      kind: 'api-tool',
      sourceId: 'web-search',
      name: '联网搜索',
      typeLabel: 'API',
    })).configMethodLabel).toContain('Tavily')

    expect(describeConnectorDetail(item({
      kind: 'builtin-mcp',
      sourceId: 'nano-banana',
      name: 'Nano Banana 生图',
      categoryLabel: '媒体',
    })).capabilities).toContain('按描述生成图片')
  })

  test('自建与内置同名的 user MCP 不误用内置连接器文案', () => {
    const meta = describeConnectorDetail(item({
      kind: 'user-mcp',
      sourceId: 'web-search',
      name: 'web-search',
      sourceLabel: '我的连接',
      typeLabel: 'MCP',
    }))
    expect(meta.configMethodLabel).not.toContain('Tavily')
    expect(meta.configMethodLabel).toBe('命令或 URL')
    expect(meta.permissionLabel).toContain('本机命令')
  })
})
