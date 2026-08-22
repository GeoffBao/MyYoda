import type {
  BuiltinMcpServerSummary,
  ChatToolInfo,
  McpServerEntry,
  SkillMeta,
} from '@myyoda/shared'
import { isInternalBuiltinCategory, buildConnectorItems, isConnectorAttentionStatus, type ConnectorItem } from './connectors-model'
import type { PluginCenterTab } from './plugin-center-model'

export type PluginOverviewAction =
  | 'open-tab'
  | 'open-connector'
  | 'open-community-market'
  | 'open-messaging'
  | 'create-expert'

export interface PluginOverviewInput {
  skills: SkillMeta[]
  expertsCount: number
  teamsCount: number
  builtinMcpServers: BuiltinMcpServerSummary[]
  userMcpEntries: Array<[string, McpServerEntry]>
  chatTools: ChatToolInfo[]
}

export interface PluginOverviewItem {
  id: string
  title: string
  description: string
  action?: PluginOverviewAction
  actionTab?: PluginCenterTab
  actionConnectorId?: string
  actionLabel?: string
}

export interface PluginOverviewModel {
  summary: {
    enabledPlugins: number
    connectorsNeedingAttention: number
    skillsWithUpdates: number
    builtinAbilities: number
  }
  pendingItems: PluginOverviewItem[]
  quickActions: PluginOverviewItem[]
  recommendations: PluginOverviewItem[]
  builtinAbilities: PluginOverviewItem[]
}

function connectorPendingItem(item: ConnectorItem): PluginOverviewItem {
  return {
    // id 与 actionConnectorId 均用带 kind 命名空间的完整 id（如 api:web-search / mcp:web-search），
    // 避免自建 MCP 与内置/API 连接器同名时误路由或 React key 冲突（PR #111 同源教训）。
    id: `connector:${item.id}`,
    title: item.name,
    description: item.statusReason ?? '连接器当前不可用，请检查配置或授权。',
    action: 'open-connector',
    actionTab: 'connectors',
    actionConnectorId: item.id,
    actionLabel: item.nextActionLabel ?? '去配置',
  }
}

export function buildPluginOverviewModel(input: PluginOverviewInput): PluginOverviewModel {
  const enabledSkills = input.skills.filter((skill) => skill.enabled).length
  const skillsWithUpdates = input.skills.filter((skill) => skill.hasUpdate).length

  const connectors = buildConnectorItems({
    builtinServers: input.builtinMcpServers,
    userEntries: input.userMcpEntries,
    chatTools: input.chatTools,
  })
  const attentionConnectors = connectors.filter((item) => isConnectorAttentionStatus(item.status))
  const enabledConnectors = connectors.filter((item) => item.status === 'enabled')

  const builtinAbilities: PluginOverviewItem[] = [
    ...input.builtinMcpServers
      .filter((server) => isInternalBuiltinCategory(server.category))
      .map((server) => ({
        id: server.id,
        title: server.displayName,
        description: server.available
          ? (server.enabled ? '已启用' : '已关闭')
          : (server.availabilityReason ?? '当前不可用'),
      })),
    {
      id: 'managed-browser',
      title: '受管浏览器',
      description: '按需对 Agent 可用',
    },
    {
      id: 'planning',
      title: 'Todo / 日程',
      description: '按任务场景可用',
    },
  ]

  const connectorPendingItems = attentionConnectors.map((item) => connectorPendingItem(item))

  return {
    summary: {
      enabledPlugins:
        enabledSkills
        + input.expertsCount
        + input.teamsCount
        + enabledConnectors.length,
      connectorsNeedingAttention: connectorPendingItems.length,
      skillsWithUpdates,
      builtinAbilities: builtinAbilities.length,
    },
    pendingItems: [
      ...connectorPendingItems,
      ...(skillsWithUpdates > 0
        ? [{
            id: 'skills:update',
            title: `${skillsWithUpdates} 个技能可更新`,
            description: '查看技能来源更新并决定是否同步。',
            action: 'open-tab' as const,
            actionTab: 'skills' as const,
            actionLabel: '去更新',
          }]
        : []),
    ],
    quickActions: [
      {
        id: 'community-market',
        title: '社区市场',
        description: '浏览并安装社区发布的技能。',
        action: 'open-community-market',
      },
      {
        id: 'messaging',
        title: '消息与通知',
        description: '配置飞书等 IM 渠道。',
        action: 'open-messaging',
      },
      {
        id: 'add-connector',
        title: '添加连接器',
        description: '连接外部系统或工具。',
        action: 'open-tab',
        actionTab: 'connectors',
      },
      {
        id: 'install-skill',
        title: '安装技能',
        description: '添加可复用工作流。',
        action: 'open-tab',
        actionTab: 'skills',
      },
      {
        id: 'memory',
        title: '整理记忆',
        description: '查看 Workspace 长期记忆。',
        action: 'open-tab',
        actionTab: 'memory',
      },
      {
        id: 'new-expert',
        title: '新建专家',
        description: '创建一个新的 Agent 角色。',
        action: 'create-expert',
      },
    ],
    recommendations: [
      {
        id: 'chrome-devtools',
        title: 'Chrome 浏览器',
        description: '打开真实网页、截图与检查 DOM。',
        action: 'open-connector',
        actionTab: 'connectors',
        actionConnectorId: 'builtin:chrome-devtools',
        actionLabel: '查看',
      },
      {
        id: 'web-search',
        title: '联网搜索',
        description: '为 Agent 提供实时网页搜索。',
        action: 'open-connector',
        actionTab: 'connectors',
        actionConnectorId: 'api:web-search',
        actionLabel: '查看',
      },
      {
        id: 'nano-banana',
        title: 'Nano Banana 生图',
        description: '用 Gemini 生成和编辑图片。',
        action: 'open-connector',
        actionTab: 'connectors',
        actionConnectorId: 'builtin:nano-banana',
        actionLabel: '查看',
      },
    ],
    builtinAbilities,
  }
}
