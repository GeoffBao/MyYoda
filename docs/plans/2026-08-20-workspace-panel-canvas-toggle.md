# 右侧工作区面板共存 + 画布快速开关 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use myyoda-workspace-luxcoder:executing-plans to implement this plan task-by-task.
> 开始实施前先用 myyoda-workspace-luxcoder:using-git-worktrees 建立独立 worktree，不要在主工作树直接改。

**Goal:** 受管浏览器打开时文件预览/草稿仍可共存；新增"画布"开关按钮（与终端、浏览器同级），点击直接在当前会话打开画布，不再经过全屏画廊。

**Architecture:** 右侧工作区从"Browser 独占槽位"改为"Browser / 文档槽(Preview⊕Canvas) / Scratch 三个可独立开关、可共存的槽位"，新增一对纯函数（TabBar 按钮布局、右侧工作区分栏样式）承载可测试的布局逻辑；`ExcalidrawEditor` 从"只能读 sessionStorage + 全屏路由"改造为可选受控 props，供新的 `CanvasPanel` 复用同一套加载/自动保存/退出逻辑。

**Tech Stack:** React 19 + Jotai + TypeScript + bun test（现有技术栈，不引入新依赖）

**Spec 参考：** `docs/superpowers/specs/2026-08-20-workspace-panel-canvas-toggle-design.md`

---

## 前置说明（写在最前面，每个 Task 都会用到）

- 相关 sessionId 均为 `agent` 类型会话的 `sessionId`（`TabBar.tsx` 里 `activeAgentSession.id`），与 `previewPanelOpenMapAtom` / `terminalPanelOpenMapAtom` / `browserPanelOpenMapAtom` 的 key 是同一个东西。
- `.excalidraw` 文件的 IPC 已存在，无需新增主进程代码：
  - `window.electronAPI.createExcalidrawFile(workspaceSlug, title) => Promise<{ slug, title }>`
  - `window.electronAPI.readExcalidrawFile(workspaceSlug, slug) => Promise<{ elements, appState, files, title } | null>`
  - `window.electronAPI.writeExcalidrawFile(workspaceSlug, slug, payload)`
  - `window.electronAPI.renameExcalidrawFile(workspaceSlug, slug, newTitle)`
  - `window.electronAPI.saveExcalidrawFileSync(workspaceSlug, slug, title, payload)`
- 测试命令：`bun test <path>`（项目用 bun test，非 vitest/jest）。
- 每个 Task 结束都提交一次，commit message 遵循仓库现有 `feat:` / `refactor:` 前缀习惯。

---

### Task 1: `tab-bar-action-layout.ts` 支持画布按钮宽度

**Files:**
- Modify: `apps/electron/src/renderer/components/tabs/tab-bar-action-layout.ts`
- Test: `apps/electron/src/renderer/components/tabs/__tests__/tab-bar-action-layout.test.ts`（新建，此前无测试文件）

**背景：** 该函数按"有哪些按钮"算 TabBar 右侧预留宽度和绝对定位坐标。当前只支持 `hasBrowserButton` / `hasTerminalButton` 两级；画布按钮加入后要再加一级 36px（28px 按钮 + 8px gap，和终端按钮同宽）。画布按钮固定排在终端左边，所以只在"有终端按钮"的前提下才可能出现"还有画布按钮"。

**Step 1: 写失败测试**

```ts
// apps/electron/src/renderer/components/tabs/__tests__/tab-bar-action-layout.test.ts
import { describe, expect, test } from 'bun:test'
import { getTabBarActionLayout } from '../tab-bar-action-layout'

describe('getTabBarActionLayout', () => {
  test('Given mac + 面板+浏览器+终端+画布全部存在 When 计算布局 Then 预留宽度比只有终端多 36px', () => {
    const withoutCanvas = getTabBarActionLayout(false, true, true, true, false)
    const withCanvas = getTabBarActionLayout(false, true, true, true, true)
    expect(withoutCanvas.scrollPaddingClassName).toBe('pr-[148px]')
    expect(withCanvas.scrollPaddingClassName).toBe('pr-[184px]')
  })

  test('Given windows + 全部按钮存在 When 计算布局 Then 预留宽度比只有终端多 36px', () => {
    const withoutCanvas = getTabBarActionLayout(true, true, true, true, false)
    const withCanvas = getTabBarActionLayout(true, true, true, true, true)
    expect(withoutCanvas.scrollPaddingClassName).toBe('pr-[282px]')
    expect(withCanvas.scrollPaddingClassName).toBe('pr-[318px]')
  })

  test('Given 没有终端按钮 When 传入 hasCanvasButton=true Then 画布参数被忽略（画布固定排终端左边，终端不在时画布也不显示）', () => {
    const layout = getTabBarActionLayout(false, true, true, false, true)
    expect(layout.scrollPaddingClassName).toBe('pr-28')
  })
})
```

**Step 2: 运行确认失败**

Run: `bun test apps/electron/src/renderer/components/tabs/__tests__/tab-bar-action-layout.test.ts`
Expected: FAIL（`getTabBarActionLayout` 目前只接受 4 个参数，TS 编译错误或运行时行为不符）

**Step 3: 实现**

```ts
// apps/electron/src/renderer/components/tabs/tab-bar-action-layout.ts
export interface TabBarActionLayout {
  scrollPaddingClassName: string
  shortcutPositionClassName: string
  panelPositionClassName: string
}

/**
 * 保持 Tab 栏右侧操作区与窗口控制按钮分离，同时为标签滚动区留出空间。
 * hasTerminalButton：终端按钮（28px + 8px gap）额外占用 36px。
 * hasCanvasButton：画布按钮同样占用 36px，固定排在终端按钮左边，
 * 只有 hasTerminalButton 为 true 时才会生效（画布按钮不单独出现在终端右边）。
 */
export function getTabBarActionLayout(
  isWindows: boolean,
  hasPanelButton: boolean,
  hasBrowserButton = false,
  hasTerminalButton = false,
  hasCanvasButton = false,
): TabBarActionLayout {
  const canvasExtra = hasTerminalButton && hasCanvasButton ? 36 : 0

  if (!isWindows) {
    const base = hasPanelButton
      ? (hasBrowserButton
        ? (hasTerminalButton ? 148 : 112)
        : 80)
      : (hasBrowserButton
        ? (hasTerminalButton ? 116 : 80)
        : 40)
    return {
      scrollPaddingClassName: `pr-[${base + canvasExtra}px]`,
      shortcutPositionClassName: hasPanelButton
        ? 'inset-y-0 items-end pb-[3px] z-10 right-9'
        : 'inset-y-0 items-end pb-[3px] z-10 right-1',
      panelPositionClassName: 'inset-y-0 right-1 items-end pb-[3px] z-10',
    }
  }

  const base = hasPanelButton
    ? (hasBrowserButton
      ? (hasTerminalButton ? 282 : 246)
      : 218)
    : (hasBrowserButton
      ? (hasTerminalButton ? 254 : 218)
      : 190)
  return {
    scrollPaddingClassName: `pr-[${base + canvasExtra}px]`,
    shortcutPositionClassName: hasPanelButton
      ? `inset-y-0 items-end pb-[3px] z-10 right-[${158 + canvasExtra}px]`
      : `inset-y-0 items-end pb-[3px] z-10 right-[${130 + canvasExtra}px]`,
    panelPositionClassName: 'inset-y-0 right-[126px] items-end pb-[3px] z-10',
  }
}
```

