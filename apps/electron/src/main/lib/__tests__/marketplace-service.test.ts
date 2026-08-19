/**
 * marketplace-service 单测：统一市场层的转换映射、合并去重、远程快照注入闭环。
 */

import { describe, test, expect, afterEach } from 'bun:test'
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { CommunitySkill } from '@myyoda/shared'
import {
  communitySkillToMarketplaceItem,
  mergeMarketplaceItems,
  getMarketplaceRemoteItems,
  saveMarketplaceRemoteItem,
  removeMarketplaceRemoteItem,
  getInstalledMarketplaceSpecs,
  copySkillFolder,
  MARKETPLACE_ID_PREFIX,
} from '../marketplace/marketplace-service'
import { getChatToolsConfig, saveChatToolsConfig } from '../chat-tool-config'
import { getMarketplaceInstalledIds, listMarketplaceCatalog } from '../marketplace/marketplace-manager'

/** 测试用远程连接器条目（与本地 marketplace.json 同 schema） */
const remoteConnector = {
  id: 'remote-test-connector',
  source: 'remote',
  type: 'connector',
  name: 'Remote Test',
  description: '远程市场连接器（测试）',
  vendor: 'community',
  category: '研发与交付',
  installKind: 'npx-mcp',
  npxPackage: '@remote/test-mcp',
  envMap: { token: 'REMOTE_TEST_TOKEN' },
}

function sampleSkill(): CommunitySkill {
  return {
    name: 'web-research',
    description: 'd',
    path: 'skills/web-research',
  }
}

describe('marketplace-service 统一层', () => {
  afterEach(() => {
    // 清理测试残留：移除远程快照条目与 installed 记录，避免污染同进程其他测试
    const cfg = getChatToolsConfig()
    const remoteItems = { ...(cfg.marketplaceRemoteItems ?? {}) }
    delete remoteItems[remoteConnector.id]
    const installed = (cfg.marketplaceInstalled ?? []).filter((id) => id !== remoteConnector.id)
    cfg.marketplaceRemoteItems = remoteItems
    cfg.marketplaceInstalled = installed
    saveChatToolsConfig(cfg)
  })

  test('communitySkillToMarketplaceItem：skill 转换映射', () => {
    const item = communitySkillToMarketplaceItem({
      name: 'web-research', displayName: 'Web Research',
      description: 'd', category: 'research', verified: true,
      authorName: 'a', homepage: 'https://h', version: '1.2.0', downloads: 10,
      path: 'skills/web-research',
    })
    expect(item.id).toBe('web-research')
    expect(item.type).toBe('skill')
    expect(item.installKind).toBe('skill')
    expect(item.source).toBe('remote')
    expect(item.vendor).toBe('official')   // verified → official
    expect(item.category).toBe('research')
    expect(item.author).toBe('a')
    expect(item.homepage).toBe('https://h')
    expect(item.version).toBe('1.2.0')
    expect(item.downloads).toBe(10)
    // skillRef 保留原 CommunitySkill 供安装
    expect(item.skillRef).toBeDefined()
    expect(item.skillRef?.name).toBe('web-research')
    expect(item.skillRef?.path).toBe('skills/web-research')
  })

  test('communitySkillToMarketplaceItem：未 verified → community，缺省字段兜底', () => {
    const item = communitySkillToMarketplaceItem(sampleSkill())
    expect(item.vendor).toBe('community')
    expect(item.name).toBe('web-research')      // 无 displayName 时回退 name
    expect(item.description).toBe('d')
  })

  test('合并去重：同 id 本地优先', () => {
    const local = { id: 'x', source: 'local', name: 'local-x' } as any
    const remote = { id: 'x', source: 'remote', name: 'remote-x' } as any
    const merged = mergeMarketplaceItems([local], [remote])
    expect(merged).toHaveLength(1)
    expect(merged[0]!.name).toBe('local-x')
  })

  test('合并去重：不同 id 全部保留', () => {
    const local = [{ id: 'a', source: 'local', name: 'a' }] as any
    const remote = [{ id: 'b', source: 'remote', name: 'b' }] as any
    expect(mergeMarketplaceItems(local, remote)).toHaveLength(2)
  })

  test('远程连接器快照 → 注入 spec 转换闭环', () => {
    // 构造：远程条目已快照 + 已安装
    saveMarketplaceRemoteItem(remoteConnector as any)
    const cfg = getChatToolsConfig()
    cfg.marketplaceInstalled = [...(cfg.marketplaceInstalled ?? []), remoteConnector.id]
    saveChatToolsConfig(cfg)

    expect(Object.keys(getMarketplaceRemoteItems())).toContain(remoteConnector.id)
    expect(getMarketplaceInstalledIds()).toContain(remoteConnector.id)

    const specs = getInstalledMarketplaceSpecs()
    const spec = specs.find((s) => s.id === `${MARKETPLACE_ID_PREFIX}${remoteConnector.id}`)
    expect(spec).toBeDefined()
    expect(spec!.npmPackage).toBe('@remote/test-mcp')
    expect(spec!.envMap).toEqual({ token: 'REMOTE_TEST_TOKEN' })
  })

  test('远程快照条目：卸载后不再进入注入 spec', () => {
    saveMarketplaceRemoteItem(remoteConnector as any)
    const cfg = getChatToolsConfig()
    cfg.marketplaceInstalled = [...(cfg.marketplaceInstalled ?? []), remoteConnector.id]
    saveChatToolsConfig(cfg)

    removeMarketplaceRemoteItem(remoteConnector.id)
    expect(getMarketplaceRemoteItems()[remoteConnector.id]).toBeUndefined()
    // installed 仍在（卸载未执行前）但快照已删 → spec 不应包含
    const specs = getInstalledMarketplaceSpecs()
    expect(specs.find((s) => s.id === `${MARKETPLACE_ID_PREFIX}${remoteConnector.id}`)).toBeUndefined()
  })

  test('copySkillFolder：复制本地技能目录到目标 skills 目录（重复安装覆盖）', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'marketplace-skill-'))
    try {
      const src = join(tmp, 'src')
      const target = join(tmp, 'target')
      mkdirSync(src, { recursive: true })
      writeFileSync(join(src, 'SKILL.md'), '---\nname: demo\n---\nhello')
      copySkillFolder(src, target, 'demo')
      expect(existsSync(join(target, 'demo', 'SKILL.md'))).toBe(true)
      // 重复安装：覆盖旧目录而不是抛错
      writeFileSync(join(src, 'SKILL.md'), '---\nname: demo\n---\nupdated')
      copySkillFolder(src, target, 'demo')
      expect(existsSync(join(target, 'demo', 'SKILL.md'))).toBe(true)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('copySkillFolder：源目录缺失时抛错', () => {
    expect(() => copySkillFolder('/nonexistent/src', '/tmp/target-x', 'x')).toThrow('技能资源不存在')
  })

  test('本地技能条目在目录中：ChatCut 与 HyperFrames', () => {
    const catalog = listMarketplaceCatalog()
    const chatcut = catalog.find((i) => i.id === 'chatcut')
    const heygen = catalog.find((i) => i.id === 'heygen')
    expect(chatcut).toBeDefined()
    expect(chatcut!.type).toBe('skill')
    expect(chatcut!.source).toBe('local')
    expect(chatcut!.skillFolder).toBe('chatcut')
    expect(heygen).toBeDefined()
    expect(heygen!.type).toBe('skill')
    expect(heygen!.skillFolder).toBe('heygen')
  })
})
