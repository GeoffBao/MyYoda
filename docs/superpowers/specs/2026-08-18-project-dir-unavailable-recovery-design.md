# 设计：项目目录失效可恢复 + 默认工作区目录落地

- 日期：2026-08-18
- 状态：已批准（设计评审通过，待实施计划）
- 范围：Agent 会话 cwd 决策、preflight 错误恢复、首次启动引导

## 背景与问题

### 问题 1：项目目录失效时会话被整体阻断

会话绑定的 Kanban Project 的 `workingDirectory` 指向的目录被移动/重命名/删除后，Agent preflight 直接失败：

- `agent-orchestrator.ts:1292-1301`：`resolveSessionCwd` 返回 `unavailable` → `reportPreflightError({ code: 'project_directory_unavailable', canRetry: false, actions: [] })` → **整个会话拒绝启动**。
- 真实案例（2026-08-18）：会话「帮忙打开浏览器找一下刘亦菲最近在干嘛？」因绑定的 `/Users/admin/Workspace/ClaudeCode/LuxAgents`（已迁移为 MyYoda）失效而完全无法执行——即使该任务根本不依赖项目目录。
- 现状 `actions: []` 且 `canRetry: false`，用户只能手动去设置里处理，没有一键恢复路径。

### 问题 2：默认工作区目录存在但无设置时机、不参与 cwd

已有两级"默认"：

1. **默认工作区（容器）**：`ensureDefaultWorkspace()` 首次启动自动创建（slug=`default`），不可删除，无需设置。
2. **应用级默认工作区目录**（`agentDefaultWorkingDirectory` 应用设置）：UI 在 设置 → 工作区 → 默认工作区目录（`WorkspaceSettings.tsx:421`），语义是"未绑定项目的会话 / Workspace Task 回退使用的工程代码目录"。但：
   - **无引导时机**：首次启动 Onboarding（`OnboardingView`）只有欢迎 + Windows 环境检测两步，没有设置默认目录的引导，新用户不知道此配置存在。
   - **不参与 cwd 决策**：该目录只注入 prompt（`agent-prompt-builder.ts:476` 输出 `<workspace_default_working_directory>`），`resolveSessionCwd`（`agent-cwd-resolver.ts`）完全不用它——未绑定项目的会话 cwd 永远是会话沙箱，Agent 文件工具够不到用户设置的工程目录。

## 目标

1. 项目目录失效时，报错提供一键恢复动作（重新关联 / 关联到探测候选 / 设置全局默认目录）。
2. 未绑定项目的会话 cwd 真正落到"默认工作区目录"（配置存在且可用时），失效时降级沙箱且不阻断。
3. 首次启动 Onboarding 增加可选的「设置默认工程目录」步骤，与第 2 点形成闭环。

## 非目标

- 不做"恢复原路径"按钮（重建的是空目录，代码未回来，误导性强；该能力保留在项目设置页深层，已有）。
- 不做目录失效时的自动关联（探测只建议不自动改，防止同名误关联）。
- 不新增"默认目录失效"的 UI 横幅（复用已有"未绑定项目"提示语义）。
- 不迁移存量会话 meta（新逻辑只影响新会话 / 重启后会话的 cwd 决策）。

## 架构改动

### 1. cwd 决策：插入默认工作区目录（核心）

**`apps/electron/src/main/lib/agent-cwd-resolver.ts`**（纯函数，不查 FS）：

- `ResolveSessionCwdInput` 增加字段 `defaultWorkingDirectory?: string`。
- 优先级变为：`worktree` → `workspace-root` → `project` → **`default-workspace`（新增 `SessionCwdSource` 枚举值）** → `sandbox`。
- 命中分支：`if (input.defaultWorkingDirectory) return { cwd: input.defaultWorkingDirectory, source: 'default-workspace' }`。
- 保持纯函数：存在性检查由调用方负责。

**`apps/electron/src/main/lib/agent-orchestrator.ts`**（约 1283 行 `resolveSessionCwd` 调用处）：

