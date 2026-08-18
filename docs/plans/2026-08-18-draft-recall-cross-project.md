# 未发送草稿找回区块跨项目修复 — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复侧边栏「未发送草稿」区块的三个缺陷：跨项目展示草稿、非会话视图下不排除当前草稿、「新会话」智能跳回跨工作区兜底。

**Architecture:** 三层小改：① 纯函数 `selectDraftSessionsWithContent` 移除工作区过滤并透出 `workspaceId`；② 组件 `DraftSessionRecallSection` 新增当前工作区/工作区名映射/是否排除当前草稿三个 prop，行内渲染跨项目标签；③ `findRecallableDraftSession` 改为当前工作区优先 + 跨工作区兜底。全部逻辑集中在既有纯函数 + 叶子组件，不触碰草稿创建/发送机制。

**Tech Stack:** React 18 + jotai、TypeScript、bun test（bun:test）、ESLint。

**执行环境说明:** 项目无 worktree 惯例（无 `.worktrees` 目录），Electron monorepo 依赖较重且改动小（3 源文件 + 2 测试文件），本计划在主工作区 main 分支直接执行。

**Spec 参考:** `docs/superpowers/specs/2026-08-18-draft-recall-cross-project-design.md`

---

### Task 1: 纯函数跨项目化 — `draft-recall-model.ts`

**Files:**
- Modify: `apps/electron/src/renderer/components/app-shell/draft-recall-model.ts`
- Test: `apps/electron/src/renderer/components/app-shell/__tests__/draft-recall-model.test.ts`

**Step 1: 更新测试（删除 workspaceId 参数、改「只保留当前工作区」用例、新增跨项目断言）**

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

  test('无草稿 ID 时返回空', () => {
    const result = selectDraftSessionsWithContent({
      sessions,
      draftSessionIds: new Set(),
      draftTexts: new Map([['a', '写了一半']]),
    })
    expect(result).toEqual([])
  })

  test('过滤空内容草稿（未输入任何东西不算需要找回的）', () => {
    const result = selectDraftSessionsWithContent({
      sessions,
      draftSessionIds: new Set(['a']),
      draftTexts: new Map([['a', '   ']]),
    })
    expect(result).toEqual([])
  })

  test('按 createdAt 倒序排列', () => {
    const result = selectDraftSessionsWithContent({
      sessions,
      draftSessionIds: new Set(['a', 'b']),
      draftTexts: new Map([['a', '第一个草稿'], ['b', '第二个草稿']]),
    })
    expect(result.map((s) => s.id)).toEqual(['b', 'a'])
    expect(result[0]?.text).toBe('第二个草稿')
  })

  test('跨项目返回全部工作区草稿，按 createdAt 倒序并透出 workspaceId', () => {
    const result = selectDraftSessionsWithContent({
      sessions,
      draftSessionIds: new Set(['a', 'c']),
      draftTexts: new Map([['a', '本工作区'], ['c', '别的工作区']]),
    })
    expect(result.map((s) => s.id)).toEqual(['c', 'a'])
    expect(result[0]?.workspaceId).toBe('ws-2')
    expect(result[1]?.workspaceId).toBe('ws-1')
  })

  test('排除当前正打开的会话', () => {
    const result = selectDraftSessionsWithContent({
      sessions,
      draftSessionIds: new Set(['a']),
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
      draftSessionIds: new Set(['x1', 'x2', 'x3', 'x4']),
      draftTexts: new Map([['x1', 'a'], ['x2', 'b'], ['x3', 'c'], ['x4', 'd']]),
      maxItems: 2,
    })
    expect(result.map((s) => s.id)).toEqual(['x4', 'x3'])
  })
})
```

**Step 2: 运行测试确认失败**

```bash
cd apps/electron && bun test src/renderer/components/app-shell/__tests__/draft-recall-model.test.ts
```

Expected: FAIL — 「只保留当前工作区」已删除但实现仍过滤工作区会导致「跨项目返回全部工作区草稿」用例断言失败；同时实现尚不接受无 `workspaceId` 参数的调用（TypeScript 层面报错，bun test 直接跑 TS 会报参数缺失/过滤结果不符）。

**Step 3: 实现**

用以下内容整体替换 `apps/electron/src/renderer/components/app-shell/draft-recall-model.ts`：

```ts
/**
 * draft-recall-model — 侧边栏"未发送草稿"区块的纯函数
 *
 * 草稿会话（未发送过消息）默认从侧边栏所有列表中过滤掉，避免每次点"新会话"
 * 但没发送都留一个空条目。但如果草稿里已经输入了内容，用户需要一个入口找回它，
 * 否则会出现"输入了内容却再也点不回去"的问题（见 draft-session-atoms.ts 注释）。
 *
 * 跨项目展示：与置顶会话 /「自动任务」组一致，草稿找回入口不按当前工作区过滤，
 * 否则切换到其他项目后草稿区块会消失，原项目草稿将失去找回入口。
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
 * 从会话列表中选出「已输入内容但未发送」的草稿会话（跨所有工作区），按 createdAt 倒序。
 *
 * @param excludeSessionId 排除当前正打开的会话（用户已经在这个草稿里，不需要在列表里再列一遍）。
 *   调用方仅在主区处于会话视图时传入；看板 / 计划等非会话视图应传 null，保证找回入口始终存在。
 * @param maxItems 最多展示条数，默认 5——这是找回入口，不是完整草稿箱
 */
