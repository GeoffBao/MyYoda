# 「发现」面板（官方内容 + 社区 + 反馈）Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 左侧栏「功能」分组内新增「发现」入口，主区独立面板包含官方精选流（视频/教程/公告/外链，带版本更新标记）、社区讨论（GitHub Discussions 只读 + 跳浏览器）、反馈（复用 Notion 弹窗）。

**Architecture:** 内容源为公开 GitHub 内容仓库 `GeoffBao/myyoda-content` 的 `content.json` 清单（raw.githubusercontent + jsDelivr 兜底）；视频以 Release 资产托管，下载到本地缓存后经既有 `myyoda-file://` 协议（支持 Range seek）播放；社区走 MyYoda 主仓库 Discussions REST API（匿名 + 5 分钟缓存）。全部拉取复用代理感知的 `getFetchFn`。

**Tech Stack:** Electron 39 + React 18 + Jotai + Bun test + TypeScript strict。模式参考 feedback-service（IPC 通道 → 主进程服务 → preload → 渲染层）。

**Spec:** `docs/superpowers/specs/2026-08-15-discover-community-content-design.md`

---

## 通用约定

- 所有命令在 worktree 根目录执行：`/Users/admin/Workspace/ClaudeCode/LuxAgents/.worktrees/discover-community-content`
- 注释/日志中文；禁止 `any`；对象类型优先 interface；仅类型导入用 `import type`
- 每次 commit 加 trailer：`--trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>"`
- 验证命令：`bun run typecheck`、`bun test`（在对应包目录跑）

---

### Task 1: 共享类型与 IPC 通道（@myyoda/shared）

**Files:**
- Create: `packages/shared/src/types/discover.ts`
- Modify: `packages/shared/src/types/index.ts`（追加导出）

**Step 1: 写类型文件**

完整代码：

```ts
/**
 * 「发现」面板共享类型：官方内容流 + GitHub Discussions 社区 + 视频下载状态
 *
 * 内容源契约见 docs/superpowers/specs/2026-08-15-discover-community-content-design.md §4
 */

/** 官方精选内容类型 */
export type DiscoverContentType = 'video' | 'article' | 'announcement' | 'link'

/** 单条官方内容条目（content.json 清单契约） */
export interface DiscoverContentItem {
  id: string
  type: DiscoverContentType
  title: string
  description?: string
  /** 内容版本：与已看版本不相等即视为有更新（只做不等比较） */
  version: string
  publishedAt: string
  /** video：下载地址 + 备用镜像 + 字节数（下载后校验用） */
  video?: { url: string; mirrors?: string[]; size?: number }
  /** article：markdown 正文地址（内容仓库内 .md 文件，raw + jsDelivr 拉取） */
  contentUrl?: string
  /** announcement：短文本正文 */
  body?: string
  /** link：外链地址（点击跳浏览器） */
  url?: string
}

/** content.json 清单顶层结构 */
export interface DiscoverManifest {
  version: number
  items: DiscoverContentItem[]
}

/** 已读状态：itemId -> 已看版本 */
export type DiscoverContentState = Record<string, string>

/** 附带更新标记的清单条目（渲染层视图模型） */
export interface DiscoverFeedItem extends DiscoverContentItem {
  hasUpdate: boolean
}

/** 官方精选流整体拉取结果 */
export interface DiscoverFeedResult {
  items: DiscoverFeedItem[]
  /** 是否存在未读更新（侧边栏红点用） */
  hasUnreadUpdates: boolean
  /** 内容源仓库与分支（错误提示用） */
  source: { owner: string; repo: string; branch: string }
}

/** 视频本地缓存状态 */
export interface VideoDownloadState {
  itemId: string
  status: 'not-downloaded' | 'downloading' | 'done' | 'error'
  /** 0-1，downloading 期间有效 */
  progress: number
  error?: string
}

/** 视频下载进度事件（主进程 → 渲染层推送） */
export interface VideoDownloadProgressEvent {
  itemId: string
  progress: number
}

/** 下载完成事件：filePath 为本地缓存绝对路径，渲染层经 getVideoUrl 换 myyoda-file:// URL */
export interface VideoDownloadDoneEvent {
  itemId: string
  filePath: string
}

/** GitHub Discussions 板块（与主仓库 category slug 对应） */
export type DiscussionCategorySlug = 'q-a' | 'show-and-tell' | 'announcements'

/** 板块元数据（slug → 中文显示名） */
export const DISCUSSION_CATEGORIES: ReadonlyArray<{
  slug: DiscussionCategorySlug
  label: string
  description: string
}> = [
  { slug: 'q-a', label: '问题讨论', description: '使用问题、报错求助' },
  { slug: 'show-and-tell', label: '经验分享', description: '实践心得、工作流分享' },
  { slug: 'announcements', label: '公告', description: '官方发布与通知' },
]

/** 讨论列表条目（GitHub REST /discussions 解析结果） */
export interface DiscussionSummary {
  number: number
  title: string
  author: string
  authorAvatarUrl?: string
  answerCount: number
  commentCount: number
  createdAt: string
  updatedAt: string
  labels: string[]
  categorySlug: DiscussionCategorySlug
  isAnswered: boolean
}

/** 讨论详情（正文 markdown + 列表字段） */
export interface DiscussionDetail extends DiscussionSummary {
  bodyMarkdown: string
}

/** 社区列表拉取结果（错误/限流时 message 有值） */
export interface DiscussionListResult {
  items: DiscussionSummary[]
  error?: string
  rateLimited: boolean
}

/** 「发现」IPC 通道常量 */
export const DISCOVER_IPC_CHANNELS = {
  /** 拉取官方精选流（清单 + 更新标记 + 未读红点） */
  GET_FEED: 'discover:get-feed',
  /** 拉取 article 的 markdown 正文 */
  GET_ARTICLE: 'discover:get-article',
  /** 查询某视频的本地缓存状态 */
  GET_VIDEO_STATUS: 'discover:get-video-status',
  /** 下载视频到本地缓存（进度经 VIDEO_DOWNLOAD_PROGRESS 推送） */
  DOWNLOAD_VIDEO: 'discover:download-video',
  /** 视频下载进度推送（主 → 渲染） */
  VIDEO_DOWNLOAD_PROGRESS: 'discover:video-download-progress',
  /** 视频下载完成推送（主 → 渲染） */
  VIDEO_DOWNLOAD_DONE: 'discover:video-download-done',
  /** 记录某条目已读版本 */
  MARK_SEEN: 'discover:mark-seen',
  /** 拉取讨论列表（按板块） */
  LIST_DISCUSSIONS: 'discover:list-discussions',
  /** 拉取讨论详情正文 */
  GET_DISCUSSION: 'discover:get-discussion',
  /** 为已下载视频文件注册 myyoda-file:// 播放 URL */
  GET_VIDEO_URL: 'discover:get-video-url',
  /** 用系统浏览器打开外链 / 讨论页 */
  OPEN_EXTERNAL: 'discover:open-external',
} as const
```