> 注意：原代码用的是 Tailwind 静态类名（`pr-28` 等），改成 `pr-[${n}px]` 模板字符串后数值和原来的 `pr-28`(=112px)、`pr-20`(=80px)、`pr-10`(=40px) 完全等价，只是写法从命名类改成任意值类。文件 Windows 分支原本就在用 `right-[158px]` 这种任意值类写法，可以确认项目 Tailwind 配置已支持，不需要额外配置改动。

**Step 4: 运行确认通过**

Run: `bun test apps/electron/src/renderer/components/tabs/__tests__/tab-bar-action-layout.test.ts`
Expected: PASS，同时补跑一次全量 `bun test apps/electron/src/renderer/components/tabs` 确认没有破坏其他用例。

**Step 5: 提交**

```bash
git add apps/electron/src/renderer/components/tabs/tab-bar-action-layout.ts apps/electron/src/renderer/components/tabs/__tests__/tab-bar-action-layout.test.ts
git commit -m "feat(tabbar): getTabBarActionLayout 支持画布按钮宽度"
```

---

### Task 2: 新增画布 per-session 状态 atoms

**Files:**
- Create: `apps/electron/src/renderer/atoms/canvas-panel-atoms.ts`

**说明：** 纯状态声明，参照 `atoms/preview-atoms.ts` 的 per-session Map 模式，不需要单独的逻辑测试（后续 Task 里通过组件行为间接覆盖）。

```ts
/**
 * Canvas Panel Atoms — 画布快速开关面板状态管理
 *
 * 每个 Agent 会话拥有独立的画布面板状态（是否打开、当前打开的画布文件）。
 * 画布文件本体持久化在 workspaceSlug 维度（见 getExcalidrawDir），这里只记录
 * "该会话当前文档槽里展示的是哪个画布文件"，用于按钮再次点击时恢复上次画布。
 */

import { atom } from 'jotai'

/** 会话当前打开的画布文件引用 */
export interface CanvasFileRef {
  workspaceSlug: string
  slug: string
}

/** 每会话画布面板开关（是否在文档槽内展示画布） */
export const canvasPanelOpenMapAtom = atom<Map<string, boolean>>(new Map())

/** 每会话当前打开的画布文件；null = 该会话点开过画布按钮但还没保存出任何 slug（全新未命名画布） */
export const canvasFileMapAtom = atom<Map<string, CanvasFileRef | null>>(new Map())
```

**提交：**

```bash
git add apps/electron/src/renderer/atoms/canvas-panel-atoms.ts
git commit -m "feat(canvas): 新增画布面板 per-session 状态 atoms"
```

---

### Task 3: 右侧工作区三栏布局纯函数 + 单测

**Files:**
- Create: `apps/electron/src/renderer/components/tabs/right-workspace-layout.ts`
- Test: `apps/electron/src/renderer/components/tabs/__tests__/right-workspace-layout.test.ts`

**背景：** 现状只有"最多两栏"（Preview vs Scratch，单一 `rightWorkspaceSplitRatioAtom`）。改造后最多三栏：`browser` / `doc`（Preview 或 Canvas）/ `scratch`，用两级比例做嵌套分栏：
- `browserRatio`：Browser 和"其余部分"之间的比例（新增 `browserWorkspaceSplitRatioAtom`）
- `docScratchRatio`：`doc` 和 `scratch` 之间的比例（复用现有 `rightWorkspaceSplitRatioAtom`，语义不变）

只有 1 栏可见时不需要比例，占满宽度；2 栏、3 栏时按上述规则套用。

**Step 1: 写失败测试**

```ts
// apps/electron/src/renderer/components/tabs/__tests__/right-workspace-layout.test.ts
import { describe, expect, test } from 'bun:test'
import { computeRightWorkspaceLayout, type RightWorkspacePanel } from '../right-workspace-layout'

describe('computeRightWorkspaceLayout', () => {
  test('Given 只有 browser 可见 When 计算布局 Then browser 占满、其余无样式', () => {
    const result = computeRightWorkspaceLayout(['browser'], 0.5, 0.58)
    expect(result.browser).toEqual({ flex: '1 1 auto' })
    expect(result.doc).toBeUndefined()
    expect(result.scratch).toBeUndefined()
  })

  test('Given browser + doc 可见 When 计算布局 Then 按 browserRatio 二分', () => {
    const result = computeRightWorkspaceLayout(['browser', 'doc'], 0.4, 0.58)
    expect(result.browser).toEqual({ flex: '0 0 calc(40% - 4px)' })
    expect(result.doc).toEqual({ flex: '1 1 auto' })
  })

  test('Given doc + scratch 可见（无 browser）When 计算布局 Then 复用 docScratchRatio，行为与改造前一致', () => {
    const result = computeRightWorkspaceLayout(['doc', 'scratch'], 0.4, 0.58)
    expect(result.doc).toEqual({ flex: '0 0 calc(58% - 4px)' })
    expect(result.scratch).toEqual({ flex: '1 1 auto' })
  })

  test('Given 三栏全部可见 When 计算布局 Then browser 用 browserRatio，doc/scratch 在剩余空间内再按 docScratchRatio 二分', () => {
    const result = computeRightWorkspaceLayout(['browser', 'doc', 'scratch'], 0.4, 0.58)
    expect(result.browser).toEqual({ flex: '0 0 calc(40% - 4px)' })
    // 剩余 60% 空间内，doc:scratch = 0.58:0.42 → doc 应占整体的 60% * 58% = 34.8%
    expect(result.doc).toEqual({ flex: '0 0 calc(34.8% - 4px)' })
    expect(result.scratch).toEqual({ flex: '1 1 auto' })
  })

  test('Given 空数组 When 计算布局 Then 返回空对象', () => {
    expect(computeRightWorkspaceLayout([], 0.4, 0.58)).toEqual({})
  })
})
```

**Step 2: 运行确认失败**

Run: `bun test apps/electron/src/renderer/components/tabs/__tests__/right-workspace-layout.test.ts`
Expected: FAIL（模块不存在）

**Step 3: 实现**

