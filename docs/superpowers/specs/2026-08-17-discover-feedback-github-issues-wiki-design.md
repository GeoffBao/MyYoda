# 发现面板重构设计：反馈 → GitHub Issues + Wiki 接入

- 日期：2026-08-17
- 状态：已批准（brainstorming 会话产出，待写实施计划）
- 关联：`2026-08-15-discover-community-content-design.md`（发现面板上一版设计）、`docs/luxcoder/05-feedback-to-notion-design.md`（Notion 反馈设计，本次被替换）

---

## 1. 背景与目标

「发现」面板与「意见反馈」目前与 GitHub 生态的关系是割裂的：

- **反馈**：提交到维护者自己的 Notion 数据库（internal token + databaseId 配置，截图 ≤5 张，失败落本地草稿）。审阅面在 Notion，与代码仓库无关。
- **官方内容**：来自独立内容仓库 `GeoffBao/myyoda-content`（content.json 清单）。
- **帮助**：应用内置的三个入口（使用指南/FAQ/快捷键），内容随应用版本发布。
- GitHub 侧已有：Discussions（社区 tab 已接入）；**wiki 已启用但完全空白**；open issues 仅 1 个。

本次重构把反馈与文档两块收拢到 GitHub 生态：

1. **反馈提交到 GitHub Issues**（`GeoffBao/MyYoda`），完全替换 Notion 链路；
2. **帮助/文档接入 GitHub Wiki**（`GeoffBao/MyYoda/wiki`），wiki 成为应用内帮助文档的内容源，维护者在网页上编辑即更新，无需发版。

**成功标准**：

- 用户在应用内提交的反馈（含截图）以 issue 形式出现在 `GeoffBao/MyYoda` 仓库，环境信息自动附带，维护者可直接在 GitHub 上 triage；
- 反馈提交链路与现有体验对齐：应用内提交、截图 ≤5 张、失败落本地草稿可重试、提交前有「公开可见」提示；
- 「帮助」tab 内可浏览 wiki 全部页面并应用内渲染正文，离线可读缓存；维护者更新 wiki 后用户刷新即可见；
- 官方精选、社区讨论、四 tab 结构不变；Notion 链路彻底移除。

## 2. 现状（重构前）

- `DiscoverView` 四 tab：官方精选（FeaturedFeed）/ 社区讨论（CommunityView）/ 帮助（HelpSection）/ 反馈（FeedbackSection）。
- 反馈链路：`FeedbackDialog` → IPC `feedback:submit` → 主进程 `feedback-service.ts` → Notion API（token 经 safeStorage 加密存 `~/.myyoda/feedback.json`，HTTP 走代理感知 fetch，失败落 `~/.myyoda/feedback-drafts/`）。
- 帮助 tab：三个内置入口（使用指南=主区 tutorial tab、FAQ=内置弹窗、快捷键=内置弹窗），无在线内容。
- 社区 tab：GitHub Discussions 只读浏览 + 本地缓存 + 跳浏览器互动（`community-service.ts`），是本设计的模式范本。
- git 是应用一等依赖（环境检查强制、git-session-context 等主进程服务已使用系统 git），wiki 走 git 方案无额外成本。

## 3. 已决策事项（澄清结论）

| 议题 | 决策 |
|---|---|
| Notion 渠道 | **完全替换**为 GitHub Issues，Notion 代码与配置入口移除 |
| Issue 认证 | 维护者配置 **fine-grained PAT**（Issues: Read and write，仅 `GeoffBao/MyYoda`），加密存储，与旧 Notion token 同模式 |
| 截图上传 | 非官方 `uploads.github.com/user-attachments/assets` 端点（Bearer token 可用，2026-08 实测社区普遍在用），URL 嵌入 issue 正文；失败降级纯文字提交 |
| 公开可见性 | 弹窗与反馈分区加醒目「公开可见」提示 |
| Wiki 角色 | 作为**「帮助/文档」源**接入帮助 tab；不替代官方精选内容源，不做独立文档 tab |
| 帮助 tab 组织 | wiki 列表为主 + 三个内置入口置顶快捷方式；FAQ 内容后续逐步迁往 wiki |
| 面板 tab 结构 | 四 tab 保留，反馈文案改 GitHub |
| Wiki 管线 | **git 浅克隆 + `_Sidebar.md` 索引 + 本地渲染**（离线可用、增量更新），图片经 raw.githubusercontent.com/wiki 代理感知拉取 |

