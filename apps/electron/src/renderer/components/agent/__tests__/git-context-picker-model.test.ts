import { describe, expect, test } from 'bun:test'
import type { GitBranchInfo } from '@myyoda/shared'
import {
  canCheckoutBranchInLocal,
  filterGitBranches,
  formatGitBranchSubtitle,
  getGitModeStorageKey,
  isSameBoundRepo,
  resolveInitialGitExecutionMode,
  resolveLocalSendBranch,
  sortGitBranchesForPicker,
} from '../git-context-picker-model'

const branches: GitBranchInfo[] = [
  { name: 'feature/zeta', ref: 'refs/heads/feature/zeta', local: true, current: false, head: 'bbb' },
  { name: 'main', ref: 'refs/heads/main', local: true, current: true, head: 'aaa' },
  { name: 'feature/alpha', ref: 'refs/heads/feature/alpha', local: true, current: false, head: 'ccc', checkedOutPath: '/repo/.worktrees/alpha' },
]

describe('git-context-picker-model', () => {
  test('Given mixed branches When sorting Then current branch stays first and names sort alphabetically', () => {
    expect(sortGitBranchesForPicker(branches).map((branch) => branch.name)).toEqual([
      'main',
      'feature/alpha',
      'feature/zeta',
    ])
  })

  test('Given search query When filtering branches Then matches case-insensitively by name', () => {
    expect(filterGitBranches(branches, 'ALP').map((branch) => branch.name)).toEqual(['feature/alpha'])
  })

  test('Given branch checked out in another worktree When formatting subtitle Then shows compact checkout directory name', () => {
    expect(formatGitBranchSubtitle(branches[2]!)).toBe('检出于 alpha')
  })

  test('Given current branch with checkedOutPath from main worktree When formatting subtitle Then current wins over occupancy', () => {
    const currentBranch: GitBranchInfo = {
      ...branches[1]!,
      checkedOutPath: '/repo',
    }
    expect(formatGitBranchSubtitle(currentBranch)).toBe('当前分支')
  })

  test('Given no initial nor remembered mode When resolving mode Then defaults to Local', () => {
    expect(resolveInitialGitExecutionMode({})).toBe('local')
  })

  test('Given remembered Worktree value When resolving mode Then restores Worktree', () => {
    expect(resolveInitialGitExecutionMode({ rememberedMode: 'worktree' })).toBe('worktree')
  })

  test('Given session-bound mode When resolving mode Then session binding wins over remembered value', () => {
    expect(resolveInitialGitExecutionMode({ initialMode: 'local', rememberedMode: 'worktree' })).toBe('local')
    expect(resolveInitialGitExecutionMode({ initialMode: 'worktree', rememberedMode: 'local' })).toBe('worktree')
  })

  test('Given invalid initial mode When resolving mode Then falls back to remembered value', () => {
    expect(resolveInitialGitExecutionMode({ initialMode: undefined, rememberedMode: 'worktree' })).toBe('worktree')
  })

  test('Given repo path When building storage key Then key is per-repo and strips trailing slashes', () => {
    expect(getGitModeStorageKey('/repo/project/')).toBe('myyoda:git:execution-mode:/repo/project')
  })

  test('Given same bound repo root When comparing Then matches', () => {
    expect(isSameBoundRepo('/repo', '/repo')).toBe(true)
    expect(isSameBoundRepo('/repo/', '/repo')).toBe(true)
  })

  test('Given workspace bound to subdirectory of the repo When comparing Then still matches', () => {
    expect(isSameBoundRepo('/repo', '/repo/apps/web')).toBe(true)
    expect(isSameBoundRepo('/repo', '/repo2')).toBe(false)
  })

  test('Given case differences in path When comparing bound repo Then matches case-insensitively', () => {
    expect(isSameBoundRepo('/Users/Admin/Workspace/Repo', '/users/admin/workspace/repo')).toBe(true)
  })

  test('Given branch occupied by another worktree When checking Local checkout Then unavailable', () => {
    expect(canCheckoutBranchInLocal(branches[2]!)).toBe(false)
    expect(canCheckoutBranchInLocal(branches[1]!)).toBe(true)
    expect(canCheckoutBranchInLocal(branches[0]!)).toBe(true)
  })

  test('Given Local default selection diverged from repo current branch When resolving send branch Then follows current branch', () => {
    expect(resolveLocalSendBranch({
      executionMode: 'local',
      branch: 'main',
      currentBranch: 'sync/upstream-20260817',
    })).toBe('sync/upstream-20260817')
  })

  test('Given Local explicit branch pick When resolving send branch Then keeps user selection', () => {
    expect(resolveLocalSendBranch({
      executionMode: 'local',
      branch: 'main',
      explicit: true,
      currentBranch: 'sync/upstream-20260817',
    })).toBe('main')
  })

  test('Given Local new-branch creation When resolving send branch Then keeps selection', () => {
    expect(resolveLocalSendBranch({
      executionMode: 'local',
      branch: 'feature/new',
      newBranchName: 'feature/new',
      currentBranch: 'main',
    })).toBe('feature/new')
  })

  test('Given Worktree mode When resolving send branch Then keeps selection regardless of current branch', () => {
    expect(resolveLocalSendBranch({
      executionMode: 'worktree',
      branch: 'main',
      currentBranch: 'feature/x',
    })).toBe('main')
  })

  test('Given detached HEAD (no current branch) When resolving send branch Then keeps selection', () => {
    expect(resolveLocalSendBranch({
      executionMode: 'local',
      branch: 'main',
      currentBranch: null,
    })).toBe('main')
  })

  test('Given detached HEAD reported as literal "HEAD" string When resolving send branch Then keeps selection', () => {
    // getGitRepoStatus 在 detached HEAD 时返回 'HEAD' 字符串（rev-parse --abbrev-ref HEAD），
    // 把 'HEAD' 当目标分支会让 prepare 的 git switch 直接 fatal，必须视为无当前分支
    expect(resolveLocalSendBranch({
      executionMode: 'local',
      branch: 'main',
      currentBranch: 'HEAD',
    })).toBe('main')
  })

  test('Given matching branches When resolving send branch Then no-op', () => {
    expect(resolveLocalSendBranch({
      executionMode: 'local',
      branch: 'main',
      currentBranch: 'main',
    })).toBe('main')
  })
})
