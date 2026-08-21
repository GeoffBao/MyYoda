# 插件中心 v1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将现有“插件”页从 `专家 / 专家团 / Skills / MCP / API / Memory` 演进为 `总览 / 专家 / 专家团 / 技能 / 连接器 / 记忆` 的插件中心 v1。

**Architecture:** 先抽出纯模型层（Tab 兼容、总览摘要、连接器聚合、作用域解析）并用 Bun 单测锁定行为，再逐步替换 AgentSkillsView UI。运行时沿用现有 Workspace/Project Skills/MCP 覆盖机制，但抽出 Effective Plugin Profile 解析函数，避免 UI 与 Agent 注入规则漂移。

**Tech Stack:** Electron 43、React 18、TypeScript、Jotai、Bun test、Tailwind/Radix UI、现有 `window.electronAPI` IPC、现有 Workspace/Project Skills/MCP 存储。

---

## Constraints

- 基线是当前 `main`，不要直接 cherry-pick PR #105。
- 模块继续叫“插件”，不要改成“能力”。
- 企业级能力市场、组织审核、组织分发不进入本轮。
- 连接器只收外部系统/工具接入；定时任务、协作子 Agent、创建任务、Planning Todo/Calendar 放总览“内置能力”。
- 产品行为变化必须同步 README、Guide、FAQ。
- 每个 commit 都带 MyYoda trailer。

## Recommended worktree setup

```bash
git status --short --branch
git worktree add .worktrees/plugin-center-v1 -b feat/plugin-center-v1 main
cd .worktrees/plugin-center-v1
```

Expected: worktree created under `.worktrees/` and ignored by git.

---

### Task 1: Plugin center tab model and legacy compatibility

**Files:**
- Create: `apps/electron/src/renderer/lib/plugin-center-model.ts`
- Create: `apps/electron/src/renderer/lib/plugin-center-model.test.ts`
- Modify: `apps/electron/src/renderer/atoms/active-view.ts`

**Step 1: Write the failing test**

Create `apps/electron/src/renderer/lib/plugin-center-model.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import {
  PLUGIN_CENTER_TABS,
  normalizePluginCenterTab,
  pluginCenterTabIndex,
  pluginCenterTabWidthPercent,
} from './plugin-center-model'

describe('plugin-center-model', () => {
  test('defines approved plugin center tab order', () => {
    expect(PLUGIN_CENTER_TABS.map((tab) => tab.value)).toEqual([
      'overview', 'experts', 'teams', 'skills', 'connectors', 'memory',
    ])
    expect(PLUGIN_CENTER_TABS.map((tab) => tab.label)).toEqual([
      '总览', '专家', '专家团', '技能', '连接器', '记忆',
    ])
  })

  test('maps legacy mcp/api tabs to connectors', () => {
    expect(normalizePluginCenterTab('mcp')).toBe('connectors')
    expect(normalizePluginCenterTab('api')).toBe('connectors')
  })

  test('falls back invalid values to overview', () => {
    expect(normalizePluginCenterTab(undefined)).toBe('overview')
    expect(normalizePluginCenterTab(null)).toBe('overview')
    expect(normalizePluginCenterTab('market')).toBe('overview')
  })

  test('computes tab index and indicator width', () => {
    expect(pluginCenterTabIndex('overview')).toBe(0)
    expect(pluginCenterTabIndex('connectors')).toBe(4)
    expect(pluginCenterTabWidthPercent()).toBeCloseTo(100 / 6)
  })
})
```

**Step 2: Run it to verify failure**

```bash
bun test apps/electron/src/renderer/lib/plugin-center-model.test.ts
```

Expected: FAIL because `plugin-center-model.ts` does not exist.

**Step 3: Implement the model**

Create `apps/electron/src/renderer/lib/plugin-center-model.ts`:

```ts
export type PluginCenterTab = 'overview' | 'experts' | 'teams' | 'skills' | 'connectors' | 'memory'

export interface PluginCenterTabDef {
  value: PluginCenterTab
  label: string
  searchPlaceholder: string
}

export const PLUGIN_CENTER_TABS: PluginCenterTabDef[] = [
  { value: 'overview', label: '总览', searchPlaceholder: '搜索插件...' },
  { value: 'experts', label: '专家', searchPlaceholder: '搜索专家名称或 slug...' },
  { value: 'teams', label: '专家团', searchPlaceholder: '搜索专家团名称或角色...' },
  { value: 'skills', label: '技能', searchPlaceholder: '搜索技能...' },
  { value: 'connectors', label: '连接器', searchPlaceholder: '搜索连接器...' },
  { value: 'memory', label: '记忆', searchPlaceholder: '搜索记忆文件...' },
]

const VALID_TABS = new Set<string>(PLUGIN_CENTER_TABS.map((tab) => tab.value))

export function normalizePluginCenterTab(value: string | null | undefined): PluginCenterTab {
  if (value === 'mcp' || value === 'api') return 'connectors'
  if (value && VALID_TABS.has(value)) return value as PluginCenterTab
  return 'overview'
}

export function pluginCenterTabIndex(tab: PluginCenterTab): number {
  return PLUGIN_CENTER_TABS.findIndex((item) => item.value === tab)
}

export function pluginCenterTabWidthPercent(): number {
  return 100 / PLUGIN_CENTER_TABS.length
}
```

**Step 4: Update the atom**

Modify `apps/electron/src/renderer/atoms/active-view.ts`:

```ts
import type { PluginCenterTab } from '@/lib/plugin-center-model'

/** 插件中心子页：总览 / 专家 / 专家团 / 技能 / 连接器 / 记忆。 */
export type AgentSkillsCapabilityTab = PluginCenterTab

export const agentSkillsTabAtom = atom<AgentSkillsCapabilityTab>('overview')
```

Also update the file-level comment that currently mentions `Skills / MCP / API / Memory`.

**Step 5: Verify pass**

```bash
bun test apps/electron/src/renderer/lib/plugin-center-model.test.ts
bun run typecheck
```

Expected: model test PASS; typecheck may fail at legacy `'mcp'`/`'api'` call sites, fixed in Task 2.

**Step 6: Commit**

```bash
git add apps/electron/src/renderer/lib/plugin-center-model.ts \
  apps/electron/src/renderer/lib/plugin-center-model.test.ts \
  apps/electron/src/renderer/atoms/active-view.ts
git commit -m "feat(plugins): define plugin center tab model" \
  --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>"
```

---

### Task 2: Update deep links and plugin center shell tabs

**Files:**
- Modify: `apps/electron/src/renderer/components/agent-skills/AgentSkillsView.tsx`
- Modify: `apps/electron/src/renderer/components/chat/ToolSelectorPopover.tsx`
- Modify: `apps/electron/src/renderer/components/automation/AutomationFormView.tsx`
- Modify: `apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx`
- Modify: `apps/electron/src/renderer/components/app-shell/SidebarProjectsTab.tsx`

**Step 1: Update legacy deep links**

Replace `setAgentSkillsTab('mcp')` with `setAgentSkillsTab('connectors')` in:

