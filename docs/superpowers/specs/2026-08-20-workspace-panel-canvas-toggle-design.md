# 右侧工作区面板共存 + 画布快速开关设计

## 背景

用户在体验 newmax、Synara 等同类桌面 Agent 产品后，反馈 MyYoda 当前有两处明确可改进：

1. **受管浏览器面板打开后，当前会话的文件预览（Preview，md/html/diff 等）就无法同时显示**——两者在 `MainArea.tsx` 里被设计成互斥槽位。
2. **画布（Yoda 画布 / Excalidraw）的创建体验偏重**：左侧栏图标点击后直接全屏接管主区域（`activeView` 切到 `excalidraw-gallery`），需要先看画廊网格，再新建或选择才能进入编辑器，会话上下文在此期间完全消失。newmax 的画布创建是"点了就落地"，不经过画廊。

参考对象：

- **newmax**：统一"+"新建菜单（新建对话/新建绘图/新建文档/新建终端/网页浏览），新建对象直接以 tab 形式打开；文件右键菜单已把"文件"和"AI 对话"打通（打开文件/添加至 AI 对话/以 @ 引用插入聊天框/…）。
- **Synara**（trysynara.com，已核实的真实产品）：Terminal / Browser / Diff / Docs 是可以同时挂载在工作区里的平级面板，官网原话 "Browser: Docs and previews, one pane over"——浏览器不是需要独占的东西。

讨论后达成的方向：**不 1:1 照搬 newmax 的下拉菜单 + tab 页机制**，而是用 MyYoda 已有的"面板开关按钮"范式（`TabBar.tsx` 里终端 / 浏览器的开关按钮）去承载画布，改动面更小、和现有交互语言更一致。

## 目标

- 受管浏览器打开时，文件预览（Preview）和草稿（Scratch）仍然可见/可用，不再被强制关闭。
- 画布新增一个和终端、浏览器同级的开关按钮，点击即在当前会话打开画布（不经过全屏画廊），关闭原有"三级跳"体验。
- 复用现有的每会话状态管理模式（`previewPanelOpenMapAtom` 式的 per-session Map atom），不引入新的状态管理范式。

## 非目标（本轮明确不做，均已和用户确认）

- **不做 newmax 式统一"+"新建下拉菜单**。本轮只解决画布这一个入口，其余新建方式（新建对话/新建文档/新建终端/网页浏览）维持现状。
- **不改变会话级 TabBar 的"草稿 + 当前会话"两槽位模型**（2026-07-23 既定非目标）。是否要让 TabBar 容纳更多"轻对象"tab（画布、文档等），是更大的 IA 决策，留作独立项目（记为 P2）单独讨论。
- **不改动终端面板的布局形态**。终端继续是 `TabContent` 下方的底部抽屉，不并入右侧工作区槽位体系。
- **不改动画布的右键菜单能力**。文件面板"…"菜单里的"引用到 Agent"/"添加到聊天"已经对所有非目录文件通用生效，画布文件只要出现在文件面板的树里就会自动继承，不需要单独设计。
- **不改动 `ExcalidrawGallery`（画廊）路由本身**。左侧栏"Yoda 画布"图标 → 全屏画廊的入口保持不变，作为"查看这个工作区全部画布"的入口继续存在；未来会归入知识库（repo-wiki）作为"画布"内容格式的汇总查询入口，这次不涉及该迁移。

## 现状架构（本次改动的基线）

- `apps/electron/src/renderer/components/tabs/MainArea.tsx`：右侧工作区目前是"槽位"模型，Browser / Preview / Scratch 共享一个 slot。Preview 和 Scratch 已经可以左右分屏共存（`showBothRightPanels`，独立拖拽分隔条），但三处判断式都显式排除了 Browser：
  ```ts
  const previewOpen = ... && !showBrowserPanel && !showBrowserClosing
  const showScratchPanel = ... && !showBrowserPanel && !showBrowserClosing
  ```
