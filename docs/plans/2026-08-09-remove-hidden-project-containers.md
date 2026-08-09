# 移除 home/ad-hoc 隐藏容器 Project 的可实施方案

> 日期：2026-08-09 ｜ 状态：方案稿（待评审后实施）
> 关联：`docs/2026-08-09-agent-output-visibility-review.md`（P1 项）
> 目标：对齐 Proma 的 `projectId: undefined` 模型，去掉每个 Workspace 自动维护的 home/ad-hoc 隐藏容器，收敛为「未绑定 = 无 projectId + sandbox 回退」单一语义。

---

## 一、目标状态

| 现状 | 目标 |
|------|------|
| 每个 Workspace 自动创建 home + ad-hoc 两个隐藏容器 Project | 不再自动创建；存量数据保留兼容 |
| 未绑定 Project 的 Code 会话在看板懒归类为「临时会话」（ad-hoc 容器） | 看板直接显示「未绑定」或保持 project 为空；workspace scope（`!session.projectId`）已是原生语义 |
| Home/Chat 模式对话有 home 容器归属 | 不引入归属实体；无 projectId 即未绑定（Proma 同款） |
| `kind: 'project' | 'home' | 'ad-hoc'` 三态 | 读路径兼容旧值；新数据只产生 `project`（缺省） |

对齐 Proma 的关键机制（已在 `proma/apps/electron/src/main/lib/agent-session-manager.ts` 验证）：

```ts
// Proma：未绑定 = workspaceId undefined → cwd 回退 session sandbox
workspaceId: workspaceId,                       // 可空
agentCwdMode: workspaceId ? 'project' : undefined,

// LuxAgents 已有等价语义（agent-cwd-resolver.ts）：
//   gitWorktreePath → worktree
//   agentCwdMode==='project' && projectId → project cwd
//   否则 → sandbox（sessionDir）
```

LuxAgents 的 `resolveSessionCwd` 对 `!projectId` 会话本来就走 sandbox，与 Proma 完全一致。**ad-hoc 容器不参与 cwd 解析**（无 workingDirectory → resolveEffectiveCwd 返回 managed workdir `projects/{slug}/workdir`，但没有任何 session 绑定 ad-hoc 的 projectId，该 workdir 从未被使用）。

---

## 二、现状引用面（已完成排查）

### home 容器（首页工作区）
- 创建：`agent-workspace-manager.ts::ensureHiddenProjectsForWorkspace`（workspace 创建时）
- **真实消费者：无**。没有任何代码把 session 的 `projectId` 设为 home 容器 id；Home/Chat 模式会话直接 `workspaceId: undefined` 创建，cwd 走 sandbox。
- 唯一影响：看板/侧栏中多一个被隐藏的空项目（`isHiddenKanbanProjectKind` 过滤）。

### ad-hoc 容器（临时会话）
- 创建：同上。
- **真实消费者：1 个**——`kanban-view-model.ts:89`：

```ts
// 未绑定真实 Project 的会话（含历史存量）懒归类到隐藏的「临时会话」容器，仅用于卡片展示
const project = session.projectId ? projectsById.get(session.projectId) ?? null : adHocProject ?? null
```

- 其余均为"隐藏/过滤"逻辑：`isHiddenKanbanProjectKind`、`filterPickableKanbanProjects`（PlanningView / CalendarWorkspace / AutomationFormView / KanbanBoardContainer / LeftSidebar）。

### 保护逻辑（project-repository.ts）
- `updateProjectAtRoot` / `deleteProjectAtRoot`：拒绝重命名/归档/删除非 `project` kind。**移除创建后，这些保护针对存量数据仍需保留**（防止历史隐藏容器被 UI 编辑）。

### 存储层（packages/shared/src/projects）
- `ProjectConfig.kind?: 'project' | 'home' | 'ad-hoc'`；`CreateProjectInput.kind` 注释标明"仅供主进程内部创建隐藏容器使用"。
- `createProjectInStorage`：`isRegularProject = !input.kind || input.kind === 'project'` 决定 `memoryLocation` 是否跟随项目目录——隐藏容器不算"项目真实文件夹"。
- 移除创建后：**普通项目与隐藏容器的区分不再是运行时必需**，但 `kind` 字段保留读兼容（历史 config.json 仍含 kind）。

### 测试引用
- `agent-workspace-manager.test.ts`（断言创建后存在 home/ad-hoc）
- `project-repository.test.ts`（ensureHomeProject/ensureAdHocProject 幂等）
- `kanban-view-model.test.ts`（无 Project 会话懒归类到 ad-hoc）
- `hidden-project-visibility.test.ts`（isHiddenKanbanProjectKind 判定）
- `storage.test.ts`（legacyConfig 含 kind 的读取）

---

## 三、实施步骤

### Step 1：停止创建 home/ad-hoc 容器

`apps/electron/src/main/lib/agent-workspace-manager.ts`

- 删除 `ensureHiddenProjectsForWorkspace(slug)` 函数及其两处调用（workspace 创建 `createAgentWorkspace`、默认 workspace 加载 `ensureDefaultWorkspace`）。
- 保留 `projectRepository.ensureHomeProject/ensureAdHocProject` 方法本身（`project-repository.ts`）不删除，避免对旧 API 的引用崩；改为仅存根或标记 `@deprecated`。若确认无其他调用，可直接删除。

### Step 2：看板去 ad-hoc 依赖

