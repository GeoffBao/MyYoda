# 市场统一（Marketplace Unified）实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把「市场」Tab 建成统一发现中心：本地官方连接器 + 远程社区 Skill/连接器同构浏览与安装，技能 Tab 的社区市场入口迁入市场 Tab。

**Architecture:** 新建统一 `marketplace-service` 收敛本地 `marketplace-manager` 与远程 `community-skill-service` 的读侧：本地 `marketplace.json`（官方稳定层，离线可用）+ 远程 `myyoda-skills` 仓库 `sources.yaml`（skill 条目原样转换，connector 条目同 schema），本地优先去重；安装时 skill 走工作区级 `communityInstallSkill`，connector 走 `marketplaceInstalled`（远程先快照到 `marketplaceRemoteItems`）；注入复用现有 `injectNpxConnectorMcpServer`。

**Tech Stack:** Electron 主进程（bun test）、React renderer（Jotai/Radix Dialog）、`@myyoda/shared` 类型、`js-yaml`（远程 manifest）、`decompress-targz`（skill 安装）。

**前置阅读：**
- `docs/superpowers/specs/2026-08-19-marketplace-unified-design.md`（本计划依据）
- `apps/electron/src/main/lib/marketplace/marketplace-manager.ts`（现有本地市场）
- `apps/electron/src/main/lib/community-skill-service.ts`（现有远程 Skill 市场）
- `apps/electron/src/renderer/components/agent-skills/MarketplaceTab.tsx`（现有市场 UI）
- `apps/electron/src/renderer/components/agent-skills/CommunityMarketDialog.tsx`（将被移除）
- `apps/electron/src/renderer/components/agent-skills/AgentSkillsView.tsx`（Tab 宿主，社区市场按钮所在）

---

### Task 1: shared 数据模型扩展

**Files:**
- Modify: `packages/shared/src/types/agent.ts`（MarketplaceItem 附近）
- Modify: `packages/shared/src/types/chat-tool.ts`（ChatToolsFileConfig）

**Step 1: 写类型变更**

`MarketplaceItem` 增加：
```ts
/** 条目来源：local=内置官方目录，remote=远程社区 manifest */
source: 'local' | 'remote'
```
（`MarketplaceItemWithStatus` 已有 `installed: boolean`，再加 `remoteAvailable` 由列表接口整体返回，见 Task 3）

`ChatToolsFileConfig` 增加：
```ts
/** 远程市场连接器安装快照（卸载/注入用，避免依赖网络） */
marketplaceRemoteItems?: Record<string, MarketplaceItem>
```

**Step 2: typecheck 验证（预期失败或通过取决于引用）**

Run: `bun run --filter='@myyoda/shared' typecheck`

**Step 3: 修正受影响处**

`marketplace-manager.ts`、`marketplace.json` 条目会因 `source` 必填报错 → 给 `marketplace.json` 加 `"source": "local"`（脚本逐条补），manager 的 `listMarketplaceCatalog` 归一化补默认值 `source ?? 'local'`。`MarketplaceItem` 若用字面量创建处同步补字段。

**Step 4: typecheck**

Run: `bun run --filter='*' typecheck` — 预期全绿。

**Step 5: Commit**

```bash
git add packages/shared apps/electron/src/main/lib/marketplace
git commit -m "feat(marketplace): 数据模型支持 local/remote 来源与远程快照"
```

---

### Task 2: 统一 marketplace-service

**Files:**
- Create: `apps/electron/src/main/lib/marketplace/marketplace-service.ts`
- Modify: `apps/electron/src/main/lib/community-skill-service.ts`（导出 `parseSourcesYaml` 已存在；新增 connector 条目识别不需要改，解析后按 `type` 过滤即可）
- Modify: `apps/electron/src/main/lib/chat-tool-config.ts`（get/save 透传 `marketplaceRemoteItems`，参考 `marketplaceInstalled` 的 DEFAULT/read 分支）

**Step 1: 写失败测试**

