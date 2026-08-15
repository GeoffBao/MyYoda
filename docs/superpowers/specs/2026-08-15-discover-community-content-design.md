# 「发现」面板设计：官方内容 + 社区 + 反馈

- 日期：2026-08-15
- 状态：已批准（brainstorming 会话产出，待写实施计划）

## 1. 背景与目标

MyYoda 目前缺少一个面向用户的「官方内容 + 社区交流」入口。本次设计一个统一面板：

1. 官方内容（视频/教程/公告/外链）在应用内展示，其中视频支持**版本更新**——维护者发布新版后，老用户打开应用即可看到「更新」标记并点击播放
2. 社区讨论依托 GitHub Discussions，应用内只读浏览，发帖/回复跳浏览器
3. 现有 Notion 反馈功能并入同一面板

**成功标准**：侧边栏进面板即可看视频（不跳出应用）；发布新版视频后老用户看到「更新」并播放新版；社区三板块可浏览、跳浏览器参与；反馈功能原样可用。

## 2. 方案选型（已决策）

- 官方内容源：公开 GitHub 内容仓库 `GeoffBao/myyoda-content` 的 `content.json` 清单（`raw.githubusercontent.com` 拉取，jsDelivr CDN 兜底）
- 视频托管：内容仓库的 GitHub Release 资产，下载到本地缓存播放
- 社区承载：MyYoda 主仓库 GitHub Discussions（REST API 只读 + 本地缓存），互动跳浏览器
- 反馈：沿用现有 Notion 反馈机制（FeedbackDialog），不做改动
- 否决项：Notion 作为社区承载（评论弱、需内嵌 token 或代理、限流）；自建后端（违背本地优先、范围暴涨）

## 3. 总体架构与入口

- 左侧栏新增独立入口「发现」：放在「功能」可折叠分组内、知识库之下（最后一个条目，图标建议 Compass），主区切换为独立面板 `DiscoverView`（与 Repo Wiki 同级，不做顶栏新 tab）
- 面板内三个 tab：**官方精选** / **社区讨论** / **反馈**
- 数据流：渲染进程 → IPC → 主进程服务 → GitHub（清单、视频、Discussions API），本地 JSON 缓存
- 一次性手动配置（维护者执行）：
  1. 新建公开内容仓库 `GeoffBao/myyoda-content`
  2. MyYoda 主仓库开启 Discussions，建三个 category：Q&A（问题讨论）/ Showcase（经验分享）/ Announcements（公告）

## 4. 官方精选流

### 4.1 内容清单格式（content.json）

```json
{
  "version": 1,
  "items": [
    {
      "id": "agent-essence",
      "type": "video",
      "title": "Agent 的本质到底是什么",
      "description": "…",
      "version": "2026.8.1",
      "publishedAt": "2026-08-01T00:00:00Z",
      "video": {
        "url": "https://github.com/GeoffBao/myyoda-content/releases/download/v1/agent-essence.mp4",
        "mirrors": [],
        "size": 10453843
      }
    },
    { "id": "x", "type": "article", "title": "…", "version": "…", "publishedAt": "…", "contentUrl": "…" },
    { "id": "y", "type": "announcement", "title": "…", "version": "…", "publishedAt": "…", "body": "…" },
    { "id": "z", "type": "link", "title": "…", "version": "…", "publishedAt": "…", "url": "https://twitter.com/…" }
  ]
}
```

四类内容：`video` / `article` / `announcement` / `link`。列表按 `publishedAt` 倒序。

### 4.2 版本更新机制

- 每条内容带 `version` 字段；应用本地维护 `~/.myyoda/content-state.json`（`{ itemId: seenVersion }`）
- 标记规则：`manifest.version !== seenVersion` 即视为有更新（只做不等比较，不做版本大小排序语义），条目打「更新」标记；任一未读更新存在时，侧边栏入口显示红点
- 用户点开条目即写入已看版本（红点随之消失）
- 发布新版视频 = 上传 Release 资产 + 更新 `content.json` 的 `version`/`url`/`size`，无需发应用版本

### 4.3 四类内容的渲染

