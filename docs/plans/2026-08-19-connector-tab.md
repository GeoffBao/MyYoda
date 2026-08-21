# 连接器 Tab UI 重构实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把插件页现有的 MCP + API 两个 Tab 合并为「连接器」Tab，Tab 文案中文化（Skills→技能、Memory→记忆），并采用 Mico 风格的 4 列卡片网格 + 分类 chip 筛选 + 居中详情 Modal。

**Architecture:** 新建 `ConnectorCard` + `ConnectorDetailDialog` + `ConnectorsTab`，替换 `AgentSkillsView` 中 `mcp`/`api` 两个 tab 的渲染逻辑。`ToolSettings.tsx` 的 `EnhancedToolsPanel` 同步替换为新视图。状态侧复用现有的内置 MCP 开关、chat-tool 配置和自定义 HTTP 工具数据，只做 UI 层重构。

**Tech Stack:** React + TypeScript + Tailwind CSS + shadcn/ui（Sheet/Dialog/Switch） + Jotai atoms。

---

## 前置条件

- 当前在 worktree：`/Users/admin/Workspace/ClaudeCode/MyYoda/.worktrees/b45afdfa-02eb-41e7-930c-d50d1b02d7e6-main`
- 设计文档：`docs/superpowers/specs/2026-08-19-connector-tab-design.md`
- 基础分支：`feat/builtin-mcp-connectors`（PR #105 尚在 CI，本期 UI 重构提交到该分支顶部，实施前确认 PR 状态）

---

## Task 1: Tab 合并与中文改名

**Files:**
- Modify: `apps/electron/src/renderer/atoms/settings-tab.ts`
- Modify: `apps/electron/src/renderer/components/agent-skills/AgentSkillsView.tsx`
- Modify: `apps/electron/src/renderer/components/settings/ToolSettings.tsx`（搜索占位符等文案）

**Step 1: 扩展/合并 tab 类型**

在 `settings-tab.ts` 中，将 `'mcp' | 'api'` 合并为 `'connectors'`。如果该 atom 被序列化持久化，添加兼容映射：遇到旧值 `'mcp'` 或 `'api'` 时 fallback 到 `'connectors'`。

```ts
export type AgentSkillsTab = 'experts' | 'teams' | 'skills' | 'connectors' | 'memory'

// 兼容旧值
const migrateTab = (v: string | null): AgentSkillsTab => {
  if (v === 'mcp' || v === 'api') return 'connectors'
  // ...
}
```

**Step 2: 修改 AgentSkillsView 的 Tab 切换器**

将 6 个 tab 改为 5 个，label 改中文：

```tsx
const TABS = [
  { value: 'experts', label: '专家' },
  { value: 'teams', label: '专家团' },
  { value: 'skills', label: '技能' },
  { value: 'connectors', label: '连接器' },
  { value: 'memory', label: '记忆' },
] as const
```

- 指示条背景宽度从 `w-[calc(16.666%-2px)]` 改为 `w-[calc(20%-2px)]`
- `translate-x` 重新计算：experts `0`，teams `100%`，skills `200%`，connectors `300%`，memory `400%`
- 搜索 placeholder 同步中文：「搜索技能...」「搜索连接器...」「搜索记忆文件...」

**Step 3: 移除 mcp/api 计数，新增 connectors 计数**

将 `mcpCount` + `apiToolCount` 合并为 `connectorCount`（或保持分开相加后在 Tab 上显示总数）。建议新增 `connectorCount = mcpCount + apiToolCount + builtinMcpCount`（含系统能力/预置连接器）。

**Step 4: 运行类型检查**

```bash
cd /Users/admin/Workspace/ClaudeCode/MyYoda/.worktrees/b45afdfa-02eb-41e7-930c-d50d1b02d7e6-main
pnpm --filter @myyoda/electron typecheck
```

Expected: 0 errors.

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor(agent-skills): merge MCP/API tabs into 连接器 and rename Skills/Memory to Chinese

