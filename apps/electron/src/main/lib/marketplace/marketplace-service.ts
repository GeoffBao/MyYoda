/**
 * marketplace-service — 统一市场服务（本地 + 远程合并/安装/快照注入）
 *
 * 收敛本地 marketplace-manager（官方内置目录）与 community-skill-service
 * （远程社区 manifest）的读侧与安装侧：
 * - 列表：本地 marketplace.json + 远程 sources.yaml 合并，本地优先去重；
 * - 安装：skill → 工作区级 installCommunitySkill；connector → marketplaceInstalled
 *   （远程条目先快照到 marketplaceRemoteItems，避免卸载/注入依赖网络）；
 * - 注入：本地条目 + 远程快照统一转 NpxConnectorSpec（agent-orchestrator 用）。
 */

import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { MarketplaceItem, MarketplaceItemWithStatus } from '@myyoda/shared'
import {
  listMarketplaceCatalog,
  installMarketplaceItem as installLocalConnector,
  uninstallMarketplaceItem as uninstallLocalConnector,
  getMarketplaceInstalledIds,
  marketplaceItemToNpxSpec,
  MARKETPLACE_ID_PREFIX,
} from './marketplace-manager'
import { fetchCommunityManifest, installCommunitySkill, type CommunitySkill } from '../community-skill-service'
import { getChatToolsConfig, saveChatToolsConfig } from '../chat-tool-config'
import { getWorkspaceSkillsDir } from '../config-paths'
import type { NpxConnectorSpec } from '../builtin-mcp/npx-connector-mcp'

/** skill 类型市场条目：附加原 CommunitySkill 引用（安装时原样传递） */
export type MarketplaceSkillItem = MarketplaceItem & {
  skillRef: CommunitySkill
  version?: string
  downloads?: number
}

/** 远程社区 Skill 条目 → 统一市场条目（id = skill.name，slug 即 name） */
export function communitySkillToMarketplaceItem(skill: CommunitySkill): MarketplaceSkillItem {
  return {
    id: skill.name,
    type: 'skill',
    source: 'remote',
    name: skill.displayName ?? skill.name,
    description: skill.description ?? '',
    vendor: skill.verified ? 'official' : 'community',
    author: skill.authorName,
    homepage: skill.homepage,
    category: skill.category,
    version: skill.version,
    downloads: skill.downloads,
    installKind: 'skill',
    skillRef: skill,
  }
}

/** 合并本地 + 远程条目：同 id 本地优先（后写覆盖），保持远程在前便于保留 manifest 顺序 */
export function mergeMarketplaceItems(local: MarketplaceItem[], remote: MarketplaceItem[]): MarketplaceItem[] {
  const byId = new Map<string, MarketplaceItem>()
  for (const item of [...remote, ...local]) byId.set(item.id, item)
  return [...byId.values()]
}

/** 已安装远程连接器快照（id → 条目） */
export function getMarketplaceRemoteItems(): Record<string, MarketplaceItem> {
  return getChatToolsConfig().marketplaceRemoteItems ?? {}
}

/** 快照远程连接器条目（安装前落盘，卸载/注入不依赖网络） */
export function saveMarketplaceRemoteItem(item: MarketplaceItem): void {
  const cfg = getChatToolsConfig()
  cfg.marketplaceRemoteItems = { ...(cfg.marketplaceRemoteItems ?? {}), [item.id]: item }
  saveChatToolsConfig(cfg)
}

/** 移除远程连接器快照（卸载时清理） */
export function removeMarketplaceRemoteItem(itemId: string): void {
  const cfg = getChatToolsConfig()
  if (!cfg.marketplaceRemoteItems) return
  delete cfg.marketplaceRemoteItems[itemId]
  saveChatToolsConfig(cfg)
}

