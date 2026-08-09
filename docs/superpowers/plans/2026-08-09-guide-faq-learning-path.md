# Guide 与 FAQ 学习路径 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 MyYoda 的使用指南和 FAQ 改造成可执行的学习路径，并为所有截图增加可读的大图预览。

**Architecture:** 在 renderer 内新增一个复用的 Lightbox 图片预览组件；GuideView 负责分章节的入门路径，FaqDialog 继续负责搜索式问答并复用图片预览。内容继续使用 TypeScript 常量，图片继续使用本地静态资源，不新增依赖、不引入远程视频。

**Tech Stack:** React 18, TypeScript, Jotai, Tailwind CSS, Radix Dialog, lucide-react, Bun test。

## Global Constraints

- 所有状态管理使用 Jotai；Lightbox 打开状态只在内容组件内局部管理，不新增持久化设置。
- 不使用 `any`；接口优先使用 `interface`。
- 注释和日志使用中文；不修改应用版本号、AGENTS.md 或 README.md。
- 保留现有图片素材和现有 FAQ / Guide 入口，新增行为必须向后兼容。

### Task 1: 建立可复用图片大图预览

**Files:**
- Create: `apps/electron/src/renderer/components/guide/ImageLightbox.tsx`
- Modify: `apps/electron/src/renderer/components/tutorial/GuideView.tsx`
- Modify: `apps/electron/src/renderer/components/faq/FaqDialog.tsx`

**Interfaces:**
- Produces `ImageLightboxProps { src: string; alt: string; title?: string; description?: string; className?: string }`。
- `ImageLightbox` 负责缩略图、打开大图、Escape、背景关闭和无障碍标签。

- [ ] **Step 1: 编写 Lightbox 交互测试或可验证行为清单**：覆盖点击打开、Escape 关闭、关闭按钮、背景点击和 alt 文本。
- [ ] **Step 2: 实现 `ImageLightbox`**：使用 Radix Dialog，图片使用 `max-h-[82vh] max-w-[92vw] object-contain`，缩略图按钮提供“点击查看大图” aria-label。
- [ ] **Step 3: 替换 GuideView 与 FaqDialog 的直接 `<img>`**：所有精选图统一通过组件渲染，保留原来的裁切缩略图效果。
- [ ] **Step 4: 运行 renderer 类型检查**：`bun run --filter @myyoda/electron typecheck`，预期通过。

### Task 2: 将 GuideView 扩展为可执行的学习路径

**Files:**
- Modify: `apps/electron/src/renderer/components/tutorial/GuideView.tsx`

**Interfaces:**
- 保留 `GuideView(): React.ReactElement` 入口。
- 新增章节数据接口，章节至少包含 `id`、`title`、`summary`、`steps`、`example` 和可选 `image`。

- [ ] **Step 1: 增加固定章节导航**：包含“开始前、第一次任务、文件与上下文、能力组合、任务自动化、故障排查”，点击后滚动到对应章节。
- [ ] **Step 2: 增加第一次任务操作卡**：展示渠道配置、Project 创建、任务描述、执行检查四步，并加入可复制的任务模板文本。
- [ ] **Step 3: 增加文件与上下文章节**：解释会话文件、Project 文件、Workspace 文件、Project 记忆和 `.context` 的区别，并提供放置建议。
- [ ] **Step 4: 增加能力组合和任务自动化章节**：解释 Skills、MCP、专家、Task、Automation 的使用时机与边界。
- [ ] **Step 5: 增加故障排查章节**：覆盖模型不可用、Agent 不执行、目录错误、任务失败四类问题，并链接回 FAQ。
- [ ] **Step 6: 为章节内所有截图接入 `ImageLightbox`**：标题、说明与原图保持对应。
- [ ] **Step 7: 运行 Renderer 构建**：`bun run --filter @myyoda/electron build:renderer`，预期成功；只接受已有的大 chunk warning。

### Task 3: 扩充 FAQ 实用问题库

**Files:**
- Modify: `apps/electron/src/renderer/components/faq/faq-content.ts`
- Modify: `apps/electron/src/renderer/components/faq/FaqDialog.tsx`

**Interfaces:**
- 保留 `FAQ_GROUPS`、`FaqGroup` 和 `FaqItem` 导出接口。

- [ ] **Step 1: 为开始使用增加 Chat/Code 选择和首次任务问题**。
- [ ] **Step 2: 为 Project 与文件增加目录层级、会话拆分、附件和 `.context` 问题**。
- [ ] **Step 3: 为 Agent 与专家增加任务描述模板、工具权限和专家选择问题**。
- [ ] **Step 4: 为任务与自动化增加失败重试、运行记录和应用退出行为问题**。
- [ ] **Step 5: 增加“故障排查”主题，覆盖模型、目录、权限和 MCP 问题**。
- [ ] **Step 6: 验证搜索命中新增问题、主题目录滚动和空结果状态**：使用现有 UI 行为检查并运行相关测试。

### Task 4: 完成回归验证

**Files:**
- Test: existing renderer and shared test suites

- [ ] **Step 1: 运行 `bun run --filter @myyoda/electron typecheck`**。
- [ ] **Step 2: 运行 `bun test`**，预期 0 fail。
- [ ] **Step 3: 运行 `git diff --check`**。
- [ ] **Step 4: 启动 `bun run dev`，手动验证 Guide 滚动、图片 Lightbox、FAQ 搜索和入口跳转。
