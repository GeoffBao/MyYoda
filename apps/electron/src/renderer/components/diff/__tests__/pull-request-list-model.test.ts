import { describe, expect, test } from 'bun:test'
import type { PullRequestListEntry } from '@myyoda/shared'
import {
  filterByInvolvement,
  filterBySearch,
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

describe('pull-request-list-model: filterByInvolvement', () => {
  const viewer = 'eason'
  const reviewing = makeEntry({ number: 1, viewerReviewRequested: true })
  const authored = makeEntry({ number: 2, author: { login: 'eason', name: null, avatarUrl: null, url: null } })
  const others = makeEntry({ number: 3 })
  const entries = [reviewing, authored, others]

  test('all 返回全部', () => {
    expect(filterByInvolvement(entries, 'all', viewer)).toHaveLength(3)
  })

  test('reviewing 只保留待 review', () => {
    const filtered = filterByInvolvement(entries, 'reviewing', viewer)
    expect(filtered.map((e) => e.number)).toEqual([1])
  })

  test('authored 只保留我创建的', () => {
    const filtered = filterByInvolvement(entries, 'authored', viewer)
    expect(filtered.map((e) => e.number)).toEqual([2])
  })
})

describe('pull-request-list-model: filterBySearch', () => {
  const entries = [
    makeEntry({ number: 1, title: '修复浏览器缩放', headBranch: 'fix/browser-zoom', author: { login: 'alice', name: null, avatarUrl: null, url: null } }),
    makeEntry({ number: 2, title: '新增 PR 流程', headBranch: 'feat/pr-workflow', repositoryName: 'repo-a', author: { login: 'bob', name: null, avatarUrl: null, url: null } }),
    makeEntry({ number: 35, title: '环境 PATH 加固', headBranch: 'fix/env-path', author: { login: 'eason', name: null, avatarUrl: null, url: null } }),
  ]

  test('空查询返回全部', () => {
    expect(filterBySearch(entries, '')).toHaveLength(3)
  })

  test('按标题搜索', () => {
    expect(filterBySearch(entries, '浏览器').map((e) => e.number)).toEqual([1])
  })

  test('按编号搜索', () => {
    expect(filterBySearch(entries, '35').map((e) => e.number)).toEqual([35])
  })

  test('按分支搜索', () => {
    expect(filterBySearch(entries, 'pr-workflow').map((e) => e.number)).toEqual([2])
  })

  test('按作者搜索', () => {
    expect(filterBySearch(entries, 'eason').map((e) => e.number)).toEqual([35])
  })

  test('无匹配返回空', () => {
    expect(filterBySearch(entries, 'zzz')).toHaveLength(0)
  })
})