Create `apps/electron/src/main/lib/__tests__/marketplace-service.test.ts`：
```ts
import { describe, test, expect } from 'bun:test'
import { communitySkillToMarketplaceItem } from '../marketplace/marketplace-service'

describe('marketplace-service 统一层', () => {
  test('communitySkillToMarketplaceItem：skill 转换映射', () => {
    const item = communitySkillToMarketplaceItem({
      name: 'web-research', displayName: 'Web Research',
      description: 'd', category: 'research', verified: true,
      authorName: 'a', homepage: 'https://h', version: '1.2.0', downloads: 10,
      path: 'skills/web-research',
    })
    expect(item.type).toBe('skill')
    expect(item.installKind).toBe('skill')
    expect(item.source).toBe('remote')
    expect(item.vendor).toBe('official')   // verified → official
    expect(item.category).toBe('research')
  })

  test('合并去重：同 id 本地优先', () => {
    const local = { id: 'x', source: 'local', name: 'local-x' } as any
    const remote = { id: 'x', source: 'remote', name: 'remote-x' } as any
    const merged = mergeMarketplaceItems([local], [remote])
    expect(merged).toHaveLength(1)
    expect(merged[0].name).toBe('local-x')
  })
})
```

**Step 2: 运行测试确认失败**

Run: `bun test apps/electron/src/main/lib/__tests__/marketplace-service.test.ts`
Expected: FAIL（module not found）

**Step 3: 实现 marketplace-service.ts**

```ts
import type { MarketplaceItem, MarketplaceItemWithStatus, CommunitySkill } from '@myyoda/shared'
import { listMarketplaceCatalog, installMarketplaceItem as installLocalConnector, uninstallMarketplaceItem as uninstallLocalConnector, getMarketplaceInstalledIds, MARKETPLACE_ID_PREFIX } from './marketplace-manager'
import { fetchCommunityManifest, installCommunitySkill } from '../community-skill-service'
import { getChatToolsConfig, saveChatToolsConfig } from '../chat-tool-config'
import type { NpxConnectorSpec } from '../builtin-mcp/npx-connector-mcp'

export function communitySkillToMarketplaceItem(skill: CommunitySkill): MarketplaceItem {
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
    skillRef: skill,           // 安装时原样传给 communityInstallSkill
  } as MarketplaceItem & { skillRef: CommunitySkill; downloads?: number; version?: string }
}

export function mergeMarketplaceItems(local: MarketplaceItem[], remote: MarketplaceItem[]): MarketplaceItem[] {
  const byId = new Map<string, MarketplaceItem>()
  for (const item of [...remote, ...local]) byId.set(item.id, item)  // local 后写覆盖
  return [...byId.values()]
}

/** 已安装远程连接器快照（id → 条目） */
export function getMarketplaceRemoteItems(): Record<string, MarketplaceItem> {
  return getChatToolsConfig().marketplaceRemoteItems ?? {}
}
export function saveMarketplaceRemoteItem(item: MarketplaceItem): void {
  const cfg = getChatToolsConfig()
  cfg.marketplaceRemoteItems = { ...(cfg.marketplaceRemoteItems ?? {}), [item.id]: item }
  saveChatToolsConfig(cfg)
}
export function removeMarketplaceRemoteItem(itemId: string): void {
  const cfg = getChatToolsConfig()
  if (!cfg.marketplaceRemoteItems) return
  delete cfg.marketplaceRemoteItems[itemId]
  saveChatToolsConfig(cfg)
}

export async function listMarketplaceItems(workspaceSlug: string): Promise<{ items: MarketplaceItemWithStatus[]; remoteAvailable: boolean }> {
  const local = listMarketplaceCatalog()
  let remote: MarketplaceItem[] = []
  let remoteAvailable = true
  try {
    const skills = await fetchCommunityManifest()
    remote = skills.map(communitySkillToMarketplaceItem)
  } catch { remoteAvailable = false }
  const merged = mergeMarketplaceItems(local, remote)
  const installedConnectors = new Set(getMarketplaceInstalledIds())
  const installedSlugs = await getInstalledSkillSlugs(workspaceSlug)  // 扫描工作区 skills 目录 slug
  return {
    remoteAvailable,
    items: merged.map((item) => ({
      ...item,
      installed: item.type === 'skill'
        ? installedSlugs.has(item.id)
        : installedConnectors.has(item.id),
    })),
  }
}

export async function installMarketplaceItem(itemId: string, workspaceSlug: string): Promise<void> {
  const local = listMarketplaceCatalog().find((i) => i.id === itemId)
  const remote = await fetchRemoteItem(itemId)  // manifest 中查找；失败返回 undefined
  const item = local ?? remote
  if (!item) throw new Error(`市场条目不存在：${itemId}`)
  if (item.type === 'skill') {
    if (!item.skillRef) throw new Error('Skill 条目缺少引用')
    await installCommunitySkill(workspaceSlug, item.skillRef)
    return
  }
  if (item.source === 'remote') saveMarketplaceRemoteItem(item)
  installLocalConnector(itemId)
}

export async function uninstallMarketplaceItem(itemId: string): Promise<void> {
  removeMarketplaceRemoteItem(itemId)
  uninstallLocalConnector(itemId)
}

/** agent-orchestrator 注入：本地 + 远程快照 → npx spec */
export function getInstalledMarketplaceSpecs(): NpxConnectorSpec[] {
  const local = listMarketplaceCatalog()
  const remote = Object.values(getMarketplaceRemoteItems())
  return [...local, ...remote]
    .filter((item) => item.installKind === 'npx-mcp' && getMarketplaceInstalledIds().includes(item.id))
    .map((item) => ({
      id: `${MARKETPLACE_ID_PREFIX}${item.id}`,
      npmPackage: item.npxPackage ?? item.id,
      extraArgs: item.npxArgs,
      envMap: item.envMap,
    }))
}
```