- `BrowserPanel` 底层是原生 `WebContentsView`（非 iframe/webview 标签），由主进程按一个占位 `<div>`（`BrowserSlot.tsx`）的 `getBoundingClientRect()` 实时贴图。层级优先于 renderer DOM 是原生视图的固有特性，但**不代表不能和其他 DOM 面板并排**——它只需要一个稳定的占位 div 提供 bounds，机制上和 Preview/Scratch 的并排分屏没有冲突，当前互斥完全是 `MainArea.tsx` 里的显式判断式导致的产品选择，不是技术死限制。
- 画布（Excalidraw）现状两条不统一的路径：
  1. 左侧栏"功能"分组 "Yoda 画布" 图标（`LeftSidebar.tsx` `handleOpenExcalidraw`）→ `activeView` 切到 `'excalidraw-gallery'`，在 `MainArea.tsx` 顶层作为**全屏路由**渲染（完全替换 `TabBar` + `TabContent`，会话上下文暂时消失），需要先在画廊选或建，再进 `'excalidraw-editor'`。
  2. 画布文件持久化在 `getExcalidrawDir(workspaceSlug)`（`~/.myyoda/agent-workspaces/{slug}/excalidraw/`），和 `getWorkspaceFilesDir` 渲染的 `workspace-files/` 是**两个平级目录**，当前文件面板（`SidePanel.tsx` / `FileBrowser.tsx`）不感知 `excalidraw/` 目录。
- Preview 面板的状态管理模式（作为本次画布状态设计的参照）：`atoms/preview-atoms.ts` 用两个 per-session Map atom 管理——`previewPanelOpenMapAtom`（开关）+ `previewFileMapAtom`（当前显示哪个文件），`TabBar.tsx` 里终端/浏览器开关按钮也是同样"per session Map + 点击 toggle"的模式。

## 设计

### 1. 右侧工作区从"槽位互斥"改为"最多三栏共存"

去掉 `!showBrowserPanel` 这类显式互斥判断，右侧工作区改为三个独立可开关的槽位：

- **Browser**（受管浏览器）
- **文档槽**（Preview 或 画布，两者共享同一个槽位，见下节"槽位归属"）
- **Scratch**（草稿）

三者可以任意组合同时显示，布局机制复用现有 `showBothRightPanels` 的拖拽分隔条实现，从"最多两栏"扩展为"最多三栏"（两条可拖拽分隔条，而不是一条），各自宽度独立持久化（比照现有 `previewSplitRatioAtom` / `rightWorkspaceSplitRatioAtom` 的模式再加一个比例值）。

`showRightPanel`（是否显示整个右侧区域）的判定从"任一为真"改为对齐新的三槽位开关；关闭动画、槽位收起等现有交互细节（`browserClosingState`、`closing` 状态机）保持不变，只是判断条件里去掉互斥项。

### 2. "文档槽"：Preview 与画布共享同一位置

Preview（文件预览/diff）和画布语义上都是"当前正在专注看的一份内容"，不新开第四个独立槽位（避免最多挤到四栏、每栏过窄），而是共享一个逻辑槽位：

- 打开画布时，如果文档槽当前显示的是 Preview，画布替换它；反之，Agent 触发新的文件 diff 预览时，如果文档槽当前显示的是画布，Preview 会替换回来（文件变更的时效性优先于用户手动停留的画布，对齐现有"Agent 修改文件时自动切换到最新修改文件"的 Preview 行为）。
- 两者的开关/内容状态各自独立持久化（画布不会因为被 Preview 顶替而丢失"当前打开的是哪个画布文件"的记忆），下次手动切回画布时能恢复到原样。
- Browser、Scratch 两个独立槽位不受"文档槽"内部切换影响。

### 3. 新增"画布"开关按钮

在 `TabBar.tsx` 的 `ShortcutGuideButton` 按钮组（当前是 `[终端] [浏览器]`）最左侧新增画布按钮：

