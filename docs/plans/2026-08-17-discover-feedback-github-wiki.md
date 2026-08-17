# 发现面板重构：反馈 → GitHub Issues + Wiki 接入 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把「意见反馈」提交链路从 Notion 完全替换为 GitHub Issues（PAT 认证 + user-attachments 截图 + 草稿/去重），并让「帮助」tab 通过 git 浅克隆接入 `GeoffBao/MyYoda` wiki 作为在线文档源。

**Architecture:** 沿用现有「发现」面板的内容管线模式（主进程服务 + 代理感知 fetch + 本地缓存 + 纯逻辑单测）。反馈链路重构 `feedback-service.ts`（issue 创建 API + 非官方 user-attachments 截图上传 + 草稿 v2 + 去重记录）；wiki 走系统 git 浅克隆到 `~/.myyoda/discover/wiki-cache/`，`_Sidebar.md` 解析页面树，正文本地直读 + 媒体代理重写。渲染层：FeedbackDialog 加公开提示与草稿列表，HelpSection 新增 WikiBrowser 在线文档区块。

**Tech Stack:** Electron 主/渲染进程、React 18、jotai、TypeScript、bun test（1586 pass 基线）、GitHub REST API（fine-grained PAT）、系统 git、代理感知 `getFetchFn`。

**Spec:** `docs/superpowers/specs/2026-08-17-discover-feedback-github-issues-wiki-design.md`

**基线（已实测，worktree `feature/discover-feedback-github-wiki`）:** `bun test` 1586 pass / 0 fail；`bun run typecheck` 全部包通过。

**约定：**
- 每个 commit 追加 trailer：`--trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>"`
- 任务 1/5/7/8/9 之间存在过渡期类型断裂（旧 Notion 类型被替换但渲染层尚未改完），**中间不要求全量 typecheck**，全量绿在 Task 11 收口
- 纯逻辑（TDD 任务 2/3/6）必须先写测试再实现

---

## Task 1: 共享类型改造（feedback → GitHub、新增 wiki 类型）

**Files:**
- Modify: `packages/shared/src/types/feedback.ts`（整体重写）
- Modify: `packages/shared/src/types/discover.ts`（追加 wiki 类型与通道）

**Step 1: 重写 feedback.ts**

用以下内容整体替换 `packages/shared/src/types/feedback.ts`：

```ts
/**
 * 用户反馈（→ GitHub Issues）相关类型定义
 *
 * 反馈入口在「发现」面板反馈 tab 与「更新日志与帮助」弹层（ReleaseNotesPopover），
 * 提交到 GeoffBao/MyYoda 公开仓库的 Issues（fine-grained PAT 认证）。
 * 截图经非官方 user-attachments 端点上传（与网页端拖拽等效），URL 嵌入 issue 正文。
 * 设计契约见 docs/superpowers/specs/2026-08-17-discover-feedback-github-issues-wiki-design.md。
 */

/** 反馈类型 */
export type FeedbackType = 'bug' | 'feature'

/** 反馈类型对应的 issue label（仓库缺少该 label 时不带 label 提交） */
export const FEEDBACK_TYPE_LABEL: Record<FeedbackType, string> = {
  bug: 'bug',
  feature: 'enhancement',
}

/** 反馈类型对应的标题前缀（issue title 与正文「类型」行共用） */
export const FEEDBACK_TYPE_TITLE_PREFIX: Record<FeedbackType, string> = {
  bug: 'Bug 报告',
  feature: '功能建议',
}

/** 反馈承载仓库（公开，issue 可见） */
export const FEEDBACK_REPO = { owner: 'GeoffBao', repo: 'MyYoda' } as const

/** 详细描述最大长度（对齐 newmax） */
export const FEEDBACK_DESCRIPTION_MAX_LENGTH = 5000

/** 截图最大张数（对齐 newmax） */
export const FEEDBACK_MAX_SCREENSHOTS = 5

/** 单张截图压缩目标上限（字节）。user-attachments 单文件上限较大，这里留足余量。 */
export const FEEDBACK_MAX_IMAGE_BYTES = 4 * 1024 * 1024

/** 提交反馈的输入 */
export interface FeedbackSubmitInput {
  /** 反馈类型 */
  type: FeedbackType
  /** 详细描述（纯文本，≤5000 字） */
  description: string
  /** 截图文件路径（已压缩后的本地 PNG/JPEG） */
  screenshots: string[]
  /** 可选联系方式（邮箱） */
  contactEmail?: string
}

/** 提交结果 */
export interface FeedbackSubmitResult {
  success: boolean
  /** GitHub issue URL（成功时） */
  issueUrl?: string
  /** 失败原因（面向用户的中文描述） */
  error?: string
  /** 是否已保存本地草稿（提交失败时的降级） */
  draftSaved?: boolean
  /** 草稿文件路径 */
  draftPath?: string
  /** 部分截图上传失败，已按纯文字提交（成功时提示） */
  screenshotsSkipped?: boolean
  /** 与历史提交内容重复（提示用，不阻塞提交） */
  duplicate?: boolean
}

/** 反馈渠道配置（GitHub fine-grained PAT） */
export interface FeedbackGithubConfig {
  /** fine-grained PAT（github_pat_...，加密存储） */
  token?: string
  /** 承载仓库（默认 GeoffBao/MyYoda） */
  repo?: { owner: string; repo: string }
}

/** 连接测试结果 */
export interface FeedbackTestConnectionResult {
  success: boolean
  message: string
}

/** 本地草稿（v2，GitHub 提交失败时保存，供重试） */
export interface FeedbackDraft {
  version: 2
  createdAt: string
  input: FeedbackSubmitInput
  /** 应用版本（草稿重试时保留） */
  appVersion?: string
  platform?: string
  /** 已上传成功的附件 URL（issue 创建失败时记录，重试可跳过重复上传） */
  uploadedAssetUrls?: string[]
}

/** 草稿列表条目（v1=Notion 旧格式只读，v2=GitHub 可重试） */
export interface FeedbackDraftItem {
  fileName: string
  version: 1 | 2
  createdAt: string
  input: FeedbackSubmitInput
  appVersion?: string
  platform?: string
  /** true = v1 Notion 旧格式，仅可查看/删除，不可提交 */
  legacy: boolean
}

/** 反馈 IPC 通道常量 */
export const FEEDBACK_IPC_CHANNELS = {
  /** 提交反馈到 GitHub Issues */
  SUBMIT: 'feedback:submit',
  /** 测试 GitHub 凭证（PAT 是否有效且有目标仓库权限） */
  TEST_CONNECTION: 'feedback:test-connection',
  /** 读取本地反馈渠道配置（token 不返回明文，只返回是否已配置） */
  GET_CONFIG: 'feedback:get-config',
  /** 保存反馈渠道配置 */
  SAVE_CONFIG: 'feedback:save-config',
  /** 截取当前应用窗口（弹窗自身自动隐藏），返回 PNG 文件路径 */
  CAPTURE_WINDOW: 'feedback:capture-window',
  /** 选择本地图片（压缩后返回预览 dataUrl + 提交用 filePath） */
  PICK_IMAGES: 'feedback:pick-images',
  /** 列出本地草稿（v2 可重试；v1 旧格式标记 legacy） */
  LIST_DRAFTS: 'feedback:list-drafts',
  /** 删除本地草稿（按文件名） */
  DELETE_DRAFT: 'feedback:delete-draft',
} as const
```

**Step 2: discover.ts 追加 wiki 类型与通道**

在 `packages/shared/src/types/discover.ts` 文件**末尾**追加：

```ts
/** Wiki 页面树节点 */
export interface WikiPageNode {
  /** 页面名（文件名去掉 .md，GitHub wiki 链接 slug） */
  name: string
  /** 显示标题（_Sidebar 链接文本；fallback 时等于 name） */
  title: string
  /** 缩进层级（0 起） */
  depth: number
  children: WikiPageNode[]
}

/** Wiki 页面树 */
export interface WikiPageTree {
  nodes: WikiPageNode[]
  /** 是否来自 _Sidebar.md（false = 文件列表 fallback） */
  fromSidebar: boolean
}

/** Wiki 列表拉取结果 */
export interface WikiPagesResult {
  tree: WikiPageTree
  /** 最近一次成功刷新时间（Unix 毫秒；0 = 从未成功） */
  fetchedAt: number
  /** 当前缓存 commit hash */
  commitHash: string
  /** 上次刷新失败、当前展示的是旧缓存 */
  fromCache: boolean
  /** 刷新失败原因 */
  error?: string
}

/** Wiki 单页正文 */
export interface WikiPageContent {
  name: string
  /** 媒体重写后的 markdown 正文 */
  markdown: string
  /** GitHub wiki 网页地址 */
  htmlUrl: string
}
```

并在 `DISCOVER_IPC_CHANNELS` 对象内（`DELETE_VIDEO_CACHE` 之后）追加 4 个通道：

```ts
  /** 拉取 Wiki 页面树（force 同步刷新克隆；否则读缓存并后台刷新） */
  GET_WIKI_PAGES: 'discover:get-wiki-pages',
  /** 读取单个 Wiki 页面正文 */
  GET_WIKI_PAGE: 'discover:get-wiki-page',
  /** 手动刷新 Wiki（等价 GET_WIKI_PAGES force=true，独立通道语义清晰） */
  REFRESH_WIKI: 'discover:refresh-wiki',
  /** Wiki 缓存已更新推送（主 → 渲染，含新 commit hash） */
  WIKI_UPDATED: 'discover:wiki-updated',
```

**Step 3: 验证（预期断裂）**

```bash
bun test apps/electron/src/main/lib 2>&1 | tail -5
```

Expected: 现有测试不受影响（feedback 类型暂无纯逻辑测试）。全量 typecheck 会因 feedback-service/ipc/FeedbackSettings 引用旧类型而失败——**预期内**，Task 11 收口。

**Step 4: Commit**

```bash
git add packages/shared/src/types/feedback.ts packages/shared/src/types/discover.ts
git commit --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>" -m "feat(shared): 反馈类型切换到 GitHub Issues，新增 Wiki 类型与通道"
```

---

## Task 2: Wiki 页面树与媒体重写纯逻辑（TDD）

**Files:**
- Create: `apps/electron/src/main/lib/wiki-pages.ts`
- Test: `apps/electron/src/main/lib/wiki-pages.test.ts`

**Step 1: 写失败测试**

创建 `apps/electron/src/main/lib/wiki-pages.test.ts`：