```ts
// apps/electron/src/renderer/components/tabs/right-workspace-layout.ts
import type * as React from 'react'

export type RightWorkspacePanel = 'browser' | 'doc' | 'scratch'

/**
 * 计算右侧工作区最多三栏（browser / doc / scratch）的 flex 样式。
 *
 * 规则：
 * - 0 栏：返回空对象
 * - 1 栏：该栏 flex: 1 1 auto（占满）
 * - browser 和其余（doc/scratch 中可见的部分）两侧用 browserRatio 二分
 * - doc 和 scratch 两者都可见时，在各自所在的可用宽度内用 docScratchRatio 二分
 * - 每一侧「非最后一个可见栏」用 `flex: 0 0 calc(N% - 4px)`（4px 给拖拽分隔条留白，
 *   和现有 previewPaneStyle/scratchPaneStyle 的 -4px 约定一致），最后一个可见栏用
 *   `flex: 1 1 auto` 吃掉剩余空间，避免因浮点误差导致最后一栏差几像素。
 */
export function computeRightWorkspaceLayout(
  visiblePanels: RightWorkspacePanel[],
  browserRatio: number,
  docScratchRatio: number,
): Partial<Record<RightWorkspacePanel, React.CSSProperties>> {
  const result: Partial<Record<RightWorkspacePanel, React.CSSProperties>> = {}
  if (visiblePanels.length === 0) return result

  const hasBrowser = visiblePanels.includes('browser')
  const hasDoc = visiblePanels.includes('doc')
  const hasScratch = visiblePanels.includes('scratch')
  const restCount = (hasDoc ? 1 : 0) + (hasScratch ? 1 : 0)

  // browser 与「其余」的第一级切分
  let restWidthPercent = 100
  if (hasBrowser && restCount > 0) {
    const browserPercent = browserRatio * 100
    restWidthPercent = 100 - browserPercent
    const browserIsLast = visiblePanels[visiblePanels.length - 1] === 'browser'
    result.browser = browserIsLast
      ? { flex: '1 1 auto' }
      : { flex: `0 0 calc(${round1(browserPercent)}% - 4px)` }
  } else if (hasBrowser) {
    result.browser = { flex: '1 1 auto' }
  }

  // doc 与 scratch 在 restWidthPercent 范围内的第二级切分
  if (hasDoc && hasScratch) {
    const docPercent = restWidthPercent * docScratchRatio
    result.doc = { flex: `0 0 calc(${round1(docPercent)}% - 4px)` }
    result.scratch = { flex: '1 1 auto' }
  } else if (hasDoc) {
    result.doc = { flex: '1 1 auto' }
  } else if (hasScratch) {
    result.scratch = { flex: '1 1 auto' }
  }

  return result
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
```

**Step 4: 运行确认通过**

Run: `bun test apps/electron/src/renderer/components/tabs/__tests__/right-workspace-layout.test.ts`
Expected: PASS

**Step 5: 提交**

```bash
git add apps/electron/src/renderer/components/tabs/right-workspace-layout.ts apps/electron/src/renderer/components/tabs/__tests__/right-workspace-layout.test.ts
git commit -m "feat(tabbar): 新增右侧工作区三栏布局纯函数 computeRightWorkspaceLayout"
```

---

### Task 4: 新增 `browserWorkspaceSplitRatioAtom`

**Files:**
- Modify: `apps/electron/src/renderer/atoms/tab-atoms.ts:161-166`（`rightWorkspaceSplitRatioAtom` 定义处）

**Step 1: 实现（无需单测，`atomWithStorage` 是现有工具函数的直接复用，模式和相邻的 `rightWorkspaceSplitRatioAtom` 完全一致）**

```ts
// 在 rightWorkspaceSplitRatioAtom 定义之后追加：
/** 右侧工作区中 Browser 与其余面板（文档槽/Scratch）并排时，Browser 占比 */
export const browserWorkspaceSplitRatioAtom = atomWithStorage<number>(
  'myyoda-browser-workspace-split-ratio',
  0.5,
  undefined,
  { getOnInit: true },
)
```

**Step 2: 提交**

```bash
git add apps/electron/src/renderer/atoms/tab-atoms.ts
git commit -m "feat(tabbar): 新增 browserWorkspaceSplitRatioAtom"
```

---

### Task 5: `ExcalidrawEditor` 支持受控 props（不破坏现有全屏画廊流程）

**Files:**
- Modify: `apps/electron/src/renderer/components/excalidraw/ExcalidrawEditor.tsx`

**背景（务必先读）：** 当前组件靠 `sessionStorage.getItem('excalidraw:editingSlug')` 一次性读取要打开的文件，靠 `activeViewAtom` 硬编码"返回画廊"。改造目标：加一组**可选** props，不传时行为与今天完全一致（`ExcalidrawView.tsx` 里的全屏路由用法不用改一行）；传入时进入"受控模式"，供 Task 6 的 `CanvasPanel` 使用。

**Step 1: 在组件顶部新增 props 接口，函数签名接收 props**

