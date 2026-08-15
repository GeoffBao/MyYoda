# 统一搜索升级（P0）实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把「Yoda 搜索」从仅会话（Chat/Agent 标题+正文）升级为统一混合流搜索：会话、定时任务、Todo、项目、看板任务五类 + 类型筛选 chip + 搜索历史 + 防抖即时搜索 + Agent 兜底扩展。

**Architecture:** Provider 模式——每类数据源一个纯函数 provider（同步内存匹配，统一复用 `findBestSearchMatch` 评分），`unified-search-model.ts` 负责编排/排序/截断/chip 过滤；跳转副作用集中在 `search-navigation.ts` 的 `executeNavigation(target)`（可序列化 target 描述符，对齐 Kanban 已有 `TaskEditorTarget` 模式）；会话正文全文搜索保持现有异步 IPC 不变，作为标题结果的附加段。

**Tech Stack:** React 18 + Jotai + TypeScript（strict）+ Bun test + Tailwind；匹配复用 `@myyoda/shared` 的 `findBestSearchMatch`。

**设计文档（必读）**：`docs/superpowers/specs/2026-08-15-search-upgrade-design.md`

---

## 零、执行前必读（零上下文说明）

1. **现状**：搜索 UI 在 `apps/electron/src/renderer/components/app-shell/YodaSearchView.tsx`（~540 行）。现状 = 标题匹配（`findBestSearchMatch`，前端过滤）+ 消息内容全文（`window.electronAPI.searchConversationMessages` / `searchAgentSessionMessages` 异步 IPC）+「Agent 搜索」兜底（创建 Agent 会话塞 prompt）。触发 = 点击/回车手动搜索。
2. **评审已定的 8 项约束**（不要推翻）：
   - 结果 = 混合流 + 类型筛选 chip（Raycast 风格）；chip 仅显示当前结果集里出现的类型
   - 新类型只做标题/名称匹配；正文语义搜索交给 Agent 兜底
   - Todo/日程搜索**跨全部工作区**，结果行带工作区标签；不跟随 planning 的工作区开关
   - provider 返回**可序列化 `target` 描述符**，不做 `onSelect` 闭包
   - 排序 = `matchScore`（主）+ 按时间距离映射的 0~1 新鲜度（次）；距离用 `Math.abs(now - sortKey)` 归一，一年线性衰减
   - 即时搜索：query ≥ 2 字符后 200ms 防抖自动触发；composition 中不触发（沿用 `isComposingRef`）
   - 结果行 subtitle 显式带类型名（如「定时任务 · 每天 09:00 运行周报」）
   - P0 不新增任何定位 atom；社区讨论缓存提示是 P1 的事（P0 无发现类型）
3. **同步/异步约定**：P0 的 5 个 provider 全是**同步纯函数**；会话**正文全文 IPC 保持异步**、仍在 view 层调用（不硬塞进纯函数 provider），结果作为「内容匹配」附加段排在标题混合流之后（保持现有体验）。这是对设计文档「IPC 收纳进 session-provider」的落地微调——标题进 provider，IPC 留在 view 层。
4. **字段核实纪律**：本计划的 provider 代码引用字段时以「Read 类型定义确认」步骤为前置（`packages/shared/src/types/`、`apps/electron/src/renderer/components/app-shell/kanban/types.ts`）。禁止凭记忆编字段。
5. **工作区**：在独立 worktree 执行：`.worktrees/search-unified-p0/`（`.gitignore` 已忽略 `.worktrees`）。执行会话从 main 建分支 `feature/search-unified-p0`。
6. **验证命令**（每次改动后跑）：
   - 类型检查：`cd /Users/admin/Workspace/ClaudeCode/LuxAgents/apps/electron && bun run typecheck`
   - 测试：`cd /Users/admin/Workspace/ClaudeCode/LuxAgents && bun test`（全量 ~1600 条，10s）
   - 提交格式：中文 subject + `Co-Authored-By: MyYoda <MyYoda@noreply.github.com>` trailer

---

## Task 0: 看板任务数据覆盖验证（实施前置）

**Files:**
- Read: `apps/electron/src/renderer/atoms/kanban-atoms.ts`
- Read: `apps/electron/src/renderer/components/app-shell/kanban/types.ts`（`KanbanProject` / `KanbanItem` / `TaskAggregateSummary`）
- Read: `packages/shared/src/types/planning.ts`（`Todo`）、`packages/shared/src/types/automation.ts`（`Automation`）、`packages/shared/src/types/agent.ts`（`AgentWorkspace`）

**Step 1: 确认看板搜索源**

`kanbanItemsAtom` 是 `taskBoardScopeAtom` 过滤后的派生 atom，**不可用于搜索**。执行：

```bash
cd /Users/admin/Workspace/ClaudeCode/LuxAgents && grep -n "tasks\b\|interface KanbanProject" apps/electron/src/renderer/components/app-shell/kanban/types.ts | head -20
```

判定：
- 若 `KanbanProject` 带 `tasks` 数组且 `serverKanbanProjectsAtom` 全量加载 → 搜索源 = `serverKanbanProjectsAtom.flatMap(p => p.tasks)`，任务行 subtitle 带项目名。
- 若只有 `serverTaskSummariesAtom: TaskAggregateSummary[]` 全量 → 用该 atom，并核对 `TaskAggregateSummary` 是否含标题字段。
- 若两者都非全量 → 记录边界，P0 搜索源改为「已加载任务」，在本计划文件补一行说明。