```
[画布 PenTool] [终端 SquareTerminal] [浏览器 Globe2]
```

- 图标复用左侧栏"Yoda 画布"已用的 `PenTool`，视觉语言不新造。
- 显示条件对齐 `showTerminalButton` / `showBrowserButton`（`Boolean(activeAgentSession)`，仅 Agent 会话显示）。
- 交互：点击 = toggle 当前会话文档槽的画布显示；激活态同样用 `bg-accent` 高亮，和终端/浏览器按钮的视觉反馈完全一致。

### 4. 画布状态管理（比照 `preview-atoms.ts` 模式）

新增 `atoms/canvas-panel-atoms.ts`（命名待实现时确认），两个 per-session Map atom：

- `canvasPanelOpenMapAtom: Map<sessionId, boolean>` —— 文档槽当前是否显示画布（和 Preview 的开关語义上互斥，由槽位归属逻辑保证同一时刻只有一个为"当前展示"）
- `canvasFileMapAtom: Map<sessionId, { workspaceSlug: string; slug: string } | null>` —— 该会话当前打开的画布文件

### 5. 点击行为

- **该会话第一次点击画布按钮**（`canvasFileMapAtom.get(sessionId)` 为空）→ 调用已有的 `createExcalidrawFile(workspaceSlug, title)` IPC 直接新建一个未命名画布并写入 `canvasFileMapAtom`，随即在文档槽打开编辑器——不经过画廊，对齐 newmax"点了就落地"。
- **再次点击**（已有记忆）→ 恢复该会话上次停留的画布文件，不会每次新建空画布。
- **面板顶栏**（比照 `PreviewPanel.tsx` 顶栏已有的 `Maximize2` 等图标模式）保留一个"浏览全部画布"入口，点击直接跳转到现有的 `activeView = 'excalidraw-gallery'` 全屏路由（复用现状，不新建 UI），需要切换到别的已有画布或看全貌时经这里去。
- 编辑器本体复用现有 `ExcalidrawEditor`（`components/excalidraw/ExcalidrawEditor.tsx`，已经是 `React.lazy` 懒加载），新增一个内嵌壳组件（如 `CanvasPanel.tsx`，比照 `PreviewPanel.tsx` 的顶栏+内容结构）负责摆放在文档槽内、提供顶栏（标题、浏览全部画布、关闭）。

### 6. 实现备注（非设计决策，供后续计划阶段核实）

- `excalidraw/` 目录当前与 `workspace-files/` 平级，文件面板树不感知它。若要让画布文件在文件面板"…"菜单里也能"引用到 Agent"/"添加到聊天"（用户确认这套菜单机制已通用存在，不用重新设计），需要确认文件面板是否需要，以及如何，把 `excalidraw/` 目录下的文件也纳入展示——这是一个实现层面要核实的点，不影响本设计的产品决策。

## 验收标准

- 打开受管浏览器后，Preview（或画布）和 Scratch 面板仍可独立打开/关闭，三者可同时可见，各自宽度可拖拽调整。
- 会话内点击画布按钮：首次直接新建画布并打开；再次点击恢复上次的画布；按钮激活态视觉和终端/浏览器一致。
- 画布打开时若 Agent 触发新的文件 diff，Preview 自动顶替画布显示在文档槽；用户再次点击画布按钮可切回画布，画布内容不丢失。
- 左侧栏"Yoda 画布"→ 全屏画廊入口行为不变；面板内"浏览全部画布"能正确跳转到该路由。
- 终端面板布局、行为不受影响。

## 待独立讨论（P2，不在本次范围）

- 是否要做 newmax 式统一"+"新建菜单（对话/绘图/文档/终端/网页浏览一个入口）。
- TabBar 是否要从"草稿 + 当前会话"两槽位扩展为可容纳"轻对象"tab（画布、文档等），这会触碰 2026-07-23 的既定非目标，需要单独立项充分讨论边界。