Co-Authored-By: MyYoda <MyYoda@noreply.github.com>"
```

---

## Task 2: 定义连接器数据模型与分类筛选

**Files:**
- Modify: `packages/shared/src/types/agent.ts`（扩展 category 枚举）
- Create: `apps/electron/src/renderer/atoms/connector-filter.ts`

**Step 1: 扩展 BuiltinMcpCategory**

当前 enum：`system | automation | collaboration | memory | media | browser | task | office | knowledge`

新增或复用：
- `design`（设计协作：Figma）
- `search`（搜索与自动化：联网搜索、Brave、Exa、Fetch、Browserbase）
- `data`（数据与基础设施：SQLite）
- `code`（研发与交付：GitHub、GitLab、Git、Chrome）

或保持现有 enum，新增 UI 层中文映射。推荐新增 enum 值，因为第二期会注册这些连接器。

**Step 2: 创建分类筛选 atom**

```ts
// apps/electron/src/renderer/atoms/connector-filter.ts
import { atom } from 'jotai'
export type ConnectorCategoryChip =
  | 'all'
  | 'office'      // 协作办公
  | 'code'        // 研发与交付
  | 'data'        // 数据与基础设施
  | 'search'      // 搜索与自动化
  | 'design'      // 设计协作
  | 'system'      // 系统能力
  | 'mine'        // 我的 MCP
  | 'custom'      // 自定义连接器

export const connectorCategoryAtom = atom<ConnectorCategoryChip>('all')
export const connectorSearchAtom = atom('')
```

**Step 3: 运行 shared 包 typecheck**

```bash
pnpm --filter @myyoda/shared typecheck
```

Expected: 0 errors.

**Step 4: Commit**

```bash
git commit -m "feat(connectors): add connector category chip atom and extend builtin MCP categories

Co-Authored-By: MyYoda <MyYoda@noreply.github.com>"
```

---

## Task 3: 实现 ConnectorCard 组件

**Files:**
- Create: `apps/electron/src/renderer/components/agent-skills/ConnectorCard.tsx`

**Step 1: 设计 props**

```tsx
interface ConnectorCardProps {
  id: string
  name: string
  description: string
  icon: React.ReactNode
  categoryLabel: string          // 底部品类 pill 文案
  statusLabel?: string           // 已启用 / 需配置 / 可用
  statusTone?: 'success' | 'warning' | 'muted'
  enabled?: boolean
  onOpen: () => void
  onToggle?: (enabled: boolean) => void
}
```

**Step 2: 实现布局（对标 Mico）**

```tsx
<div className="group flex flex-col gap-3 rounded-2xl border border-border/60 bg-background p-4 transition-all duration-fast hover:-translate-y-0.5 hover:shadow-md hover:border-border">
  <div className="flex items-start justify-between gap-3">
    <div className="flex items-center gap-3">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-content-area">
        {icon}
      </div>
      <h3 className="font-semibold text-[15px]">{name}</h3>
    </div>
    <Button variant="outline" size="sm" className="opacity-0 group-hover:opacity-100 transition-opacity">
      查看详情
    </Button>
  </div>
  <p className="line-clamp-2 text-[13px] text-muted-foreground">{description}</p>
  <div className="flex items-center justify-between">
    <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] text-accent-foreground">{categoryLabel}</span>
    {onToggle && <Switch checked={enabled} onCheckedChange={onToggle} />}
  </div>
</div>
```

**Step 3: 防止开关点击触发卡片打开**

在 Switch 的 `onClick` 中调用 `e.stopPropagation()`。

**Step 4: 运行 lint/typecheck**

```bash
pnpm --filter @myyoda/electron lint -- --max-warnings 0
cd apps/electron && pnpm typecheck
```

Expected: 0 errors.

**Step 5: Commit**

```bash
git commit -m "feat(connectors): add ConnectorCard component with Mico-style layout

Co-Authored-By: MyYoda <MyYoda@noreply.github.com>"
```

---

## Task 4: 实现 ConnectorDetailDialog

**Files:**
- Create: `apps/electron/src/renderer/components/agent-skills/ConnectorDetailDialog.tsx`
- Modify: `apps/electron/src/renderer/components/agent-skills/BuiltinMcpDetailSheet.tsx`（可选：复用 metadata 渲染）

**Step 1: 使用 shadcn Dialog**

```tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
```

**Step 2: props 设计**

```tsx
interface ConnectorDetailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connector: ConnectorViewModel | null
}

type ConnectorViewModel =
  | { type: 'builtin'; server: BuiltinMcpServerSummary }
  | { type: 'custom-mcp'; entry: McpServerEntry }
  | { type: 'custom-http'; tool: CustomHttpTool }