- 新增私有解析 `resolveDefaultWorkingDirectoryForSession()`：取 `getAgentDefaultWorkingDirectory()`（应用设置优先，兼容回退 default workspace config 旧值）；若路径存在且为目录 → 返回该路径；否则 `console.warn` 并返回 `undefined`（**降级 sandbox，不阻断**）。
- 传入 `resolveSessionCwd` 的 `defaultWorkingDirectory` 字段。
- 语义边界：workspace 已绑定 `projectRootPath` 时（如 luxcoder → MyYoda），未绑定项目会话仍走 workspace-root；默认目录只在无根的 workspace（如 default）参与决策。

### 2. 失效报错 actions + 候选探测（方案 A）

**`apps/electron/src/main/lib/agent-orchestrator.ts`**（1292 行分支）：

`actions` 从 `[]` 改为：

| key | 标签 | action | payload | 条件 |
|---|---|---|---|---|
| `r` | 重新关联目录 | `open_project_settings` | 会话的 workspaceId + projectId | 总是 |
| `d` | 设置默认工作区目录 | `open_default_workspace_settings` | 无 | 总是 |
| `c` | 关联到 `{候选名}` | `relocate_project` | `{ workspaceRoot, projectSlug, targetPath }` | 探测到候选时（最多 3 个按钮） |

- `RecoveryAction.action`（`packages/shared/src/types/agent.ts`）是开放字符串联合 `| (string & {})`，**类型定义零改动**。
- 候选探测为同步 `readdir`（preflight 是同步链路，父目录通常 <100 项，开销可忽略），失败静默返回空。

**候选探测函数**（新增，放 `apps/electron/src/main/lib/project-path-service.ts` 或同目录新文件）：

```ts
export function findRelocationCandidates(
  displayPath: string,      // 失效的 workingDirectory（可能不存在）
  projectName: string,      // 项目名（如 LuxAgents）
): string[]
```

- 对 `dirname(displayPath)` 下的目录项做 basename 匹配，命中规则（任一即候选）：
  1. 完全同名
  2. 去复数 s / 大小写变体（`LuxAgents` → `LuxAgent`）
  3. 前缀包含（`LuxAgents` 是 `LuxAgentsXxx` 的前缀）
  4. 编辑距离 ≤ 2
- 返回目录的绝对路径，最多 3 个；readdir 异常返回 `[]`。
- **只建议不自动改**：用户点击按钮才执行关联。

**`apps/electron/src/renderer/components/agent/SDKMessageRenderer.tsx`**（`handleRecoveryAction` 约 1187 行）：

新增 3 个 case + `iconForAction` 对应图标：

- `open_project_settings`：解析 payload（workspaceId + projectId）→ 复用项目设置页导航（`buildProjectPageNavigation(workspaceId, 'settings')`，与 SidePanel.tsx:176 的 `openProjectSettings` 同构；提取为共享小工具函数或局部复制）。
- `open_default_workspace_settings`：`setSettingsTab('workspace'); setSettingsOpen(true)`（与既有 `open_channel_settings` 模式一致）。
- `relocate_project`：解析 payload（`workspaceRoot` 为工作区根目录路径，preflight 上下文经 `getAgentWorkspacePath(ws.slug)` 可得）→ 调用项目 relocate IPC（`PROJECT_IPC_CHANNELS.RELOCATE_WORKING_DIRECTORY`，`task-handlers.ts:843` 已注册，签名 `(workspaceRoot, projectSlug, newPath)`）→ 成功 toast「已重新关联，请重新发送消息」（下一条消息 preflight 动态解析自动生效）；失败（如目标已被其他项目绑定）toast 透传现有错误。

### 3. Onboarding 引导

**`apps/electron/src/renderer/components/onboarding/OnboardingView.tsx`**：

