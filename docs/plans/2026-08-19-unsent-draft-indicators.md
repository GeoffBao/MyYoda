# 历史会话未发送内容提醒（行标记 + Tab 徽标 + 持久化 + 区块找回）Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为历史会话的未发送内容建立完整提醒体系：侧栏行标记、Tab 徽标、跨重启持久化、区块兜底找回（含跨项目/归档）。

**Architecture:** 四层改动：① 新增持久化副作用模块（内存 atom 不变，防抖写盘 + 启动加载 + 清理）；② 纯函数 `selectDraftSessionsWithContent` 语义从"draft 会话找回"扩展为"未发送内容找回"（移除 draftSessionIds 过滤、新增 visibleSessionIds 过滤）；③ `AgentSessionItem` / `TabBarItem` 用既有 `agentSessionDraftAtomFamily` 切片订阅渲染标记（不引起整栏重渲染）；④ `LeftSidebar` 构建可见集合并接线清理。

**Tech Stack:** React 18 + jotai（atomFamily 切片）、TypeScript、bun test、localStorage。

**实现偏差说明（相对 spec）：** spec 变更 4 只写了"增加 visibleSessionIds 参数"，实现时发现若保留 `draftSessionIds.has(session.id)` 过滤条件，历史会话草稿永远进不了区块——因此必须同时移除该过滤条件，纯函数语义统一为"有未发送内容的会话（draft + 历史）"。spec 文档后续如需同步可补一行说明。

**分支与依赖：** 当前分支 `feat/unsent-draft-indicators`（基于 #103 的 `fix/draft-recall-cross-project`，stacked）；#103 合并后 rebase 到 main 再开 PR。

**Spec 参考:** `docs/superpowers/specs/2026-08-19-unsent-draft-indicators-design.md`

---

### Task 1: 持久化模块 — `lib/agent-draft-persistence.ts`（TDD）

**Files:**
- Create: `apps/electron/src/renderer/lib/agent-draft-persistence.ts`
- Create: `apps/electron/src/renderer/lib/__tests__/agent-draft-persistence.test.ts`

**Step 1: 写失败测试**

创建 `apps/electron/src/renderer/lib/__tests__/agent-draft-persistence.test.ts`：

```ts
import { describe, expect, test } from 'bun:test'
import { createStore } from 'jotai'
import { agentSessionDraftsAtom } from '@/atoms/agent-atoms'
import { parseDrafts, removeAgentDraft, serializeDrafts } from '../agent-draft-persistence.ts'

describe('agent-draft-persistence 序列化', () => {
  test('serialize/parse 往返一致', () => {
    const drafts = new Map([['s1', '草稿内容'], ['s2', '另一条']])
    expect(parseDrafts(serializeDrafts(drafts))).toEqual(drafts)
  })

  test('parse 空字符串/非法 JSON 返回空 Map', () => {
    expect(parseDrafts(null)).toEqual(new Map())
    expect(parseDrafts('')).toEqual(new Map())
    expect(parseDrafts('{bad json')).toEqual(new Map())
  })

  test('parse 过滤空文本与非字符串值', () => {
    const raw = JSON.stringify({ s1: '   ', s2: '有效', s3: 123, s4: '' })
    expect(parseDrafts(raw)).toEqual(new Map([['s2', '有效']]))
  })
})

describe('agent-draft-persistence 删除清理', () => {
  test('removeAgentDraft 删除指定会话草稿并落盘', () => {
    const store = createStore()
    store.set(agentSessionDraftsAtom, new Map([['s1', 'a'], ['s2', 'b']]))
    removeAgentDraft(store, 's1')
    expect(store.get(agentSessionDraftsAtom)).toEqual(new Map([['s2', 'b']]))
    expect(localStorage.getItem('myyoda-agent-session-drafts')).toContain('s2')
    expect(localStorage.getItem('myyoda-agent-session-drafts')).not.toContain('s1')
  })

  test('removeAgentDraft 不存在的会话不写盘', () => {
    const store = createStore()
    store.set(agentSessionDraftsAtom, new Map([['s2', 'b']]))
    removeAgentDraft(store, 's1')
    expect(store.get(agentSessionDraftsAtom)).toEqual(new Map([['s2', 'b']]))
  })
})
```