**Step 2: 注册导出**

`packages/shared/src/types/index.ts` 追加一行：

```ts
export * from './discover'
```

（参考同文件内 `export * from './feedback'` 的位置，按字母序插入。）

**Step 3: 验证**

Run: `cd packages/shared && bun run typecheck`
Expected: 0 errors

**Step 4: Commit**

```bash
git add packages/shared/src/types/discover.ts packages/shared/src/types/index.ts
git commit --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>" -m "feat(shared): 「发现」面板共享类型与 IPC 通道常量"
```

---

### Task 2: 配置路径（config-paths.ts）

**Files:**
- Modify: `apps/electron/src/main/lib/config-paths.ts`

**Step 1: 追加路径函数**（放在 Feedback 路径函数附近）：

```ts
/** 「发现」面板数据目录（清单缓存/已读状态/讨论缓存/视频缓存） */
export function getDiscoverDir(): string {
  return join(getMyYodaRoot(), 'discover')
}

/** 已读状态文件：content-state.json */
export function getDiscoverContentStatePath(): string {
  return join(getDiscoverDir(), 'content-state.json')
}

/** 清单缓存文件：manifest-cache.json */
export function getDiscoverManifestCachePath(): string {
  return join(getDiscoverDir(), 'manifest-cache.json')
}

/** 视频本地缓存目录 */
export function getDiscoverVideoCacheDir(): string {
  return join(getDiscoverDir(), 'video-cache')
}

/** 讨论列表缓存文件：discussions-cache.json */
export function getDiscoverDiscussionsCachePath(): string {
  return join(getDiscoverDir(), 'discussions-cache.json')
}
```

（确认 `getMyYodaRoot` 的实际函数名——以文件内现有实现为准，如为 `getMyYodaRootPath` 则对齐。）

**Step 2: 验证**

Run: `cd apps/electron && bun run typecheck`
Expected: 0 errors

**Step 3: Commit**

```bash
git add apps/electron/src/main/lib/config-paths.ts
git commit --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>" -m "feat(discover): 配置路径——清单/状态/视频缓存/讨论缓存"
```

---

### Task 3: 纯逻辑模块 content-logic.ts + 单测

**Files:**
- Create: `apps/electron/src/main/lib/content-logic.ts`
- Create: `apps/electron/src/main/lib/content-logic.test.ts`

**Step 1: 写失败测试**（先建 `content-logic.test.ts`）：