**Step 2: 记录结论**

在 `apps/electron/src/renderer/components/app-shell/search/README.md`（本计划将创建）写入选定的数据源 + 字段名清单（Automation/Todo/AgentWorkspace/Kanban 的标题/时间字段），后续 provider 全部以此为准。

**Step 3: Commit**

```bash
git add apps/electron/src/renderer/components/app-shell/search/README.md && git commit -m "docs(search): 记录统一搜索数据源字段核查结论"
```

---

## Task 1: 基础类型与 chip 定义

**Files:**
- Create: `apps/electron/src/renderer/components/app-shell/search/unified-search-types.ts`
- Create: `apps/electron/src/renderer/components/app-shell/search/README.md`（Task 0 已建则跳过创建，直接追加）

**Step 1: 写入类型文件**

```ts
import type { LucideIcon } from 'lucide-react'
import type { TaskEditorTarget } from '@/components/app-shell/kanban/types'

/** 11 种结果类型（P0 实现前 5 种，P1 补 skill/mcp/calendar/discover） */
export type SearchResultType =
  | 'session-chat' | 'session-agent'
  | 'automation' | 'todo' | 'calendar'
  | 'skill' | 'mcp'
  | 'kanban-task' | 'project'
  | 'discover-official' | 'discover-discussion'

/** chip 聚合键：11 种类型收敛成 7 个 chip */
export type SearchChipKey = 'all' | 'session' | 'automation' | 'planning' | 'project' | 'skills' | 'discover'

export interface SearchChip {
  key: SearchChipKey
  label: string
  /** 该 chip 覆盖的结果类型集合 */
  types: SearchResultType[]
}

/** 固定 chip 定义；渲染时只显示当前结果集里出现过的 chip（all 除外） */
export const SEARCH_CHIPS: SearchChip[] = [
  { key: 'all', label: '全部', types: [] },
  { key: 'session', label: '会话', types: ['session-chat', 'session-agent'] },
  { key: 'automation', label: '定时任务', types: ['automation'] },
  { key: 'planning', label: '计划', types: ['todo', 'calendar'] },
  { key: 'project', label: '项目', types: ['project', 'kanban-task'] },
  { key: 'skills', label: '插件', types: ['skill', 'mcp'] },
  { key: 'discover', label: '发现', types: ['discover-official', 'discover-discussion'] },
]

export function resultTypeToChipKey(type: SearchResultType): SearchChipKey {
  const chip = SEARCH_CHIPS.find((c) => c.types.includes(type))
  return chip?.key ?? 'all'
}

export function chipKeyToTypes(key: SearchChipKey): SearchResultType[] {
  if (key === 'all') return []
  return SEARCH_CHIPS.find((c) => c.key === key)?.types ?? []
}

/** 跳转目标描述符：provider 只产出数据，跳转副作用由 search-navigation.ts 集中路由 */
export type SearchNavigationTarget =
  | { kind: 'session'; mode: 'chat' | 'agent'; id: string; title: string }
  | { kind: 'automation'; id: string }
  | { kind: 'todo'; id: string }
  | { kind: 'calendar'; id: string }
  | { kind: 'skill'; slug: string }
  | { kind: 'mcp' }
  | { kind: 'kanban-task'; target: TaskEditorTarget }
  | { kind: 'project'; workspaceId: string }
  | { kind: 'discover-official'; itemId: string }
  | { kind: 'discover-discussion'; discussionNumber: number }

export interface UnifiedSearchResult {
  id: string
  type: SearchResultType
  title: string
  /** 次要信息；约定以类型名开头（如「定时任务 · 每天 09:00」）提高混合流可扫性 */
  subtitle?: string
  matchStart: number
  matchLength: number
  /** findBestSearchMatch().score（exact=1000 / fragment=700~900 / fuzzy 更低） */
  matchScore: number
  /** 排序用时间戳 ms；来源见设计文档第五节 sortKey 表 */
  sortKey: number
  /** 仅 session 类型可能为 true；行上渲染置顶小图标 */
  pinned?: boolean
  /** 归档/已完成视觉降权，不隐藏 */
  archived?: boolean
  /** 跨工作区结果的工作区名标签（Todo/日程/会话共用） */
  workspaceName?: string
  target: SearchNavigationTarget
  /** 类型图标；由 view 层的类型→图标映射表提供，不随 provider 变化 */
  icon?: LucideIcon
}

/** view 层类型→图标映射的查询函数签名（实现放在 YodaSearchView） */
export type ResultIconResolver = (type: SearchResultType) => LucideIcon
```

**Step 2: 类型检查**

Run: `cd /Users/admin/Workspace/ClaudeCode/LuxAgents/apps/electron && bun run typecheck`
Expected: 0 error（新文件未被引用也参与 tsc 全量扫描）

**Step 3: Commit**

```bash
git add apps/electron/src/renderer/components/app-shell/search/ && git commit -m "feat(search): 统一搜索基础类型与 chip 定义"
```

---

## Task 2: 搜索历史存储（纯函数 + atom）

**Files:**
- Create: `apps/electron/src/renderer/components/app-shell/search/search-history.ts`
- Test: `apps/electron/src/renderer/components/app-shell/search/__tests__/search-history.test.ts`

**Step 1: 写失败测试**

