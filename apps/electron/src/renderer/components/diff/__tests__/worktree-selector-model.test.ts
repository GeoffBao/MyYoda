import { describe, expect, test } from 'bun:test'
import type { WorktreeInfo } from '@myyoda/shared'
import {
  isDetached,
  shouldCollapseDetached,
  sortWorktreesForSelector,
  worktreeDisplayName,
} from '../worktree-selector-model'

function makeWorktree(overrides: Partial<WorktreeInfo>): WorktreeInfo {
  return {
    path: `/repo/.worktrees/${overrides.name ?? 'wt'}`,
    branch: 'feat/sample',
    head: 'abc1234',
    isMain: false,
    name: overrides.name ?? 'wt',
    ...overrides,
  }
}

const named = makeWorktree({ name: 'agent-experts-teams', branch: 'feat/agent-experts-teams' })
const named2 = makeWorktree({ name: 'p1a-branding', branch: 'myyoda/branding' })
const detachedA = makeWorktree({ name: 'cranky-mccarthy-d473c5', branch: '(detached)', head: 'afcb12c' })
const detachedB = makeWorktree({ name: '155b5997-main', branch: '(detached)', head: 'b7d1ec1' })

describe('worktree-selector-model', () => {
  test('isDetached 只在 branch 为 (detached) 时成立', () => {
    expect(isDetached(named)).toBe(false)
    expect(isDetached(detachedA)).toBe(true)
  })

  test('worktreeDisplayName：有分支用分支名，detached 用目录名', () => {
    expect(worktreeDisplayName(named)).toBe('feat/agent-experts-teams')
    expect(worktreeDisplayName(detachedA)).toBe('cranky-mccarthy-d473c5')
  })

  test('sortWorktreesForSelector：有分支的在前，detached 在后，同类按目录名排序', () => {
    const sorted = sortWorktreesForSelector([detachedB, named2, detachedA, named])
    expect(sorted.map((wt) => wt.name)).toEqual([
      'agent-experts-teams',
      'p1a-branding',
      '155b5997-main',
      'cranky-mccarthy-d473c5',
    ])
  })

  test('shouldCollapseDetached：detached 超过 1 个才折叠', () => {
    expect(shouldCollapseDetached([named, named2])).toBe(false)
    expect(shouldCollapseDetached([named, detachedA])).toBe(false)
    expect(shouldCollapseDetached([named, detachedA, detachedB])).toBe(true)
  })

  test('commitSubject 字段不影响判定逻辑', () => {
    const withSubject = makeWorktree({
      name: 'sleepy-bell-0e1168',
      branch: '(detached)',
      commitSubject: 'fix(ui): 置顶按钮错误处理',
    })
    expect(isDetached(withSubject)).toBe(true)
    expect(worktreeDisplayName(withSubject)).toBe('sleepy-bell-0e1168')
  })
})
