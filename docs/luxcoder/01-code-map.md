# Proma Code Map for LuxCoder

> 基于 `rg` 全库扫描整理，用于 LuxCoder 品牌改造与架构理解的快速导航。
> 扫描关键词：Proma / proma / .proma / appName / productName / bundle / electron / BrowserWindow / ipcMain / ipcRenderer / workspace / skill / skills / mcp / provider / agent / workflow / claude / anthropic

---

## App Shell

- path: `apps/electron/src/renderer/components/app-shell/`
  - `AppShell.tsx` — 三面板根布局（LeftSidebar | NavigatorPanel | MainContentPanel）
  - `LeftSidebar.tsx` — 侧边栏：模式切换、置顶对话、日期分组会话列表、流式指示器
  - `NavigatorPanel.tsx` — 中间导航面板
  - `RightSidePanel.tsx` — 右侧面板（文件预览 / 工具结果）
  - `ModeSwitcher.tsx` — Chat ↔ Agent 模式切换
  - `SearchDialog.tsx` — 全局搜索对话框
  - `Panel.tsx` / `PanelHeader.tsx` — 可复用面板容器
- notes: 改造重点低，无 Proma 硬编码；若加入 LuxCoder logo 从 `LeftSidebar.tsx` 入手

---

## Electron Main

- path:
  - `apps/electron/src/main/index.ts` — 主进程入口，BrowserWindow 创建与生命周期
  - `apps/electron/src/main/ipc.ts` — 所有 IPC 处理器注册（~57KB，全量 handler 集中在此）
  - `apps/electron/src/main/menu.ts` — 原生应用菜单
  - `apps/electron/src/main/tray.ts` — 系统托盘图标与菜单
  - `apps/electron/src/preload/index.ts` — contextBridge，将主进程 API 暴露为 `window.electronAPI.*`
- notes: `ipc.ts` 是核心，新增 IPC 通道必须同步修改此文件 + preload + shared 常量 + renderer

---

## Renderer Entry

- path:
  - `apps/electron/src/renderer/main.tsx` — React 入口；挂载 ThemeInitializer / AgentSettingsInitializer / AgentListenersInitializer / UpdaterInitializer
  - `apps/electron/src/renderer/App.tsx` — 应用根组件，路由与全局 Provider 包裹
  - `apps/electron/src/renderer/index.html` — Electron 渲染进程 HTML 壳
- notes: 初始化组件在 `main.tsx`，全局状态订阅在此层挂载，组件卸载不会销毁监听器

---

## Chat

- path:
  - `apps/electron/src/renderer/components/chat/` — ChatView、ChatHeader、ChatInput（TipTap 富文本）、ChatMessages、ParallelChatMessages、ModelSelector、ContextSettingsPopover、SystemPromptSelector、ToolSelectorPopover、ChatToolBlock、ChatToolActivityIndicator 等
  - `apps/electron/src/renderer/atoms/chat-atoms.ts` — 对话列表、流式状态、模型选择、附件等 Jotai atoms
  - `apps/electron/src/main/lib/chat-service.ts` — Chat 流式调用编排（~20KB），集成 Provider 适配器、AbortController
  - `apps/electron/src/main/lib/conversation-manager.ts` — 对话 CRUD + JSONL 消息存储（~13KB）
  - `apps/electron/src/renderer/hooks/useGlobalChatListeners.ts` — 全局 Chat IPC 监听
- notes: Chat 与 Agent 并行，共享 LeftSidebar 会话列表但状态独立

---

## Agent