注意：
- `CommunitySkill` 转换需要 `id = skill.name`（skill slug 是 name 字段，社区市场用 name 判断已安装）
- `getInstalledSkillSlugs(workspaceSlug)`：参考 `agent-workspace-manager.ts` 的 `getWorkspaceSkillsDir` 扫描 `SKILL.md` 目录；已有能力则复用（如 `listWorkspaceSkills` 或 `getWorkspaceSkills`——实施时 grep 确认，找不到就扫描目录）
- 原 `marketplace-manager.ts` 的 `getInstalledMarketplaceSpecs` 删除/改为只读本地；orchestrator 改为调用 `marketplace-service` 的版本

**Step 4: 跑测试**

Run: `bun test apps/electron/src/main/lib/__tests__/marketplace-service.test.ts` — 预期 PASS。
同时跑现有：`bun test apps/electron/src/main/lib/__tests__/marketplace-manager.test.ts` — 不回归。

**Step 5: agent-orchestrator 切换**

Modify `apps/electron/src/main/lib/agent-orchestrator.ts`：
- import 从 `./marketplace/marketplace-manager` 改为 `./marketplace/marketplace-service` 的 `getInstalledMarketplaceSpecs`

**Step 6: typecheck + 全量主进程测试 + Commit**

```bash
bun run --filter='@myyoda/electron' typecheck
bun test apps/electron/src/main/lib
git add apps/electron packages/shared
git commit -m "feat(marketplace): 统一 marketplace-service（本地+远程合并/安装/快照注入）"
```

---

### Task 3: IPC / Preload 扩展

**Files:**
- Modify: `packages/shared/src/types/chat-tool.ts`（CHAT_TOOL_IPC_CHANNELS 不变；新增返回类型）
- Modify: `apps/electron/src/main/ipc.ts`（marketplace:list/install/uninstall handler 带 workspaceSlug）
- Modify: `apps/electron/src/preload/index.ts`（签名 + 类型）

**Step 1: 改 IPC handler**

`MARKETPLACE_LIST`：
```ts
ipcMain.handle(CHAT_TOOL_IPC_CHANNELS.MARKETPLACE_LIST, async (_, workspaceSlug: string): Promise<{ items: MarketplaceItemWithStatus[]; remoteAvailable: boolean }> => {
  const { listMarketplaceItems } = await import('./lib/marketplace/marketplace-service')
  return listMarketplaceItems(workspaceSlug)
})
```
`MARKETPLACE_INSTALL`：`(_, itemId: string, workspaceSlug: string)` → `installMarketplaceItem(itemId, workspaceSlug)`。
`MARKETPLACE_UNINSTALL` 不变（无 workspace 依赖）。

**Step 2: preload 类型与实现**

```ts
marketplaceList: (workspaceSlug: string) => Promise<{ items: MarketplaceItemWithStatus[]; remoteAvailable: boolean }>
marketplaceInstall: (itemId: string, workspaceSlug: string) => Promise<void>
marketplaceUninstall: (itemId: string) => Promise<void>
```

**Step 3: typecheck + Commit**

```bash
bun run --filter='@myyoda/electron' typecheck
git add packages/shared apps/electron/src/main/ipc.ts apps/electron/src/preload/index.ts
git commit -m "feat(marketplace): IPC/preload 支持工作区参数与远程可用性"
```

---

### Task 4: MarketplaceTab UI 重写 + 社区市场入口迁移