注：bun 测试环境有 `localStorage` 全局（happy-dom 未启用时可能没有——若无全局 localStorage，在测试文件顶部 `globalThis.localStorage = ...` 提供内存 stub，见 Step 3 备注）。

**Step 2: 运行确认失败**

```bash
cd apps/electron && bun test src/renderer/lib/__tests__/agent-draft-persistence.test.ts
```

Expected: FAIL（模块不存在）。

**Step 3: 实现**

创建 `apps/electron/src/renderer/lib/agent-draft-persistence.ts`：

```ts
/**
 * agent-draft-persistence — Agent 会话未发送草稿的持久化副作用
 *
 * agentSessionDraftsAtom 保持内存 Map（输入时即时更新，避免写盘抖动）；
 * 本模块负责：启动加载（localStorage → atom）、防抖写盘（atom → localStorage）、
 * 退出 flush、删除清理。只持久化纯文本；HTML 富文本不持久化（重启后由纯文本重建）。
 */

import type { Store } from 'jotai'
import { agentSessionDraftsAtom } from '@/atoms/agent-atoms'

const STORAGE_KEY = 'myyoda-agent-session-drafts'
/** 防抖窗口：停止输入多久后落盘 */
const PERSIST_DEBOUNCE_MS = 1500

/** 序列化：Map → 普通对象字符串（localStorage 友好） */
export function serializeDrafts(drafts: Map<string, string>): string {
  return JSON.stringify(Object.fromEntries(drafts))
}

/** 解析：对象字符串 → Map；非法输入 / 空文本 / 非字符串值一律丢弃 */
export function parseDrafts(raw: string | null): Map<string, string> {
  if (!raw) return new Map()
  try {
    const obj: unknown = JSON.parse(raw)
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return new Map()
    const result = new Map<string, string>()
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof value === 'string' && value.trim().length > 0) result.set(key, value)
    }
    return result
  } catch {
    return new Map()
  }
}

function writeDrafts(store: Store): void {
  try {
    localStorage.setItem(STORAGE_KEY, serializeDrafts(store.get(agentSessionDraftsAtom)))
  } catch {
    // localStorage 超限等写盘失败：忽略，内存草稿不受影响
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null

/** 防抖写盘：停止输入 1.5s 后落盘；timer 独立于组件生命周期（切换会话不丢盘） */
export function schedulePersistAgentDrafts(store: Store): void {
  if (persistTimer !== null) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    writeDrafts(store)
  }, PERSIST_DEBOUNCE_MS)
}

/** 立即落盘（beforeunload / 兜底） */
export function flushAgentDrafts(store: Store): void {
  if (persistTimer !== null) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  writeDrafts(store)
}

/** 启动加载：localStorage → atom（合并进现有内存数据） */
export function loadAgentSessionDrafts(store: Store): void {
  try {
    const drafts = parseDrafts(localStorage.getItem(STORAGE_KEY))
    if (drafts.size === 0) return
    store.set(agentSessionDraftsAtom, (prev) => {
      const next = new Map(prev)
      for (const [id, text] of drafts) next.set(id, text)
      return next
    })
  } catch {
    // 读盘失败忽略
  }
}

/** 删除单个会话草稿并立即落盘（会话/工作区删除时调用） */
export function removeAgentDraft(store: Store, sessionId: string): void {
  const current = store.get(agentSessionDraftsAtom)
  if (!current.has(sessionId)) return
  const next = new Map(current)
  next.delete(sessionId)
  store.set(agentSessionDraftsAtom, next)
  writeDrafts(store)
}
```

**Step 4: 运行确认通过**

```bash
cd apps/electron && bun test src/renderer/lib/__tests__/agent-draft-persistence.test.ts
```

Expected: PASS。若报 `localStorage is not defined`：在测试文件顶部加内存 stub：