- path:
  - `apps/electron/src/renderer/components/agent/` — AgentView、AgentHeader、AgentMessages、WorkspaceSelector、PermissionBanner、AskUserBanner、SDKMessageRenderer、ProcessBlockGroup、ContentBlock、TaskProgressCard、SidePanel、BackgroundTasksPanel、ExitPlanModeBanner 等
  - `apps/electron/src/renderer/atoms/agent-atoms.ts` — Agent 会话列表、流式状态（AgentStreamState）、权限/AskUser 请求队列 Jotai atoms
  - `apps/electron/src/renderer/hooks/useGlobalAgentListeners.ts` — 全局 Agent IPC 监听，main.tsx 顶层挂载，永不销毁
  - `apps/electron/src/main/lib/agent-orchestrator.ts` — 核心编排层（~71KB）：并发守卫、渠道查找、环境构建、消息持久化、事件流处理、自动标题生成
  - `apps/electron/src/main/lib/agent-session-manager.ts` — 会话元数据 CRUD + JSONL 存储
  - `apps/electron/src/main/lib/agent-prompt-builder.ts` — 系统提示词构建（~18KB）
  - `apps/electron/src/main/lib/agent-permission-service.ts` — 工具权限检查与模式管理
  - `apps/electron/src/main/lib/agent-workspace-manager.ts` — 工作区 CRUD、MCP 配置、Skills 管理（~16KB）
  - `apps/electron/src/main/lib/agent-service.ts` — Agent 服务入口
  - `apps/electron/src/main/lib/agent-ask-user-service.ts` — AskUser 请求处理
  - `apps/electron/src/main/lib/agent-exit-plan-service.ts` — 退出计划服务
  - `apps/electron/src/main/lib/agent-model-routing.ts` / `agent-model-selection.ts` — 模型路由与选择逻辑
  - `apps/electron/src/main/lib/agent-collaboration-tools.ts` / `agent-collaboration-utils.ts` — 多 Agent 协作
  - `apps/electron/src/main/lib/agent-event-bus.ts` — Agent 事件总线
  - `apps/electron/src/main/lib/agent-session-usage.ts` — Token 用量统计
  - `apps/electron/src/main/lib/agent-headless-runner-registry.ts` — 无界面 Agent 运行注册表
  - `apps/electron/src/main/lib/agent-fork-workspace-copy.ts` — 工作区 Fork 拷贝
  - `apps/electron/src/main/lib/adapters/claude-agent-adapter.ts` — Claude Agent SDK 适配器
- notes: 权限请求按 sessionId 入队，支持多会话并行；`agent-orchestrator.ts` 是改造最重的文件

---

## Workflow

- path:
  - `apps/electron/src/renderer/components/automation/` — AutomationsListView.tsx、AutomationFormView.tsx
  - `apps/electron/src/renderer/atoms/automation-atoms.ts` — 自动化任务状态
  - `apps/electron/src/main/lib/automation-manager.ts` — 自动化任务管理
  - `apps/electron/src/main/lib/automation-scheduler.ts` — 定时调度器
  - `apps/electron/src/main/lib/automation-notification-service.ts` — 自动化通知服务
  - `apps/electron/src/main/lib/automation-agent-tools.ts` — 自动化专用 Agent 工具
  - `apps/electron/src/main/lib/automation-notification-format.ts` — 通知格式化
- notes: Workflow = Proma 的"自动化"（Automation）模块；定时任务 + Agent 触发，与飞书/钉钉推送集成

---

## Skills

- path:
  - `apps/electron/default-skills/` — 内置 Skill 包：`agent-collaboration`、`automation`、`brainstorming`、`docx`、`executing-plans`、`find-skills`、`guizang-ppt-skill`、`pdf`、`pptx`、`proma-coach`、`skill-creator`、`tool-builder`、`writing-plans`、`xlsx`
  - `apps/electron/src/renderer/components/agent-skills/` — AgentSkillsView.tsx、PluginOverviewTab.tsx、ConnectorsTab.tsx、ConnectorCard.tsx、ConnectorDetailDialog.tsx、AddConnectorMenu.tsx、CustomHttpConnectorDialog.tsx、PluginScopeSelector.tsx、SkillCard.tsx、SkillDetailSheet.tsx、ImportSkillDialog.tsx、McpDetailSheet.tsx、useAgentSkillsData.ts、skillMdUtils.ts
  - `apps/electron/src/main/lib/agent-workspace-manager.ts` — Skills CRUD 实现（含 seedDefaultSkills / upgradeDefaultSkillsInWorkspaces）
- notes: `proma-coach` skill 名称需改为 `luxcoder-coach`；每次修改 default-skills 内容必须同步递增 SKILL.md 的 `version` 字段

---

## MCP

- path:
  - `apps/electron/src/main/lib/builtin-mcp/` — `catalog.ts`（内置 MCP 目录）、`memory.ts`（记忆 MCP）、`registry.ts`（注册表）、`settings.ts`（设置 MCP）
  - `apps/electron/src/main/lib/mcp-validator.ts` — MCP Server 配置校验
  - `apps/electron/src/renderer/components/agent-skills/ConnectorCard.tsx` / `ConnectorDetailDialog.tsx` / `McpDetailSheet.tsx`（连接器卡片与详情；内置 MCP 详情已并入 ConnectorDetailDialog）
  - `apps/electron/src/renderer/components/settings/McpServerForm.tsx`
  - `packages/shared/src/utils/mcp-transport.ts` / `mcp-transport.test.ts` — MCP 传输层工具