export function selectDraftSessionsWithContent(params: {
  sessions: DraftSessionSourceItem[]
  draftSessionIds: Set<string>
  draftTexts: Map<string, string>
  excludeSessionId?: string | null
  maxItems?: number
}): DraftSessionWithContent[] {
  const { sessions, draftSessionIds, draftTexts, excludeSessionId, maxItems = 5 } = params

  return sessions
    .filter((session) => (
      draftSessionIds.has(session.id)
      && session.id !== excludeSessionId
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

**Step 4: 运行测试确认通过**

```bash
cd apps/electron && bun test src/renderer/components/app-shell/__tests__/draft-recall-model.test.ts
```

Expected: PASS — 6 个用例全部通过。

**Step 5: Commit**

```bash
cd /Users/admin/Workspace/ClaudeCode/MyYoda
git add apps/electron/src/renderer/components/app-shell/draft-recall-model.ts apps/electron/src/renderer/components/app-shell/__tests__/draft-recall-model.test.ts
git commit --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>" -m "feat(sidebar): 未发送草稿区块跨项目展示（去工作区过滤 + workspaceId 透出）"
```

---

### Task 2: 「新会话」智能跳回跨工作区兜底 — `create-agent-session-flow.ts`

**Files:**
- Modify: `apps/electron/src/renderer/hooks/create-agent-session-flow.ts:51-75`
- Test: `apps/electron/src/renderer/hooks/__tests__/create-session-options.test.ts`

**Step 1: 更新测试**

在 `apps/electron/src/renderer/hooks/__tests__/create-session-options.test.ts` 的 `describe('findRecallableDraftSession')` 中，将「跨工作区草稿不匹配」用例替换为以下两个用例：

```ts
  test('当前工作区无草稿时跨工作区兜底', () => {
    const result = findRecallableDraftSession({
      candidates: base,
      draftSessionIds: new Set(['c']),
      draftTexts: new Map([['c', '别的工作区的内容']]),
      workspaceId: 'ws-1',
    })
    expect(result?.id).toBe('c')
  })

  test('当前工作区有草稿时优先，即使其他工作区草稿更新', () => {
    const result = findRecallableDraftSession({
      candidates: base,
      draftSessionIds: new Set(['a', 'c']),
      draftTexts: new Map([['a', '本工作区草稿'], ['c', '别的工作区更新内容']]),
      workspaceId: 'ws-1',
    })
    expect(result?.id).toBe('a')
  })
```

**Step 2: 运行测试确认失败**

```bash
cd apps/electron && bun test src/renderer/hooks/__tests__/create-session-options.test.ts
```

Expected: FAIL — 「当前工作区无草稿时跨工作区兜底」期望 `c`，当前实现返回 null。

**Step 3: 实现**

将 `apps/electron/src/renderer/hooks/create-agent-session-flow.ts` 中的 `findRecallableDraftSession`（及上方 JSDoc）替换为：

```ts
/**
 * 从候选会话中找出「未绑定项目、已输入内容但未发送」的最近草稿。
 *
 * 用于空白「新会话」入口（侧边栏按钮 / Cmd+N / 空状态按钮）智能回到未发送草稿，
 * 而不是每次都新建一个空会话把上一个草稿"顶没"。只匹配未绑定 projectId 的草稿——
 * 「在项目下新建会话」语义明确（该项目下的新任务），不参与回收，避免误跳到别处。
 *
 * 匹配策略：当前工作区优先（在当前工作区内找最近草稿）；当前工作区没有时跨工作区
 * 兜底（找所有工作区中最近的草稿）。与侧栏「未发送草稿」区块的跨项目找回语义一致。
 */
export function findRecallableDraftSession(params: {
  candidates: DraftSessionCandidate[]
  draftSessionIds: Set<string>
  draftTexts: Map<string, string>
  workspaceId: string | undefined
}): DraftSessionCandidate | null {
  const { candidates, draftSessionIds, draftTexts, workspaceId } = params
  let latest: DraftSessionCandidate | null = null
  let latestOther: DraftSessionCandidate | null = null
  for (const session of candidates) {
    if (!draftSessionIds.has(session.id)) continue
    if (session.projectId) continue
    const text = draftTexts.get(session.id)
    if (!text || text.trim().length === 0) continue
    if (session.workspaceId === workspaceId) {
      if (!latest || session.createdAt > latest.createdAt) latest = session
    } else if (!latestOther || session.createdAt > latestOther.createdAt) {
      latestOther = session
    }
  }
  return latest ?? latestOther
}
```

**Step 4: 运行测试确认通过**

```bash
cd apps/electron && bun test src/renderer/hooks/__tests__/create-session-options.test.ts
```

Expected: PASS — `findRecallableDraftSession` describe 内 6 个用例全部通过（其余 describe 不受影响）。

**Step 5: Commit**

```bash
cd /Users/admin/Workspace/ClaudeCode/MyYoda
git add apps/electron/src/renderer/hooks/create-agent-session-flow.ts apps/electron/src/renderer/hooks/__tests__/create-session-options.test.ts
git commit --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>" -m "feat(sidebar): 新会话智能跳回草稿跨工作区兜底（当前工作区优先）"
```

---

### Task 3: 侧栏组件 — `LeftSidebar.tsx`（exclude 条件化 + 跨项目标签）

**Files:**
- Modify: `apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx:3891-3899`（挂载处）
- Modify: `apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx:4539-4596`（`DraftSessionRecallSection` 组件）
- 说明：本组件无组件级测试基建（项目仅对纯函数写单测），用 typecheck + 手动清单验证。

**Step 1: 替换 Props 接口**

将 `DraftSessionRecallSectionProps`（约 4539-4545 行）替换为：

```ts
interface DraftSessionRecallSectionProps {
  currentWorkspaceId: string | null
  workspaceNameMap: Map<string, string>
  /** 仅当主区处于会话视图时排除当前打开的草稿；看板 / 计划等视图传 false，保证找回入口始终存在 */
  excludeOnSessionView: boolean
  sessions: AgentSessionMeta[]
  draftSessionIds: Set<string>
  excludeSessionId: string | null
  onOpen: (id: string, title: string) => void
}
```

**Step 2: 替换组件实现**

将 `DraftSessionRecallSection`（约 4552-4596 行）替换为（标签样式对齐 AgentSessionItem.tsx:636-640 的 `workspace-badge`）：

```tsx
const DraftSessionRecallSection = React.memo(function DraftSessionRecallSection({
  currentWorkspaceId,
  workspaceNameMap,
  excludeOnSessionView,
  sessions,
  draftSessionIds,
  excludeSessionId,
  onOpen,
}: DraftSessionRecallSectionProps): React.ReactElement | null {
  const draftTexts = useAtomValue(agentSessionDraftsAtom)
  const items = React.useMemo(
    () => selectDraftSessionsWithContent({
      sessions,
      draftSessionIds,
      draftTexts,
      excludeSessionId: excludeOnSessionView ? excludeSessionId : null,
    }),
    [sessions, draftSessionIds, draftTexts, excludeOnSessionView, excludeSessionId],
  )

  if (items.length === 0) return null

  return (
    <div className="px-3 pt-2">
      <div className="px-1 pb-1 text-[11px] font-medium text-foreground/40">未发送草稿</div>
      <div className="flex flex-col gap-0.5">
        {items.map((item) => {
          const workspaceName = item.workspaceId && item.workspaceId !== currentWorkspaceId
            ? workspaceNameMap.get(item.workspaceId)
            : undefined
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onOpen(item.id, item.title)}
              title={item.text}
              className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[12.5px] text-foreground/60 transition-colors duration-fast hover:bg-foreground/[0.06] hover:text-foreground/85"
            >
              <Pencil size={12} className="shrink-0 text-foreground/35" />
              <span className="truncate">{item.text}</span>
              {workspaceName && (
                <span className="shrink-0 min-w-0 px-1.5 py-0 rounded-full bg-primary/10 text-[10px] leading-4 workspace-badge font-medium truncate max-w-[120px]">
                  {workspaceName}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
})
```

**Step 3: 替换挂载处传参**

将 3891-3899 行的挂载处替换为：

```tsx
      {/* 未发送草稿找回入口：点「新会话」但没发送时，内容还在，不会真的丢，但原来没有回去的路。
          跨项目展示（对齐置顶）；主区在看板等非会话视图时不过滤当前草稿，保证找回入口始终存在。 */}
      {mode === 'agent' && (
        <DraftSessionRecallSection
          currentWorkspaceId={currentWorkspaceId}
          workspaceNameMap={workspaceNameMap}
          excludeOnSessionView={codeMainView === 'session'}
          sessions={agentSessions}
          draftSessionIds={draftSessionIds}
          excludeSessionId={currentAgentSessionId}
          onOpen={(id, title) => openSession('agent', id, title)}
        />
      )}
```

注：`currentWorkspaceId`（693 行）、`workspaceNameMap`（901 行）、`codeMainView`（702 行）、`agentSessions`（683 行）、`draftSessionIds`、`currentAgentSessionId`、`openSession`（743 行）均已在组件作用域内，无需新增 hook。

**Step 4: Typecheck**

```bash
cd apps/electron && bun run typecheck
```

Expected: PASS，无类型错误。（若 `codeMainViewAtom` 的类型中不含 `'session'` 字面量，则改为 `codeMainView === ('session' as const)` 或按实际类型调整比较；`useOpenSession.ts` 中已有 `setCodeMainView('session')` 调用，说明该字面量合法。）

**Step 5: 手动验证清单（dev 模式）**

```bash
cd apps/electron && bun run dev
```

1. 项目 A 输入草稿 → 切到项目 B 会话（普通列表 / 置顶 / 自动任务均可）→ 「未发送草稿」区块显示 A 的草稿并带 A 项目名标签 → 点击跳回 A 并聚焦草稿会话。
2. 点「新会话」→ 输入内容（当前会话即草稿）→ 点「看板」→ 区块显示该草稿 → 点击后回到会话且区块不再重复列它。
3. 点「新会话」（Cmd+N）：当前工作区无草稿但其他项目有 → 自动跳回其他项目的最近草稿。
4. 空内容草稿（未输入）不出现；已发送过的会话不出现。

**Step 6: Commit**

```bash
cd /Users/admin/Workspace/ClaudeCode/MyYoda
git add apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx
git commit --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>" -m "feat(sidebar): 未发送草稿区块非会话视图保留入口 + 跨项目工作区标签"
```

---

### Task 4: 全量回归验证

**Step 1: 运行两个测试文件**

```bash
cd apps/electron && bun test src/renderer/components/app-shell/__tests__/draft-recall-model.test.ts src/renderer/hooks/__tests__/create-session-options.test.ts
```

Expected: PASS，全部用例通过。

**Step 2: Typecheck + Lint**

```bash
cd apps/electron && bun run typecheck
```

Expected: PASS，无类型错误。

```bash
cd apps/electron && bun run lint 2>/dev/null || npx eslint src/renderer/components/app-shell/draft-recall-model.ts src/renderer/components/app-shell/LeftSidebar.tsx src/renderer/hooks/create-agent-session-flow.ts
```

Expected: 无 lint 报错（若 `lint` script 不存在则用 eslint 直接检查改动文件）。

**Step 3: 复查 diff**

```bash
cd /Users/admin/Workspace/ClaudeCode/MyYoda && git log --oneline -3 && git status
```

Expected: 3 个功能 commit（Task 1/2/3）在列，工作区干净（未提交内容为空）。

**Step 4: 收尾**

- 无需额外 commit（各 Task 已独立提交）。
- 手动验证（Task 3 Step 5 清单）结果记录到任务描述后，标记本任务完成。