```ts
import { describe, expect, test } from 'bun:test'
import { computeUpdateFlags, validateManifest } from './content-logic'

describe('validateManifest', () => {
  test('解析合法清单', () => {
    const raw = { version: 1, items: [{ id: 'a', type: 'video', title: 't', version: '1', publishedAt: 'x' }] }
    const result = validateManifest(raw)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.manifest.items).toHaveLength(1)
  })
  test('缺少 items 返回错误', () => {
    const result = validateManifest({ version: 1 })
    expect(result.ok).toBe(false)
  })
  test('video 条目缺 video 字段返回错误', () => {
    const result = validateManifest({ version: 1, items: [{ id: 'a', type: 'video', title: 't', version: '1', publishedAt: 'x' }] })
    expect(result.ok).toBe(false)
  })
})

describe('computeUpdateFlags', () => {
  test('版本不同 = 有更新；相同 = 无更新', () => {
    const items = [
      { id: 'a', type: 'video' as const, title: 'a', version: '2', publishedAt: 'x', video: { url: 'u' } },
      { id: 'b', type: 'announcement' as const, title: 'b', version: '1', publishedAt: 'x', body: 'b' },
    ]
    const state = { a: '1', b: '1' }
    const [a, b] = computeUpdateFlags(items, state)
    expect(a.hasUpdate).toBe(true)
    expect(b.hasUpdate).toBe(false)
  })
  test('未记录的条目视为有更新', () => {
    const items = [{ id: 'a', type: 'link' as const, title: 'a', version: '1', publishedAt: 'x', url: 'u' }]
    const [a] = computeUpdateFlags(items, {})
    expect(a.hasUpdate).toBe(true)
  })
})
```

**Step 2: 跑测试确认失败**

Run: `cd apps/electron && bun test src/main/lib/content-logic.test.ts`
Expected: FAIL（模块不存在）

**Step 3: 写实现**

```ts
/**
 * 「发现」内容清单纯逻辑：校验 + 更新标记（无 IO，便于单测）
 */
import type { DiscoverContentItem, DiscoverContentState, DiscoverFeedItem, DiscoverManifest } from '@myyoda/shared'

export type ManifestValidation =
  | { ok: true; manifest: DiscoverManifest }
  | { ok: false; error: string }

/** 校验 content.json 原始 JSON，返回规范化清单或错误 */
export function validateManifest(raw: unknown): ManifestValidation {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: '清单格式错误：不是 JSON 对象' }
  }
  const candidate = raw as Record<string, unknown>
  if (!Array.isArray(candidate.items)) {
    return { ok: false, error: '清单格式错误：缺少 items 数组' }
  }
  const items: DiscoverContentItem[] = []
  for (const entry of candidate.items) {
    if (typeof entry !== 'object' || entry === null) {
      return { ok: false, error: '清单条目格式错误' }
    }
    const item = entry as Record<string, unknown>
    if (typeof item.id !== 'string' || typeof item.title !== 'string'
      || typeof item.version !== 'string' || typeof item.publishedAt !== 'string') {
      return { ok: false, error: `条目字段缺失：${String(item.id ?? '?')}` }
    }
    const type = item.type as DiscoverContentItem['type']
    if (type !== 'video' && type !== 'article' && type !== 'announcement' && type !== 'link') {
      return { ok: false, error: `未知内容类型：${String(type)}` }
    }
    if (type === 'video' && (typeof item.video !== 'object' || item.video === null)) {
      return { ok: false, error: `视频条目缺少 video 字段：${String(item.id)}` }
    }
    items.push(item as unknown as DiscoverContentItem)
  }
  return { ok: true, manifest: { version: typeof candidate.version === 'number' ? candidate.version : 1, items } }
}

/** 合并已读状态，产出带 hasUpdate 标记的流条目 */
export function computeUpdateFlags(
  items: DiscoverContentItem[],
  state: DiscoverContentState,
): DiscoverFeedItem[] {
  return items.map((item) => ({
    ...item,
    hasUpdate: state[item.id] !== item.version,
  }))
}
```

**Step 4: 跑测试确认通过**

Run: `cd apps/electron && bun test src/main/lib/content-logic.test.ts`
Expected: PASS（3 组用例全绿）

**Step 5: Commit**

```bash
git add apps/electron/src/main/lib/content-logic.ts apps/electron/src/main/lib/content-logic.test.ts
git commit --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>" -m "feat(discover): 内容清单校验与更新标记纯逻辑 + 单测"
```

---

### Task 4: 内容服务 content-service.ts

**Files:**
- Create: `apps/electron/src/main/lib/content-service.ts`

**职责：** 清单拉取（双源兜底）、已读状态读写、视频下载（进度推送/镜像重试/大小校验）、article 拉取。

**Step 1: 写实现**（关键逻辑）：

