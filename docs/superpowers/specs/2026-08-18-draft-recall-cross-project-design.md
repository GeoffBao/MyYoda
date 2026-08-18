# 未发送草稿找回区块跨项目修复设计

- 日期：2026-08-18
- 状态：已批准（方案 C，完整修复）
- 关联模块：侧边栏「未发送草稿」区块（Agent 模式）

## 背景与问题

「未发送草稿」找回区块（`DraftSessionRecallSection`，LeftSidebar.tsx）自 0.6.8 引入，用于找回"输入了内容但未发送"的草稿会话。经调查确认存在三个缺陷：

1. **场景 1（缺陷）**：点「新会话」后当前会话本身就是草稿，区块的 `excludeSessionId={currentAgentSessionId}` 会把它排除 → 区块为空不渲染。主区切到看板等非会话视图后，用户不在会话中，侧栏却没有草稿找回入口（只能靠会话 Tab 点回）。注释"用户已经在这个草稿里，不需要再列一遍"只在用户正看着会话时成立。
2. **场景 2/3（Bug）**：`selectDraftSessionsWithContent` 强制 `session.workspaceId === workspaceId`（当前工作区）。点击其他项目会话时 `useOpenSession` 会把当前工作区切到该项目（`setCurrentAgentWorkspaceId(session.workspaceId)`），草稿（属于原工作区）立即被过滤 → 区块消失。置顶会话与「自动任务」组都是跨工作区展示（置顶注释明确"不按当前工作区过滤，否则用户会误以为置顶跟着项目走"），草稿行为与它们不一致：切换项目后原项目草稿在侧栏彻底失去入口。
3. **场景 4 补充**：「新会话」按钮的智能跳回（`findRecallableDraftSession`）同样只匹配当前工作区，与区块的局限一致，需同步放宽。

## 目标

- 任何项目视图下，侧栏「未发送草稿」区块都展示所有项目中有内容、未发送的草稿（跨项目找回入口）。
- 主区不在会话视图（看板 / 计划 / 插件等）时，当前打开的草稿也出现在区块里，保证找回入口始终存在。
- 「新会话」按钮智能跳回与区块语义一致（当前工作区优先 + 跨工作区兜底）。

## 非目标

- 不改变草稿的创建/发送/移除机制（`draftSessionIdsAtom`、`agentSessionDraftsAtom` 语义不变）。
- 不做草稿文本持久化（重启丢文本是既有限制，另行处理）。
- 不引入 Chat 模式草稿区块（Chat 无输入框草稿追踪）。
- 不做侧栏 UI 布局重构。

## 行为设计

### 变更 1：草稿区块跨项目展示

`selectDraftSessionsWithContent`（draft-recall-model.ts）移除 `session.workspaceId === workspaceId` 过滤，返回所有工作区的有内容草稿，按 `createdAt` 倒序，最多 `maxItems` 条。

- `DraftSessionWithContent` 增加 `workspaceId` 字段（透出，供标签判断）。
- `maxItems` 默认 3 → 5（跨项目后草稿可能来自多个项目；仍是找回入口而非完整草稿箱）。
- 参数 `workspaceId` 移除（不再参与过滤）。
- `excludeSessionId` 语义保留（见变更 2）。

### 变更 2：非会话视图不排除当前草稿

`DraftSessionRecallSection` 的 `excludeSessionId` 仅在主区处于会话视图（`codeMainView === 'session'`）时生效：

- `codeMainView === 'session'`：排除当前打开的草稿（用户就在这个草稿里，不重复列）。
- `codeMainView !== 'session'`（看板 / 计划 / 插件 / 画布等）：不排除，当前打开的草稿也显示。

用户点击草稿项 → `openSession` → `codeMainView` 切回 `'session'` → 该草稿从区块消失（原逻辑恢复）。

### 变更 3：「新会话」智能跳回跨工作区兜底

`findRecallableDraftSession`（create-agent-session-flow.ts）改为两段匹配：

1. 当前工作区（`session.workspaceId === workspaceId`）中最近的有内容草稿；
2. 找不到时，跨所有工作区找最近的有内容草稿。

两条路径都只回收未绑定 `projectId` 的草稿（「在项目下新建会话」语义明确，不参与回收，避免误跳）。