```ts
import { describe, expect, test } from 'bun:test'
import { addHistoryQuery } from '../search-history'

describe('addHistoryQuery', () => {
  test('新关键词插到最前', () => {
    expect(addHistoryQuery(['旧词1', '旧词2'], '新词')).toEqual(['新词', '旧词1', '旧词2'])
  })
  test('重复关键词去重并移到最前', () => {
    expect(addHistoryQuery(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c'])
  })
  test('超过 8 条截断', () => {
    const prev = ['1', '2', '3', '4', '5', '6', '7', '8']
    expect(addHistoryQuery(prev, '9').length).toBe(8)
    expect(addHistoryQuery(prev, '9')[0]).toBe('9')
    expect(addHistoryQuery(prev, '9')).not.toContain('8')
  })
  test('空白关键词不写入', () => {
    expect(addHistoryQuery(['a'], '  ')).toEqual(['a'])
  })
})
```

**Step 2: 跑测试确认失败**

Run: `cd /Users/admin/Workspace/ClaudeCode/LuxAgents && bun test apps/electron/src/renderer/components/app-shell/search/__tests__/search-history.test.ts`
Expected: FAIL（模块不存在）

**Step 3: 实现**

```ts
import { atomWithStorage } from 'jotai/utils'

const SEARCH_HISTORY_KEY = 'myyoda-search-history'
export const SEARCH_HISTORY_MAX = 8

/** 纯函数：写入一条历史查询词（去重置顶 + 截断） */
export function addHistoryQuery(previous: string[], query: string): string[] {
  const trimmed = query.trim()
  if (!trimmed) return previous
  const rest = previous.filter((item) => item !== trimmed)
  return [trimmed, ...rest].slice(0, SEARCH_HISTORY_MAX)
}

/** 历史关键词持久化（localStorage，对齐项目「本地存储优先」） */
export const searchHistoryAtom = atomWithStorage<string[]>(SEARCH_HISTORY_KEY, [])
```

**Step 4: 跑测试确认通过**

Run: 同上命令
Expected: PASS（3 条测试）

**Step 5: Commit**

```bash
git add apps/electron/src/renderer/components/app-shell/search/search-history.ts apps/electron/src/renderer/components/app-shell/search/__tests__/search-history.test.ts && git commit -m "feat(search): 搜索历史纯函数与持久化 atom"
```

## Task 3: 编排模型（排序 / chip 过滤 / 截断）

**Files:**
- Create: `apps/electron/src/renderer/components/app-shell/search/unified-search-model.ts`
- Test: `apps/electron/src/renderer/components/app-shell/search/__tests__/unified-search-model.test.ts`

**Step 1: 写失败测试**

```ts
import { describe, expect, test } from 'bun:test'
import { runUnifiedSearch, computeSortScore, type SearchProvider } from '../unified-search-model'
import type { UnifiedSearchResult } from '../unified-search-types'

const NOW = 1_800_000_000_000
function makeResult(partial: Partial<UnifiedSearchResult> & Pick<UnifiedSearchResult, 'id' | 'type' | 'title'>): UnifiedSearchResult {
  return {
    matchStart: 0, matchLength: 1, matchScore: 800, sortKey: NOW,
    target: { kind: 'todo', id: partial.id }, ...partial,
  } as UnifiedSearchResult
}

const fakeProvider: SearchProvider = () => [
  makeResult({ id: 'a', type: 'todo', title: '周报', matchScore: 1000 }),
  makeResult({ id: 'b', type: 'todo', title: '日报', matchScore: 900 }),
]

const automationProvider: SearchProvider = () => [
  makeResult({ id: 'c', type: 'automation', title: '周报自动化', matchScore: 950 }),
]

describe('computeSortScore', () => {
  test('匹配质量为主排序键', () => {
    const low = makeResult({ id: 'x', type: 'todo', title: 'x', matchScore: 700, sortKey: NOW })
    const high = makeResult({ id: 'y', type: 'todo', title: 'y', matchScore: 1000, sortKey: 0 })
    expect(computeSortScore(high, NOW)).toBeGreaterThan(computeSortScore(low, NOW))
  })
  test('未来时间戳不会被饱和成 1.0', () => {
    const future = makeResult({ id: 'f', type: 'calendar', title: 'f', matchScore: 800, sortKey: NOW + 365 * 86_400_000 })
    const now = makeResult({ id: 'n', type: 'todo', title: 'n', matchScore: 800, sortKey: NOW })
    // 距离越近新鲜度越高，但差距应远小于 matchScore 量级
    const delta = computeSortScore(now, NOW) - computeSortScore(future, NOW)
    expect(delta).toBeGreaterThan(0)
    expect(delta).toBeLessThan(1)
  })
})

describe('runUnifiedSearch', () => {
  test('多 provider 结果按匹配质量混合排序', () => {
    const results = runUnifiedSearch([fakeProvider, automationProvider], 'query', { chip: 'all', now: NOW })
    expect(results.map((r) => r.id)).toEqual(['a', 'c', 'b'])
  })
  test('chip 过滤只保留对应类型', () => {
    const results = runUnifiedSearch([fakeProvider, automationProvider], 'query', { chip: 'automation', now: NOW })
    expect(results.map((r) => r.id)).toEqual(['c'])
  })
  test('all 模式单类型最多 8 条、单类型 chip 模式最多 30 条', () => {
    const many: SearchProvider = () => Array.from({ length: 40 }, (_, i) => makeResult({ id: `t${i}`, type: 'todo', title: `任务${i}` }))
    expect(runUnifiedSearch([many], 'query', { chip: 'all', now: NOW }).length).toBe(8)
    expect(runUnifiedSearch([many], 'query', { chip: 'planning', now: NOW }).length).toBe(30)
  })
})
```