```ts
const memStore = new Map<string, string>()
globalThis.localStorage = {
  getItem: (k: string) => memStore.get(k) ?? null,
  setItem: (k: string, v: string) => { memStore.set(k, v) },
  removeItem: (k: string) => { memStore.delete(k) },
  key: () => null,
  length: 0,
  clear: () => { memStore.clear() },
}
```

（放在 import 之后、describe 之前。）

**Step 5: Commit**

```bash
cd /Users/admin/Workspace/ClaudeCode/MyYoda
git add apps/electron/src/renderer/lib/agent-draft-persistence.ts apps/electron/src/renderer/lib/__tests__/agent-draft-persistence.test.ts
git commit --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>" -m "feat(sidebar): Agent 会话草稿持久化模块（防抖写盘 + 启动加载 + 清理）"
```

---

### Task 2: 区块纯函数扩展 — `draft-recall-model.ts`（TDD）

**Files:**
- Modify: `apps/electron/src/renderer/components/app-shell/draft-recall-model.ts`
- Test: `apps/electron/src/renderer/components/app-shell/__tests__/draft-recall-model.test.ts`

**Step 1: 更新测试（移除 draftSessionIds 参数、新增 visibleSessionIds 用例）**

用以下内容整体替换 `apps/electron/src/renderer/components/app-shell/__tests__/draft-recall-model.test.ts`：

```ts
import { describe, expect, test } from 'bun:test'
import { selectDraftSessionsWithContent, type DraftSessionSourceItem } from '../draft-recall-model.ts'

describe('selectDraftSessionsWithContent', () => {
  const sessions: DraftSessionSourceItem[] = [
    { id: 'a', title: '新 Agent 会话', workspaceId: 'ws-1', createdAt: 100 },
    { id: 'b', title: '新 Agent 会话', workspaceId: 'ws-1', createdAt: 300 },
    { id: 'c', title: '新 Agent 会话', workspaceId: 'ws-2', createdAt: 200 },
  ]

  test('无草稿文本时返回空', () => {
    const result = selectDraftSessionsWithContent({
      sessions,
      draftTexts: new Map(),
    })
    expect(result).toEqual([])
  })

  test('过滤空内容草稿（未输入任何东西不算需要找回的）', () => {
    const result = selectDraftSessionsWithContent({
      sessions,
      draftTexts: new Map([['a', '   ']]),
    })
    expect(result).toEqual([])
  })

  test('按 createdAt 倒序排列', () => {
    const result = selectDraftSessionsWithContent({
      sessions,
      draftTexts: new Map([['a', '第一个草稿'], ['b', '第二个草稿']]),
    })
    expect(result.map((s) => s.id)).toEqual(['b', 'a'])
    expect(result[0]?.text).toBe('第二个草稿')
  })

  test('跨项目返回全部有内容草稿，按 createdAt 倒序并透出 workspaceId', () => {
    const result = selectDraftSessionsWithContent({
      sessions,
      draftTexts: new Map([['a', '本工作区'], ['c', '别的工作区']]),
    })
    expect(result.map((s) => s.id)).toEqual(['c', 'a'])
    expect(result[0]?.workspaceId).toBe('ws-2')
    expect(result[1]?.workspaceId).toBe('ws-1')
  })

  test('visibleSessionIds 中的会话不进区块（已有行标记，避免重复）', () => {
    const result = selectDraftSessionsWithContent({
      sessions,
      draftTexts: new Map([['a', '可见行有草稿'], ['c', '不可见的其他项目草稿']]),
      visibleSessionIds: new Set(['a']),
    })
    expect(result.map((s) => s.id)).toEqual(['c'])
  })

  test('不传 visibleSessionIds 时不过滤（向后兼容）', () => {
    const result = selectDraftSessionsWithContent({
      sessions,
      draftTexts: new Map([['a', '草稿'], ['c', '草稿2']]),
    })
    expect(result.map((s) => s.id)).toEqual(['c', 'a'])
  })

  test('排除当前正打开的会话', () => {
    const result = selectDraftSessionsWithContent({
      sessions,
      draftTexts: new Map([['a', '正在这个会话里']]),
      excludeSessionId: 'a',
    })
    expect(result).toEqual([])
  })

  test('maxItems 限制条数', () => {
    const many: DraftSessionSourceItem[] = [
      { id: 'x1', title: 't', workspaceId: 'ws-1', createdAt: 1 },
      { id: 'x2', title: 't', workspaceId: 'ws-1', createdAt: 2 },
      { id: 'x3', title: 't', workspaceId: 'ws-2', createdAt: 3 },
      { id: 'x4', title: 't', workspaceId: 'ws-2', createdAt: 4 },
    ]
    const result = selectDraftSessionsWithContent({
      sessions: many,
      draftTexts: new Map([['x1', 'a'], ['x2', 'b'], ['x3', 'c'], ['x4', 'd']]),
      maxItems: 2,
    })
    expect(result.map((s) => s.id)).toEqual(['x4', 'x3'])
  })
})
```

