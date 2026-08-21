# MyYoda

> **Thinking More, Do More!**

MyYoda is a local-first AI coding workbench built for real software delivery. It brings multi-model chat, code execution, project context, task orchestration, collaborative sub-agents, automation, and durable knowledge into one desktop application.

**[中文](./README.md)** · **[Download the latest release](https://github.com/GeoffBao/MyYoda/releases)** · **[User Guide](./apps/electron/resources/tutorial.md)**

## Why MyYoda

A great coding product should do more than produce an answer. It should help users finish complex work reliably.

- **Thinking More**: analyze difficult problems with plan mode, model choice, Project Memory, and long-context workflows.
- **Do More**: read and write files, run commands, modify code, call tools, organize tasks, and deliver verifiable results.
- **Collaboration, not a black box**: Kanban Tasks, visible progress, and collaboration sessions remain traceable.
- **Knowledge that compounds**: CLAUDE.md, Memory, Skills, and Context have distinct roles, reducing repeated explanations.
- **Local first**: core sessions, projects, Skills, MCP configuration, and settings stay on the user's machine.

## Two Work Modes

| Mode | Best for |
|------|----------|
| **Chat** | Questions, analysis, writing, document reading, and model comparison without acting on the local environment |
| **Code** | File operations, commands, code changes, project management, task orchestration, and automation |

Use Chat when you only need an answer. Use Code when the task must act and deliver.

Projects & Kanban live inside Code. The Code workspace switches between Sessions and Kanban views.

## Core Capabilities

### Models and Agent Runtime

- API-key channels for Anthropic, OpenAI, Google, DeepSeek, Kimi, Zhipu, Qwen, Doubao, OpenRouter, and compatible custom endpoints;
- ChatGPT subscription access through Codex OAuth;
- Claude Pro / Max subscription access through OAuth;
- Pi Agent Runtime as the default Code runtime, with support for multiple enabled model channels;
- transparent routing to a compatible runtime for Claude subscription credentials.

Subscription login channels are currently intended for Code. Chat availability depends on the channel protocol and model capabilities.

### Projects and Long-Running Work

- Workspaces isolate sessions, Skills, Memory, Projects, and shared files; MCP defaults to a global `~/.myyoda/mcp.json` shared by all workspaces;
- Projects bind to the real repository through `workingDirectory` and keep reference assets and project memory;
- Projects & Kanban provides Todo, In Progress, and Done columns by default;
- TaskEditor can generate or manually edit a subtask DAG with orchestration models, dependencies, acceptance criteria, and repair limits;
- collaboration creates real, visible sub-agent sessions that can be awaited, stopped, and continued;
- Automations support interval, daily, weekly, monthly, one-time, and limited-run schedules.

### Extensible Agent Capabilities

- **Plugin Center**: a unified place for Overview, Experts, Expert Teams, Skills, Connectors, and Memory.
- **Connectors**: user-facing external integrations backed by MCP, API-key tools, or custom HTTP tools. Automations, collaboration sub-agents, task creation, and Planning belong to Overview “built-in abilities”, not Connectors.
- **Skills**: reusable workflows, decision rules, and standard operating procedures;
- **MCP**: the underlying tool-extension protocol; user MCP defaults to `~/.myyoda/mcp.json` and is shared across workspaces unless a Project has its own overlay (full replace, that Project only);
- **Memory**: cross-session experience, user preferences, and long-lived Project knowledge;
- **Context**: task plans, temporary notes, and shared workspace material;
- **Agent Experts**: stable roles, rules, and capability bundles for engineering disciplines.

### Discover and Community

- "Discover" entry in the sidebar (sibling of the Features group): official feed + community discussions + help + feedback in one place;
- Official content (videos / tutorials / announcements / links) is served from a public content repository, with version tags and an "updated" badge;
- Videos stream in-app via a proxy-aware relay, with download-and-play fallback, version updates, and local caching;
- Community discussions are read-only in-app (GitHub Discussions); posting and replying open the browser;
- The Help tab collects entries to the user guide, FAQ, and keyboard shortcuts;
- Offline degradation: cached content renders first with a banner; without cache, an error state with retry is shown;
- Feedback reuses the Notion submission channel, consistent with the entry in Settings.

### Development and Content Workflows

- file tree, diffs, and a multi-tab workspace;
- previews for Markdown, PDF, DOCX, PPTX, spreadsheets, and images;
- browser navigation, DOM inspection, network analysis, screenshots, and performance diagnostics;
- Git, shell commands, file editing, and code search;
- references to files, sessions, Skills, and MCP tools;
- Markdown, Mermaid, KaTeX, and syntax highlighting.

## Five-Minute Quick Start

### 1. Install

Download the macOS or Windows build from [GitHub Releases](https://github.com/GeoffBao/MyYoda/releases).

### 2. Configure a Model

Open **Settings > Model Configuration** and either:

- add an API-key channel;
- sign in with a ChatGPT subscription; or
- sign in with a Claude Pro / Max subscription.

### 3. Choose a Work Mode

- For discussion, analysis, and writing, use **Chat**.
- For repository changes, commands, or multi-step execution, use **Code**.

### 4. Create a Workspace and Project

Choose or create a Workspace from the Code sidebar. Change session grouping to Projects, create a Project, and set its `workingDirectory` to the real repository path.

If you have no bound Project, set a global engineering directory under **Settings → Workspace → Default working directory**; new sessions without a bound Project automatically work there.

### 5. Start a Task

Good requests include the goal, scope, constraints, and acceptance criteria:

> Inspect the current login flow and identify the root cause before proposing a fix. Do not change the database schema. Run the relevant tests after implementation and report changed files and risks.

## Directory Mental Model

Workspace, Project, and session cwd are different concepts:

| Concept | Meaning |
|---------|---------|
| **Workspace** | MyYoda's top-level isolation and capability container |
| **Project** | An engineering or business context inside a Workspace |
| **Project workingDirectory** | The real repository or project directory |
| **Default working directory** | App-level setting: fallback engineering directory for sessions without a bound Project (Settings → Workspace) |
| **Session cwd** | An isolated temporary workbench for each Code session |
| **workspace-files** | Material shared across sessions in a Workspace |
| **Project assets / MEMORY.md** | Project references and long-lived context |

```text
~/.myyoda/mcp.json                 # Global MCP, shared by all workspaces
~/.myyoda/agent-workspaces/{workspace}/
├── {session-id}/
│   └── .context/              # Current task plans and temporary notes
├── workspace-files/           # Cross-session shared material
├── skills/
└── projects/
    └── {project}/
        ├── config.json
        ├── assets/
        └── MEMORY.md

/path/to/your/repository/        # Usually outside the Workspace
└── src/ ...                     # Referenced by Project workingDirectory
```

When a session is bound to a Project, MyYoda explicitly supplies the `workingDirectory`, helping the Agent distinguish the repository from the session cwd.

## Local Data and Security

Core MyYoda data is stored under `~/.myyoda/` by default:

```text
~/.myyoda/
├── settings.json
├── channels.json
├── mcp.json                   # Global MCP, shared by all Workspaces
├── conversations/
├── agent-sessions/
├── agent-workspaces/
├── automations.json
└── sdk-config/
```

- API keys and OAuth tokens are encrypted with Electron `safeStorage` when OS-backed encryption is available. If it is unavailable, the current implementation may fall back to plaintext local storage;
- sessions primarily use auditable JSON and JSONL files;
- model requests still send user-submitted prompts, selected attachment content, or necessary tool results to the model provider chosen by the user;
- MyYoda explicitly provides the current Workspace, Project, session, and attached directories to Code Agents. It does not currently provide an OS-level filesystem sandbox, so fully automatic mode should only be used in trusted environments;
- the product requires Agents to request explicit confirmation before publishing, payment, irreversible deletion, and other high-risk operations, but users should still verify actual tool calls.

## Run from Source

### Requirements

- [Bun](https://bun.sh/)
- Node.js 20+
- Git
- a macOS or Windows desktop environment

### Install and Start

```bash
bun install
bun run dev
```

### Common Commands

```bash
# Type-check every workspace package
bun run typecheck

# Run tests with bun:test
bun test

# Build all workspace packages
bun run build

# Build only the Electron application
bun run electron:build

# Package for the current platform
cd apps/electron
bun run dist
```

## Repository Structure

```text
MyYoda/
├── apps/
│   ├── electron/       # Electron main process, preload, React renderer, and resources
│   └── cli/            # MyYoda CLI and progressive session-reading tools
├── packages/
│   ├── shared/         # Shared types, protocols, IPC constants, and utilities
│   ├── core/           # Provider adapters and model invocation primitives
│   ├── session-core/   # Session core logic
│   └── ui/             # Shared UI
├── docs/               # Design, research, and project documentation
├── release-notes/      # User-facing release notes
├── scripts/            # Sync and engineering scripts
└── patches/            # Bun patchedDependencies
```

The core communication path is:

```text
Shared types and IPC constants
    ↓
Renderer → Preload → Electron Main
    ↓
Provider / Agent Runtime / Workspace / Task / Automation
    ↓
Local JSON, JSONL, and project files
```

## Contributing

Before submitting a change, verify that it:

1. does not regress existing Chat, Code, Kanban, Task, collaboration, OAuth, or Workspace behavior;
2. uses `bun:test` rather than Vitest;
3. includes focused tests for important logic;
4. passes the relevant tests and `bun run typecheck`;
5. does not commit real tokens, API keys, user data, or upstream brand contamination;
6. updates the guide or relevant documentation when product behavior changes.

## Acknowledgements

MyYoda continues to evolve with the open-source community and benefits from projects including:

- [Proma](https://github.com/proma-ai/Proma), MyYoda's early open-source foundation;
- [Pi Agent](https://github.com/badlogic/pi-mono), the Agent Runtime ecosystem;
- [Claude Agent SDK](https://docs.anthropic.com/), compatible runtime support for Claude subscriptions;
- [Model Context Protocol](https://modelcontextprotocol.io/), the standard for extending Agent tools;
- [Shiki](https://shiki.style/), [Mermaid](https://mermaid.js.org/), and many other open-source projects.

## License

This project is licensed under the [GNU Affero General Public License v3.0](./LICENSE) (AGPL-3.0). Use, modification, and distribution must comply with the license terms.
