# Review：PR #105 — 连接器体系重构（预装化 + 生命周期三层模型 + CLI 应用内授权）

> 日期：2026-08-20
> 分支：feat/builtin-mcp-connectors → main（57 commits，92 files，+7618/-678）
> 结论：方案成立、结构清晰、测试全绿（1700+ 0 fail / typecheck / renderer build）；review 发现 1 个真实 UX bug（已修复）+ 若干已知取舍与建议。

## 1. 方案总览（本次 PR 做了什么）

从「市场安装制」收敛为「预装制 + 常驻管理」，共四个子目标：

```
① Tab 重构      专家 | 专家团 | 技能 | 连接器 | 记忆（MCP+API 合并为统一连接器 Tab）
② 生命周期      安装 / 开关 / 卸载 三层正交（对齐 Cline Enable/Disable 不删除模型）
③ 预装化        9 连接器常驻 + 2 技能转内置（移除市场 Tab）
④ CLI 授权      扫码弹窗 / Token 表单，不再跳终端
```

## 2. 代码逻辑分层梳理

### 2.1 数据模型（chat-tools.json + shared types）

| 字段 | 语义 | 写入 |
|---|---|---|
| `marketplaceInstalled[]` | 用户明确安装过的条目 | 安装 / 添加会话 |
| `marketplaceDisabled[]` | 已安装但被停用的子集 | 开关 off（**不删安装记录**） |
| `marketplaceIgnored[]` | CLI 卸载后不复活（系统检测门控） | 卸载（非 purge） |
| `marketplaceRemoteItems{}` | 远程条目快照（离线注入） | 远程安装时（存量兼容） |
| `toolCredentials['marketplace:<id>']` | npx 凭据 / CLI 无（走系统 auth） | 凭据表单 |

**核心不变量**：
- `installed = ALWAYS_ON ∪ marketplaceInstalled ∪ (CLI 系统已装 ∧ ¬ignored)`
- `enabled = installed ∧ ¬disabled`
- **开关只写 disabled**；卸载才动 installed/ignored → 关闭 ≠ 卸载（这是本轮最大的修正）

### 2.2 主进程服务（marketplace-service.ts）

- `listMarketplaceItems(workspaceSlug)`：30s 列表缓存 + 60s CLI 检测缓存（command -v + zsh login shell fallback；whoami 认证检测）→ Tab 打开/开关切换秒响应
- `install/uninstall/toggle`：三段式状态写入（详见状态机）
- `getInstalledMarketplaceSpecs / CliHints`：注入时 `(installed ∪ alwaysOn) ∧ ¬disabled` 过滤 → Agent 会话组装 npx stdio server 或 CLI 提示词
- `ALWAYS_ON_CONNECTOR_IDS`：9 个预装 id，绕过 install 门控直接常驻

### 2.3 CLI 授权（cli-auth.ts，独立模块）

- **扫码**：`spawn <bin> auth init --noninteractive --no-browser --output-qrcode qr.png`（detached 进程组）→ 解析 URL + PNG → base64 data URL 给 UI；2s 轮询 `auth show`；取消 = 进程组 SIGTERM + 2s 后 SIGKILL 兜底（实测无孤儿进程）
- **Token**：`<bin> login-with-token <token>`（shell 转义防注入）→ 写回后以 authCheckCommand 复检
- **认证成功 → invalidateCliCheckCache()**（本次 review 修复：避免列表重建命中 60s 旧缓存）

### 2.4 IPC / Preload（6 个新通道）

`marketplace:cli-auth-start / cli-auth-status / cli-auth-cancel / cli-auth-token` + 既有 `list/install/uninstall/toggle`

### 2.5 UI 层（agent-skills/）

