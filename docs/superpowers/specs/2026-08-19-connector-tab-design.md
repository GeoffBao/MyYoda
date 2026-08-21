# 插件「连接器」Tab 设计（MCP + API 合并 + 卡片化重设计）

- 日期：2026-08-19
- 状态：已与用户确认方向，待实施
- 分支：`feat/connector-tab`（基于 `feat/builtin-mcp-connectors`，PR #105）

## 背景

企业微信/Readwise/微信读书连接器接入后，插件页暴露两个问题：

1. **命名与信息架构落后于行业**：WorkBuddy、小米 Mico 均把"预置第三方服务接入"称为**连接器（Connector）**（底层即 MCP），对普通用户友好；MyYoda 现状用开发者术语「MCP」「API」两个 Tab，且二者内容重叠（企微等同时出现在 MCP Tab 卡片和 API Tab 配置块）。
2. **API Tab 是设置列表形态**：6 个区块竖排堆叠，信息密度低，与插件页其他 Tab（MCP/Skills 卡片网格）风格不一致。

用户决策：合并 MCP + API 为「连接器」Tab，卡片网格 + **居中详情 Modal**，分类 chip 筛选，并后续内置 10 个新连接器（GitHub/GitLab/Notion/Figma/Brave Search/Exa/Fetch/Git/SQLite/Browserbase）。

## 目标

- 插件页 Tab：`专家 | 专家团 | 技能 | 连接器 | 记忆`（原 Skills→技能、Memory→记忆、MCP+API→连接器）
- 连接器 Tab 统一为 **Mico 风格卡片网格 + 分类 chip 筛选 + 居中详情 Modal**，所有预置连接器必须有官方品牌图标
- 系统能力/我的 MCP/自定义连接器使用语义图标，按特殊品类纳入 chip 筛选
- 新连接器分批接入（先 UI 后连接器）

## 非目标

- 不改「专家/专家团/技能/记忆」Tab 内容
- 不做连接器市场/广场
- 不改 default-mcp.json 数据模型与 catalog 逻辑（仅 UI 分组层调整）

## 设计

### 1. Tab 结构（6 → 5）

```
专家 | 专家团 | 技能 | 连接器 | 记忆
```

- `agentSkillsTabAtom`：`'mcp'` / `'api'` 合并为 `'connectors'`；存量值做兼容映射（`'mcp'`/`'api'` → `'connectors'`）
- Tab 指示条宽度从 `16.666%` 改为 `20%`，translate 重新计算
- 搜索占位符：「搜索连接器...」；其余 Tab 占位同步中文

### 2. 连接器 Tab 布局（对标 Mico）

```
专家 | 技能 | 连接器 | 记忆

连接器
[全部] [协作办公] [研发与交付] [数据与基础设施] [搜索与自动化] [系统能力] [我的] [自定义]

┌────────────┬────────────┬────────────┬────────────┐
│ [icon]     │ [icon]     │ [icon]     │ [icon]     │
│ GitHub MCP │ Figma MCP  │ Notion MCP │ Brave S.   │
│ 查看详情   │ 查看详情   │ 查看详情   │ 查看详情   │
│ 连接 GitHub│ 连接 Figma │ 连接 Notion│ 网页搜索   │
│ 官方远端   │ 官方远端   │ 官方托管   │            │
│ [代码托管] │ [设计协作] │ [协作办公] │ [网页搜索] │
└────────────┴────────────┴────────────┴────────────┘
```

- **顶部分类筛选 chip**：横向一排可滚动 Pill（全部 / 协作办公 / 研发与交付 / 数据与基础设施 / 搜索与自动化 / 系统能力 / 我的 / 自定义），点击筛选对应品类
- **网格**：`grid gap-4 sm:grid-cols-2 lg:grid-cols-4`（Mico 为 4 列，宽屏充分利用空间）
- **分区**：不再用垂直分组标题，而是通过分类 chip 统一筛选；未筛选时按品类排序展示
- **空状态**：筛选无结果 / 无连接器时 EmptyState

### 3. 卡片样式（对标 Mico）

新建 `ConnectorCard`（不直接复用 McpCard，但可借鉴其状态徽标）：

- **卡片容器**：白色圆角卡片（`rounded-2xl`）、柔和边框、hover 时轻微上浮 + 阴影
- **顶部行**：左侧品牌图标（48×48，圆角背景色块），中间连接器名称（`font-semibold`），右侧「查看详情」按钮（small outlined）
- **描述区**：2 行灰色描述文字，超出截断
- **底行**：左侧品类标签 pill（如「代码托管」「设计协作」），右侧状态徽标（已启用/需配置）或开关
- **点击**：点卡片任意位置打开详情 Modal；点击开关直接切换启用状态
- **图标**：所有预置连接器必须使用官方品牌图标；系统能力用语义化 lucide；我的 MCP/自定义连接器用默认图标

### 4. 详情：居中 Modal（对标 Mico）

新建 `ConnectorDetailDialog`（居中模态，非右侧 Sheet）：