## 4. 反馈链路 → GitHub Issues

### 4.1 配置与凭证

- 设置页「反馈渠道」改为 GitHub 配置：输入 fine-grained PAT，附生成指引（仓库权限仅 `Issues → Read and write` 于 `GeoffBao/MyYoda`）。
- 配置文件 `~/.myyoda/feedback.json` 结构升级：`{ version: 2, github: { tokenEncrypted, repo } }`；token 继续用 safeStorage 加密（`safeStorage.isEncryptionAvailable()` 不可用时明文回退，与现状一致）。
- 「测试连接」：`GET /repos/GeoffBao/MyYoda` —— 200 提示"凭证有效"；401 token 无效；403 权限不足；404 仓库不存在。**不使用 `GET /user`**（fine-grained token 无 user scope，会 403 误报）。
- 未配置凭证：反馈弹窗提交按钮置灰，提示"请先在设置中配置 GitHub 凭证" + 跳转设置按钮。

### 4.2 提交链路（重构 `feedback-service.ts`）

```
renderer（压缩截图 → IPC feedback:submit）
  → main: 校验配置 → 获取 repository_id（GET /repos，可缓存）
  → 每张截图 POST uploads.github.com/user-attachments/assets
        ?name=<filename>&content_type=<mime>&repository_id=<id>
        （Bearer token；返回 JSON 含附件 URL）
  → 拼装 issue body（模板 + 截图 markdown 嵌入）
  → POST api.github.com/repos/GeoffBao/MyYoda/issues（title/body/labels）
  → 返回 html_url → renderer 展示成功 + 打开链接
```

- 全链路走代理感知 `getFetchFn`（复用 proxy-settings-service / proxy-fetch 模式）。
- 截图压缩逻辑复用现状（PNG/JPEG、单张 ≤4MB、最多 5 张）。

### 4.3 Issue 模板

- title：`[Bug 报告] {描述前 40 字}` / `[功能建议] {描述前 40 字}`
- body：

```markdown
<!-- 来自 MyYoda 应用内反馈 -->

**类型**：Bug 报告 | 功能建议

**详细描述**：
<用户输入，≤5000 字>

**截图**：
![截图 1](<user-attachments URL>)
...

**环境信息**（自动注入）：
- MyYoda 版本：x.y.z
- 系统：macOS 15.x（arm64）| Windows ... | Linux ...
- 渠道：<agent 渠道名>

**提交时间**：<ISO 8601>
```

- labels：`bug` / `enhancement`。创建前 `GET /repos/GeoffBao/MyYoda/labels/<name>` 探测；不存在则不带 label（避免 422），并在提交结果中说明。
- 联系方式（邮箱）如用户填写，附在描述区之后。

### 4.4 失败降级与去重

- 任一环节失败 → 写本地草稿（`~/.myyoda/feedback-drafts/`，格式升级 v2：`{ version: 2, createdAt, input, appVersion, platform, uploadedAssetUrls? }`），UI 提示 + 草稿列表可重试。
- 截图已上传成功但 issue 创建失败 → 草稿记录 `uploadedAssetUrls`，重试时跳过重复上传。
- 截图上传失败但其余成功 → 降级为纯文字 issue + 提示"截图上传失败，已按文字提交"。
- 去重：本地记录「类型+描述 hash」；同 hash 再次提交 toast 提示"已提交过相同反馈"，不阻塞。

### 4.5 UI 调整

- `FeedbackSection`（反馈 tab）文案改为："反馈会公开提交到 GitHub Issues"，按钮不变。
- `FeedbackDialog` 提交按钮上方提示行："提交后 issue 与截图将在 GitHub 上公开可见"。
- 草稿列表 UI：v2 草稿可重试；v1（Notion 时代）草稿标记「旧格式」，可打开复制内容，不可提交。

### 4.6 安全与隐私

- 凭证模型与旧 Notion token 相同：token 加密存储于本地，可被提取的风险存在但随时可 revoke，个人产品阶段可接受（沿用 `05-feedback-to-notion-design.md` §7 结论）。
- 截图经 user-attachments 上传后由 GitHub 托管，公开可访问；仅当用户主动删除 issue 时随 issue 上下文一并失效。
- 演进路径：产品大规模分发后，可将 PAT 收至 Cloudflare Worker 代理（客户端只调自家 Worker），提交数据模型不变。