```ts
import { describe, expect, test } from 'bun:test'
import {
  buildPageTreeFromFileNames,
  isWikiPageNameSafe,
  parseSidebar,
  rewriteWikiMedia,
} from './wiki-pages'

describe('parseSidebar', () => {
  test('解析两层嵌套并排除下划线页面', () => {
    const md = [
      '* [首页](Home)',
      '* [指南](Guide)',
      '  * [安装](Install)',
      '    * [国内网络](Install-CN)',
      '* [_Sidebar](_Sidebar)',
      '',
      '# 标题行应被忽略',
    ].join('\n')
    const tree = parseSidebar(md)
    expect(tree.fromSidebar).toBe(true)
    expect(tree.nodes).toHaveLength(2)
    expect(tree.nodes[0]).toEqual({ name: 'Home', title: '首页', depth: 0, children: [] })
    const guide = tree.nodes[1]
    expect(guide.children).toHaveLength(1)
    expect(guide.children[0].name).toBe('Install')
    expect(guide.children[0].children).toHaveLength(1)
    expect(guide.children[0].children[0].name).toBe('Install-CN')
  })

  test('空内容返回空树 fromSidebar=false', () => {
    const tree = parseSidebar('')
    expect(tree.nodes).toEqual([])
    expect(tree.fromSidebar).toBe(false)
  })
})

describe('buildPageTreeFromFileNames', () => {
  test('Home 置顶，其余按名称排序，排除下划线文件', () => {
    const tree = buildPageTreeFromFileNames(['Guide.md', 'Home.md', '_Sidebar.md', 'FAQ.md'])
    expect(tree.fromSidebar).toBe(false)
    expect(tree.nodes.map((n) => n.name)).toEqual(['Home', 'FAQ', 'Guide'])
    expect(tree.nodes[0].title).toBe('Home')
  })
})

describe('isWikiPageNameSafe', () => {
  test('合法中文名与常规名', () => {
    expect(isWikiPageNameSafe('使用指南')).toBe(true)
    expect(isWikiPageNameSafe('Install-CN')).toBe(true)
  })
  test('拒绝路径穿越与内部页面', () => {
    expect(isWikiPageNameSafe('../etc/passwd')).toBe(false)
    expect(isWikiPageNameSafe('a/b')).toBe(false)
    expect(isWikiPageNameSafe('_Sidebar')).toBe(false)
    expect(isWikiPageNameSafe('')).toBe(false)
  })
})

describe('rewriteWikiMedia', () => {
  const register = (url: string): string | null =>
    url.includes('raw.githubusercontent.com') ? `myyoda-remote://${encodeURIComponent(url)}` : null

  test('相对路径图片解析为 raw wiki 地址并注册代理', () => {
    const out = rewriteWikiMedia('![a](assets/logo.png)\n![b](./img/x.jpg)', register)
    expect(out).toContain('myyoda-remote://')
    expect(out).toContain('raw.githubusercontent.com')
  })

  test('绝对 http 图片与 data URI 原样保留', () => {
    const md = '![a](https://example.com/x.png) ![b](data:image/png;base64,xx)'
    expect(rewriteWikiMedia(md, register)).toBe(md)
  })
})
```

**Step 2: 运行确认失败**

```bash
bun test apps/electron/src/main/lib/wiki-pages.test.ts 2>&1 | tail -5
```

Expected: FAIL — `Cannot find module './wiki-pages'`。

**Step 3: 实现**

创建 `apps/electron/src/main/lib/wiki-pages.ts`：

```ts
/**
 * Wiki 页面树与媒体重写纯逻辑（无 IO，便于单测）
 *
 * - _Sidebar.md 解析：`* [标题](页面名)` + 缩进层级（2 空格 = 1 层）
 * - fallback：文件列表构建平铺树（Home 置顶）
 * - 媒体重写：相对路径图片解析到 raw.githubusercontent.com/wiki 后交给远程媒体注册
 */
import type { WikiPageNode, WikiPageTree } from '@myyoda/shared'

/** raw 访问 wiki 文件的基础地址（wiki 默认分支 master） */
export const WIKI_RAW_BASE = 'https://raw.githubusercontent.com/wiki/GeoffBao/MyYoda/master'

interface SidebarItem {
  depth: number
  title: string
  name: string
}

/** 解析单行 `* [标题](页面名)`；缩进 2 空格 = 1 层；下划线页面（_Sidebar/_Footer）返回 null */
function parseSidebarLine(line: string): SidebarItem | null {
  const match = /^( *)\*\s+\[([^\]]+)\]\(([^)\s]+)\)\s*$/.exec(line)
  if (!match) return null
  let name = match[3]
  name = name.replace(/^\.\//, '')
  if (name.toLowerCase().endsWith('.md')) name = name.slice(0, -3)
  if (name.startsWith('_')) return null
  return { depth: Math.floor(match[1].length / 2), title: match[2], name }
}

/** 由带深度的条目构建树（栈式归并） */
export function buildPageTreeFromItems(items: SidebarItem[]): WikiPageNode[] {
  const roots: WikiPageNode[] = []
  const stack: WikiPageNode[] = []
  for (const item of items) {
    const node: WikiPageNode = { name: item.name, title: item.title, depth: item.depth, children: [] }
    while (stack.length > 0 && stack[stack.length - 1].depth >= item.depth) stack.pop()
    if (stack.length === 0) roots.push(node)
    else stack[stack.length - 1].children.push(node)
    stack.push(node)
  }
  return roots
}

/** 解析 _Sidebar.md 为页面树（无有效条目时 fromSidebar=false） */
export function parseSidebar(markdown: string): WikiPageTree {
  const items: SidebarItem[] = []
  for (const line of markdown.split('\n')) {
    const parsed = parseSidebarLine(line)
    if (parsed) items.push(parsed)
  }
  return { nodes: buildPageTreeFromItems(items), fromSidebar: items.length > 0 }
}

/** fallback：由 .md 文件列表构建平铺树（Home 置顶，其余按名称排序） */
export function buildPageTreeFromFileNames(fileNames: string[]): WikiPageTree {
  const names = fileNames
    .map((file) => file.trim())
    .filter((file) => file.toLowerCase().endsWith('.md'))
    .filter((file) => !file.startsWith('_'))
    .map((file) => file.slice(0, -3))
  const ordered = ['Home', ...names.filter((name) => name !== 'Home').sort((a, b) => a.localeCompare(b))]
  return {
    nodes: ordered.map((name) => ({ name, title: name, depth: 0, children: [] })),
    fromSidebar: false,
  }
}

/** 校验页面名（防路径穿越 / 内部页面） */
export function isWikiPageNameSafe(name: string): boolean {
  if (!name || name.length > 100) return false
  if (name.includes('/') || name.includes('\\') || name.includes('..')) return false
  if (name.startsWith('_')) return false
  return true
}

/** 把 wiki markdown 中的相对路径图片解析为 raw URL 并注册远程媒体代理；绝对 http/data 图片原样保留 */
export function rewriteWikiMedia(
  markdown: string,
  register: (url: string) => string | null,
): string {
  return markdown.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (whole, alt: string, src: string) => {
    if (/^https?:\/\//i.test(src) || src.startsWith('data:')) return whole
    const clean = src.split('#')[0].replace(/^\.\//, '')
    const resolved = `${WIKI_RAW_BASE}/${clean}`
    const proxied = register(resolved)
    return `![${alt}](${proxied ?? resolved})`
  })
}
```

**Step 4: 运行确认通过**

```bash
bun test apps/electron/src/main/lib/wiki-pages.test.ts 2>&1 | tail -5
```

Expected: 全部 pass（约 9 条断言）。

**Step 5: Commit**

```bash
git add apps/electron/src/main/lib/wiki-pages.ts apps/electron/src/main/lib/wiki-pages.test.ts
git commit --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>" -m "feat(discover): Wiki 页面树与媒体重写纯逻辑"
```

---

## Task 3: 反馈 Issue 模板与去重纯逻辑（TDD）

**Files:**
- Create: `apps/electron/src/main/lib/feedback-format.ts`
- Test: `apps/electron/src/main/lib/feedback-format.test.ts`

**Step 1: 写失败测试**

创建 `apps/electron/src/main/lib/feedback-format.test.ts`：

```ts
import { describe, expect, test } from 'bun:test'
import {
  buildDedupKey,
  buildIssueBody,
  buildIssueTitle,
  extractAttachmentUrl,
  resolveIssueLabels,
} from './feedback-format'

describe('buildIssueTitle', () => {
  test('取描述前 40 字（空白折叠）', () => {
    expect(buildIssueTitle('bug', '启动时崩溃，附日志')).toBe('[Bug 报告] 启动时崩溃，附日志')
    expect(buildIssueTitle('feature', '希望支持 xyz')).toBe('[功能建议] 希望支持 xyz')
  })

  test('空描述回退「无描述」', () => {
    expect(buildIssueTitle('bug', '   ')).toBe('[Bug 报告] 无描述')
  })

  test('长描述截断到 40 字', () => {
    const long = 'a'.repeat(100)
    expect(buildIssueTitle('bug', long).length).toBe(40 + '[Bug 报告] '.length)
  })
})

describe('buildIssueBody', () => {
  const base = { appVersion: '0.10.8', platform: 'darwin', submittedAt: '2026-08-17T06:00:00.000Z' }

  test('无截图无联系方式', () => {
    const body = buildIssueBody({ type: 'bug', description: '窗口闪退', screenshots: [] }, { ...base, screenshotUrls: [] })
    expect(body).toContain('<!-- 来自 MyYoda 应用内反馈 -->')
    expect(body).toContain('**类型**：Bug 报告')
    expect(body).toContain('窗口闪退')
    expect(body).toContain('- MyYoda 版本：0.10.8')
    expect(body).not.toContain('**截图**')
    expect(body).not.toContain('**联系方式**')
  })

  test('含截图与联系方式', () => {
    const body = buildIssueBody(
      { type: 'feature', description: '希望加导出', screenshots: [], contactEmail: 'a@b.com' },
      { ...base, screenshotUrls: ['https://github.com/user-attachments/assets/abc'] },
    )
    expect(body).toContain('**截图**：')
    expect(body).toContain('![截图 1](https://github.com/user-attachments/assets/abc)')
    expect(body).toContain('**联系方式**：a@b.com')
  })
})

describe('buildDedupKey', () => {
  test('空白折叠归一化', () => {
    expect(buildDedupKey('bug', ' 窗口\n闪退  ')).toBe('bug:窗口 闪退')
  })
})

describe('resolveIssueLabels', () => {
  test('仓库有 label 时使用，无则剔除', () => {
    expect(resolveIssueLabels('bug', ['bug', 'enhancement'])).toEqual(['bug'])
    expect(resolveIssueLabels('feature', ['bug', 'enhancement'])).toEqual(['enhancement'])
    expect(resolveIssueLabels('bug', [])).toEqual([])
  })
})

describe('extractAttachmentUrl', () => {
  test('从多种响应形态中提取', () => {
    expect(extractAttachmentUrl({ url: 'https://github.com/user-attachments/assets/abc-123' })).toBe('https://github.com/user-attachments/assets/abc-123')
    expect(extractAttachmentUrl({ asset: { url: 'https://github.com/user-attachments/assets/def-456' } })).toBe('https://github.com/user-attachments/assets/def-456')
    expect(extractAttachmentUrl('https://github.com/user-attachments/assets/ghi-789')).toBe('https://github.com/user-attachments/assets/ghi-789')
  })

  test('无附件 URL 返回 null', () => {
    expect(extractAttachmentUrl({ ok: true })).toBeNull()
  })
})
```

**Step 2: 运行确认失败**

```bash
bun test apps/electron/src/main/lib/feedback-format.test.ts 2>&1 | tail -5
```

Expected: FAIL — `Cannot find module './feedback-format'`。

**Step 3: 实现**

创建 `apps/electron/src/main/lib/feedback-format.ts`：

```ts
/**
 * 反馈 → GitHub Issue 纯逻辑：标题/正文模板/标签决策/去重 key/附件 URL 提取（无 IO，便于单测）
 */
import {
  FEEDBACK_TYPE_LABEL,
  FEEDBACK_TYPE_TITLE_PREFIX,
  type FeedbackSubmitInput,
  type FeedbackType,
} from '@myyoda/shared'

/** 标题截断长度（描述前 N 字） */
const TITLE_PREFIX_LIMIT = 40

/** 生成 issue 标题：[类型] 描述前 N 字 */
export function buildIssueTitle(type: FeedbackType, description: string): string {
  const prefix = description.trim().replace(/\s+/g, ' ').slice(0, TITLE_PREFIX_LIMIT)
  const label = FEEDBACK_TYPE_TITLE_PREFIX[type]
  return prefix ? `[${label}] ${prefix}` : `[${label}] 无描述`
}

export interface IssueBodyOptions {
  appVersion: string
  platform: string
  submittedAt: string
  screenshotUrls: string[]
}

/** 生成 issue 正文（类型/描述/截图/联系方式/环境信息） */
export function buildIssueBody(input: FeedbackSubmitInput, options: IssueBodyOptions): string {
  const lines: string[] = [
    '<!-- 来自 MyYoda 应用内反馈 -->',
    '',
    `**类型**：${FEEDBACK_TYPE_TITLE_PREFIX[input.type]}`,
    '',
    '**详细描述**：',
    '',
    input.description.trim(),
  ]
  if (options.screenshotUrls.length > 0) {
    lines.push('', '**截图**：')
    for (const [index, url] of options.screenshotUrls.entries()) {
      lines.push(`![截图 ${index + 1}](${url})`)
    }
  }
  if (input.contactEmail?.trim()) {
    lines.push('', `**联系方式**：${input.contactEmail.trim()}`)
  }
  lines.push(
    '',
    '**环境信息**：',
    `- MyYoda 版本：${options.appVersion || '未知版本'}`,
    `- 系统：${options.platform || 'unknown'}`,
    `- 提交时间：${options.submittedAt}`,
  )
  return lines.join('\n')
}

/** 去重 key：类型 + 归一化描述（空白折叠） */
export function buildDedupKey(type: FeedbackType, description: string): string {
  return `${type}:${description.trim().replace(/\s+/g, ' ')}`
}

/** 标签决策：仓库缺少目标 label 时返回空数组（避免创建 issue 时 422） */
export function resolveIssueLabels(type: FeedbackType, availableLabels: string[]): string[] {
  const wanted = FEEDBACK_TYPE_LABEL[type]
  return availableLabels.includes(wanted) ? [wanted] : []
}

/** 从 user-attachments 上传响应中递归提取附件 URL（响应形态以实测为准，做多种兜底） */
export function extractAttachmentUrl(payload: unknown): string | null {
  const pattern = /https:\/\/github\.com\/user-attachments\/assets\/[A-Za-z0-9-]+/
  if (typeof payload === 'string') {
    return pattern.test(payload) ? payload : null
  }
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = extractAttachmentUrl(item)
      if (found) return found
    }
    return null
  }
  if (typeof payload === 'object' && payload !== null) {
    for (const value of Object.values(payload as Record<string, unknown>)) {
      const found = extractAttachmentUrl(value)
      if (found) return found
    }
  }
  return null
}
```

**Step 4: 运行确认通过**

```bash
bun test apps/electron/src/main/lib/feedback-format.test.ts 2>&1 | tail -5
```

Expected: 全部 pass（约 10 条断言）。

**Step 5: Commit**

```bash
git add apps/electron/src/main/lib/feedback-format.ts apps/electron/src/main/lib/feedback-format.test.ts
git commit --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>" -m "feat(feedback): issue 模板/标签决策/去重纯逻辑"
```

---

## Task 4: config-paths 新增路径

**Files:**
- Modify: `apps/electron/src/main/lib/config-paths.ts:679-683`（`getFeedbackConfigPath` 注释）、`:688-696`（`getFeedbackDraftsDir` 之后追加）

**Step 1: 修改**

把 `getFeedbackConfigPath` 的 JSDoc 注释从「反馈配置（Notion）」改为：

```ts
/**
 * 获取反馈配置（GitHub PAT）文件路径
 *
 * @returns ~/.myyoda/feedback.json
 */
