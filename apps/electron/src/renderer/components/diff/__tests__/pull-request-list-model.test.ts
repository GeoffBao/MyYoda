import { describe, expect, test } from 'bun:test'
import type { PullRequestListEntry } from '@myyoda/shared'
import {
  formatPrListCount,
  groupPullRequests,
  isAuthoredByViewer,
  isReviewingForViewer,
} from '../pull-request-list-model'

function makeEntry(overrides: Partial<PullRequestListEntry>): PullRequestListEntry {
  return {
    repository: '/repo',
    repositoryName: 'repo',
    number: 1,
    title: 'PR',
    url: 'https://github.com/x/repo/pull/1',
    author: { login: 'alice', name: null, avatarUrl: null, url: null },
    headBranch: 'feat/a',
    baseBranch: 'main',
    state: 'open',
    isDraft: false,
    additions: 1,
    deletions: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    reviewDecision: null,
    viewerReviewRequested: false,
    labels: [],
    ...overrides,
  }
}

describe('pull-request-list-model', () => {
  const viewer = 'eason'

  test('isReviewingForViewer：viewerReviewRequested 命中', () => {
    expect(isReviewingForViewer(makeEntry({ viewerReviewRequested: true }), viewer)).toBe(true)
    expect(isReviewingForViewer(makeEntry({ viewerReviewRequested: false }), viewer)).toBe(false)
  })

  test('isReviewingForViewer：reviewDecision 兜底（REVIEW_REQUIRED / CHANGES_REQUESTED）', () => {
    expect(isReviewingForViewer(makeEntry({ reviewDecision: 'REVIEW_REQUIRED' }), viewer)).toBe(true)
    expect(isReviewingForViewer(makeEntry({ reviewDecision: 'CHANGES_REQUESTED' }), viewer)).toBe(true)
    expect(isReviewingForViewer(makeEntry({ reviewDecision: 'APPROVED' }), viewer)).toBe(false)
  })

  test('isReviewingForViewer：viewer 为空永远 false', () => {
    expect(isReviewingForViewer(makeEntry({ viewerReviewRequested: true }), null)).toBe(false)
  })

  test('isAuthoredByViewer：作者匹配', () => {
    expect(isAuthoredByViewer(makeEntry({ author: { login: 'eason', name: null, avatarUrl: null, url: null } }), viewer)).toBe(true)
    expect(isAuthoredByViewer(makeEntry({ author: { login: 'alice', name: null, avatarUrl: null, url: null } }), viewer)).toBe(false)
  })

  test('groupPullRequests：reviewing 优先，authored 其次，其余 others', () => {
    const reviewing = makeEntry({ number: 1, viewerReviewRequested: true })
    const authored = makeEntry({ number: 2, author: { login: 'eason', name: null, avatarUrl: null, url: null } })
    const others = makeEntry({ number: 3 })

    const groups = groupPullRequests([others, authored, reviewing], viewer)
    expect(groups[0]!.key).toBe('reviewing')
    expect(groups[0]!.entries.map((e) => e.number)).toEqual([1])
    expect(groups[1]!.key).toBe('authored')
    expect(groups[1]!.entries.map((e) => e.number)).toEqual([2])
    expect(groups[2]!.key).toBe('others')
    expect(groups[2]!.entries.map((e) => e.number)).toEqual([3])
  })

  test('groupPullRequests：空列表返回三个空组', () => {
    const groups = groupPullRequests([], viewer)
    expect(groups).toHaveLength(3)
    expect(groups.every((g) => g.entries.length === 0)).toBe(true)
  })

  test('formatPrListCount：>99 显示 99+', () => {
    expect(formatPrListCount(5)).toBe('5')
    expect(formatPrListCount(100)).toBe('99+')
  })
})
