# Agent 产出可见性缺陷与 home/ad-hoc 隐藏容器必要性审查

> 日期：2026-08-09 ｜ 状态：讨论稿（待开发评审）
> 关联代码：`agent-output-capture.ts`、`agent-file-roots.ts`、`project-repository.ts`、`agent-workspace-manager.ts`
> 关联设计：`docs/plans/2026-08-02-agent-outbox-files.md`

---

## 一、背景与现象

用户在 Code 会话中让 Agent 从豆瓣下载剧照。Agent 执行 `curl` 将图片保存到：

```
<workspace>/projects/project-2/assets/kujin_gamlai_still1.jpg
```

右侧 Files 面板（"本轮生成"）看不到该图片。手动把图片复制到会话 Outbox 后立刻可见，证明捕获机制本身工作正常，问题在**文件落点不在捕获范围内**。

---

## 二、根因

`agent-output-capture.ts::captureAgentTurnOutputs` 只扫描三个根：

| 根 | 来源 |
|----|------|
| `sessionOutboxPath` | `workspace-files/Outbox/{sessionId}` |
| `sessionDir` | 会话 sandbox |
| `projectRoot` | 绑定的 Project effective cwd（worktree / 项目目录） |

而 `projects/{slug}/assets/`（Project 资产库）**不属于任何捕获根**：

- 不在 Outbox、不在 session sandbox；
- ad-hoc 项目无 workingDirectory → `projectRoot` 为 undefined；
- assets 目录是 prompt 注入 `<project_assets_path>` 的"项目资产引用区"，不是会话输出目录。

### 两个叠加的设计缺口

1. **Agent 行为契约不清晰**：`<project_assets_path>` 注入让 Agent 误以为 assets 是"下载/生成产物的合理落点"。会话输出契约本应引导 Agent 写 Outbox 或 session sandbox。
2. **捕获范围未覆盖 assets**：即使 Agent 写对了（资产类产出），`projects/{slug}/assets` 也不在捕获扫描中，产出对用户不可见。

---

## 三、现状模型（LuxAgents）

每个 Workspace 自动维护两个**隐藏容器 Project**（`project-repository.ts`）：

| 容器 | kind | workingDirectory | 承载 |
|------|------|------------------|------|
| 首页工作区 | `home` | 固定 `workspace-files/` | Home/Chat 模式对话 |
| 临时会话 | `ad-hoc` | 无（undefined） | 未绑定真实 Project 的临时 Code 会话 |

特点：
- 单例、不可删除/重命名/归档；
- 不出现在项目选择/管理 UI（`isHiddenKanbanProjectKind`）；
- 仅用于看板卡片归属展示（无 Project 会话显示为"临时会话"）；
- ad-hoc 不提供共享物理目录——每个会话仍用各自 sandbox，保持会话级隔离；
- `projects/{slug}/assets/` 是 Project 资产库，供 prompt 注入 `<project_assets_path>`。

---

## 四、Proma（上游）如何处理同样问题

调研 `/Users/admin/Workspace/ClaudeCode/proma`（当前上游基线，LuxAgents 有 `sync/proma-*` 同步分支）：

### 1. 没有 home/ad-hoc 隐藏容器

Proma 全仓搜索 `kind: 'home'` / `ad-hoc` / "首页工作区" / "临时会话" **零命中**（仅 build 脚本的 ad-hoc 签名注释，无关）。`AgentWorkspace` 类型只有 `id/name/slug/projectRootPath?/projectRootStatus?/createdAt/updatedAt`——**没有 kind 字段**。

### 2. 无 workspace 的会话是"一等公民"而非隐藏实体

```ts
// agent-session-manager.ts::createAgentSession
workspaceId: workspaceId,            // 可空
agentCwdMode: workspaceId ? agentCwdMode ?? 'project' : undefined,
```

```ts
// agent-session-manager.ts::resolveAgentCwd
if (!workspace) return undefined
return getAgentCwdMode({ agentCwdMode }) === 'project'
  ? getProjectFilesPath(workspace.slug)   // 绑定项目 → 项目根
  : getAgentSessionWorkspacePath(workspace.slug, sessionId)  // 否则 → session sandbox
```

UI 侧（`AgentView.tsx`）：

```ts
const currentWorkspaceId = sessionMeta.workspaceId ?? null
// createAgentSession(..., workspaceId: currentWorkspaceId ?? undefined)
```

无 workspace 会话的 cwd 直接回退到 session sandbox，不引入额外"容器 Project"实体。

### 3. 项目文件根：托管 vs 本地

```ts
export function getProjectFilesPath(workspaceSlug: string): string {
  return getAgentWorkspaceBySlug(workspaceSlug)?.projectRootPath ?? getWorkspaceFilesDir(workspaceSlug)
}
```

- 用户选了本地目录 → 项目文件直接用本地原始目录（`projectRootPath`）；
- 未选择 → 用 Proma 托管的 `workspace-files/`。

**不需要 home 容器**——`workspace-files/` 本身就是默认文件根；"没有项目"的语义由 `workspaceId: undefined` 表达，而非一个假的 Project 实体。

