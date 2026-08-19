/**
 * marketplace-manager 单测：目录数据完整性 + 安装/卸载闭环
 */

import { describe, test, expect } from 'bun:test'
import {
  listMarketplaceCatalog,
  listMarketplaceItemsWithStatus,
  installMarketplaceItem,
  uninstallMarketplaceItem,
  getMarketplaceInstalledIds,
  marketplaceItemToNpxSpec,
  MARKETPLACE_ID_PREFIX,
} from '../marketplace/marketplace-manager'

describe('市场目录（plugin_creator）', () => {
  test('目录数据完整性：所有条目 id 唯一、type 合法、npx-mcp 必须有包名', () => {
    const items = listMarketplaceCatalog()
    expect(items.length).toBeGreaterThan(0)
    const ids = new Set<string>()
    for (const item of items) {
      expect(ids.has(item.id)).toBe(false)
      ids.add(item.id)
      expect(['connector', 'skill']).toContain(item.type)
      expect(['official', 'community', 'myyoda']).toContain(item.vendor)
      if (item.installKind === 'npx-mcp') {
        expect(item.npxPackage).toBeTruthy()
        if (item.envMap) {
          // envMap 的键必须与 credentialFields 对应，保证凭据可注入
          const fieldKeys = new Set((item.credentialFields ?? []).map((f) => f.key))
          for (const key of Object.keys(item.envMap)) {
            expect(fieldKeys.has(key)).toBe(true)
          }
        }
      }
    }
  })

  test('安装 → 状态变化 → 卸载 → 恢复', () => {
    const item = listMarketplaceCatalog()[0]
    try {
      installMarketplaceItem(item.id)
      expect(getMarketplaceInstalledIds()).toContain(item.id)
      const withStatus = listMarketplaceItemsWithStatus()
      expect(withStatus.find((i) => i.id === item.id)?.installed).toBe(true)
    } finally {
      uninstallMarketplaceItem(item.id)
    }
    expect(getMarketplaceInstalledIds()).not.toContain(item.id)
  })

  test('未知条目安装抛错', () => {
    expect(() => installMarketplaceItem('not-exists')).toThrow()
  })

  test('marketplaceItemToNpxSpec：id 加前缀、envMap 透传', () => {
    const item = listMarketplaceCatalog().find((i) => i.installKind === 'npx-mcp' && i.envMap)
    expect(item).toBeTruthy()
    const spec = marketplaceItemToNpxSpec(item!)
    expect(spec.id.startsWith(MARKETPLACE_ID_PREFIX)).toBe(true)
    expect(spec.envMap).toEqual(item!.envMap)
    expect(spec.npmPackage).toBe(item!.npxPackage)
  })
})