```ts
/**
 * 「发现」官方内容服务
 * - 清单：raw.githubusercontent.com 拉取，失败换 jsDelivr 兜底；本地缓存 manifest-cache.json
 * - 已读状态：content-state.json
 * - 视频：下载到 video-cache/{id}-{version}.mp4，先写 .part 临时文件，校验 size 后改名
 * - article：raw 拉取 markdown，失败换 jsDelivr
 * - 全部 HTTP 走代理感知的 getFetchFn（国内网络刚需）
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { WebContents } from 'electron'
import {
  DISCOVER_IPC_CHANNELS,
  type DiscoverContentItem,
  type DiscoverContentState,
  type DiscoverFeedResult,
  type DiscoverManifest,
  type VideoDownloadState,
} from '@myyoda/shared'
import {
  getDiscoverContentStatePath,
  getDiscoverManifestCachePath,
  getDiscoverVideoCacheDir,
} from './config-paths'
import { computeUpdateFlags, validateManifest } from './content-logic'
import { getFetchFn } from './proxy-fetch'

/** 内容源配置（维护者仓库，公开可读） */
export const CONTENT_SOURCE = { owner: 'GeoffBao', repo: 'myyoda-content', branch: 'main' }

const RAW_BASE = `https://raw.githubusercontent.com/${CONTENT_SOURCE.owner}/${CONTENT_SOURCE.repo}/${CONTENT_SOURCE.branch}`
const JSDELIVR_BASE = `https://cdn.jsdelivr.net/gh/${CONTENT_SOURCE.owner}/${CONTENT_SOURCE.repo}@${CONTENT_SOURCE.branch}`

/** 按序尝试多个 URL（任一成功即返回；全部失败抛最后一个错误） */
async function fetchWithFallbacks(urls: string[]): Promise<Response> { /* 用 getFetchFn() 逐个尝试，非 2xx 视为失败 */ }

/** 读取已读状态文件（不存在返回空对象） */
export function readContentState(): DiscoverContentState { /* JSON.parse 容错 */ }

/** 写已读状态文件 */
function writeContentState(state: DiscoverContentState): void { /* mkdir + writeFileSync */ }

/** 拉取官方精选流（force=true 跳过内存缓存） */
export async function fetchDiscoverFeed(): Promise<DiscoverFeedResult> {
  const manifest = await fetchManifestWithCache()
  const state = readContentState()
  const items = computeUpdateFlags(manifest.items, state)
  return { items, hasUnreadUpdates: items.some((i) => i.hasUpdate), source: CONTENT_SOURCE }
}

/** 记录条目已读 */
export function markContentSeen(itemId: string, version: string): void {
  const state = readContentState()
  state[itemId] = version
  writeContentState(state)
}

/** 拉取 article 的 markdown 正文 */
export async function fetchArticleContent(contentUrl: string): Promise<string> { /* 优先原 URL，失败转 jsDelivr 镜像 */ }

/** 查询视频本地缓存状态 */
export function getVideoStatus(itemId: string, version: string, expectedSize?: number): VideoDownloadState {
  // 缓存文件存在且（未给 size 或大小一致）→ done；.part 存在 → downloading(进度未知按 0.5)；否则 not-downloaded
}

/** 下载视频：进度推送、镜像重试、大小校验；完成返回缓存绝对路径 */
export async function downloadVideo(
  item: DiscoverContentItem,
  webContents: WebContents,
): Promise<{ filePath: string }> { /* 见实现注释 */ }

/** 清理某条目的旧版本缓存（保留最新） */
function pruneOldVersions(itemId: string, keepVersion: string): void { /* rm 其他 {id}-*.mp4 */ }
```

实现要点：
- `downloadVideo`：URL 列表 = `[video.url, ...(video.mirrors ?? [])]`；逐个尝试，用 `ReadableStream` 读 `content-length` 推进度（节流 500ms 一次 `webContents.send(DISCOVER_IPC_CHANNELS.VIDEO_DOWNLOAD_PROGRESS, { itemId, progress })`）；写入 `.part`；完成后 `statSync` 校验 `video.size`（给了才校验），不匹配删掉重试下一个镜像；全部失败返回错误并 send 失败状态。
- 进度推送 send 前判断 `!webContents.isDestroyed()`。
- 内存级并发去重：同 itemId 已在下载时直接复用进行中的 Promise（`Map<string, Promise<...>>`）。

**Step 2: 验证**

Run: `cd apps/electron && bun run typecheck`
Expected: 0 errors

**Step 3: Commit**

```bash
git add apps/electron/src/main/lib/content-service.ts
git commit --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>" -m "feat(discover): 官方内容服务——清单/已读状态/视频下载/文章拉取"
```

---

### Task 5: 社区服务 community-service.ts + 单测

**Files:**
- Create: `apps/electron/src/main/lib/community-service.test.ts`（先写测试）
- Create: `apps/electron/src/main/lib/community-service.ts`

**Step 1: 写失败测试**（用 GitHub API 真实响应 fixture）：

```ts
import { describe, expect, test } from 'bun:test'
import { parseDiscussionList, parseDiscussionDetail, DISCUSSION_CACHE_TTL_MS } from './community-service'

// fixture 取自 GET /repos/{owner}/{repo}/discussions 真实字段（node_id/author/category 等精简）
const LIST_FIXTURE = [
  {
    number: 1,
    title: '如何配置 DeepSeek 渠道？',
    user: { login: 'alice', avatar_url: 'https://a.com/1.png' },
    category: { slug: 'q-a', name: 'Q&A' },
    comments: 3,
    answers: [{ is_answer: true }],
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-02T00:00:00Z',
    labels: [{ name: '求助' }],
  },
]

