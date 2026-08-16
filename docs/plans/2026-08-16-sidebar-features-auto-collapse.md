# 侧边栏「功能」组自动折叠 Implementation Plan

> **For the implementing agent:** REQUIRED SUB-SKILL: Use the `executing-plans` skill to implement this plan task-by-task.

**Goal:** 「功能」组改为一次性菜单：点击二级目录打开视图后自动收起、展开时点击外部自动收起、外部入口激活视图时自动展开且只显示激活项。

**Architecture:** 把激活判定与显示过滤抽成可测纯函数 `sidebar-features-model.ts`（bun:test 单测），`LeftSidebar.tsx` 消费；用 `suppressAutoExpandRef` 一次性抑制 `anyFeatureActive` effect 与「点击后收起」的冲突；用 document 级 `pointerdown` 监听实现外部点击收起。

**Tech Stack:** React 18 + Jotai + TypeScript + Tailwind；测试 bun:test（`bun test <file>`）。

**Spec:** `docs/superpowers/specs/2026-08-16-sidebar-features-auto-collapse-design.md`

**执行环境说明:** 直接在 `main` 分支主工作区执行（小改动，无 worktree 需求）；所有 commit 追加 `Co-Authored-By: MyYoda <MyYoda@noreply.github.com>` trailer。

---

### Task 1: 创建 `sidebar-features-model.ts` 纯函数（TDD）

**Files:**
- Create: `apps/electron/src/renderer/components/app-shell/sidebar-features-model.ts`
- Test: `apps/electron/src/renderer/components/app-shell/__tests__/sidebar-features-model.test.ts`

**Step 1: 写失败测试**

创建 `apps/electron/src/renderer/components/app-shell/__tests__/sidebar-features-model.test.ts`：

```ts
import { describe, expect, test } from 'bun:test'
import { FEATURE_ITEM_KINDS, isFeatureItemActive, anyFeatureActive, shouldShowFeatureItem, type FeatureViewContext } from '../sidebar-features-model'

const ctx = (overrides: Partial<FeatureViewContext> = {}): FeatureViewContext => ({
  activeView: 'conversations',
  mode: 'agent',
  codeMainView: 'session',
  ...overrides,
})

describe('isFeatureItemActive', () => {
  test('Given 计划视图激活 When 判定 planning Then true', () => {
    expect(isFeatureItemActive('planning', ctx({ activeView: 'planning' }))).toBe(true)
  })
  test('Given 看板视图激活（agent + tasks + conversations）When 判定 board Then true', () => {
    expect(isFeatureItemActive('board', ctx({ codeMainView: 'tasks' }))).toBe(true)
  })
  test('Given chat 模式 tasks 主视图 When 判定 board Then false（看板仅 agent）', () => {
    expect(isFeatureItemActive('board', ctx({ mode: 'chat', codeMainView: 'tasks' }))).toBe(false)
  })
  test('Given 画布 gallery 激活 When 判定 canvas Then true', () => {
    expect(isFeatureItemActive('canvas', ctx({ activeView: 'excalidraw-gallery' }))).toBe(true)
    expect(isFeatureItemActive('canvas', ctx({ activeView: 'excalidraw-editor' }))).toBe(true)
  })
  test('Given 插件视图激活 When 判定 skills Then true', () => {
    expect(isFeatureItemActive('skills', ctx({ activeView: 'agent-skills' }))).toBe(true)
  })
  test('Given 知识库视图激活 When 判定 wiki Then true', () => {
    expect(isFeatureItemActive('wiki', ctx({ activeView: 'repo-wiki' }))).toBe(true)
  })
  test('Given 普通会话视图 When 判定任意 kind Then false', () => {
    for (const kind of FEATURE_ITEM_KINDS) {
      expect(isFeatureItemActive(kind, ctx())).toBe(false)
    }
  })
})

describe('anyFeatureActive', () => {
  test('Given 任一功能视图激活 When 聚合判定 Then true', () => {
    expect(anyFeatureActive(ctx({ activeView: 'planning' }))).toBe(true)
    expect(anyFeatureActive(ctx({ codeMainView: 'tasks' }))).toBe(true)
    expect(anyFeatureActive(ctx({ activeView: 'excalidraw-editor' }))).toBe(true)
  })
  test('Given 无功能视图激活（含 discover 视图）When 聚合判定 Then false', () => {
    expect(anyFeatureActive(ctx())).toBe(false)
    expect(anyFeatureActive(ctx({ activeView: 'discover' }))).toBe(false)
  })
})

describe('shouldShowFeatureItem', () => {
  test('Given 菜单模式（showingAll=true）+ agent 模式 When 过滤任意 kind Then 全部可见', () => {
    for (const kind of FEATURE_ITEM_KINDS) {
      expect(shouldShowFeatureItem(kind, ctx(), true)).toBe(true)
    }
  })
  test('Given 菜单模式 + chat 模式 When 过滤 agentOnly 项（board/canvas/skills/wiki）Then 不可见', () => {
    const chatCtx = ctx({ mode: 'chat' })
    expect(shouldShowFeatureItem('planning', chatCtx, true)).toBe(true)
    for (const kind of ['board', 'canvas', 'skills', 'wiki'] as const) {
      expect(shouldShowFeatureItem(kind, chatCtx, true)).toBe(false)
    }
  })
  test('Given 指示模式（showingAll=false）When 过滤 Then 仅激活项可见', () => {
    const planningCtx = ctx({ activeView: 'planning' })
    expect(shouldShowFeatureItem('planning', planningCtx, false)).toBe(true)
    expect(shouldShowFeatureItem('board', planningCtx, false)).toBe(false)
    expect(shouldShowFeatureItem('canvas', planningCtx, false)).toBe(false)
    expect(shouldShowFeatureItem('skills', planningCtx, false)).toBe(false)
    expect(shouldShowFeatureItem('wiki', planningCtx, false)).toBe(false)
  })
})
```