**Files:**
- Modify: `apps/electron/src/renderer/components/agent-skills/MarketplaceTab.tsx`（重写）
- Modify: `apps/electron/src/renderer/components/agent-skills/AgentSkillsView.tsx`（传 workspaceSlug/已装 skill；删「社区市场」按钮与 CommunityMarketDialog 引用）
- Delete: `apps/electron/src/renderer/components/agent-skills/CommunityMarketDialog.tsx`

**Step 1: MarketplaceTab 重写**

Props：
```ts
interface MarketplaceTabProps {
  workspaceSlug: string | null
  /** 当前工作区已装 skill slug 集合（AgentSkillsView data.skills 提供） */
  installedSkillSlugs: Set<string>
}
```
行为：
- `useEffect` → `window.electronAPI.marketplaceList(workspaceSlug ?? '')`；无 workspace 时显示提示（与现有空态一致）
- 类型筛选 `all | connector | skill`；分类 chip：connector 用内置分类（协作办公/研发与交付/设计协作/搜索与自动化/数据与基础设施/知识），skill 用条目 category 聚合（unique）
- 卡片：现有结构 + `source` 徽标（本地→"官方"，远程→verified?"官方":"社区"——沿用 vendor 徽标即可，source 不单独显示）+ skill 条目显示版本/下载量（复用 formatDownloads 逻辑，可内联简单版）
- 按钮：skill 未安装 →「安装」；已安装 →「已安装」禁用（卸载去技能 Tab）；connector 已安装 →「卸载」+「已注入会话」（凭据已配时）
- 空态：`remoteAvailable === false && filter === 'skill'` → 「远程市场不可用」+ 重试按钮（重新触发 useEffect）
- `installedSkillSlugs` 变化时（onImported 回调后刷新）不依赖 prop：安装 skill 成功后调 `onChanged()` 由父级刷新 data.skills

**Step 2: AgentSkillsView 接线**

- `useWorkspaceActions` 已有 → `workspaceSlug`
- `<MarketplaceTab workspaceSlug={workspaceSlug} installedSkillSlugs={new Set(data.skills.map(s => s.slug))} />`
- 删除技能 Tab 工具条「社区市场」按钮块（`setShowCommunityMarket(true)` 相关）
- 删除 `showCommunityMarket` state、`<CommunityMarketDialog>` 渲染与 import

**Step 3: 删除 CommunityMarketDialog**

`rm apps/electron/src/renderer/components/agent-skills/CommunityMarketDialog.tsx`，grep 确认无引用。

**Step 4: typecheck + Commit**

```bash
grep -rn "CommunityMarketDialog" apps/electron/src --include="*.tsx" --include="*.ts" | grep -v node_modules
bun run --filter='@myyoda/electron' typecheck
git add -A apps/electron/src/renderer
git commit -m "feat(marketplace): 市场 Tab 统一发现中心（连接器+Skill 混合），移除技能页社区市场入口"
```

---

### Task 5: 全量验证与收尾

**Step 1: 全量测试**

Run: `bun test` — 预期 `0 fail`（数量 ≈ 1690+，新增 marketplace-service 测试）
Run: `bun run typecheck`（7 包全绿）

**Step 2: 渲染构建**

Run: `bun run build --filter='@myyoda/electron'`（或仓库既有 renderer build 命令；确认构建通过）

**Step 3: 手动冒烟（可选）**

dev 实例打开「能力 → 市场」：
- 本地 14 连接器展示，安装/卸载正常
- Skill 分类展示远程 manifest（网络可用时），安装一个 skill 后技能 Tab 出现该 skill
- 断网/拉取失败时本地条目仍显示，skill 分类显示重试

**Step 4: 收尾提交**

```bash
git add -A && git commit -m "chore(marketplace): 市场统一落地验证" || true
```
（无改动则跳过）

---

## 风险与注意

- `fetchCommunityManifest` 已有超时/降级处理？实施时确认；无则 list 失败 catch 即可
- skill 已安装判断的 slug：`communityFetchManifest` 的 `name` 即 slug（与 `installCommunitySkill` 返回 slug 一致）
- 远程连接器条目当前仓库还没有（schema 已备），代码路径用单测覆盖，UI 天然可用
- `marketplace-manager.ts` 的旧 `getInstalledMarketplaceSpecs` 删除后，确保 orchestrator 已切到 service 版本再删（避免中间态破坏注入）
