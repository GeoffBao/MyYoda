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