**Step 2: 跑测试确认失败**

Run: `cd /Users/admin/Workspace/ClaudeCode/LuxAgents && bun test apps/electron/src/renderer/components/app-shell/search/__tests__/unified-search-model.test.ts`
Expected: FAIL（模块不存在）

**Step 3: 实现**

```ts
import type { SearchChipKey, UnifiedSearchResult } from './unified-search-types'
import { chipKeyToTypes } from './unified-search-types'

/** provider：纯函数，输入关键词 + 全量数据，输出该类型的结果（不截断，交给编排层） */
export interface SearchProvider {
  (query: string): UnifiedSearchResult[]
}

export interface UnifiedSearchOptions {
  chip?: SearchChipKey
  now?: number
}

export const MIXED_TYPE_CAP = 8
/** 选中单个类型 chip 后的上限 */
export const FOCUSED_TYPE_CAP = 30

/** 新鲜度：距 now 的时间距离映射到 0~1（越近越大，一年线性衰减到 0） */
export function computeSortScore(result: UnifiedSearchResult, now: number): number {
  const distanceDays = Math.abs(now - result.sortKey) / 86_400_000
  const recencyBoost = Math.max(0, 1 - Math.min(1, distanceDays / 365))
  return result.matchScore + recencyBoost
}

export function runUnifiedSearch(
  providers: SearchProvider[],
  query: string,
  options: UnifiedSearchOptions = {},
): UnifiedSearchResult[] {
  const chip = options.chip ?? 'all'
  const now = options.now ?? Date.now()
  const allowedTypes = chipKeyToTypes(chip)
  const perTypeCap = chip === 'all' ? MIXED_TYPE_CAP : FOCUSED_TYPE_CAP

  const byType = new Map<string, UnifiedSearchResult[]>()
  for (const provider of providers) {
    for (const result of provider(query)) {
      if (allowedTypes.length > 0 && !allowedTypes.includes(result.type)) continue
      const bucket = byType.get(result.type) ?? []
      bucket.push(result)
      byType.set(result.type, bucket)
    }
  }

  const capped: UnifiedSearchResult[] = []
  for (const bucket of byType.values()) {
    bucket.sort((a, b) => computeSortScore(b, now) - computeSortScore(a, now))
    capped.push(...bucket.slice(0, perTypeCap))
  }
  return capped.sort((a, b) => computeSortScore(b, now) - computeSortScore(a, now))
}
```

**Step 4: 跑测试确认通过**

Run: 同上命令
Expected: PASS（5 条测试）

**Step 5: Commit**

```bash
git add apps/electron/src/renderer/components/app-shell/search/unified-search-model.ts apps/electron/src/renderer/components/app-shell/search/__tests__/unified-search-model.test.ts && git commit -m "feat(search): 编排模型——匹配质量+时间距离排序、chip 过滤、类型均衡截断"
```

---

## Task 4: 跳转路由

**Files:**
- Create: `apps/electron/src/renderer/components/app-shell/search/search-navigation.ts`
- Test: `apps/electron/src/renderer/components/app-shell/search/__tests__/search-navigation.test.ts`

**Step 1: 写失败测试**（依赖注入 mock deps，不碰真实 atoms）

```ts
import { describe, expect, test, jest, afterEach } from 'bun:test'
import { executeNavigation, type NavigationDeps } from '../search-navigation'
import type { SearchNavigationTarget } from '../unified-search-types'

function makeDeps(): NavigationDeps {
  return {
    openSession: jest.fn(),
    setAutomationForm: jest.fn(),
    openPlanningWithTodo: jest.fn(),
    openSkillsView: jest.fn(),
    openTaskEditor: jest.fn(),
    openProjectPage: jest.fn(),
  }
}

describe('executeNavigation', () => {
  test('session 目标调 openSession', () => {
    const deps = makeDeps()
    executeNavigation({ kind: 'session', mode: 'agent', id: 's1', title: '标题' }, deps)
    expect(deps.openSession).toHaveBeenCalledWith('agent', 's1', '标题')
  })
  test('automation 目标调 setAutomationForm', () => {
    const deps = makeDeps()
    executeNavigation({ kind: 'automation', id: 'a1' }, deps)
    expect(deps.setAutomationForm).toHaveBeenCalledTimes(1)
    expect(deps.setAutomationForm.mock.calls[0][0].open).toBe(true)
  })
  test('todo 目标调 openPlanningWithTodo', () => {
    const deps = makeDeps()
    executeNavigation({ kind: 'todo', id: 't1' }, deps)
    expect(deps.openPlanningWithTodo).toHaveBeenCalledWith('t1')
  })
  test('project 目标调 openProjectPage', () => {
    const deps = makeDeps()
    executeNavigation({ kind: 'project', workspaceId: 'w1' }, deps)
    expect(deps.openProjectPage).toHaveBeenCalledWith('w1')
  })
})
```

**Step 2: 跑测试确认失败**

Run: `cd /Users/admin/Workspace/ClaudeCode/LuxAgents && bun test apps/electron/src/renderer/components/app-shell/search/__tests__/search-navigation.test.ts`
Expected: FAIL（模块不存在）

