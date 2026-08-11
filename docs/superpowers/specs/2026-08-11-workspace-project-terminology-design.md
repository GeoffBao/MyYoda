# 工作区与项目术语整合设计

日期：2026-08-11
状态：设计已获用户确认，进入实现前规格审阅

## 目标

移除 MyYoda 用户界面中的“空间容器/空间”概念，恢复清晰且与当前代码模型一致的术语：

```text
工作区（AgentWorkspace）
└── 项目（Craft Project）
    └── 项目工作目录（Project.workingDirectory）
```

本次是用户语义和 UI 迁移，不是数据模型重构。现有工作区、项目、会话、任务、运行记录、文件级 Outbox 和 Project MEMORY 均保留。

## 当前问题

MyYoda 在 0.6.8 左右发生过术语漂移：

- `AgentWorkspace` 在部分界面被称为“空间”或“项目”；
- Craft `Project` 在部分界面被称为“工作区”；
- 设置页标题“空间容器”实际管理的是 `AgentWorkspace` 列表，并不存在独立的 `SpaceContainer` 实体；
- `useProjectActions` 的动作对象实际是 AgentWorkspace；
- `ProjectContextPicker` 实际选择 Craft Project，却显示“选择/新建工作区”。

这导致用户无法判断当前切换的是隔离环境、项目，还是实际代码目录。

## 目标术语

| 用户概念 | 代码实体/字段 | 责任 |
|---|---|---|
| 工作区 | `AgentWorkspace` / `workspaceId` | 会话、MCP、Workspace-only Skills、工作区记忆、工作区文件、Task/Run 的隔离边界 |
| 项目 | Craft `ProjectConfig` / `projectId` | 工作区内的工作集合、项目元数据、资产、Kanban 归属 |
| 项目工作目录 | `ProjectConfig.workingDirectory` | 项目实际代码仓库或文件夹；可选但通常存在 |
| 工作区默认工作目录 | `defaultWorkingDirectory`（未来可兼容 Proma `projectRootPath`） | 未绑定项目的会话/Task 的 fallback，不替代项目工作目录 |
| 工作区记忆 | Workspace `memory/` | 跨项目的长期协作记忆 |
| 项目记忆 | 现有 Project MEMORY 链路 | 本次保留，不与工作区记忆混称；未来是否退役另行决策 |

“空间容器”不再是用户可见实体，也不新增持久化模型。现有 `~/.myyoda`/`agent-workspaces/` 只作为实现上的全局配置根，不在产品界面中暴露为第三层对象。

## 运行与目录关系

```text
~/.myyoda/
└── agent-workspaces/
    └── {workspaceSlug}/              # 工作区
        ├── memory/                   # 工作区记忆
        ├── skills/                   # 工作区 Skills
        ├── workspace-files/          # 工作区文件
        ├── tasks/                    # Workspace 物理级 Task/Run
        └── projects/{projectSlug}/   # 项目元数据/assets
```

执行 cwd 优先级不变，统一文案后明确为：

```text
git worktree
> Project.workingDirectory / managed Project workdir
> Workspace projectRoot/defaultWorkingDirectory
> session sandbox
```

因此，一个工作区可以拥有多个项目；一个项目通常绑定一个实际工作目录，但当前字段可选，不能强制一对一或强制所有旧项目补目录。

## UI 迁移

### 工作区入口

以下界面管理 `AgentWorkspace`，统一称“工作区”：

- 设置页 tab：`工作区`；section：`工作区管理`；
- `WorkspaceSettings`：新建、切换、重命名、删除工作区；
- `WorkspaceSwitcher` / `WorkspaceSelector`：切换工作区；
- `useProjectActions`：renderer-only 动作重命名为 `selectWorkspace` / `createWorkspace`；
- 默认工作区、最后一个工作区、工作区删除提示统一使用工作区术语。

删除说明必须明确：删除 MyYoda 托管的工作区数据、会话引用和配置；不会删除外部 `workingDirectory` 指向的用户项目目录。

### 项目入口

以下界面管理 Craft `Project`，统一称“项目”：

- `ProjectContextPicker` / `DraftProjectPicker`：选择/新建项目；
- `NewTaskProjectFlowDialog`：选择任务归属项目；
- `CreateProjectDialog`：新建项目；
- Kanban 项目筛选器、Task Editor、项目 onboarding；
- 项目创建成功/失败、项目绑定/解绑提示。

选择目录时使用“项目工作目录”或“选择项目文件夹”，避免再称为工作区。

### 工作区能力入口

以下“空间”泛称改为“工作区”：

- 当前工作区、其他工作区、工作区配置、工作区文件；
- Workspace Skills/MCP 导入和能力更新提示；
- 工作区导出/导入、Planning 当前工作区筛选；
- 桥接渠道 `/workspace` 的列表卡片；
- 文件面板、Scratch Pad、Diff 标签和系统提示词说明。

CSS `space-*`、数据库 outbox 名称、历史兼容字段和内部非用户语义不改。

## Prompt 迁移

只调整自然语言职责描述，不删除或重命名现有 prompt 字段：

- `<project_context>` 继续表示当前 Craft Project 上下文；
- `<project_working_directory>` 表示项目实际工作目录；
- `<workspace_default_working_directory>` 表示未绑定项目时的工作区 fallback；
- `<project_memory>` / `<project_memory_path>` 本次保留；
- 系统提示词明确“当前会话已绑定工作区，可选绑定项目”。

AGENTS 自动注入、Workspace project root 生命周期、Skills parity audit 属于后续独立阶段，不与本次术语迁移混合。

## 兼容与非目标

保留以下内部契约：

```text
AgentWorkspace
workspaceId
ProjectConfig
projectId
workingDirectory
agent-workspaces/{slug}/
projects/{projectSlug}/
```

本次不做：

- 不删除旧工作区或旧项目；
- 不删除 `workspace-files/Outbox` 或 Planning/native outbox；
- 不删除 Project MEMORY 或 `memoryLocation`；
- 不新增 `SpaceContainer`；
- 不把 Workspace 和 Project 改成一对一；
- 不实施 AGENTS 自动注入；
- 不改变外部项目工作目录；
- 不修改 IPC channel、JSON 字段和物理路径。

## 测试与验收

1. Workspace 管理 UI/model 测试不再暴露“空间容器/新建空间/切换项目”。
2. Project picker 测试使用“项目”，且保留 session 可跳过项目的既有行为。
3. Workspace 与 Project 的 workspaceId/projectId 绑定关系测试继续通过。
4. Workspace 删除测试确认外部项目目录不被删除。
5. 运行 Electron/shared typecheck 和相关 Bun 测试。
6. 最终 grep 对用户可见文案分类检查，允许 CSS、历史兼容和内部标识保留。
7. Double Review 报告更新为当前 `main @ b58fe9a6`，并补充“空间容器仅 UI 退役，不是数据删除”的决策。