`apps/electron/src/renderer/components/app-shell/kanban/kanban-view-model.ts`

- `buildItem` 移除 `adHocProject` 参数；`const project = session.projectId ? projectsById.get(session.projectId) ?? null : null`（未绑定 → null）。
- `buildKanbanViewModel` 移除 `adHocProject` 查找与传递。
- `BuildKanbanViewModelInput` 不再需要 `adHocProject` 字段（若其作为入参来自外部，一并清理）。
- 卡片渲染侧已兼容 `project: null`（`TaskListRow.tsx` 显示 `'—'`、`TaskTile.tsx` 条件渲染）——无需改动；若希望未绑定卡片显式标注，可在 UI 上把 null project 显示为「未绑定」，不改模型。

### Step 3：类型与过滤收敛

`apps/electron/src/renderer/components/app-shell/kanban/types.ts`

- `KanbanProject.kind` 注释更新：`'home' | 'ad-hoc'` 为历史遗留（存量 config 读兼容），新项目不产生。
- `isHiddenKanbanProjectKind` 保留（对存量隐藏容器仍过滤）。

`packages/shared/src/projects/types.ts` / `storage.ts`

- `kind` 字段保留，注释更新为"历史遗留；新建项目不再设置"。
- `CreateProjectInput.kind` 保留（读兼容），但确认主进程不再以 home/ad-hoc 调用。

### Step 4：存量数据兼容（不做批量迁移）

- **不删除**已存在的 home/ad-hoc 目录（如 `projects/project`、`projects/project-2`）及其 config.json——里面可能有用户资产（如 `project-2/assets` 中的剧照）。
- 存量隐藏容器继续被 `isHiddenKanbanProjectKind` 过滤，从 UI 隐藏；其 assets 目录若被用户使用仍可访问。
- 会话 sandbox 隔离不变（ad-hoc 无共享物理目录，本就不承载文件）。

### Step 5：测试更新与回归

- 更新 `agent-workspace-manager.test.ts`：改为断言**不再创建** home/ad-hoc。
- 更新 `project-repository.test.ts`：ensureHome/ensureAdHoc 相关用例改为"兼容读旧 kind 的测试"或直接删除。
- 更新 `kanban-view-model.test.ts`：无 projectId 会话 → `project === null`（不再是 ad-hoc 容器 id）。
- 更新 `hidden-project-visibility.test.ts`：仍验证存量 kind 过滤。
- 新增回归：新建 workspace 后 `projects/` 下只有真实项目，无自动隐藏容器。
- 运行 `bun run typecheck` + `bun test`。

---

## 四、迁移影响清单

| 影响面 | 影响 | 处理 |
|--------|------|------|
| 看板卡片 | 无 projectId 会话从「临时会话」变回 project=null（显示 `—`/未绑定） | Step 2；可选 UI 标注「未绑定」 |
| 侧栏项目分组 | 不再出现被隐藏的空容器（本来就不显示） | 无感 |
| 日历/计划/自动化 | 项目选择器继续用 `filterPickableKanbanProjects`，存量隐藏容器仍被排除 | 无感 |
| cwd 解析 | 未绑定会话仍走 sandbox（与 Proma 一致） | 无变化 |
| prompt 注入 | 未绑定会话无 projectContext（已有 `workspaceDefaultWorkingDirectory` 兜底） | 无变化 |
| 文件捕获 | 未绑定会话产物仍捕获 Outbox/session sandbox | 无变化 |
| 存量 home/ad-hoc 目录 | 保留磁盘数据，不再创建新的 | 无批量迁移 |
| workspace scope | `{ kind: 'workspace' }` → `!session.projectId` 语义已存在（UI "Workspace Task"），与去 ad-hoc 完全兼容 | 无需改动 |

**风险**：低。核心消费者仅看板懒归类一处；该容器从未参与 cwd/prompt/文件捕获。移除后行为差异 = 看板卡片项目归属从"临时会话"变回 null。

---

## 五、与 P0（assets 可见性）的关系

- 移除 ad-hoc 后，新会话不再有 `projects/{slug}/assets`（ad-hoc 无共享物理目录，本就不该有产出）。未绑定会话产物自然落在 Outbox/session sandbox，从根源消除"产物写到 assets 不可见"的路径。
- P0 仍需单独做：真实项目的 assets 目录仍可能被 Agent 写入；`<project_assets_path>` 只读语义 + 捕获范围补齐（方案 A/B）独立实施。

---

## 六、实施顺序建议

1. P0（assets 语义/prompt）先做——独立、低风险，立即修复用户可见问题；
2. 本方案 Step 1-3（去创建 + 看板 + 类型收敛）作为一次提交；
3. Step 4-5（兼容测试）随同实施；
4. 手动验证：新建 workspace → 无 home/ad-hoc；未绑定会话看板显示正常；存量工作区无报错。

---

## 七、参考文件

- `apps/electron/src/main/lib/agent-workspace-manager.ts`（`ensureHiddenProjectsForWorkspace`）
- `apps/electron/src/main/lib/project-repository.ts`（`ensureHiddenProject` / 保护逻辑）
- `apps/electron/src/renderer/components/app-shell/kanban/kanban-view-model.ts`
- `apps/electron/src/renderer/components/app-shell/kanban/types.ts`
- `packages/shared/src/projects/types.ts` / `storage.ts`
- Proma 对照：`proma/apps/electron/src/main/lib/agent-session-manager.ts`（`resolveAgentCwd`）