- `AutomationFormView.tsx`
- `LeftSidebar.tsx`
- `SidebarProjectsTab.tsx`

Replace `setAgentSkillsTab('api')` with `setAgentSkillsTab('connectors')` in:

- `ToolSelectorPopover.tsx`
- `AgentSkillsView.tsx` inside `configureBuiltinMcp`

Update nearby comments to say “插件 / 连接器”.

**Step 2: Update AgentSkillsView imports**

Add to `AgentSkillsView.tsx`:

```ts
import {
  PLUGIN_CENTER_TABS,
  normalizePluginCenterTab,
  pluginCenterTabIndex,
  pluginCenterTabWidthPercent,
  type PluginCenterTab,
} from '@/lib/plugin-center-model'
```

**Step 3: Normalize tab from atom**

Replace:

```ts
const [tab, setTab] = useAtom(agentSkillsTabAtom)
```

with:

```ts
const [rawTab, setRawTab] = useAtom(agentSkillsTabAtom)
const tab = normalizePluginCenterTab(rawTab)
const setTab = React.useCallback((next: PluginCenterTab) => setRawTab(next), [setRawTab])
```

**Step 4: Replace hard-coded tab strip**

Compute counts:

```ts
const connectorToolCount = mcpCount + apiToolCount
const tabCounts: Record<PluginCenterTab, number> = {
  overview: data.skills.length + mcpCount + apiToolCount + expertsCount + teamsCount,
  experts: expertsCount,
  teams: teamsCount,
  skills: data.skills.length,
  connectors: connectorToolCount,
  memory: memoryCount,
}
```

Use model-driven buttons and indicator:

```tsx
<div
  className="absolute bottom-0.5 top-0.5 rounded-lg bg-background shadow-sm transition-transform duration-base ease-out"
  style={{
    width: `calc(${pluginCenterTabWidthPercent()}% - 2px)`,
    transform: `translateX(${pluginCenterTabIndex(tab) * 100}%)`,
  }}
/>
{PLUGIN_CENTER_TABS.map(({ value, label }) => (
  <button key={value} onClick={() => setTab(value)}>{label}<span>{tabCounts[value]}</span></button>
))}
```

Keep existing class names from current tab buttons.

**Step 5: Update search behavior**

Hide search on overview for v1:

```tsx
{tab !== 'overview' && (
  ... placeholder={PLUGIN_CENTER_TABS.find((item) => item.value === tab)?.searchPlaceholder ?? '搜索插件...'} ...
)}
```

**Step 6: Temporary route connectors to old MCP tab**

For this task only, render current `McpTab` when `tab === 'connectors'`. Add a temporary comment:

```tsx
// Task 6 replaces this with ConnectorsTab that also includes API/custom tools.
```

Remove this comment in Task 6.

**Step 7: Verify and commit**

```bash
bun run typecheck
git add apps/electron/src/renderer/components/agent-skills/AgentSkillsView.tsx \
  apps/electron/src/renderer/components/chat/ToolSelectorPopover.tsx \
  apps/electron/src/renderer/components/automation/AutomationFormView.tsx \
  apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx \
  apps/electron/src/renderer/components/app-shell/SidebarProjectsTab.tsx
git commit -m "feat(plugins): update plugin center navigation" \
  --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>"
```

---

### Task 3: Plugin overview model and Overview tab

**Files:**
- Create: `apps/electron/src/renderer/lib/plugin-overview-model.ts`
- Create: `apps/electron/src/renderer/lib/plugin-overview-model.test.ts`
- Create: `apps/electron/src/renderer/components/agent-skills/PluginOverviewTab.tsx`
- Modify: `apps/electron/src/renderer/components/agent-skills/AgentSkillsView.tsx`

**Step 1: Write the failing test**

Create `apps/electron/src/renderer/lib/plugin-overview-model.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { buildPluginOverviewModel } from './plugin-overview-model'

describe('plugin-overview-model', () => {
  test('counts enabled plugins and pending connector issues', () => {
    const overview = buildPluginOverviewModel({
      skills: [
        { slug: 'tdd', name: 'TDD', enabled: true, hasUpdate: true },
        { slug: 'pdf', name: 'PDF', enabled: false },
      ],
      expertsCount: 2,
      teamsCount: 1,
      builtinMcpServers: [
        { id: 'chrome-devtools', name: 'chrome_devtools', displayName: 'Chrome', description: '', category: 'browser', enabled: true, available: false, availabilityReason: '需要安装 Chrome', tools: [] },
        { id: 'automation', name: 'automation', displayName: '定时任务', description: '', category: 'automation', enabled: true, available: true, tools: [] },
      ],
      userMcpCount: 1,
      enabledChatToolsCount: 1,
    })

    expect(overview.summary.enabledPlugins).toBe(6)
    expect(overview.summary.connectorsNeedingAttention).toBe(1)
    expect(overview.summary.skillsWithUpdates).toBe(1)
    expect(overview.pendingItems[0]?.title).toContain('Chrome')
    expect(overview.builtinAbilities.map((item) => item.id)).toContain('automation')
    expect(overview.builtinAbilities.map((item) => item.id)).toContain('planning')
  })
})
```

**Step 2: Run it to verify failure**

```bash
bun test apps/electron/src/renderer/lib/plugin-overview-model.test.ts
```

Expected: FAIL because model does not exist.

**Step 3: Implement model**

Create `apps/electron/src/renderer/lib/plugin-overview-model.ts` with:

```ts
import type { BuiltinMcpServerSummary, SkillMeta } from '@myyoda/shared'

export interface PluginOverviewInput {
  skills: SkillMeta[]
  expertsCount: number
  teamsCount: number
  builtinMcpServers: BuiltinMcpServerSummary[]
  userMcpCount: number
  enabledChatToolsCount: number
}

export interface PluginOverviewItem {
  id: string
  title: string
  description: string
  actionTab?: 'skills' | 'connectors' | 'memory'
}

export interface PluginOverviewModel {
  summary: { enabledPlugins: number; connectorsNeedingAttention: number; skillsWithUpdates: number; builtinAbilities: number }
  pendingItems: PluginOverviewItem[]
  quickActions: PluginOverviewItem[]
  recommendations: PluginOverviewItem[]
  builtinAbilities: PluginOverviewItem[]
}

const SYSTEM_ABILITY_IDS = new Set(['automation', 'collaboration', 'create-task'])

export function buildPluginOverviewModel(input: PluginOverviewInput): PluginOverviewModel {
  const enabledSkills = input.skills.filter((skill) => skill.enabled).length
  const skillsWithUpdates = input.skills.filter((skill) => skill.hasUpdate).length
  const connectorIssues = input.builtinMcpServers.filter((server) => server.enabled && !server.available)
  const systemBuiltinServers = input.builtinMcpServers.filter((server) => SYSTEM_ABILITY_IDS.has(server.id))

  return {
    summary: {
      enabledPlugins: enabledSkills + input.expertsCount + input.teamsCount + input.userMcpCount + input.enabledChatToolsCount,
      connectorsNeedingAttention: connectorIssues.length,
      skillsWithUpdates,
      builtinAbilities: systemBuiltinServers.length + 2,
    },
    pendingItems: [
      ...connectorIssues.map((server) => ({ id: `connector:${server.id}`, title: `${server.displayName} 需要处理`, description: server.availabilityReason ?? '连接器当前不可用，请检查配置或授权。', actionTab: 'connectors' as const })),
      ...(skillsWithUpdates > 0 ? [{ id: 'skills:update', title: `${skillsWithUpdates} 个技能可更新`, description: '查看技能来源更新并决定是否同步。', actionTab: 'skills' as const }] : []),
    ],
    quickActions: [
      { id: 'new-expert', title: '新建专家', description: '创建一个新的 Agent 角色。' },
      { id: 'add-connector', title: '添加连接器', description: '连接外部系统或工具。', actionTab: 'connectors' },
      { id: 'install-skill', title: '安装技能', description: '添加可复用工作流。', actionTab: 'skills' },
      { id: 'memory', title: '整理记忆', description: '查看 Workspace 长期记忆。', actionTab: 'memory' },
    ],
    recommendations: [
      { id: 'github', title: 'GitHub 连接器', description: '研发与交付常用连接器。', actionTab: 'connectors' },
      { id: 'code-review-expert', title: '代码审查专家', description: '为代码评审任务提供稳定角色。' },
      { id: 'session-cleaner', title: 'session-cleaner', description: '清洗和整理长会话记录。', actionTab: 'skills' },
    ],
    builtinAbilities: [
      ...systemBuiltinServers.map((server) => ({ id: server.id, title: server.displayName, description: server.available ? '已启用' : (server.availabilityReason ?? '当前不可用') })),
      { id: 'managed-browser', title: '受管浏览器', description: '由 MyYoda Runtime 托管，按需对 Agent 可用。' },
      { id: 'planning', title: 'Todo / 日程', description: 'Pi Planning 工具，按任务场景对 Agent 可用。' },
    ],
  }
}
```

**Step 4: Create component**

Create `apps/electron/src/renderer/components/agent-skills/PluginOverviewTab.tsx`. Keep it small and presentational:

```tsx
import * as React from 'react'
import { ArrowRight, Blocks, CheckCircle2, Plug, Sparkles, Wrench } from 'lucide-react'
import type { PluginCenterTab } from '@/lib/plugin-center-model'
import type { PluginOverviewItem, PluginOverviewModel } from '@/lib/plugin-overview-model'

interface PluginOverviewTabProps {
  model: PluginOverviewModel
  onOpenTab: (tab: PluginCenterTab) => void
  onCreateExpert: () => void
}

export function PluginOverviewTab({ model, onOpenTab, onCreateExpert }: PluginOverviewTabProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-6">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="已启用插件" value={model.summary.enabledPlugins} icon={<CheckCircle2 size={16} />} />
        <SummaryCard label="需处理连接器" value={model.summary.connectorsNeedingAttention} icon={<Plug size={16} />} />
        <SummaryCard label="可更新技能" value={model.summary.skillsWithUpdates} icon={<Sparkles size={16} />} />
        <SummaryCard label="内置能力" value={model.summary.builtinAbilities} icon={<Wrench size={16} />} />
      </section>
      <section className="grid gap-4 lg:grid-cols-[1.25fr_0.9fr]">
        <Panel title="待处理" empty="暂无需要处理的插件。">{model.pendingItems.map((item) => <ActionRow key={item.id} item={item} onOpenTab={onOpenTab} />)}</Panel>
        <Panel title="快捷入口">{model.quickActions.map((item) => <ActionRow key={item.id} item={item} onOpenTab={item.id === 'new-expert' ? () => onCreateExpert() : onOpenTab} />)}</Panel>
      </section>
      <section className="grid gap-4 lg:grid-cols-2">
        <Panel title="推荐插件">{model.recommendations.map((item) => <ActionRow key={item.id} item={item} onOpenTab={onOpenTab} />)}</Panel>
        <Panel title="内置能力">{model.builtinAbilities.map((item) => <ActionRow key={item.id} item={item} onOpenTab={onOpenTab} />)}</Panel>
      </section>
    </div>
  )
}

function SummaryCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }): React.ReactElement {
  return <div className="rounded-2xl border border-border/60 bg-content-area p-4 shadow-sm"><div className="flex items-center justify-between text-muted-foreground"><span className="text-xs font-medium">{label}</span>{icon}</div><div className="mt-3 text-2xl font-semibold text-foreground">{value}</div></div>
}

function Panel({ title, empty, children }: { title: string; empty?: string; children: React.ReactNode }): React.ReactElement {
  const hasChildren = React.Children.count(children) > 0
  return <section className="rounded-2xl border border-border/60 bg-content-area p-4 shadow-sm"><div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground"><Blocks size={15} className="text-foreground/45" />{title}</div><div className="flex flex-col gap-2">{hasChildren ? children : <div className="rounded-xl bg-muted/45 p-3 text-sm text-muted-foreground">{empty ?? '暂无内容'}</div>}</div></section>
}

function ActionRow({ item, onOpenTab }: { item: PluginOverviewItem; onOpenTab: (tab: PluginCenterTab) => void }): React.ReactElement {
  return <button type="button" disabled={!item.actionTab} onClick={() => item.actionTab && onOpenTab(item.actionTab)} className="group flex items-center justify-between gap-3 rounded-xl bg-muted/45 px-3 py-2 text-left transition-colors enabled:hover:bg-foreground/[0.06] disabled:cursor-default"><span className="min-w-0"><span className="block truncate text-sm font-medium text-foreground/85">{item.title}</span><span className="block truncate text-xs text-muted-foreground">{item.description}</span></span>{item.actionTab && <ArrowRight size={14} className="shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />}</button>
}
```

**Step 5: Wire Overview into AgentSkillsView**

Import `buildPluginOverviewModel` and `PluginOverviewTab`, build a memoized model, then render:

```tsx
) : tab === 'overview' ? (
  <PluginOverviewTab
    model={pluginOverview}
    onOpenTab={setTab}
    onCreateExpert={() => setCreateExpertRequest((n) => n + 1)}
  />
) : tab === 'experts' ? (
```

**Step 6: Verify and commit**

```bash
bun test apps/electron/src/renderer/lib/plugin-overview-model.test.ts
bun run typecheck
git add apps/electron/src/renderer/lib/plugin-overview-model.ts \
  apps/electron/src/renderer/lib/plugin-overview-model.test.ts \
  apps/electron/src/renderer/components/agent-skills/PluginOverviewTab.tsx \
  apps/electron/src/renderer/components/agent-skills/AgentSkillsView.tsx
git commit -m "feat(plugins): add plugin overview tab" \
  --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>"
```

---

### Task 4: Connector aggregation model

**Files:**
- Create: `apps/electron/src/renderer/lib/connectors-model.ts`
- Create: `apps/electron/src/renderer/lib/connectors-model.test.ts`

**Step 1: Write the failing test**