describe('parseDiscussionList', () => {
  test('解析列表条目与分类映射', () => {
    const [item] = parseDiscussionList(LIST_FIXTURE)
    expect(item.number).toBe(1)
    expect(item.title).toBe('如何配置 DeepSeek 渠道？')
    expect(item.author).toBe('alice')
    expect(item.commentCount).toBe(3)
    expect(item.isAnswered).toBe(true)
    expect(item.categorySlug).toBe('q-a')
    expect(item.labels).toEqual(['求助'])
  })
})

describe('parseDiscussionDetail', () => {
  test('合并正文 markdown', () => {
    const detail = parseDiscussionDetail({ ...LIST_FIXTURE[0], body: '# 正文' })
    expect(detail.bodyMarkdown).toBe('# 正文')
  })
})

describe('DISCUSSION_CACHE_TTL_MS', () => {
  test('缓存有效期 5 分钟', () => {
    expect(DISCUSSION_CACHE_TTL_MS).toBe(5 * 60 * 1000)
  })
})
```

**Step 2: 跑测试确认失败**

Run: `cd apps/electron && bun test src/main/lib/community-service.test.ts`
Expected: FAIL

**Step 3: 写实现**

```ts
/**
 * 「发现」社区服务：GitHub Discussions 只读拉取 + 本地缓存
 * - 列表：GET https://api.github.com/repos/GeoffBao/MyYoda/discussions（匿名限流 60/h/IP）
 * - 详情：GET .../discussions/{number}（含 body markdown）
 * - 磁盘缓存 discussions-cache.json + 内存缓存，TTL 5 分钟
 * - 分板块筛选在解析后按 categorySlug 过滤（REST 无分类过滤参数）
 */
import type { DiscussionCategorySlug, DiscussionDetail, DiscussionListResult, DiscussionSummary } from '@myyoda/shared'
import { getDiscoverDiscussionsCachePath } from './config-paths'
import { getFetchFn } from './proxy-fetch'

export const DISCUSSION_CACHE_TTL_MS = 5 * 60 * 1000
export const COMMUNITY_REPO = { owner: 'GeoffBao', repo: 'MyYoda' }

/** 解析讨论列表原始 JSON（无 IO，可单测） */
export function parseDiscussionList(raw: unknown): DiscussionSummary[]
/** 解析讨论详情原始 JSON（无 IO，可单测） */
export function parseDiscussionDetail(raw: unknown): DiscussionDetail

/** 拉取讨论列表（带缓存与限流识别） */
export async function listDiscussions(categorySlug: DiscussionCategorySlug, force?: boolean): Promise<DiscussionListResult>

/** 拉取讨论详情正文（带缓存） */
export async function getDiscussion(number: number): Promise<DiscussionDetail>

