import { describe, expect, test } from 'bun:test'
import type { ConnectorItem } from './connectors-model'
import { describeConnectorDetail } from './connector-detail-model'

function item(overrides: Partial<ConnectorItem> & Pick<ConnectorItem, 'kind' | 'sourceId' | 'name'>): ConnectorItem {
  return {
    id: `${overrides.kind}:${overrides.sourceId}`,
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
})