```tsx
// 替换原来的 `export function ExcalidrawEditor(): React.ReactElement {`
export interface ExcalidrawEditorProps {
  /** 受控模式：直接指定要打开的 slug（null = 全新未命名画布）。
   *  不传（undefined）= 非受控，沿用 sessionStorage 'excalidraw:editingSlug' 的老行为。 */
  controlledSlug?: string | null
  /** 受控模式下点击"返回/关闭"按钮时调用；不传则沿用 setActiveView('excalidraw-gallery') 老行为。 */
  onExit?: () => void
  /** 首次创建成功或重命名后，把最新 slug/title 同步给外部（面板模式用于写回 canvasFileMapAtom）。 */
  onSlugChange?: (ref: { slug: string; title: string }) => void
  /** 面板模式下额外展示"浏览全部画布"入口，点击调用。不传则不展示该按钮。 */
  onBrowseAll?: () => void
}

export function ExcalidrawEditor({
  controlledSlug,
  onExit,
  onSlugChange,
  onBrowseAll,
}: ExcalidrawEditorProps = {}): React.ReactElement {
```

**Step 2: 改造"加载数据"的 effect，受控模式跳过 sessionStorage**

原代码（约第 82-105 行）：

```tsx
  React.useEffect(() => {
    if (!workspaceSlug) return

    const editingSlug = sessionStorage.getItem('excalidraw:editingSlug')
    if (!editingSlug) {
      setLoading(false)
      setIsNew(true)
      return
    }

    setSlug(editingSlug)
    sessionStorage.removeItem('excalidraw:editingSlug')

    window.electronAPI
      .readExcalidrawFile(workspaceSlug, editingSlug)
      .then((data) => { /* ... */ })
      .catch(...)
      .finally(() => setLoading(false))
  }, [workspaceSlug])
```

改为：

```tsx
  React.useEffect(() => {
    if (!workspaceSlug) return

    // 受控模式：controlledSlug !== undefined 时，直接用它，不读 sessionStorage。
    const editingSlug = controlledSlug !== undefined ? controlledSlug : sessionStorage.getItem('excalidraw:editingSlug')
    if (!editingSlug) {
      setLoading(false)
      setIsNew(true)
      return
    }

    setSlug(editingSlug)
    if (controlledSlug === undefined) sessionStorage.removeItem('excalidraw:editingSlug')

    window.electronAPI
      .readExcalidrawFile(workspaceSlug, editingSlug)
      .then((data) => {
        if (data) {
          setIsNew(false)
          const realTitle = data.title || editingSlug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
          setTitle(realTitle)
          loadedTitleRef.current = realTitle
          setInitialData({
            elements: (data.elements || []) as Record<string, unknown>[],
            appState: (data.appState as Record<string, unknown>) || { viewBackgroundColor: '#ffffff' },
            files: (data.files as Record<string, unknown>) || {},
          })
        }
      })
      .catch((err) => console.error('[ExcalidrawEditor] 加载失败:', err))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceSlug])
```

> `controlledSlug` 有意不放进依赖数组：受控模式下这个 effect 只应该在挂载时按初始 slug 加载一次，`CanvasPanel` 通过 `key={sessionId}` 换会话时整体重新挂载（和 `ExcalidrawView.tsx` 里 `key={currentWorkspaceId}` 的既有约定一致），不依赖这个 effect 响应 `controlledSlug` 变化。

**Step 3: `handleSave` 里两处 `setSlug` 之后追加 `onSlugChange` 回调**

第一处（CREATE 分支，约第 349-356 行）：

```tsx
      if (isNew || !currentSlug) {
        const result = await window.electronAPI.createExcalidrawFile(workspaceSlug, trimmedTitle)
        currentSlug = result.slug
        setSlug(result.slug)
        setIsNew(false)
        loadedTitleRef.current = result.title
        setTitle(result.title)
        onSlugChange?.({ slug: result.slug, title: result.title })
      } else if (trimmedTitle !== loadedTitleRef.current) {
        const result = await window.electronAPI.renameExcalidrawFile(workspaceSlug, currentSlug, trimmedTitle)
        currentSlug = result.slug
        setSlug(result.slug)
        loadedTitleRef.current = result.title
        setTitle(result.title)
        onSlugChange?.({ slug: result.slug, title: result.title })
      }
```

**Step 4: 改造 `handleBack`，受控模式下调用 `onExit`**

```tsx
  const handleBack = React.useCallback(async () => {
    if (dirtyRef.current) {
      setSaving(true)
      try {
        await handleSaveRef.current(true)
      } catch {
        // handleSave 内部已有错误提示
      } finally {
        setSaving(false)
      }
    }
    if (onExit) {
      onExit()
      return
    }
    sessionStorage.removeItem('excalidraw:editingSlug')
    setActiveView('excalidraw-gallery')
  }, [onExit, setActiveView])
```

**Step 5: 顶部栏按钮图标 + "浏览全部画布" 入口**

原顶部栏返回按钮（约第 300-308 行）：

```tsx
          <button
            type="button"
            className="text-foreground/50 hover:text-foreground transition-colors shrink-0 disabled:opacity-40"
            onClick={handleBack}
            disabled={saving}
            aria-label="返回画廊"
          >
            {saving ? <Loader2 size={18} className="animate-spin" /> : <ArrowLeft size={18} />}
          </button>
```

改为（`onExit` 存在时用 X + "关闭画布" 语义，不存在时保持原样）：

```tsx
          <button
            type="button"
            className="text-foreground/50 hover:text-foreground transition-colors shrink-0 disabled:opacity-40"
            onClick={handleBack}
            disabled={saving}
            aria-label={onExit ? '关闭画布' : '返回画廊'}
          >
            {saving ? <Loader2 size={18} className="animate-spin" /> : onExit ? <X size={18} /> : <ArrowLeft size={18} />}
          </button>
```

在标题输入框和 `isNew` 徽标之间/之后追加"浏览全部画布"按钮（仅 `onBrowseAll` 存在时渲染）：

```tsx
          {onBrowseAll && (
            <button
              type="button"
              className="text-[11px] text-foreground/50 hover:text-primary transition-colors shrink-0 whitespace-nowrap"
              onClick={onBrowseAll}
            >
              浏览全部画布
            </button>
          )}
```

**Step 6: 顶部 import 追加 `X` 图标**

```tsx
import { ArrowLeft, PenTool, Loader2, X } from 'lucide-react'
```

**Step 7: 手动验证不破坏原有全屏流程**

- 启动应用，左侧栏点"Yoda 画布" → 画廊 → 新建/打开一个画布，确认加载、保存、返回画廊都正常（这条路径 `controlledSlug`/`onExit` 均为 `undefined`，代码逻辑应与改造前完全一致）。

**Step 8: 提交**

```bash
git add apps/electron/src/renderer/components/excalidraw/ExcalidrawEditor.tsx
git commit -m "refactor(canvas): ExcalidrawEditor 支持受控 props，兼容面板内嵌使用"
```

---

### Task 6: 新增 `CanvasPanel` 组件

**Files:**
- Create: `apps/electron/src/renderer/components/excalidraw/CanvasPanel.tsx`

**参照：** `apps/electron/src/renderer/components/diff/PreviewPanel.tsx` 的整体结构（per-session、顶层是一个 flex 容器包裹内容），但顶栏交给 `ExcalidrawEditor` 自己渲染（Task 5 已经加好"关闭/浏览全部画布"按钮），本组件只负责状态接线，不重复渲染顶栏。

```tsx
/**
 * CanvasPanel — 文档槽内嵌画布面板
 *
 * 复用 ExcalidrawEditor 的受控模式，在右侧工作区"文档槽"内展示画布，
 * 不经过全屏画廊路由。每会话记住当前打开的画布文件（canvasFileMapAtom），
 * 关闭后再打开可以恢复到原来的画布。
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { agentWorkspacesAtom, currentAgentWorkspaceIdAtom } from '@/atoms/agent-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { canvasFileMapAtom, canvasPanelOpenMapAtom } from '@/atoms/canvas-panel-atoms'
import { ExcalidrawEditor } from './ExcalidrawEditor'

interface CanvasPanelProps {
  sessionId: string
}

export function CanvasPanel({ sessionId }: CanvasPanelProps): React.ReactElement {
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const workspaceSlug = React.useMemo(() => {
    if (!currentWorkspaceId) return null
    return workspaces.find((w) => w.id === currentWorkspaceId)?.slug ?? null
  }, [currentWorkspaceId, workspaces])

  const [canvasFileMap, setCanvasFileMap] = useAtom(canvasFileMapAtom)
  const setCanvasOpenMap = useSetAtom(canvasPanelOpenMapAtom)
  const setActiveView = useSetAtom(activeViewAtom)

  const current = canvasFileMap.get(sessionId) ?? null

  const handleSlugChange = React.useCallback(
    (ref: { slug: string; title: string }) => {
      if (!workspaceSlug) return
      setCanvasFileMap((prev) => {
        const next = new Map(prev)
        next.set(sessionId, { workspaceSlug, slug: ref.slug })
        return next
      })
    },
    [sessionId, workspaceSlug, setCanvasFileMap],
  )

  const handleExit = React.useCallback(() => {
    setCanvasOpenMap((prev) => {
      const next = new Map(prev)
      next.set(sessionId, false)
      return next
    })
  }, [sessionId, setCanvasOpenMap])

  const handleBrowseAll = React.useCallback(() => {
    setActiveView('excalidraw-gallery')
  }, [setActiveView])

  if (!workspaceSlug) {
    return <div className="flex items-center justify-center h-full text-foreground/40 text-sm">画布不可用：当前会话未绑定工作区</div>
  }

  return (
    <div className="flex flex-col h-full min-w-0 overflow-hidden titlebar-no-drag">
      <ExcalidrawEditor
        // sessionId 变化时整体重新挂载，避免残留上一个会话的编辑器内部状态（对齐
        // ExcalidrawView.tsx 里 key={currentWorkspaceId} 的既有约定）。
        key={sessionId}
        controlledSlug={current?.slug ?? null}
        onExit={handleExit}
        onSlugChange={handleSlugChange}
        onBrowseAll={handleBrowseAll}
      />
    </div>
  )
}
```

**提交：**

```bash
git add apps/electron/src/renderer/components/excalidraw/CanvasPanel.tsx
git commit -m "feat(canvas): 新增 CanvasPanel 文档槽内嵌画布组件"
```

---

### Task 7: `TabBar.tsx` 新增画布开关按钮

**Files:**
- Modify: `apps/electron/src/renderer/components/tabs/TabBar.tsx`

**Step 1: import 新 atom 和图标**

```tsx
// 原有 import 行：
import { Globe2, PanelRight, SquareTerminal } from 'lucide-react'
// 改为：
import { Globe2, PanelRight, PenTool, SquareTerminal } from 'lucide-react'

// 新增：
import { canvasPanelOpenMapAtom } from '@/atoms/canvas-panel-atoms'
import { previewPanelOpenMapAtom } from '@/atoms/preview-atoms'
```

**Step 2: 组件内新增状态和点击处理**

在 `showTerminalButton` 声明之后（原文件约第 279 行附近）追加：

```tsx
  // 画布按钮：固定排终端左边，显示条件与终端/浏览器一致（有 Agent 会话即可）。
  const showCanvasButton = Boolean(activeAgentSession)
  const [canvasOpenMap, setCanvasOpenMap] = useAtom(canvasPanelOpenMapAtom)
  const setPreviewOpenMapForCanvas = useSetAtom(previewPanelOpenMapAtom)
  const isCanvasOpen = activeAgentSession ? canvasOpenMap.get(activeAgentSession.id) === true : false
```

在 `getTabBarActionLayout` 调用处（原第 294 行）追加第 5 个参数：

```tsx
  const actionLayout = getTabBarActionLayout(effectiveIsWindows, showOpenPanelButton, showBrowserButton, showTerminalButton, showCanvasButton)
```

在 `openTerminal` 定义之后（原第 327 行附近）新增点击处理：

```tsx
  // 画布按钮：toggle 当前会话文档槽的画布展示。打开画布时顺带关闭 Preview
  // （文档槽同一时刻只展示一份内容），关闭画布不影响 Preview 的记忆状态。
  const toggleCanvas = React.useCallback(() => {
    if (!activeAgentSession) return
    const sessionId = activeAgentSession.id
    const nextOpen = canvasOpenMap.get(sessionId) !== true
    setCanvasOpenMap((previous) => {
      const next = new Map(previous)
      next.set(sessionId, nextOpen)
      return next
    })
    if (nextOpen) {
      setPreviewOpenMapForCanvas((previous) => {
        const next = new Map(previous)
        next.set(sessionId, false)
        return next
      })
    }
  }, [activeAgentSession, canvasOpenMap, setCanvasOpenMap, setPreviewOpenMapForCanvas])
```

**Step 3: 把 `toggleCanvas` / `isCanvasOpen` / `showCanvasButton` 传给 `ShortcutGuideButton`**

原调用（约第 543-550 行）：

```tsx
      <ShortcutGuideButton
        positionClassName={actionLayout.shortcutPositionClassName}
        showBrowserButton={showBrowserButton}
        hasMinimizedBrowser={hasMinimizedBrowser}
        showTerminalButton={showTerminalButton}
        isTerminalOpen={activeAgentSession ? terminalOpenMap.get(activeAgentSession.id) === true : false}
        onOpenBrowser={openBrowser}
        onOpenTerminal={openTerminal}
      />
```

改为：

```tsx
      <ShortcutGuideButton
        positionClassName={actionLayout.shortcutPositionClassName}
        showBrowserButton={showBrowserButton}
        hasMinimizedBrowser={hasMinimizedBrowser}
        showTerminalButton={showTerminalButton}
        isTerminalOpen={activeAgentSession ? terminalOpenMap.get(activeAgentSession.id) === true : false}
        showCanvasButton={showCanvasButton}
        isCanvasOpen={isCanvasOpen}
        onOpenBrowser={openBrowser}
        onOpenTerminal={openTerminal}
        onToggleCanvas={toggleCanvas}
      />
```

**Step 4: 扩展 `ShortcutGuideButton` 函数组件，画布按钮排最左**

原函数签名和渲染体（约第 561-624 行）：

```tsx
function ShortcutGuideButton({
  positionClassName,
  showBrowserButton,
  hasMinimizedBrowser,
  showTerminalButton,
  isTerminalOpen,
  onOpenBrowser,
  onOpenTerminal,
}: {
  positionClassName: string
  showBrowserButton: boolean
  hasMinimizedBrowser: boolean
  showTerminalButton: boolean
  isTerminalOpen: boolean
  onOpenBrowser: () => void
  onOpenTerminal: () => void
}): React.ReactElement {
  if (!showBrowserButton) return <></>
  return (
    <div className={cn("absolute flex items-center gap-1 titlebar-no-drag", positionClassName)}>
      {showTerminalButton && (
        <Tooltip>
          {/* ...终端按钮... */}
        </Tooltip>
      )}
      <Tooltip>
        {/* ...浏览器按钮... */}
      </Tooltip>
    </div>
  )
}
```

改为（新增 4 个 props，画布按钮渲染在终端按钮之前；`showBrowserButton` 仍是整组的总开关，保持不变——三个按钮目前的显示条件都等价于 `Boolean(activeAgentSession)`，用同一个总开关判断即可，不引入新的整体开关变量）：

```tsx
function ShortcutGuideButton({
  positionClassName,
  showBrowserButton,
  hasMinimizedBrowser,
  showTerminalButton,
  isTerminalOpen,
  showCanvasButton,
  isCanvasOpen,
  onOpenBrowser,
  onOpenTerminal,
  onToggleCanvas,
}: {
  positionClassName: string
  showBrowserButton: boolean
  hasMinimizedBrowser: boolean
  showTerminalButton: boolean
  isTerminalOpen: boolean
  showCanvasButton: boolean
  isCanvasOpen: boolean
  onOpenBrowser: () => void
  onOpenTerminal: () => void
  onToggleCanvas: () => void
}): React.ReactElement {
  if (!showBrowserButton) return <></>
  return (
    <div className={cn("absolute flex items-center gap-1 titlebar-no-drag", positionClassName)}>
      {showCanvasButton && showTerminalButton && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn('h-7 w-7', isCanvasOpen && 'bg-accent text-accent-foreground')}
              onClick={() => onToggleCanvas()}
            >
              <PenTool className="size-3.5" />
              <span className="sr-only">打开画布</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>{isCanvasOpen ? '关闭画布' : '打开画布'}</p>
          </TooltipContent>
        </Tooltip>
      )}
      {showTerminalButton && (
        <Tooltip>
          {/* ...终端按钮，原样不动... */}
        </Tooltip>
      )}
      <Tooltip>
        {/* ...浏览器按钮，原样不动... */}
      </Tooltip>
    </div>
  )
}
```

> `showCanvasButton && showTerminalButton` 的双重判断是刻意的：画布按钮固定排终端左边，Task 1 的 `getTabBarActionLayout` 也是按"画布跟随终端"算宽度的，两处逻辑必须一致——如果以后终端按钮的显示条件和画布不一样，这里能防止画布按钮在终端不存在时"悬空"出现在错误位置。

**Step 5: 手动验证**

- 打开一个 Agent 会话，确认按钮顺序是 `[画布] [终端] [浏览器]`，画布按钮点击后 toggle 高亮态和终端/浏览器视觉一致。
- Windows 模拟（或至少 review 一遍 `getTabBarActionLayout` 的 Windows 分支数值）确认按钮不会和窗口控制按钮重叠。

**Step 6: 提交**

```bash
git add apps/electron/src/renderer/components/tabs/TabBar.tsx
git commit -m "feat(tabbar): 新增画布开关按钮"
```

---

### Task 8: `MainArea.tsx` 去除 Browser 互斥、接入三栏布局与 CanvasPanel

**Files:**
- Modify: `apps/electron/src/renderer/components/tabs/MainArea.tsx`

**Step 1: import 新增内容**

```tsx
// 新增：
import { canvasPanelOpenMapAtom, canvasFileMapAtom } from '@/atoms/canvas-panel-atoms'
import { CanvasPanel } from '@/components/excalidraw/CanvasPanel'
import { browserWorkspaceSplitRatioAtom } from '@/atoms/tab-atoms'
import { computeRightWorkspaceLayout, type RightWorkspacePanel } from './right-workspace-layout'
```

**Step 2: 去掉 Browser 对 Preview / Scratch 的互斥（原第 178-190 行）**

原代码：

```tsx
  const previewOpen =
    activeTab?.type === 'agent'
    && (previewOpenMap.get(activeTab.sessionId) ?? false)
    && !showBrowserPanel
    && !showBrowserClosing
  const previewSessionId = activeTab?.type === 'agent' ? activeTab.sessionId : null
  const scratchPanelOpen = useAtomValue(scratchPadPanelOpenAtom)
  const showScratchPanel =
    activeTab?.type === 'agent'
    && scratchPanelOpen
    && activeView === 'conversations'
    && !showBrowserPanel
    && !showBrowserClosing
```

改为（去掉两处 `!showBrowserPanel && !showBrowserClosing`；新增 canvas 相关派生状态）：

```tsx
  const previewOpen =
    activeTab?.type === 'agent'
    && (previewOpenMap.get(activeTab.sessionId) ?? false)
  const previewSessionId = activeTab?.type === 'agent' ? activeTab.sessionId : null
  const scratchPanelOpen = useAtomValue(scratchPadPanelOpenAtom)
  const showScratchPanel =
    activeTab?.type === 'agent'
    && scratchPanelOpen
    && activeView === 'conversations'

  // 画布：文档槽的第二种内容类型，与 Preview 互斥展示（互斥关系由 TabBar.tsx 的
  // toggleCanvas / useOpenPreview 在打开时互相关闭对方维护，这里只读状态）。
  const canvasOpenMap = useAtomValue(canvasPanelOpenMapAtom)
  const canvasSessionId = activeTab?.type === 'agent' ? activeTab.sessionId : null
  const canvasOpen =
    activeTab?.type === 'agent'
    && (canvasOpenMap.get(activeTab.sessionId) ?? false)
    && activeView === 'conversations'
```

**Step 3: 调整 `showPreview` / `showPreviewPane` 的计算（原第 267-269 行附近），新增 `showCanvasPane`**

原代码：

```tsx
  const showPreview = (previewOpen || closing) && previewSessionId && activeView === 'conversations'
  const showPreviewClosingOnly = closing && !previewOpen
  const showPreviewPane = !!showPreview && !(showPreviewClosingOnly && showScratchPanel)
  const showBothRightPanels = showPreviewPane && showScratchPanel
```

改为：

```tsx
  const showPreview = (previewOpen || closing) && previewSessionId && activeView === 'conversations'
  const showPreviewClosingOnly = closing && !previewOpen
  const showPreviewPane = !!showPreview && !(showPreviewClosingOnly && showScratchPanel) && !canvasOpen
  const showCanvasPane = canvasOpen && !!canvasSessionId
  // "文档槽"= Preview 或 Canvas 二选一展示；showBothRightPanels 改名语义扩展为
  // "文档槽 + Scratch 同时存在"，用于旧的两栏拖拽逻辑判断（Browser 的三栏逻辑见下方新增变量）。
  const showDocSlot = showPreviewPane || showCanvasPane
  const showBothRightPanels = showDocSlot && showScratchPanel
```

**Step 4: `showRightPanel` 纳入 canvas（原第 375 行）**

```tsx
  const showRightPanel = showBrowserPanel || showBrowserClosing || showScratchPanel || showPreviewPane || showCanvasPane
```

**Step 5: 新增三栏布局计算，替换原 `previewPaneStyle` / `scratchPaneStyle`（原第 379-384 行）**

原代码：

```tsx
  const previewPaneStyle: React.CSSProperties = showBothRightPanels
    ? { flex: `0 0 calc(${rightWorkspaceRatio * 100}% - 4px)` }
    : { flex: '1 1 auto' }
  const scratchPaneStyle: React.CSSProperties = showBothRightPanels
    ? { flex: `0 0 calc(${(1 - rightWorkspaceRatio) * 100}% - 4px)` }
    : { flex: '1 1 auto' }
```

改为：

```tsx
  const [browserWorkspaceRatio, setBrowserWorkspaceRatio] = useAtom(browserWorkspaceSplitRatioAtom)
  const visibleRightPanels = React.useMemo<RightWorkspacePanel[]>(() => {
    const panels: RightWorkspacePanel[] = []
    if (showBrowserPanel || showBrowserClosing) panels.push('browser')
    if (showDocSlot) panels.push('doc')
    if (showScratchPanel) panels.push('scratch')
    return panels
  }, [showBrowserPanel, showBrowserClosing, showDocSlot, showScratchPanel])
  const rightWorkspaceLayout = React.useMemo(
    () => computeRightWorkspaceLayout(visibleRightPanels, browserWorkspaceRatio, rightWorkspaceRatio),
    [visibleRightPanels, browserWorkspaceRatio, rightWorkspaceRatio],
  )
  const docPaneStyle: React.CSSProperties = rightWorkspaceLayout.doc ?? { flex: '1 1 auto' }
  const scratchPaneStyle: React.CSSProperties = rightWorkspaceLayout.scratch ?? { flex: '1 1 auto' }
  const browserPaneStyle: React.CSSProperties = rightWorkspaceLayout.browser ?? { flex: '1 1 auto' }
```

> `rightWorkspaceRatio` / `setRightWorkspaceRatio` 已在文件顶部声明（原 `useAtom(rightWorkspaceSplitRatioAtom)`），这里直接复用，不用重新解构。

**Step 6: 渲染部分——把 Browser 从"独占整个右侧工作区"改成"参与三栏排列"，插入 CanvasPanel（原第 477-505 行附近）**

原代码结构大意（简化展示关键点）：

```tsx
<div className="flex flex-1 min-w-0 h-full overflow-hidden" data-right-workspace>
  {(showBrowserPanel || showBrowserClosing) && browserPanelSessionId && (
    <div className="min-w-0 h-full overflow-hidden flex-1">
      <BrowserPanel key={browserPanelSessionId} ... />
    </div>
  )}
  {showPreviewPane && previewSessionId && (
    <div className="min-w-0 h-full overflow-hidden" style={previewPaneStyle}>
      <PreviewPanel sessionId={previewSessionId} />
    </div>
  )}
  {showBothRightPanels && (
    <div className="w-[8px] cursor-col-resize ..." onMouseDown={handleRightWorkspaceDragStart} />
  )}
  {showScratchPanel && (
    <div className="min-w-0 h-full overflow-hidden" style={scratchPaneStyle}>
      <ScratchPadPane onClose={handleCloseScratchPanel} />
    </div>
  )}
</div>
```

改为（Browser 用 `browserPaneStyle`；Browser 和"文档槽/Scratch"之间也需要一条分隔条；文档槽内部按 Preview/Canvas 二选一渲染）：

```tsx
<div className="flex flex-1 min-w-0 h-full overflow-hidden" data-right-workspace>
  {(showBrowserPanel || showBrowserClosing) && browserPanelSessionId && (
    <div className="min-w-0 h-full overflow-hidden" style={browserPaneStyle}>
      <BrowserPanel
        key={browserPanelSessionId}
        sessionId={browserPanelSessionId}
        state={browserPanelState}
        isClosing={showBrowserClosing}
        onMinimize={() => minimizeBrowser(browserPanelSessionId)}
        onClose={() => requestCloseBrowser(browserPanelSessionId)}
      />
    </div>
  )}
  {(showBrowserPanel || showBrowserClosing) && (showDocSlot || showScratchPanel) && (
    <div
      className="w-[8px] cursor-col-resize bg-border/40 hover:bg-primary/30 active:bg-primary/50 transition-colors flex-shrink-0 self-stretch"
      onMouseDown={handleBrowserWorkspaceDragStart}
    />
  )}
  {showPreviewPane && previewSessionId && (
    <div className="min-w-0 h-full overflow-hidden" style={docPaneStyle}>
      <PreviewPanel sessionId={previewSessionId} />
    </div>
  )}
  {showCanvasPane && canvasSessionId && (
    <div className="min-w-0 h-full overflow-hidden" style={docPaneStyle}>
      <CanvasPanel sessionId={canvasSessionId} />
    </div>
  )}
  {showBothRightPanels && (
    <div
      className="w-[8px] cursor-col-resize bg-border/40 hover:bg-primary/30 active:bg-primary/50 transition-colors flex-shrink-0 self-stretch"
      onMouseDown={handleRightWorkspaceDragStart}
    />
  )}
  {showScratchPanel && (
    <div className="min-w-0 h-full overflow-hidden" style={scratchPaneStyle}>
      <ScratchPadPane onClose={handleCloseScratchPanel} />
    </div>
  )}
</div>
```

**Step 7: 新增 `handleBrowserWorkspaceDragStart`**

在 `handleRightWorkspaceDragStart` 定义之后（原第 349 行附近）追加一个几乎相同、只是操作 `browserWorkspaceRatio` 的拖拽 handler：

```tsx
  const browserWorkspaceDragging = React.useRef(false)
  const handleBrowserWorkspaceDragStart = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    browserWorkspaceDragging.current = true
    const startX = e.clientX
    const startRatio = browserWorkspaceRatio
    const containerEl = (e.currentTarget as HTMLElement).closest('[data-right-workspace]') as HTMLElement | null
    const containerWidth = containerEl?.clientWidth ?? 1
    let rafId = 0

    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    document.querySelectorAll('iframe').forEach((f) => { (f as HTMLElement).style.pointerEvents = 'none' })

    const onMouseMove = (ev: MouseEvent) => {
      if (!browserWorkspaceDragging.current) return
      if (rafId) return
      rafId = requestAnimationFrame(() => {
        rafId = 0
        const delta = ev.clientX - startX
        const newRatio = Math.max(0.3, Math.min(0.7, startRatio + delta / containerWidth))
        setBrowserWorkspaceRatio(newRatio)
      })
    }
    const onMouseUp = () => {
      browserWorkspaceDragging.current = false
      if (rafId) cancelAnimationFrame(rafId)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      document.querySelectorAll('iframe').forEach((f) => { (f as HTMLElement).style.pointerEvents = '' })
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [browserWorkspaceRatio, setBrowserWorkspaceRatio])
```

> 这一段和已有的 `handleRightWorkspaceDragStart` 几乎是复制粘贴（只换了 ratio 来源），偏工程重复但风险最低——严格复用已验证过的拖拽实现，不在这次改动里额外做拖拽 hook 抽象重构（YAGNI，抽象留到出现第三处相同代码时再做）。

**Step 8: 手动验证（对照 spec 验收标准逐条过）**

1. 打开受管浏览器 → Preview（或点画布按钮）→ Scratch，确认三者可同时打开、各自能独立关闭、拖拽分隔条工作正常。
2. 只开 Browser：占满右侧宽度，无分隔条残留。
3. Browser + Scratch（不开文档槽）：两栏按 `browserWorkspaceRatio` 分。
4. 文档槽 + Scratch（不开 Browser）：行为应与改造前完全一致（用的还是原来的 `rightWorkspaceRatio`）。
5. 画布打开时 Agent 触发新文件 diff：确认 Preview 顶替画布显示（这一步依赖 Task 9 的联动，Task 8 先只验证"两者互斥展示"的静态渲染逻辑不报错）。
6. 关闭浏览器面板时的滑出动画（`browserClosingState`）在三栏都开着的情况下不产生布局跳变或残留空白。

**Step 9: 提交**

```bash
git add apps/electron/src/renderer/components/tabs/MainArea.tsx
git commit -m "feat(workspace): 右侧面板从槽位互斥改为最多三栏共存，接入 CanvasPanel"
```

---

### Task 9: Preview 打开时联动关闭画布（维持"文档槽互斥"的另一半）

**背景：** Task 7 已经做了"打开画布 → 关闭 Preview"；这里要补上反方向——"打开 Preview → 关闭画布"，覆盖 Agent 自动触发新 diff、用户手动 `@` 引用文件、拖拽 tear-off 等所有会把 `previewPanelOpenMapAtom` 置为 `true` 的入口。

**Files:**
- Modify: `apps/electron/src/renderer/components/diff/preview-opener.ts`
- Modify: `apps/electron/src/renderer/components/agent/AgentView.tsx`（`togglePreviewPanel`，约第 2966-2978 行）

**Step 1: `preview-opener.ts` 的 `useOpenPreview`（唯一统一入口）**

原代码（`preferSplit` 分支，约第 63-70 行）：

```ts
      if (preferSplit) {
        // 分屏：开启预览面板，不创建 Tab
        store.set(previewPanelOpenMapAtom, (prev) => {
          const m = new Map(prev)
          m.set(sessionId, true)
          return m
        })
        return
      }
```

改为（额外关闭画布）：

```ts
      if (preferSplit) {
        // 分屏：开启预览面板，不创建 Tab；文档槽同一时刻只展示一份内容，顺带关闭画布。
        store.set(previewPanelOpenMapAtom, (prev) => {
          const m = new Map(prev)
          m.set(sessionId, true)
          return m
        })
        store.set(canvasPanelOpenMapAtom, (prev) => {
          const m = new Map(prev)
          m.set(sessionId, false)
          return m
        })
        return
      }
```

顶部 import 追加：

```ts
import { canvasPanelOpenMapAtom } from '@/atoms/canvas-panel-atoms'
```

**Step 2: `tearOffPreviewToSplit`（同文件，开启右侧分屏那一步，约第 123-127 行）**

原代码：

```ts
  // 开启右侧分屏
  store.set(previewPanelOpenMapAtom, (prev) => {
    const m = new Map(prev)
    m.set(sessionId, true)
    return m
  })
```

改为：

```ts
  // 开启右侧分屏；文档槽互斥，顺带关闭画布
  store.set(previewPanelOpenMapAtom, (prev) => {
    const m = new Map(prev)
    m.set(sessionId, true)
    return m
  })
  store.set(canvasPanelOpenMapAtom, (prev) => {
    const m = new Map(prev)
    m.set(sessionId, false)
    return m
  })
```

**Step 3: `AgentView.tsx` 的 `togglePreviewPanel`（手动快捷键 toggle，只在"变为打开"时关闭画布）**

原代码：

```tsx
  const togglePreviewPanel = React.useCallback(() => {
    setPreviewOpenMap((prev) => {
      const m = new Map(prev)
      const current = m.get(sessionId) ?? false
      m.set(sessionId, !current)
      return m
    })
  }, [sessionId, setPreviewOpenMap])
```

改为：

```tsx
  const setCanvasOpenMapForToggle = useSetAtom(canvasPanelOpenMapAtom)

  const togglePreviewPanel = React.useCallback(() => {
    let willOpen = false
    setPreviewOpenMap((prev) => {
      const m = new Map(prev)
      const current = m.get(sessionId) ?? false
      willOpen = !current
      m.set(sessionId, willOpen)
      return m
    })
    if (willOpen) {
      setCanvasOpenMapForToggle((prev) => {
        const m = new Map(prev)
        m.set(sessionId, false)
        return m
      })
    }
  }, [sessionId, setPreviewOpenMap, setCanvasOpenMapForToggle])
```

`AgentView.tsx` 顶部 import 追加：

```tsx
import { canvasPanelOpenMapAtom } from '@/atoms/canvas-panel-atoms'
```

**Step 4: 手动验证**

1. 打开画布 → 在同一会话触发一次 Agent 文件修改（或手动 `@` 引用一个文件到 Preview）→ 确认文档槽自动切到 Preview，画布按钮的高亮态同步取消。
2. 再次点击画布按钮 → 确认恢复到之前那个画布文件（不是新建空画布），Preview 按钮/状态相应关闭。
3. 反复切换 3-4 次，确认没有出现"两者都显示"或"两者都不显示"的中间态。

**Step 5: 提交**

```bash
git add apps/electron/src/renderer/components/diff/preview-opener.ts apps/electron/src/renderer/components/agent/AgentView.tsx
git commit -m "feat(canvas): Preview 打开时联动关闭画布，维持文档槽互斥"
```

---

### Task 10: 全量验证 + 对照 spec 验收标准收尾

**Files:** 无新增，全项目验证

**Step 1: 跑全量测试**

Run: `bun test`
Expected: 全部 PASS，尤其确认 Task 1/3 新增的两个测试文件、以及之前提到的 `sidebar-features-model.test.ts` 等既有画布相关测试没有被间接破坏。

**Step 2: 类型检查**

Run: 仓库现有的类型检查命令（如 `bun run typecheck` 或 `tsc --noEmit`，先确认 `package.json` 里的实际脚本名）
Expected: 无新增类型错误。

**Step 3: 逐条对照 spec 验收标准手动验证**

对照 `docs/superpowers/specs/2026-08-20-workspace-panel-canvas-toggle-design.md` 的"验收标准"章节，逐条过一遍（前面各 Task 的 Step 已覆盖大部分，这里做一次完整串联回归）：

- [ ] 打开受管浏览器后，Preview（或画布）和 Scratch 面板仍可独立打开/关闭，三者可同时可见，各自宽度可拖拽调整
- [ ] 会话内点击画布按钮：首次直接新建画布并打开；再次点击恢复上次的画布；按钮激活态视觉和终端/浏览器一致
- [ ] 画布打开时若 Agent 触发新的文件 diff，Preview 自动顶替画布显示在文档槽；用户再次点击画布按钮可切回画布，画布内容不丢失
- [ ] 左侧栏"Yoda 画布"→ 全屏画廊入口行为不变；面板内"浏览全部画布"能正确跳转到该路由
- [ ] 终端面板布局、行为不受影响

**Step 4: 检查是否有视觉闪烁（已知风险点，来自 spec 设计阶段的备注）**

切换 Preview ↔ Canvas 时观察是否有 Preview 关闭动画（`closingState`）和 Canvas 内容同时短暂重叠的闪烁。如果有：
- 优先方案：在 `MainArea.tsx` 判断 `closing` 状态时，如果紧接着 `canvasOpen` 变为 `true`（同一 sessionId），跳过这一次 Preview 的 slide-out 动画（直接同步切换，不经过 `closingState`）。
- 这是一个体验打磨项，不阻塞主线功能验收；如果时间有限可以先记录为已知问题，不在本轮阻塞提交。

**Step 5: 最终提交（如有遗留修复）**

```bash
git add -A
git commit -m "fix(workspace): 收尾修复 —— 右侧面板共存 + 画布快速开关"
```

---

## 执行方式

计划完成后按 writing-plans 约定，向用户提供两种执行方式选择：Subagent-Driven（当前会话逐任务派发子 Agent + 代码审查）或 Parallel Session（新开会话用 executing-plans 批量执行 + checkpoint）。