**Step 2: 跑测试确认失败**

Run: `bun test apps/electron/src/renderer/components/app-shell/__tests__/sidebar-features-model.test.ts`
Expected: FAIL（`Cannot find module '../sidebar-features-model'`）

**Step 3: 实现 model**

创建 `apps/electron/src/renderer/components/app-shell/sidebar-features-model.ts`：

```ts
/**
 * 「功能」组二级目录（计划 / 看板 / 画布 / 插件 / 知识库）纯逻辑：激活判定 + 显示过滤（无 IO，便于单测）
 */
import type { AppMode } from '@/atoms/app-mode'
import type { CodeMainView } from '@/atoms/project-atoms'

export type FeatureItemKind = 'planning' | 'board' | 'canvas' | 'skills' | 'wiki'

export interface FeatureViewContext {
  activeView: string
  mode: AppMode
  codeMainView: CodeMainView
}

/** 二级目录项元信息：agentOnly 项在 Chat 模式下不显示 */
export const FEATURE_ITEMS: ReadonlyArray<{ kind: FeatureItemKind; agentOnly: boolean }> = [
  { kind: 'planning', agentOnly: false },
  { kind: 'board', agentOnly: true },
  { kind: 'canvas', agentOnly: true },
  { kind: 'skills', agentOnly: true },
  { kind: 'wiki', agentOnly: true },
]

export const FEATURE_ITEM_KINDS: readonly FeatureItemKind[] = FEATURE_ITEMS.map((item) => item.kind)

/** 该项对应的功能视图是否激活（与 LeftSidebar 原 anyFeatureActive 判定完全一致） */
export function isFeatureItemActive(kind: FeatureItemKind, ctx: FeatureViewContext): boolean {
  switch (kind) {
    case 'planning':
      return ctx.activeView === 'planning'
    case 'board':
      return ctx.mode === 'agent' && ctx.codeMainView === 'tasks' && ctx.activeView === 'conversations'
    case 'canvas':
      return ctx.activeView === 'excalidraw-gallery' || ctx.activeView === 'excalidraw-editor'
    case 'skills':
      return ctx.activeView === 'agent-skills'
    case 'wiki':
      return ctx.activeView === 'repo-wiki'
  }
}

/** 任一功能视图激活（替代 LeftSidebar 内联 anyFeatureActive） */
export function anyFeatureActive(ctx: FeatureViewContext): boolean {
  return FEATURE_ITEM_KINDS.some((kind) => isFeatureItemActive(kind, ctx))
}

/**
 * 该项是否渲染：
 * - 菜单模式（showingAll=true）：可见，但 agentOnly 项在 Chat 模式下仍隐藏
 * - 指示模式（showingAll=false）：仅激活项可见
 */
export function shouldShowFeatureItem(
  kind: FeatureItemKind,
  ctx: FeatureViewContext,
  showingAll: boolean,
): boolean {
  const item = FEATURE_ITEMS.find((entry) => entry.kind === kind)
  if (!item || (item.agentOnly && ctx.mode !== 'agent')) return false
  if (showingAll) return true
  return isFeatureItemActive(kind, ctx)
}
```

