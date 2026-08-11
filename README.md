# MyYoda

> **Thinking More, Do More!**

MyYoda 是面向真实研发交付的本地优先 AI Coding 工作台。它把多模型对话、代码执行、项目上下文、任务编排、协作子 Agent、自动任务和持续知识沉淀整合在一个桌面应用中。

**[English](./README.en.md)** · **[下载最新版本](https://github.com/GeoffBao/MyYoda/releases)** · **[使用指南](./apps/electron/resources/tutorial.md)**

## 为什么选择 MyYoda

优秀的 Coding 产品不应只给出答案，还应帮助用户把复杂工作真正完成。

- **Thinking More**：支持复杂问题分析、计划模式、多模型选择、Project Memory 和长上下文工作流。
- **Do More**：可读写文件、运行命令、修改代码、调用工具、组织任务并交付可验证结果。
- **协作而非黑盒**：Kanban Task、可见进度和 collaboration 子会话都可以追踪。
- **知识持续积累**：CLAUDE.md、Memory、Skills 与 Context 各司其职，减少重复解释。
- **本地优先**：核心会话、项目、Skills、MCP 和配置存储在本地，用户掌握自己的数据。

## 两种工作模式

| 模式 | 适合场景 |
|------|----------|
| **Chat** | 问答、分析、写作、文档阅读、多模型比较，不直接操作本地环境 |
| **Code** | 读写文件、执行命令、修改代码、项目管理、任务编排和自动化 |

只需要回答时使用 Chat；需要行动并交付结果时使用 Code。

Projects & Kanban 位于 Code 内。进入 Code 后，可在“会话”和“看板”之间切换。

## 核心能力

### 多模型与 Agent Runtime

- 支持 Anthropic、OpenAI、Google、DeepSeek、Kimi、智谱、通义、豆包、OpenRouter 及自定义兼容端点等 API Key 渠道；
- 支持 ChatGPT 订阅 Codex OAuth；
- 支持 Claude Pro / Max 订阅 OAuth；
- Code 默认使用 Pi Agent Runtime，可使用已启用的多种模型渠道；
- Claude 订阅渠道由应用透明使用兼容 Runtime，普通用户无需手动管理。

订阅登录渠道当前用于 Code 模式；Chat 可用范围取决于渠道协议和模型能力。

### 项目与长任务执行

- Workspace 隔离会话、Skills、MCP、Memory、Projects 和共享资料；
- Project 绑定真实工程目录 `workingDirectory`，并保存参考资料和项目记忆；
- Projects & Kanban 默认提供待办、进行中、已完成三列；
- TaskEditor 可生成或手动编辑子任务 DAG，配置编排模型、依赖、验收标准和修复次数；
- collaboration 可创建真实可见、可等待、停止和继续的协作子 Agent 会话；
- 自动任务支持间隔、每日、每周、每月、一次性和有限次数执行。

### 可扩展的 Agent 能力

- **Skills**：可复用的工作流、决策规则和 SOP；
- **MCP**：浏览器、Automation、collaboration、任务创建及外部服务工具；
- **Memory**：跨会话经验、用户偏好和 Project 长期知识；
- **Context**：当前任务计划、临时记录和跨会话资料；
- **Agent 专家**：为不同工程领域提供稳定角色、规则和能力组合。

### 开发与内容工作流

- 文件树、Diff 和多标签工作区；
- Markdown、PDF、DOCX、PPTX、Excel 和图片预览；
- 浏览器导航、DOM、网络、截图与性能分析；
- Git、Shell、文件读写和代码搜索；
- 会话引用、文件引用、Skill 引用和 MCP 引用；
- Markdown、Mermaid、KaTeX 和代码高亮。

## 五分钟快速开始

### 1. 安装

从 [GitHub Releases](https://github.com/GeoffBao/MyYoda/releases) 下载适用于 macOS 或 Windows 的安装包。

### 2. 配置模型

打开 **设置 → 模型配置**：

- 添加 API Key 渠道；或
- 登录 ChatGPT 订阅；或
- 登录 Claude Pro / Max 订阅。

### 3. 选择工作模式

- 讨论、分析和写作：进入 **Chat**；
- 修改工程、运行命令或执行多步骤任务：进入 **Code**。

### 4. 创建 Workspace 和 Project

在 Code 左侧栏选择或创建 Workspace。然后将会话分组方式切换为“项目”，创建 Project，并把 `workingDirectory` 设置为真实代码仓库目录。

### 5. 发起任务

推荐同时写清目标、范围、限制和验收标准：

> 请检查当前项目的登录流程，先定位根因并给出方案。不要修改数据库结构；实现后运行相关测试，并说明改动文件和风险。

## 目录心智模型

Workspace、Project 和会话 cwd 不是同一个概念：

| 概念 | 含义 |
|------|------|
| **Workspace** | MyYoda 的顶层隔离与能力容器 |
| **Project** | Workspace 内的工程或业务上下文 |
| **Project workingDirectory** | 真实代码仓库或工程目录 |
| **Session cwd** | 每个 Code 会话独立的临时工作台 |
| **workspace-files** | 当前 Workspace 跨会话共享资料 |
| **Project assets / MEMORY.md** | Project 参考资料和长期上下文 |

```text
~/.myyoda/agent-workspaces/{workspace}/
├── {session-id}/
│   └── .context/              # 当前会话的计划和临时记录
├── workspace-files/           # 跨会话共享资料
├── mcp.json
├── skills/
└── projects/
    └── {project}/
        ├── config.json
        ├── assets/
        └── MEMORY.md

你的真实工程目录/                 # 通常位于 Workspace 之外
└── src/ ...                     # 由 Project workingDirectory 指向
```

绑定 Project 后，Agent 会收到明确的 `workingDirectory`，帮助其区分真实工程目录与会话 cwd。

## 本地数据与安全

MyYoda 的核心数据默认保存在 `~/.myyoda/`：

```text
~/.myyoda/
├── settings.json
├── channels.json
├── conversations/
├── agent-sessions/
├── agent-workspaces/
├── automations.json
└── sdk-config/
```

- API Key 和 OAuth Token 在系统支持 Electron `safeStorage` 时会加密后写入本地配置；如果操作系统加密能力不可用，当前版本可能降级为明文存储；
- 会话主要使用 JSON / JSONL 文件保存，便于备份和审计；
- 模型请求仍会将用户提交的 Prompt、所选附件内容或必要工具结果发送给用户选择的模型服务商；
- MyYoda 会向 Code Agent 明确提供当前 Workspace、Project、会话及附加目录；当前版本不提供 OS 级文件系统沙箱，完全自动模式只应在可信环境中使用；
- 对发布、付款、不可逆删除等高风险操作，产品要求 Agent 在执行前进行明确确认，但用户仍应核对实际工具调用。

## 从源码运行

### 环境要求

- [Bun](https://bun.sh/)
- Node.js 20+
- Git
- macOS 或 Windows 桌面环境

### 安装与启动

```bash
bun install
bun run dev
```

### 常用命令

```bash
# 全仓类型检查
bun run typecheck

# 使用 bun:test 运行测试
bun test

# 构建所有 workspace package
bun run build

# 仅构建 Electron 应用
bun run electron:build

# 打包当前平台安装产物
cd apps/electron
bun run dist
```

## 仓库结构

```text
MyYoda/
├── apps/
│   ├── electron/       # Electron 主进程、Preload、React Renderer 和资源
│   └── cli/            # MyYoda CLI 与渐进式会话读取工具
├── packages/
│   ├── shared/         # 共享类型、协议、IPC 常量和工具
│   ├── core/           # Provider Adapter 和模型调用基础能力
│   ├── session-core/   # 会话核心逻辑
│   └── ui/             # 共享 UI
├── docs/               # 设计、研究和项目文档
├── release-notes/      # 面向用户的版本说明
├── scripts/            # 同步和工程脚本
└── patches/            # Bun patchedDependencies
```

核心通信路径：

```text
共享类型与 IPC 常量
    ↓
Renderer → Preload → Electron Main
    ↓
Provider / Agent Runtime / Workspace / Task / Automation
    ↓
本地 JSON、JSONL 与工程文件
```

## 贡献

提交改动前请至少确认：

1. 不破坏现有 Chat、Code、Kanban、Task、collaboration、OAuth 和 Workspace 行为；
2. 使用 `bun:test`，不要引入 Vitest；
3. 为关键逻辑补充定向测试；
4. 运行相关测试与 `bun run typecheck`；
5. 不提交真实 Token、API Key、用户数据或上游品牌污染；
6. 产品行为变化应同步更新教程或相关文档。

## 致谢

MyYoda 基于开源社区持续演进，并受益于以下项目和生态：

- [Proma](https://github.com/proma-ai/Proma)：MyYoda 的早期开源基础；
- [Pi Agent](https://github.com/badlogic/pi-mono)：Agent Runtime 生态；
- [Model Context Protocol](https://modelcontextprotocol.io/)：Agent 工具扩展标准；
- [Shiki](https://shiki.style/)、[Mermaid](https://mermaid.js.org/) 和其他优秀开源项目。

## 许可证

本项目采用 [GNU Affero General Public License v3.0](./LICENSE)（AGPL-3.0）。使用、修改和分发时请遵守许可证条款。
