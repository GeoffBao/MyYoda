import type {
  BuiltinMcpCategory,
  BuiltinMcpServerSummary,
  ChatToolInfo,
  ChatToolMeta,
  McpServerEntry,
} from '@myyoda/shared'

export type ConnectorKind = 'builtin-mcp' | 'user-mcp' | 'api-tool' | 'custom-http'
export type ConnectorStatus = 'enabled' | 'needs_config' | 'disabled'

export interface ConnectorItem {
  id: string
  kind: ConnectorKind
  sourceId: string
  name: string
  description: string
  categoryLabel: string
  enabled: boolean
  available: boolean
  status: ConnectorStatus
  statusLabel: string
  statusReason?: string
}

const SYSTEM_BUILTIN_IDS = new Set(['automation', 'collaboration', 'create-task'])
const HIDDEN_USER_MCP_IDS = new Set(['memos-cloud'])

export function isSystemBuiltinAbility(id: string): boolean {
  return SYSTEM_BUILTIN_IDS.has(id)
}

function statusOf(
  enabled: boolean,
  available: boolean,
  reason?: string,
): Pick<ConnectorItem, 'status' | 'statusLabel' | 'statusReason'> {
  if (!enabled) return { status: 'disabled', statusLabel: '已关闭', statusReason: reason }
  if (!available) return { status: 'needs_config', statusLabel: '需配置', statusReason: reason }
  return { status: 'enabled', statusLabel: '已启用', statusReason: reason }
}

function categoryLabelOfBuiltin(category: BuiltinMcpCategory): string {
  switch (category) {
    case 'browser':
      return '浏览器'
    case 'media':
      return '媒体'
    case 'memory':
      return '记忆'
    case 'system':
    case 'automation':
    case 'collaboration':
    case 'task':
      return '外部工具'
    default: {
      const _exhaustive: never = category
      return _exhaustive
    }
  }
}

function categoryLabelOfTool(tool: ChatToolMeta): string {
  if (tool.category === 'custom') return '自定义 HTTP'
  if (tool.id === 'web-search') return '搜索'
  if (tool.id === 'nano-banana') return '媒体'
  return 'API 工具'
}

function isHiddenUserMcp(name: string, entry: McpServerEntry): boolean {
  return HIDDEN_USER_MCP_IDS.has(name) || entry.isBuiltin === true
}

function userMcpAvailable(entry: McpServerEntry): boolean {
  switch (entry.type) {
    case 'stdio':
      return Boolean(entry.command?.trim())
    case 'http':
    case 'sse':
      return Boolean(entry.url?.trim())
    default: {
      const _exhaustive: never = entry.type
      return _exhaustive
    }
  }
}

function userMcpDescription(entry: McpServerEntry): string {
  if (entry.type === 'stdio') return entry.command?.trim() || 'stdio MCP'
  return entry.url?.trim() || '远程 MCP'
}

function userMcpReason(entry: McpServerEntry, available: boolean): string | undefined {
  if (!entry.enabled) return '已关闭'
  if (available) return undefined
  return entry.type === 'stdio' ? '缺少 command' : '缺少 url'
}

export function buildConnectorItems(input: {
  builtinServers: BuiltinMcpServerSummary[]
  userEntries: Array<[string, McpServerEntry]>
  chatTools: ChatToolInfo[]
}): ConnectorItem[] {
  const connectorBuiltins = input.builtinServers.filter(
    (server) => !isSystemBuiltinAbility(server.id),
  )
  const builtinSourceIds = new Set(connectorBuiltins.map((server) => server.id))

  const builtinItems = connectorBuiltins.map((server) => ({
    id: `builtin:${server.id}`,
    kind: 'builtin-mcp' as const,
    sourceId: server.id,
    name: server.displayName,
    description: server.description,
    categoryLabel: categoryLabelOfBuiltin(server.category),
    enabled: server.enabled,
    available: server.available,
    ...statusOf(server.enabled, server.available, server.availabilityReason),
  }))

  const uniqueChatTools = input.chatTools.filter(
    (tool) => !isSystemBuiltinAbility(tool.meta.id) && !builtinSourceIds.has(tool.meta.id),
  )

  const apiItems = uniqueChatTools
    .filter((tool) => tool.meta.category !== 'custom')
    .map((tool) => ({
      id: `api:${tool.meta.id}`,
      kind: 'api-tool' as const,
      sourceId: tool.meta.id,
      name: tool.meta.name,
      description: tool.meta.description,
      categoryLabel: categoryLabelOfTool(tool.meta),
      enabled: tool.enabled,
      available: tool.available,
      ...statusOf(tool.enabled, tool.available, tool.available ? undefined : '需要配置或启用'),
    }))

  const customItems = uniqueChatTools
    .filter((tool) => tool.meta.category === 'custom')
    .map((tool) => ({
      id: `custom:${tool.meta.id}`,
      kind: 'custom-http' as const,
      sourceId: tool.meta.id,
      name: tool.meta.name,
      description: tool.meta.description,
      categoryLabel: '自定义 HTTP',
      enabled: tool.enabled,
      available: tool.available,
      ...statusOf(tool.enabled, tool.available),
    }))

  const userMcpItems = input.userEntries
    .filter(([name, entry]) => !isHiddenUserMcp(name, entry))
    .map(([name, entry]) => {
      const available = userMcpAvailable(entry)
      return {
        id: `mcp:${name}`,
        kind: 'user-mcp' as const,
        sourceId: name,
        name,
        description: userMcpDescription(entry),
        categoryLabel: '我的 MCP',
        enabled: entry.enabled,
        available,
        ...statusOf(entry.enabled, available, userMcpReason(entry, available)),
      }
    })

  return [...builtinItems, ...apiItems, ...customItems, ...userMcpItems]
}
