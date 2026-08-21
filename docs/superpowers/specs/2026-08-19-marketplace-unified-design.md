# 市场统一设计（Marketplace Unified）

> 日期：2026-08-19
> 状态：已获用户批准（Brainstorm 流程）
> 范围：市场 Tab 成为统一发现中心（连接器 + Skill），本地官方 + 远程社区同构

## 背景与目标

「能力」页现有三个信息源彼此割裂：
1. **市场 Tab**（2026-08-19 新增）：14 个官方连接器条目，本地内置 `marketplace.json`，Skill 分类为空；
2. **社区 Skill 市场**：技能 Tab「社区市场」按钮 → Dialog，远程拉取 `GeoffBao/myyoda-skills` 仓库 `sources.yaml`，安装 Skill 到工作区；
3. **连接器 Tab**：已安装连接器管理（18 内置 + 用户 MCP + 自定义）。

用户反馈"市场是空的"：市场 Tab 只有 14 个官方连接器、Skill 分类空，不像一个市场。

**目标**：市场 Tab = 统一发现中心（连接器 + Skill 统一浏览/安装）；已安装的归各自 Tab 管理（连接器 Tab / 技能 Tab）；删除技能 Tab 的「社区市场」入口；连接器市场与 Skill 市场同构（官方内置 + 社区远程）。

## 决策记录

| 决策 | 选择 |
|---|---|
| 市场定位 | 发现中心；已装归各自 Tab |
| 连接器数据源 | 官方内置 + 社区远程（与 Skill 市场同构） |
| 布局 | 混合网格 + 类型筛选（全部/连接器/Skill）+ 分类 chip，搜索复用顶栏 |
| 实现方案 | A：统一市场抽象（marketplace-service 收敛本地 + 远程） |

## 架构

```
┌─────────────────────────────────────────────────────┐
│  MarketplaceTab（渲染进程）                          │
│  混合网格 + 类型筛选(全部/连接器/Skill) + 分类 chip   │
└──────────────────────┬──────────────────────────────┘
                       │ marketplace:list / install / uninstall
┌──────────────────────▼──────────────────────────────┐
│  marketplace-service（主进程，统一）                  │
│  ├─ 本地官方层：marketplace.json（离线可用，14 条连接器）│
│  └─ 远程社区层：myyoda-skills 仓库 sources.yaml       │
│     （skill 条目原样转换 + connector 条目同 schema）   │
│  合并：本地优先去重，统一返回 MarketplaceItem[]        │
└──────────────────────┬──────────────────────────────┘
                       │ 注入
┌──────────────────────▼──────────────────────────────┐
│  agent-orchestrator：已安装连接器 → npx 注入          │
│  （含远程连接器快照，与现有本地条目同一注入器）        │
└─────────────────────────────────────────────────────┘
```

## 组件

### 1. 数据模型（packages/shared）

- `MarketplaceItem` 新增字段：
  - `source: 'local' | 'remote'`
- `ChatToolsFileConfig` 新增字段：
  - `marketplaceRemoteItems?: Record<string, MarketplaceItem>`（远程连接器安装快照）
- 新增转换函数（主进程）：`communitySkillToMarketplaceItem(skill): MarketplaceItem`
  - `type: 'skill'`、`installKind: 'skill'`、`vendor` 映射（verified → official，否则 community）、`category`/`author`/`homepage`/`version`/`downloads` 透传
- 远程 manifest 解析扩展：`sources.yaml` 条目支持可选 `type: skill|connector`（默认 skill，向后兼容）；connector 条目与本地 `marketplace.json` 条目同 schema

### 2. 统一市场服务（主进程 `marketplace-service`，收敛现有 marketplace-manager + community-skill-service 的读侧）

- `listMarketplaceItemsWithStatus(workspaceSlug): MarketplaceItemWithStatus[]`
  - 拉取远程 manifest（失败不抛错，仅返回空 + 标记 `remoteAvailable: false`）
  - 合并：本地优先（同 id 本地条目覆盖远程条目）
  - 安装状态：skill 按工作区已装 skill slug 集合；connector 按 `marketplaceInstalled`
- `installMarketplaceItem(itemId, workspaceSlug)`
  - connector（本地）：写入 `marketplaceInstalled`（现有逻辑）
  - connector（远程）：先快照条目 → `marketplaceRemoteItems[id]`，再写入 `marketplaceInstalled`（两步失败回滚）
  - skill（远程）：复用 `communityInstallSkill(workspaceSlug, skill)`