**Step 4: 跑测试确认通过**

Run: `bun test apps/electron/src/renderer/components/app-shell/__tests__/sidebar-features-model.test.ts`
Expected: PASS（全部用例通过）

**Step 5: Commit**

```bash
git add apps/electron/src/renderer/components/app-shell/sidebar-features-model.ts apps/electron/src/renderer/components/app-shell/__tests__/sidebar-features-model.test.ts
git commit --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>" -m "feat(sidebar): 抽出功能组激活判定与显示过滤纯函数（含单测）"
```

---

### Task 2: LeftSidebar 状态与自动展开 effect 改造

**Files:**
- Modify: `apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx`（约 731-745 行状态区）

**Step 1: 加 import**

在文件顶部 import 区（`import { formatSidebarModuleCount } ...` 附近，行 26 前后）加：

```ts
import { FEATURE_ITEM_KINDS, anyFeatureActive, isFeatureItemActive, shouldShowFeatureItem, type FeatureItemKind } from './sidebar-features-model'
```

**Step 2: 替换状态区**

找到现有代码（731-745 行）：

```tsx
  // 功能模块区（计划 / 看板 / 画布 / 插件 / 知识库）默认折叠；任一功能视图激活时自动展开。
  // 注意：「发现」是独立入口行（位于搜索与功能之间，Agent / Chat 模式均显示），不应触发功能组展开（否则双击发现会误展开功能组）。
  const anyFeatureActive =
    activeView === 'planning'
    || activeView === 'agent-skills'
    || activeView === 'repo-wiki'
    || activeView === 'excalidraw-gallery'
    || activeView === 'excalidraw-editor'
    || (mode === 'agent' && codeMainView === 'tasks' && activeView === 'conversations')
  const [featuresCollapsed, setFeaturesCollapsed] = React.useState(true)
  React.useEffect(() => {
    if (anyFeatureActive) setFeaturesCollapsed(false)
  }, [anyFeatureActive])
```

替换为：