| 类型 | 渲染方式 |
|------|---------|
| video | 卡片 + 播放按钮，应用内 HTML5 播放器 |
| article | 应用内 markdown 渲染（`contentUrl` 指向内容仓库的 .md 文件，同样走 raw + jsDelivr 兜底拉取） |
| announcement | 短文本卡片 |
| link | 点击 `shell.openExternal` 跳系统浏览器 |

## 5. 视频下载与播放

1. 点击视频条目 → 检查本地缓存 `~/.myyoda/content-cache/{id}-{version}.mp4`
2. 有缓存且大小校验通过 → 直接播放
3. 无缓存 → 主进程下载（进度条 UI，逐个 mirrors 重试）→ 校验 size → 写入缓存 → 播放
4. 缓存目录仅保留当前版本文件，旧版本清理

## 6. 社区讨论

- 数据：`GET /repos/GeoffBao/MyYoda/discussions`（REST，匿名限流 60 次/时/IP），本地缓存 5 分钟
- 板块 tab：Q&A / Showcase / Announcements 三个筛选
- 列表项：标题、作者、回复数、标签、更新时间
- 详情页：应用内只读 markdown 渲染
- 互动全部跳浏览器：「回复」跳该讨论页；「发起讨论」跳带板块预选的 GitHub 新建讨论 URL
- 限流处理：显示「请求过于频繁，稍后再试」；V1.1 可选在设置中配置 Personal Token 提额

## 7. 反馈分区

- 复用现有 `FeedbackDialog`（Notion 提交，含截图/联系方式/未配置引导）
- 分区内放引导卡片 + 打开反馈弹窗按钮
- 现有其他反馈入口（侧边栏、发布说明弹窗）保留不动

## 8. 更新时机

- 拉取时机：应用启动时 + 打开面板时 + 面板内手动刷新按钮
- MVP 不做后台定时拉取（后续如需要再评估）

## 9. 错误处理

| 场景 | 处理 |
|------|------|
| 清单拉取失败（离线/被墙） | 显示上次缓存内容 + 重试按钮；`raw.githubusercontent.com` 失败自动换 jsDelivr |
| 视频下载失败 | 逐个 mirrors 重试，全部失败提示手动重试 |
| 视频文件损坏 | 下载后校验 size 与清单不一致则重下 |
| GitHub API 限流 | 提示稍后再试 / 引导配置 PAT（V1.1） |
| Discussions 未开启/仓库不存在 | 社区分区显示配置缺失提示 |

## 10. 测试策略（BDD）

- 主进程单测：清单拉取/解析、版本对比、下载与缓存（含 mirrors 重试、size 校验）
- 渲染组件测试：三 tab 渲染、更新标记、讨论列表、限流/离线态
- E2E：视频缓存后播放、无缓存下载→播放、跳转浏览器打开

## 11. 影响面（文件清单）

- `packages/shared`：新增 IPC 通道常量 + 类型（`ContentItem` / `DiscussionSummary` / `ContentState` 等）
- `apps/electron/src/main`：新增 `lib/content-service.ts`（清单拉取/版本对比/下载缓存）、`lib/community-service.ts`（Discussions 拉取/缓存）；`ipc.ts` 注册新处理器
- `apps/electron/src/preload`：新增桥接 API
- `apps/electron/src/renderer`：新增 `components/discover/`（DiscoverView + 官方精选/社区/反馈三个子视图）；`app-shell/LeftSidebar.tsx` 加入口；对应 atoms（Jotai）
- 配置路径：`~/.myyoda/content-state.json`、`~/.myyoda/content-cache/`（开发模式 `~/.luxcoder-dev/` 下）

## 12. 项目惯例遵循

- Jotai 状态管理、中文注释与日志、Shadcn 风格卡片（少边框多阴影）、配置文件优先于 localStorage、不引入本地数据库
- 类型安全：禁止 `any`，对象类型优先 interface，仅类型导入用 `import type`
- 不改变现有包 version 字段（发布时统一升）

## 13. 明确不做（YAGNI）

- 应用内发帖/评论/账号体系
- 视频流式播放（先下载后播放）
- 内容后台定时拉取、推送通知
- 评论/点赞聚合展示、搜索
- Notion 作为官方内容编辑端（V2 候选，需 token 代理）
