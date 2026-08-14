# 发布与版本规范

## 版本真源

桌面应用的发布版本以 `apps/electron/package.json` 的 `version` 为唯一真源。Git tag 必须为相同版本加 `v` 前缀，例如应用版本为 `0.1.95` 时，发布 tag 必须是 `v0.1.95`。

根 `package.json` 是私有 workspace 配置，不参与桌面应用发布版本。`packages/shared`、`packages/core`、`packages/ui` 与 `packages/session-core` 是内部包版本：改动某个包时，按需递增该包的 patch 版本，但不用于生成 GitHub Release tag。

## 版本递增

遵循 Semantic Versioning：

- `PATCH`（`0.1.95` → `0.1.96`）：修复、UI 调整、文案和兼容性补丁。
- `MINOR`（`0.1.95` → `0.2.0`）：用户可感知的新功能或完整工作流能力。
- `MAJOR`（`0.x.y` → `1.0.0`）：不兼容迁移、数据格式或配置的破坏性变更。

普通开发提交不要求递增应用版本；在准备发布时统一确定并提交版本号。当前发布版本为 `0.10.0`；下一次发布版本为 `0.10.1`。

## 发布流程

1. 在发布提交中更新 `apps/electron/package.json` 的 `version`；若有受影响的内部包，同时递增其 patch 版本。
2. 在 `release-notes/vX.Y.Z.md` 写本版用户向更新说明（相对上一 tag 的 Features / Fixes / 下载产物名），与 GitHub Release body 对齐。
3. 提交：`chore: bump version to vX.Y.Z`（含 version + release notes；必要时同步本文件「下一次发布版本」指针）。
4. 在干净的提交上创建带注释 tag：`git tag -a vX.Y.Z -m "release: vX.Y.Z"`。
5. **先推送 main 提交，再单独推送 tag**（⚠️ 不要用 `--follow-tags` 与 main 一起推）：
   ```bash
   git push origin main
   git push origin vX.Y.Z
   ```
   `--follow-tags` 会把所有本地 tag 一起推上去（误推历史/上游 tag），且 tag 与 commit 同批推送时 GitHub Actions 偶发漏触发（v0.6.3 曾因此不构建，只能靠手动 dispatch 补跑）。单独 `git push origin vX.Y.Z` 可保证触发。
6. 若 electron-builder 生成的 Release body 为空或过简，用 `release-notes/vX.Y.Z.md` 内容更新 GitHub Release 描述。
7. GitHub Actions 在构建前校验 tag 格式必须为 `vX.Y.Z`，且去掉 `v` 后必须等于 `apps/electron/package.json` 的版本；不一致时不会执行 macOS 或 Windows 构建。
8. 在 GitHub Releases 确认 Release 不是 Draft，且 macOS arm64、Windows x64、Linux x64 的安装包和更新元数据均已上传。

已发布的 tag 不得移动或复用；如需修复发布内容，递增 patch 版本后重新发布。