Create `apps/electron/src/renderer/lib/connectors-model.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { buildConnectorItems, isSystemBuiltinAbility } from './connectors-model'
import type { BuiltinMcpServerSummary, ChatToolMeta, McpServerEntry } from '@myyoda/shared'

function builtin(id: string, category: BuiltinMcpServerSummary['category'], enabled = true, available = true): BuiltinMcpServerSummary {
  return { id, name: id.replaceAll('-', '_'), displayName: id, description: `${id} desc`, category, enabled, available, tools: [] }
}

describe('connectors-model', () => {
  test('excludes MyYoda runtime system abilities from connectors', () => {
    expect(isSystemBuiltinAbility('automation')).toBe(true)
    expect(isSystemBuiltinAbility('collaboration')).toBe(true)
    expect(isSystemBuiltinAbility('create-task')).toBe(true)
    expect(isSystemBuiltinAbility('chrome-devtools')).toBe(false)
  })

  test('combines builtin MCP, user MCP, API tools, and custom HTTP tools', () => {
    const userMcp: Array<[string, McpServerEntry]> = [['local-db', { type: 'stdio', command: 'sqlite-mcp', enabled: false }]]
    const chatTools = [
      { meta: { id: 'web-search', name: '联网搜索', description: 'Search', category: 'web', icon: 'Globe' } as ChatToolMeta, enabled: true, available: false },
      { meta: { id: 'custom-api', name: 'Custom API', description: 'HTTP', category: 'custom', icon: 'Wrench' } as ChatToolMeta, enabled: true, available: true },
    ]

    const items = buildConnectorItems({
      builtinServers: [builtin('automation', 'automation'), builtin('chrome-devtools', 'browser'), builtin('nano-banana', 'media', true, false)],
      userEntries: userMcp,
      chatTools,
    })

    expect(items.map((item) => item.id)).toEqual([
      'builtin:chrome-devtools',
      'builtin:nano-banana',
      'api:web-search',
      'custom:custom-api',
      'mcp:local-db',
    ])
    expect(items.find((item) => item.id === 'builtin:nano-banana')?.status).toBe('needs_config')
    expect(items.find((item) => item.id === 'mcp:local-db')?.status).toBe('disabled')
  })
})
```

**Step 2: Run it to verify failure**

```bash
bun test apps/electron/src/renderer/lib/connectors-model.test.ts
```

Expected: FAIL because model does not exist.

**Step 3: Implement connector aggregation**

Create `apps/electron/src/renderer/lib/connectors-model.ts`:

```ts
import type { BuiltinMcpServerSummary, ChatToolMeta, McpServerEntry } from '@myyoda/shared'

export type ConnectorKind = 'builtin-mcp' | 'user-mcp' | 'api-tool' | 'custom-http'
export type ConnectorStatus = 'enabled' | 'needs_config' | 'disabled'

export interface ConnectorItem {
  id: string
  kind: ConnectorKind
  sourceId: string
  name: string
  description: string
  categoryLabel: string
  enabled: boolean
  available: boolean
  status: ConnectorStatus
  statusLabel: string
  statusReason?: string
}

export interface ChatToolWithState {
  meta: ChatToolMeta
  enabled: boolean
  available: boolean
}

const SYSTEM_BUILTIN_IDS = new Set(['automation', 'collaboration', 'create-task'])

export function isSystemBuiltinAbility(id: string): boolean {
  return SYSTEM_BUILTIN_IDS.has(id)
}

function statusOf(enabled: boolean, available: boolean, reason?: string): Pick<ConnectorItem, 'status' | 'statusLabel' | 'statusReason'> {
  if (!enabled) return { status: 'disabled', statusLabel: '已关闭', statusReason: reason }
  if (!available) return { status: 'needs_config', statusLabel: '需配置', statusReason: reason }
  return { status: 'enabled', statusLabel: '已启用', statusReason: reason }
}

function categoryLabelOfBuiltin(category: BuiltinMcpServerSummary['category']): string {
  switch (category) {
    case 'browser': return '浏览器'
    case 'media': return '媒体'
    case 'memory': return '记忆'
    default: return '外部工具'
  }
}

function categoryLabelOfTool(tool: ChatToolMeta): string {
  if (tool.category === 'custom') return '自定义 HTTP'
  if (tool.id === 'web-search') return '搜索'
  if (tool.id === 'nano-banana') return '媒体'
  return tool.category ?? 'API 工具'
}

export function buildConnectorItems(input: {
  builtinServers: BuiltinMcpServerSummary[]
  userEntries: Array<[string, McpServerEntry]>
  chatTools: ChatToolWithState[]
}): ConnectorItem[] {
  const builtinItems = input.builtinServers
    .filter((server) => !isSystemBuiltinAbility(server.id))
    .map((server) => ({
      id: `builtin:${server.id}`,
      kind: 'builtin-mcp' as const,
      sourceId: server.id,
      name: server.displayName,
      description: server.description,
      categoryLabel: categoryLabelOfBuiltin(server.category),
      enabled: server.enabled,
      available: server.available,
      ...statusOf(server.enabled, server.available, server.availabilityReason),
    }))

  const apiItems = input.chatTools
    .filter((tool) => tool.meta.category !== 'custom')
    .map((tool) => ({
      id: `api:${tool.meta.id}`,
      kind: 'api-tool' as const,
      sourceId: tool.meta.id,
      name: tool.meta.name,
      description: tool.meta.description,
      categoryLabel: categoryLabelOfTool(tool.meta),
      enabled: tool.enabled,
      available: tool.available,
      ...statusOf(tool.enabled, tool.available, tool.available ? undefined : '需要配置或启用'),
    }))

  const customItems = input.chatTools
    .filter((tool) => tool.meta.category === 'custom')
    .map((tool) => ({
      id: `custom:${tool.meta.id}`,
      kind: 'custom-http' as const,
      sourceId: tool.meta.id,
      name: tool.meta.name,
      description: tool.meta.description,
      categoryLabel: '自定义 HTTP',
      enabled: tool.enabled,
      available: tool.available,
      ...statusOf(tool.enabled, tool.available),
    }))

  const userMcpItems = input.userEntries.map(([name, entry]) => ({
    id: `mcp:${name}`,
    kind: 'user-mcp' as const,
    sourceId: name,
    name,
    description: entry.type === 'stdio' ? (entry.command ?? 'stdio MCP') : (entry.url ?? '远程 MCP'),
    categoryLabel: '我的 MCP',
    enabled: entry.enabled,
    available: entry.enabled,
    ...statusOf(entry.enabled, entry.enabled, entry.enabled ? undefined : '已关闭'),
  }))

  return [...builtinItems, ...apiItems, ...customItems, ...userMcpItems]
}
```

**Step 4: Verify and commit**

```bash
bun test apps/electron/src/renderer/lib/connectors-model.test.ts
git add apps/electron/src/renderer/lib/connectors-model.ts \
  apps/electron/src/renderer/lib/connectors-model.test.ts
git commit -m "feat(connectors): add connector aggregation model" \
  --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>"
```

---

### Task 5: Connector card and detail dialog

