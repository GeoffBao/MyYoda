# repo-map — 代码库地图注入

为 Agent 会话提供「代码库地图」（PageRank 符号排序 + mention 感知 + 行预算），
随 per-message 上下文注入 `<repo_map>` 块，帮助模型（尤其 DeepSeek 等弱定位模型）
快速了解仓库热点与符号位置，减少盲目 grep。

## 依赖决策（vendor 化说明）

核心引擎移植自 [aider-desk/tree-sitter-utils](https://github.com/hotovo/aider-desk)（MIT，
Aider repo map 的 TypeScript 实现）。**选择 vendor 化而非 npm 依赖**的原因：

1. 该包是 aider-desk monorepo 内部包（版本 0.1.0、单作者维护），非稳定公共 API；
2. 移植时修复了 6 个上游 bug（详见下方），vendor 化便于维护定制差异；
3. 避免引入完整 aider-desk 仓库依赖树。

**与上游的差异（vendor/src 内的本地修复）**：
1. tree-renderer 用相对路径读文件 → ENOENT（加 root 基准）
2. maxLines 预算在文件多时 maxContentLines=0 → 只剩省略号
3. cache-manager 原用 node:sqlite → 改为 JSON 文件缓存（项目不采用本地数据库）
4. WASM 运行时下载 → 内置优先 + `~/.myyoda/cache` 兜底（离线可用）
5. web-tree-sitter ESM 入口在 esbuild cjs bundle 下 import.meta 失效 →
   build:main/watch:main 标为 `--external:web-tree-sitter`（运行时走 cjs 入口）
6. 依赖图为空（纯定义/无跨文件引用）→ 退化按文件定义数排序

## 资源

- `apps/electron/resources/repo-map/`：27 语言 tags.scm + 核心 tree-sitter.wasm
  （electron-builder extraResources 分发；打包前 `sync:runtime-deps` 会同步
  web-tree-sitter 到 apps/electron/node_modules）
- **内置语言 wasm（10 种，2026-08-12）**：typescript/tsx/javascript/python/go/java/c/cpp/rust/php
  （≈7.1MB，离线可用；来源 npm registry tarball，已逐语言实测与内置 web-tree-sitter ABI 兼容）
  - **tree-sitter-dart 不内置**：npm 最新版（1.x）与内置 web-tree-sitter 0.26.12 ABI 不兼容
    （Language.load 失败），dart 项目可手动放置兼容版 wasm 到 `~/.myyoda/cache/tree-sitter/`
- **CDN 回退链**：unpkg → jsdelivr → fastly.jsdelivr（24h 失败冷却 + 10s 超时 + 魔数校验）
- **地图盘上缓存**（2026-08-12）：`~/.myyoda/cache/repo-map/maps/<sha1(HEAD)>.map`，
  同 HEAD 的多 worktree 会话/多实例共享（key=HEAD 而非 cwd，避免每个 worktree 重复全量扫描）；
  LRU 200 个文件；唯一 tmp + 目录锁安全写

## 缓存

- 目录级：cwd + git HEAD（同一 worktree 多会话共享）
- 文件级：`~/.myyoda/cache/repo-map/file-cache.json`（mtime 键 + LRU 3000 条上限）