## 5. Wiki 管线（帮助/文档）

### 5.1 获取与缓存（新增主进程 `wiki-service.ts`）

- 源：`https://github.com/GeoffBao/MyYoda.wiki.git`（wiki 已启用；wiki 首次创建页面后仓库才存在，实现时对"仓库不存在"错误做明确提示）。
- 首次打开「帮助」tab 或手动刷新：浅克隆 `--depth 1` 到 `~/.myyoda/discover/wiki-cache/`；之后 `git fetch --depth 1 origin` + `git reset --hard FETCH_HEAD`；对比前后 HEAD hash 判断有无更新。
- clone/fetch 时按当前有效代理传入 `-c http.proxy=<proxyUrl>`（复用 `getEffectiveProxyUrl`）。
- 更新策略：打开帮助 tab 时异步刷新；有旧缓存则先用缓存渲染，刷新完成后有新 commit 则 toast「帮助文档已更新」。不设定时拉取。
- 失败降级：有缓存 → 显示缓存 + 离线提示（复用社区 tab CloudOff 模式）；无缓存 → 错误提示 + 重试按钮。不引入第二套 HTTP 拉取路径（YAGNI）。

### 5.2 页面列表

- 解析 `_Sidebar.md`（wiki 标准导航，`* [首页](Home)` 格式 + 缩进层级）得到有序、分组的页面树。
- `_Sidebar.md` 不存在 → fallback：仓库根目录 `*.md` 文件列表，`Home.md` 置顶，排除 `_Sidebar.md`/`_Footer.md`。
- 页面标题 = 文件名去掉 `.md`（与 wiki 页面链接一致）；页面视图标题优先取页面内首个 `# heading`，无 `# heading` 时回退为文件名。

### 5.3 正文渲染

- 正文从本地克隆直读 `.md`（零额外 HTTP、离线可用）。
- wiki 内相对路径媒体（`assets/...` 图片等）重写为 `https://raw.githubusercontent.com/wiki/GeoffBao/MyYoda/<branch>/<path>`，经代理感知拉取，复用现有 `media-rewrite.ts` 与远程媒体注册模式（与社区 tab 同机制）。
- Markdown 渲染复用 `ReleaseNoteMarkdown` 组件。
- 列表顶部标题过滤搜索框（前端本地过滤）。

### 5.4 UI（重构 `HelpSection` + 新增 WikiBrowser 组件）

- 帮助 tab：顶部三个内置快捷入口（使用指南/FAQ/快捷键）保持置顶卡片不变；下方新增「在线文档」区块。
- 在线文档区块：wiki 页面树（层级缩进、加载态/离线态/错误态）+ 区块右上角手动刷新按钮 → 点击页面应用内打开页面视图（标题 + 正文 + 右下「在 GitHub 打开」外链）；页面视图带返回按钮。
- 不引入 wiki 已读红点（与精选/社区区分，保持简单）。

### 5.5 IPC

- 扩展现有 DISCOVER 通道：`GET_WIKI_PAGES`（页面树 + fetchedAt/commit hash/fromCache）、`GET_WIKI_PAGE`（按页面名返回正文）、`REFRESH_WIKI`（手动刷新）、`WIKI_UPDATED` 事件推送。

## 6. 数据流

```
维护者编辑 wiki 页面（github.com/GeoffBao/MyYoda/wiki）
  → 用户打开帮助 tab → IPC GET_WIKI_PAGES
  → wiki-service: git fetch（代理）→ 解析 _Sidebar → 页面树（本地 .md 正文）
  → renderer WikiBrowser 渲染（媒体经 raw/wiki 代理拉取）

用户提交反馈（FeedbackDialog）
  → IPC feedback:submit → feedback-service
  → user-attachments 上传截图 → api.github.com issues 创建
  → 成功返回 html_url / 失败落草稿
```

## 7. 错误处理汇总