**Step 2: 运行确认失败**

```bash
cd apps/electron && bun test src/renderer/components/app-shell/__tests__/draft-recall-model.test.ts
```

Expected: FAIL（实现仍要求 draftSessionIds 参数）。

**Step 3: 实现**

整体替换 `apps/electron/src/renderer/components/app-shell/draft-recall-model.ts`：

```ts
/**
 * draft-recall-model — 侧边栏"未发送草稿"区块的纯函数
 *
 * 区块是"未发送内容找回入口"，覆盖两类会话：
 * 1. draft 会话（从未发送过消息，默认从侧边栏所有列表过滤掉）——不显示就永远找不到；
 * 2. 历史会话有未发送内容但当前视图不可见（其他项目 / 归档）——行标记不可见时靠区块找回。
 *
 * 跨项目展示：与置顶会话 /「自动任务」组一致，不按当前工作区过滤。
 * 当前视图可见的会话（有行标记）通过 visibleSessionIds 排除，避免与列表重复展示。
 */

export interface DraftSessionSourceItem {
  id: string
  title: string
  workspaceId?: string
  createdAt: number
}

export interface DraftSessionWithContent {
  id: string
  title: string
  /** 草稿输入框的纯文本内容（已 trim），用于列表展示预览 */
  text: string
  /** 草稿所属工作区（用于跨项目标签判断） */
  workspaceId?: string
  createdAt: number
}

/**
 * 从会话列表中选出「有未发送内容」的会话（跨所有工作区，含 draft 与历史会话），按 createdAt 倒序。
 *
 * @param excludeSessionId 排除当前正打开的会话（用户已经在这个草稿里，不需要在列表里再列一遍）。
 *   调用方仅在主区处于会话视图时传入；看板 / 计划等非会话视图应传 null，保证找回入口始终存在。
 * @param visibleSessionIds 当前侧栏视图可见的会话 id 集合（有行标记），区块跳过它们避免重复。
 *   不传则不过滤（向后兼容）。
 * @param maxItems 最多展示条数，默认 5——这是找回入口，不是完整草稿箱
 */
export function selectDraftSessionsWithContent(params: {
  sessions: DraftSessionSourceItem[]
  draftTexts: Map<string, string>
  excludeSessionId?: string | null
  visibleSessionIds?: Set<string>
  maxItems?: number
}): DraftSessionWithContent[] {
  const { sessions, draftTexts, excludeSessionId, visibleSessionIds, maxItems = 5 } = params

  return sessions
    .filter((session) => (
      session.id !== excludeSessionId
      && !(visibleSessionIds?.has(session.id) ?? false)
    ))
    .map((session) => ({
      id: session.id,
      title: session.title,
      text: (draftTexts.get(session.id) ?? '').trim(),
      workspaceId: session.workspaceId,
      createdAt: session.createdAt,
    }))
    .filter((session) => session.text.length > 0)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, maxItems)
}
```

**Step 4: 运行确认通过**

```bash
cd apps/electron && bun test src/renderer/components/app-shell/__tests__/draft-recall-model.test.ts
```

Expected: PASS（7 用例）。

**Step 5: Commit**

