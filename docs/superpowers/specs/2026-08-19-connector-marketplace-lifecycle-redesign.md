# 连接器 + 市场：安装 / 开关 / 卸载 整体重新设计

> 日期：2026-08-19
> 背景：用户实测反馈"连接器安装后只能点开关，如何 install/uninstall？"，且开关行为在 CLI 与 npx 连接器之间不一致。本文档梳理现状问题根因，参考业界成熟实现（Cline / GitHub MCP Registry / Cherry Studio）给出重新设计。

## 1. 现状梳理

### 1.1 三个 Tab 的数据流

```
市场 Tab（MyYoda社区）
  ├─ 本地目录 marketplace.json（6 npx 连接器 + 7 CLI 连接器 + 2 本地技能）
  └─ 远程 manifest（社区 Skill）
  操作：安装 / 卸载

连接器 Tab
  ├─ 内置 16 个（default-mcp.json）
  ├─ 用户自定义 MCP
  ├─ 自定义 HTTP 工具
  └─ 市场已安装的 connector 类条目（npx + CLI）
  操作：开关 / 凭据配置 / 垃圾桶（卸载）

技能 Tab
  ├─ 用户安装（含市场安装的 skill 类条目：ChatCut/HyperFrames）
  ├─ 连接器携带（预留，当前无数据）
  └─ 系统内置 26 个
```

### 1.2 当前的状态字段（chat-tools.json）

| 字段 | 语义 | 写入时机 |
|---|---|---|
| `marketplaceInstalled: string[]` | 当前**唯一**的"已安装/已启用"标记 | 市场安装、连接器开关开、市场"添加到会话" |
| `marketplaceIgnored: string[]` | 用户主动卸载过的 CLI（系统检测到也不自动显示） | 市场/连接器卸载（仅 CLI） |
| `marketplaceRemoteItems: Record` | 远程连接器快照（离线注入用） | 远程条目安装时 |
| `toolCredentials['marketplace:<id>']` | npx 连接器凭据 | 凭据表单保存 |

### 1.3 核心问题：`marketplaceInstalled` 一个字段承担了两个语义

```ts
// toggleMarketplaceItem 现状实现
export function toggleMarketplaceItem(itemId: string, enabled: boolean): void {
  if (enabled) installed.add(itemId)
  else installed.delete(itemId)   // ← 开关关闭 = 直接从"已安装"里删除
}
```

**"开关关闭"与"卸载"在数据层是同一个动作**（都是把 id 从 `marketplaceInstalled` 移除），只是卸载多加了一步 `ignored`（仅对 CLI）。这导致：

| 连接器类型 | 开关关闭后 | 原因 |
|---|---|---|
| npx（如 Linear） | **卡片消失** | `installed = marketplaceInstalled.has(id) \|\| systemInstalled`，npx 没有 systemInstalled，移除后两者都是 false |
| CLI（如企业微信） | **卡片保留**（灰色"已关闭"？实际是"系统已安装"） | `systemInstalled` 靠外部环境事实撑着，不受开关影响 |

**同一个"关闭"操作，两类连接器表现完全不同** —— 这正是用户困惑的根源。而且"卸载"操作（垃圾桶）在数据层和"开关关闭"几乎做同一件事，只是多了 `ignored` 标记，用户分不清两个入口的区别。

## 2. 业界参考（GitHub 调研）

### 2.1 Cline（`docs.cline.bot/mcp/mcp-overview`）—— 最贴近的参考

CLI MCP wizard 提供的动作：

```
List servers    — 列出，显示 enabled/disabled 状态
Add server       — 创建新的 MCP server 配置
Edit server      — 修改现有配置
Enable/Disable   — 「不删除地」切换某个 server（Toggle a server without deleting it）
Delete server    — 永久移除
```

关键设计：**Enable/Disable 明确定义为"不删除"**，与 Delete 是完全独立的两个动作。

### 2.2 Cherry Studio

MCP 服务器管理支持：添加 / 删除 / 启用 / 禁用 / 编辑 —— 同样是三层。

### 2.3 GitHub MCP Registry / modelcontextprotocol/registry

发现（Registry）与安装（本地配置写入）分离；安装后的 server 在客户端配置文件里是一条持久记录，开关只改 `disabled` 字段，不删除记录本身。

### 2.4 共同结论

三个项目的模型完全一致：

```
已安装（Installed）── 一条持久记录，直到用户主动 Delete
    │
    ├─ 已启用（Enabled）  → 参与运行/注入
    └─ 已停用（Disabled） → 记录保留，不参与运行，随时可再开
```

**"已安装"和"已启用"是两个正交维度**，缺一层就会出现我们现在的问题。

## 3. 重新设计

### 3.1 三层模型（对齐 Cline）

| 层 | 动作 | 入口 | 效果 |
|---|---|---|---|
| **安装（Install）** | 市场「安装」 | 市场 Tab | 加入「已安装」记录，默认**启用** |
| **开关（Enable/Disable）** | 连接器 Tab 开关 | 连接器 Tab | 切换启用状态，**不删除安装记录**，卡片始终保留 |
| **卸载（Uninstall）** | 连接器 Tab 垃圾桶 / 市场「卸载」 | 两处均可，同语义 | 移除「已安装」记录，凭据保留（重装复用），CLI 额外标记 ignored（防止系统检测复活） |