```tsx
  // 功能模块区（计划 / 看板 / 画布 / 插件 / 知识库）默认折叠。
  // 双模式：菜单模式（用户手动展开，显示全部二级目录）/ 指示模式（外部入口激活视图时自动展开，只显示激活项）。
  // 注意：「发现」是独立入口行（位于搜索与功能之间，Agent / Chat 模式均显示），不应触发功能组展开（否则双击发现会误展开功能组）。
  const featureCtx = { activeView, mode, codeMainView }
  const anyFeatureActiveValue = anyFeatureActive(featureCtx)
  const [featuresCollapsed, setFeaturesCollapsed] = React.useState(true)
  const [featuresShowingAll, setFeaturesShowingAll] = React.useState(false)
  const featuresModuleRef = React.useRef<HTMLDivElement | null>(null)
  // 功能组内点击二级目录时置位，抑制 anyFeatureActive 变化触发的自动展开（点击后要收起）。
  const suppressAutoExpandRef = React.useRef(false)
  React.useEffect(() => {
    if (anyFeatureActiveValue && !suppressAutoExpandRef.current) {
      setFeaturesCollapsed(false)
      setFeaturesShowingAll(false)
    }
    suppressAutoExpandRef.current = false
  }, [anyFeatureActiveValue])
```

> 注意：原代码里 `anyFeatureActive` 这个局部变量名被 effect 依赖引用。若文件其他位置还引用 `anyFeatureActive`（grep 确认只有状态区与 effect），改名 `anyFeatureActiveValue` 是安全的；执行时先 `grep -n "anyFeatureActive"` 核对所有引用点。

**Step 3: 新增 `navigateFromFeatureGroup` 回调**

放在 `handleOpenDiscover` 定义之后（约 1083 行）：

```tsx
  /** 功能组内点击二级目录：打开对应视图后自动收起功能组 */
  const navigateFromFeatureGroup = React.useCallback((action: () => void): void => {
    suppressAutoExpandRef.current = true
    action()
    setFeaturesCollapsed(true)
  }, [])
```

**Step 4: typecheck**

Run: `cd apps/electron && bun run typecheck`
Expected: 无错误（`anyFeatureActiveValue` 已消费；`FEATURE_ITEM_KINDS` / `isFeatureItemActive` 暂时未用会在 Task 3 用上，若触发 noUnusedLocals 报错则在 Task 3 完成后再统一 typecheck，见下）

> 若此步因未使用的 import 报 TS6133，跳过该错误，Task 3 完成后统一验证（本仓库 `bun run typecheck` = `tsc --noEmit`，未使用 import 可能报错）。

**Step 5: Commit**

```bash
git add apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx
git commit --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>" -m "feat(sidebar): 功能组双模式状态与抑制自动展开逻辑"
```

---

### Task 3: 头部切换、二级目录包装与渲染过滤

**Files:**
- Modify: `apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx`（功能组渲染区，约 3888-3990 行）

**Step 1: 功能组容器挂 ref + 头部 onCollapsedChange**

找到：

```tsx
      <div className="sidebar-module-zone px-3 pt-1 pb-0.5">
        <SidebarModule
          icon={Layers}
          title="功能"
          collapsible
          collapsed={featuresCollapsed}
          onCollapsedChange={setFeaturesCollapsed}
          ariaLabel="功能模块"
        >
```

替换为：

```tsx
      <div className="sidebar-module-zone px-3 pt-1 pb-0.5" ref={featuresModuleRef}>
        <SidebarModule
          icon={Layers}
          title="功能"
          collapsible
          collapsed={featuresCollapsed}
          onCollapsedChange={(next) => {
            setFeaturesCollapsed(next)
            if (!next) setFeaturesShowingAll(true)
          }}
          ariaLabel="功能模块"
        >
```

**Step 2: 二级目录渲染过滤 + onClick 包装**

展开体 `<div className="flex flex-col gap-0.5 pt-1">` 内的 5 个按钮逐个改造：

1. **计划**（无 mode 条件，`onClick={handleOpenPlanning}`）：
   - 包裹：`{shouldShowFeatureItem('planning', featureCtx, featuresShowingAll) && ( ... )}`
   - onClick 改：`onClick={() => navigateFromFeatureGroup(handleOpenPlanning)}`

2. **看板**（原 `{mode === 'agent' && ( ... )}`，`onClick={handleOpenTaskBoard}`）：
   - 包裹改为：`{shouldShowFeatureItem('board', featureCtx, featuresShowingAll) && ( ... )}`
   - onClick 改：`onClick={() => navigateFromFeatureGroup(handleOpenTaskBoard)}`

