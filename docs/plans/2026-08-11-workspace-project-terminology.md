# Workspace and Project Terminology Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the user-facing “空间容器/空间” concept and consistently present `AgentWorkspace` as 工作区, Craft `Project` as 项目, and `workingDirectory` as 项目工作目录 without changing persisted identifiers or deleting user data.

**Architecture:** Preserve the existing Workspace → Project hierarchy and cwd resolution. Make renderer-only Workspace actions reflect their real object, correct Craft Project labels, then sweep user-facing Workspace scope language. Keep IPC, JSON, physical paths, Outbox, Project MEMORY, and external project directories compatible.

**Tech Stack:** Electron, React, TypeScript, Jotai, Bun test, Vitest-compatible Bun tests.

---

### Task 1: Lock the canonical terminology in tests

**Files:**
- Modify: `apps/electron/src/renderer/components/app-shell/project-context-picker-model.test.ts`
- Create: `apps/electron/src/renderer/lib/workspace-project-terminology.test.ts`
- Create: `apps/electron/src/renderer/lib/workspace-project-terminology.ts`

**Step 1: Write failing tests**

Assert that Workspace management labels use 工作区 and Project picker labels use 项目. Keep existing session skip semantics covered.

**Step 2: Run tests and verify RED**

Run:

```bash
bun test apps/electron/src/renderer/lib/workspace-project-terminology.test.ts apps/electron/src/renderer/components/app-shell/project-context-picker-model.test.ts
```

Expected: new terminology exports/actions are missing or old Project labels still say 工作区.

**Step 3: Add the smallest canonical label module and update the picker model**

Expose a small immutable terminology object for user-facing nouns/actions; do not centralize arbitrary prose.

**Step 4: Run tests and verify GREEN**

Use the same command; expected 0 failures.

**Step 5: Commit**

```bash
git add apps/electron/src/renderer/lib/workspace-project-terminology.ts \
  apps/electron/src/renderer/lib/workspace-project-terminology.test.ts \
  apps/electron/src/renderer/components/app-shell/project-context-picker-model.ts \
  apps/electron/src/renderer/components/app-shell/project-context-picker-model.test.ts
git commit -m "test: define workspace and project terminology"
```

### Task 2: Correct AgentWorkspace management surfaces

**Files:**
- Modify: `apps/electron/src/renderer/hooks/useProjectActions.ts`
- Modify: `apps/electron/src/renderer/components/settings/SettingsPanel.tsx`
- Modify: `apps/electron/src/renderer/components/settings/WorkspaceSettings.tsx`
- Modify: `apps/electron/src/renderer/components/app-shell/WorkspaceSwitcher.tsx`
- Modify: `apps/electron/src/renderer/components/agent/WorkspaceSelector.tsx`
- Modify: all direct `useProjectActions` consumers

**Steps:**
1. Rename renderer-only actions to `selectWorkspace` / `createWorkspace`.
2. Change setting/tab/button/toast/aria copy from 空间/项目 to 工作区.
3. Clarify Workspace deletion: MyYoda-managed workspace data and bindings are removed; external project working directories are not deleted.
4. Preserve default/last Workspace guards and API calls.
5. Run terminology tests and renderer typecheck.
6. Commit the focused Workspace UI change.

### Task 3: Correct Craft Project surfaces

**Files:**
- Modify: `apps/electron/src/renderer/components/app-shell/ProjectContextPicker.tsx`
- Modify: `apps/electron/src/renderer/components/app-shell/project-context-picker-model.ts`
- Modify: `apps/electron/src/renderer/components/agent/DraftProjectPicker.tsx`
- Modify: `apps/electron/src/renderer/components/app-shell/NewTaskProjectFlowDialog.tsx`
- Modify: `apps/electron/src/renderer/components/work/CreateProjectDialog.tsx`
- Modify: `apps/electron/src/renderer/components/app-shell/kanban/KanbanProjectFilter.tsx`
- Modify: `apps/electron/src/renderer/components/app-shell/kanban/TaskEditor.tsx`
- Modify: relevant onboarding, Welcome, and sidebar labels/comments

**Steps:**
1. Replace “选择/新建工作区” with “选择/新建项目” where the object is `ProjectConfig`.
2. Label folder browsing as using an existing project folder / selecting a project working directory.
3. Preserve the selected Workspace prerequisite and project binding/skip behavior.
4. Run focused picker/model tests and renderer typecheck.
5. Commit the focused Project UI change.

### Task 4: Sweep Workspace-scope capability language

**Files:**
- Modify user-visible strings in `apps/electron/src/main/lib/bridge-command-handler.ts`, bridge cards, capability toasts, tips, file browser, migration, Skills/MCP, Planning, Scratch Pad, Diff labels, FAQ/tutorial surfaces.

**Steps:**
1. Replace user-facing 当前空间/其他空间/空间列表/空间配置/空间文件 with their 工作区 equivalents.
2. Do not touch CSS `space-*`, database outbox, identifiers, or migration schema keys.
3. Run a scoped grep and classify remaining occurrences.
4. Run targeted tests/typecheck and commit.

### Task 5: Correct prompt terminology and update the Double Review report

**Files:**
- Modify: `apps/electron/src/main/lib/agent-prompt-builder.ts`
- Modify: `packages/shared/src/projects/prompt.ts`
- Modify: prompt tests
- Modify: `/Users/admin/.myyoda/agent-workspaces/default/workspace-files/.context/2026-08-11-double-review-proma-craft-myyoda-integration.md`

**Steps:**
1. Clarify session attachment to Workspace and optional binding to Project.
2. Clarify Project working directory vs Workspace fallback without changing XML tags.
3. Update report commit scope, canonical terminology, “空间容器” UI retirement, compatibility boundaries, and migration order.
4. Run prompt tests/typecheck and commit repository changes. The external report is not part of the Git commit.

### Task 6: Verify and review

**Steps:**
1. Run focused terminology, picker, prompt, Workspace manager, and deletion tests.
2. Run `bun run typecheck`.
3. Run full `bun test`.
4. Run `git diff --check` and inspect `git diff main...HEAD`.
5. Grep remaining user-visible terminology; document intentional legacy/internal occurrences.
6. Request an independent code review, verify findings, and apply only evidence-backed fixes.
7. Update project MEMORY with the verified decision/result.