### 3.2 数据模型调整

新增一个字段，把"已安装"和"已启用"拆开：

```ts
// chat-tools.json
marketplaceInstalled: string[]   // 语义不变但含义收紧：「已安装」的条目（不含临时开关状态）
marketplaceDisabled: string[]    // 新增：已安装但被用户停用的子集（缺省 = 全部启用，兼容旧数据）
marketplaceIgnored: string[]     // 不变：CLI 卸载后不被系统检测复活
```

状态推导：

```ts
function isInstalled(item): boolean {
  // 已安装 = 在安装列表，或（CLI 且系统已装且未被用户 ignore）
  return (marketplaceInstalled.has(id) || (item.installKind === 'cli' && systemInstalled && !ignored))
}
function isEnabled(item): boolean {
  return isInstalled(item) && !marketplaceDisabled.has(id)
}
```

### 3.3 三个操作的精确语义

**安装**（`installMarketplaceItem`）
- npx：加入 `marketplaceInstalled`，从 `marketplaceDisabled` 移除（确保默认启用）
- CLI：系统未装则 `npm install -g`；加入 `marketplaceInstalled`，解除 `ignored`，解除 `marketplaceDisabled`
- skill：复制/下载技能文件（不涉及 enabled 概念，技能本身有自己的开关，在技能 Tab 管理）

**开关**（`toggleMarketplaceItem`，新语义）
- `enabled=false` → 加入 `marketplaceDisabled`（**不**从 `marketplaceInstalled` 移除，**不**加 `ignored`）
- `enabled=true` → 从 `marketplaceDisabled` 移除
- 卡片**始终保留**（只要是"已安装"状态），只是 badge/开关跟随 enabled 变化
- 停用后不参与 `getInstalledMarketplaceSpecs` / `getInstalledMarketplaceCliHints`（注入时过滤 disabled）

**卸载**（`uninstallMarketplaceItem`，不变）
- 从 `marketplaceInstalled` 和 `marketplaceDisabled` 中移除
- CLI 额外加入 `ignored`
- 凭据（`toolCredentials`）保留，重装可直接复用
- 卡片消失（回到市场"未安装"或"已忽略"状态）

### 3.4 UI 呈现

**连接器 Tab 卡片**（市场安装的连接器）

| 状态 | 徽标 | 开关 | 垃圾桶 |
|---|---|---|---|
| 已安装 + 启用 + 凭据/认证 OK | 绿色「已启用」 | 开 | 有 |
| 已安装 + 启用 + 凭据/认证缺失 | 琥珀「需配置」/「需认证」 | 开 | 有 |
| 已安装 + **停用** | 灰色「已关闭」 | **关（卡片保留）** | 有 |

**市场 Tab 卡片**

| 状态 | 徽标 | 按钮 |
|---|---|---|
| 未安装 | 灰色「未安装」 | 安装 |
| 已安装（不管开关） | 绿色「已安装」 | 卸载 |
| CLI 系统已装但未加入会话 | 绿色「系统已安装」 | 添加到会话 |
| CLI 已忽略 | 灰色「已忽略」 | 添加到会话 |

市场 Tab 不关心 enabled/disabled（那是连接器 Tab 的运行时管理），只关心"要不要这个东西"。

### 3.5 与内置连接器的语义对齐

内置连接器（github/gitlab/notion 等）本来就是这个模型：`toggleable` 开关只改 `enabled` 字段，从不"卸载"（内置连接器不可卸载，只能关）。市场连接器补上开关层之后，两者的开关行为完全一致，用户不再需要区分"这是内置的还是市场装的"。

## 4. 实施范围

| 文件 | 改动 |
|---|---|
| `packages/shared/src/types/chat-tool.ts` | 加 `marketplaceDisabled?: string[]` |
| `apps/electron/src/main/lib/chat-tool-config.ts` | DEFAULT_CONFIG / 读取分支透传新字段 |
| `apps/electron/src/main/lib/marketplace/marketplace-service.ts` | `toggleMarketplaceItem` 重写（disabled 语义）；`buildMarketplaceList` 的 installed/enabled 计算；`getInstalledMarketplaceSpecs`/`getInstalledMarketplaceCliHints` 过滤 disabled |
| `packages/shared/src/types/agent.ts` | `MarketplaceItemWithStatus` 加 `enabled?: boolean`（区分 installed 与 enabled） |
| `apps/electron/src/renderer/components/agent-skills/ConnectorsTab.tsx` | marketplace 卡片过滤条件改为 `installed`（不再受 enabled 影响是否显示），`enabled` 字段驱动开关与徽标 |
| 单测 | `marketplace-service.test.ts` 补充开关不删除记录的断言 |

## 5. 非目标（本轮不做）

- 不做"停用原因"记录（如临时停用 vs 长期停用）
- 不做批量操作（全部启用/全部停用）
- 不改市场 Tab 是否显示开关（保持市场只做安装/卸载决策，运行时管理留给连接器 Tab）