- `uninstallMarketplaceItem(itemId)`
  - connector：移除 `marketplaceInstalled` 与快照，凭据保留（重装复用）
  - skill：复用现有 skill 删除流程（技能 Tab 内删除）
- `getInstalledMarketplaceSpecs()`：本地条目 + 远程快照统一转 `NpxConnectorSpec`（agent-orchestrator 注入用，未配凭据不启动）

### 3. IPC / Preload

- `marketplace:list` → 带 `workspaceSlug`，返回 `MarketplaceItemWithStatus[]` + `remoteAvailable`
- `marketplace:install(itemId, workspaceSlug)` / `marketplace:uninstall(itemId)` 签名扩展

### 4. UI（MarketplaceTab 重写）

- 顶部说明行（市场定位：官方稳定 + 社区贡献，按需安装）
- 类型筛选 chip：全部 | 连接器 | Skill
- 分类 chip：仅当类型 ≠ 全部时显示对应分类（connector 用内置分类；skill 用远程 manifest 分类聚合）
- 搜索：复用顶栏搜索框（外部传入）
- 卡片网格（沿用现有 MarketplaceTab 卡片结构）：
  - icon + 名称 + 来源徽标（官方/社区/MyYoda）+ 分类 + 需凭据标记 + 主页链接
  - 状态：未安装 →「安装」；已安装 →「卸载」+ 绿色「已安装」徽标；连接器已安装且配好凭据 →「已注入会话」
- 空态/降级：远程拉取失败 → skill 分类显示「远程市场不可用」+ 重试按钮；本地条目照常渲染
- `workspaceSlug` 由 `AgentSkillsView` 传入（`useWorkspaceActions` 已有）

### 5. 入口清理

- 技能 Tab 顶部「社区市场」按钮删除（grep 确认无其他引用后删除 `CommunityMarketDialog` 组件及 import）
- 市场 Tab 成为唯一发现入口；技能 Tab 保留导入/创建

## 数据流

1. 打开市场 Tab → `marketplace:list(workspaceSlug)` → 本地 marketplace.json + 远程 manifest 合并 → 渲染混合网格
2. 点「安装」（connector）→ `marketplace:install(id, workspaceSlug)` → 写 installed（远程先快照）→ 刷新列表
3. 点「安装」（skill）→ `marketplace:install(id, workspaceSlug)` → `communityInstallSkill` → 刷新列表 + 技能 Tab 计数
4. Agent 会话构建 → `getInstalledMarketplaceSpecs()`（本地 + 快照）→ `injectNpxConnectorMcpServer` → npx stdio 注入

## 错误处理

| 场景 | 行为 |
|---|---|
| 远程 manifest 拉取失败 | 本地条目照常；skill 分类「远程市场不可用」+ 重试；console 记录，不 toast |
| 安装失败（connector） | 抛错 → UI toast（主进程异常消息） |
| 远程连接器安装中途失败 | 两步写入回滚（快照 + installed 不残留半状态） |
| 卸载连接器 | 仅移除注入与快照，凭据保留 |
| skill 安装失败 | 沿用 `communityInstallSkill` 错误文案 |

## 测试

1. `marketplace-service` 单测：
   - 本地 + 远程合并去重（同 id 本地优先）
   - `communitySkillToMarketplaceItem` 转换映射
   - 远程连接器安装 → 快照 → 注入 spec 转换闭环（mock 远程 manifest）
   - manifest 解析支持 `type: connector`
2. 现有 marketplace-manager 测试迁移/保留（安装/卸载闭环不回归）
3. agent-orchestrator 注入：快照条目进入 `getInstalledMarketplaceSpecs`（补充断言）

## 兼容性

- `sources.yaml` 现有 skill 条目无 `type` → 默认 `skill`，仓库无需改动即可接入 Skill
- 连接器远程条目依赖仓库侧新增（schema 已定义，等仓库更新后自动出现）
- 旧数据无 `marketplaceRemoteItems` → 空对象兼容
- `CommunityMarketDialog` 删除前 grep 验证无其他引用

## 非目标（YAGNI）

- 不做独立远程连接器仓库（复用 myyoda-skills 仓库 manifest）
- 不在市场内做更新管理（沿用技能 Tab 的 hasUpdate 机制）
- 不做评分/评论系统
- 不做多市场源（单仓库 + 本地两层足够）