**Step 3: 实现**（依赖注入接口 + 真实实现工厂；P0 只实现 session/automation/todo/project/kanban-task 五种，P1 补 calendar/skill/mcp/discover）

```ts
import type { SearchNavigationTarget } from './unified-search-types'

/** 跳转依赖：由 YodaSearchView 注入（openSession 等需要 hooks 上下文），测试注入 mock */
export interface NavigationDeps {
  openSession: (mode: 'chat' | 'agent', id: string, title: string) => void
  setAutomationForm: (form: { open: boolean; draft: unknown }) => void
  openPlanningWithTodo: (todoId: string) => void
  openSkillsView: () => void
  openTaskEditor: (target: unknown) => void
  openProjectPage: (workspaceId: string) => void
}

export function executeNavigation(target: SearchNavigationTarget, deps: NavigationDeps): void {
  switch (target.kind) {
    case 'session':
      deps.openSession(target.mode, target.id, target.title)
      return
    case 'automation':
      deps.setAutomationForm({ open: true, draft: { id: target.id } })
      return
    case 'todo':
      deps.openPlanningWithTodo(target.id)
      return
    case 'project':
      deps.openProjectPage(target.workspaceId)
      return
    case 'kanban-task':
      deps.openTaskEditor(target.target)
      return
    // P1 目标类型：calendar / skill / mcp / discover-official / discover-discussion
    default:
      console.warn('[搜索] 尚未实现的跳转目标:', (target as { kind: string }).kind)
  }
}
```

**Step 4: 跑测试确认通过**

Run: 同上命令
Expected: PASS（4 条测试）

**Step 5: Commit**

```bash
git add apps/electron/src/renderer/components/app-shell/search/search-navigation.ts apps/electron/src/renderer/components/app-shell/search/__tests__/search-navigation.test.ts && git commit -m "feat(search): 跳转路由——target 描述符分发（依赖注入可测）"
```

---

## Task 5: 会话标题 provider

**Files:**
- Create: `apps/electron/src/renderer/components/app-shell/search/providers/session-provider.ts`
- Test: `apps/electron/src/renderer/components/app-shell/search/providers/__tests__/session-provider.test.ts`

**Step 1: 写失败测试**

```ts
import { describe, expect, test } from 'bun:test'
import { searchSessionTitles } from '../session-provider'

describe('searchSessionTitles', () => {
  const conversations = [
    { id: 'c1', title: '周报模板', updatedAt: 1000, pinned: true, archived: false },
    { id: 'c2', title: '完全无关', updatedAt: 2000, pinned: false, archived: true },
  ]
  const agentSessions = [
    { id: 'a1', title: '周报自动化会话', updatedAt: 3000, pinned: false, archived: false, workspaceId: 'w1' },
  ]

  test('命中标题的会话被返回且 target 正确', () => {
    const results = searchSessionTitles('周报', { conversations, agentSessions, workspaceNameById: new Map([['w1', '默认空间']]) })
    expect(results.map((r) => r.id)).toEqual(['c1', 'a1'])
    expect(results[0].target).toEqual({ kind: 'session', mode: 'chat', id: 'c1', title: '周报模板' })
    expect(results[0].pinned).toBe(true)
    expect(results[1].workspaceName).toBe('默认空间')
  })
  test('不命中的会话被过滤', () => {
    const results = searchSessionTitles('周报', { conversations, agentSessions, workspaceNameById: new Map() })
    expect(results.map((r) => r.id)).not.toContain('c2')
  })
})
```

> 说明：`conversations`/`agentSessions` 的真实类型字段以 `grep -n "interface ConversationMeta" packages/shared/src -r` 为准，测试里 mock 对象按 provider 实际读取的字段构造即可，不强求完整类型。

**Step 2: 跑测试确认失败 → Step 3: 实现 → Step 4: 跑测试确认通过 → Step 5: Commit**

实现骨架（字段名以 Task 0 核查结论为准）：

```ts
import { findBestSearchMatch } from '@myyoda/shared'
import type { UnifiedSearchResult } from '../unified-search-types'

interface SessionSearchContext {
  conversations: Array<{ id: string; title: string; updatedAt: number; pinned?: boolean; archived?: boolean }>
  agentSessions: Array<{ id: string; title: string; updatedAt: number; pinned?: boolean; archived?: boolean; workspaceId?: string }>
  workspaceNameById: Map<string, string>
}

export function searchSessionTitles(query: string, ctx: SessionSearchContext): UnifiedSearchResult[] {
  const results: UnifiedSearchResult[] = []
  for (const conv of ctx.conversations) {
    const match = findBestSearchMatch(conv.title, query)
    if (!match) continue
    results.push({
      id: conv.id, type: 'session-chat', title: conv.title,
      matchStart: match.matchStart, matchLength: match.matchLength, matchScore: match.score,
      sortKey: conv.updatedAt, pinned: conv.pinned, archived: conv.archived,
      subtitle: '会话 · ' + (conv.archived ? '已归档' : '对话'),
      target: { kind: 'session', mode: 'chat', id: conv.id, title: conv.title },
    })
  }
  for (const session of ctx.agentSessions) {
    const match = findBestSearchMatch(session.title, query)
    if (!match) continue
    results.push({
      id: session.id, type: 'session-agent', title: session.title,
      matchStart: match.matchStart, matchLength: match.matchLength, matchScore: match.score,
      sortKey: session.updatedAt, pinned: session.pinned, archived: session.archived,
      subtitle: '会话 · Agent' + (session.workspaceId && ctx.workspaceNameById.has(session.workspaceId)
        ? ' · ' + ctx.workspaceNameById.get(session.workspaceId) : ''),
      workspaceName: session.workspaceId ? ctx.workspaceNameById.get(session.workspaceId) : undefined,
      target: { kind: 'session', mode: 'agent', id: session.id, title: session.title },
    })
  }
  return results
}
```

