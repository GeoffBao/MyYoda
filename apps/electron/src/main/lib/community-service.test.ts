import { describe, expect, test } from 'bun:test'
import { computeHasNewReplies, DISCUSSION_CACHE_TTL_MS, parseDiscussionDetail, parseDiscussionList } from './community-service'

// fixture 取自 GET /repos/{owner}/{repo}/discussions 真实字段（精简）
const LIST_FIXTURE = [
  {
    number: 1,
    title: '如何配置 DeepSeek 渠道？',
    user: { login: 'alice', avatar_url: 'https://a.com/1.png' },
    category: { slug: 'q-a', name: 'Q&A' },
    comments: 3,
    answers: [{ is_answer: true }, { is_answer: false }],
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-02T00:00:00Z',
    labels: [{ name: '求助' }],
  },
]

describe('parseDiscussionList', () => {
  test('解析列表条目与分类映射', () => {
    const [item] = parseDiscussionList(LIST_FIXTURE)
    expect(item).toBeDefined()
    if (!item) return
    expect(item.number).toBe(1)
    expect(item.title).toBe('如何配置 DeepSeek 渠道？')
    expect(item.author).toBe('alice')
    expect(item.authorAvatarUrl).toBe('https://a.com/1.png')
    expect(item.commentCount).toBe(3)
    expect(item.isAnswered).toBe(true)
    expect(item.categorySlug).toBe('q-a')
    expect(item.labels).toEqual(['求助'])
  })

  test('非数组输入返回空数组', () => {
    expect(parseDiscussionList({})).toEqual([])
    expect(parseDiscussionList(null)).toEqual([])
  })

  test('未知板块 slug 的条目被过滤', () => {
    const unknown = [{ ...LIST_FIXTURE[0], category: { slug: 'general', name: 'General' } }]
    expect(parseDiscussionList(unknown)).toEqual([])
  })
})

describe('parseDiscussionDetail', () => {
  test('合并正文 markdown', () => {
    const detail = parseDiscussionDetail({ ...LIST_FIXTURE[0], body: '# 正文' })
    expect(detail.bodyMarkdown).toBe('# 正文')
    expect(detail.title).toBe('如何配置 DeepSeek 渠道？')
  })
})

describe('computeHasNewReplies', () => {
  test('看过之后评论数增加 → 有新增回复', () => {
    expect(computeHasNewReplies(5, { viewedCommentCount: 3 })).toBe(true)
  })

  test('评论数未变或减少 → 无新增', () => {
    expect(computeHasNewReplies(3, { viewedCommentCount: 3 })).toBe(false)
    expect(computeHasNewReplies(2, { viewedCommentCount: 3 })).toBe(false)
  })

  test('从未打开过（无已读记录）→ 不标记', () => {
    expect(computeHasNewReplies(5, undefined)).toBe(false)
  })
})

describe('DISCUSSION_CACHE_TTL_MS', () => {
  test('缓存有效期 5 分钟', () => {
    expect(DISCUSSION_CACHE_TTL_MS).toBe(5 * 60 * 1000)
  })
})