| 组件 | 职责 |
|---|---|
| `ConnectorsTab` | 统一卡片网格（内置 16 + 预装 9 + 用户 MCP/自定义 + 存量已装） |
| `ConnectorCard` | 开关（启停）+ 垃圾桶（非预装才显示）+ 状态徽标（已启用/需配置/需认证/已关闭） |
| `ConnectorCredentials` | 凭据表单 + 获取 Token 链接（7 内置 + 市场 homepage 透传） |
| `ConnectorDetailDialog` | 居中详情壳（CLI 分支：安装/认证状态 + cliHint + 授权按钮） |
| `CliAuthDialog` | 扫码（二维码图）/ Token（密码框）双模式授权弹窗 |
| `CliUninstallConfirm` | CLI 卸载双选项（仅移除会话 / 同时卸载系统 CLI） |
| `AgentSkillsView` | Tab 容器 + 数据编排（marketplaceItems/技能列表/凭据 Modal 状态机） |

### 2.6 技能体系

ChatCut / HyperFrames 从市场条目转为 `default-skills/` 内置技能（version 1.0.0），由既有 `upgradeDefaultSkillsInWorkspaces`（启动时）自动补齐到全部工作区——复用成熟机制，无新代码路径。

## 3. 状态机全景（安装/开关/卸载）

```
未安装 ──安装/添加──▶ 已安装+启用 ──开关 off──▶ 已安装+停用（卡片保留「已关闭」）
  ▲                     │   │                      │
  │    CLI 卸载(purge)   │   └──开关 on──────────────┘
  └──────────────────────┘
已忽略（CLI 卸载非 purge，系统保留）──添加到会话──▶ 已安装+启用
```

## 4. Review 发现

### 4.1 已修复（本 review）
- **[bug] 认证成功状态滞后 ≤60s**：扫码/token 认证成功后列表重建命中 `cliCheckCache` 旧值，卡片仍显示「需认证」。→ `invalidateCliCheckCache()` 在 cliAuthStatus/token 复检成功时调用（commit `fix(connectors): 认证成功后清除 CLI 检测缓存`）
- 冗余 `connectors: []` 空字段清理

### 4.2 已知取舍（有意为之）
- **预装默认启用**：9 连接器默认开 → 3 个 npx（playwright/tavily/cloudflare）每会话 spawn npx（可选增强不阻塞）；6 条 CLI hints 进系统提示词（未认证时提供引导）。符合「开箱即用」目标，凭据未配不阻塞会话
- **Slack/Linear/Firecrawl/Netlify 无入口**：市场移除后不在预装清单 → 连接器 Tab 不显示（netlify CLI 若系统已装仍会显示）。数据保留在 marketplace.json，需要时可快速加回
- **CLI 卸载非 purge = 「仅移除会话」**：系统二进制保留（用户可能在终端使用），市场入口已无，「添加到会话」语义由连接器 Tab 开关接管

### 4.3 建议后续（不在本 PR）
1. **远程 manifest 拉取已无 UI 消费方**：buildMarketplaceList 每次打开连接器 Tab 仍拉 `fetchCommunityManifest()`，结果全被 connector 过滤 → 可移除远程合并路径（保留 COMMUNITY_FETCH/INSTALL IPC 供未来社区入口用）
2. `resources/marketplace-skills/{chatcut,heygen}` 与 default-skills 副本并存 → 可清理
3. CliAuthDialog 中 `itemName === '企业微信'` 硬编码终端提示文案 → 可改为条目的 authGuide 字段
4. token 提交与轮询存在极低概率双 toast（时序竞态）→ 可加 submitting 互斥
5. `installMarketplaceItem` 的 skill 分支（copySkillFolder/getMarketplaceSkillsSourceDir）已无入口 → 可清理或留给未来

## 5. 验证

- 1700 tests 0 fail（含新增：开关不删安装记录、预装集合断言、卸载双选项）
- typecheck 全绿；renderer build 通过
- 实测：9 预装 installed/enabled=true；6 CLI hints + 3 npx specs 注入；扫码进程无孤儿；升级脚本已补齐 5 工作区 chatcut/heygen
