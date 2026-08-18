# 历史会话未发送内容提醒（行标记 + Tab 徽标 + 持久化 + 区块找回）设计

- 日期：2026-08-19
- 状态：已批准（方案 1+2+4 + 区块扩展，用户确认）
- 依赖：PR #103（未发送草稿区块跨项目修复）先行合入，本功能基于其代码

## 背景与目标

现状调查结论：所有会话（含历史会话）的输入框草稿都会写入内存 `agentSessionDraftsAtom`（Map<sessionId, text>），切换会话/关闭 Tab 不丢、切回可恢复；但存在三个缺口：

1. **无可见提示**：侧栏「未发送草稿」区块只服务 draft 会话（从未发送过）；历史会话有未发送内容时，侧栏行、Tab 均无任何标记，用户切走后完全无感。
2. **不持久化**：草稿文本全在内存，重启应用即丢失。
3. **跨项目/归档不可见**：历史会话草稿在别的项目（非置顶/自动任务）或已归档时，行不在当前列表视野内，无法找回。

目标：为历史会话的未发送内容建立完整提醒体系——就地行标记、Tab 徽标、跨重启持久化、跨项目/归档区块找回。多会话同时有草稿时全部天然覆盖（逐行逐 Tab 独立）。

## 行为设计

### 变更 1：侧栏会话行「未发送」标记

- `AgentSessionItem` 内部用 `useAtomValue(agentSessionDraftAtomFamily(session.id))` **切片订阅**（只重渲染对应行，避免整栏随按键重渲染）。
- 展示条件：草稿文本非空 且 非当前打开的会话（`active` prop 为 false 时显示）。
- 样式：行尾 amber 弱化徽标（`Pencil` 图标 + 「未发送」文字，复用 badge 风格，参考 `workspace-badge`）。
- 覆盖：普通项目列表 / 置顶 / 自动任务 / 子会话树——`ChildSessionItem` 与 `DelegatedChildSessionItem` 最终都渲染 `AgentSessionItem`，一处改动全生效。

### 变更 2：Tab 徽标

- `TabBarItem` 同样切片订阅 `agentSessionDraftAtomFamily(tab.sessionId)`。
- 有未发送内容（含当前 Tab）时标题旁显示 amber 小圆点（size-1.5 rounded-full）。
- chat / scratch Tab 查不到草稿自然为空，无副作用。

### 变更 3：未发送内容持久化

- 保持 `agentSessionDraftsAtom` 为内存 Map（避免输入时频繁写盘），新增独立持久化副作用模块：
  - **存储**：localStorage key `myyoda-agent-session-drafts`，JSON 对象 `{ [sessionId]: text }`。
  - **启动加载**：App 根组件挂载时读取并注入 atom（store.set）。
  - **防抖写**：`AgentView.setInputContent` 触发 `schedulePersist`（1.5s 防抖，模块内 timer 独立于组件生命周期，切换会话不丢盘）。
  - **兜底 flush**：`window.beforeunload` 全局监听一次，同步 flush。
  - **清理**：会话删除、工作区删除时删除对应条目并落盘（LeftSidebar 删除流程）。
  - 发送消息后清空草稿的既有路径（`setInputContent('')` 删除 key）自动触发防抖写。
- 只持久化**纯文本**；HTML 富文本不持久化，重启后由纯文本重建（AgentView 已有该路径，mention 等富文本节点丢失可接受）。
- 写盘失败（localStorage 超限等）catch 忽略，不影响主流程。

### 变更 4：「未发送草稿」区块扩展为兜底找回入口

- 纯函数 `selectDraftSessionsWithContent` 增加可选参数 `visibleSessionIds?: Set<string>`：过滤掉"当前视图可见"的会话（默认不传 = 不过滤，向后兼容）。
- `LeftSidebar` 构建 visibleSessionIds（active 视图语义，不随归档视图变化）：
  - 置顶会话 id（含归档置顶，置顶区本就可见）
  - 自动任务组合会话 id
  - 当前工作区非归档会话 id（不含 draft——draft 本就不在列表）
- 区块展示集合 = draft 会话（现状，跨项目）+ 当前视图不可见的历史会话草稿（其他项目 / 归档），带项目名标签，点击跳回（openSession 自动切工作区）。
- 排序仍按 `session.createdAt` 倒序（接受"老会话新草稿排后"的局限，见边界）；maxItems 保持 5。