**Files:**
- Create: `apps/electron/src/renderer/components/agent-skills/ConnectorCard.tsx`
- Create: `apps/electron/src/renderer/components/agent-skills/ConnectorDetailDialog.tsx`
- Modify: `apps/electron/src/renderer/components/settings/ToolSettings.tsx`

**Step 1: Export reusable tool settings sections**

In `ToolSettings.tsx`, export:

```ts
export function WebSearchSettings(): React.ReactElement
export function NanoBananaSettings(): React.ReactElement
export function CustomToolsSection(): React.ReactElement | null
```

Keep behavior unchanged.

**Step 2: Create ConnectorCard**

Create `ConnectorCard.tsx`:

```tsx
import * as React from 'react'
import { CheckCircle2, Plug, XCircle } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import type { ConnectorItem } from '@/lib/connectors-model'

interface ConnectorCardProps {
  item: ConnectorItem
  onOpen: () => void
  onToggle?: (enabled: boolean) => void
}

export function ConnectorCard({ item, onOpen, onToggle }: ConnectorCardProps): React.ReactElement {
  return (
    <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }} className={cn('group flex h-full cursor-pointer flex-col gap-3 rounded-2xl border border-border/60 bg-content-area p-4 text-left shadow-sm transition-[border-color,box-shadow,transform,background-color] duration-fast hover:-translate-y-0.5 hover:border-border hover:shadow-md focus:outline-none focus-visible:ring-1 focus-visible:ring-ring', item.status === 'disabled' && 'opacity-60')}>
      <div className="flex items-start gap-3">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-blue-500/12 text-blue-500 shadow-sm"><Plug size={20} /></div>
        <div className="min-w-0 flex-1"><div className="line-clamp-1 text-sm font-semibold text-foreground">{item.name}</div><div className="mt-0.5 text-[11px] font-medium text-muted-foreground">{item.categoryLabel}</div></div>
        {onToggle && <Switch checked={item.enabled} onCheckedChange={onToggle} onClick={(e) => e.stopPropagation()} className="shrink-0" />}
      </div>
      <p className="line-clamp-2 min-h-[36px] text-xs leading-relaxed text-muted-foreground">{item.description}</p>
      <div className="mt-auto flex items-center justify-between gap-2">
        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{item.kind}</span>
        <span className={cn('flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium', item.status === 'enabled' && 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400', item.status === 'needs_config' && 'bg-amber-500/10 text-amber-600 dark:text-amber-400', item.status === 'disabled' && 'bg-muted text-muted-foreground')}>
          {item.status === 'enabled' ? <CheckCircle2 size={12} /> : <XCircle size={12} />}{item.statusLabel}
        </span>
      </div>
    </div>
  )
}
```

**Step 3: Create ConnectorDetailDialog**

Create `ConnectorDetailDialog.tsx`:

```tsx
import * as React from 'react'
import { Plug } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { ConnectorItem } from '@/lib/connectors-model'
import { NanoBananaSettings, WebSearchSettings } from '@/components/settings/ToolSettings'

interface ConnectorDetailDialogProps {
  item: ConnectorItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
  body?: React.ReactNode
}

export function ConnectorDetailDialog({ item, open, onOpenChange, body }: ConnectorDetailDialogProps): React.ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[82vh] max-w-3xl overflow-y-auto p-0">
        <div className="border-b border-border/60 px-6 pb-4 pt-5">
          <div className="flex items-start gap-3">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-blue-500/12 text-blue-500 shadow-sm"><Plug size={20} /></div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-lg font-semibold">{item?.name ?? '连接器详情'}</DialogTitle>
              <DialogDescription className="mt-1 leading-relaxed">{item?.description ?? '查看连接器能力、配置、状态和权限范围。'}</DialogDescription>
              {item && <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground"><span className="rounded-md bg-muted px-1.5 py-0.5">{item.kind}</span><span className="rounded-md bg-muted px-1.5 py-0.5">{item.categoryLabel}</span><span className="rounded-md bg-muted px-1.5 py-0.5">{item.statusLabel}</span></div>}
            </div>
          </div>
        </div>
        <div className="p-6">{body ?? <DefaultBody item={item} />}</div>
        <div className="flex justify-end border-t border-border/60 px-6 py-4"><Button variant="outline" onClick={() => onOpenChange(false)}>继续浏览</Button></div>
      </DialogContent>
    </Dialog>
  )
}

function DefaultBody({ item }: { item: ConnectorItem | null }): React.ReactElement {
  if (!item) return <div className="text-sm text-muted-foreground">未选择连接器。</div>
  if (item.sourceId === 'web-search') return <WebSearchSettings />
  if (item.sourceId === 'nano-banana') return <NanoBananaSettings />
  return <div className="space-y-4 text-sm text-muted-foreground"><p>{item.statusReason ?? '该连接器由插件中心管理。'}</p><p>启用后，Agent 可能在任务中调用此能力。高风险写操作仍会在运行时请求确认。</p></div>
}
```

**Step 4: Verify and commit**

```bash
bun run typecheck
git add apps/electron/src/renderer/components/agent-skills/ConnectorCard.tsx \
  apps/electron/src/renderer/components/agent-skills/ConnectorDetailDialog.tsx \
  apps/electron/src/renderer/components/settings/ToolSettings.tsx
git commit -m "feat(connectors): add connector card and detail dialog" \
  --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>"
```

---

### Task 6: Replace MCP/API content with ConnectorsTab

**Files:**
- Create: `apps/electron/src/renderer/components/agent-skills/ConnectorsTab.tsx`
- Modify: `apps/electron/src/renderer/components/agent-skills/AgentSkillsView.tsx`

**Step 1: Create ConnectorsTab**

Create `ConnectorsTab.tsx`:

