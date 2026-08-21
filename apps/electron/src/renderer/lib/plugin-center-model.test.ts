import { describe, expect, test } from 'bun:test'
import {
  PLUGIN_CENTER_TABS,
  normalizePluginCenterTab,
  pluginCenterTabIndex,
  pluginCenterTabWidthPercent,
} from './plugin-center-model'

describe('plugin-center-model', () => {
  test('defines approved plugin center tab order', () => {
    expect(PLUGIN_CENTER_TABS.map((tab) => tab.value)).toEqual([
      'overview', 'experts', 'teams', 'skills', 'connectors', 'memory',
    ])
    expect(PLUGIN_CENTER_TABS.map((tab) => tab.label)).toEqual([
      '总览', '专家', '专家团', '技能', '连接器', '记忆',
    ])
  })

  test('maps legacy mcp/api tabs to connectors', () => {
    expect(normalizePluginCenterTab('mcp')).toBe('connectors')
    expect(normalizePluginCenterTab('api')).toBe('connectors')
  })

  test('falls back invalid values to overview', () => {
    expect(normalizePluginCenterTab(undefined)).toBe('overview')
    expect(normalizePluginCenterTab(null)).toBe('overview')
    expect(normalizePluginCenterTab('market')).toBe('overview')
  })

  test('computes tab index and indicator width', () => {
    expect(pluginCenterTabIndex('overview')).toBe(0)
    expect(pluginCenterTabIndex('connectors')).toBe(4)
    expect(pluginCenterTabWidthPercent()).toBeCloseTo(100 / 6)
  })
})
