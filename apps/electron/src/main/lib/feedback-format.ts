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
