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

## 缓存

- 目录级：cwd + git HEAD（同一 worktree 多会话共享）
- 文件级：`~/.myyoda/cache/repo-map/file-cache.json`（mtime 键 + LRU 3000 条上限）