### 4. 右侧 Files 只有两个来源

`SidePanel.tsx`：

```ts
const visibleFileRoots = [
  ...(project 根可用 ? [{ path: workspaceFilesPath, scope: 'project' }] : []),
  ...(sessionPath ? [{ path: sessionPath, scope: 'session' }] : []),
]
```

无 workspace 时只有 session 根。没有第三态"临时会话容器"。

### 5. 没有文件级 Outbox

Proma 的 "outbox" 是 planning 同步数据库表（`planning_sync_outbox` / `planning_native_outbox`），**不是 Agent 文件产出目录**。文件级 Outbox 是 LuxAgents 在 `01504de2`（参考 Synara）自行移植的增强。

---

## 五、home/ad-hoc 必要性评估

### Proma 能运行的原因

Proma 用两个更轻的机制替代 home/ad-hoc：
1. **`workspaceId` 可空**：未绑定 = 无归属，天然表达"临时/无项目"；
2. **`getProjectFilesPath` 回退**：无本地目录时统一落到 `workspace-files/`，不需要 home 容器做文件根。

### LuxAgents home/ad-hoc 的收益

| 收益 | 说明 |
|------|------|
| 看板卡片归属 | 无 Project 会话有明确实体（"临时会话"），卡片不悬挂在空/未知上 |
| 统一实体关联 | ProjectConfig 可关联 Todo/Calendar，隐藏容器提供一致外键 |
| Home 模式语义 | Chat 对话有"工作区文件"可看（home → workspace-files/） |

### 代价与问题

| 问题 | 说明 |
|------|------|
| **概念复杂度** | 每个 Workspace 强制 2 个不可见容器，kind 三态（project/home/ad-hoc），用户不可见但代码处处要判 |
| **文件归属歧义（本次 bug）** | ad-hoc 无 workingDirectory 但又有 assets 目录，资产类产出落到捕获盲区 |
| **双轨模型** | Proma 用"可空 workspaceId + 回退目录"一个机制解决，LuxAgents 用了两个隐藏实体 + 三套文件根 |
| **UI 认知** | "临时会话"在看板出现但项目选择器不可见，用户难以理解该实体从何而来 |

### 结论

**home/ad-hoc 不是"是否有必要存在"的二选一，而是"是否值得为此引入隐藏实体"的权衡。**

- 保留它们，**必须**补齐：① prompt 明确 assets 是只读资产引用区，产物写 Outbox/session；② 捕获范围覆盖 assets（或至少资产类产出）。
- 简化方向（对齐 Proma）：
  - **ad-hoc 可以去掉**：未绑定 Project 的会话直接 `projectId: undefined`，cwd 回退 session sandbox，看板归属用"未绑定"伪分组动态展示，不建持久实体；assets 则按 `workspace-files/` 或 session sandbox 归属。
  - **home 可以保留或收敛**：其价值是 Chat 模式有默认文件根（workspace-files/），等价于 Proma 的 `getProjectFilesPath` 回退；若保留，只作为"默认文件根"而非"容器 Project"，减少 kind 三态。

---

## 六、改进建议（供评审）

### P0（本次 bug 必修）

1. **明确 assets 语义并写入 Agent prompt**：`<project_assets_path>` 仅为"可读资产引用区"，禁止作为会话产物落点；下载/生成文件写入 Outbox 或 session sandbox。
2. **捕获范围补齐 assets**（择一）：
   - 方案 A：`captureAgentTurnOutputs` 增加 `projects/{slug}/assets` 为捕获根（scope=project），使资产类产出在右侧可见；
   - 方案 B：限制 Agent 写入 assets（prompt 约束 + 权限/工具层面），产出统一走 Outbox。

### P1（架构层评审）

3. **评估去 ad-hoc 容器**：未绑定 Project 会话改为 `projectId: undefined` + cwd 回退，看板用"未绑定"动态分组；对齐 Proma 模型，减少一个隐藏实体。
4. **home 容器收敛为"默认文件根"**：若保留，弱化其 Project 实体语义，避免 kind 三态蔓延。

### P2（体验）

5. 右侧 Files 对"本项目 assets 中新增的图片/文件"给出提示或入口，避免用户以为产出丢失。

---

## 七、参考

- LuxAgents：`apps/electron/src/main/lib/agent-output-capture.ts`
- LuxAgents：`apps/electron/src/main/lib/agent-file-roots.ts`
- LuxAgents：`apps/electron/src/main/lib/project-repository.ts`（`ensureHomeProject` / `ensureAdHocProject`）
- Proma：`apps/electron/src/main/lib/agent-session-manager.ts`（`createAgentSession` / `resolveAgentCwd`）
- Proma：`apps/electron/src/main/lib/agent-prompt-builder.ts`（`buildWorkspacePaths`）
- Proma：`apps/electron/src/renderer/components/agent/SidePanel.tsx`（`visibleFileRoots`）
- 移植提交：`01504de2`（参考 Synara 引入 home/ad-hoc 与 Outbox）
