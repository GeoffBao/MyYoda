export type PluginCenterTab = 'overview' | 'experts' | 'teams' | 'skills' | 'connectors' | 'memory'

export interface PluginCenterTabDef {
  value: PluginCenterTab
  label: string
  searchPlaceholder: string
}

export const PLUGIN_CENTER_TABS: PluginCenterTabDef[] = [
  { value: 'overview', label: '总览', searchPlaceholder: '搜索插件...' },
  { value: 'experts', label: '专家', searchPlaceholder: '搜索专家名称或 slug...' },
  { value: 'teams', label: '专家团', searchPlaceholder: '搜索专家团名称或角色...' },
  { value: 'skills', label: '技能', searchPlaceholder: '搜索技能...' },
  { value: 'connectors', label: '连接器', searchPlaceholder: '搜索连接器...' },
  { value: 'memory', label: '记忆', searchPlaceholder: '搜索记忆文件...' },
]

const VALID_TABS = new Set<string>(PLUGIN_CENTER_TABS.map((tab) => tab.value))

/** 将 atom 存储值（含 legacy mcp/api）归一化为规范 Tab。 */
export function normalizePluginCenterTab(value: string | null | undefined): PluginCenterTab {
  if (value === 'mcp' || value === 'api') return 'connectors'
  if (value && VALID_TABS.has(value)) return value as PluginCenterTab
  return 'overview'
}

export function pluginCenterTabIndex(tab: PluginCenterTab): number {
  return PLUGIN_CENTER_TABS.findIndex((item) => item.value === tab)
}

export function pluginCenterTabWidthPercent(): number {
  return 100 / PLUGIN_CENTER_TABS.length
}