| 场景 | 处理 |
|---|---|
| PAT 未配置 | 提交按钮置灰 + 引导设置 |
| PAT 无效/过期（401/403） | 明确报错 + 引导重新配置；保留草稿 |
| 截图上传失败（端点变更/网络） | 降级纯文字 issue；全失败落草稿 |
| issue 创建失败 | 落草稿（含已上传 URL），可重试 |
| label 不存在（422） | 降级不带 label 重试 |
| wiki clone/fetch 失败 | 有缓存用缓存 + 离线提示；无缓存错误 + 重试 |
| wiki 仓库不存在（未建过页面） | 明确提示"文档库尚未创建" + 跳 GitHub 链接 |
| 无 git 环境 | 帮助 tab 显示错误提示（git 是环境检查强制项，兜底提示即可） |
| 代理网络异常 | 与现有 content/community 服务同样走代理感知 fetch，失败按上述降级 |

## 8. 迁移与兼容

- 配置：读取 `feedback.json` 时忽略旧 Notion 字段；检测到旧 Notion 配置存在时设置页提示一次"反馈已切换到 GitHub Issues，旧 Notion 配置不再使用"。**不自动删除**旧 token。
- 草稿：v2 格式；v1 草稿只读展示（可复制内容），不可提交。
- 反馈类型语义（bug/feature）与截图压缩逻辑不变。
- 设置页移除 Notion 配置 UI（token/databaseId/测试连接），替换为 GitHub PAT 配置 UI。

## 9. 测试策略

- **纯逻辑单测**：issue body 模板拼装；`_Sidebar.md` 解析（缩进层级、缺失 fallback、`_Sidebar`/`_Footer` 排除）；页面树构建；去重 hash；草稿 v1/v2 兼容读取。
- **wiki-service**：clone 成功/失败分支；fetch 更新检测（hash 对比）；仓库不存在错误。
- **feedback-service**：PAT 验证分支（200/401/403/404）；截图上传失败降级；issue 创建失败落草稿（含 uploadedAssetUrls 记录）；label 探测降级。
- **手动验证清单**：真实 PAT 创建测试 issue（用完即关）；截图上传与正文嵌入；断网降级落草稿 + 重试；wiki 离线读缓存；代理环境 clone/fetch；`_Sidebar` 更新后刷新可见。
- **回归**：community-service / content-service / FeaturedFeed 不动，现有测试保持通过。

## 10. 影响面清单

| 层 | 文件 | 改动 |
|---|---|---|
| 主进程 | `feedback-service.ts` | 重构为 GitHub 提交（保留草稿机制） |
| 主进程 | `wiki-service.ts` | 新增（clone/fetch/页面树/正文） |
| 主进程 | `config-paths.ts` | 新增 wiki 缓存目录路径 |
| 主进程 | `ipc.ts` | 反馈通道语义更新 + wiki 通道 |
| 主进程 | `preload/index.ts` | 通道暴露更新 |
| 共享 | `types/feedback.ts` | 配置/结果类型改 GitHub（含草稿 v2） |
| 共享 | `types/discover.ts` | 新增 wiki 页面树/正文类型 |
| 渲染 | `FeedbackSection.tsx` | 文案改 GitHub |
| 渲染 | `FeedbackDialog.tsx` | 公开提示 + 未配置态 |
| 渲染 | `HelpSection.tsx` | 置顶入口 + 在线文档区块 |
| 渲染 | 新增 `WikiBrowser.tsx` | 页面树列表 + 页面视图 |
| 渲染 | `discover-atoms.ts` | wiki 状态 atoms |
| 渲染 | 设置页反馈配置 UI + 草稿列表 UI | Notion → GitHub PAT；v1 草稿只读 |

**不动**：content-service、community-service、DiscoverView 四 tab 结构、FeaturedFeed、ReleaseNoteMarkdown。

## 11. 非目标（明确不做）

- OAuth 设备码认证流程
- 私有镜像仓库收反馈
- wiki 已读红点、正文全文搜索索引
- 应用内 issue 列表浏览（社区 tab 已是 Discussions）
- 官方精选内容源变更（`GeoffBao/myyoda-content` 保留）
- 定时拉取 wiki（打开时异步刷新足够）

## 12. 后续演进（不在本次范围）

- 反馈量大后：PAT 收至 Cloudflare Worker 代理，客户端零凭证
- FAQ 内置内容逐步迁往 wiki，最终内置 FAQ 只留精简版或移除
- 若 user-attachments 端点失效：切换为「截图传自建图床 + issue 贴链接」或纯文字提交