Run: `cd /Users/admin/Workspace/ClaudeCode/LuxAgents && bun test apps/electron/src/renderer/components/app-shell/search/providers/__tests__/session-provider.test.ts`
Expected: PASS（2 条测试）

Commit:
```bash
git add apps/electron/src/renderer/components/app-shell/search/providers/ && git commit -m "feat(search): 会话标题 provider（置顶/归档/工作区标签 + session target）"
```

## Task 6: 定时任务 provider

**Files:**
- Create: `apps/electron/src/renderer/components/app-shell/search/providers/automation-provider.ts`
- Test: `apps/electron/src/renderer/components/app-shell/search/providers/__tests__/automation-provider.test.ts`

**Step 1: 写失败测试**（结构对齐 session-provider 测试；断言命中/不命中 + `target === { kind: 'automation', id }` + subtitle 以「定时任务 ·」开头；字段以 `packages/shared/src/types/automation.ts` 为准——先执行 `grep -n "interface Automation" packages/shared/src/types/automation.ts` 确认标题/时间字段）

**Step 2-5**: 同 Task 5 流程。实现骨架：

```ts
import { findBestSearchMatch } from '@myyoda/shared'
import type { Automation } from '@myyoda/shared'
import type { UnifiedSearchResult } from '../unified-search-types'

export function searchAutomations(query: string, automations: Automation[]): UnifiedSearchResult[] {
  const results: UnifiedSearchResult[] = []
  for (const automation of automations) {
    const match = findBestSearchMatch(automation.name, query)
    if (!match) continue
    results.push({
      id: automation.id, type: 'automation', title: automation.name,
      matchStart: match.matchStart, matchLength: match.matchLength, matchScore: match.score,
      // 字段名以 Task 0 核查为准：最后一次运行时间，无则创建时间
      sortKey: automation.lastRunAt ?? automation.createdAt,
      subtitle: '定时任务 · ' + automation.scheduleType,
      target: { kind: 'automation', id: automation.id },
    })
  }
  return results
}
```

Run: `cd /Users/admin/Workspace/ClaudeCode/LuxAgents && bun test apps/electron/src/renderer/components/app-shell/search/providers/__tests__/automation-provider.test.ts`
Expected: PASS

Commit: `git add apps/electron/src/renderer/components/app-shell/search/providers/ && git commit -m "feat(search): 定时任务 provider（automation target 直达编辑表单）"`

---

## Task 7: Todo provider

**Files:**
- Create: `apps/electron/src/renderer/components/app-shell/search/providers/todo-provider.ts`
- Test: `apps/electron/src/renderer/components/app-shell/search/providers/__tests__/todo-provider.test.ts`

**要点**（字段以 `packages/shared/src/types/planning.ts` 的 `Todo` 为准，先 Grep 确认）：
- 标题字段命中 → 结果；**跨全部工作区**（不过滤 workspaceId），`workspaceName` 通过入参 `workspaceNameById` 填入，subtitle 带工作区名
- `sortKey = dueAt ?? createdAt`；已完成（若有 completed 标记字段）设 `archived: true` 降权不隐藏
- `target = { kind: 'todo', id }`
- 测试断言：命中/不命中、跨工作区不过滤、workspaceName 正确、target 正确

实现骨架与 Task 5/6 同构（纯函数 + findBestSearchMatch + 结果数组），不重复贴全码。

Run: `cd /Users/admin/Workspace/ClaudeCode/LuxAgents && bun test apps/electron/src/renderer/components/app-shell/search/providers/__tests__/todo-provider.test.ts`
Expected: PASS

Commit: `git add apps/electron/src/renderer/components/app-shell/search/providers/ && git commit -m "feat(search): Todo provider（跨工作区 + 工作区标签 + dueAt 排序）"`

---

## Task 8: 项目 provider

**Files:**
- Create: `apps/electron/src/renderer/components/app-shell/search/providers/project-provider.ts`
- Test: `apps/electron/src/renderer/components/app-shell/search/providers/__tests__/project-provider.test.ts`

**要点**（字段以 `packages/shared/src/types/agent.ts` 的 `AgentWorkspace` 为准，先 Grep 确认）：
- 工作区名称命中 → 结果；`sortKey = updatedAt ?? createdAt`
- subtitle：`'项目 · ' + (projectRootPath 有绑定 ? '本地项目' : '托管项目')`（徽标文案对齐 `SidebarProjectsTab` 的 `PROJECT_ROOT_STATUS_LABEL` 语义，`projectRootStatus` 非 available 时显示对应状态文案）
- `target = { kind: 'project', workspaceId: id }`
- 测试断言：命中/不命中、target 正确、subtitle 前缀正确

Run: `cd /Users/admin/Workspace/ClaudeCode/LuxAgents && bun test apps/electron/src/renderer/components/app-shell/search/providers/__tests__/project-provider.test.ts`
Expected: PASS

Commit: `git add apps/electron/src/renderer/components/app-shell/search/providers/ && git commit -m "feat(search): 项目 provider（项目页直达）"`