### 变更 4：工作区名标签

- 草稿行渲染时，若 `item.workspaceId !== currentWorkspaceId`，在行内显示该工作区名（复用 `workspaceNameMap`，与置顶会话 `workspaceName` 标注样式一致）。
- 当前工作区的草稿、`workspaceId` 为空的草稿、工作区已被删除（map 查不到）的草稿：不显示标签。

## 文件改动

| 文件 | 改动 |
|---|---|
| `apps/electron/src/renderer/components/app-shell/draft-recall-model.ts` | 移除 `workspaceId` 过滤；`DraftSessionWithContent` 增加 `workspaceId`；`maxItems` 默认 3→5；更新 JSDoc |
| `apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx` | `DraftSessionRecallSection` 新增 props：`currentWorkspaceId`、`workspaceNameMap`、`codeMainView`；行内条件渲染工作区名标签；`excludeSessionId` 仅在 `codeMainView === 'session'` 时传入；挂载处传参 |
| `apps/electron/src/renderer/hooks/create-agent-session-flow.ts` | `findRecallableDraftSession`：当前工作区优先 → 跨工作区兜底；更新注释 |
| `apps/electron/src/renderer/components/app-shell/__tests__/draft-recall-model.test.ts` | 更新「只保留当前工作区」用例 →「跨项目混合返回 + workspaceId 透出 + 时间倒序」；新增跨项目 maxItems 用例；exclude 语义用例保持并核对 |
| `apps/electron/src/renderer/hooks/__tests__/create-session-options.test.ts` | 更新「跨工作区草稿不匹配」用例 →「当前工作区优先、跨工作区兜底」；新增兜底命中用例 |

## 数据流

```
AgentView 输入 → agentSessionDraftsAtom（内存 Map，每次按键更新）
        ↓
DraftSessionRecallSection（叶子组件，订阅 atom，避免整栏重渲染）
   ├─ selectDraftSessionsWithContent({ sessions, draftSessionIds, draftTexts,
   │      excludeSessionId: codeMainView === 'session' ? currentAgentSessionId : null,
   │      maxItems: 5 })                      // 跨项目，按 createdAt 倒序
   └─ 渲染行：文本预览 + （非当前工作区时）工作区名标签
        ↓ 点击
   onOpen → useOpenSession → 自动切工作区 + 聚焦草稿会话
        → codeMainView = 'session' → 该草稿被排除，区块不再重复列它
```

## 边界情况

- 草稿所属工作区已删除：`workspaceNameMap` 查无名字 → 不显示标签，草稿仍可点击找回（打开后 `useOpenSession` 按 `session.workspaceId` 同步，工作区不存在时无副作用）。
- `workspaceId` 为空的草稿：参与跨项目排序，不显示标签。
- 空内容草稿：仍过滤（未输入内容不需要找回）。
- 多个草稿同属一个项目：正常按时间倒序并列展示。
- Chat 模式：区块仍只在 `mode === 'agent'` 渲染，行为不变。

## 测试计划

- `draft-recall-model.test.ts`：覆盖跨项目混合返回、workspaceId 透出、时间倒序、空内容过滤、exclude 语义、maxItems（含跨项目）。
- `create-session-options.test.ts`：覆盖当前工作区优先、跨工作区兜底、projectId 不回收、空文本不回收。
- 手动验证清单：
  1. 项目 A 输入草稿 → 切到项目 B 会话（普通列表 / 置顶 / 自动任务）→ 区块显示 A 的草稿并带「A 项目名」标签 → 点击跳回 A 并聚焦草稿。
  2. 点「新会话」输入内容（当前会话即草稿）→ 点「看板」→ 区块显示该草稿 → 点击后回到会话。
  3. 点「新会话」时若当前工作区无草稿但其他项目有 → 跳回其他项目的最近草稿。

## 验证命令

```bash
cd apps/electron
bun test src/renderer/components/app-shell/__tests__/draft-recall-model.test.ts
bun test src/renderer/hooks/__tests__/create-session-options.test.ts
bun run typecheck   # 或项目约定的类型检查命令
bun run lint        # 或项目约定的 lint 命令
```