/** 构造浏览器打开的讨论 URL */
export function buildDiscussionUrl(number: number): string
/** 构造新建讨论 URL（带板块预选） */
export function buildNewDiscussionUrl(categorySlug: DiscussionCategorySlug): string
```

实现要点：
- 403 + `X-RateLimit-Remaining: 0` 时返回 `{ items: [], error: 'GitHub API 限流，请稍后再试', rateLimited: true }`
- 解析容错：`Array.isArray(raw)` 判空；`category.slug` 不在已知板块集合时归入 `q-a`？——不，直接保留原 slug 并在渲染层归入「其他」或过滤掉；约定只渲染已知三板块，未知 slug 丢弃。
- 排序：`updated_at` 倒序；`isAnswered` = `answers?.some(a => a.is_answer)`。

**Step 4: 跑测试确认通过** → **Step 5: Commit**

```bash
git add apps/electron/src/main/lib/community-service.ts apps/electron/src/main/lib/community-service.test.ts
git commit --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>" -m "feat(discover): 社区服务——GitHub Discussions 只读拉取与缓存 + 单测"
```

---

### Task 6: IPC 注册 + Preload 桥接

**Files:**
- Modify: `apps/electron/src/main/ipc.ts`
- Modify: `apps/electron/src/preload/index.ts`

**Step 1: ipc.ts 注册处理器**（参照 FEEDBACK_IPC_CHANNELS 注册位置，动态 import 服务）：

```ts
// 常量引入处追加 DISCOVER_IPC_CHANNELS（参照现有 import）
ipcMain.handle(DISCOVER_IPC_CHANNELS.GET_FEED, async () => {
  const { fetchDiscoverFeed } = await import('./lib/content-service')
  return fetchDiscoverFeed()
})
ipcMain.handle(DISCOVER_IPC_CHANNELS.GET_ARTICLE, async (_e, contentUrl: string) => {
  const { fetchArticleContent } = await import('./lib/content-service')
  return fetchArticleContent(contentUrl)
})
ipcMain.handle(DISCOVER_IPC_CHANNELS.GET_VIDEO_STATUS, async (_e, itemId: string, version: string, size?: number) => {
  const { getVideoStatus } = await import('./lib/content-service')
  return getVideoStatus(itemId, version, size)
})
ipcMain.handle(DISCOVER_IPC_CHANNELS.DOWNLOAD_VIDEO, async (event, item: import('@myyoda/shared').DiscoverContentItem) => {
  const { downloadVideo } = await import('./lib/content-service')
  const result = await downloadVideo(item, event.sender)
  return { filePath: result.filePath }
})
ipcMain.handle(DISCOVER_IPC_CHANNELS.MARK_SEEN, async (_e, itemId: string, version: string) => {
  const { markContentSeen } = await import('./lib/content-service')
  markContentSeen(itemId, version)
})
ipcMain.handle(DISCOVER_IPC_CHANNELS.LIST_DISCUSSIONS, async (_e, categorySlug: string, force?: boolean) => {
  const { listDiscussions } = await import('./lib/community-service')
  return listDiscussions(categorySlug as import('@myyoda/shared').DiscussionCategorySlug, force)
})
ipcMain.handle(DISCOVER_IPC_CHANNELS.GET_DISCUSSION, async (_e, number: number) => {
  const { getDiscussion } = await import('./lib/community-service')
  return getDiscussion(number)
})
ipcMain.handle(DISCOVER_IPC_CHANNELS.GET_VIDEO_URL, async (_e, filePath: string) => {
  const { registerMyYodaFilePath } = await import('./lib/local-file-protocol')
  return registerMyYodaFilePath(filePath)
})
ipcMain.handle(DISCOVER_IPC_CHANNELS.OPEN_EXTERNAL, async (_e, url: string) => {
  const { shell } = await import('electron')
  await shell.openExternal(url)
})
```

（实际注册位置：找到 FEEDBACK_IPC_CHANNELS.SUBMIT 处理器块末尾追加。注意 `event.sender` 类型为 `WebContents`。）

**Step 2: preload 暴露 API**：

类型声明区（`window.electronAPI` interface）追加：

```ts
discoverGetFeed: () => Promise<import('@myyoda/shared').DiscoverFeedResult>
discoverGetArticle: (contentUrl: string) => Promise<string>
discoverGetVideoStatus: (itemId: string, version: string, size?: number) => Promise<import('@myyoda/shared').VideoDownloadState>
discoverDownloadVideo: (item: import('@myyoda/shared').DiscoverContentItem) => Promise<{ filePath: string }>
discoverMarkSeen: (itemId: string, version: string) => Promise<void>
discoverListDiscussions: (categorySlug: import('@myyoda/shared').DiscussionCategorySlug, force?: boolean) => Promise<import('@myyoda/shared').DiscussionListResult>
discoverGetDiscussion: (number: number) => Promise<import('@myyoda/shared').DiscussionDetail>
discoverGetVideoUrl: (filePath: string) => Promise<string>
discoverOpenExternal: (url: string) => Promise<void>
onVideoDownloadProgress: (listener: (event: import('@myyoda/shared').VideoDownloadProgressEvent) => void) => () => void
onVideoDownloadDone: (listener: (event: import('@myyoda/shared').VideoDownloadDoneEvent) => void) => () => void
```

实现区（参照 feedbackSubmit 的 invoke 写法）：

```ts
discoverGetFeed: () => ipcRenderer.invoke(DISCOVER_IPC_CHANNELS.GET_FEED),
// ...其余 invoke 同理
onVideoDownloadProgress: (listener) => {
  const handler = (_e: Electron.IpcRendererEvent, payload: import('@myyoda/shared').VideoDownloadProgressEvent): void => listener(payload)
  ipcRenderer.on(DISCOVER_IPC_CHANNELS.VIDEO_DOWNLOAD_PROGRESS, handler)
  return () => { ipcRenderer.removeListener(DISCOVER_IPC_CHANNELS.VIDEO_DOWNLOAD_PROGRESS, handler) }
},
```

**Step 3: 验证**

Run: `cd apps/electron && bun run typecheck`
Expected: 0 errors

**Step 4: Commit**

```bash
git add apps/electron/src/main/ipc.ts apps/electron/src/preload/index.ts
git commit --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>" -m "feat(discover): IPC 注册与 preload 桥接"
```

---

### Task 7: 渲染层状态与全局初始化

**Files:**
- Create: `apps/electron/src/renderer/atoms/discover-atoms.ts`
- Create: `apps/electron/src/renderer/components/discover/DiscoverInitializer.tsx`
- Modify: `apps/electron/src/renderer/main.tsx`（挂载 initializer）

**Step 1: atoms**：

```ts
/**
 * 「发现」面板状态：官方流 / 视频下载 / 社区讨论
 */
import { atom } from 'jotai'
import type {
  DiscussionCategorySlug, DiscussionDetail, DiscussionListResult,
  DiscoverFeedItem, VideoDownloadState,
} from '@myyoda/shared'

/** 面板内 tab：featured 官方精选 / community 社区 / feedback 反馈 */
export type DiscoverTab = 'featured' | 'community' | 'feedback'
export const discoverTabAtom = atom<DiscoverTab>('featured')