- notes: MCP 配置按工作区隔离，存储于 `~/.luxcoder/agent-workspaces/{slug}/mcp.json`；内置 MCP 通过 registry.ts 注册

---

## Provider

- path:
  - `packages/core/src/providers/` — `anthropic-adapter.ts`、`openai-adapter.ts`、`google-adapter.ts`、`sse-reader.ts`（通用 SSE 流）、`url-utils.ts`、`types.ts`、`thinking-capability.ts`、`user-agent.ts`、`index.ts`（注册表）
  - `apps/electron/src/main/lib/channel-manager.ts` — 渠道 CRUD + API Key AES-256-GCM 加密（safeStorage）、连接测试、模型列表获取（~16KB）
  - `apps/electron/src/main/lib/adapters/claude-agent-adapter.ts` — Agent SDK 专用适配器（见 Agent 章节）
  - `apps/electron/src/renderer/components/settings/ChannelSettings.tsx` / `ChannelForm.tsx`
  - `packages/shared/src/types/channel.ts` — Channel 类型定义
- notes: 支持 Anthropic / OpenAI / Google / DeepSeek / 智谱 / MiniMax / 豆包 / 通义千问 / 自定义端点；新增 Provider 只需在 `packages/core/src/providers/` 实现适配器并注册

---

## Storage

- path:
  - `apps/electron/src/main/lib/config-paths.ts` — **所有本地路径函数**，核心改造点：`~/.luxcoder/` → `~/.luxcoder/`（正式版）/ `~/.luxcoder-dev/` → `~/.luxcoder-dev/`（开发版）
  - `apps/electron/src/main/lib/storage-service.ts` — 通用 JSON 文件读写服务
  - `apps/electron/src/main/lib/conversation-manager.ts` — 对话索引 + 每对话 JSONL 文件
  - `apps/electron/src/main/lib/agent-session-manager.ts` — Agent 会话索引 + 每会话 JSONL 文件
  - `apps/electron/src/main/lib/memory-service.ts` — 跨会话记忆存储与检索
  - `apps/electron/src/main/lib/attachment-service.ts` — 附件文件管理（`~/.luxcoder/attachments/`）
  - `apps/electron/src/main/lib/settings-service.ts` — 应用设置持久化（`settings.json`）
  - `apps/electron/src/main/lib/user-profile-service.ts` — 用户档案持久化（`user-profile.json`）
  - `apps/electron/src/main/lib/migration-service.ts` — 数据迁移服务
- notes: 无本地数据库，全部 JSON + JSONL 文件；改目录名后需提供从 `~/.luxcoder/` 迁移的脚本，否则老用户数据丢失

---

## Branding Strings

- path:
  - `apps/electron/electron-builder.yml` — `appId: com.proma.app`、`productName: Proma`、文件扩展名 `.luxcoder-backup` / `.luxcoder-share`、资源目录 `proma-logos`、麦克风权限描述、GitHub repo 名称
  - `packages/shared/src/config/index.ts` — `APP_NAME = 'Proma'`（全局常量，所有 UI 文案来源）
  - `apps/electron/src/main/lib/config-paths.ts` — 目录名 `.proma` / `.luxcoder-dev`
  - `apps/electron/src/renderer/components/settings/PromaLogoSettings.tsx` — Proma Logo 下载页，含 `proma-black/white/blue.png` 资源引用
  - `apps/electron/src/renderer/components/settings/AboutSettings.tsx` — "关于 Proma"、GitHub URL `github.com/ErlichLiu/Proma`
  - `apps/electron/default-skills/proma-coach/SKILL.md` — 内置 Skill 名称
  - `package.json`（根）/ `apps/electron/package.json` — `name: proma`、`@proma/*` 包作用域
  - `packages/shared/package.json` / `packages/core/package.json` / `packages/ui/package.json` — 包名 `@proma/shared` 等
- notes: 最小改动路径：先改 `APP_NAME`（config/index.ts）+ `config-paths.ts` 目录名 + `electron-builder.yml` 三处；包名 `@proma/*` 改动影响所有 import，工作量最大，可作为第二阶段