## 数据流

```
AgentView 输入框（任意会话）→ setInputContent → agentSessionDraftsAtom（内存 Map）
        ├─ schedulePersist（1.5s 防抖）→ localStorage（重启恢复）
        └─ 切片订阅：
             ├─ AgentSessionItem → 行尾「未发送」徽标（非当前会话）
             ├─ TabBarItem → Tab amber 圆点
             └─ DraftSessionRecallSection → 区块条目（draft + 视图不可见草稿）
```

## 边界与取舍

- 区块排序用会话创建时间而非"草稿最近输入时间"：需要 updatedAt 需扩展 draftsMap 结构（`{text, updatedAt}`），影响面大，列为后续可选项，本期不做。
- 归档视图下区块仍按 active 语义过滤，归档列表行与区块条目轻微重复（低频场景，可接受）。
- localStorage 5MB 上限：单条超长草稿写盘失败忽略，内存中仍可用。
- 当前打开的会话：行标记不显示（正在编辑）；Tab 圆点显示（与编辑器 unsaved 惯例一致）。
- Chat 模式不涉及（Chat 无此草稿追踪）。

## 文件改动

| 文件 | 改动 |
|---|---|
| 新增 `apps/electron/src/renderer/lib/agent-draft-persistence.ts` | `loadAgentSessionDrafts(store)`、`schedulePersistAgentDrafts(store)`（1.5s 防抖）、`flushAgentDrafts(store)`、`removeAgentDraft(store, sessionId)`、序列化/解析纯函数 |
| `apps/electron/src/renderer/atoms/agent-atoms.ts` | 不改（复用现有 `agentSessionDraftsAtom` / `agentSessionDraftAtomFamily`） |
| `apps/electron/src/renderer/components/agent/AgentView.tsx` | `setInputContent` 内调用 `schedulePersistAgentDrafts` |
| `apps/electron/src/renderer/components/app-shell/AgentSessionItem.tsx` | 切片订阅 + 行尾「未发送」徽标（非 active 时） |
| `apps/electron/src/renderer/components/tabs/TabBarItem.tsx` | 切片订阅 + amber 圆点 |
| `apps/electron/src/renderer/components/app-shell/draft-recall-model.ts` | `selectDraftSessionsWithContent` 增加 `visibleSessionIds?` 过滤参数 |
| `apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx` | 构建 visibleSessionIds 并传入区块；删除会话/工作区时调用 `removeAgentDraft` 清理持久化草稿 |
| `apps/electron/src/renderer/App.tsx`（应用根组件） | 挂载时 `loadAgentSessionDrafts(store)`；注册一次 `beforeunload` → `flushAgentDrafts(store)` |
| 测试：`draft-recall-model.test.ts` | 新增 visibleSessionIds 过滤、向后兼容用例 |
| 测试：`agent-draft-persistence.test.ts`（新增） | 序列化/解析、清理纯函数用例 |

## 测试计划

- 单测：visibleSessionIds 过滤（含"不传不过滤"兼容）、持久化 serialize/parse 往返、removeAgentDraft 纯逻辑。
- 手动验证清单：
  1. 历史会话 A 输入内容（不发送）→ 切到会话 B → 侧栏 A 行显示「未发送」徽标、A 的 Tab 显示圆点；切回 A 输入框内容恢复。
  2. 两个历史会话同时有草稿 → 两行徽标 + 两 Tab 圆点。
  3. 其他项目历史会话有草稿 → 当前项目列表看不到该行，但「未发送草稿」区块显示该条目（带项目名标签）→ 点击跳回并切工作区。
  4. 重启应用 → 草稿文本恢复（输入框、徽标、圆点、区块均还原）。
  5. 删除会话/工作区 → 草稿清理，localStorage 无残留。
  6. 发送消息后 → 徽标/圆点消失，区块条目消失。

## 验证命令

```bash
cd apps/electron
bun test src/renderer/components/app-shell/__tests__/draft-recall-model.test.ts
bun test src/renderer/lib/__tests__/agent-draft-persistence.test.ts
bun run typecheck
```

## 分支策略

基于 `fix/draft-recall-cross-project`（PR #103）创建 `feat/unsent-draft-indicators`（stacked PR）；#103 合并后 rebase 到 main，再开本功能 PR。若 #103 先被合并，则直接基于 main 创建。
