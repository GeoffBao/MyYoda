# Upstream 同步与发版 Playbook（每日 23:00 定时任务参考）

本文件是「每日 upstream 同步 + patch 发版」定时任务的操作手册，记录 fork 适配规则与发版规范。每次同步如遇新问题，先在此补充规则，再继续。

## 仓库关系

- `origin` = git@github.com:GeoffBao/MyYoda.git（个人版本，本仓库）
- `upstream` = https://github.com/proma-ai/Proma.git（官方上游）
- 本地 main 是 upstream/main 的线性后代；同步方式为**手动适配合入**（不是直接 merge），因为本地 fork 有大量定制。

## 状态文件

- `scripts/upstream-sync/LAST_SYNCED_UPSTREAM`：上次已同步的 upstream commit 完整 SHA。每次同步完成后更新为 `git rev-parse upstream/main`，并 commit 进 main。
- 当前版本号读 `apps/electron/package.json` 的 `version`，发版时 patch+1。

## 同步步骤（每晚执行）

1. `cd /Users/admin/Workspace/ClaudeCode/MyYoda && git checkout main && git pull origin main && git fetch upstream`
2. `LAST=$(cat scripts/upstream-sync/LAST_SYNCED_UPSTREAM)`；`git log $LAST..upstream/main --oneline` 列出新提交。
   - **无新提交**：直接结束，不要发版。
3. 逐个 `git show <commit> --stat` + 完整 diff，评估适配方式。
4. 关键适配规则（fork 定制清单）：
   - 所有 `@proma/*` 包名 → `@myyoda/*`（core/ui/shared 等）。
   - Markdown 内自动化注释用 `MYYODA_AUTOMATION`（上游是 `PROMA_AUTOMATION`）。
   - `apps/electron/` 本地有大量结构改造（LeftSidebar 的 `sidebar-workspace-content`、`hideWorkspaceHeader`、MessageResponse 的 `MarkdownTable`、`message-response` 样式等）。**先读本地文件再适配**，保留本地改造。
   - 新文件直接 `git show <commit>:<path> > <path>` 复制；本地与上游父版本 0 差异的文件直接应用。
   - 判断依赖：`git show --stat <commit>` 看改动的文件，若前一个未同步提交也改了同文件，先检查依赖关系。
5. 适配后验证：`bun run --filter='@myyoda/core' typecheck`、`@myyoda/ui`、`@myyoda/electron` 全绿。
6. 发版（patch+1）：
   - `apps/electron/package.json` version bump。
   - 写 `apps/electron/resources/release-notes/<ver>.md`（格式参考 0.10.4.md：`# MyYoda vX.Y.Z 更新` + 按用户可感知的 Performance / Improvements / Bug Fixes 分节）。
   - `apps/electron/RELEASE_NOTES.md` 同步为该文件内容。
   - `docs/releasing.md` 的「当前发布版本」指针更新为下一版。
7. 提交与发布：
   - 分支 `chore/release-v<ver>`：代码适配提交（1 个或多个）+ 发布提交 `chore(release): v<ver> release note + bump 版本 <prev>→<ver>`。
   - 每个 commit 末尾加 trailer：`Co-Authored-By: MyYoda <MyYoda@noreply.github.com>`（用 `git commit --trailer`）。
   - `git push -u origin chore/release-v<ver>` → `gh pr create`（body 末尾加 `Made with [MyYoda](https://github.com/GeoffBao/MyYoda)`）→ `gh pr merge <n> --merge --delete-branch`。
   - `git checkout main && git pull` → `git tag -a v<ver> -m "release: v<ver>"` → `git push origin v<ver>`（**单独推 tag，禁用 --follow-tags**，避免误推历史 tag 且保证 Actions 触发）。
8. 收尾：`echo $(git rev-parse upstream/main) > scripts/upstream-sync/LAST_SYNCED_UPSTREAM`，commit `chore(sync): LAST_SYNCED → <sha8>` 并 push main。

## 发版硬约束（来自 docs/releasing.md）

- tag 必须为 `vX.Y.Z` 且与 `apps/electron/package.json` version 一致，否则 GitHub Actions 不构建。
- 已发布的 tag 不得移动或复用。
- 版本只在有新内容合入时叠加；无新提交不发布。

## 常见坑

- `git diff <commit> -- <untracked-file>` 会显示 deleted（untracked 文件不在 diff 范围），用 `cmp`/`git hash-object` 校验内容。
- upstream 大改动了本地也改过的文件时（如 LeftSidebar 5000+ 行 diff），不要整体覆盖，按区块手动适配。
- PR merge 若冲突或 CI 红：不要强合，保留分支、在回复中报告并结束。
- typecheck 是 monorepo filter 方式：`bun run --filter='@myyoda/<pkg>' typecheck`。