/** 工作区已装 skill slug 集合：扫描 skills/ 下含 SKILL.md 的目录名（slug = 目录名） */
function getInstalledSkillSlugs(workspaceSlug: string): Set<string> {
  const slugs = new Set<string>()
  try {
    const skillsDir = getWorkspaceSkillsDir(workspaceSlug)
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(join(skillsDir, entry.name, 'SKILL.md'))) {
        slugs.add(entry.name)
      }
    }
  } catch {
    // 工作区 skills 目录不存在 → 空集合
  }
  return slugs
}

/**
 * 统一市场列表：本地 + 远程合并，带安装状态。
 * 远程 manifest 拉取失败不抛错（remoteAvailable=false，本地条目照常）。
 */
export async function listMarketplaceItems(
  workspaceSlug: string,
): Promise<{ items: MarketplaceItemWithStatus[]; remoteAvailable: boolean }> {
  const local = listMarketplaceCatalog()
  let remote: MarketplaceItem[] = []
  let remoteAvailable = true
  try {
    const skills = await fetchCommunityManifest()
    remote = skills.map(communitySkillToMarketplaceItem)
  } catch (error) {
    remoteAvailable = false
    console.error('[市场统一] 远程 manifest 拉取失败，仅展示本地条目:', error)
  }
  const merged = mergeMarketplaceItems(local, remote)
  const installedConnectors = new Set(getMarketplaceInstalledIds())
  const installedSlugs = getInstalledSkillSlugs(workspaceSlug)
  return {
    remoteAvailable,
    items: merged.map((item) => ({
      ...item,
      installed:
        item.type === 'skill' ? installedSlugs.has(item.id) : installedConnectors.has(item.id),
    })),
  }
}

/** 从远程 manifest 查找条目（失败/未找到返回 undefined） */
async function fetchRemoteItem(itemId: string): Promise<MarketplaceItem | undefined> {
  try {
    const skills = await fetchCommunityManifest()
    return skills.map(communitySkillToMarketplaceItem).find((i) => i.id === itemId)
  } catch {
    return undefined
  }
}

/**
 * 安装市场条目：本地优先，其次远程 manifest。
 * - skill → 工作区级 installCommunitySkill（skillRef 原样传递）；
 * - connector（远程）→ 先快照到 marketplaceRemoteItems 再写 marketplaceInstalled；
 * - connector（本地）→ 现有 installMarketplaceItem。
 */
export async function installMarketplaceItem(itemId: string, workspaceSlug: string): Promise<void> {
  const local = listMarketplaceCatalog().find((i) => i.id === itemId)
  const remote = await fetchRemoteItem(itemId)
  const item = local ?? remote
  if (!item) throw new Error(`市场条目不存在：${itemId}`)

  if (item.type === 'skill') {
    const skillItem = item as MarketplaceSkillItem
    if (!skillItem.skillRef) throw new Error('Skill 条目缺少引用')
    await installCommunitySkill(getWorkspaceSkillsDir(workspaceSlug), skillItem.skillRef)
    return
  }

  if (item.source === 'remote') saveMarketplaceRemoteItem(item)
  installLocalConnector(itemId)
}

/** 卸载市场条目：移除 installed 与远程快照（凭据保留，重装复用） */
export async function uninstallMarketplaceItem(itemId: string): Promise<void> {
  removeMarketplaceRemoteItem(itemId)
  uninstallLocalConnector(itemId)
}

/** 已安装市场连接器 → NpxConnectorSpec（本地目录 + 远程快照统一注入） */
export function getInstalledMarketplaceSpecs(): NpxConnectorSpec[] {
  const installed = new Set(getMarketplaceInstalledIds())
  const local = listMarketplaceCatalog()
  const remote = Object.values(getMarketplaceRemoteItems())
  return [...local, ...remote]
    .filter((item) => item.installKind === 'npx-mcp' && installed.has(item.id))
    .map(marketplaceItemToNpxSpec)
}

export { MARKETPLACE_ID_PREFIX }