```

**Step 3: 头部（对标 Mico）**

```tsx
<DialogHeader>
  <span className="text-[13px] text-muted-foreground">连接器市场</span>
  <div className="flex items-center gap-3">
    {icon}
    <DialogTitle className="text-xl">{name}</DialogTitle>
  </div>
  <div className="flex flex-wrap gap-2">
    {tags.map(t => <Badge key={t} variant="secondary">{t}</Badge>)}
  </div>
</DialogHeader>
```

Tags 可包含：MCP/HTTP/系统、版本、传输方式、风险等级、品类。

**Step 4: 主体分发**

- **预置连接器**：能力介绍 + 连接说明（权限/环境/适用对象表格）+ 凭据输入（需要时）
- **系统能力**：只读详情 + 开关
- **我的 MCP**：复用 `McpServerForm` 搬进 Dialog
- **自定义 HTTP 工具**：复用现有 HTTP 工具编辑表单搬进 Dialog

**Step 5: 底部操作栏**

```tsx
<DialogFooter>
  <Button variant="outline" onClick={() => onOpenChange(false)}>继续浏览</Button>
  <Button onClick={handlePrimaryAction}>
    {isEnabled ? '禁用' : '安装到 Agent'}
  </Button>
</DialogFooter>
```

**Step 6: Typecheck**

```bash
pnpm --filter @myyoda/electron typecheck
```

Expected: 0 errors.

**Step 7: Commit**

```bash
git commit -m "feat(connectors): add centered ConnectorDetailDialog

Co-Authored-By: MyYoda <MyYoda@noreply.github.com>"
```

---

## Task 5: 实现 ConnectorsTab 视图

**Files:**
- Create: `apps/electron/src/renderer/components/agent-skills/ConnectorsTab.tsx`

**Step 1: 组装数据源**

从以下数据源聚合连接器列表：
- 内置 MCP：`useBuiltinMcpServers()` → 预置连接器 + 系统能力
- 用户 MCP：`useMcpServers()`
- 自定义 HTTP 工具：`useChatTools()` 中的 custom http tools

**Step 2: 分类 chip 渲染**

```tsx
const CHIPS = [
  { key: 'all', label: '全部' },
  { key: 'office', label: '协作办公' },
  { key: 'code', label: '研发与交付' },
  { key: 'data', label: '数据与基础设施' },
  { key: 'search', label: '搜索与自动化' },
  { key: 'design', label: '设计协作' },
  { key: 'system', label: '系统能力' },
  { key: 'mine', label: '我的' },
  { key: 'custom', label: '自定义' },
]
```

**Step 3: 卡片网格渲染**

```tsx
<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
  {filtered.map(c => <ConnectorCard key={c.id} {...c} />)}
</div>
```

**Step 4: 搜索过滤**

复用顶部搜索框，按 name/description 过滤。

**Step 5: Commit**

```bash
git commit -m "feat(connectors): add ConnectorsTab with category chips and 4-column grid

Co-Authored-By: MyYoda <MyYoda@noreply.github.com>"
```

---

## Task 6: 在 AgentSkillsView 中接入 ConnectorsTab

**Files:**
- Modify: `apps/electron/src/renderer/components/agent-skills/AgentSkillsView.tsx`

**Step 1: 移除 mcp/api 分支渲染**

替换：

```tsx
{tab === 'connectors' && <ConnectorsTab />}
```

**Step 2: 保留 experts/teams/skills/memory 不变**

**Step 3: 清理旧 import**

移除 `EnhancedToolsPanel`、`McpServerForm`、`McpSection` 等旧视图的 import（如果只在 api/mcp tab 用）。

**Step 4: Typecheck**

```bash
pnpm --filter @myyoda/electron typecheck
```

Expected: 0 errors.

**Step 5: Commit**

```bash
git commit -m "feat(connectors): wire ConnectorsTab into AgentSkillsView

