import type {
  BuiltinMcpCategory,
  BuiltinMcpServerSummary,
  ChatToolInfo,
  ChatToolMeta,
  McpServerEntry,
} from '@myyoda/shared'

export type ConnectorKind = 'builtin-mcp' | 'user-mcp' | 'api-tool' | 'custom-http'
export type ConnectorStatus =
  | 'enabled'
  | 'disabled'
  | 'needs_config'
  | 'needs_auth'
  | 'missing_dep'
  | 'connect_failed'
export type ConnectorTypeLabel = 'MCP' | 'API' | 'HTTP'
export type ConnectorFilterChip =
  | 'all'
  | 'needs_config'
  | 'enabled'
  | 'disabled'
  | 'browser'
  | 'media'
  | 'search'
  | 'mine'
  | 'custom'

const ATTENTION_STATUSES = new Set<ConnectorStatus>([
  'needs_config',
  'needs_auth',
  'missing_dep',
  'connect_failed',
])

const STATUS_LABEL: Record<ConnectorStatus, string> = {
  enabled: '已启用',
  disabled: '已关闭',
  needs_config: '需配置',
  needs_auth: '需授权',
  missing_dep: '依赖缺失',
  connect_failed: '连接失败',
}

const STATUS_NEXT: Record<ConnectorStatus, string | undefined> = {
  enabled: undefined,
  disabled: '去启用',
  needs_config: '去配置',
  needs_auth: '去授权',
  missing_dep: '去处理',
  connect_failed: '去排查',
}

export function isConnectorAttentionStatus(status: ConnectorStatus): boolean {
  return ATTENTION_STATUSES.has(status)
}

export interface ConnectorItem {
  id: string
  kind: ConnectorKind
  sourceId: string
  name: string
  description: string
  categoryLabel: string
  sourceLabel: string
  typeLabel: ConnectorTypeLabel
  enabled: boolean
  available: boolean
  status: ConnectorStatus
  statusLabel: string
  statusReason?: string
  nextActionLabel?: string
}

export interface ConnectorGroup {
  categoryLabel: string
  items: ConnectorItem[]
}

/**
 * 属于「Runtime 系统能力」的内置分类（只进总览内置能力，不进连接器列表）。
 * 连接器侧的过滤按数据自带的 category 判定（default-mcp.json 单一事实源），
 * 避免新增同类内置能力时漏排除。
 */
const INTERNAL_BUILTIN_CATEGORIES: ReadonlySet<BuiltinMcpCategory> = new Set(['automation', 'collaboration', 'task'])

/** chat tool 侧没有 BuiltinMcpCategory，只能按 id 排除（当前工具集本就不含这三者，防御性保留）。 */
const SYSTEM_TOOL_IDS = new Set(['automation', 'collaboration', 'create-task'])

/** 内部产品能力（非连接器），配置入口在设置 → 工具，不进连接器列表。 */
const NON_CONNECTOR_TOOL_IDS = new Set(['agent-mode-recommend'])

const HIDDEN_USER_MCP_IDS = new Set(['memos-cloud'])

export const CONNECTOR_CATEGORY_ORDER = ['浏览器', '媒体', '搜索', '我的连接', '自定义'] as const

export const CONNECTOR_FILTER_CHIPS: Array<{ key: ConnectorFilterChip; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'needs_config', label: '需配置' },
  { key: 'enabled', label: '已启用' },
  { key: 'disabled', label: '已关闭' },
  { key: 'browser', label: '浏览器' },
  { key: 'media', label: '媒体' },
  { key: 'search', label: '搜索' },
  { key: 'mine', label: '我的连接' },
  { key: 'custom', label: '自定义' },
]

export function isSystemBuiltinAbility(id: string): boolean {
  return SYSTEM_TOOL_IDS.has(id)
}

export function isInternalBuiltinCategory(category: BuiltinMcpCategory): boolean {
  return INTERNAL_BUILTIN_CATEGORIES.has(category)
}