```

在 `getFeedbackDraftsDir()` 函数（其返回 `join(getConfigDir(), 'feedback-drafts')`）之后、`getDiscoverDir()` 之前插入：

```ts
/**
 * 获取反馈去重记录文件路径
 *
 * @returns ~/.myyoda/feedback-submitted.json
 */
export function getFeedbackSubmittedPath(): string {
  return join(getConfigDir(), 'feedback-submitted.json')
}
```

在 `getDiscoverVideoCacheDir()` 函数之后插入：

```ts
/**
 * 获取「发现」Wiki 缓存目录路径（git 浅克隆目标）
 *
 * @returns ~/.myyoda/discover/wiki-cache
 */
export function getDiscoverWikiCacheDir(): string {
  return join(getDiscoverDir(), 'wiki-cache')
}
```

**Step 2: 验证**

```bash
bun test apps/electron/src/main/lib/config-paths.test.ts 2>&1 | tail -4 || bun test apps/electron/src/main/lib 2>&1 | tail -4
```

Expected: 现有测试保持通过（新增函数暂无测试，Task 6 的 wiki-service 测试间接覆盖）。

**Step 3: Commit**

```bash
git add apps/electron/src/main/lib/config-paths.ts
git commit --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>" -m "feat(main): 反馈去重记录与 Wiki 缓存目录路径"
```

---

## Task 5: feedback-service 重构为 GitHub Issues 提交

**Files:**
- Modify: `apps/electron/src/main/lib/feedback-service.ts`（整体替换，约 400 行）

**Step 1: 整体替换文件**

用以下内容替换 `apps/electron/src/main/lib/feedback-service.ts` 全部内容：

```ts
/**
 * 用户反馈服务（→ GitHub Issues）
 *
 * 反馈提交到 GeoffBao/MyYoda 公开仓库的 Issues（fine-grained PAT 认证）。
 * - 配置：~/.myyoda/feedback.json（token 用 Electron safeStorage 加密）
 * - 截图：非官方 user-attachments 端点上传（与网页端拖拽等效），URL 嵌入 issue 正文
 * - 草稿：~/.myyoda/feedback-drafts/（v2 格式，提交失败降级，可重试）
 * - 去重：~/.myyoda/feedback-submitted.json（类型+描述 hash，30 天窗口）
 * - HTTP 统一走代理感知的 getFetchFn（国内网络环境刚需）
 *
 * 设计契约参考 docs/superpowers/specs/2026-08-17-discover-feedback-github-issues-wiki-design.md §4。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { BrowserWindow, dialog, safeStorage } from 'electron'
import type { WebContents } from 'electron'
import {
  FEEDBACK_DESCRIPTION_MAX_LENGTH,
  FEEDBACK_MAX_IMAGE_BYTES,
  FEEDBACK_MAX_SCREENSHOTS,
  FEEDBACK_REPO,
  type FeedbackDraft,
  type FeedbackDraftItem,
  type FeedbackGithubConfig,
  type FeedbackSubmitInput,
  type FeedbackSubmitResult,
  type FeedbackTestConnectionResult,
} from '@myyoda/shared'
import { getFeedbackConfigPath, getFeedbackDraftsDir, getFeedbackSubmittedPath } from './config-paths'
import {
  buildDedupKey,
  buildIssueBody,
  buildIssueTitle,
  extractAttachmentUrl,
  resolveIssueLabels,
} from './feedback-format'
import { getFetchFn } from './proxy-fetch'
import { getEffectiveProxyUrl } from './proxy-settings-service'

const GITHUB_API_BASE = 'https://api.github.com'
const UPLOADS_API_BASE = 'https://uploads.github.com'

/** 预览 JPEG 最长边 */
const PREVIEW_MAX_DIMENSION = 1280
/** 去重记录上限 */
const DEDUP_MAX_ENTRIES = 200
/** 去重记录保留窗口（天） */
const DEDUP_KEEP_DAYS = 30

// ===== 配置读写（token 加密） =====

interface FeedbackConfigFile {
  version?: 2
  tokenEncrypted?: string
  repo?: { owner: string; repo: string }
  /** 旧 Notion 字段（迁移后不再写入；读取时仅用于提示） */
  databaseId?: string
}

function encryptSecret(plainSecret: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    return plainSecret
  }
  return safeStorage.encryptString(plainSecret).toString('base64')
}

function decryptSecret(encryptedSecret: string): string {
  if (!encryptedSecret) return ''
  if (!safeStorage.isEncryptionAvailable()) {
    return encryptedSecret
  }
  try {
    return safeStorage.decryptString(Buffer.from(encryptedSecret, 'base64'))
  } catch {
    return ''
  }
}

function readConfigFile(): FeedbackConfigFile {
  const filePath = getFeedbackConfigPath()
  if (!existsSync(filePath)) return {}
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown
    if (typeof raw !== 'object' || raw === null) return {}
    return raw as FeedbackConfigFile
  } catch {
    return {}
  }
}

/** 读取完整配置（含解密 token，仅供内部提交/测试使用） */
export function getFeedbackConfig(): FeedbackGithubConfig {
  const raw = readConfigFile()
  return {
    token: raw.tokenEncrypted ? decryptSecret(raw.tokenEncrypted) : '',
    repo: raw.repo?.owner && raw.repo?.repo ? raw.repo : FEEDBACK_REPO,
  }
}

/** 保存配置；token 传空字符串表示清除 */
export function saveFeedbackConfig(config: FeedbackGithubConfig): void {
  const repo = config.repo?.owner && config.repo?.repo ? config.repo : FEEDBACK_REPO
  const raw: FeedbackConfigFile = { version: 2, repo }
  const token = config.token?.trim() ?? ''
  if (token) {
    raw.tokenEncrypted = encryptSecret(token)
  }
  writeFileSync(getFeedbackConfigPath(), JSON.stringify(raw, null, 2), 'utf-8')
  // 仓库变化时失效内存缓存
  repoIdCache = null
  knownLabelsCache = null
}

/** 面向 renderer 的公开配置（不泄露 token） */
export function getFeedbackConfigPublic(): {
  configured: boolean
  repo: string
  legacyNotionDetected: boolean
} {
  const raw = readConfigFile()
  const config = getFeedbackConfig()
  return {
    configured: Boolean(config.token),
    repo: `${config.repo?.owner}/${config.repo?.repo}`,
    legacyNotionDetected: Boolean(raw.databaseId),
  }
}

// ===== 连接测试 =====

/** 测试 PAT 是否有效且可访问目标仓库（GET /repos；fine-grained token 无 user scope，不能用 GET /user 验证） */
export async function testFeedbackConnection(config: FeedbackGithubConfig): Promise<FeedbackTestConnectionResult> {
  const saved = getFeedbackConfig()
  const token = (config.token?.trim() || saved.token || '').trim()
  const repo = config.repo?.owner && config.repo?.repo ? config.repo : saved.repo ?? FEEDBACK_REPO
  if (!token) {
    return { success: false, message: '请先填写 GitHub Personal Access Token' }
  }
  try {
    const fetchFn = getFetchFn(await getEffectiveProxyUrl())
    const response = await fetchFn(`${GITHUB_API_BASE}/repos/${repo.owner}/${repo.repo}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    })
    if (response.ok) {
      return { success: true, message: '凭证有效，反馈将提交到该仓库的 Issues' }
    }
    if (response.status === 401) {
      return { success: false, message: 'Token 无效或已失效，请到 GitHub 重新生成' }
    }
    if (response.status === 403) {
      return { success: false, message: '权限不足：请确认 Token 已授权访问 GeoffBao/MyYoda 仓库' }
    }
    if (response.status === 404) {
      return { success: false, message: '找不到目标仓库 GeoffBao/MyYoda' }
    }
    return { success: false, message: `GitHub 返回错误（${response.status}）` }
  } catch {
    return { success: false, message: '网络请求失败，请检查代理设置后重试' }
  }
}

// ===== 截图/图片处理 =====

/** 用 sharp 把图片压缩为预览级 JPEG，返回 { filePath, dataUrl } */
async function prepareScreenshot(srcPath: string): Promise<{ filePath: string; dataUrl: string } | null> {
  const { default: sharp } = await import('sharp')
  const draftsDir = getFeedbackDraftsDir()
  if (!existsSync(draftsDir)) mkdirSync(draftsDir, { recursive: true })

  const outPath = join(draftsDir, `shot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`)
  try {
    const buffer = await sharp(srcPath)
      .rotate()
      .resize({ width: PREVIEW_MAX_DIMENSION, height: PREVIEW_MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer()
    writeFileSync(outPath, buffer)
    return {
      filePath: outPath,
      dataUrl: `data:image/jpeg;base64,${buffer.toString('base64')}`,
    }
  } catch (error) {
    console.warn('[反馈] 图片压缩失败:', error instanceof Error ? error.message : String(error))
    return null
  }
}

/** 截取当前应用窗口（调用前 renderer 会短暂隐藏反馈弹窗自身） */
export async function captureFeedbackWindow(sender: WebContents): Promise<{ filePath: string; dataUrl: string } | null> {
  try {
    const win = BrowserWindow.fromWebContents(sender)
    if (!win) return null
    const image = await win.webContents.capturePage()
    const jpeg = image.toJPEG(85)
    if (jpeg.length > FEEDBACK_MAX_IMAGE_BYTES) {
      // 超限时降分辨率重压
      const { default: sharp } = await import('sharp')
      const buffer = await sharp(jpeg).resize({ width: PREVIEW_MAX_DIMENSION, height: PREVIEW_MAX_DIMENSION, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toBuffer()
      const filePath = writeCaptureBuffer(buffer)
      return { filePath, dataUrl: `data:image/jpeg;base64,${buffer.toString('base64')}` }
    }
    const filePath = writeCaptureBuffer(jpeg)
    return { filePath, dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}` }
  } catch (error) {
    console.warn('[反馈] 窗口截图失败:', error instanceof Error ? error.message : String(error))
    return null
  }
}

