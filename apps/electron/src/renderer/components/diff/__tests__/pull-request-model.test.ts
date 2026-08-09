import { describe, expect, test } from 'bun:test'
import type { CurrentBranchPullRequest, GitPrStatus, GhCliStatus } from '@myyoda/shared'
import {
  checksSummaryLabel,
  defaultPullRequestTitle,
  resolvePullRequestPrimaryAction,
} from '../pull-request-model'

function makeGh(overrides: Partial<GhCliStatus> = {}): GhCliStatus {
  return { installed: true, authenticated: true, login: 'eason', ...overrides }
}

function makeGit(overrides: Partial<GitPrStatus> = {}): GitPrStatus {
  return {
    branch: 'feat/pr-workflow',
    isDefaultBranch: false,
    hasUpstream: true,
    aheadCount: 2,
    behindCount: 0,
    hasOriginRemote: true,
    hasChanges: false,
    repoPath: '/repo',
    ...overrides,
  }
}

function makePr(overrides: Partial<CurrentBranchPullRequest> = {}): CurrentBranchPullRequest {
  return {
    repoPath: '/repo',
    number: 123,
    title: 'PR 标题',
    url: 'https://github.com/x/y/pull/123',
    isDraft: false,
    state: 'open',
    checksSummary: { pending: 0, success: 1, failure: 0 },
    ...overrides,
  }
}

describe('pull-request-model: resolvePullRequestPrimaryAction', () => {
  test('gh 未安装 → gh_setup 禁用 + 安装 hint', () => {
    const action = resolvePullRequestPrimaryAction({ gh: { installed: false, authenticated: false }, git: makeGit(), currentBranchPr: null })
    expect(action.kind).toBe('gh_setup')
    expect(action.disabled).toBe(true)
    expect(action.hint).toContain('gh')
  })

  test('gh 未登录 → gh_setup 禁用 + 登录 hint', () => {
    const action = resolvePullRequestPrimaryAction({ gh: makeGh({ authenticated: false }), git: makeGit(), currentBranchPr: null })
    expect(action.kind).toBe('gh_setup')
    expect(action.hint).toContain('gh auth login')
  })

  test('非 Git 目录 → disabled', () => {
    const action = resolvePullRequestPrimaryAction({ gh: makeGh(), git: makeGit({ repoPath: null }), currentBranchPr: null })
    expect(action.kind).toBe('disabled')
  })

  test('detached HEAD → disabled + detached hint', () => {
    const action = resolvePullRequestPrimaryAction({ gh: makeGh(), git: makeGit({ branch: null }), currentBranchPr: null })
    expect(action.kind).toBe('disabled')
    expect(action.hint).toContain('detached')
  })

  test('已有 open PR → view_pr 可点击', () => {
    const action = resolvePullRequestPrimaryAction({ gh: makeGh(), git: makeGit(), currentBranchPr: makePr() })
    expect(action.kind).toBe('view_pr')
    expect(action.disabled).toBe(false)
    expect(action.label).toBe('查看 PR')
  })

  test('分支落后远程 → sync_needed 禁用', () => {
    const action = resolvePullRequestPrimaryAction({ gh: makeGh(), git: makeGit({ behindCount: 3 }), currentBranchPr: null })
    expect(action.kind).toBe('sync_needed')
    expect(action.disabled).toBe(true)
  })

  test('默认分支有改动 → default_branch_guide 可点击', () => {
    const action = resolvePullRequestPrimaryAction({ gh: makeGh(), git: makeGit({ isDefaultBranch: true, hasChanges: true }), currentBranchPr: null })
    expect(action.kind).toBe('default_branch_guide')
    expect(action.disabled).toBe(false)
  })

  test('默认分支无改动 → default_branch_guide 禁用', () => {
    const action = resolvePullRequestPrimaryAction({ gh: makeGh(), git: makeGit({ isDefaultBranch: true, hasChanges: false, aheadCount: 0 }), currentBranchPr: null })
    expect(action.kind).toBe('default_branch_guide')
    expect(action.disabled).toBe(true)
  })

  test('无 origin → disabled + origin hint', () => {
    const action = resolvePullRequestPrimaryAction({ gh: makeGh(), git: makeGit({ hasOriginRemote: false }), currentBranchPr: null })
    expect(action.kind).toBe('disabled')
    expect(action.hint).toContain('origin')
  })

  test('分支超前且有 upstream → push_and_create_pr', () => {
    const action = resolvePullRequestPrimaryAction({ gh: makeGh(), git: makeGit(), currentBranchPr: null })
    expect(action.kind).toBe('push_and_create_pr')
    expect(action.disabled).toBe(false)
    expect(action.label).toBe('Push & create PR')
  })

  test('分支已推送无 ahead 但未建 PR → push_and_create_pr（push 幂等）', () => {
    const action = resolvePullRequestPrimaryAction({ gh: makeGh(), git: makeGit({ aheadCount: 0, hasUpstream: true, hasChanges: false }), currentBranchPr: null })
    expect(action.kind).toBe('push_and_create_pr')
  })

  test('未推送分支、无 ahead、无改动 → disabled + no-changes hint', () => {
    const action = resolvePullRequestPrimaryAction({ gh: makeGh(), git: makeGit({ aheadCount: 0, hasUpstream: false, hasChanges: false }), currentBranchPr: null })
    expect(action.kind).toBe('disabled')
    expect(action.hint).toContain('没有可推送')
  })
})

describe('pull-request-model: defaultPullRequestTitle', () => {
  test('去掉 feat/ 前缀并转可读标题', () => {
    expect(defaultPullRequestTitle('feat/pr-workflow')).toBe('Pr Workflow')
    expect(defaultPullRequestTitle('fix/browser-zoom')).toBe('Browser Zoom')
  })

  test('空分支名返回 Untitled', () => {
    expect(defaultPullRequestTitle(null)).toBe('Untitled PR')
  })
})

describe('pull-request-model: checksSummaryLabel', () => {
  test('有成功/失败/等待时生成徽标文本', () => {
    expect(checksSummaryLabel({ pending: 1, success: 2, failure: 1 })).toContain('✓ 2')
    expect(checksSummaryLabel({ pending: 1, success: 2, failure: 1 })).toContain('✗ 1')
    expect(checksSummaryLabel({ pending: 1, success: 2, failure: 1 })).toContain('… 1')
  })

  test('全零返回 null', () => {
    expect(checksSummaryLabel({ pending: 0, success: 0, failure: 0 })).toBeNull()
  })

  test('undefined 返回 null', () => {
    expect(checksSummaryLabel(undefined)).toBeNull()
  })
})
