import { describe, expect, test } from 'bun:test'
import { extractAnswerCommentId, parseDiscussionComments } from './community-service'

// fixture 取自 GET /repos/{owner}/{repo}/discussions/{n}/comments 真实字段（精简）
const COMMENTS_FIXTURE = [
  {
    id: 100,
    body: '顶层评论内容',
    user: { login: 'alice', avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4' },
    created_at: '2026-08-10T00:00:00Z',
    parent_id: null,
    child_comment_count: 2,
  },
  {
    id: 101,
    body: '对 100 的回复',
    user: { login: 'bob' },
    created_at: '2026-08-11T00:00:00Z',
    parent_id: 100,
    child_comment_count: 0,
  },
  {
    id: 102,
    body: '被采纳的答案',
    user: { login: 'carol' },
    created_at: '2026-08-12T00:00:00Z',
    parent_id: null,
    child_comment_count: 0,
  },
]

describe('extractAnswerCommentId', () => {
  test('从 answer_html_url 提取评论 id', () => {
    expect(extractAnswerCommentId('https://github.com/orgs/x/discussions/1#discussioncomment-102')).toBe(102)
  })

  test('无锚点返回 null', () => {
    expect(extractAnswerCommentId('https://github.com/orgs/x/discussions/1')).toBeNull()
    expect(extractAnswerCommentId(undefined)).toBeNull()
  })
})

describe('parseDiscussionComments', () => {
  test('解析评论与回复，标记被采纳答案', () => {
    const comments = parseDiscussionComments(COMMENTS_FIXTURE, 102)
    expect(comments).toHaveLength(3)
    const top = comments.find((c) => c.id === 100)
    const reply = comments.find((c) => c.id === 101)
    const answer = comments.find((c) => c.id === 102)
    expect(top?.parentId).toBeNull()
    expect(reply?.parentId).toBe(100)
    expect(answer?.isAnswer).toBe(true)
    expect(top?.author).toBe('alice')
    expect(reply?.authorAvatarUrl).toBeUndefined()
  })

  test('非数组输入返回空数组', () => {
    expect(parseDiscussionComments(null, null)).toEqual([])
    expect(parseDiscussionComments({}, null)).toEqual([])
  })

  test('未选答案时全部 isAnswer=false', () => {
    const comments = parseDiscussionComments(COMMENTS_FIXTURE, null)
    expect(comments.every((c) => !c.isAnswer)).toBe(true)
  })
})