```bash
cd /Users/admin/Workspace/ClaudeCode/MyYoda
git add apps/electron/src/renderer/components/app-shell/draft-recall-model.ts apps/electron/src/renderer/components/app-shell/__tests__/draft-recall-model.test.ts
git commit --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>" -m "feat(sidebar): 未发送草稿区块扩展为未发送内容找回（去 draft 过滤 + visibleSessionIds 去重）"
```

---

### Task 3: LeftSidebar 接线（可见集合 + 区块 props + 删除清理）

**Files:**
- Modify: `apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx`

**Step 1: 构建 visibleAgentSessionIds（挂载处附近，DraftSessionRecallSection 挂载之前定义）**

在 `LeftSidebar` 组件内、`DraftSessionRecallSection` 挂载处上方（约 3889 行前）添加：

```ts
      {/* 当前视图可见的 Agent 会话集合：区块跳过它们（行标记已提示），避免重复展示。
          active 视图语义：置顶 + 自动任务组 + 当前工作区非归档；不随归档视图变化。 */}
      const visibleAgentSessionIds = React.useMemo(() => {
        const visible = new Set<string>()
        for (const session of pinnedAgentSessions) visible.add(session.id)
        if (automationGroup) {
          for (const session of automationGroup.sessions) visible.add(session.id)
        }
        for (const session of agentSessions) {
          if (session.archived) continue
          if (draftSessionIds.has(session.id)) continue
          if (session.workspaceId && session.workspaceId !== currentWorkspaceId) continue
          visible.add(session.id)
        }
        return visible
      }, [pinnedAgentSessions, automationGroup, agentSessions, draftSessionIds, currentWorkspaceId])
```

注：React hooks 不能在条件分支内——上面的 useMemo 必须放在组件顶层（建议放在 3856 行「新会话」按钮块之前，而非 JSX 中间）。若 JSX 中间插 hooks 会违反 rules-of-hooks，实际放置位置为组件函数体顶层任意位置（如 workspaceNameMap 定义附近），引用变量需在其定义之后。

**Step 2: 更新挂载处 props**

将挂载处（约 3891-3904 行）替换为：

```tsx
      {/* 未发送内容找回入口：点「新会话」但没发送时，内容还在，不会真的丢，但原来没有回去的路。
          跨项目展示（对齐置顶）；主区在看板等非会话视图时不过滤当前草稿，保证找回入口始终存在；
          当前视图可见的会话（行标记已提示）不重复展示。 */}
      {mode === 'agent' && (
        <DraftSessionRecallSection
          currentWorkspaceId={currentWorkspaceId}
          workspaceNameMap={workspaceNameMap}
          excludeOnSessionView={codeMainView === 'session'}
          sessions={agentSessions}
          visibleSessionIds={visibleAgentSessionIds}
          excludeSessionId={currentAgentSessionId}
          onOpen={(id, title) => openSession('agent', id, title)}
        />
      )}
```

**Step 3: 更新 DraftSessionRecallSection 组件（props 移除 draftSessionIds、透传 visibleSessionIds）**

将 Props 接口中 `draftSessionIds: Set<string>` 行删除，并新增 `visibleSessionIds: Set<string>`：

```ts
interface DraftSessionRecallSectionProps {
  currentWorkspaceId: string | null
  workspaceNameMap: Map<string, string>
  /** 仅当主区处于会话视图时排除当前打开的草稿；看板 / 计划等视图传 false，保证找回入口始终存在 */
  excludeOnSessionView: boolean
  sessions: AgentSessionMeta[]
  visibleSessionIds: Set<string>
  excludeSessionId: string | null
  onOpen: (id: string, title: string) => void
}
```

组件函数签名与 useMemo 同步修改：

```ts
const DraftSessionRecallSection = React.memo(function DraftSessionRecallSection({
  currentWorkspaceId,
  workspaceNameMap,
  excludeOnSessionView,
  sessions,
  visibleSessionIds,
  excludeSessionId,
  onOpen,
}: DraftSessionRecallSectionProps): React.ReactElement | null {
  const draftTexts = useAtomValue(agentSessionDraftsAtom)
  const items = React.useMemo(
    () => selectDraftSessionsWithContent({
      sessions,
      draftTexts,
      excludeSessionId: excludeOnSessionView ? excludeSessionId : null,
      visibleSessionIds,
    }),
    [sessions, draftTexts, excludeOnSessionView, excludeSessionId, visibleSessionIds],
  )
  // …其余 JSX 不变
```

