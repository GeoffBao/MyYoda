/**
 * Release Notes 纯函数工具
 *
 * 版本文件名的解析与 semver 比较。纯函数，主进程 / 渲染进程均可复用。
 */

/** 从版本文件名解析出版本号（如 "0.1.94.md" → "0.1.94"） */
export function parseReleaseVersion(filename: string): string {
  return filename.replace(/\.md$/, '')
}

/** 比较两个 semver 版本串（降序，新版本在前） */
export function compareReleaseSemver(a: string, b: string): number {
  const pa = a.split('.').map((s) => {
    const n = Number(s)
    return Number.isNaN(n) ? 0 : n
  })
  const pb = b.split('.').map((s) => {
    const n = Number(s)
    return Number.isNaN(n) ? 0 : n
  })
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0
    const db = pb[i] ?? 0
    if (da !== db) return db - da
  }
  return 0
}

/** 判断某版本号是否「更旧」于参考版本（用于未读红点判定） */
export function isOlderThan(candidate: string, reference: string): boolean {
  return compareReleaseSemver(candidate, reference) > 0
}

/** headline 最大展示长度，超出截断加省略号 */
const HEADLINE_MAX_LENGTH = 36

/** 去除 markdown 行内标记（粗体/行内代码/链接），只保留纯文本 */
function stripInlineMarkdown(line: string): string {
  return line
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .trim()
}

/** 固定章节标题（跳过，不作为摘要） */
const SECTION_HEADINGS = new Set([
  '新功能',
  '功能',
  '修复',
  'Bug 修复',
  '优化',
  '改进',
  '其他改进',
  '体验优化',
  '体验改进',
  '体验升级',
  '界面与体验',
  '效率与体验',
  '效率提升',
  '性能优化',
  '性能',
  '全新体验',
  '其他',
  '其它调整',
  '下载',
  '模型',
  '渠道与模型',
  '平台与稳定性',
  '语音输入',
  '交互与界面',
  '交互与体验',
  '安全',
  '依赖更新',
  '设置',
  '项目与看板',
  'Task 日历',
  '任务日历',
  '文件与 Outbox',
  '文件与项目',
  '文件与项目体验',
  '命名与设置整理',
  '主题与界面',
  '项目文件',
  'Agent 与 Skill',
  'Agent 与技能',
  '已知问题',
  '兼容性',
  '移除',
  '弃用',
  '迁移',
  '文档',
  'Features',
  'New Features',
  'Fixes',
  'Improvements',
  'Other',
  'Download',
  'Known Issues',
  'Breaking Changes',
  'Migration',
  'Documentation',
  'Changelog',
])

/** 固定章节标题前缀（如「macOS 打开说明」系列） */
const SECTION_HEADING_PREFIXES = [
  'macOS 打开说明',
  'macOS打开说明',
  '安装说明',
  '注意事项',
  'Windows 说明',
]

/** 是否为固定章节标题（不作为摘要候选） */
function isSectionHeading(title: string): boolean {
  if (SECTION_HEADINGS.has(title)) return true
  return SECTION_HEADING_PREFIXES.some((prefix) => title.startsWith(prefix))
}

/**
 * 从版本更新正文提取一句话摘要，供「最新动态」列表展示。
 *
 * 优先级：
 * 1. 第一个「非固定章节」的二级标题（`## `），如「品牌视觉：…」；
 *    固定章节（新功能 / 修复 / 下载 / 界面与体验 / macOS 打开说明…）会被跳过；
 * 2. 若二级标题全是固定章节，取第一个三级标题（`### `）的具体功能点；
 * 3. 再取第一个列表项加粗（`- **功能点**`）文本；
 * 4. 兜底取首个非空、非标题正文行。
 *
 * 都没有则返回空串（调用方自行兜底为 `vX.Y.Z 更新`）。
 */
export function extractReleaseHeadline(content: string): string {
  const lines = content.split('\n')
  let h3Headline = ''
  let boldCandidate = ''
  let fallback = ''

  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('# ')) continue

    if (line.startsWith('## ')) {
      const title = stripInlineMarkdown(line.slice(3))
      if (!title) continue
      if (!isSectionHeading(title)) return truncateHeadline(title)
      continue
    }

    if (line.startsWith('### ')) {
      if (!h3Headline) {
        const title = stripInlineMarkdown(line.slice(4))
        if (title) h3Headline = truncateHeadline(title)
      }
      continue
    }

    // 列表项加粗（`- **功能点**：描述`）作为兜底摘要
    if (!boldCandidate) {
      const boldMatch = line.match(/^[-*]\s*\*\*(.+?)\*\*\s*[:：]?/)
      if (boldMatch) {
        const boldText = boldMatch[1]
        if (boldText) {
          const title = boldText.trim()
          if (title) {
            boldCandidate = truncateHeadline(title)
            continue
          }
        }
      }
    }

    if (!fallback && !line.startsWith('#')) {
      fallback = stripInlineMarkdown(line.replace(/^[-*]\s*/, ''))
    }
  }

  if (h3Headline) return h3Headline
  if (boldCandidate) return boldCandidate
  return fallback ? truncateHeadline(fallback) : ''
}

function truncateHeadline(text: string): string {
  if (text.length <= HEADLINE_MAX_LENGTH) return text
  return `${text.slice(0, HEADLINE_MAX_LENGTH - 1)}…`
}