```tsx
import * as React from 'react'
import { Plus, Search } from 'lucide-react'
import { toast } from 'sonner'
import { useAtomValue, useSetAtom } from 'jotai'
import { chatToolsAtom } from '@/atoms/chat-tool-atoms'
import { buildConnectorItems, type ConnectorItem } from '@/lib/connectors-model'
import type { BuiltinMcpServerSummary, McpServerEntry } from '@myyoda/shared'
import { ConnectorCard } from './ConnectorCard'
import { ConnectorDetailDialog } from './ConnectorDetailDialog'

interface ConnectorsTabProps {
  builtinServers: BuiltinMcpServerSummary[]
  userEntries: Array<[string, McpServerEntry]>
  query: string
  onAddMcp: () => void
  onOpenMcp: (name: string, entry: McpServerEntry) => void
  onToggleBuiltin: (id: string, enabled: boolean) => Promise<void> | void
  onToggleMcp: (name: string, enabled: boolean) => Promise<void> | void
}

export function ConnectorsTab({ builtinServers, userEntries, query, onAddMcp, onOpenMcp, onToggleBuiltin, onToggleMcp }: ConnectorsTabProps): React.ReactElement {
  const chatTools = useAtomValue(chatToolsAtom)
  const setChatTools = useSetAtom(chatToolsAtom)
  const [selected, setSelected] = React.useState<ConnectorItem | null>(null)
  const items = React.useMemo(() => buildConnectorItems({ builtinServers, userEntries, chatTools }), [builtinServers, chatTools, userEntries])
  const q = query.trim().toLowerCase()
  const filtered = React.useMemo(() => items.filter((item) => !q || item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q) || item.categoryLabel.toLowerCase().includes(q)), [items, q])

  const toggle = React.useCallback(async (item: ConnectorItem, enabled: boolean) => {
    try {
      if (item.kind === 'builtin-mcp') return await onToggleBuiltin(item.sourceId, enabled)
      if (item.kind === 'user-mcp') return await onToggleMcp(item.sourceId, enabled)
      await window.electronAPI.updateChatToolState(item.sourceId, { enabled })
      setChatTools(await window.electronAPI.getChatTools())
    } catch (error) {
      console.error('[连接器] 切换状态失败:', error)
      toast.error('切换连接器状态失败')
    }
  }, [onToggleBuiltin, onToggleMcp, setChatTools])

  if (items.length === 0) return <EmptyConnectors onAddMcp={onAddMcp} />
  if (filtered.length === 0) return <EmptySearch />

  return <>
    <div className="mb-4 flex items-center justify-between gap-3"><div className="text-sm text-muted-foreground">统一管理 MCP、API Key 工具、自定义 HTTP 工具与外部接入。</div><button type="button" onClick={onAddMcp} className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"><Plus size={14} /><span>添加 MCP</span></button></div>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{filtered.map((item) => <ConnectorCard key={item.id} item={item} onOpen={() => { if (item.kind === 'user-mcp') { const entry = userEntries.find(([name]) => name === item.sourceId)?.[1]; if (entry) onOpenMcp(item.sourceId, entry); return } setSelected(item) }} onToggle={(enabled) => void toggle(item, enabled)} />)}</div>
    <ConnectorDetailDialog open={!!selected} item={selected} onOpenChange={(open) => { if (!open) setSelected(null) }} />
  </>
}

function EmptyConnectors({ onAddMcp }: { onAddMcp: () => void }): React.ReactElement {
  return <div className="mx-auto flex max-w-md flex-col items-center gap-4 pt-24 text-center"><div className="flex size-16 items-center justify-center rounded-2xl bg-foreground/[0.04]"><Plus className="size-8 text-foreground/30" /></div><div className="text-[15px] font-medium text-foreground/85">暂无连接器</div><p className="text-[13px] leading-relaxed text-foreground/50">点击下方按钮添加 MCP，或从后续推荐入口添加外部工具接入。</p><button type="button" onClick={onAddMcp} className="rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90">添加 MCP</button></div>
}

function EmptySearch(): React.ReactElement {
  return <div className="mx-auto flex max-w-md flex-col items-center gap-4 pt-24 text-center"><div className="flex size-16 items-center justify-center rounded-2xl bg-foreground/[0.04]"><Search className="size-8 text-foreground/30" /></div><div className="text-[15px] font-medium text-foreground/85">没有匹配的连接器</div><p className="text-[13px] leading-relaxed text-foreground/50">试试更换搜索关键词。</p></div>
}
```

**Step 2: Wire into AgentSkillsView**

Import `ConnectorsTab`, then replace temporary `McpTab` branch with:

```tsx
) : tab === 'connectors' ? (
  <ConnectorsTab
    builtinServers={builtinMcpServers}
    userEntries={userMcpEntries}
    query={search}
    onOpenMcp={(name, entry) => { setEditingMcp({ name, entry }); setMcpSheetOpen(true) }}
    onToggleBuiltin={data.toggleBuiltinMcp}
    onToggleMcp={data.toggleMcp}
    onAddMcp={() => { setEditingMcp(null); setMcpSheetOpen(true) }}
  />
```

Remove the obsolete `api` branch and `EnhancedToolsPanel` import. If `McpTab`, `McpSection`, or `getBuiltinMcpStatus` become unused, delete them.

**Step 3: Verify and commit**

```bash
bun test apps/electron/src/renderer/lib/connectors-model.test.ts
bun run typecheck
git add apps/electron/src/renderer/components/agent-skills/ConnectorsTab.tsx \
  apps/electron/src/renderer/components/agent-skills/AgentSkillsView.tsx
git commit -m "feat(connectors): merge mcp and api into connectors tab" \
  --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>"
```

---

### Task 7: Scope selector and Project override visibility

**Files:**
- Create: `apps/electron/src/renderer/lib/plugin-scope-model.ts`
- Create: `apps/electron/src/renderer/lib/plugin-scope-model.test.ts`
- Create: `apps/electron/src/renderer/components/agent-skills/PluginScopeSelector.tsx`
- Modify: `apps/electron/src/renderer/components/agent-skills/AgentSkillsView.tsx`

**Step 1: Write failing test**

Create `apps/electron/src/renderer/lib/plugin-scope-model.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { buildPluginScopeOptions, describePluginScope } from './plugin-scope-model'

describe('plugin-scope-model', () => {
  const projects = [
    { id: 'p1', name: 'App', workspaceId: 'ws-a' },
    { id: 'p2', name: 'Hidden', workspaceId: 'ws-a', kind: 'home' as const },
    { id: 'p3', name: 'Other', workspaceId: 'ws-b' },
  ]

  test('builds workspace default plus visible project options', () => {
    const options = buildPluginScopeOptions({ currentWorkspaceId: 'ws-a', projects })
    expect(options.map((option) => option.id)).toEqual(['workspace', 'project:p1'])
    expect(options[0]?.label).toBe('全部项目共享')
  })

  test('describes workspace and project scopes', () => {
    expect(describePluginScope({ kind: 'workspace' })).toContain('Workspace 默认')
    expect(describePluginScope({ kind: 'project', projectId: 'p1', projectName: 'App', inheritsWorkspaceDefault: true })).toContain('沿用 Workspace 默认')
  })
})
```

**Step 2: Implement model**

Create `plugin-scope-model.ts`:

```ts
import type { KanbanProject } from '@/components/app-shell/kanban/types'
import { filterPickableKanbanProjects } from '@/components/app-shell/kanban/types'

export type PluginScope = { kind: 'workspace' } | { kind: 'project'; projectId: string; projectName: string; inheritsWorkspaceDefault?: boolean }

export interface PluginScopeOption {
  id: string
  label: string
  description: string
  scope: PluginScope
}

export function buildPluginScopeOptions(input: { currentWorkspaceId: string | null | undefined; projects: KanbanProject[] }): PluginScopeOption[] {
  const options: PluginScopeOption[] = [{ id: 'workspace', label: '全部项目共享', description: '修改当前 Workspace 的默认插件集合。', scope: { kind: 'workspace' } }]
  if (!input.currentWorkspaceId) return options
  for (const project of filterPickableKanbanProjects(input.projects).filter((p) => p.workspaceId === input.currentWorkspaceId)) {
    options.push({ id: `project:${project.id}`, label: project.name, description: '修改该 Project 的独立插件配置，或继续沿用 Workspace 默认。', scope: { kind: 'project', projectId: project.id, projectName: project.name, inheritsWorkspaceDefault: true } })
  }
  return options
}

export function describePluginScope(scope: PluginScope): string {
  if (scope.kind === 'workspace') return '正在编辑 Workspace 默认插件集合。'
  if (scope.inheritsWorkspaceDefault) return `Project「${scope.projectName}」当前沿用 Workspace 默认插件集合。`
  return `正在编辑 Project「${scope.projectName}」的独立插件集合。`
}
```