/** 官方精选流 */
export const discoverFeedAtom = atom<DiscoverFeedItem[]>([])
export const discoverFeedLoadingAtom = atom(false)
export const discoverFeedErrorAtom = atom<string | null>(null)
/** 未读更新（侧边栏红点） */
export const discoverHasUnreadAtom = atom(false)

/** 视频下载状态 Map（itemId -> 状态） */
export const videoDownloadStatesAtom = atom<Map<string, VideoDownloadState>>(new Map())

/** 社区讨论 */
export const discussionCategoryAtom = atom<DiscussionCategorySlug>('q-a')
export const discussionListResultAtom = atom<DiscussionListResult>({ items: [], rateLimited: false })
export const discussionListLoadingAtom = atom(false)
export const discussionDetailAtom = atom<DiscussionDetail | null>(null)
export const discussionDetailLoadingAtom = atom(false)
```

**Step 2: DiscoverInitializer**（应用启动拉取一次官方流，供侧边栏红点；面板打开时 DiscoverView 自身再刷新）：

```tsx
/**
 * DiscoverInitializer — 应用启动时预拉取官方内容流（侧边栏红点数据源）
 * 挂载于 main.tsx 顶层，永不卸载
 */
import * as React from 'react'
import { useSetAtom } from 'jotai'
import { discoverFeedAtom, discoverHasUnreadAtom, discoverFeedErrorAtom } from '@/atoms/discover-atoms'

export function DiscoverInitializer(): React.ReactElement {
  const setFeed = useSetAtom(discoverFeedAtom)
  const setHasUnread = useSetAtom(discoverHasUnreadAtom)
  const setError = useSetAtom(discoverFeedErrorAtom)
  React.useEffect(() => {
    let cancelled = false
    window.electronAPI.discoverGetFeed().then((result) => {
      if (cancelled) return
      setFeed(result.items)
      setHasUnread(result.hasUnreadUpdates)
      setError(null)
    }).catch((err: unknown) => {
      if (cancelled) return
      setError(err instanceof Error ? err.message : '内容源不可用')
    })
    return () => { cancelled = true }
  }, [setFeed, setHasUnread, setError])
  return null
}
```

**Step 3: main.tsx 挂载**（参照 `<ProjectsInitializer />` 位置）：

```tsx
<DiscoverInitializer />
```

**Step 4: 验证** → **Step 5: Commit**

```bash
git add apps/electron/src/renderer/atoms/discover-atoms.ts apps/electron/src/renderer/components/discover/DiscoverInitializer.tsx apps/electron/src/renderer/main.tsx
git commit --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>" -m "feat(discover): 渲染层状态原子与启动预拉取"
```

---

### Task 8: DiscoverView 骨架 + 官方精选流 + 视频播放

**Files:**
- Create: `apps/electron/src/renderer/components/discover/DiscoverView.tsx`
- Create: `apps/electron/src/renderer/components/discover/FeaturedFeed.tsx`
- Create: `apps/electron/src/renderer/components/discover/VideoPlayerDialog.tsx`
- Modify: `apps/electron/src/renderer/components/tabs/MainArea.tsx`（路由分支）

**DiscoverView**：头部（标题「发现」+ 手动刷新按钮）+ tab 切换条（官方精选 | 社区讨论 | 反馈），卡片式容器。刷新 = 重新 `discoverGetFeed` + 当前板块讨论。

**FeaturedFeed**：
- 按 `publishedAt` 倒序列表，每条渲染为卡片（Shadcn 风格：圆角 + 阴影，少边框）
- 类型徽标：视频 / 教程 / 公告 / 外链；`hasUpdate` 显示主题色「更新」pill
- video：未下载显示「下载（xx MB）」按钮；下载中显示进度条（订阅 `onVideoDownloadProgress` 更新 `videoDownloadStatesAtom`）；已缓存显示「播放」按钮
- article：点击拉取 markdown（`discoverGetArticle`）在卡片内展开渲染（复用 `ai-elements` 的 Markdown 组件）
- announcement：直接渲染 `body`
- link：「打开链接」按钮 → `discoverOpenExternal(url)`
- 点击任意条目时调用 `discoverMarkSeen(itemId, version)` 清红点并本地更新 `discoverHasUnreadAtom`

**VideoPlayerDialog**：
- Radix Dialog，全屏遮罩，`<video controls autoPlay src={fileUrl}>`
- 打开时用 `discoverGetVideoUrl(filePath)` 换取 `myyoda-file://` URL（每次打开重新注册）

**MainArea 路由**（在 `activeView === 'repo-wiki'` 分支旁追加）：

```tsx
) : activeView === 'discover' ? (
  <DiscoverView />
) : activeView === 'repo-wiki' ? (
```

**Step: 验证 + Commit**

```bash
git add apps/electron/src/renderer/components/discover/ apps/electron/src/renderer/components/tabs/MainArea.tsx
git commit --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>" -m "feat(discover): 面板骨架、官方精选流与视频播放"
```

