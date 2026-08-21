import type {
  BuiltinMcpServerSummary,
  ChatToolInfo,
  McpServerEntry,
  SkillMeta,
} from '@myyoda/shared'
import { isSystemBuiltinAbility, buildConnectorItems, isConnectorAttentionStatus } from './connectors-model'
import type { PluginCenterTab } from './plugin-center-model'

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

function connectorPendingItem(
  item: { sourceId: string; name: string; statusReason?: string; nextActionLabel?: string },
): PluginOverviewItem {
  return {
    id: `connector:${item.sourceId}`,
    title: item.name,
    description: item.statusReason ?? '连接器当前不可用，请检查配置或授权。',
    actionTab: 'connectors',
    actionConnectorId: item.sourceId,
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
      .filter((server) => isSystemBuiltinAbility(server.id))
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
            actionTab: 'skills' as const,
            actionLabel: '去更新',
          }]
        : []),
    ],
    quickActions: [
      { id: 'new-expert', title: '新建专家', description: '创建一个新的 Agent 角色。' },
      {
        id: 'add-connector',
        title: '添加连接器',
        description: '连接外部系统或工具。',
        actionTab: 'connectors',
      },
      {
        id: 'install-skill',
        title: '安装技能',
        description: '添加可复用工作流。',
        actionTab: 'skills',
      },
      {
        id: 'memory',
        title: '整理记忆',
        description: '查看 Workspace 长期记忆。',
        actionTab: 'memory',
      },
    ],
    recommendations: [
      {
        id: 'chrome-devtools',
        title: 'Chrome 浏览器',
        description: '打开真实网页、截图与检查 DOM。',
        actionTab: 'connectors',
        actionConnectorId: 'chrome-devtools',
        actionLabel: '查看',
      },
      {
        id: 'web-search',
        title: '联网搜索',
        description: '为 Agent 提供实时网页搜索。',
        actionTab: 'connectors',
        actionConnectorId: 'web-search',
        actionLabel: '查看',
      },
      {
        id: 'nano-banana',
        title: 'Nano Banana 生图',
        description: '用 Gemini 生成和编辑图片。',
        actionTab: 'connectors',
        actionConnectorId: 'nano-banana',
        actionLabel: '查看',
      },
    ],
    builtinAbilities,
  }
}
