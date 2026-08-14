# MyYoda 用户反馈 → Notion 方案设计（评审 + 设计）

> 日期：2026-08-14
> 状态：设计定稿，待实现
> 关联：`ReleaseNotesPopover`（更新日志与帮助入口）、Notion workspace `brain0822`

---

## 1. 需求回顾

1. 在「更新日志与帮助」入口增加用户反馈功能。
2. UI 参考 newmax 的反馈弹窗（用户提供两张截图）：
   - 标题「反馈」+ 右上角关闭
   - 类型二选一 tab：「Bug 报告（报告问题或错误，🐛）」「功能建议（提出新功能想法，💡）」
   - 「详细描述」多行输入，占位符随类型切换，右下角字符计数 `0/5000`
   - 「截图 (0/5)」：「截屏」（相机图标）+「上传」（图片+图标）两个按钮
   - 底部右侧：「取消」（浅灰）+「提交反馈」（绿/主色）
   - 无星级评分、无标签选择
3. 提交的反馈直接进入用户 Notion 数据库（"直接在 notion 数据库里面"），全链路关联。

---

## 2. 后端选型：Notion ✅ vs GitHub vs Cloudflare

用户有三个可用账号（Notion / Cloudflare / GitHub），要求三选一。结论：**选 Notion**。

| 维度 | **Notion（选中）** | GitHub Issues | Cloudflare（Worker+D1/R2） |
|---|---|---|---|
| 人工审阅体验 | ✅ 数据库原生视图：看板/筛选/状态流转/评论，反馈 triage 体验最佳 | 一般：issue 列表 + label，适合开发者自己看 | ❌ 无任何现成审阅界面，需自建 dashboard |
| 截图上传 | ✅ **2026 起官方 Direct Upload API**（`POST /v1/files` → multipart 上传 → `file_upload` 引用），≤20MB，免费版 5MiB/文件 | ❌ 官方 API 不支持 issue 二进制附件；只能走非官方 `user-attachments` endpoint（社区 hack，随时可能失效）或 Contents API 提交进仓库再引用 raw URL | ✅ R2 原生支持，但要先经 Worker 中转，且仍无审阅界面 |
| 配置复杂度 | 一个 internal token + 数据库 ID，2 个字段 | 一个 PAT + 仓库（私有仓库才安全，公开仓库=反馈公开可见） | 最高：Worker 代码 + D1 建表 + R2 桶 + 域名/代理 |
| 安全边界 | token 内嵌客户端可被提取；可随时 revoke，个人产品阶段可接受（见 §7） | 同理；且公开 repo 下 spam 风险更高 | 同样可被提取（共享密钥在客户端），保护不了多少 |
| 生态与后续 | 直接复用用户已有的「第二大脑」工作流；Notion 数据可再加工 | — | 与用户现有体系无交集 |

**结论与演进路径**：Notion 在「审阅体验 + 官方截图上传 + 配置成本」三个关键维度全面领先，且是用户原始诉求。若未来产品大范围分发、担心 token 泄露，再加一层 Cloudflare Worker 代理把 Notion token 收到服务端即可（客户端只调自家 Worker），数据模型不变，属于可平滑迁移的演进，不是推翻。

---

## 3. Notion 侧资源（已全部完成 ✅）

| 资源 | 值 | 状态 |
|---|---|---|
| Connection（内部集成） | `MyYoda Feedback`，Access token 认证，workspace `Eason`（付费版，单文件上传上限 5GiB） | ✅ |
| 授权页面 | 「MyYoda 用户反馈」page id `3bcc5abc-f5be-8001-9cb0-ce1dfb93e459` | ✅ 已授权连接 |
| 反馈数据库 | **「用户反馈」DB id `4bdde411-b205-42a7-9be5-a9f51fa02698`**，data source id `20e6c86d-3e28-42f9-bb3f-12e4426cca40` | ✅ 已创建（7 属性） |
| 全链路实测 | 已写入一条测试条目 + 图片 file_upload + image block（2026-03-11 API 实测通过） | ✅ |
| 集成 token | `ntn_...`（用户提供，后续配置到应用设置） | ✅ 已验证可用 |

## 4. 反馈数据库 schema（API 创建）

数据库名：`用户反馈`，父页面 = 「MyYoda 用户反馈」page。

| 属性 | 类型 | 说明 |
|---|---|---|
| 标题 | title | 自动生成：`[Bug 报告] 描述前 30 字`（可为空时用 `[Bug 报告] 无描述`） |
| 类型 | select | `Bug 报告` / `功能建议` |
| 状态 | select | `待处理` / `处理中` / `已完成` / `暂不处理`（新条目=待处理） |
| 版本 | rich_text | 应用版本号，自动附带（对桌面应用定位 bug 至关重要） |
| 联系方式 | email | 可选，用户填写；newmax 没有此字段，评审结论是**加上**（见 §6-1） |
| 截图 | files | file_upload 引用（可复用一个 file_upload id） |
| 平台信息 | rich_text | `os/arch/app`，自动附带，如 `darwin arm64 0.9.0` |

