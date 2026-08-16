# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

MyYoda is a local-first AI coding workstation packaged as an Electron desktop app, forked from and continuously synced from upstream [Proma](https://github.com/proma-ai/Proma). Top-level UI modes: **Chat** (conversational, no local side effects) and **Code** (Agent mode: reads/writes files, runs commands, orchestrates multi-step tasks; contains Kanban/Task orchestration and collaboration sub-agents).

## Commands

```bash
bun install              # install workspace deps
bun run dev               # start Vite + Electron with hot reload (recommended dev entry)
bun run typecheck         # typecheck every workspace package (bun run --filter='*' typecheck)
cd apps/electron && bun run typecheck   # typecheck a single package
bun test                  # run all tests (bun:test, not Vitest/Jest)
bun test path/to/file.test.ts           # run a single test file
bun test -t "test name"                 # run tests matching a name pattern
bun run build              # build every workspace package
bun run electron:build     # build only the Electron app
cd apps/electron && bun run dist:mac   # package a distributable (dist:win / dist:linux / dist:fast also available)
```

There is no lint script/config in this repo — `typecheck` + `bun test` are the gate.

Upstream-sync specific commands (see "Upstream sync" below):

```bash
bun run sync:check                 # gate that must pass before merging a sync/* branch
bun run sync:apply-renames         # dry-run @proma → @myyoda rename fixups after a cherry-pick
bun run sync:apply-renames -- --write   # apply the renames
```

### Runtime notes

- Use Bun, not Node/npm/pnpm, for everything (`bun install`, `bun run <script>`, `bun test`). Prefer Bun-native APIs (`Bun.file`, `Bun.$\`cmd\``) over `node:fs`/`execa` in new code.
- Bun auto-loads `.env` files.
- Tests use `bun:test` (`import { test, expect } from "bun:test"`) — do not introduce Vitest or Jest.

## Monorepo structure

Bun workspaces (`workspaces: ["packages/*", "apps/*"]`), packages scoped `@myyoda/*`, referenced internally via `workspace:*`:

- `packages/shared` — shared types, IPC channel constants, config, utils, `projects`/`tasks` domain types. No runtime deps.
- `packages/core` — AI provider adapter registry, Shiki code highlighting. Depends on `@myyoda/shared`.
- `packages/session-core` — session transcript parsing/rendering shared between the Electron app and the CLI (`read`, `search`, `select`, `group`, `outline`, markdown rendering).
- `packages/ui` — shared React UI components.
- `apps/electron` — the desktop app: `src/main` (main process + `main/lib/` service layer), `src/preload` (context bridge), `src/renderer` (React/Vite/Tailwind/Radix UI), `src/utility` (the isolated Pi Agent Runtime process, see below).
- `apps/cli` — `myyoda` CLI for reading/searching agent session transcripts outside the app, built on `@myyoda/session-core`.
- `apps/server` — "MyYoda 企业版" Skills distribution/collaboration registry (Hono-based HTTP service; auth, orgs, skills endpoints).

## Core architecture

### IPC communication (the most important pattern to internalize)

Every renderer↔main capability flows through four layers, all four of which need touching when adding a channel:

```
@myyoda/shared (channel name constants + request/response types)
  → apps/electron/src/main/ipc.ts registers ipcMain.handle() handlers, delegating to main/lib/ services
    → apps/electron/src/preload/index.ts exposes a typed window.electronAPI.* surface via contextBridge
      → renderer calls window.electronAPI.*, usually wrapped inside a Jotai atom
```

Channel constant groups live in `@myyoda/shared` (e.g. `AGENT_IPC_CHANNELS`, `CHANNEL_IPC_CHANNELS`, `PROJECT_IPC_CHANNELS`, `TASK_IPC_CHANNELS`, `FEISHU_IPC_CHANNELS`, `SESSION_COMMAND_CHANNEL`).

### Pi Agent Runtime — isolated per-session utility process

Code/Agent mode does **not** call the SDK from the main process directly. Each agent session's SDK query runs inside its own Electron `utilityProcess` (`apps/electron/src/utility/agent-runtime.ts`), spawned and supervised from `main/lib/agent-runtime-client.ts`, communicating over a `MessagePort` using the `AGENT_RUNTIME_METHODS` protocol. This isolates a crashing/hanging SDK query from the main process and from other sessions.

The adapter layer bridging this to the rest of the app lives in `main/lib/adapters/pi-*`: `pi-agent-adapter.ts` (main-process side of the protocol), `pi-utility-adapter.ts` (utility-process side), `pi-message-adapter.ts` (SDK message ⇄ app event translation), `pi-builtin-tools.ts`/`pi-mcp-tools.ts` (tool wiring), plus per-provider quirks (`pi-codex-*`, `pi-deepseek-*`, `pi-openai-*`).

High-level event flow once a query is running:

```
agent-orchestrator.ts (concurrency guard, channel lookup, env/cwd resolution)
  → Pi SDK query() inside the utility process → SDKMessage / sdk_delta stream over MessagePort
    → AgentEvent[] (legacy control events) + liveMessages (live transcript, single source of truth for streamed text)
      → webContents.send() IPC push
        → useGlobalAgentListeners (mounted once at renderer root, never unmounted) → store.set(jotai atoms)
          → React UI
```

Streaming text/thinking is rendered exclusively from `liveMessages` (Pi 0.84 native assistant deltas applied via `applyAssistantDeltaToPreview`); `AgentStreamState` only tracks run lifecycle (running/backgroundWaiting/retrying/toolActivities/usage), not accumulated text — do not reintroduce a duplicate text-accumulation path.

`useGlobalAgentListeners` is mounted at the top level in `main.tsx` specifically so that switching away from the active session (e.g. opening Settings) never drops streaming output or pending permission/AskUser requests — those are queued per-`sessionId` in Map atoms, not scoped to "current session".

### Main process service layer (`main/lib/`)

Representative core services (there are ~280 files total; these are the ones most tasks touch):

| Service | Responsibility |
|---|---|
| `agent-orchestrator.ts` | Core Agent orchestration: concurrency guard, channel/API key resolution, env + cwd resolution, message persistence, event streaming, error mapping, auto-title generation |
| `agent-session-manager.ts` | Agent session CRUD + JSONL message persistence |
| `agent-prompt-builder.ts` | System prompt construction, workspace context injection |
| `agent-permission-service.ts` / `agent-ask-user-service.ts` / `agent-exit-plan-service.ts` | Tool permission checks, AskUser prompts, plan-exit handling |
| `agent-workspace-manager.ts` | AgentWorkspace CRUD, MCP server config, Skills config |
| `agent-runtime-client.ts` | Spawns/supervises the per-session Pi utility process (see above) |
| `channel-manager.ts` | Provider channel CRUD, API key AES-256-GCM encryption via Electron `safeStorage` |
| `chat-service.ts` | Chat-mode streaming orchestration (separate from Agent mode) |
| `conversation-manager.ts` | Chat conversation CRUD + JSONL storage |
| `project-repository.ts` | craft-style `Project` CRUD (`{workspace}/projects/{slug}/`: `config.json`, `assets/`, `MEMORY.md`) |
| `task-handlers.ts` / `task-runner.ts` | Kanban Task IPC + DAG orchestration/scheduling, orphaned-run recovery on cold start |
| `conductor-session-host.ts` | Bridges TaskRunner-triggered runs into the Agent event stream via `runAgentHeadless`, so Kanban-triggered work is visible in Code chat |
| `feishu-bridge.ts` | Feishu/Lark integration: message sync, task notifications, OAuth |
| `runtime-init.ts`, `config-paths.ts` | Shell/Bun/Git environment detection; resolves `~/.myyoda/` (packaged) vs `~/.myyoda-dev/` (dev, `app.isPackaged === false`) |

### AI provider adapters (`packages/core/src/providers/`)

Registry pattern (`provider-registry.ts` looks up by `providerId`); each adapter implements a `sendMessage()` streaming interface. Anthropic/DeepSeek/MiniMax use `anthropic-adapter.ts` (Messages API-compatible); OpenAI/智谱/豆包/通义千问/custom endpoints use `openai-adapter.ts` (Chat Completions-compatible); Google uses its own Generative Language API adapter. This provider layer is used by **Chat mode**; Code/Agent mode goes through the Pi Agent Runtime instead (see above), which has its own per-provider request-shaping in `main/lib/adapters/pi-*`.

### Jotai state (`apps/electron/src/renderer/atoms/`)

State management is Jotai-only (not Redux/Zustand/Context) — this is a firm project convention. ~50 atom files; the ones most work touches:

| File | Owns |
|---|---|
| `agent-atoms.ts` | Agent sessions, `AgentStreamState` (per-session Map), workspace/channel selection, permission/AskUser request queues (per-sessionId Map) |
| `chat-atoms.ts` | Chat conversations, streaming state (per-conversation Map), model selection |
| `project-atoms.ts` / `kanban-atoms.ts` | craft `Project` state, Kanban board derived view models |
| `app-mode.ts` | Top-level mode (`chat` / `agent`; `cowork`/Work is retired and normalizes to `agent`) |

### Renderer component layout (`renderer/components/`)

- `app-shell/` — three-panel layout (LeftSidebar | NavigatorPanel | MainContentPanel); Code sidebar groups sessions by `AgentWorkspace`, with `Project` as a sub-grouping inside a workspace.
- `agent/` — Code/Agent mode UI: `AgentView` (presentation only — IPC listening lives in the global hook, not here), `AgentMessages` (virtualized transcript, `@tanstack/react-virtual`), `SDKMessageRenderer` (message/turn grouping and rendering primitives shared with `AgentMessages`), `ToolActivityItem`, `PermissionBanner`/`AskUserBanner`.
- `chat/` — Chat mode UI (`ChatView`, `ChatInput` on TipTap, `ChatMessages`).
- `work/` — Kanban board UI, shares `serverKanbanProjectsAtom` with Code's project sub-grouping.
- `settings/` — settings panels, with `primitives/` reusable form components.
- `ui/` — Radix UI primitives themed via CSS variables (see design tokens below); build on these rather than hand-rolling dropdowns/popovers/scroll areas.

**Terminology**: Code sidebar's "工作区" (Workspace) is `AgentWorkspace` (an MCP/Skills/session isolation unit). Kanban/Code's "项目" (Project) is a craft-style `Project` — a session grouping *inside* a workspace, carrying `workingDirectory`/`assets`/`MEMORY.md`. These are distinct concepts; don't conflate them in code or docs.

### Local storage layout

No local database — JSON config + append-only JSONL logs, so state is portable/inspectable/backup-friendly. Root is `~/.myyoda/` (packaged) or `~/.myyoda-dev/` (dev):

```
~/.myyoda/
├── channels.json / conversations.json / agent-sessions.json   # indexes
├── conversations/{uuid}.jsonl        # per-conversation Chat messages
├── agent-sessions/{uuid}.jsonl       # per-session Agent messages
├── agent-workspaces/{slug}/
│   ├── {session-id}/                 # per-session working dir
│   ├── workspace-files/              # cross-session shared files
│   ├── mcp.json  skills/
│   └── projects/{slug}/config.json, assets/, MEMORY.md
├── attachments/{conversationId}/{uuid}.ext
└── sdk-config/projects/              # Agent SDK per-project config
```

A session's Agent working directory, a Project's `workingDirectory`, and the Workspace's shared `workspace-files/` are three distinct locations — don't assume one implies another when reasoning about file paths.

## Design engineering rules (renderer UI changes)

Applies to `apps/electron/src/renderer/**/*.{tsx,css}` and `packages/ui/**/*.tsx`. Full source of truth: `.cursor/rules/design-engineering.mdc`; tokens live in `apps/electron/src/renderer/styles/globals.css` (`--ink-*`/`--duration-*`/`--ease-*`/`--shadow-*`/`--radius*`), mapped in `apps/electron/tailwind.config.js`.

- No hardcoded colors — use the Ink scale (`text-foreground/92|55|37`, `--ink-fill` 4%, `--ink-line` 7%, hover 7%, `--ink-selected` 12%, focus 15%). No per-theme color overrides outside the dedicated CRT-terminal override block in `globals.css`.
- Motion: only `duration-fast` (120ms) / `duration-base` (180ms) / `duration-slow` (240ms) — never a raw `duration-300`/`duration-500`. Only `ease-out` (expo-out) and `ease-in-out` — never `ease-in` for entrances, never the browser default `ease`.
- Buttons/clickables get `:active { scale(0.97) }` (`--press-scale`) — already built into `ui/button.tsx` and the `.agent-workbench/.refined-sidebar/.refined-inspector button:active` rule; don't bypass it in new components.
- Popovers/dropdowns/tooltips/context-menus must scale in from the trigger's `transform-origin` (`origin-[--radix-<primitive>-content-transform-origin] zoom-in-95`) — never `transform-origin: center` or `scale(0)`/`zoom-in-0`.
- Never `transition-all` / `transition: all` — list explicit properties (`transition-[background-color,color,transform]`).
- Build on `ui/` (shadcn/ui + Radix) rather than hand-rolling accessible primitives.

Self-check before submitting a UI change:
```bash
rg "transition-all|transition: all" apps/electron/src/renderer
rg "ease-in(?!-out)" --pcre2 apps/electron/src/renderer
rg "zoom-in-0|scale\(0\)|scale-0[^.]" apps/electron/src/renderer
rg "duration-(3|5|7)00" apps/electron/src/renderer
```
All four should return nothing new.

## Upstream sync (`sync/proma-*` branches)

This fork pulls from `upstream` (proma-ai/Proma) one-way only — **never open a reverse PR against upstream**. After cherry-picking/merging from `upstream/main` onto a `sync/proma-*` branch:

1. `bun run sync:apply-renames` (dry run), then `-- --write` once satisfied — fixes `@proma`→`@myyoda` residue via `scripts/upstream-sync/rename-map.json` only; never hand-roll a global find/replace.
2. `bun run sync:check` — hard gate (SDK pinned-version consistency across `apps/electron/package.json` deps + root `overrides`, `@anthropic-ai/claude-agent-sdk` residue = error since that runtime retired in 2026-08, doc-branding residue = warn by default).
3. `bun run typecheck`, and if the SDK/`agent-orchestrator.ts`/a Pi adapter was touched, manually smoke-test: send a message in Code, and run a Kanban task if relevant.

Conflict resolution rule of thumb: MyYoda-owned surfaces (Kanban/Project/Agent专家/`@myyoda` naming) win structural conflicts; take upstream's version for SDK/security/bugfix semantics. Never assume a name/prop that looks "unrelated" is dead scaffolding without checking `upstream/main` directly — a conflict can legitimately combine an unrelated fork-only addition with a genuine upstream change to the same lines. When default-skill content under `apps/electron/default-skills/<skill>/` changes, its `SKILL.md` frontmatter `version` must be bumped (patch +1) — the seeding/upgrade logic in `config-paths.ts`/`agent-workspace-manager.ts` uses semver comparison to decide whether existing users get the update.

## Version management

- Product/release version is `apps/electron/package.json`'s `version` (CI checks it against the git tag). Don't bump any package's `version` in a routine feature PR — only when explicitly cutting a release.
- The other workspace packages (`shared`/`core`/`ui`/`session-core`) version independently and aren't published to npm (`workspace:*` only) — no need to bump them alongside feature work.

## Code style

- No `any` — define a proper `interface`. Prefer `interface` over `type` for object shapes. Use `import type` for type-only imports.
- Comments and logs are written in Chinese, keeping technical terms as-is where that's clearer.
- Path alias `@/` → `apps/electron/src/renderer/`.
- TS config: `module: "Preserve"` + `moduleResolution: "bundler"`, strict mode, `noUncheckedIndexedAccess` and `noImplicitOverride` on; all packages are ESM (`"type": "module"`).

## Packaging (`apps/electron/`)

- Main/preload build with esbuild (`--bundle --platform=node --format=cjs`); renderer builds with Vite; distributables via electron-builder (`electron-builder.yml`).
- `electron` and the Pi runtime packages (`@earendil-works/pi-coding-agent`/`pi-agent-core`/`pi-ai`) must stay `--external` to esbuild. `@earendil-works/pi-tui` has native modules and is *not* external — it ships via `node_modules`, and `electron-builder.yml`'s `asarUnpack` must include `node_modules/@earendil-works/pi-tui/native/**`.
- Every other dependency should be esbuild-bundled into `main.cjs` rather than marked external — marking something external without adding it to electron-builder's `files` list produces "Cannot find module" at runtime in the packaged app.
- Pi runtime version must match in three places: `apps/electron/package.json` dependencies, root `package.json` `overrides`, and the esbuild `--external` list. `bun run sync:check` enforces this.
