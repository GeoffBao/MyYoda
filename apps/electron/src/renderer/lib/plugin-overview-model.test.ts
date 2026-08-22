import { describe, expect, test } from 'bun:test'
import type { BuiltinMcpServerSummary, ChatToolInfo, McpServerEntry } from '@myyoda/shared'
import { buildPluginOverviewModel } from './plugin-overview-model'

function chatTool(id: string, enabled: boolean, available: boolean): ChatToolInfo {
  return {
    meta: {
      id,
      name: id,
      description: `${id} description`,
      params: [],
      category: 'builtin',
      executorType: 'builtin',
    },
    enabled,
    available,
  }
}

function userMcp(enabled: boolean): McpServerEntry {
  return { type: 'stdio', command: 'example', enabled }
}

function builtinMcp(
  id: string,
  displayName: string,
  category: BuiltinMcpServerSummary['category'],
  enabled: boolean,
  available: boolean,
  availabilityReason?: string,
): BuiltinMcpServerSummary {
  return {
    id,
    name: id,
    displayName,
    description: `${displayName} description`,
    category,
    enabled,
    available,
    availabilityReason,
    tools: [],
  }
}

describe('plugin-overview-model', () => {
  test('counts only enabled and available plugin capabilities', () => {
    const overview = buildPluginOverviewModel({
      skills: [
        { slug: 'tdd', name: 'TDD', enabled: true, hasUpdate: true },
        { slug: 'pdf', name: 'PDF', enabled: false, hasUpdate: true },
      ],
      expertsCount: 2,
      teamsCount: 1,
      builtinMcpServers: [
        builtinMcp('github', 'GitHub', 'system', true, true),
        builtinMcp('chrome-devtools', 'Chrome', 'browser', true, false, '需要安装 Chrome'),
        builtinMcp('automation', '自动化', 'automation', true, true),
      ],
      userMcpEntries: [
        ['filesystem', userMcp(true)],
        ['disabled-server', userMcp(false)],
      ],
      chatTools: [
        chatTool('web-search', true, true),
        chatTool('missing-credential', true, false),
        chatTool('disabled-tool', false, true),
      ],
    })

    expect(overview.summary.enabledPlugins).toBe(7)
    expect(overview.summary.skillsWithUpdates).toBe(2)
  })

  test('creates pending items for connectors that cannot run, including default-off ones', () => {
    const overview = buildPluginOverviewModel({
      skills: [],
      expertsCount: 0,
      teamsCount: 0,
      builtinMcpServers: [
        builtinMcp('chrome-devtools', 'Chrome', 'browser', true, false, '需要安装 Chrome'),
        builtinMcp('disabled-builtin', '关闭的连接器', 'system', false, false),
      ],
      userMcpEntries: [],
      chatTools: [
        chatTool('missing-credential', true, false),
        chatTool('disabled-tool', false, false),
      ],
    })

    expect(overview.summary.connectorsNeedingAttention).toBe(4)
    expect(overview.pendingItems.map((item) => item.id)).toEqual([
      'connector:builtin:chrome-devtools',
      'connector:builtin:disabled-builtin',
      'connector:api:missing-credential',
      'connector:api:disabled-tool',
    ])
    expect(overview.pendingItems[0]).toMatchObject({
      title: 'Chrome',
      description: '需要安装 Chrome',
      action: 'open-connector',
      actionConnectorId: 'builtin:chrome-devtools',
      actionLabel: '去处理',
    })
  })

  test('classifies Runtime abilities outside connector and plugin counts', () => {
    const overview = buildPluginOverviewModel({
      skills: [],
      expertsCount: 0,
      teamsCount: 0,
      builtinMcpServers: [
        builtinMcp('automation', '自动化', 'automation', true, true),
        builtinMcp('collaboration', '协作', 'collaboration', true, true),
        builtinMcp('create-task', '创建任务', 'task', true, true),
      ],
      userMcpEntries: [],
      chatTools: [],
    })

    expect(overview.summary.enabledPlugins).toBe(0)
    expect(overview.summary.connectorsNeedingAttention).toBe(0)
    expect(overview.builtinAbilities.map((item) => item.id)).toEqual([
      'automation',
      'collaboration',
      'create-task',
      'managed-browser',
      'planning',
    ])
    expect(overview.summary.builtinAbilities).toBe(5)
  })

  test('deduplicates matching builtin MCP and chat tool source ids with builtin priority', () => {
    const unavailableBuiltin = buildPluginOverviewModel({
      skills: [],
      expertsCount: 0,
      teamsCount: 0,
      builtinMcpServers: [
        builtinMcp('nano-banana', 'Nano Banana MCP', 'media', true, false, 'Agent 凭据缺失'),
      ],
      userMcpEntries: [],
      chatTools: [chatTool('nano-banana', true, true)],
    })

    expect(unavailableBuiltin.summary.enabledPlugins).toBe(0)
    expect(unavailableBuiltin.summary.connectorsNeedingAttention).toBe(1)
    expect(unavailableBuiltin.pendingItems).toHaveLength(1)
    expect(unavailableBuiltin.pendingItems[0]?.title).toContain('Nano Banana MCP')

    const availableBuiltin = buildPluginOverviewModel({
      skills: [],
      expertsCount: 0,
      teamsCount: 0,
      builtinMcpServers: [
        builtinMcp('nano-banana', 'Nano Banana MCP', 'media', true, true),
      ],
      userMcpEntries: [],
      chatTools: [chatTool('nano-banana', true, false)],
    })

    expect(availableBuiltin.summary.enabledPlugins).toBe(1)
    expect(availableBuiltin.summary.connectorsNeedingAttention).toBe(0)
    expect(availableBuiltin.pendingItems).toHaveLength(0)
  })

  test('exposes product surfaces in quick actions and namespaced recommendation ids', () => {
    const overview = buildPluginOverviewModel({
      skills: [],
      expertsCount: 0,
      teamsCount: 0,
      builtinMcpServers: [],
      userMcpEntries: [],
      chatTools: [],
    })

    expect(overview.quickActions.map((item) => item.id)).toEqual([
      'community-market',
      'messaging',
      'add-connector',
      'install-skill',
      'memory',
      'new-expert',
    ])
    expect(overview.quickActions[0]).toMatchObject({
      action: 'open-community-market',
      title: '社区市场',
    })
    expect(overview.quickActions[1]).toMatchObject({
      action: 'open-messaging',
      title: '消息与通知',
    })
    expect(overview.recommendations.map((item) => item.actionConnectorId)).toEqual([
      'builtin:chrome-devtools',
      'api:web-search',
      'builtin:nano-banana',
    ])
  })
})