function writeCaptureBuffer(buffer: Buffer): string {
  const draftsDir = getFeedbackDraftsDir()
  if (!existsSync(draftsDir)) mkdirSync(draftsDir, { recursive: true })
  const filePath = join(draftsDir, `cap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`)
  writeFileSync(filePath, buffer)
  return filePath
}

/** 打开图片选择对话框，返回压缩后的 { filePath, dataUrl } 列表 */
export async function pickFeedbackImages(sender: WebContents): Promise<Array<{ filePath: string; dataUrl: string }>> {
  const win = BrowserWindow.fromWebContents(sender)
  const options: Electron.OpenDialogOptions = {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return []

  const prepared: Array<{ filePath: string; dataUrl: string }> = []
  for (const filePath of result.filePaths.slice(0, FEEDBACK_MAX_SCREENSHOTS)) {
    const item = await prepareScreenshot(filePath)
    if (item) prepared.push(item)
  }
  return prepared
}

// ===== GitHub 提交 =====

/** 仓库 id 内存缓存（user-attachments 上传需要） */
let repoIdCache: number | null = null

/** 仓库已有 label 内存缓存 */
let knownLabelsCache: string[] | null = null

async function getRepositoryId(token: string, fetchFn: typeof globalThis.fetch): Promise<number> {
  if (repoIdCache !== null) return repoIdCache
  const repo = getFeedbackConfig().repo ?? FEEDBACK_REPO
  const response = await fetchFn(`${GITHUB_API_BASE}/repos/${repo.owner}/${repo.repo}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  })
  if (!response.ok) throw new Error(`获取仓库信息失败（${response.status}）`)
  const data = (await response.json()) as { id: number }
  repoIdCache = data.id
  return data.id
}

/** 上传单张截图到 user-attachments（非官方端点，与网页端拖拽等效），返回附件 URL */
async function uploadScreenshotAsset(
  filePath: string,
  token: string,
  repositoryId: number,
  fetchFn: typeof globalThis.fetch,
): Promise<string> {
  const filename = basename(filePath)
  const ext = extname(filePath).toLowerCase()
  const contentType = ext === '.png' ? 'image/png' : 'image/jpeg'
  const query = new URLSearchParams({
    name: filename,
    content_type: contentType,
    repository_id: String(repositoryId),
  })
  const buffer = readFileSync(filePath)
  const response = await fetchFn(`${UPLOADS_API_BASE}/user-attachments/assets?${query.toString()}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': contentType,
    },
    body: new Uint8Array(buffer),
  })
  if (!response.ok) throw new Error(`上传截图失败（${response.status}）`)
  const payload = (await response.json()) as unknown
  const url = extractAttachmentUrl(payload)
  if (!url) throw new Error('上传截图失败（响应中未找到附件 URL）')
  return url
}

/** 探测仓库已有 labels（失败按空处理，内存缓存） */
async function getKnownLabels(token: string, fetchFn: typeof globalThis.fetch): Promise<string[]> {
  if (knownLabelsCache !== null) return knownLabelsCache
  const repo = getFeedbackConfig().repo ?? FEEDBACK_REPO
  const response = await fetchFn(`${GITHUB_API_BASE}/repos/${repo.owner}/${repo.repo}/labels`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  })
  if (!response.ok) {
    knownLabelsCache = []
    return []
  }
  const payload = (await response.json()) as Array<{ name?: unknown }>
  knownLabelsCache = payload
    .map((label) => (typeof label?.name === 'string' ? label.name : ''))
    .filter(Boolean)
  return knownLabelsCache
}

/** 提交反馈到 GitHub Issues */
export async function submitFeedback(
  input: FeedbackSubmitInput,
  appVersion: string,
  platform: string,
): Promise<FeedbackSubmitResult> {
  const config = getFeedbackConfig()
  if (!config.token) {
    const draftPath = saveFeedbackDraft(input, appVersion, platform, [])
    return { success: false, error: '尚未配置 GitHub 凭证', draftSaved: true, draftPath }
  }

  // 输入校验（renderer 已限制，这里兜底）
  const description = input.description.trim()
  if (!description) {
    return { success: false, error: '请填写详细描述' }
  }
  if (description.length > FEEDBACK_DESCRIPTION_MAX_LENGTH) {
    return { success: false, error: `描述超过 ${FEEDBACK_DESCRIPTION_MAX_LENGTH} 字上限` }
  }
  if (input.screenshots.length > FEEDBACK_MAX_SCREENSHOTS) {
    return { success: false, error: `截图最多 ${FEEDBACK_MAX_SCREENSHOTS} 张` }
  }

  const dedupKey = buildDedupKey(input.type, description)
  const duplicate = hasSubmitted(dedupKey)

  // 已上传的附件 URL：issue 创建失败时写入草稿，重试可复用（作用域在 try 外，catch 兜底也能拿到）
  let uploadedUrls: string[] = []

  try {
    const fetchFn = getFetchFn(await getEffectiveProxyUrl())
    const repositoryId = await getRepositoryId(config.token, fetchFn)

    // 1. 上传截图（单张失败跳过，全部完成后统一嵌入正文）
    let skippedScreenshots = 0
    for (const shotPath of input.screenshots) {
      if (!existsSync(shotPath)) {
        skippedScreenshots += 1
        continue
      }
      try {
        uploadedUrls.push(await uploadScreenshotAsset(shotPath, config.token, repositoryId, fetchFn))
      } catch (error) {
        skippedScreenshots += 1
        console.warn('[反馈] 单张截图上传失败，跳过:', error instanceof Error ? error.message : String(error))
      }
    }

    // 2. 组装并创建 issue
    const title = buildIssueTitle(input.type, description)
    const body = buildIssueBody(input, {
      appVersion,
      platform,
      submittedAt: new Date().toISOString(),
      screenshotUrls: uploadedUrls,
    })
    const repo = config.repo ?? FEEDBACK_REPO
    const labels = resolveIssueLabels(input.type, await getKnownLabels(config.token, fetchFn))

    const createIssue = (withLabels: string[]): Promise<Response> =>
      fetchFn(`${GITHUB_API_BASE}/repos/${repo.owner}/${repo.repo}/issues`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(withLabels.length > 0 ? { title, body, labels: withLabels } : { title, body }),
      })

    let createResponse = await createIssue(labels)
    // label 不存在的 422 → 降级重试不带 label
    if (!createResponse.ok && createResponse.status === 422 && labels.length > 0) {
      createResponse = await createIssue([])
    }

    if (!createResponse.ok) {
      const errBody = (await createResponse.text()).slice(0, 300)
      let error = `GitHub 返回错误（${createResponse.status}）`
      if (createResponse.status === 401) error = 'Token 无效或已失效，请到设置中重新配置'
      if (createResponse.status === 403) error = '权限不足：请确认 Token 已授权 Issues 写权限'
      console.warn('[反馈] 创建 issue 失败:', error, errBody)
      const draftPath = saveFeedbackDraft(input, appVersion, platform, uploadedUrls)
      return { success: false, error, draftSaved: true, draftPath }
    }

    const created = (await createResponse.json()) as { html_url?: string }
    recordSubmitted(dedupKey)
    // 清理临时截图（截图/上传产生的临时文件都落在 feedback-drafts 目录）
    cleanupTempScreenshots(input.screenshots)
    return {
      success: true,
      issueUrl: created.html_url,
      screenshotsSkipped: skippedScreenshots > 0,
      duplicate,
    }
  } catch {
    const draftPath = saveFeedbackDraft(input, appVersion, platform, uploadedUrls)
    return { success: false, error: '网络请求失败，已保存草稿，请检查代理后重试', draftSaved: true, draftPath }
  }
}

// ===== 草稿 =====

/** 删除 drafts 目录下的临时截图文件（只清理本服务自己产生的临时文件） */
function cleanupTempScreenshots(screenshotPaths: string[]): void {
  const draftsDir = getFeedbackDraftsDir()
  for (const filePath of screenshotPaths) {
    try {
      if (!filePath.startsWith(draftsDir)) continue
      unlinkSync(filePath)
    } catch {
      // 清理失败不影响提交结果
    }
  }
}

function saveFeedbackDraft(
  input: FeedbackSubmitInput,
  appVersion: string,
  platform: string,
  uploadedAssetUrls: string[],
): string {
  const draftsDir = getFeedbackDraftsDir()
  if (!existsSync(draftsDir)) mkdirSync(draftsDir, { recursive: true })
  const draft: FeedbackDraft = {
    version: 2,
    createdAt: new Date().toISOString(),
    input,
    appVersion,
    platform,
    uploadedAssetUrls: uploadedAssetUrls.length > 0 ? uploadedAssetUrls : undefined,
  }
  const draftPath = join(draftsDir, `draft-${Date.now()}.json`)
  writeFileSync(draftPath, JSON.stringify(draft, null, 2), 'utf-8')
  return draftPath
}

/** 列出本地草稿（v2 可重试；v1 Notion 旧格式标记 legacy，不可提交） */
export function listFeedbackDrafts(): FeedbackDraftItem[] {
  const draftsDir = getFeedbackDraftsDir()
  if (!existsSync(draftsDir)) return []
  const items: FeedbackDraftItem[] = []
  for (const fileName of readdirSync(draftsDir)) {
    if (!fileName.endsWith('.json')) continue
    try {
      const raw = JSON.parse(readFileSync(join(draftsDir, fileName), 'utf-8')) as Record<string, unknown>
      if (typeof raw !== 'object' || raw === null) continue
      const input = raw.input as Partial<FeedbackSubmitInput> | undefined
      if (!input || typeof input.type !== 'string' || typeof input.description !== 'string') continue
      const legacy = raw.version !== 2
      items.push({
        fileName,
        version: legacy ? 1 : 2,
        createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
        input: {
          type: input.type === 'feature' ? 'feature' : 'bug',
          description: input.description,
          screenshots: Array.isArray(input.screenshots) ? input.screenshots : [],
          contactEmail: typeof input.contactEmail === 'string' ? input.contactEmail : undefined,
        },
        appVersion: typeof raw.appVersion === 'string' ? raw.appVersion : undefined,
        platform: typeof raw.platform === 'string' ? raw.platform : undefined,
        legacy,
      })
    } catch {
      // 损坏文件跳过
    }
  }
  return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

/** 删除本地草稿（严格校验文件名，防路径穿越）；不存在返回 false */
export function deleteFeedbackDraft(fileName: string): boolean {
  if (!/^draft-[\w-]+\.json$/.test(fileName)) return false
  const filePath = join(getFeedbackDraftsDir(), fileName)
  if (!existsSync(filePath)) return false
  try {
    unlinkSync(filePath)
    return true
  } catch {
    return false
  }
}

// ===== 去重记录 =====

interface SubmittedRecord {
  [dedupKey: string]: number
}

function readSubmittedRecords(): SubmittedRecord {
  try {
    const raw = JSON.parse(readFileSync(getFeedbackSubmittedPath(), 'utf-8')) as unknown
    if (typeof raw === 'object' && raw !== null) return raw as SubmittedRecord
    return {}
  } catch {
    return {}
  }
}

/** 该 key 是否已提交过 */
export function hasSubmitted(dedupKey: string): boolean {
  return dedupKey in readSubmittedRecords()
}

/** 记录提交（保留 30 天窗口，超出 200 条时淘汰最旧） */
function recordSubmitted(dedupKey: string): void {
  const records = readSubmittedRecords()
  const cutoff = Date.now() - DEDUP_KEEP_DAYS * 24 * 60 * 60 * 1000
  for (const [key, at] of Object.entries(records)) {
    if (at < cutoff) delete records[key]
  }
  records[dedupKey] = Date.now()
  const keys = Object.keys(records)
  if (keys.length > DEDUP_MAX_ENTRIES) {
    keys.sort((a, b) => (records[a] ?? 0) - (records[b] ?? 0))
    for (const key of keys.slice(0, keys.length - DEDUP_MAX_ENTRIES)) delete records[key]
  }
  writeFileSync(getFeedbackSubmittedPath(), JSON.stringify(records, null, 2), 'utf-8')
}
```

**Step 2: 验证（本任务不跑全量 typecheck）**

```bash
bun test apps/electron/src/main/lib/feedback-format.test.ts apps/electron/src/main/lib/wiki-pages.test.ts 2>&1 | tail -4
```

Expected: 纯逻辑测试保持通过。`feedback-service.ts` 依赖 electron 运行时 API（safeStorage/BrowserWindow），不设单元测试，行为由 Task 12 手动清单覆盖（与仓库既有约定一致）。

**Step 3: Commit**

```bash
git add apps/electron/src/main/lib/feedback-service.ts
git commit --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>" -m "feat(feedback): 反馈服务重构为 GitHub Issues 提交（PAT/user-attachments/草稿 v2/去重）"
```

---

## Task 6: wiki-service（git 浅克隆管线 + 本地 fixture 集成测试）

**Files:**
- Create: `apps/electron/src/main/lib/wiki-service.ts`
- Test: `apps/electron/src/main/lib/wiki-service.test.ts`

**Step 1: 写失败测试**

创建 `apps/electron/src/main/lib/wiki-service.test.ts`：

```ts
import { afterAll, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getWikiPage, getWikiPages, refreshWikiCache } from './wiki-service'

/** 本地 fixture wiki 仓库（git init + 提交 Home/Guide/_Sidebar），返回目录路径 */
function createFixtureWiki(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wiki-fixture-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 'test@test.local'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: dir })
  writeFileSync(join(dir, 'Home.md'), '# 首页\n\n欢迎使用。\n\n![logo](assets/logo.png)\n')
  writeFileSync(join(dir, 'Guide.md'), '# 使用指南\n\n指南正文')
  writeFileSync(join(dir, '_Sidebar.md'), '* [首页](Home)\n* [指南](Guide)\n')
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'assets', 'logo.png'), 'fake-bytes')
  execFileSync('git', ['add', '-A'], { cwd: dir })
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir })
  return dir
}

