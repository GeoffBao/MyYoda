/**
 * marketplace-service — 预装连接器服务（本地目录 + 安装/卸载/开关 + 注入）
 *
 * 2026-08-20 市场（MyYoda社区）移除后的收敛形态：
 * - 目录：marketplace.json 仅含预装连接器（第三方需 install，不可开箱即用）；
 * - 预装（PRESET_CONNECTOR_IDS）：常驻连接器 Tab 展示（即使未安装），
 *   但「安装」前不注入、不启用——第三方（企业微信/Readwise/Supabase/Vercel/
 *   Playwright/Tavily/Cloudflare/Railway/Wrangler）必须点击安装后才可用；
 * - 安装：CLI → npm install -g（系统未装时）+ 写 marketplaceInstalled；
 *   npx → 写 marketplaceInstalled（默认启用）；
 * - 开关：只改 marketplaceDisabled（停用注入，不删安装记录，卡片保留）；
 * - 卸载：CLI 双选项（仅移除会话 / 同时卸载系统 CLI）；卸载后回到「未安装」，
 *   卡片仍在（预装常驻），可再次安装。
 */

import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

/** 市场列表结果缓存（30s TTL：避免每次打开 Tab 重复执行 CLI 检测命令） */
const MARKET_LIST_CACHE_TTL_MS = 30_000
const marketListCache = new Map<string, { ts: number; data: { items: MarketplaceItemWithStatus[] } }>()

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
import { getChatToolsConfig, saveChatToolsConfig, getToolCredentials } from '../chat-tool-config'
import type { NpxConnectorSpec } from '../builtin-mcp/npx-connector-mcp'

export { MARKETPLACE_ID_PREFIX }

/**
 * 预装连接器（2026-08-20）：第三方连接器常驻连接器 Tab，但**必须安装后才能用**（不开箱即用）。
 * 与自研内置连接器（default-mcp.json，开箱即用）不同：这些条目未安装时显示「安装」按钮，
 * 点击后执行真实安装（CLI npm install -g / npx 注入标记），安装后才注入工具。
 */
export const PRESET_CONNECTOR_IDS = new Set([
  'readwise-cli',   // Readwise
  'wecom-cli',      // 企业微信
  'supabase',
  'playwright',
  'cloudflare',     // Cloudflare npx MCP
  'wrangler',       // Cloudflare Wrangler CLI
  'tavily',
  'railway',
  'vercel',
])

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

/**
 * CLI 检测结果缓存（60s TTL）：开关切换/列表刷新时不重复执行慢命令（command -v / whoami 网络请求）。
 * 与 marketListCache 独立：toggle/install/uninstall 只清列表缓存，检测缓存保持到 TTL。
 */
const CLI_CHECK_CACHE_TTL_MS = 60_000
const cliCheckCache = new Map<string, { ts: number; value: boolean }>()

/** 清除 CLI 检测缓存（认证成功后调用，避免列表重建命中旧值显示「需认证」） */
export function invalidateCliCheckCache(): void {
  cliCheckCache.clear()
}

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
 * 构建连接器列表：本地目录（仅预装条目）附状态；CLI 检测并行执行。
 */
export async function listMarketplaceItems(
  workspaceSlug: string,
): Promise<{ items: MarketplaceItemWithStatus[] }> {
  // 缓存命中直接返回（30s 内不重复执行 CLI 检测）
  const cached = marketListCache.get(workspaceSlug)
  if (cached && Date.now() - cached.ts < MARKET_LIST_CACHE_TTL_MS) {
    return cached.data
  }
  const local = listMarketplaceCatalog()
  const installedConnectors = new Set(getMarketplaceInstalledIds())
  const disabledIds = new Set(getMarketplaceDisabledIds())
  const result = {
    items: await Promise.all(local.map(async (item) => {
      const inList = installedConnectors.has(item.id)
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
      // 已安装 = 市场安装列表，或（CLI 且系统已装）
      const installed = inList || sysInstalled
      // 已启用 = 已安装且未被 marketplaceDisabled 停用（开关只改 disabled，不删安装记录）
      const enabled = installed && !disabledIds.has(item.id)
      return {
        ...item,
        installed,
        enabled,
        hasCredentials: hasCreds,
        systemInstalled: sysInstalled,
        marketplaceInstalled: installedConnectors.has(item.id),
        authenticated: authed,
        // 预装条目：常驻连接器 Tab（未安装也显示「安装」按钮）
        preset: PRESET_CONNECTOR_IDS.has(item.id),
      }
    })),
  }
  marketListCache.set(workspaceSlug, { ts: Date.now(), data: result })
  return result
}