页面内容（children blocks）：
- 「详细描述」正文拆分为 paragraph blocks（保留换行，按段落切块，注意 100 blocks/请求上限——单条描述远达不到）。
- 每张截图以 image block 追加：`{ type: "image", image: { type: "file_upload", file_upload: { id } } }`。

---

## 5. 应用侧设计

### 5.1 UI

**入口**：`ReleaseNotesPopover` 底部快捷区新增「意见反馈」项（`MessageSquare` 图标），点击打开 `FeedbackDialog`。该入口与「使用指南 / FAQ / 快捷键」同一视觉体系，不动现有布局。

**FeedbackDialog**（参考 newmax，结合 MyYoda 设计语言——用 `primary` 主色而非 newmax 的绿色）：
- 标题「反馈」+ 关闭按钮
- 类型 tab：`Bug 报告`（`Bug` 图标 + 副文案）/ `功能建议`（`Lightbulb` 图标 + 副文案），默认 Bug 报告
- 「详细描述」textarea：5000 字上限 + 实时计数 `n/5000`，超限截断或禁输；占位符随类型切换（"请描述您遇到的问题，包括复现步骤..." / "请描述您希望添加的功能..."）
- 「截图 (0/5)」：
  - **截屏**：直接调用现有 `SCREENSHOT_CAPTURE` 通道截当前应用窗口（`capturePage`），比 newmax 唤起系统截屏工具体验更好——一步出图
  - **上传**：系统文件选择器，过滤 `png/jpg/jpeg/webp`
  - 缩略图预览 + 单张删除
- 底部右侧：`取消`（ghost）/ `提交反馈`（primary；描述为空时禁用，提交中 loading 态防重复）
- 提交成功：toast「感谢你的反馈」+ 关闭弹窗；失败：保留表单内容 + 错误提示 + 「保存草稿」降级（见 5.4）

**设置**（`SettingsPanel` 新增「反馈」节，或并入现有 General）：
- `Notion Token`（password 输入框，复用现有加密存储）
- `数据库 ID`（输入框）
- `测试连接` 按钮：POST 一条测试页到 DB 后自动删除（或仅 GET database 校验存在性），显示 ✅/❌
- 未配置时，FeedbackDialog 提交按钮旁提示「尚未配置 Notion 提交渠道」，点击跳转设置

### 5.2 数据流

```
FeedbackDialog (renderer)
  └─ IPC FEEDBACK_SUBMIT { type, description, screenshots: base64/path[], contactEmail?, version, platform }
       └─ main/lib/feedback-service.ts
           1. 校验：描述非空且 ≤5000；截图 ≤5
           2. 逐张截图：压缩（目标 ≤4MB，免费版 5MiB 上限留余量；PNG→JPEG quality 80，长边 ≤2560）
           3. 每张：POST /v1/files { mode: single_part } → 拿 upload_url + file_upload id
                     → POST upload_url（multipart，字段 file）→ 完成上传
           4. POST /v1/pages：parent=database_id，properties + children（paragraph + image blocks）
           5. 返回新页 URL → renderer toast
```

**关键实现约束**：
- HTTP 走 `lib/proxy-fetch.ts` 的 `getFetchFn(proxyUrl)`——用户在代理/不可直连 Notion 环境下也必须能提交（国内网络环境是刚需）。
- Notion-Version header：`2026-03-11`（Direct Upload 需要的新版本号）。
- 所有请求失败不抛到 renderer 原始错误，转成可读中文错误码（token 无效 / 数据库不存在 / 网络失败 / 图片超限）。

### 5.3 IPC 与类型

- `packages/shared` 新增 `FEEDBACK_IPC_CHANNELS = { SUBMIT, TEST_CONNECTION, GET_CONFIG, SAVE_CONFIG }`（放 `types/feedback.ts`，注意 workspace 包改动的 `bun install` 坑——项目 memory 已有记录）。
- `apps/electron/src/types` 现有 `SETTINGS_IPC_CHANNELS` 模式参考。
- main `ipc.ts` 注册 4 个 handler，全部薄封装转 `feedback-service.ts`（与 `release-notes-service.ts` 同模式）。

### 5.4 失败降级与离线草稿

- 提交失败时：草稿（含截图路径）写入 `~/.myyoda/feedback-drafts/<timestamp>.json`，toast 提示「已保存草稿」；设置页提供「查看草稿 / 重试 / 清除」。
- v1 不建自动重试定时任务（用户可点击重试即可）；若后续反馈量大再考虑 Automation 周期重扫。

### 5.5 隐私边界

- 只提交用户**显式填写**的描述 + 选择的截图 + 自动附带的版本/平台。不收集日志、会话内容、代码片段（避免隐私事故）。
- 截图是「当前应用窗口」而不是整屏，降低误截到其他应用敏感内容的概率（截屏按钮的语义明确为「截 MyYoda 窗口」）。

---

## 6. newmax 参考设计评审

