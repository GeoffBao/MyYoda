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

import { readdirSync, existsSync, mkdirSync, cpSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

/** 市场列表结果缓存（30s TTL：避免每次打开 Tab 重复执行 CLI 检测命令） */
const MARKET_LIST_CACHE_TTL_MS = 30_000
const marketListCache = new Map<string, { ts: number; data: { items: MarketplaceItemWithStatus[]; remoteAvailable: boolean } }>()

export function invalidateMarketListCache(): void {
  marketListCache.clear()
}

/** 执行命令并返回 stdout（异步，快速失败）；失败返回空字符串 */
async function runCommand(command: string, timeoutMs: number): Promise<string> {
  try {
    const { stdout } = await execAsync(command, { timeout: timeoutMs })
    return stdout ?? ''
  } catch {
    return ''
  }
}
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
import { getChatToolsConfig, saveChatToolsConfig, getToolCredentials } from '../chat-tool-config'
import { getWorkspaceSkillsDir } from '../config-paths'
import type { NpxConnectorSpec } from '../builtin-mcp/npx-connector-mcp'

/** skill 类型市场条目：附加原 CommunitySkill 引用（安装时原样传递） */
export type MarketplaceSkillItem = MarketplaceItem & {
  skillRef: CommunitySkill
  version?: string
  downloads?: number
}

/** 远程社区 Skill 分类 → 中文标签（本地条目 category 已是中文） */
const REMOTE_CATEGORY_LABELS: Record<string, string> = {
  video: '视频',
  devtools: '开发工具',
  reading: '阅读',
  presentation: '演示',
  visualization: '可视化',
  documents: '文档',
  camera: '相机诊断',
  web: '网页',
  search: '搜索',
  productivity: '效率工具',
  frontend: '前端',
}

/** 远程分类 → 中文（未知分类保持原文） */
export function translateRemoteCategory(category: string | undefined): string | undefined {
  if (!category) return undefined
  return REMOTE_CATEGORY_LABELS[category] ?? category
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
    category: translateRemoteCategory(skill.category),
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

/** 用户主动卸载/忽略的条目 id */
function getMarketplaceIgnoredIds(): string[] {
  return getChatToolsConfig().marketplaceIgnored ?? []
}

/** 已安装但被停用的条目 id（开关关闭的集合） */
function getMarketplaceDisabledIds(): string[] {
  return getChatToolsConfig().marketplaceDisabled ?? []
}

/** 设置条目停用状态（true=停用注入；false=恢复启用；不改 marketplaceInstalled） */
function setMarketplaceDisabled(itemId: string, disabled: boolean): void {
  const cfg = getChatToolsConfig()
  const set = new Set(cfg.marketplaceDisabled ?? [])
  if (disabled) set.add(itemId)
  else set.delete(itemId)
  cfg.marketplaceDisabled = [...set]
  saveChatToolsConfig(cfg)
}

/** 设置条目忽略状态（true=卸载后不自动显示；false=重新添加时解除） */
function setMarketplaceIgnored(itemId: string, ignored: boolean): void {
  const cfg = getChatToolsConfig()
  const set = new Set(cfg.marketplaceIgnored ?? [])
  if (ignored) set.add(itemId)
  else set.delete(itemId)
  cfg.marketplaceIgnored = [...set]
  saveChatToolsConfig(cfg)
}

/**
 * CLI 检测结果缓存（60s TTL）：开关切换/列表刷新时不重复执行慢命令（command -v / whoami 网络请求）。
 * 与 marketListCache 独立：toggle/install/uninstall 只清列表缓存，检测缓存保持到 TTL。
 */
const CLI_CHECK_CACHE_TTL_MS = 60_000
const cliCheckCache = new Map<string, { ts: number; value: boolean }>()

async function cachedCliCheck(key: string, check: () => Promise<boolean>): Promise<boolean> {
  const hit = cliCheckCache.get(key)
  if (hit && Date.now() - hit.ts < CLI_CHECK_CACHE_TTL_MS) return hit.value
  const value = await check()
  cliCheckCache.set(key, { ts: Date.now(), value })
  return value
}

/** 检测系统是否已安装某 CLI 命令（command -v / where，异步，60s 缓存） */
async function systemHasCli(command: string): Promise<boolean> {
  return cachedCliCheck(`has:${command}`, async () => {
    // 先用当前 PATH 快速检测（覆盖系统级安装）
    const fast = await runCommand(`command -v ${command} 2>/dev/null || where ${command} 2>/dev/null`, 1500)
    if (fast.trim()) return true
    // Electron 主进程 PATH 可能不含 nvm 路径 → 用 login shell 检测
    const slow = await runCommand(`zsh -ilc "command -v ${command}" 2>/dev/null`, 5000)
    return Boolean(slow.trim())
  })
}

/** 检测 npx 连接器凭据是否已配置（所有必填字段非空） */
function hasNpxCredentials(itemId: string, envMap?: Record<string, string>): boolean {
  if (!envMap || Object.keys(envMap).length === 0) return true
  const credentials = getToolCredentials(`${MARKETPLACE_ID_PREFIX}${itemId}`) as Record<string, string | undefined>
  return Object.keys(envMap).every((key) => Boolean(credentials[key]?.trim()))
}

/** 检测 CLI 认证状态（执行 authCheckCommand，输出含 authFailPattern 则未认证，异步，60s 缓存） */
async function checkCliAuth(item: MarketplaceItem): Promise<boolean> {
  if (!item.authCheckCommand) return true  // 无检测命令 → 视为已认证
  return cachedCliCheck(`auth:${item.id}`, async () => {
    const fast = await runCommand(item.authCheckCommand as string, 4000)
    if (fast) {
      if (item.authFailPattern && fast.toLowerCase().includes(item.authFailPattern.toLowerCase())) return false
      return true
    }
    // fallback: login shell
    const slow = await runCommand(`zsh -ilc "${item.authCheckCommand}" 2>/dev/null`, 8000)
    if (item.authFailPattern && slow.toLowerCase().includes(item.authFailPattern.toLowerCase())) return false
    return Boolean(slow.trim())
  })
}

/**
 * 远程 manifest 拉取失败不抛错（remoteAvailable=false，本地条目照常）。
 */
export async function listMarketplaceItems(
  workspaceSlug: string,
): Promise<{ items: MarketplaceItemWithStatus[]; remoteAvailable: boolean }> {
  // 缓存命中直接返回（30s 内不重复执行 CLI 检测）
  const cached = marketListCache.get(workspaceSlug)
  if (cached && Date.now() - cached.ts < MARKET_LIST_CACHE_TTL_MS) {
    return cached.data
  }
  const result = await buildMarketplaceList(workspaceSlug)
  marketListCache.set(workspaceSlug, { ts: Date.now(), data: result })
  return result
}

/** 构建市场列表（无缓存）：CLI 检测并行执行 */
async function buildMarketplaceList(
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
  const ignoredIds = new Set(getMarketplaceIgnoredIds())
  const disabledIds = new Set(getMarketplaceDisabledIds())
  const installedSlugs = getInstalledSkillSlugs(workspaceSlug)
  return {
    remoteAvailable,
    items: await Promise.all(merged.map(async (item) => {
      const inList = item.type === 'skill'
        ? installedSlugs.has(item.id)
        : installedConnectors.has(item.id)
      // CLI 连接器：系统是否已安装（并行检测）
      const sysInstalled = item.installKind === 'cli' && item.cliCommand
        ? await systemHasCli(item.cliCommand)
        : false
      // CLI 认证状态（系统已装才检查，并行）
      const authed = sysInstalled && item.installKind === 'cli'
        ? await checkCliAuth(item)
        : false
      // npx 连接器：凭据是否已配置
      const hasCreds = item.installKind === 'npx-mcp'
        ? hasNpxCredentials(item.id, item.envMap)
        : false
      // 已安装 = 市场安装列表，或（CLI 且系统已装且未被忽略）；ignored 的条目视为未安装
      const installed = !ignoredIds.has(item.id) && (inList || sysInstalled)
      // 已启用 = 已安装且未被 marketplaceDisabled 停用（开关只改 disabled，不删安装记录）
      const enabled = installed && !disabledIds.has(item.id)
      return {
        ...item,
        installed,
        enabled,
        hasCredentials: hasCreds,
        systemInstalled: sysInstalled,
        marketplaceInstalled: item.type === 'connector' ? installedConnectors.has(item.id) : false,
        authenticated: authed,
        ignored: ignoredIds.has(item.id),
      }
    })),
  }
}

/** 从远程 manifest 查找条目；失败时抛出可区分的错误（网络失败 vs 条目不存在） */
async function fetchRemoteItem(itemId: string): Promise<MarketplaceItem | undefined> {
  try {
    const skills = await fetchCommunityManifest()
    return skills.map(communitySkillToMarketplaceItem).find((i) => i.id === itemId)
  } catch (error) {
    throw new Error(`远程社区清单拉取失败（${itemId}）：${error instanceof Error ? error.message : String(error)}`)
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
  let remote: MarketplaceItem | undefined
  try {
    remote = await fetchRemoteItem(itemId)
  } catch (error) {
    if (!local) throw error  // 本地没有 → 直接抛远程拉取失败
  }
  const item = local ?? remote
  if (!item) throw new Error(`市场条目不存在：${itemId}`)

  if (item.type === 'skill') {
    // 本地内嵌技能（如 ChatCut / HyperFrames）：复制 resources/marketplace-skills/<folder> 到工作区
    if (item.source === 'local' && item.skillFolder) {
      copySkillFolder(getMarketplaceSkillsSourceDir(item.skillFolder), getWorkspaceSkillsDir(workspaceSlug), item.skillFolder)
      return
    }
    const skillItem = item as MarketplaceSkillItem
    if (!skillItem.skillRef) throw new Error('Skill 条目缺少引用')
    await installCommunitySkill(getWorkspaceSkillsDir(workspaceSlug), skillItem.skillRef)
    return
  }

  // CLI 连接器：实际执行 npm install -g <cliPackage>（仅当系统未安装时）
  if (item.installKind === 'cli' && item.cliPackage && item.cliCommand) {
    if (!(await systemHasCli(item.cliCommand))) {
      const { execSync } = await import('node:child_process')
      try {
        execSync(`npm install -g ${item.cliPackage}`, {
          timeout: 120000,
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      } catch {
        throw new Error(`CLI 安装失败，请手动执行：npm install -g ${item.cliPackage}`)
      }
    }
  }

  if (item.source === 'remote') saveMarketplaceRemoteItem(item)
  installLocalConnector(itemId)
  // 重新添加时解除忽略状态（系统已装的 CLI 重新加入会话）
  setMarketplaceIgnored(itemId, false)
  // 安装即默认启用：从停用集合移除
  setMarketplaceDisabled(itemId, false)
  invalidateMarketListCache()
}

/** 卸载市场条目：移除 installed 与远程快照（凭据保留，重装复用）
 *  CLI 条目同时加入 ignored：系统检测不再自动显示，需用户重新「添加到会话」 */
export async function uninstallMarketplaceItem(itemId: string): Promise<void> {
  removeMarketplaceRemoteItem(itemId)
  uninstallLocalConnector(itemId)
  setMarketplaceDisabled(itemId, false)
  const item = listMarketplaceCatalog().find((i) => i.id === itemId)
  if (item?.installKind === 'cli') setMarketplaceIgnored(itemId, true)
  invalidateMarketListCache()
}

/**
 * 开关：启用/停用注入（只改 marketplaceDisabled，不删除安装记录）——对齐 Cline 的
 * Enable/Disable（Toggle a server without deleting it）。
 * - 停用（false）：加入 disabled，卡片保留显示「已关闭」，不再注入 spec/cliHint；
 * - 启用（true）：从 disabled 移除，恢复注入。
 */
export function toggleMarketplaceItem(itemId: string, enabled: boolean): void {
  setMarketplaceDisabled(itemId, !enabled)
  if (enabled) setMarketplaceIgnored(itemId, false)
  invalidateMarketListCache()
}

/** 已安装市场连接器 → NpxConnectorSpec（本地目录 + 远程快照统一注入；停用条目不注入） */
export function getInstalledMarketplaceSpecs(): NpxConnectorSpec[] {
  const installed = new Set(getMarketplaceInstalledIds())
  const disabled = new Set(getMarketplaceDisabledIds())
  const local = listMarketplaceCatalog()
  const remote = Object.values(getMarketplaceRemoteItems())
  return [...local, ...remote]
    .filter((item) => item.installKind === 'npx-mcp' && installed.has(item.id) && !disabled.has(item.id))
    .map(marketplaceItemToNpxSpec)
}

/**
 * 已安装的 CLI 连接器提示（installKind='cli'）：
 * 安装后把 cliHint 注入 Agent 系统提示，Agent 通过 Bash 调用对应 CLI 子命令。
 * CLI 连接器不走 stdio MCP 注入，这里返回 { id, cliPackage, cliHint } 供编排层拼提示。
 */
export function getInstalledMarketplaceCliHints(): Array<{ id: string; name: string; cliPackage?: string; cliHint?: string }> {
  const installed = new Set(getMarketplaceInstalledIds())
  const disabled = new Set(getMarketplaceDisabledIds())
  const local = listMarketplaceCatalog()
  const remote = Object.values(getMarketplaceRemoteItems())
  return [...local, ...remote]
    .filter((item) => item.installKind === 'cli' && installed.has(item.id) && !disabled.has(item.id))
    .map((item) => ({
      id: item.id,
      name: item.name,
      cliPackage: item.cliPackage,
      cliHint: item.cliHint,
    }))
}

/** 内置技能资源根目录（dev：dist/resources 或源码 resources；打包：process.resourcesPath） */
export function getMarketplaceSkillsSourceDir(folder: string): string {
  // electron 在 bun 单测环境不可用，惰性 require（该函数仅运行时安装路径调用）
  let base = join(__dirname, 'resources')
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron') as typeof import('electron')
    if (app?.isPackaged) {
      base = process.resourcesPath
    } else if (!existsSync(join(base, 'marketplace-skills'))) {
      // dev 时 dist/resources 可能未拷贝（build:resources 未跑/被清理）→ fallback 源码 resources
      base = join(__dirname, '..', 'resources')
    }
  } catch {
    // 非 electron 环境（bun test）→ 源码 resources
    if (!existsSync(join(base, 'marketplace-skills'))) {
      base = join(__dirname, '..', 'resources')
    }
  }
  return join(base, 'marketplace-skills', folder)
}

/** 复制技能目录到目标 skills 目录（纯函数，便于单测） */
export function copySkillFolder(srcDir: string, targetSkillsDir: string, folderName: string): void {
  if (!existsSync(srcDir)) throw new Error(`技能资源不存在：${folderName}`)
  mkdirSync(targetSkillsDir, { recursive: true })
  const target = join(targetSkillsDir, folderName)
  if (existsSync(target)) rmSync(target, { recursive: true, force: true })
  cpSync(srcDir, target, { recursive: true })
}

export { MARKETPLACE_ID_PREFIX }