**Step 3: Create selector component**

Create `PluginScopeSelector.tsx`:

```tsx
import * as React from 'react'
import { ChevronDown, FolderOpen } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { describePluginScope, type PluginScope, type PluginScopeOption } from '@/lib/plugin-scope-model'

interface PluginScopeSelectorProps {
  scope: PluginScope
  options: PluginScopeOption[]
  onChange: (scope: PluginScope) => void
}

export function PluginScopeSelector({ scope, options, onChange }: PluginScopeSelectorProps): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const currentLabel = scope.kind === 'workspace' ? '全部项目共享' : scope.projectName
  return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><button type="button" className="titlebar-no-drag flex items-center gap-2 rounded-lg border border-border/60 bg-content-area px-3 py-1.5 text-[13px] font-medium text-foreground/80 transition-colors hover:bg-foreground/[0.04]"><FolderOpen size={14} className="text-foreground/45" /><span className="max-w-[180px] truncate">{currentLabel}</span><ChevronDown size={14} className="text-foreground/45" /></button></PopoverTrigger><PopoverContent align="end" className="w-80 p-1"><div className="px-2 py-1.5 text-[11px] font-medium text-muted-foreground/70">插件作用域</div>{options.map((option) => { const selected = option.scope.kind === scope.kind && (option.scope.kind === 'workspace' || option.scope.projectId === (scope.kind === 'project' ? scope.projectId : undefined)); return <button key={option.id} type="button" onClick={() => { onChange(option.scope); setOpen(false) }} className={cn('flex w-full flex-col gap-0.5 rounded-md px-2 py-2 text-left text-[13px] transition-colors', selected ? 'bg-accent text-accent-foreground' : 'text-foreground/80 hover:bg-accent/50')}><span className="font-medium">{option.label}</span><span className="text-[11px] text-muted-foreground">{option.description}</span></button> })}<div className="border-t border-border/60 px-2 py-2 text-[11px] leading-relaxed text-muted-foreground">{describePluginScope(scope)}</div></PopoverContent></Popover>
}
```

**Step 4: Wire into AgentSkillsView**

- Import `serverKanbanProjectsAtom`, `buildPluginScopeOptions`, `PluginScopeSelector`, and type `PluginScope`.
- Replace `useAgentSkillsData(null)` with state-driven scope:

```ts
const kanbanProjects = useAtomValue(serverKanbanProjectsAtom)
const [pluginScope, setPluginScope] = React.useState<PluginScope>({ kind: 'workspace' })
const scopeProjectId = pluginScope.kind === 'project' ? pluginScope.projectId : null
const data = useAgentSkillsData(scopeProjectId)
const pluginScopeOptions = React.useMemo(() => buildPluginScopeOptions({ currentWorkspaceId, projects: kanbanProjects }), [currentWorkspaceId, kanbanProjects])
```

Render `PluginScopeSelector` in the title bar near the workspace switcher. Keep Workspace switching separate from plugin scope selection.

When `pluginScope.kind === 'project'`, render a small notice above Tab content:

```tsx
<div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-[13px] text-amber-700 dark:text-amber-300">
  Project「{pluginScope.projectName}」可使用独立插件配置；未配置的技能或连接器会按现有规则沿用 Workspace 默认。
</div>
```

**Step 5: Verify and commit**

```bash
bun test apps/electron/src/renderer/lib/plugin-scope-model.test.ts
bun run typecheck
git add apps/electron/src/renderer/lib/plugin-scope-model.ts \
  apps/electron/src/renderer/lib/plugin-scope-model.test.ts \
  apps/electron/src/renderer/components/agent-skills/PluginScopeSelector.tsx \
  apps/electron/src/renderer/components/agent-skills/AgentSkillsView.tsx
git commit -m "feat(plugins): expose workspace and project plugin scopes" \
  --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>"
```

---

### Task 8: Effective plugin profile for runtime injection

**Files:**
- Create: `apps/electron/src/main/lib/agent-plugin-profile.ts`
- Create: `apps/electron/src/main/lib/agent-plugin-profile.test.ts`
- Modify: `apps/electron/src/main/lib/agent-orchestrator.ts`

**Step 1: Write failing tests**

Create `apps/electron/src/main/lib/agent-plugin-profile.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { resolveEffectivePluginScope } from './agent-plugin-profile'

describe('agent-plugin-profile', () => {
  test('uses workspace scope when no project is bound', () => {
    expect(resolveEffectivePluginScope({ workspaceSlug: 'default', projectId: undefined, hasProjectMcp: false, hasProjectSkills: false })).toEqual({
      workspaceSlug: 'default',
      projectId: undefined,
      mcpScope: 'workspace',
      skillsScope: 'workspace',
    })
  })

  test('uses project scope only for configured dimensions', () => {
    expect(resolveEffectivePluginScope({ workspaceSlug: 'default', projectId: 'p1', hasProjectMcp: true, hasProjectSkills: false })).toEqual({
      workspaceSlug: 'default',
      projectId: 'p1',
      mcpScope: 'project',
      skillsScope: 'workspace',
    })
  })
})
```

**Step 2: Run it to verify failure**

```bash
bun test apps/electron/src/main/lib/agent-plugin-profile.test.ts
```

Expected: FAIL because file does not exist.

**Step 3: Implement pure resolver**

Create `apps/electron/src/main/lib/agent-plugin-profile.ts`:

```ts
export interface EffectivePluginScopeInput {
  workspaceSlug: string | undefined
  projectId: string | undefined
  hasProjectMcp: boolean
  hasProjectSkills: boolean
}

export interface EffectivePluginScope {
  workspaceSlug: string | undefined
  projectId: string | undefined
  mcpScope: 'workspace' | 'project'
  skillsScope: 'workspace' | 'project'
}

export function resolveEffectivePluginScope(input: EffectivePluginScopeInput): EffectivePluginScope {
  return {
    workspaceSlug: input.workspaceSlug,
    projectId: input.projectId,
    mcpScope: input.projectId && input.hasProjectMcp ? 'project' : 'workspace',
    skillsScope: input.projectId && input.hasProjectSkills ? 'project' : 'workspace',
  }
}
```

**Step 4: Use resolver in agent-orchestrator**

In `apps/electron/src/main/lib/agent-orchestrator.ts`, import:

```ts
import { resolveEffectivePluginScope } from './agent-plugin-profile'
```

Near the existing MCP/Skills resolution around `buildMcpServers` and `effectiveSkillsDir`, compute:

```ts
const effectivePluginScope = resolveEffectivePluginScope({
  workspaceSlug,
  projectId: sessionMeta?.projectId,
  hasProjectMcp: !!(workspaceSlug && sessionMeta?.projectId && hasProjectMcpServers(workspaceSlug, sessionMeta.projectId)),
  hasProjectSkills: !!(workspaceSlug && sessionMeta?.projectId && hasProjectSkills(workspaceSlug, sessionMeta.projectId)),
})
```