**Step 4: 删除会话/工作区时清理草稿**

- 在 `handleConfirmDelete` 删除成功分支（约 1340-1360 行，`setAgentSessions(sessions)` 附近）：删除前/后对被删会话（含级联子会话）逐个调用 `removeAgentDraft(store, id)`。删除 id 列表来源：`pendingDeleteId` 及其 `getDirectDelegatedChildren(agentSessions, pendingDeleteId)` 的 id（与删除确认弹窗的级联提示一致）。
- 在 `handleConfirmDeleteWorkspace`（约 1660-1700 行）删除工作区成功分支：遍历 `agentSessions.filter((s) => s.workspaceId === workspaceId)` 逐个 `removeAgentDraft(store, s.id)`。
- 顶部 import：`import { removeAgentDraft } from '@/lib/agent-draft-persistence'`。

**Step 5: Typecheck + Commit**

```bash
cd apps/electron && bun run typecheck
cd /Users/admin/Workspace/ClaudeCode/MyYoda
git add apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx
git commit --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>" -m "feat(sidebar): 草稿区块可见集合去重 + 删除会话/工作区清理草稿"
```

---

### Task 4: 侧栏行「未发送」标记 — `AgentSessionItem.tsx`

**Files:**
- Modify: `apps/electron/src/renderer/components/app-shell/AgentSessionItem.tsx`

**Step 1: 订阅草稿切片**

组件函数顶部（现有 hooks 之后）添加：

```ts
  const draftText = useAtomValue(agentSessionDraftAtomFamily(session.id))
```

确认顶部已有 import：`import { agentSessionDraftAtomFamily } from '@/atoms/agent-atoms'`（如无则补；`useAtomValue` 来自 jotai，文件已有引用）。

**Step 2: 渲染「未发送」徽标**

在标题容器内 `workspaceName` badge 之后（约 636-640 行 `{workspaceName && (...)}` 块后）添加：

```tsx
                {!active && draftText.trim().length > 0 && (
                  <span className="shrink-0 flex items-center gap-0.5 px-1.5 py-0 rounded-full bg-amber-500/10 text-[10px] leading-4 font-medium text-amber-600/90">
                    <Pencil size={10} aria-hidden="true" />
                    未发送
                  </span>
                )}
```

（`Pencil` 图标：确认文件已有 import，重命名编辑已使用；若未导入则补 `Pencil` 到 lucide-react import。）

**Step 3: Typecheck + Commit**

```bash
cd apps/electron && bun run typecheck
cd /Users/admin/Workspace/ClaudeCode/MyYoda
git add apps/electron/src/renderer/components/app-shell/AgentSessionItem.tsx
git commit --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>" -m "feat(sidebar): 会话行未发送内容徽标（切片订阅，仅非当前会话显示）"
```

---

### Task 5: Tab 徽标 — `TabBarItem.tsx`

**Files:**
- Modify: `apps/electron/src/renderer/components/tabs/TabBarItem.tsx`

**Step 1: 订阅草稿切片**

组件函数顶部添加：

```ts
  const draftText = useAtomValue(agentSessionDraftAtomFamily(id))
```

（`id` 即 Tab/session id；chat/scratch Tab 查不到草稿返回 `''`，无副作用。补 import：`agentSessionDraftAtomFamily` from '@/atoms/agent-atoms'；`useAtomValue` from 'jotai'——确认文件现有 import。）

**Step 2: 渲染圆点**

标题 span 内 `{title}` 之后添加：

```tsx
            {draftText.trim().length > 0 && (
              <span className="size-1.5 shrink-0 rounded-full bg-amber-500" title="有未发送内容" />
            )}
```

**Step 3: Typecheck + Commit**

```bash
cd apps/electron && bun run typecheck
cd /Users/admin/Workspace/ClaudeCode/MyYoda
git add apps/electron/src/renderer/components/tabs/TabBarItem.tsx
git commit --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>" -m "feat(tabs): 未发送内容 Tab 圆点徽标（切片订阅）"
```