const fixture = createFixtureWiki()
const cacheDir = mkdtempSync(join(tmpdir(), 'wiki-cache-'))

afterAll(() => {
  rmSync(fixture, { recursive: true, force: true })
  rmSync(cacheDir, { recursive: true, force: true })
})

describe('wiki-service（本地 fixture 仓库）', () => {
  test('首次克隆返回 commit hash，页面树来自 _Sidebar', async () => {
    const hash = await refreshWikiCache(cacheDir, `file://${fixture}`)
    expect(hash).toMatch(/^[0-9a-f]{40}$/)

    const result = await getWikiPages(null, true, cacheDir)
    expect(result.tree.fromSidebar).toBe(true)
    expect(result.tree.nodes.map((n) => n.name)).toEqual(['Home', 'Guide'])
    expect(result.fromCache).toBe(false)
    expect(result.commitHash).toBe(hash)
  })

  test('非强制读取直接返回缓存（不触发网络）', async () => {
    const result = await getWikiPages(null, false, cacheDir)
    expect(result.tree.nodes).toHaveLength(2)
  })

  test('fixture 追加提交后 force 刷新拿到新 hash', async () => {
    writeFileSync(join(fixture, 'FAQ.md'), '# FAQ\n\n常见问题')
    execFileSync('git', ['add', '-A'], { cwd: fixture })
    execFileSync('git', ['commit', '-q', '-m', 'add faq'], { cwd: fixture })

    const result = await getWikiPages(null, true, cacheDir)
    expect(result.tree.nodes.map((n) => n.name)).toContain('FAQ')
  })

  test('单页正文：相对路径图片重写为代理 URL，htmlUrl 正确', () => {
    const page = getWikiPage('Home', cacheDir)
    expect(page.markdown).toContain('raw.githubusercontent.com')
    expect(page.markdown).not.toContain('](assets/logo.png)')
    expect(page.htmlUrl).toBe('https://github.com/GeoffBao/MyYoda/wiki/Home')
  })

  test('非法页面名抛错', () => {
    expect(() => getWikiPage('../etc/passwd', cacheDir)).toThrow()
    expect(() => getWikiPage('NoSuchPage', cacheDir)).toThrow()
  })
})
```

**Step 2: 运行确认失败**

```bash
bun test apps/electron/src/main/lib/wiki-service.test.ts 2>&1 | tail -5
```

Expected: FAIL — `Cannot find module './wiki-service'`。

**Step 3: 实现**

创建 `apps/electron/src/main/lib/wiki-service.ts`：

```ts
/**
 * 「帮助」Wiki 服务：GitHub Wiki（git 仓库）浅克隆 + 本地缓存
 *
 * - 源：https://github.com/GeoffBao/MyYoda.wiki.git（wiki 首次建页后仓库才存在）
 * - 首次打开帮助 tab 浅克隆到 ~/.myyoda/discover/wiki-cache/；之后 git fetch --depth 1 + reset --hard
 * - 页面树：_Sidebar.md 解析（缺失时按文件列表构建）；正文本地 .md 直读，图片经远程媒体代理
 * - git 代理：clone/fetch 时注入 -c http.proxy=<有效代理>
 * - 更新推送：后台刷新发现 commit 变化时经 sender 推 WIKI_UPDATED
 *
 * 纯逻辑（解析/重写）在 wiki-pages.ts，本文件只做 IO 编排。
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { WebContents } from 'electron'
import { DISCOVER_IPC_CHANNELS, type WikiPageContent, type WikiPagesResult, type WikiPageTree } from '@myyoda/shared'
import { getDiscoverWikiCacheDir } from './config-paths'
import { getEffectiveProxyUrl } from './proxy-settings-service'
import { registerRemoteMediaUrl } from './discover-remote-media'
import {
  buildPageTreeFromFileNames,
  isWikiPageNameSafe,
  parseSidebar,
  rewriteWikiMedia,
} from './wiki-pages'

const execFileAsync = promisify(execFile)

/** Wiki 承载仓库（与社区 Discussions 同仓库） */
export const WIKI_REPO = { owner: 'GeoffBao', repo: 'MyYoda' }

/** 默认远端 URL（测试可经参数注入本地 fixture） */
export function getDefaultWikiRemoteUrl(): string {
  return `https://github.com/${WIKI_REPO.owner}/${WIKI_REPO.repo}.wiki.git`
}

/** 执行 git（注入代理配置）；返回 stdout（trim 后） */
async function runGit(args: string[], cwd?: string): Promise<string> {
  const proxy = await getEffectiveProxyUrl()
  const gitArgs = proxy ? ['-c', `http.proxy=${proxy}`, ...args] : [...args]
  const { stdout } = await execFileAsync('git', gitArgs, cwd ? { cwd } : {})
  return stdout.trim()
}

/** 确保本地缓存存在并更新到远端最新；返回当前 commit hash */
export async function refreshWikiCache(
  cacheDir: string = getDiscoverWikiCacheDir(),
  remoteUrl: string = getDefaultWikiRemoteUrl(),
): Promise<string> {
  if (existsSync(join(cacheDir, '.git'))) {
    await runGit(['fetch', '--depth', '1', 'origin'], cacheDir)
    await runGit(['reset', '--hard', 'FETCH_HEAD'], cacheDir)
  } else {
    mkdirSync(join(cacheDir, '..'), { recursive: true })
    await runGit(['clone', '--depth', '1', remoteUrl, cacheDir])
  }
  return runGit(['rev-parse', 'HEAD'], cacheDir)
}

interface WikiMeta {
  lastFetchedAt?: number
  commitHash?: string
  error?: string
}

/** meta 文件放在缓存目录之外（避免污染 git 仓库） */
function wikiMetaPathFor(cacheDir: string): string {
  return join(cacheDir, '..', 'wiki-meta.json')
}

function readWikiMeta(cacheDir: string): WikiMeta | null {
  try {
    const raw = JSON.parse(readFileSync(wikiMetaPathFor(cacheDir), 'utf-8')) as unknown
    if (typeof raw === 'object' && raw !== null) return raw as WikiMeta
    return null
  } catch {
    return null
  }
}

function writeWikiMeta(cacheDir: string, meta: WikiMeta): void {
  const path = wikiMetaPathFor(cacheDir)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify(meta, null, 2), 'utf-8')
}

/** 从缓存目录构建页面树（_Sidebar 优先，缺失按文件列表） */
function buildWikiPageTreeFromCacheDir(cacheDir: string): WikiPageTree {
  const sidebarPath = join(cacheDir, '_Sidebar.md')
  if (existsSync(sidebarPath)) {
    const tree = parseSidebar(readFileSync(sidebarPath, 'utf-8'))
    if (tree.nodes.length > 0) return tree
  }
  return buildPageTreeFromFileNames(readdirSync(cacheDir))
}

/** 从当前缓存 + meta 组装结果（无 IO 副作用） */
function readWikiPages(cacheDir: string): WikiPagesResult {
  const meta = readWikiMeta(cacheDir)
  const hasCache = existsSync(join(cacheDir, '.git'))
  return {
    tree: hasCache ? buildWikiPageTreeFromCacheDir(cacheDir) : { nodes: [], fromSidebar: false },
    fetchedAt: meta?.lastFetchedAt ?? 0,
    commitHash: meta?.commitHash ?? '',
    fromCache: Boolean(meta?.error),
    error: meta?.error,
  }
}

/** 刷新并写 meta；返回是否成功 */
async function doRefresh(cacheDir: string): Promise<boolean> {
  try {
    const hash = await refreshWikiCache(cacheDir)
    writeWikiMeta(cacheDir, { lastFetchedAt: Date.now(), commitHash: hash })
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    writeWikiMeta(cacheDir, { ...readWikiMeta(cacheDir), error: `文档库拉取失败：${message}` })
    return false
  }
}

function safeSend(sender: WebContents | null, channel: string, payload: unknown): void {
  try {
    if (sender && !sender.isDestroyed()) sender.send(channel, payload)
  } catch {
    // 窗口已销毁等场景忽略
  }
}

/**
 * 拉取 Wiki 页面树。
 * - 无缓存或 force：同步刷新（首次打开帮助 tab 会阻塞到克隆完成，wiki 体量小可接受）
 * - 有缓存且非 force：立即返回缓存，后台刷新；commit 变化时推送 WIKI_UPDATED
 */
export async function getWikiPages(
  sender: WebContents | null,
  force: boolean,
  cacheDir: string = getDiscoverWikiCacheDir(),
): Promise<WikiPagesResult> {
  const hasCache = existsSync(join(cacheDir, '.git'))
  const previousHash = readWikiMeta(cacheDir)?.commitHash ?? null

  if (!hasCache || force) {
    await doRefresh(cacheDir)
    return readWikiPages(cacheDir)
  }

  // 后台刷新（不阻塞本次返回）
  void (async () => {
    const ok = await doRefresh(cacheDir)
    if (ok && previousHash) {
      const meta = readWikiMeta(cacheDir)
      if (meta?.commitHash && meta.commitHash !== previousHash) {
        safeSend(sender, DISCOVER_IPC_CHANNELS.WIKI_UPDATED, { commitHash: meta.commitHash })
      }
    }
  })()

  return readWikiPages(cacheDir)
}