Co-Authored-By: MyYoda <MyYota@noreply.github.com>"
```

---

## Task 7: 同步设置面板 ToolSettings 薄壳

**Files:**
- Modify: `apps/electron/src/renderer/components/settings/ToolSettings.tsx`

**Step 1: 替换 EnhancedToolsPanel**

将 `ToolSettings` 内原来渲染 `EnhancedToolsPanel` 的地方改为渲染 `ConnectorsTab`（或一个简化的设置面板版本）。由于设置面板空间较窄，可以复用同一组件，但可能需要调整 padding。

**Step 2: 验证设置页「工具」入口**

打开设置 → 工具，应看到与插件页「连接器」Tab 一致的卡片网格。

**Step 3: Typecheck**

```bash
pnpm --filter @myyoda/electron typecheck
```

Expected: 0 errors.

**Step 4: Commit**

```bash
git commit -m "refactor(settings): replace tool settings list with ConnectorsTab view

Co-Authored-By: MyYoda <MyYoda@noreply.github.com>"
```

---

## Task 8: 修复深链入口

**Files:**
- Modify: `apps/electron/src/renderer/components/agent-skills/BuiltinMcpDetailSheet.tsx`

**Step 1: 修改「配置」按钮行为**

原来点击「配置」跳转到 API Tab。改为：

```tsx
onConfigure?.(server.id)
// 由父组件切换到 connectors tab 并打开 ConnectorDetailDialog
```

**Step 2: 在 AgentSkillsView 中处理 onConfigure**

```tsx
const [connectorDialogId, setConnectorDialogId] = useState<string | null>(null)

// 深链回调
const handleConfigureConnector = (id: string) => {
  setTab('connectors')
  setConnectorDialogId(id)
}
```

**Step 3: Commit**

```bash
git commit -m "fix(connectors): redirect MCP detail configure action to connectors tab dialog

Co-Authored-By: MyYoda <MyYoda@noreply.github.com>"
```

---

## Task 9: 全量验证

**Step 1: 根目录 typecheck（所有 workspace）**

```bash
cd /Users/admin/Workspace/ClaudeCode/MyYoda/.worktrees/b45afdfa-02eb-41e7-930c-d50d1b02d7e6-main
pnpm typecheck
```

Expected: 0 errors.

**Step 2: 运行测试**

```bash
pnpm test
```

Expected: 全部通过（参考基线 1673 pass / 0 fail）。

**Step 3: Electron 构建/渲染器构建**

```bash
pnpm --filter @myyoda/electron build:renderer
```

Expected: 构建成功。

**Step 4: 修复问题后 commit**

```bash
git commit -m "chore(connectors): pass typecheck, tests and renderer build

Co-Authored-By: MyYoda <MyYoda@noreply.github.com>"
```

---

## Task 10: 提交设计文档与计划

**Files:**
- Add: `docs/superpowers/specs/2026-08-19-connector-tab-design.md`
- Add: `docs/plans/2026-08-19-connector-tab.md`

**Step 1: 添加设计文档和计划**

```bash
git add docs/superpowers/specs/2026-08-19-connector-tab-design.md
git add docs/plans/2026-08-19-connector-tab.md
```

**Step 2: Commit**

```bash
git commit -m "docs: add connector tab design spec and implementation plan

Co-Authored-By: MyYoda <MyYoda@noreply.github.com>"
```

---

## 验证清单（交付前必须完成）

- [ ] 插件页 Tab 显示为：专家 / 专家团 / 技能 / 连接器 / 记忆
- [ ] 连接器 Tab 为 4 列卡片网格，带分类 chip 筛选
- [ ] 卡片有点击打开居中 Modal，Modal 底部有「继续浏览」和「安装到 Agent」/「启用」按钮
- [ ] 预置连接器（企微/Readwise/微信读书/Chrome/Nano Banana/联网搜索）均有品牌图标
- [ ] 开关在卡片上可直接切换，状态徽标正确
- [ ] 设置面板「工具」页与连接器 Tab 视觉一致
- [ ] MCP 详情页「配置」按钮正确打开连接器 Tab 对应详情 Modal
- [ ] `pnpm typecheck` 0 errors
- [ ] `pnpm test` 全绿
- [ ] `pnpm --filter @myyoda/electron build:renderer` 成功

---

## 暂不做（Phase 2）

- 新增 10 个连接器（GitHub/GitLab/Notion/Figma/Brave Search/Exa/Fetch/Git/SQLite/Browserbase）
- 连接器市场/广场
- 卡片拖动排序/收藏

Phase 2 计划在设计稳定、Phase 1 合并后再单独制定。