/**
 * 安装预装连接器：
 * - CLI：系统未装时执行 npm install -g <cliPackage>；写 marketplaceInstalled；
 * - npx：写 marketplaceInstalled（默认启用，注入 stdio MCP）。
 */
export async function installMarketplaceItem(itemId: string): Promise<void> {
  const item = listMarketplaceCatalog().find((i) => i.id === itemId)
  if (!item) throw new Error(`连接器不存在：${itemId}`)

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

  installLocalConnector(itemId)
  // 安装即默认启用：从停用集合移除
  setMarketplaceDisabled(itemId, false)
  invalidateMarketListCache()
  invalidateCliCheckCache()
}

/**
 * 卸载连接器：移除 installed（凭据保留，重装复用）
 * - purgeSystem=false（默认）：CLI 系统二进制保留（用户可能在其他地方用），卡片回到「未安装」；
 * - purgeSystem=true：执行 npm uninstall -g 真正删除系统 CLI（失败不阻断，仅记录）。
 * 预装条目卸载后仍在连接器 Tab（显示「安装」按钮），可随时重装。
 */
export async function uninstallMarketplaceItem(itemId: string, purgeSystem?: boolean): Promise<void> {
  uninstallLocalConnector(itemId)
  setMarketplaceDisabled(itemId, false)
  const item = listMarketplaceCatalog().find((i) => i.id === itemId)
  if (item?.installKind === 'cli' && purgeSystem && item.cliPackage) {
    try {
      await runCommand(`npm uninstall -g ${item.cliPackage}`, 60_000)
    } catch {
      console.error(`[连接器] 卸载系统 CLI 失败（${item.cliPackage}）`)
    }
  }
  invalidateMarketListCache()
  invalidateCliCheckCache()
}

/**
 * 开关：启用/停用注入（只改 marketplaceDisabled，不删除安装记录）——对齐 Cline 的
 * Enable/Disable（Toggle a server without deleting it）。
 */
export function toggleMarketplaceItem(itemId: string, enabled: boolean): void {
  setMarketplaceDisabled(itemId, !enabled)
  invalidateMarketListCache()
}

/** 已安装连接器 → NpxConnectorSpec（仅注入已安装且未停用的 npx 条目；预装未安装不注入） */
export function getInstalledMarketplaceSpecs(): NpxConnectorSpec[] {
  const installed = new Set(getMarketplaceInstalledIds())
  const disabled = new Set(getMarketplaceDisabledIds())
  return listMarketplaceCatalog()
    .filter((item) => item.installKind === 'npx-mcp' && installed.has(item.id) && !disabled.has(item.id))
    .map(marketplaceItemToNpxSpec)
}

/**
 * 已安装的 CLI 连接器提示（installKind='cli'）：安装后把 cliHint 注入 Agent 系统提示。
 * 预装未安装（未点 install）不注入——第三方连接器不开箱即用。
 */
export function getInstalledMarketplaceCliHints(): Array<{ id: string; name: string; cliPackage?: string; cliHint?: string }> {
  const installed = new Set(getMarketplaceInstalledIds())
  const disabled = new Set(getMarketplaceDisabledIds())
  return listMarketplaceCatalog()
    .filter((item) => item.installKind === 'cli' && installed.has(item.id) && !disabled.has(item.id))
    .map((item) => ({
      id: item.id,
      name: item.name,
      cliPackage: item.cliPackage,
      cliHint: item.cliHint,
    }))
}