/** 读取单页正文（媒体重写 + GitHub 链接） */
export function getWikiPage(
  name: string,
  cacheDir: string = getDiscoverWikiCacheDir(),
): WikiPageContent {
  if (!isWikiPageNameSafe(name)) throw new Error(`页面名不合法：${name}`)
  const filePath = join(cacheDir, `${name}.md`)
  if (!existsSync(filePath)) throw new Error(`页面不存在：${name}`)
  const markdown = rewriteWikiMedia(readFileSync(filePath, 'utf-8'), registerRemoteMediaUrl)
  const slug = name.replace(/ /g, '-')
  return {
    name,
    markdown,
    htmlUrl: `https://github.com/${WIKI_REPO.owner}/${WIKI_REPO.repo}/wiki/${encodeURIComponent(slug)}`,
  }
}
```

**Step 4: 运行确认通过**

```bash
bun test apps/electron/src/main/lib/wiki-service.test.ts 2>&1 | tail -6
```

Expected: 6 条测试全部 pass（真实调用系统 git 克隆本地 fixture，网络无关）。

**Step 5: Commit**

```bash
git add apps/electron/src/main/lib/wiki-service.ts apps/electron/src/main/lib/wiki-service.test.ts
git commit --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>" -m "feat(discover): Wiki 服务——git 浅克隆、页面树与单页正文"
```

---

## Task 7: IPC 与 preload 接线

**Files:**
- Modify: `apps/electron/src/main/ipc.ts:5194-5260`（反馈区块整体替换 + 草稿 handlers）、`:5300 附近`（discover 区块追加 wiki handlers）
- Modify: `apps/electron/src/preload/index.ts:1333-1341`（接口声明）、`:1345 附近`（discover 接口追加）、`:3166-3191`（实现）、`:3240 附近`（wiki 事件订阅）

**Step 1: ipc.ts 反馈区块整体替换**

把 `ipc.ts` 中 `// ===== 用户反馈（→ Notion）=====` 注释起、到 `// ===== 「发现」面板（官方内容流 + 社区 + 反馈入口）=====` 注释之前的一整段，替换为：

```ts
  // ===== 用户反馈（→ GitHub Issues）=====

  // 提交反馈到 GitHub Issues（含截图 user-attachments 上传，失败自动落本地草稿）
  ipcMain.handle(
    FEEDBACK_IPC_CHANNELS.SUBMIT,
    async (_event, input: FeedbackSubmitInput, appVersion?: string, platform?: string) => {
      const { submitFeedback } = await import('./lib/feedback-service')
      return submitFeedback(input, appVersion ?? '', platform ?? '')
    }
  )

  // 测试 GitHub 凭证（PAT 是否有效且有目标仓库权限）
  ipcMain.handle(
    FEEDBACK_IPC_CHANNELS.TEST_CONNECTION,
    async (_event, config: FeedbackGithubConfig) => {
      const { testFeedbackConnection } = await import('./lib/feedback-service')
      return testFeedbackConnection(config)
    }
  )

  // 读取反馈渠道配置（不返回 token 明文）
  ipcMain.handle(
    FEEDBACK_IPC_CHANNELS.GET_CONFIG,
    async () => {
      const { getFeedbackConfigPublic } = await import('./lib/feedback-service')
      return getFeedbackConfigPublic()
    }
  )

  // 保存反馈渠道配置
  ipcMain.handle(
    FEEDBACK_IPC_CHANNELS.SAVE_CONFIG,
    async (_event, config: FeedbackGithubConfig) => {
      const { saveFeedbackConfig } = await import('./lib/feedback-service')
      saveFeedbackConfig(config)
    }
  )

  // 截取当前应用窗口（renderer 会在调用前短暂隐藏反馈弹窗自身）
  ipcMain.handle(
    FEEDBACK_IPC_CHANNELS.CAPTURE_WINDOW,
    async (event) => {
      const { captureFeedbackWindow } = await import('./lib/feedback-service')
      return captureFeedbackWindow(event.sender)
    }
  )

  // 选择本地图片（压缩后返回预览 dataUrl + 提交用 filePath）
  ipcMain.handle(
    FEEDBACK_IPC_CHANNELS.PICK_IMAGES,
    async (event) => {
      const { pickFeedbackImages } = await import('./lib/feedback-service')
      return pickFeedbackImages(event.sender)
    }
  )

  // 列出本地反馈草稿（v2 可重试，v1 旧格式标记 legacy）
  ipcMain.handle(FEEDBACK_IPC_CHANNELS.LIST_DRAFTS, async () => {
    const { listFeedbackDrafts } = await import('./lib/feedback-service')
    return listFeedbackDrafts()
  })

  // 删除本地反馈草稿（按文件名）
  ipcMain.handle(FEEDBACK_IPC_CHANNELS.DELETE_DRAFT, async (_event, fileName: string) => {
    const { deleteFeedbackDraft } = await import('./lib/feedback-service')
    return deleteFeedbackDraft(fileName)
  })
```

同时把 `ipc.ts` 顶部反馈类型导入从 `FeedbackNotionConfig` 改为 `FeedbackGithubConfig`（`grep -n "FeedbackNotionConfig\|FeedbackGithubConfig" apps/electron/src/main/ipc.ts` 定位导入行）。

**Step 2: ipc.ts discover 区块追加 wiki handlers**

在 `DISCOVER_IPC_CHANNELS.GET_DISCUSSION` 的 handler（`const { getDiscussion } = await import('./lib/community-service')` 之后）插入：

```ts
  // 拉取 Wiki 页面树（force 同步刷新克隆；否则读缓存并后台刷新，更新经 WIKI_UPDATED 推送）
  ipcMain.handle(DISCOVER_IPC_CHANNELS.GET_WIKI_PAGES, async (event, force?: boolean) => {
    const { getWikiPages } = await import('./lib/wiki-service')
    return getWikiPages(event.sender, Boolean(force))
  })

  // 手动刷新 Wiki（等价 GET_WIKI_PAGES force=true）
  ipcMain.handle(DISCOVER_IPC_CHANNELS.REFRESH_WIKI, async (event) => {
    const { getWikiPages } = await import('./lib/wiki-service')
    return getWikiPages(event.sender, true)
  })

  // 读取单个 Wiki 页面正文
  ipcMain.handle(DISCOVER_IPC_CHANNELS.GET_WIKI_PAGE, async (_event, name: string) => {
    const { getWikiPage } = await import('./lib/wiki-service')
    return getWikiPage(name)
  })
```

**Step 3: preload 接口声明更新**

在 `apps/electron/src/preload/index.ts` 接口区（约 1333 行 `// ===== 用户反馈（→ Notion）=====` 块），替换为：

```ts
  // ===== 用户反馈（→ GitHub Issues）=====
  feedbackSubmit: (input: import('@myyoda/shared').FeedbackSubmitInput, appVersion?: string, platform?: string) => Promise<import('@myyoda/shared').FeedbackSubmitResult>
  feedbackTestConnection: (config: import('@myyoda/shared').FeedbackGithubConfig) => Promise<import('@myyoda/shared').FeedbackTestConnectionResult>
  feedbackGetConfig: () => Promise<{ configured: boolean; repo: string; legacyNotionDetected: boolean }>
  feedbackSaveConfig: (config: import('@myyoda/shared').FeedbackGithubConfig) => Promise<void>
  feedbackCaptureWindow: () => Promise<{ filePath: string; dataUrl: string } | null>
  feedbackPickImages: () => Promise<Array<{ filePath: string; dataUrl: string }>>
  feedbackListDrafts: () => Promise<import('@myyoda/shared').FeedbackDraftItem[]>
  feedbackDeleteDraft: (fileName: string) => Promise<boolean>
```

在 discover 接口区（`onVideoDownloadDone` 行之后）追加：

```ts
  discoverGetWikiPages: (force?: boolean) => Promise<import('@myyoda/shared').WikiPagesResult>
  discoverGetWikiPage: (name: string) => Promise<import('@myyoda/shared').WikiPageContent>
  discoverRefreshWiki: () => Promise<import('@myyoda/shared').WikiPagesResult>
  onWikiUpdated: (listener: (event: { commitHash: string }) => void) => () => void
```

**Step 4: preload 实现更新**

在实现区（约 3166 行）把 feedback 六个函数替换为（注意 `feedbackGetConfig` 返回类型变化与新增两个函数）：

```ts
  // ===== 用户反馈（→ GitHub Issues）=====
  feedbackSubmit: (input, appVersion, platform) => {
    return ipcRenderer.invoke(FEEDBACK_IPC_CHANNELS.SUBMIT, input, appVersion, platform)
  },

  feedbackTestConnection: (config) => {
    return ipcRenderer.invoke(FEEDBACK_IPC_CHANNELS.TEST_CONNECTION, config)
  },

  feedbackGetConfig: () => {
    return ipcRenderer.invoke(FEEDBACK_IPC_CHANNELS.GET_CONFIG)
  },

  feedbackSaveConfig: (config) => {
    return ipcRenderer.invoke(FEEDBACK_IPC_CHANNELS.SAVE_CONFIG, config)
  },

  feedbackCaptureWindow: () => {
    return ipcRenderer.invoke(FEEDBACK_IPC_CHANNELS.CAPTURE_WINDOW)
  },

  feedbackPickImages: () => {
    return ipcRenderer.invoke(FEEDBACK_IPC_CHANNELS.PICK_IMAGES)
  },

  feedbackListDrafts: () => {
    return ipcRenderer.invoke(FEEDBACK_IPC_CHANNELS.LIST_DRAFTS)
  },

  feedbackDeleteDraft: (fileName) => {
    return ipcRenderer.invoke(FEEDBACK_IPC_CHANNELS.DELETE_DRAFT, fileName)
  },
```

在 `onVideoDownloadDone` 实现之后追加（照抄 `onVideoDownloadProgress` 模式）：

```ts
  onWikiUpdated: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { commitHash: string }): void => {
      listener(payload)
    }
    ipcRenderer.on(DISCOVER_IPC_CHANNELS.WIKI_UPDATED, handler)
    return () => {
      ipcRenderer.removeListener(DISCOVER_IPC_CHANNELS.WIKI_UPDATED, handler)
    }
  },
```

并在 discover 实现区追加：

```ts
  discoverGetWikiPages: (force) => {
    return ipcRenderer.invoke(DISCOVER_IPC_CHANNELS.GET_WIKI_PAGES, force)
  },

  discoverGetWikiPage: (name) => {
    return ipcRenderer.invoke(DISCOVER_IPC_CHANNELS.GET_WIKI_PAGE, name)
  },

  discoverRefreshWiki: () => {
    return ipcRenderer.invoke(DISCOVER_IPC_CHANNELS.REFRESH_WIKI)
  },
```

**Step 5: 验证（不跑全量 typecheck，Task 11 收口）**

```bash
bun test apps/electron/src/main/lib/wiki-service.test.ts apps/electron/src/main/lib/feedback-format.test.ts 2>&1 | tail -4
```

Expected: 纯逻辑测试保持通过。

**Step 6: Commit**

```bash
git add apps/electron/src/main/ipc.ts apps/electron/src/preload/index.ts
git commit --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>" -m "feat(ipc): 反馈通道切换到 GitHub，接线 Wiki 与草稿通道"
```

---

## Task 8: FeedbackSettings 改为 GitHub PAT 配置

**Files:**
- Modify: `apps/electron/src/renderer/components/settings/FeedbackSettings.tsx`（整体替换，约 150 行）

**Step 1: 整体替换文件**

用以下内容替换 `apps/electron/src/renderer/components/settings/FeedbackSettings.tsx`：