**值得采纳**：
- 类型二选一 tab + 副文案：比下拉框更直观，提交前心理成本低。
- 5000 字上限 + 实时计数：给足空间又防止超长噪音。
- 截图 ≤5：对 bug 报告足够，避免上传滥用。
- **不设星级评分**：认同。修复型反馈评分意义小（对「提交渠道」评分≠对产品评分），且会让 bug 报告者困惑。

**评审改进（结合 MyYoda 场景）**：
1. **加「联系方式」可选 email**：newmax 没有。但对独立开发者收集反馈，「无法回复提问」是最大痛点（bug 复现经常需要追问）。默认折叠为可选项，不增加填表负担。
2. **自动附带版本号 + 平台**：桌面应用定位 bug 的第一要素，且零用户成本。
3. **「截屏」语义升级**：直接截当前应用窗口（Electron `capturePage`），而非唤起系统截屏工具；一步完成、且天然只含本应用内容。
4. **空描述禁用提交 + loading 态**：newmax 截图无法看出，这里明确补上。
5. 视觉主色改用 MyYoda 的 `primary`（newmax 是绿色，不套用品牌色）。

---

## 7. 安全与规模边界（如实说明）

- **个人/小范围阶段**：Notion token 存在用户本地设置，直接由客户端调 Notion API，可接受。token 随时可在 Connections 页 revoke/refresh。
- **大范围分发后**：客户端内嵌 token 可被提取，滥用上限 = 往该数据库写垃圾数据（token 只授权了这一个页面，爆炸半径已被 Content access 收窄到最小）。届时升级为 Cloudflare Worker 代理（token 上移服务端 + 可选 rate limit），客户端协议不变。
- 数据库建议保持仅「MyYoda Feedback」连接 + 用户本人可见，不公开分享链接。

## 8. 实施计划（分阶段）

| 阶段 | 内容 | 验收 |
|---|---|---|
| 0（本轮） | 选型、Notion 连接/页面/授权、设计文档 | ✅ 已基本完成，数据库待建 |
| 1 | shared 类型 + IPC channel；`feedback-service.ts`（页面创建 + 文件上传 + 代理 fetch）；Settings 配置节 + 测试连接 | 单测（mock fetch）+ dev 手工提交一条真实反馈到 Notion |
| 2 | FeedbackDialog UI + 入口接线；截屏/上传/预览/删除；草稿降级 | 手工走通「截屏→提交→Notion 出现记录」 |
| 3（可选） | 图片压缩调优、重试队列、多语言 | — |

**回归红线**（项目约束）：不动 `ReleaseNotesPopover` 现有逻辑，只在底部追加一个入口项；新增文件全部独立（`feedback-service.ts` / `FeedbackDialog.tsx` / `feedback-atoms.ts`），零改动现有组件内联逻辑。

## 9. Notion API 关键参考（实现用，**已按 2026-03-11 实测验证**）

> ⚠️ 2026 新版 API 与旧文档差异很大，以下全部为本轮实测通过的契约。旧文档里的 `POST /v1/files`、`properties` 在数据库对象上、`archived` 字段均已失效。

```
① 创建数据库（含属性）：POST https://api.notion.com/v1/databases
   body: { parent: { type: "page_id", page_id },
           title: [...],
           initial_data_source: { properties: { 标题:{title:{}}, 类型:{select:{options:[{name,color}]}}, ... } } }
   注意：属性挂在 initial_data_source.properties，响应里数据库对象不带 properties（属性在 data_sources[] 的 data source 对象上）。

② 读属性/改属性：GET/PATCH https://api.notion.com/v1/data_sources/{data_source_id}
   （注意下划线 data_sources；data_source_id 从数据库响应的 data_sources[0].id 取）

③ 创建反馈条目：POST https://api.notion.com/v1/pages
   parent: { type: "data_source_id", data_source_id }   ← 不是 database_id！
   properties + children（paragraph blocks）同旧版语义。

④ 追加块（如截图 image block）：PATCH https://api.notion.com/v1/blocks/{page_id}/children
   （新版是 PATCH，旧版 POST 已 404）
   body: { children: [ { object:"block", type:"image", image:{ type:"file_upload", file_upload:{ id } } } ] }

⑤ 文件上传（截图）：
   a. POST https://api.notion.com/v1/file_uploads
      body: { mode:"single_part", filename, content_type }   → 返回 { id, upload_url, status:"pending" }
   b. POST {upload_url}（= /v1/file_uploads/{id}/send） multipart/form-data，字段 file（curl -F "file=@x.png;type=image/png"）
      → status:"uploaded"，file_upload id 可复用

⑥ 删除/回收站：PATCH /v1/databases/{id} 或 /v1/pages/{id}，body { "in_trash": true|false }（旧版 archived 字段已失效，且对已归档对象再 PATCH 会报 400）
   注意：父对象被回收时子页会连带变 in_trash:true，恢复父对象后子页自动恢复。

Headers：Authorization: Bearer ntn_...；Notion-Version: 2026-03-11
已实现资源：DB id 4bdde411-b205-42a7-9be5-a9f51fa02698，data_source id 20e6c86d-3e28-42f9-bb3f-12e4426cca40
```