export function classifyConnectorBlocker(reason?: string): Exclude<ConnectorStatus, 'enabled' | 'disabled'> {
  const text = reason ?? ''
  if (/授权|OAuth|登录过期|token 过期/i.test(text)) return 'needs_auth'
  if (/未检测|未安装|npx|Node\.js|Chrome|Chromium|缺少 Chrome|依赖缺失/i.test(text)) return 'missing_dep'
  if (/连接失败|无法连接|timed out|timeout|ECONN/i.test(text)) return 'connect_failed'
  return 'needs_config'
}

function statusOf(
  enabled: boolean,
  available: boolean,
  reason?: string,
): Pick<ConnectorItem, 'status' | 'statusLabel' | 'statusReason' | 'nextActionLabel'> {
  if (available) {
    const status: ConnectorStatus = enabled ? 'enabled' : 'disabled'
    return {
      status,
      statusLabel: STATUS_LABEL[status],
      statusReason: enabled ? reason : undefined,
      nextActionLabel: STATUS_NEXT[status],
    }
  }
  const status = classifyConnectorBlocker(reason)
  return {
    status,
    statusLabel: STATUS_LABEL[status],
    statusReason: reason,
    nextActionLabel: STATUS_NEXT[status],
  }
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
      // 后三个分类当前被 INTERNAL_BUILTIN_CATEGORIES 过滤不进连接器列表；保留映射以应对未来非内部连接器复用这些分类。
      return '外部工具'
    default: {
      const _exhaustive: never = category
      return _exhaustive
    }
  }
}

function categoryLabelOfTool(tool: ChatToolMeta): string {
  // custom 工具在 buildConnectorItems 里已被单独分流为「自定义」，此处只会收到 builtin 工具。
  if (tool.id === 'web-search') return '搜索'
  if (tool.id === 'nano-banana') return '媒体'
  return '搜索'
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
  switch (entry.type) {
    case 'stdio':
      return '本地命令连接器，启动后向 Agent 暴露工具。'
    case 'http':
    case 'sse':
      return '远程服务连接器，通过 URL 接入外部工具。'
    default: {
      const _exhaustive: never = entry.type
      return _exhaustive
    }
  }
}

function userMcpReason(entry: McpServerEntry, available: boolean): string | undefined {
  if (available) return undefined
  return entry.type === 'stdio' ? '缺少 command' : '缺少 url'
}

function categoryKeyOf(label: string): ConnectorFilterChip | null {
  switch (label) {
    case '浏览器':
      return 'browser'
    case '媒体':
      return 'media'
    case '搜索':
      return 'search'
    case '我的连接':
      return 'mine'
    case '自定义':
      return 'custom'
    default:
      return null
  }
}

