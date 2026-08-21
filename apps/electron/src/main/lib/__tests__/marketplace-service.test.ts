/**
 * marketplace-service 单测：预装连接器的安装/开关/卸载状态机 + 注入门控。
 */

import { describe, test, expect, afterEach } from 'bun:test'
import {
  getInstalledMarketplaceSpecs,
  getInstalledMarketplaceCliHints,
  toggleMarketplaceItem,
  installMarketplaceItem,
  uninstallMarketplaceItem,
  PRESET_CONNECTOR_IDS,
  MARKETPLACE_ID_PREFIX,
} from '../marketplace/marketplace-service'
import { getChatToolsConfig, saveChatToolsConfig } from '../chat-tool-config'
import { getMarketplaceInstalledIds, listMarketplaceCatalog } from '../marketplace/marketplace-manager'

/** 测试用条目 id（预装 npx 连接器，避免真实 CLI 安装） */
const TEST_NPX_ID = 'playwright'
const TEST_CLI_ID = 'readwise-cli'

describe('marketplace-service 预装连接器', () => {
  afterEach(() => {
    // 清理测试残留：installed 与 disabled
    const cfg = getChatToolsConfig()
    cfg.marketplaceInstalled = (cfg.marketplaceInstalled ?? []).filter((id) => id !== TEST_NPX_ID && id !== TEST_CLI_ID)
    cfg.marketplaceDisabled = (cfg.marketplaceDisabled ?? []).filter((id) => id !== TEST_NPX_ID && id !== TEST_CLI_ID)
    saveChatToolsConfig(cfg)
  })

  test('目录仅含预装连接器：9 个第三方条目，无淘汰条目', () => {
    const catalog = listMarketplaceCatalog()
    const ids = catalog.map((i) => i.id)
    expect(ids.sort()).toEqual(['cloudflare', 'playwright', 'readwise-cli', 'railway', 'supabase', 'tavily', 'vercel', 'wecom-cli', 'wrangler'].sort())
    // 淘汰条目已删除
    expect(ids).not.toContain('slack')
    expect(ids).not.toContain('linear')
    expect(ids).not.toContain('firecrawl')
    expect(ids).not.toContain('netlify')
    // 无技能条目（ChatCut/HyperFrames 已转 default-skills）
    expect(catalog.every((i) => i.type === 'connector')).toBe(true)
  })

  test('预装标记：9 个条目全部在 PRESET_CONNECTOR_IDS', () => {
    for (const id of ['readwise-cli', 'wecom-cli', 'supabase', 'playwright', 'cloudflare', 'wrangler', 'tavily', 'railway', 'vercel']) {
      expect(PRESET_CONNECTOR_IDS.has(id)).toBe(true)
    }
  })

  test('未安装的预装连接器不注入（第三方不开箱即用）', () => {
    // 未安装 → specs/cliHints 均为空
    expect(getInstalledMarketplaceSpecs().length).toBe(0)
    expect(getInstalledMarketplaceCliHints().length).toBe(0)
  })

  test('安装 npx 连接器后注入 spec；开关关闭后停止注入（记录保留）', async () => {
    await installMarketplaceItem(TEST_NPX_ID)
    expect(getMarketplaceInstalledIds()).toContain(TEST_NPX_ID)
    const specs = getInstalledMarketplaceSpecs()
    expect(specs.find((s) => s.id === `${MARKETPLACE_ID_PREFIX}${TEST_NPX_ID}`)).toBeDefined()

    // 开关关闭 → 不注入，但安装记录仍在
    toggleMarketplaceItem(TEST_NPX_ID, false)
    expect(getMarketplaceInstalledIds()).toContain(TEST_NPX_ID)
    expect(getInstalledMarketplaceSpecs().find((s) => s.id === `${MARKETPLACE_ID_PREFIX}${TEST_NPX_ID}`)).toBeUndefined()

    // 再开 → 恢复注入
    toggleMarketplaceItem(TEST_NPX_ID, true)
    expect(getInstalledMarketplaceSpecs().find((s) => s.id === `${MARKETPLACE_ID_PREFIX}${TEST_NPX_ID}`)).toBeDefined()
  })

  test('安装 CLI 连接器后注入 cliHint；卸载后停止注入', async () => {
    // 安装（CLI 可能系统已装 → npm install 跳过）
    await installMarketplaceItem(TEST_CLI_ID)
    expect(getMarketplaceInstalledIds()).toContain(TEST_CLI_ID)
    expect(getInstalledMarketplaceCliHints().map((h) => h.id)).toContain(TEST_CLI_ID)

    // 卸载（不 purge 系统）→ 安装记录移除 → 不再注入
    await uninstallMarketplaceItem(TEST_CLI_ID, false)
    expect(getMarketplaceInstalledIds()).not.toContain(TEST_CLI_ID)
    expect(getInstalledMarketplaceCliHints().map((h) => h.id)).not.toContain(TEST_CLI_ID)
  })

  test('卸载后重装：安装记录恢复且默认启用', async () => {
    await installMarketplaceItem(TEST_NPX_ID)
    toggleMarketplaceItem(TEST_NPX_ID, false) // 停用
    expect(getChatToolsConfig().marketplaceDisabled).toContain(TEST_NPX_ID)

    await uninstallMarketplaceItem(TEST_NPX_ID)
    expect(getMarketplaceInstalledIds()).not.toContain(TEST_NPX_ID)

    // 重装 → 安装记录恢复、disabled 清除（默认启用）
    await installMarketplaceItem(TEST_NPX_ID)
    expect(getMarketplaceInstalledIds()).toContain(TEST_NPX_ID)
    expect(getChatToolsConfig().marketplaceDisabled ?? []).not.toContain(TEST_NPX_ID)
  })

  test('安装不存在的条目抛错', async () => {
    expect(installMarketplaceItem('nonexistent')).rejects.toThrow('连接器不存在')
  })
})