```tsx
/**
 * FeedbackSettings - 反馈渠道配置页
 *
 * 配置 GitHub fine-grained PAT（Issues 写权限，仅 GeoffBao/MyYoda 仓库），
 * 支持「测试连接」即时验证。token 用 safeStorage 加密存储，不回显明文。
 * 反馈会公开提交到仓库 Issues，页面给出创建 PAT 的指引链接。
 */

import * as React from 'react'
import { CheckCircle2, ExternalLink, Info, Loader2, XCircle } from 'lucide-react'
import {
  SettingsSection,
  SettingsCard,
  SettingsSecretInput,
  SettingsInput,
} from './primitives'
import type { FeedbackTestConnectionResult } from '@myyoda/shared'

const PAT_NEW_URL = 'https://github.com/settings/personal-access-tokens/new'

export function FeedbackSettings(): React.ReactElement {
  const [token, setToken] = React.useState('')
  const [repo, setRepo] = React.useState('GeoffBao/MyYoda')
  const [legacyNotionDetected, setLegacyNotionDetected] = React.useState(false)
  const [loaded, setLoaded] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [testing, setTesting] = React.useState(false)
  const [testResult, setTestResult] = React.useState<FeedbackTestConnectionResult | null>(null)
  const [savedHint, setSavedHint] = React.useState(false)

  React.useEffect(() => {
    window.electronAPI
      .feedbackGetConfig()
      .then((config) => {
        setRepo(config.repo)
        setLegacyNotionDetected(config.legacyNotionDetected)
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [])

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    setSavedHint(false)
    try {
      await window.electronAPI.feedbackSaveConfig({ token: token || undefined })
      setToken('')
      setSavedHint(true)
      setLegacyNotionDetected(false)
      window.setTimeout(() => setSavedHint(false), 3000)
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.electronAPI.feedbackTestConnection({ token: token || undefined })
      setTestResult(result)
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="space-y-4">
      <SettingsSection
        title="意见反馈渠道"
        description="应用内提交的反馈会作为 Issue 公开提交到 GeoffBao/MyYoda 仓库。需要配置一个 GitHub fine-grained Personal Access Token（Issues 写权限）。"
      >
        <SettingsCard>
          <SettingsSecretInput
            label="GitHub Personal Access Token"
            description="在 GitHub 生成 fine-grained PAT：Repository access 选「Only select repositories」→ GeoffBao/MyYoda，Permissions → Issues → Read and write。使用系统加密存储，仅保存在本机。"
            value={token}
            onChange={setToken}
            placeholder={loaded ? (token ? '已填写（留空保持不变）' : 'github_pat_...') : '加载中...'}
          />
          <SettingsInput
            label="承载仓库"
            description="反馈提交的目标仓库（固定，无需修改）。"
            value={repo}
            onChange={() => undefined}
            disabled
            placeholder="GeoffBao/MyYoda"
          />
        </SettingsCard>
      </SettingsSection>

      {legacyNotionDetected && (
        <SettingsSection title="迁移提示">
          <SettingsCard divided={false}>
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2.5 text-xs text-foreground/80">
              <Info size={14} className="mt-0.5 shrink-0 text-amber-500" />
              <span>
                反馈已切换到 GitHub Issues，检测到旧的 Notion 配置不再使用。保存新配置后本条提示消失；旧字段可自行删除（~/.myyoda/feedback.json 中的 databaseId/tokenEncrypted）。
              </span>
            </div>
          </SettingsCard>
        </SettingsSection>
      )}

      <SettingsSection title="验证与保存">
        <SettingsCard divided={false}>
          <div className="flex flex-wrap items-center gap-2 px-4 pb-4">
            <button
              type="button"
              onClick={handleTest}
              disabled={testing}
              className="flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-sm transition-colors hover:bg-accent disabled:opacity-50"
            >
              {testing ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              测试连接
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !token.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : null}
              保存配置
            </button>
            {savedHint && <span className="text-xs text-primary">已保存 ✓</span>}
            <a
              href={PAT_NEW_URL}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <ExternalLink size={12} />
              创建 Personal Access Token
            </a>
          </div>

          {testResult && (
            <div
              className={`mb-4 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs ${
                testResult.success
                  ? 'border-green-500/30 bg-green-500/[0.06] text-foreground'
                  : 'border-red-500/30 bg-red-500/[0.06] text-foreground'
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-green-500" />
              ) : (
                <XCircle size={14} className="mt-0.5 shrink-0 text-red-500" />
              )}
              <span>{testResult.message}</span>
            </div>
          )}
        </SettingsCard>
      </SettingsSection>
    </div>
  )
}
```

> 注：`SettingsInput` 是否支持 `disabled` 属性以 `apps/electron/src/renderer/components/settings/primitives.tsx` 实际签名为准；若不支持，把承载仓库显示改为只读说明文案（`<div>` 展示 repo 值），不传 `onChange`。

**Step 2: 验证**

```bash
bun test apps/electron/src/main/lib 2>&1 | tail -3
```

Expected: 主进程测试保持通过（渲染层无单测，UI 行为 Task 12 手动验证）。

**Step 3: Commit**

```bash
git add apps/electron/src/renderer/components/settings/FeedbackSettings.tsx
git commit --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>" -m "feat(settings): 反馈渠道配置改为 GitHub PAT + Notion 迁移提示"
```

---

## Task 9: FeedbackDialog 公开提示与草稿列表 + FeedbackSection 文案

**Files:**
- Modify: `apps/electron/src/renderer/components/feedback/FeedbackDialog.tsx`（7 处定点编辑）
- Modify: `apps/electron/src/renderer/components/discover/FeedbackSection.tsx`（1 处文案）

**Step 1: FeedbackDialog 定点编辑**

按顺序执行以下编辑（oldText 均为当前文件原文，逐一精确匹配）：

**编辑 1 — 图标导入：**

old:
```tsx
import { Bug, Camera, ImagePlus, Lightbulb, Loader2, Mail, Settings2, X } from 'lucide-react'
```
new:
```tsx
import { Bug, Camera, FileText, ImagePlus, Lightbulb, Loader2, Mail, Settings2, Trash2, X } from 'lucide-react'
```

**编辑 2 — shared 类型导入：**

old:
```tsx
import {
  FEEDBACK_DESCRIPTION_MAX_LENGTH,
  FEEDBACK_MAX_SCREENSHOTS,
  type FeedbackType,
} from '@myyoda/shared'
```
new:
```tsx
import {
  FEEDBACK_DESCRIPTION_MAX_LENGTH,
  FEEDBACK_MAX_SCREENSHOTS,
  type FeedbackDraftItem,
  type FeedbackType,
} from '@myyoda/shared'
```

**编辑 3 — 新增草稿 state（configured state 之后）：**

old:
```tsx
  const [configured, setConfigured] = React.useState<boolean | null>(null)
```
new:
```tsx
  const [configured, setConfigured] = React.useState<boolean | null>(null)
  const [drafts, setDrafts] = React.useState<FeedbackDraftItem[]>([])
```

**编辑 4 — 打开时加载草稿（open effect 内）：**

old:
```tsx
    setConfigured(null)
    window.electronAPI
      .feedbackGetConfig()
      .then((config) => setConfigured(config.configured))
      .catch(() => setConfigured(false))
  }, [open])
```
new:
```tsx
    setConfigured(null)
    window.electronAPI
      .feedbackGetConfig()
      .then((config) => setConfigured(config.configured))
      .catch(() => setConfigured(false))
    void window.electronAPI
      .feedbackListDrafts()
      .then(setDrafts)
      .catch(() => setDrafts([]))
  }, [open])