- step 状态机扩展为 `'welcome' | 'workspace' | 'environment'`（`environment` 仅 Windows，其他平台跳过）。
- 流程：欢迎 → **设置默认工程目录（新，可选）** → Windows 环境检测（仅 Windows）→ 完成。
- 新步骤内容：说明文案 + `WorkingDirectoryField`（复用 `components/app-shell/kanban/WorkingDirectoryField`，依赖 `window.electronAPI.openFolderDialog()`，Onboarding 环境可用）+ 「跳过」/「继续」按钮。
- 用户选择路径后调用 `window.electronAPI.setAgentDefaultWorkingDirectory(path)`（异步保存，失败 toast 但不阻断 onboarding 完成）。
- 跳过则设置保持未配置，行为与现状一致。

## 数据流

```
首次启动: Onboarding(设置默认目录?) → 应用设置 agentDefaultWorkingDirectory
                                        ↓
新会话启动: orchestrator preflight → resolveSessionCwd
   ├─ worktree / workspace-root / project 命中 → 原逻辑
   ├─ 默认目录可用 → cwd = 默认目录 (source: default-workspace)
   └─ 默认目录失效/未配置 → sandbox（不阻断）
                                        ↓
项目目录失效: reportPreflightError(actions: [重新关联 / 设置默认目录 / 关联到候选])
                                        ↓
用户点按钮: 导航项目设置 / 打开设置-工作区 / relocate IPC → 下条消息自动生效
```

## 错误处理与边界

| 场景 | 行为 |
|---|---|
| 默认工作区目录失效 / 未配置 | 降级 sandbox，不阻断，`console.warn`；UI 走已有"未绑定项目"提示语义 |
| 候选探测 readdir 异常 | 静默返回 `[]`，仅基础按钮 |
| relocate 目标已被其他项目绑定 | 现有错误透传 toast，不吞 |
| Onboarding 跳过 / 保存失败 | 无副作用（失败 toast，不阻断完成） |
| 存量会话 | 新逻辑只影响新会话 / 重启后会话的 cwd 决策；会话 meta 不动 |
| Windows | 目录选择器跨平台已有（`openFolderDialog`） |

## 测试

**单测**：

- `agent-cwd-resolver.test.ts` 新增分支：
  - 默认目录命中 → source=`default-workspace`
  - 未配置（undefined）→ 落 sandbox
  - 与 `workspace-root`、`project`、`worktree` 的优先级（默认目录最低于 project）
- 候选探测函数（新测试文件）：匹配规则表（同名 / 复数 / 大小写 / 前缀 / 编辑距离 / 上限 3 / 异常容错 / 只接受目录）。

**手测清单**：

- 失效项目报错：3 类按钮各自跳转与执行（含候选关联成功 → 重新发送生效）
- Onboarding：完整配置路径与跳过路径
- `default` workspace 未绑定项目会话：配置默认目录后新会话 cwd 落到该目录（启动日志 `[Agent 编排] 使用 default-workspace 级别 cwd`），删除目录后降级 sandbox 不报错

## 影响面

| 文件 | 改动 |
|---|---|
| `apps/electron/src/main/lib/agent-cwd-resolver.ts` | +字段、+优先级分支、+source 枚举值 |
| `apps/electron/src/main/lib/agent-cwd-resolver.test.ts` | +用例 |
| `apps/electron/src/main/lib/agent-orchestrator.ts` | 传默认目录（含失效降级）、报错 actions + 候选探测调用 |
| `apps/electron/src/main/lib/project-path-service.ts`（或同目录新文件） | +`findRelocationCandidates` |
| 候选探测测试文件 | 新增 |
| `apps/electron/src/renderer/components/agent/SDKMessageRenderer.tsx` | +3 case + 图标 |
| `apps/electron/src/renderer/components/onboarding/OnboardingView.tsx` | +workspace 步骤 |
| 复用不改：`RELOCATE_WORKING_DIRECTORY` IPC、`setAgentDefaultWorkingDirectory` IPC、`openFolderDialog`、`WorkingDirectoryField`、`buildProjectPageNavigation`、`SettingsTab='workspace'` | — |

## 开放问题

无（设计评审已通过；实现计划阶段如发现 IPC 签名差异，以现有代码为准微调）。
