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
  /** done 时有效：本地缓存文件绝对路径（经 GET_VIDEO_URL 换播放 URL） */
  filePath?: string
  error?: string
}

/** 视频下载进度事件（主进程 → 渲染层推送） */
export interface VideoDownloadProgressEvent {
  itemId: string
  progress: number
}

/** 下载完成事件：filePath 为本地缓存绝对路径，渲染层经 GET_VIDEO_URL 换 myyoda-file:// URL */
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

/** 社区列表拉取结果（错误/限流时 error 有值） */
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
} as const