```

**编辑 5 — 草稿辅助函数（resetForm 之后插入）：**

old:
```tsx
  const handleOpenChange = (next: boolean): void => {
```
new:
```tsx
  const refreshDrafts = React.useCallback(async (): Promise<void> => {
    try {
      setDrafts(await window.electronAPI.feedbackListDrafts())
    } catch {
      setDrafts([])
    }
  }, [])

  /** 载入草稿到表单（截图文件可能已被清理，不恢复；只恢复文字内容） */
  const loadDraft = (draft: FeedbackDraftItem): void => {
    setType(draft.input.type)
    setDescription(draft.input.description)
    if (draft.input.contactEmail?.trim()) {
      setContactEmail(draft.input.contactEmail.trim())
      setShowContact(true)
    }
    setShots([])
  }

  const removeDraft = async (fileName: string): Promise<void> => {
    try {
      const ok = await window.electronAPI.feedbackDeleteDraft(fileName)
      if (ok) await refreshDrafts()
    } catch {
      // 删除失败静默（下次打开会重读）
    }
  }

  const handleOpenChange = (next: boolean): void => {
```

**编辑 6 — 提交成功分支文案与提示：**

old:
```tsx
      if (result.success) {
        toast.success('感谢你的反馈，已提交到 Notion')
        setOpen(false)
        resetForm()
      } else if (result.draftSaved) {
```
new:
```tsx
      if (result.success) {
        toast.success('感谢你的反馈，已提交到 GitHub Issues')
        if (result.duplicate) toast.info('该反馈此前已提交过相同内容')
        if (result.screenshotsSkipped) toast.warning('部分截图上传失败，已按纯文字提交')
        setOpen(false)
        resetForm()
        void refreshDrafts()
      } else if (result.draftSaved) {
```

**编辑 7 — 草稿区块与公开提示（「未配置提示」注释为锚点）：**

old:
```tsx
            {/* 未配置提示 */}
```
new:
```tsx
            {/* 本地草稿 */}
            {drafts.length > 0 && (
              <div className="mt-4 rounded-xl border border-border/70 px-3 py-2.5">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <FileText size={14} className="text-muted-foreground" />
                  本地草稿（{drafts.length}）
                </div>
                <div className="mt-2 space-y-1.5">
                  {drafts.map((draft) => (
                    <div
                      key={draft.fileName}
                      className="flex items-center justify-between gap-2 rounded-lg bg-accent/40 px-2.5 py-1.5"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-xs text-foreground/80">
                          {draft.legacy ? '[旧格式] ' : ''}
                          {draft.input.type === 'bug' ? 'Bug' : '建议'}：{draft.input.description.slice(0, 30) || '（无描述）'}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {draft.createdAt.slice(0, 16).replace('T', ' ')}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {!draft.legacy && (
                          <button
                            type="button"
                            onClick={() => loadDraft(draft)}
                            className="rounded-lg border border-border/70 px-2 py-1 text-[11px] text-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
                          >
                            载入
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void removeDraft(draft.fileName)}
                          aria-label="删除草稿"
                          className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 未配置提示 */}
```

**编辑 8 — 未配置文案：**

old:
```tsx
                <span className="text-xs text-muted-foreground">尚未配置 Notion 提交渠道</span>
```
new:
```tsx
                <span className="text-xs text-muted-foreground">尚未配置 GitHub 凭证</span>
```

**编辑 9 — 公开可见提示（未配置块闭合后、底部操作前）：**

old:
```tsx
            )}
          </div>

          {/* 底部操作 */}
```
new:
```tsx
            )}

            {/* 公开可见提示 */}
            <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2.5 text-xs text-foreground/70">
              提交后 issue 与截图将在 GitHub 上公开可见
            </div>
          </div>

          {/* 底部操作 */}
```

**Step 2: FeedbackSection 文案**

old:
```tsx
              遇到问题或有好主意？反馈会直接进入我们的 Notion 数据库，附上截图和联系方式会帮助我们更快定位。
```
new:
```tsx
              遇到问题或有好主意？反馈会公开提交到 GitHub Issues（GeoffBao/MyYoda 仓库），附上截图和联系方式会帮助我们更快定位。
```

**Step 3: 验证**

```bash
bun test apps/electron/src/main/lib 2>&1 | tail -3
```

Expected: 主进程测试保持通过（渲染层无单测）。

**Step 4: Commit**

```bash
git add apps/electron/src/renderer/components/feedback/FeedbackDialog.tsx apps/electron/src/renderer/components/discover/FeedbackSection.tsx
git commit --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>" -m "feat(feedback): 弹窗公开提示、GitHub 文案与本地草稿列表"
```

---

## Task 10: Wiki atoms + WikiBrowser 组件 + HelpSection 重构

**Files:**
- Modify: `apps/electron/src/renderer/atoms/discover-atoms.ts`（追加 wiki atoms）
- Create: `apps/electron/src/renderer/components/discover/WikiBrowser.tsx`
- Modify: `apps/electron/src/renderer/components/discover/HelpSection.tsx`（追加在线文档区块）

**Step 1: discover-atoms 追加 wiki 状态**

导入行（`import type {` 块）追加 `WikiPageContent, WikiPagesResult`，文件末尾追加：

```ts
/** Wiki 在线文档 */
export const wikiPagesResultAtom = atom<WikiPagesResult>({
  tree: { nodes: [], fromSidebar: false },
  fetchedAt: 0,
  commitHash: '',
  fromCache: false,
})
export const wikiPagesLoadingAtom = atom(false)
/** 当前打开的页面名（null = 列表视图） */
export const wikiCurrentPageAtom = atom<string | null>(null)
export const wikiPageContentAtom = atom<WikiPageContent | null>(null)
export const wikiPageLoadingAtom = atom(false)
```

**Step 2: 创建 WikiBrowser.tsx**

```tsx
/**
 * WikiBrowser — 「帮助」tab 的在线文档浏览器
 *
 * - 列表：wiki 页面树（_Sidebar 层级缩进）+ 标题过滤 + 手动刷新
 * - 页面：应用内 markdown 渲染（复用 ReleaseNoteMarkdown），「在 GitHub 打开」外链
 * - 离线：刷新失败显示旧缓存 + 离线横幅；从未成功时给出错误与重试
 */
import * as React from 'react'
import { useAtom } from 'jotai'
import { toast } from 'sonner'
import { ArrowLeft, ChevronRight, CloudOff, ExternalLink, Loader2, RefreshCw, Search } from 'lucide-react'
import type { WikiPageNode } from '@myyoda/shared'
import {
  wikiCurrentPageAtom,
  wikiPageContentAtom,
  wikiPageLoadingAtom,
  wikiPagesLoadingAtom,
  wikiPagesResultAtom,
} from '@/atoms/discover-atoms'
import { ReleaseNoteMarkdown } from '@/components/settings/ReleaseNoteMarkdown'

/** 拍平页面树（搜索用） */
function flatten(nodes: WikiPageNode[]): WikiPageNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)])
}

/** 取正文首个一级标题（页面视图标题优先用，无则用文件名） */
function extractHeading(markdown: string): string | null {
  const match = /^#\s+(.+)$/m.exec(markdown)
  return match ? match[1].trim() : null
}

export function WikiBrowser(): React.ReactElement {
  const [result, setResult] = useAtom(wikiPagesResultAtom)
  const [loading, setLoading] = useAtom(wikiPagesLoadingAtom)
  const [current, setCurrent] = useAtom(wikiCurrentPageAtom)
  const [page, setPage] = useAtom(wikiPageContentAtom)
  const [pageLoading, setPageLoading] = useAtom(wikiPageLoadingAtom)
  const [query, setQuery] = React.useState('')

  const loadPages = React.useCallback(
    async (force: boolean): Promise<void> => {
      setLoading(true)
      try {
        const next = force
          ? await window.electronAPI.discoverRefreshWiki()
          : await window.electronAPI.discoverGetWikiPages(false)
        setResult(next)
      } catch {
        setResult((prev) => ({ ...prev, fromCache: true, error: '加载文档失败' }))
      } finally {
        setLoading(false)
      }
    },
    [setLoading, setResult],
  )

  // 首次挂载：读缓存并后台刷新；后台刷新发现新 commit 时提示并重读
  React.useEffect(() => {
    void loadPages(false)
    const unsubscribe = window.electronAPI.onWikiUpdated(() => {
      toast.info('帮助文档已更新')
      void loadPages(false)
    })
    return unsubscribe
  }, [loadPages])

  const openPage = async (node: WikiPageNode): Promise<void> => {
    setCurrent(node.name)
    setPage(null)
    setPageLoading(true)
    try {
      setPage(await window.electronAPI.discoverGetWikiPage(node.name))
    } catch {
      toast.error('页面加载失败，请稍后重试')
      setCurrent(null)
    } finally {
      setPageLoading(false)
    }
  }

  const backToList = (): void => {
    setCurrent(null)
    setPage(null)
  }

  // ===== 页面视图 =====
  if (current) {
    return (
      <div className="rounded-xl border border-border/60 bg-content-area p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={backToList}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft size={13} />
            返回文档列表
          </button>
          {page && (
            <a
              href={page.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              在 GitHub 打开
              <ExternalLink size={11} />
            </a>
          )}
        </div>
        {pageLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 size={16} className="animate-spin" />
          </div>
        ) : page ? (
          <div className="mt-3">
            <h2 className="mb-3 text-lg font-semibold">{extractHeading(page.markdown) ?? current}</h2>
            <ReleaseNoteMarkdown content={page.markdown.replace(/^#\s+.*$/m, '')} compact />
          </div>
        ) : null}
      </div>
    )
  }

  // ===== 列表视图 =====
  const allNodes = flatten(result.tree.nodes)
  const filtered = query.trim()
    ? allNodes.filter((node) => node.title.toLowerCase().includes(query.trim().toLowerCase()))
    : allNodes

  return (
    <div className="rounded-xl border border-border/60 bg-content-area p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 items-center gap-1.5 rounded-lg border border-border/70 bg-background px-2.5 py-1.5">
          <Search size={13} className="shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索文档标题"
            className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground/70"
          />
        </div>
        <button
          type="button"
          onClick={() => void loadPages(true)}
          disabled={loading}
          title="刷新文档"
          aria-label="刷新文档"
          className="rounded-lg border border-border/70 p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {result.fromCache && result.error && (
        <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-2.5 py-1.5 text-xs text-foreground/70">
          <CloudOff size={13} className="shrink-0 text-amber-500" />
          离线模式：显示上次缓存内容
        </div>
      )}

      {result.tree.nodes.length === 0 && !loading ? (
        <div className="mt-3 rounded-lg bg-accent/40 px-3 py-4 text-center text-xs text-muted-foreground">
          {result.error ?? '文档库还是空的：维护者还没有创建任何 wiki 页面'}
          <div className="mt-1 text-[10px] text-muted-foreground/70">可点击右上角刷新重试</div>
        </div>
      ) : (
        <div className="mt-2 space-y-0.5">
          {filtered.map((node) => (
            <button
              key={node.name}
              type="button"
              onClick={() => void openPage(node)}
              className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs text-foreground/75 transition-colors hover:bg-accent hover:text-foreground"
              style={{ paddingLeft: `${8 + node.depth * 14}px` }}
            >
              {node.depth > 0 && <ChevronRight size={11} className="shrink-0 text-muted-foreground/50" />}
              <span className="truncate">{node.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

**Step 3: HelpSection 追加在线文档区块**

lucide 导入（首行 import）追加 `BookMarked`；在组件根 div 的 `})}`（entries.map 结束）之后、根 `</div>` 之前插入：

```tsx
      <div className="mt-3 border-t border-border/60 pt-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground/80">
          <BookMarked size={14} className="text-muted-foreground" />
          在线文档
          <span className="text-[11px] font-normal text-muted-foreground">来自 GitHub Wiki，维护者在线更新</span>
        </div>
        <WikiBrowser />
      </div>
```

并在文件顶部新增 `import { WikiBrowser } from './WikiBrowser'`。

**Step 4: 验证**

```bash
bun test apps/electron/src/main/lib 2>&1 | tail -3
```

Expected: 主进程测试保持通过。

**Step 5: Commit**

```bash
git add apps/electron/src/renderer/atoms/discover-atoms.ts apps/electron/src/renderer/components/discover/WikiBrowser.tsx apps/electron/src/renderer/components/discover/HelpSection.tsx
git commit --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>" -m "feat(discover): 帮助 tab 接入 Wiki 在线文档浏览"
```

---

## Task 11: Notion 残留清理 + 全量回归

**Files:**
- Modify: 清理残留 Notion 引用（grep 结果逐一处理）
- 不删除历史设计文档 `docs/luxcoder/05-feedback-to-notion-design.md`（保留作历史参考）

**Step 1: 搜索残留**

```bash
grep -rn "Notion\|NOTION" apps/electron/src packages/shared/src --include=*.ts --include=*.tsx | grep -viE "legacyNotionDetected|旧 Notion|Notion 旧格式|notion" || true
```

Expected: 只剩以下允许保留的迁移相关引用：
- `FeedbackSettings.tsx` 的迁移提示（`legacyNotionDetected`、旧 Notion 字段说明）
- `feedback-service.ts` 的 `FeedbackConfigFile.databaseId` 注释与 `getFeedbackConfigPublic.legacyNotionDetected`
- `FeedbackDialog.tsx` 草稿「旧格式」标签相关（若有）

若发现其他残留（如 `FeedbackNotionConfig` 导入、`FEEDBACK_TYPE_NOTION_VALUE`、`Notion-Version` 头、`api.notion.com`），逐一删除或改写为 GitHub 语义，直到 grep 结果收敛到上述白名单。

**Step 2: 全量 typecheck**

```bash
bun run typecheck 2>&1 | tail -10
```

Expected: 全部 7 个包 `Exited with code 0`。若有错误，按报错文件逐一修复（常见：旧类型引用、`feedbackGetConfig` 返回类型不匹配、`SettingsInput` 缺少 `disabled` 属性——按 Task 8 注记改为只读文案）。

**Step 3: 全量测试**

```bash
bun test 2>&1 | tail -6
```

Expected: `1586 + 新增（wiki-pages 9 + feedback-format 10 + wiki-service 6 ≈ 25）pass`，`0 fail`。

**Step 4: Commit**

```bash
git add -A
git commit --trailer "Co-Authored-By: MyYoda <MyYoda@noreply.github.com>" -m "refactor(feedback): 清理 Notion 残留，全量 typecheck 与测试回归通过"
```

---

## Task 12: 手动验证清单（真实环境）

> 需要真实的 fine-grained PAT 与网络环境；每项验证后打勾。

**反馈链路：**

1. `gh api repos/GeoffBao/MyYoda --jq .id` 记录仓库 id（供对照 user-attachments 请求）
2. 设置 → 意见反馈：填入仅授 `Issues: Read and write` 于 GeoffBao/MyYoda 的 PAT → 测试连接 → 应显示「凭证有效」
3. 故意填一个错误 token → 测试连接 → 应显示「Token 无效或已失效」
4. 「发现」→ 反馈 tab → 提交反馈：填描述 + 截屏 1 张 + 上传 1 张 → 提交 → toast 成功，附 issue 链接
5. 打开该 issue：标题 `[Bug 报告] ...`、正文含环境信息块与两张截图、label `bug` 存在（若仓库无 label 则无 label）
6. 重复提交相同描述 → 提交成功但出现「已提交过相同内容」提示；测试 issue 用完即 Close
7. 断网（或改错误代理）提交 → 失败 toast + 草稿保存；重开弹窗 → 草稿列表出现条目 → 「载入」回填表单、「删除」移除
8. 未配置 token 时打开弹窗 → 提交按钮置灰 + 「尚未配置 GitHub 凭证」提示 + 跳设置
9. 弹窗内可见「提交后 issue 与截图将在 GitHub 上公开可见」提示行

**Wiki 链路：**

10. 在 `GeoffBao/MyYoda` wiki 创建 `Home.md`（标题 + 一段正文 + 一张相对路径图片）与 `_Sidebar.md`（两层条目）
11. 打开「帮助」tab → 在线文档区块出现页面树（层级缩进正确）→ 点开 Home → 正文渲染、图片经代理可显示 → 「在 GitHub 打开」跳 wiki 网页
12. 网页上修改 Home 正文 → 应用内点刷新按钮 → 内容更新；或切走再切回帮助 tab 触发后台刷新 → toast「帮助文档已更新」
13. 断网重开帮助 tab → 显示上次缓存 + 「离线模式」横幅
14. 删除本地 `~/.myyoda/discover/wiki-cache` 后断网打开 → 错误提示 + 刷新按钮可重试
15. 标题过滤：输入关键字 → 列表只显示匹配项

**回归：**

16. 官方精选 / 社区讨论两个 tab 行为不变（列表、视频、讨论详情）
17. 「更新日志与帮助」弹层的反馈入口仍能打开弹窗

---

## 执行方式（writing-plans 收尾）

计划已保存。执行时使用 superpowers:executing-plans 逐任务实施；每个任务完成后更新本文件对应任务的勾选状态（在任务标题后追加 ` ✅`）。

**参考：**
- Spec: `docs/superpowers/specs/2026-08-17-discover-feedback-github-issues-wiki-design.md`
- 模式范本：`community-service.ts`（服务结构）、`content-service.ts`（缓存/单飞）、`media-rewrite.ts`（媒体重写）
- 分支：`feature/discover-feedback-github-wiki`（worktree `.worktrees/2f9a2e70-discover-feedback-github-wiki`）