---

### Task 6: 防抖写盘接入 — `AgentView.tsx` + `App.tsx`

**Files:**
- Modify: `apps/electron/src/renderer/components/agent/AgentView.tsx`
- Modify: `apps/electron/src/renderer/App.tsx`

**Step 1: AgentView.setInputContent 挂防抖写**

在 `setInputContent` 函数体末尾（删除/写入 draftsMap 之后、`}, [sessionId, setDraftSyncVersions, setDraftsMap])` 之前）追加：

```ts
    schedulePersistAgentDrafts(store)
```

并在组件顶部 import：

```ts
import { schedulePersistAgentDrafts } from '@/lib/agent-draft-persistence'
```

（`store` 在 setInputContent 所在组件作用域已存在——AgentView 使用 `useStore()`；若该作用域无 `store` 变量，在组件顶部补 `const store = useStore()`，确认文件已有 `useStore` import。）

**Step 2: App.tsx 启动加载 + beforeunload flush**

在 `App` 组件内添加：

```tsx
  const store = useStore()

  React.useEffect(() => {
    loadAgentSessionDrafts(store)
    const handleBeforeUnload = (): void => { flushAgentDrafts(store) }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [store])
```

并补 import：

```ts
import { useStore } from 'jotai'
import { flushAgentDrafts, loadAgentSessionDrafts } from '@/lib/agent-draft-persistence'
```

（确认 App.tsx 是否已有 `React` / `useEffect` 引用；若已 import React 则直接用。）

**Step 3: Typecheck + Commit**

```bash
cd apps/electron && bun run typecheck
cd /Users/admin/Workspace/ClaudeCode/MyYoda
git add apps/electron/src/renderer/components/agent/AgentView.tsx apps/electron/src/renderer/App.tsx
git commit --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>" -m "feat(sidebar): 草稿防抖持久化接入输入框 + 启动加载与退出 flush"
```

---

### Task 7: 全量回归

**Step 1: 全部相关测试**

```bash
cd apps/electron && bun test src/renderer/components/app-shell/__tests__/draft-recall-model.test.ts src/renderer/lib/__tests__/agent-draft-persistence.test.ts
```

Expected: PASS。

**Step 2: Typecheck**

```bash
cd apps/electron && bun run typecheck
```

Expected: 无错误。

**Step 3: 复查提交与工作区**

```bash
cd /Users/admin/Workspace/ClaudeCode/MyYoda && git log --oneline origin/fix/draft-recall-cross-project..HEAD && git status --short
```

Expected: 6 个新 commit（Task 1-6），工作区干净。

**Step 4: 手动验证清单（dev 模式，`cd apps/electron && bun run dev`）**

1. 历史会话 A 输入内容（不发送）→ 切到会话 B → A 行显示「未发送」徽标、A 的 Tab 显示 amber 圆点；切回 A 输入框内容恢复。
2. 两个历史会话同时有草稿 → 两行徽标 + 两个 Tab 圆点。
3. 其他项目历史会话有草稿 → 当前项目看不到该行，但「未发送草稿」区块显示该条目（带项目名标签）→ 点击跳回并切工作区；当前项目可见行不重复出现在区块。
4. 归档一个含草稿的历史会话 → 区块显示该条目（归档视图下同时有行标记）。
5. 重启应用 → 草稿文本恢复（输入框、徽标、圆点、区块均还原）。
6. 删除会话 / 删除工作区 → 对应草稿清理（localStorage 无残留）。
7. 发送消息后 → 徽标 / 圆点 / 区块条目消失。
8. 点「新会话」的草稿跳回逻辑不受影响（draft 会话仍在区块）。

**Step 5: 收尾**

- 全部通过后：`git switch fix/draft-recall-cross-project`（等待 #103 合并）→ #103 合并后 `git rebase origin/main` 回 feat 分支，再开 PR（body 末尾加 `Made with [MyYoda](https://github.com/GeoffBao/MyYoda)`）。
