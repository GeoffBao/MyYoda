/**
 * 用户反馈（→ Notion）相关类型定义
 *
 * 反馈入口在「更新日志与帮助」弹层（ReleaseNotesPopover），
 * 提交到用户自己的 Notion 数据库（internal connection + database id 配置）。
 * Notion API 版本：2026-03-11（实测契约见 docs/luxcoder/05-feedback-to-notion-design.md）。
 */

/** 反馈类型 */
export type FeedbackType = 'bug' | 'feature'

/** 反馈类型对应的 Notion select 值 */
export const FEEDBACK_TYPE_NOTION_VALUE: Record<FeedbackType, string> = {
  bug: 'Bug 报告',
  feature: '功能建议',
}

/** 详细描述最大长度（对齐 newmax） */
export const FEEDBACK_DESCRIPTION_MAX_LENGTH = 5000

/** 截图最大张数（对齐 newmax） */
export const FEEDBACK_MAX_SCREENSHOTS = 5

/** 单张截图压缩目标上限（字节）。Notion 单段上传 ≤20MB，这里留足余量。 */
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
  /** Notion 条目 URL（成功时） */
  pageUrl?: string
  /** 失败原因（面向用户的中文描述） */
  error?: string
  /** 是否已保存本地草稿（提交失败时的降级） */
  draftSaved?: boolean
  /** 草稿文件路径 */
  draftPath?: string
}

/** 反馈渠道配置 */
export interface FeedbackNotionConfig {
  /** internal connection token（ntn_...，加密存储） */
  token?: string
  /** Notion 数据库 ID（页面 URL 中 32 位 id） */
  databaseId?: string
}

/** 连接测试结果 */
export interface FeedbackTestConnectionResult {
  success: boolean
  message: string
}

/** 本地草稿（提交失败时保存，供重试） */
export interface FeedbackDraft {
  version: 1
  createdAt: string
  input: FeedbackSubmitInput
  /** 应用版本（草稿重试时保留） */
  appVersion?: string
  platform?: string
}

/** 反馈 IPC 通道常量 */
export const FEEDBACK_IPC_CHANNELS = {
  /** 提交反馈到 Notion */
  SUBMIT: 'feedback:submit',
  /** 测试 Notion 连接（token + databaseId 是否有效） */
  TEST_CONNECTION: 'feedback:test-connection',
  /** 读取本地反馈渠道配置（token 不返回明文，只返回是否已配置） */
  GET_CONFIG: 'feedback:get-config',
  /** 保存反馈渠道配置 */
  SAVE_CONFIG: 'feedback:save-config',
  /** 截取当前应用窗口（弹窗自身自动隐藏），返回 PNG 文件路径 */
  CAPTURE_WINDOW: 'feedback:capture-window',
  /** 选择本地图片（压缩后返回预览 dataUrl + 提交用 filePath） */
  PICK_IMAGES: 'feedback:pick-images',
} as const
