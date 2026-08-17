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
