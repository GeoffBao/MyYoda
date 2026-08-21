import type {
  BuiltinMcpServerSummary,
  ChatToolInfo,
  McpServerEntry,
  SkillMeta,
} from '@myyoda/shared'

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
  actionTab?: 'skills' | 'connectors' | 'memory'
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

const RUNTIME_ABILITY_IDS = new Set(['automation', 'collaboration', 'create-task'])

function connectorPendingItem(
  id: string,
  title: string,
  description?: string,
): PluginOverviewItem {
  return {
    id: `connector:${id}`,
    title: `${title} 需要处理`,
    description: description ?? '连接器当前不可用，请检查配置或授权。',
    actionTab: 'connectors',
  }
}

export function buildPluginOverviewModel(input: PluginOverviewInput): PluginOverviewModel {
  const enabledSkills = input.skills.filter((skill) => skill.enabled).length
  const skillsWithUpdates = input.skills.filter((skill) => skill.hasUpdate).length
  const enabledUserMcp = input.userMcpEntries.filter(([, entry]) => entry.enabled && !entry.isBuiltin).length

  const connectorBuiltins = input.builtinMcpServers.filter(
    (server) => !RUNTIME_ABILITY_IDS.has(server.id),
  )
  const builtinSourceIds = new Set(connectorBuiltins.map((server) => server.id))
  const uniqueChatTools = input.chatTools.filter(
    (tool) => !builtinSourceIds.has(tool.meta.id) && !RUNTIME_ABILITY_IDS.has(tool.meta.id),
  )

  const availableBuiltinConnectors = connectorBuiltins.filter(
    (server) => server.enabled && server.available,
  )
  const availableChatTools = uniqueChatTools.filter((tool) => tool.enabled && tool.available)
  const unavailableBuiltinConnectors = connectorBuiltins.filter(
    (server) => server.enabled && !server.available,
  )
  const unavailableChatTools = uniqueChatTools.filter(
    (tool) => tool.enabled && !tool.available,
  )

  const builtinAbilities: PluginOverviewItem[] = [
    ...input.builtinMcpServers
      .filter((server) => RUNTIME_ABILITY_IDS.has(server.id))
      .map((server) => ({
        id: server.id,
        title: server.displayName,
        description: server.available
          ? (server.enabled ? 'Runtime 已启用' : 'Runtime 已关闭')
          : (server.availabilityReason ?? 'Runtime 当前不可用'),
      })),
    {
      id: 'managed-browser',
      title: '受管浏览器',
      description: '由 MyYoda Runtime 托管，按需对 Agent 可用。',
    },
    {
      id: 'planning',
      title: 'Todo / 日程',
      description: 'Pi Planning 工具，按任务场景对 Agent 可用。',
    },
  ]

  const connectorPendingItems = [
    ...unavailableBuiltinConnectors.map((server) =>
      connectorPendingItem(server.id, server.displayName, server.availabilityReason),
    ),
    ...unavailableChatTools.map((tool) =>
      connectorPendingItem(tool.meta.id, tool.meta.name),
    ),
  ]

  return {
    summary: {
      enabledPlugins:
        enabledSkills
        + input.expertsCount
        + input.teamsCount
        + enabledUserMcp
        + availableBuiltinConnectors.length
        + availableChatTools.length,
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
        id: 'github',
        title: 'GitHub 连接器',
        description: '研发与交付常用连接器。',
        actionTab: 'connectors',
      },
      {
        id: 'code-review-expert',
        title: '代码审查专家',
        description: '为代码评审任务提供稳定角色。',
      },
      {
        id: 'session-cleaner',
        title: 'session-cleaner',
        description: '清洗和整理长会话记录。',
        actionTab: 'skills',
      },
    ],
    builtinAbilities,
  }
}