---

## Task 9: 看板任务 provider

**Files:**
- Create: `apps/electron/src/renderer/components/app-shell/search/providers/kanban-task-provider.ts`
- Test: `apps/electron/src/renderer/components/app-shell/search/providers/__tests__/kanban-task-provider.test.ts`

**前置**：Task 0 的结论已写入 `search/README.md`。数据源 = Task 0 选定的全量源（`serverKanbanProjectsAtom` 的 tasks 数组，或 `serverTaskSummariesAtom`），**绝不使用 `kanbanItemsAtom`**（它被 board scope 过滤）。

**要点**：
- 任务标题命中 → 结果；subtitle = `'看板任务 · ' + 所属项目名`
- `sortKey = updatedAt`
- `target = { kind: 'kanban-task', target: resolveTaskEditorTarget(...) }`——先 Read `apps/electron/src/renderer/components/app-shell/kanban/task-editor-model.ts` 确认 `resolveTaskEditorTarget` 的入参（KanbanItem），若搜索源不是 KanbanItem 形态，则在 provider 内构造最小入参或改用 `pendingTaskEditorTargetAtom` 兼容的 `TaskEditorTarget` 结构；必要时与 Task 0 结论一并记录在 README
- 测试断言：命中/不命中、target 结构正确、项目名 subtitle 正确

Run: `cd /Users/admin/Workspace/ClaudeCode/LuxAgents && bun test apps/electron/src/renderer/components/app-shell/search/providers/__tests__/kanban-task-provider.test.ts`
Expected: PASS

Commit: `git add apps/electron/src/renderer/components/app-shell/search/providers/ && git commit -m "feat(search): 看板任务 provider（任务编辑器直达）"`

---

## Task 10: YodaSearchView 接入统一模型（分步）

**Files:**
- Modify: `apps/electron/src/renderer/components/app-shell/YodaSearchView.tsx`
- Create: `apps/electron/src/renderer/components/app-shell/search/result-icons.ts`（类型→图标映射，供 view 使用）

**10a: 防抖即时搜索**

1. 新建 hook `useDebouncedValue`（可放 `apps/electron/src/renderer/hooks/use-debounced-value.ts`）：`useDebouncedValue(value: string, delayMs = 200): string`，内部 `useEffect + setTimeout`，delayMs 变化或 value 变化时重置；实现后单独跑 typecheck。
2. 改造 `YodaSearchView`：`query` 变化后（非 composition、`trimmed.length >= 2`）自动 `runSearch()`，删除「搜索」按钮与 Enter 触发的搜索语义（Enter 只打开选中项）；保留清除按钮与「Agent 搜索」按钮。
3. 手动验证：`bun run dev` → ⌘⇧F → 输入关键词，200ms 后自动出结果；切到英文输入连打不闪烁。
4. Commit: `feat(search): 搜索弹窗改为防抖即时搜索`

**10b: 类型图标映射 + 结果行改造**

1. 新建 `result-icons.ts`：`resolveResultIcon(type: SearchResultType): LucideIcon`——chat=`MessageSquare`、agent=`Bot`、automation=`Timer`、todo=`CheckSquare`（无则 `ListTodo`，以项目 lucide 版本为准）、project=`FolderOpen`、kanban-task=`LayoutDashboard`、skill=`Blocks`、mcp=`Plug`、calendar=`CalendarDays`、discover=`Compass`。
2. 结果行组件 `SearchResultRow` 改为接收 `UnifiedSearchResult`：图标来自 `resolveResultIcon`；标题用现有 `HighlightText`；subtitle（含类型名）渲染为次级灰字；workspaceName 沿用现有 badge；pinned 用现有 `Pin` 小图标。
3. Commit: `feat(search): 搜索结果行接入统一模型与类型图标`

**10c: chip 行**

1. 在输入框下方渲染 chip 行：由 `SEARCH_CHIPS` 生成；`all` 常显；其余 chip 仅当当前结果集中出现对应类型（`results.some(r => chipKeyToTypes(key).includes(r.type))` 或 `resultTypeToChipKey` 命中）时显示；chip 显示「标签 + 命中数」。
2. 选中 chip 存 `React.useState<SearchChipKey>('all')`；chip 变化时重新执行 `runUnifiedSearch(providers, committedQuery, { chip })`（结果已同步算出，无需重新 IPC；仅需在 IPC 内容结果返回后重新合并时同样尊重 chip——内容结果默认只出现在 `all`/`session` chip 下）。
3. 键盘：`←/→` 或 Tab 切换 chip？——本次不做，仅鼠标点击；`↑↓` 仍在结果列表内导航。
4. Commit: `feat(search): 类型筛选 chip 行`

**10d: 搜索历史区**

1. 空输入态（`trimmed.length === 0 && !hasSearched`）在「快捷操作」与「最近会话」之间插入「搜索历史」区块：`searchHistoryAtom` 前 8 条，点击填入 query 并立即触发搜索；「清空」按钮清空 atom。
2. 每次成功搜索后 `addHistoryQuery` 写入（在 `runSearch` 内 `setSearchHistory(prev => addHistoryQuery(prev, q))`）。
3. Commit: `feat(search): 搜索历史（持久化 + 点击回填）`

**10e: executeNavigation 接入**

