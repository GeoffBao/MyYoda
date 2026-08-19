/**
 * marketplace-manager — 市场目录（plugin_creator 接口）
 *
 * 对标 OpenAI Plugins / Trae Marketplace 的「预置目录 + 用户决策安装」模型：
 * - 目录数据在 marketplace.json（官方/稳定条目优先），随应用内置，零运行时占用；
 * - 用户点「安装」→ 写入 chat-tools.json 的 marketplaceInstalled 列表（全局，非工作区级，
 *   因为 npx 连接器注入本身是应用级能力；凭据仍在 toolCredentials['marketplace:<id>']）；
 * - 安装后由 agent-orchestrator 把条目转成 NpxConnectorSpec 走同一注入器；
 * - 卸载 = 从列表移除（保留凭据，重新安装可复用）。
 */

import { readFileSync } from 'fs'
import path from 'path'
import type { MarketplaceItem, MarketplaceItemWithStatus } from '@myyoda/shared'
import { getChatToolsConfig, saveChatToolsConfig } from '../chat-tool-config'
import { hasNpxConnectorCredentials, type NpxConnectorSpec } from '../builtin-mcp/npx-connector-mcp'

/** 市场条目唯一前缀（避免与内置 MCP id / 用户自定义冲突） */
export const MARKETPLACE_ID_PREFIX = 'marketplace:'

let cachedItems: MarketplaceItem[] | null = null

/** 读取内置市场目录（首次读盘后缓存） */
export function listMarketplaceCatalog(): MarketplaceItem[] {
  if (cachedItems) return cachedItems
  try {
    const raw = readFileSync(path.join(__dirname, 'marketplace.json'), 'utf-8')
    const parsed = JSON.parse(raw) as { items: MarketplaceItem[] }
    // 兼容旧数据：目录条目缺省视为本地内置来源
    cachedItems = (parsed.items ?? []).map((item) => ({ ...item, source: item.source ?? 'local' }))
  } catch (error) {
    console.error('[市场目录] 读取失败:', error)
    cachedItems = []
  }
  return cachedItems
}

/** 已安装的市场条目 id（持久化在 chat-tools.json） */
export function getMarketplaceInstalledIds(): string[] {
  return getChatToolsConfig().marketplaceInstalled ?? []
}

/** 市场条目 + 安装状态（渲染进程展示用） */
export function listMarketplaceItemsWithStatus(): MarketplaceItemWithStatus[] {
  const installed = new Set(getMarketplaceInstalledIds())
  return listMarketplaceCatalog().map((item) => ({ ...item, installed: installed.has(item.id) }))
}

/** 安装市场条目（plugin_creator：install） */
export function installMarketplaceItem(itemId: string): MarketplaceItem {
  const item = listMarketplaceCatalog().find((i) => i.id === itemId)
  if (!item) throw new Error(`市场条目不存在：${itemId}`)
  const config = getChatToolsConfig()
  const installed = new Set(config.marketplaceInstalled ?? [])
  if (!installed.has(itemId)) {
    installed.add(itemId)
    config.marketplaceInstalled = [...installed]
    saveChatToolsConfig(config)
  }
  return item
}

/** 卸载市场条目（plugin_creator：uninstall；凭据保留以便重装复用） */
export function uninstallMarketplaceItem(itemId: string): void {
  const config = getChatToolsConfig()
  const installed = (config.marketplaceInstalled ?? []).filter((id) => id !== itemId)
  config.marketplaceInstalled = installed
  saveChatToolsConfig(config)
}

/** 市场条目 → NpxConnectorSpec（与内置连接器同一注入器） */
export function marketplaceItemToNpxSpec(item: MarketplaceItem): NpxConnectorSpec {
  return {
    id: `${MARKETPLACE_ID_PREFIX}${item.id}`,
    npmPackage: item.npxPackage ?? item.id,
    extraArgs: item.npxArgs,
    envMap: item.envMap,
  }
}

/** 已安装市场连接器是否已配置凭据（catalog 可用性 / UI 状态判断） */
export function hasMarketplaceCredentials(item: MarketplaceItem): boolean {
  if (item.installKind !== 'npx-mcp') return true
  const spec = marketplaceItemToNpxSpec(item)
  return hasNpxConnectorCredentials(spec)
}

/** 已安装的市场连接器规格列表（agent-orchestrator 注入用） */
export function getInstalledMarketplaceSpecs(): NpxConnectorSpec[] {
  const installed = new Set(getMarketplaceInstalledIds())
  return listMarketplaceCatalog()
    .filter((item) => item.installKind === 'npx-mcp' && installed.has(item.id))
    .map(marketplaceItemToNpxSpec)
}