Replace inline `effectiveSkillsDir` condition with:

```ts
const effectiveSkillsDir = workspaceSlug
  ? effectivePluginScope.skillsScope === 'project' && sessionMeta?.projectId
    ? getProjectSkillsDir(workspaceSlug, sessionMeta.projectId)
    : getWorkspaceSkillsDir(workspaceSlug)
  : undefined
```

Keep `this.buildMcpServers(workspaceSlug, sessionMeta?.projectId)` unchanged unless you also update it to accept `effectivePluginScope`. Do not change runtime MCP behavior in this task; the goal is to make the rule explicit and testable.

**Step 5: Verify and commit**

```bash
bun test apps/electron/src/main/lib/agent-plugin-profile.test.ts
bun run typecheck
git add apps/electron/src/main/lib/agent-plugin-profile.ts \
  apps/electron/src/main/lib/agent-plugin-profile.test.ts \
  apps/electron/src/main/lib/agent-orchestrator.ts
git commit -m "refactor(agent): extract effective plugin profile resolution" \
  --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>"
```

---

### Task 9: Documentation updates

**Files:**
- Modify: `README.md`
- Modify: `README.en.md`
- Modify: `apps/electron/resources/tutorial.md`
- Modify: `apps/electron/src/renderer/components/faq/faq-content.ts`

**Step 1: Update README.md**

Replace user-facing descriptions of the old plugin center shape with:

```text
插件中心：总览、专家、专家团、技能、连接器、记忆。
```

Add or update bullets:

```markdown
- **插件中心**：以“万物即插件”为心智，统一管理专家、专家团、技能、连接器与记忆；
- **连接器**：统一管理 MCP、API Key 工具、自定义 HTTP 工具与外部系统接入；
```

Keep low-level MCP mentions in advanced/developer sections.

**Step 2: Update README.en.md**

Use:

```markdown
- **Plugin Center**: a unified place for Overview, Experts, Expert Teams, Skills, Connectors, and Memory.
- **Connectors**: user-facing external integrations that can be backed by MCP, API-key tools, custom HTTP tools, or CLI integrations.
```

**Step 3: Update tutorial.md**

In `apps/electron/resources/tutorial.md`, update section 11 title:

```markdown
## 11. Yoda 插件：总览、专家、技能、连接器与记忆
```

Update the tab description:

```text
总览 / 专家 / 专家团 / 技能 / 连接器 / 记忆
```

Replace separate MCP/API user-facing subsections with `### 连接器`, explaining that MCP、API Key 工具、自定义 HTTP 工具、CLI 连接器 are shown together.

Add note:

```text
Brave Search MCP 与 Tavily 联网搜索都属于连接器，但凭据不能混用。
```

**Step 4: Update faq-content.ts**

Add/update FAQ entries:

```ts
{
  question: '插件中心里的连接器和 MCP/API 是什么关系？',
  answer: '连接器是面向用户的外部系统/工具接入入口。底层可能是 MCP Server、API Key 工具、自定义 HTTP 工具或 CLI。普通用户只需要在「插件 → 连接器」里配置和启用；高级用户仍可在详情里看到底层类型。',
}
```

```ts
{
  question: '为什么某个 Project 看不到 Workspace 默认插件？',
  answer: '插件中心支持 Workspace 默认与 Project 覆盖。若 Project 已经转为独立插件配置，它不会继续自动跟随 Workspace 默认。请检查插件中心顶部的作用域选择器。',
}
```

**Step 5: Grep stale wording**

```bash
grep -R "MCP / API\|MCP/API\|Skills / MCP / API / Memory" \
  README.md README.en.md apps/electron/resources/tutorial.md \
  apps/electron/src/renderer/components/faq/faq-content.ts || true
```

Expected: no stale user-facing plugin center phrasing remains. Low-level MCP references may still appear when explicitly about MCP config.

**Step 6: Verify and commit**

```bash
bun run typecheck
git add README.md README.en.md apps/electron/resources/tutorial.md \
  apps/electron/src/renderer/components/faq/faq-content.ts
git commit -m "docs(plugins): document plugin center v1" \
  --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>"
```

---

### Task 10: Final verification and cleanup

**Files:**
- Modify only files needed for fixes found by verification.

**Step 1: Run targeted tests**

```bash
bun test apps/electron/src/renderer/lib/plugin-center-model.test.ts \
  apps/electron/src/renderer/lib/plugin-overview-model.test.ts \
  apps/electron/src/renderer/lib/connectors-model.test.ts \
  apps/electron/src/renderer/lib/plugin-scope-model.test.ts \
  apps/electron/src/main/lib/agent-plugin-profile.test.ts
```

Expected: all PASS.

**Step 2: Run full typecheck**

```bash
bun run typecheck
```

Expected: PASS.

**Step 3: Run full test suite**

```bash
bun test --timeout=15000
```

Expected: PASS. If unrelated known flaky tests fail, capture names and rerun once before changing code.

**Step 4: Build renderer**

```bash
cd apps/electron && bun run build:renderer
```

Expected: Vite build succeeds.

If time allows, also run:

```bash
bun run electron:build
```

Expected: all Electron build steps succeed.

**Step 5: Manual smoke checklist**

Run dev app if practical:

```bash
bun run dev
```

Check:

- Left sidebar “插件” opens plugin center.
- Default tab is “总览”.
- Tab order is `总览 / 专家 / 专家团 / 技能 / 连接器 / 记忆`.
- Tool selector settings opens `插件 → 连接器`.
- Automation missing workspace link opens `插件 → 连接器`.
- Existing MCP cards appear in “连接器”.
- Tavily/Nano Banana/custom HTTP tools appear in “连接器”.
- System abilities such as 定时任务/协作子 Agent show in 总览, not as connector cards.
- Project scope selector does not affect Workspace switching.

**Step 6: Apply @verification-before-completion discipline**

Before claiming completion, cite exact command outputs from Steps 1–4.

**Step 7: Final cleanup commit if verification required fixes**

```bash
git add <fixed-files>
git commit -m "fix(plugins): address plugin center verification issues" \
  --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>"
```

If no fixes were needed, no final commit is required.

---

## Implementation notes and risk areas

- `AgentSkillsView.tsx` is already large. Keep new pure logic in `renderer/lib/*-model.ts` and presentational blocks in small components.
- `ToolSettings.tsx` was originally a settings page. Exporting individual sections is acceptable for v1, but avoid pushing connector model logic back into settings.
- `useAgentSkillsData(projectId)` already supports Project Skills/MCP scope. The UI should expose this carefully rather than inventing a new storage path.
- Main runtime already falls back from Project to Workspace for MCP and Skills. Task 8 makes this rule explicit and testable; do not change behavior unless tests prove existing behavior contradicts the approved spec.
- Keep user-facing text in Chinese. Keep technical terms such as MCP/API/CLI in details and docs where useful.
- Do not delete PR #105 artifacts or branches in this implementation; it remains reference material.