- **头部**：
  - 小字标签：「连接器市场」或「我的连接器」
  - 大标题：品牌图标 + 连接器名称
  - Tags：MCP 连接器 / HTTP / 系统 / 版本 / 传输方式 / 风险等级 / 品类
- **主体**（按连接器类型分发）：
  - **预置连接器（凭据型）**：能力介绍 + 连接说明（权限/环境/适用对象）+ API Key/Token 输入（blur 保存）+ 开关
  - **预置连接器（无凭据型：Fetch/Git/SQLite）**：能力介绍 + 连接说明 + 开关（SQLite 可配置 DB 路径）
  - **系统能力**：能力介绍 + 连接说明 + 开关
  - **我的 MCP**：McpServerForm（搬进 Modal）
  - **自定义连接器**：HTTP 工具编辑表单（搬进 Modal）
- **底部操作栏**（对标 Mico）：
  - 左侧/次要：「继续浏览」（关闭 Modal）
  - 右侧/主要：「安装到 Agent」/「启用」/「保存」
  - 已启用的连接器主按钮变为「禁用」或「更新」

### 5. 新增预置连接器清单（分批接入）

| 连接器 | npm 包 | 启动 bin | 凭据 env | 品类 |
|---|---|---|---|---|
| GitHub | `@modelcontextprotocol/server-github` | `mcp-server-github` | `GITHUB_PERSONAL_ACCESS_TOKEN` | 研发与交付 |
| GitLab | `@modelcontextprotocol/server-gitlab` | `mcp-server-gitlab` | `GITLAB_PERSONAL_ACCESS_TOKEN` | 研发与交付 |
| Git | `mcp-server-git` | `mcp-server-git` | 无 | 研发与交付 |
| Notion | `notion-mcp-server` | `notion-mcp-server` | `NOTION_API_KEY` | 协作办公 |
| Figma | `figma-mcp-server` | `figma-mcp-server` | `FIGMA_API_KEY` | 设计协作 |
| Brave Search | `@modelcontextprotocol/server-brave-search` | `mcp-server-brave-search` | `BRAVE_API_KEY` | 搜索与自动化 |
| Exa | `exa-mcp-server` | `exa-mcp-server` | `EXA_API_KEY` | 搜索与自动化 |
| Fetch | `mcp-server-fetch` | `mcp-server-fetch` | 无 | 搜索与自动化 |
| SQLite | `mcp-server-sqlite` | `mcp-server-sqlite` | 无（DB 路径参数） | 数据与基础设施 |
| Browserbase | `@browserbasehq/mcp` | `mcp-server-browserbase` | `BROWSERBASE_API_KEY` + `BROWSERBASE_PROJECT_ID` | 搜索与自动化 |

现有预置连接器品类映射（一并纳入 chip）：
- 协作办公：企业微信、Readwise、微信读书、Notion
- 研发与交付：GitHub、GitLab、Git、Chrome
- 搜索与自动化：联网搜索、Brave Search、Exa、Fetch、Browserbase
- 设计协作：Figma、Nano Banana
- 数据与基础设施：SQLite
- 系统能力：定时任务、协作子 Agent、创建任务
- 我的 / 自定义：用户自配 MCP / 自定义 HTTP 工具

接入模式：`default-mcp.json` 注册 + `builtin-mcp/<id>-mcp.ts` 注入器（npx + env）+ settings 默认关闭 + catalog 可用性 + ToolSettings 凭据 UI + 官方图标。与 wecom/chrome-devtools 同构。

### 6. 实施分期

**第一期（UI 重构）**：
- Tab 合并（mcp+api→connectors）+ 改名（Skills→技能、Memory→记忆）
- 连接器 Tab 卡片网格 + 分类 chip 筛选 + 居中 ConnectorDetailDialog
- 现有 6 个预置连接器 + 3 个系统能力迁入卡片化
- 我的 MCP / 自定义连接器卡片化
- 深链调整（MCP 详情「配置」→ 连接器 Tab → 打开 Dialog）

**第二期（新连接器接入）**：
- 10 个新连接器五件套 + 官方图标，分批（如先 5 个再 5 个）

## 落地影响

| 项 | 处理 |
|---|---|
| `agentSkillsTabAtom` | `'mcp'`/`'api'` → `'connectors'`；兼容映射存量 |
| `AgentSkillsView.tsx` | Tab 标签/指示条/搜索/视图切换 |
| `ToolSettings.tsx` | `EnhancedToolsPanel` 保留（设置面板「工具」页宽度窄，不套 4 列网格）；各 Settings 组件 export 供凭据 Modal 复用 |
| `McpCard.tsx` | 已删除（无引用）；状态徽标逻辑已内联到 ConnectorsTab |
| 新文件 | `ConnectorCard.tsx`、`ConnectorDetailDialog.tsx`、`ConnectorsTab.tsx`（或重构 AgentSkillsView 内视图） |
| `default-mcp.json` / `catalog.ts` | 第一期不变；第二期注册新连接器 |
| 文档/FAQ | "MCP/API" 表述同步改"连接器" |

## 暂不做

- 不改其他 Tab
- 不做连接器市场
- 不做卡片拖动排序/收藏