1. 在 `YodaSearchView` 内构造 `NavigationDeps`：`openSession` = `useOpenSession()` 返回函数；`setAutomationForm` = `useSetAtom(automationFormAtom)` 包装为 `(form) => setAutomationForm(form)`；`openPlanningWithTodo` = 设置 `planningSelectedTodoIdAtom` + `planningTabAtom='todos'` + `setActiveView('planning')`（组合逻辑对齐 `PlanningView.tsx:236` 的消费方式，先 Read 确认）；`openTaskEditor` = `setPendingTaskEditorTarget(target)`；`openProjectPage` = 复制 `SidebarProjectsTab.openWorkspacePage` 的调用序列（`selectWorkspace` + `setActiveProjectPageId` + `setProjectPageTab('overview')` + `setCodeMainView('project')`）。
2. 结果行点击 = `executeNavigation(result.target, deps)`（不再按 chat/agent 分支手写跳转）；点击后 `setOpen(false)`。
3. 手动验证：5 类结果各点一次，确认跳转目标正确（会话打开、定时任务编辑表单、Todo 定位、项目页、任务编辑器）。
4. Commit: `feat(search): 结果跳转接入 executeNavigation 路由`

**10f: 内容匹配附加段（保持现有 IPC 体验）**

1. `runSearch` 内：同步结果 = `runUnifiedSearch([sessionTitles, automations, todos, projects, kanbanTasks], q, { chip })`；异步结果 = 现有两个 IPC 调用结果，转成 `UnifiedSearchResult`（type=session-*，`matchScore` 给一个低于标题匹配的值如 500，保证排后）追加到列表尾部（去重：标题已命中的会话 ID 不重复显示）。
2. 空结果态保留「试试 Agent 搜索」按钮。
3. Commit: `feat(search): 会话全文 IPC 结果作为统一混合流附加段`

---

## Task 11: Agent 搜索兜底 prompt 扩展

**Files:**
- Modify: `apps/electron/src/renderer/components/app-shell/YodaSearchView.tsx`（`handleAgentSearch` 内的 prompt 文案）

**Step 1**: 把 prompt 的搜索范围从「Chat/Agent 会话文件」扩展为全部数据源：会话文件（`~/.myyoda/conversations/`、`~/.myyoda/agent-sessions/`）+ 定时任务（`automations` 配置）+ Todo/日程（planning 数据）+ 技能/MCP 配置（`~/.myyoda/agent-workspaces/{slug}/skills/`、`mcp.json`）+ 看板任务（`tasks/` 目录）+ 项目（`projects/`）。文案保持原有结构（要求给出标题/摘要/来源），把范围段替换为列举式。

**Step 2**: typecheck + 全量测试。

**Step 3**: Commit: `feat(search): Agent 搜索兜底覆盖全部数据源`

---

## Task 12: 全量验证与收尾

**Step 1**: 全量验证

```bash
cd /Users/admin/Workspace/ClaudeCode/LuxAgents && bun run typecheck && bun test && bun run build
```
Expected: 7 包 typecheck 全绿；1600+ 测试全过（新增 ~20 条）；build 成功。

**Step 2: 手动验证清单**（`bun run dev`）：
- [ ] ⌘⇧F 打开弹窗；空输入态显示快捷操作 + 搜索历史 + 最近会话
- [ ] 输入 ≥2 字符后 200ms 自动出结果，中文输入法组词不触发
- [ ] 混合流按匹配质量排序，各行 subtitle 带类型名；置顶/归档图标正常
- [ ] chip 只在有结果的类型出现；点 chip 过滤生效，计数正确
- [ ] 点会话 → 打开会话；点定时任务 → 编辑表单；点 Todo → 计划页定位；点项目 → 项目页；点看板任务 → 任务编辑器
- [ ] 消息内容命中仍出现在标题之后
- [ ] 搜索历史写入/去重/清空正常，重启后仍在
- [ ] Esc 清空/关闭、↑↓/Enter 键盘流正常

**Step 3**: 更新 `docs/superpowers/specs/2026-08-15-search-upgrade-design.md` 状态为「P0 已实施」，提交。

**Step 4**: 合并回 main 前把计划文档也提交（文档随分支走即可，勿单独改 version）。

---

## P1 后续（另开计划，本计划不实施）

- 日程定位：新增 `planningSelectedCalendarEventIdAtom` + calendar provider + `executeNavigation` 补 `calendar` 分支
- 技能/MCP：搜索时后台预取 `WorkspaceCapabilities`（`getWorkspaceCapabilities` IPC + `workspaceCapabilitiesVersionAtom` 缓存判断）+ skills provider + `agentSkillsSelectedSlugAtom`（`AgentSkillsView` 本地选中态改 atom）
- 发现：discover provider（`discoverFeedAtom` 官方内容 + 已缓存讨论）+ `discoverSelectedItemIdAtom` / `discoverPendingDiscussionNumberAtom` + 「社区讨论仅搜索已浏览内容」提示文案
- `executeNavigation` 补全上述分支；类型图标补全
- P2（可选）：更强 fuzzy（跳字母子序列 / 拼音缩写索引）

---

## 执行方式选择

计划已保存。两种执行方式：

1. **子 Agent 驱动（本会话）**：每个 Task 派发新子 Agent 执行，任务间我做审查，快速迭代。
2. **独立会话执行**：在 `.worktrees/search-unified-p0` 开新会话，用 executing-plans 批量执行，带检查点。

建议方式 2（工作区已有 worktree 惯例，改动量大时上下文更干净）；方式 1 更快启动。