export function buildConnectorItems(input: {
  builtinServers: BuiltinMcpServerSummary[]
  userEntries: Array<[string, McpServerEntry]>
  chatTools: ChatToolInfo[]
}): ConnectorItem[] {
  const connectorBuiltins = input.builtinServers.filter(
    (server) => !isInternalBuiltinCategory(server.category),
  )
  const builtinSourceIds = new Set(connectorBuiltins.map((server) => server.id))

  const builtinItems = connectorBuiltins.map((server) => ({
    id: `builtin:${server.id}`,
    kind: 'builtin-mcp' as const,
    sourceId: server.id,
    name: server.displayName,
    description: server.description,
    categoryLabel: categoryLabelOfBuiltin(server.category),
    sourceLabel: 'MyYoda 内置',
    typeLabel: 'MCP' as const,
    enabled: server.enabled,
    available: server.available,
    ...statusOf(server.enabled, server.available, server.availabilityReason),
  }))

  // 去重策略：同 sourceId 时内置连接器无条件优先、chat tool 无条件丢弃。
  // 当前内置项与同名 chat tool 共享同一份凭据/可用性（如 nano-banana），不会出现
  // 「内置不可用但工具可用」的分化；若未来某个 id 出现双源分化，需改为「内置不可用时回退展示工具」。
  const uniqueChatTools = input.chatTools.filter(
    (tool) => !isSystemBuiltinAbility(tool.meta.id)
      && !NON_CONNECTOR_TOOL_IDS.has(tool.meta.id)
      && !builtinSourceIds.has(tool.meta.id),
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
      sourceLabel: 'MyYoda 内置',
      typeLabel: 'API' as const,
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
      categoryLabel: '自定义',
      sourceLabel: '自定义',
      typeLabel: 'HTTP' as const,
      enabled: tool.enabled,
      available: tool.available,
      ...statusOf(tool.enabled, tool.available),
    }))

  const userMcpItems = input.userEntries
    .filter(([name, entry]) => !isHiddenUserMcp(name, entry))
    .map(([name, entry]) => {
      const available = userMcpAvailable(entry)
      const baseStatus = statusOf(entry.enabled, available, userMcpReason(entry, available))
      // 上次测试失败且仍启用 → 直接标「连接失败」，让用户扫一眼就能发现配置错误的 MCP（原 McpCard 行为）。
      const lastTestFailed = entry.enabled && entry.lastTestResult?.success === false
      return {
        id: `mcp:${name}`,
        kind: 'user-mcp' as const,
        sourceId: name,
        name,
        description: userMcpDescription(entry),
        categoryLabel: '我的连接',
        sourceLabel: '我的连接',
        typeLabel: 'MCP' as const,
        enabled: entry.enabled,
        available,
        status: lastTestFailed ? 'connect_failed' as const : baseStatus.status,
        statusLabel: lastTestFailed ? STATUS_LABEL.connect_failed : baseStatus.statusLabel,
        statusReason: lastTestFailed ? entry.lastTestResult?.message : baseStatus.statusReason,
        nextActionLabel: lastTestFailed ? STATUS_NEXT.connect_failed : baseStatus.nextActionLabel,
      }
    })

  return [...builtinItems, ...apiItems, ...customItems, ...userMcpItems]
}

export function filterConnectorItems(
  items: ConnectorItem[],
  query: string,
  chip: ConnectorFilterChip,
): ConnectorItem[] {
  const q = query.trim().toLowerCase()
  return items.filter((item) => {
    if (chip === 'needs_config' && !isConnectorAttentionStatus(item.status)) return false
    if (chip === 'enabled' && item.status !== 'enabled') return false
    if (chip === 'disabled' && item.status !== 'disabled') return false
    if (chip === 'browser' || chip === 'media' || chip === 'search' || chip === 'mine' || chip === 'custom') {
      if (categoryKeyOf(item.categoryLabel) !== chip) return false
    }
    if (!q) return true
    return (
      item.name.toLowerCase().includes(q)
      || item.description.toLowerCase().includes(q)
      || item.categoryLabel.toLowerCase().includes(q)
      || item.sourceLabel.toLowerCase().includes(q)
      || (item.statusReason?.toLowerCase().includes(q) ?? false)
    )
  })
}

export function groupConnectorItems(items: ConnectorItem[]): ConnectorGroup[] {
  const groups = new Map<string, ConnectorItem[]>()
  for (const item of items) {
    const current = groups.get(item.categoryLabel) ?? []
    current.push(item)
    groups.set(item.categoryLabel, current)
  }

  const ordered = CONNECTOR_CATEGORY_ORDER
    .filter((label) => groups.has(label))
    .map((label) => ({ categoryLabel: label, items: groups.get(label) ?? [] }))

  const rest = [...groups.entries()]
    .filter(([label]) => !(CONNECTOR_CATEGORY_ORDER as readonly string[]).includes(label))
    .map(([categoryLabel, grouped]) => ({ categoryLabel, items: grouped }))

  return [...ordered, ...rest]
}
