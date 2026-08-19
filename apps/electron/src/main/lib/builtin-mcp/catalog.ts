/**
 * MyYoda 内置 MCP 能力目录
 *
 * 这里只维护可展示的元数据和可用性判断，不负责运行时注入。
 * 元数据本身来自 default-mcp.json（经 baseline 加载），本文件只在其上叠加
 * 运行时可用性判断（API Key、工作区、登录态等）。这样前端能力摘要可以安全读取
 * 内置 MCP 列表，而不会引入 Agent 编排层循环依赖。
 */

import type { BuiltinMcpServerSummary } from '@myyoda/shared'
import { getToolCredentials, getToolState } from '../chat-tool-config'
import { hasWecomCredentials } from './wecom-mcp'
import { hasNpxConnectorCredentials, NPX_CONNECTOR_SPECS } from './npx-connector-mcp'
import { getBuiltinMcpDefinitions, type BuiltinMcpDefinition } from './baseline'
import { isBuiltinMcpDefaultDisabled, isBuiltinMcpUserEnabled } from './settings'

interface BuiltinMcpListContext {
  workspaceSlug?: string
}

function resolveAvailability(
  item: BuiltinMcpDefinition,
  ctx: BuiltinMcpListContext,
): Pick<BuiltinMcpServerSummary, 'enabled' | 'available' | 'availabilityReason'> {
  // 基础设施型（如 myyoda-cloud）：登录后始终注入，不受用户开关影响
  if (item.toggleable === false) {
    return { enabled: true, available: true }
  }

  const userEnabled = isBuiltinMcpUserEnabled(item.id)
  if (!userEnabled) {
    return {
      enabled: false,
      available: false,
      availabilityReason: isBuiltinMcpDefaultDisabled(item.id)
        ? '默认关闭，可手动开启'
        : '已手动关闭',
    }
  }

  if (item.id === 'collaboration') {
    const available = !!ctx.workspaceSlug
    return {
      enabled: true,
      available,
      availabilityReason: available ? undefined : '需要先选择工作区',
    }
  }

  if (item.id === 'nano-banana') {
    const state = getToolState('nano-banana')
    const credentials = getToolCredentials('nano-banana')
    const available = state.enabled && !!credentials.apiKey
    return {
      enabled: true,
      available,
      availabilityReason: available
        ? undefined
        : state.enabled ? '需要配置 Gemini API Key' : 'Nano Banana 未启用',
    }
  }

  if (item.id === 'wecom') {
    const available = hasWecomCredentials()
    return {
      enabled: true,
      available,
      availabilityReason: available
        ? undefined
        : '需要在 API Tab 配置 Bot ID / Secret，或在终端执行 wecom-cli auth init',
    }
  }

  if (item.id === 'readwise') {
    const token = getToolCredentials('readwise').token
    const available = !!token?.trim()
    return {
      enabled: true,
      available,
      availabilityReason: available
        ? undefined
        : '需要在 API Tab 配置 Readwise API Token（readwise.io/access_token 获取）',
    }
  }

  if (item.id === 'weread') {
    const apiKey = getToolCredentials('weread').apiKey
    const available = !!apiKey?.trim()
    return {
      enabled: true,
      available,
      availabilityReason: available
        ? undefined
        : '需要在 API Tab 配置微信读书 API Key（wrk- 开头，官方页面获取）',
    }
  }

  // Phase 2 外部 npx 连接器（GitHub/GitLab/Notion/Figma/Brave Search/Exa/Browserbase）：
  // 凭据齐全才可用；自研桥接连接器（git/fetch/sqlite）无凭据要求，直接可用。
  const npxSpec = NPX_CONNECTOR_SPECS.find((spec) => spec.id === item.id)
  if (npxSpec) {
    const available = hasNpxConnectorCredentials(npxSpec)
    return {
      enabled: true,
      available,
      availabilityReason: available
        ? undefined
        : `需要在连接器详情中配置凭据（${Object.keys(npxSpec.envMap ?? {}).length} 项）`,
    }
  }

  return { enabled: true, available: true }
}

export function listBuiltinMcpServers(ctx: BuiltinMcpListContext = {}): BuiltinMcpServerSummary[] {
  return getBuiltinMcpDefinitions().map((item) => ({
    id: item.id,
    name: item.name,
    displayName: item.displayName,
    description: item.description,
    category: item.category,
    tools: item.tools,
    toggleable: item.toggleable,
    source: item.source,
    ...resolveAvailability(item, ctx),
  }))
}
