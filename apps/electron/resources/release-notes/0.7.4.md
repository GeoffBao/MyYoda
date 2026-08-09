# MyYoda v0.7.4 更新

## 新功能

### Pull Request 完整闭环：创建 / 查看 / 合并 / 评论

新增完整的 PR 工作流，无需离开应用即可完成从分支到合并的全过程（数据源为本地 gh CLI，不存储任何 GitHub 凭证）：

- **PR 详情独立 Tab**：Summary（状态徽标 / 作者 / diffstat / CI checks / 合并按钮）/ Code（gh diff 双栏视图）/ Timeline（评论流 + 评论框）三页签，可同时打开多个 PR。
- **一行创建 PR**：状态行根据当前仓库状态自动引导——检测 gh 与分支上游、提示同步、自动生成标题与 body，支持 Draft；已存在 open PR 时自动复用而非重复创建；默认分支缺失时自动建 `feat/<branch>-<date>`。
- **PR 内直接合并**：Squash / Merge / Rebase 三选一，可选合并后删除分支；分支被 worktree 占用时自动禁用删除，避免破坏工作区。
- **评论 + 转给 Agent 修**：Timeline 内直接回复，评论内容可一键带入 Agent 输入框继续处理。
- **左侧栏 Pull Requests 列表页**：Open / Closed / Merged 状态筛选 + All / Reviewing / Authored 参与度筛选 + 搜索（标题 / 编号 / 分支 / 作者 / 仓库）+ 空状态引导。
- **固定修复**：左栏 PR 列表改为读取真实仓库 workingDirectory（此前拿到的是内部配置目录导致列表恒为空）；gh 安装/登录状态检测加 30s 缓存，消除高频场景下主进程反复同步网络往返造成的卡顿。

### 内嵌浏览器 + Computer Use 自动化（synara 移植）

新增完整的内嵌浏览器能力，Agent 可以直接在应用内浏览网页并像人一样操作系统：

- **内嵌浏览器面板**：WebContentsView 承载，共享持久化登录态分区，支持多标签、地址栏 / 前进后退 / 刷新。
- **22 个 browser 自动化工具**：Claude / Pi 双 runtime 注入语义快照、点击、输入、脚本执行、文件上传等操作能力。
- **元素标注**：语义快照可视化投影 + 点击拾取器 + 滚动跟踪，拾取结果回传浏览器面板展示，Agent 操作过程一目了然。

### 本地 Skill 上传社区市场 + 用量统计

- **一键上传本地 Skill 到社区市场**：检测本机 gh 登录状态后，自动 fork / clone / 追加 sources.yaml / commit / push / `gh pr create` 全流程，全程不存储任何 GitHub 凭证。
- **Skill 用量统计**：各 Skill 调用次数与最近使用时间跨会话持久化，Skill 卡片与详情面板展示用量徽标。

### 项目容器简化

- 移除 home / ad-hoc 隐藏项目容器，未绑定会话对齐 `projectId=undefined` 模型、由 Workspace Task 承载；新建项目不再产生隐藏 kind，存量数据读兼容保留。

### 置顶会话折叠

- 置顶会话列表最多展示 5 个，超出部分折叠为「显示更多」，避免长列表抢占侧边栏空间。

### 记忆自组织维护引导

- 知识维护 Skill 增强：`MEMORY.md` 索引同步要求、主题文件主动重整（主题累积 3 个以上或内容越界时自动拆分 / 迁移）、维护时顺带整理，无需用户专门提出「整理记忆」。

## 修复

- **Agent 环境 PATH 加固（Windows）**：修复 GUI 快捷方式 / 更新器 relaunch 启动链下 PATH 残缺导致 bash 里 python / node 不可用、误报 Node 未安装的问题——注册表系统 + 用户 PATH 兜底（reg.exe 用 SystemRoot 绝对路径修复鸡生蛋）、大小写不敏感取值、过滤 Bun 临时 node shim、Windows Node 检测优先扫描注册表 / winget / 用户 PATH 并自动选最高版本；注册表失败结果也做 60s 缓存，避免持续同步阻塞。
- **代理设置应用到 Tavily 与 Chrome MCP**：系统代理配置现在真正透传给 Tavily 搜索与 Chrome DevTools MCP，同时避免代理探测 / MCP 启动阻塞主进程。
- **WorktreeSelector 区分 detached 残留与真实 worktree**：不再把历史 detached 残留误判为真实 worktree，切换更准确。
- **应用内版本历史四连修**：动态摘要取具体功能点（不再永远是「新功能」）；点击版本条目滚动定位到对应版本；完整历史覆盖 0.4.0 至今全部版本；默认折叠只显示 4 条、可一键展开全部。
- **Agent 产出资产纳入右侧 Files**：assets 目录纳入产出捕获，Agent 生成的图片等资产在右侧 Files 直接可见，提示词引导产物正确落点。
- **Agent 输入模型选择器加宽**：长模型名不再被截断。
- **Git 提交署名标识优化**：commit trailer 改为 `Co-Authored-By: <模型名> in MyYoda`，可追溯实际执行模型且不污染 GitHub contributors。
- **社区市场命名统一**：插件市场命名统一为「社区市场」，清理 n-skills 残留文案。

## 下载

- **macOS Apple Silicon** — `MyYoda-0.7.4-arm64.dmg` / `MyYoda-0.7.4-arm64-mac.zip`
- **Windows** — `MyYoda-Setup-0.7.4-x64.exe`
- **Linux (Ubuntu)** — `MyYoda-0.7.4-x86_64.AppImage` / `MyYoda-0.7.4-amd64.deb`

## macOS 打开说明（重要）

当前 Release **未配置 Apple Developer ID 签名/公证**。从浏览器下载后，macOS Gatekeeper 可能误报：

> "MyYoda" is damaged and can't be opened.

**这不是安装包损坏。** 安装到 Applications 后执行：

```bash
xattr -cr /Applications/MyYoda.app
open /Applications/MyYoda.app
```

Made with [MyYoda](https://github.com/GeoffBao/MyYoda)