3. **画布**（原 `{mode === 'agent' && ( ... )}`，`onClick={handleOpenExcalidraw}`）：
   - 包裹改为：`{shouldShowFeatureItem('canvas', featureCtx, featuresShowingAll) && ( ... )}`
   - onClick 改：`onClick={() => navigateFromFeatureGroup(handleOpenExcalidraw)}`

4. **插件**（原 `{mode === 'agent' && ( ... )}`，`onClick={() => handleOpenSkills()}`）：
   - 包裹改为：`{shouldShowFeatureItem('skills', featureCtx, featuresShowingAll) && ( ... )}`
   - onClick 改：`onClick={() => navigateFromFeatureGroup(() => handleOpenSkills())}`

5. **知识库**（原 `{mode === 'agent' && ( ... )}`，`onClick={handleOpenRepoWiki}`）：
   - 包裹改为：`{shouldShowFeatureItem('wiki', featureCtx, featuresShowingAll) && ( ... )}`
   - onClick 改：`onClick={() => navigateFromFeatureGroup(handleOpenRepoWiki)}`

> 激活高亮样式（`activeView === '...'` / `codeMainView === 'tasks'` 判定）保持不变。

**Step 3: typecheck**

Run: `cd apps/electron && bun run typecheck`
Expected: 无错误（Task 2 遗留的未使用 import 此时全部被消费）

**Step 4: Commit**

```bash
git add apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx
git commit --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>" -m "feat(sidebar): 功能组菜单/指示模式渲染过滤与点击后自动收起"
```

---

### Task 4: 外部点击自动收起

**Files:**
- Modify: `apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx`（状态区 effect 之后）

**Step 1: 加外部点击收起 effect**

在 Task 2 的自动展开 effect 之后新增：

```tsx
  // 功能组展开期间，点击功能组外部任意位置（侧边栏其他模块 / 会话列表 / 内容区）自动收起。
  React.useEffect(() => {
    if (featuresCollapsed) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null
      if (target && featuresModuleRef.current && !featuresModuleRef.current.contains(target)) {
        setFeaturesCollapsed(true)
      }
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [featuresCollapsed])
```

**Step 2: typecheck**

Run: `cd apps/electron && bun run typecheck`
Expected: 无错误

**Step 3: Commit**

```bash
git add apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx
git commit --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>" -m "feat(sidebar): 功能组展开时点击外部自动收起"
```

---

### Task 5: 全量验证

**Step 1: 跑相关单测**

Run: `bun test apps/electron/src/renderer/components/app-shell/__tests__/`
Expected: PASS（含新增 sidebar-features-model 与既有 app-shell 测试，无回归）

**Step 2: 全量 typecheck**

Run: `cd apps/electron && bun run typecheck`
Expected: 无错误

**Step 3: 手动验证（dev 运行）**

Run: `bun run dev`（若需要构建主进程再启动，按 README dev 流程）

按 spec 第六节逐项验证：
1. 手动展开 → 显示全部 5 项；点击「计划」→ 计划页打开且功能组收起
2. 手动展开 → 点击侧边栏空白/会话列表/内容区 → 功能组收起
3. 折叠态点「看板」图标 → 展开态功能组自动展开且只显示「看板」一项（高亮）
4. 快捷键打开「计划」→ 同 3 的指示模式
5. 指示模式点头部 → 收起；再点开 → 菜单模式显示全部
6. Chat 模式下重复 1-5（只有「计划」）
7. 收起状态下打开功能视图后回到会话 → 无异常展开

**Step 4: 提交验证结论**

无代码改动则跳过 commit；有修复则：

```bash
git add <files>
git commit --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>" -m "fix(sidebar): 功能组自动折叠手动验证修复"
```