---

### Task 9: 社区讨论视图

**Files:**
- Create: `apps/electron/src/renderer/components/discover/CommunityView.tsx`

**结构：**
- 板块 tab（问题讨论 / 经验分享 / 公告，`DISCUSSION_CATEGORIES`）
- 列表：标题、作者头像、回复数、标签、更新时间；加载/限流/错误态（`rateLimited` 时提示文案 + 重试）
- 点击条目 → 详情页（返回按钮 + 标题 + 作者 + markdown 正文渲染）
- 「回复」「发起讨论」按钮 → `discoverOpenExternal(buildXxxUrl)`——URL 构建逻辑在 community-service 内，preload 暴露 `discoverOpenExternal` 即可，但 URL 构建需要渲染层直接拼（简单字符串）：`https://github.com/GeoffBao/MyYoda/discussions/{number}` 与 `https://github.com/GeoffBao/MyYoda/discussions/new?category={slug}`。渲染层直接拼，不经过主进程。

**Step: 验证 + Commit**

```bash
git add apps/electron/src/renderer/components/discover/CommunityView.tsx
git commit --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>" -m "feat(discover): 社区讨论视图——板块/列表/详情/跳转"
```

---

### Task 10: 反馈分区 + 侧边栏入口

**Files:**
- Create: `apps/electron/src/renderer/components/discover/FeedbackSection.tsx`
- Modify: `apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx`
- Modify: `apps/electron/src/renderer/atoms/active-view.ts`（ActiveView 加 `'discover'`）

**FeedbackSection**：引导卡片（说明反馈经 Notion 提交）+「打开反馈」按钮 → `set(feedbackDialogOpenAtom, true)`。

**LeftSidebar**（功能分组内、知识库按钮之后追加；`mode === 'agent'` 下与知识库同条件显示，或全模式显示——取与知识库一致 `mode === 'agent'`）：

```tsx
{/* 发现：官方内容 + 社区 + 反馈 */}
{mode === 'agent' && (
  <button
    type="button"
    onClick={handleOpenDiscover}
    className={cn(
      'flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-[12.5px] transition-colors duration-fast titlebar-no-drag',
      activeView === 'discover'
        ? 'bg-accent-foreground/[0.10] text-foreground'
        : 'text-foreground/60 hover:bg-accent-foreground/[0.08] hover:text-foreground'
    )}
  >
    <Compass size={13} className="shrink-0 text-foreground/45" />
    <span className="min-w-0 flex-1 truncate text-left">发现</span>
    {discoverHasUnread && (
      <span className="size-1.5 rounded-full bg-primary" />
    )}
  </button>
)}
```

`handleOpenDiscover` 参照 `handleOpenRepoWiki`：`setActiveView('discover')`；展开「功能」分组逻辑（`featuresCollapsed` 联动）与知识库一致。`Compass` 从 lucide-react 引入；`discoverHasUnread` 用 `useAtomValue(discoverHasUnreadAtom)`。

**Step: 验证 + Commit**

```bash
git add apps/electron/src/renderer/components/discover/FeedbackSection.tsx apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx apps/electron/src/renderer/atoms/active-view.ts
git commit --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>" -m "feat(discover): 反馈分区、侧边栏「发现」入口与 activeView 路由"
```

---

### Task 11: 内容仓库引导物（本地准备，等待用户批准后发布）

**Files（准备在 worktree 内 `.discover-bootstrap/`，不随功能分支提交）:**
- `.discover-bootstrap/content.json`（示例清单：4 类内容各一条，视频条目指向 v1 Release 资产）
- `.discover-bootstrap/README.md`（发布步骤：创建公开仓库 → 首次推送 → 建 Release 上传 mp4 → 之后更新流程）

**发布前置检查（只读）：**
- `gh api repos/GeoffBao/MyYoda/discussions/categories` 确认 Discussions 是否已开启及现有板块 slug
- 发布动作（创建 `GeoffBao/myyoda-content` 公开仓库、上传视频 Release、开启/调整主仓库 Discussions 板块）**需用户明确批准后**用 gh 执行

---

### Task 12: 全量验证

```bash
cd packages/shared && bun run typecheck
cd ../.. && cd apps/electron && bun run typecheck
bun test
cd ../.. && bun run dev   # 手动冒烟：侧边栏「发现」入口 → 三 tab → 视频下载播放 → 社区浏览 → 反馈弹窗
```

冒烟检查清单：
1. 内容源未就绪时：官方流显示错误态 + 重试按钮，应用不崩溃
2. 内容源就绪后：视频下载进度 → 播放（seek 正常）；教程展开 markdown；外链打开浏览器
3. 「更新」pill 与侧边栏红点在 markSeen 后消失
4. 社区三板块列表与详情渲染；限流提示；「回复/发起讨论」跳浏览器
5. 反馈卡片打开既有弹窗，提交路径不受影响

最后：按需 `@code-simplifier` 简化、`code-review` 自审，完成后汇报并等待用户决定是否合回 main。
