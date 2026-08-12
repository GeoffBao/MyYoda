import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { normalizePathForCompare } from '@myyoda/shared/utils'
import type { AgentSessionMeta } from '@myyoda/shared'
import { assertWorktreeClean, listGitBranchesForSession, prepareSessionGitContext, removeSessionWorktree } from './git-session-context-service'

const roots: string[] = []

function sh(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  }).trim()
}

function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'myyoda-git-session-context-'))
  roots.push(root)
  sh(root, ['init', '-b', 'main'])
  sh(root, ['config', 'user.email', 'test@example.com'])
  sh(root, ['config', 'user.name', 'Test User'])
  writeFileSync(join(root, '.gitignore'), '*.secret\n', 'utf-8')
  writeFileSync(join(root, 'README.md'), '# Test\n', 'utf-8')
  sh(root, ['add', '.gitignore', 'README.md'])
  sh(root, ['commit', '-m', 'initial'])
  sh(root, ['branch', 'feature/alpha'])
  return root
}

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop()!
    rmSync(root, { recursive: true, force: true })
  }
})

describe('git-session-context-service', () => {
  test('Given repo branches and a checked-out worktree When listing branches Then marks current and occupied branches', () => {
    const repo = makeRepo()
    const repoRoot = sh(repo, ['rev-parse', '--show-toplevel'])
    const occupied = join(repoRoot, '.worktrees', 'alpha')
    sh(repo, ['worktree', 'add', occupied, 'feature/alpha'])

    const branches = listGitBranchesForSession({ repoPath: repo })

    expect(branches.find((branch) => branch.name === 'main')).toMatchObject({
      local: true,
      current: true,
    })
    expect(branches.find((branch) => branch.name === 'feature/alpha')).toMatchObject({
      local: true,
      current: false,
      checkedOutPath: occupied,
    })
  })

  test('Given a tag sharing the branch name When listing branches Then name stays the plain branch shorthand', () => {
    const repo = makeRepo()
    // git 的 %(refname:short) 在存在同名 tag 时会消歧义为 `heads/main`，
    // 但 `git switch`/`worktree add -b` 只接受纯短名，必须绕开这个消歧义。
    sh(repo, ['tag', 'main'])

    const branches = listGitBranchesForSession({ repoPath: repo })
    const mainBranch = branches.find((branch) => branch.local && branch.name === 'main')

    expect(mainBranch).toMatchObject({ local: true, current: true })
    expect(branches.some((branch) => branch.name === 'heads/main')).toBe(false)
  })

  test('Given a tag sharing the branch name When switching to it in Local mode Then succeeds without ambiguous-ref error', () => {
    const repo = makeRepo()
    sh(repo, ['tag', 'main'])
    sh(repo, ['switch', 'feature/alpha'])
    const branches = listGitBranchesForSession({ repoPath: repo })
    const mainBranch = branches.find((branch) => branch.local && branch.name === 'main')!

    const result = prepareSessionGitContext({
      sessionId: 'session-tag-collision',
      repoPath: repo,
      executionMode: 'local',
      branch: mainBranch.name,
    })

    expect(result.context.branch).toBe('main')
    expect(sh(repo, ['branch', '--show-current'])).toBe('main')
  })

  test('Given Worktree mode When preparing session context Then creates detached worktree under repo .worktrees and persists meta', () => {
    const repo = makeRepo()
    const updates: Partial<AgentSessionMeta>[] = []

    const result = prepareSessionGitContext({
      sessionId: 'session-1',
      repoPath: repo,
      executionMode: 'worktree',
      branch: 'main',
      slug: 'session-one',
    }, {
      updateSessionMeta: (_sessionId, update) => {
        updates.push(update)
        return { id: 'session-1', title: 'session', createdAt: 1, updatedAt: 2, ...update } as AgentSessionMeta
      },
    })

    const repoRoot = sh(repo, ['rev-parse', '--show-toplevel'])
    const expectedWorktree = join(repoRoot, '.worktrees', 'session-one')
    expect(result.createdWorktree).toBe(true)
    // git 输出的 repoRoot 是正斜杠（MSYS），实现存的是原始输入（Windows 反斜杠）——
    // 用 normalizePathForCompare 归一化后比较，跨平台稳定
    expect(normalizePathForCompare(result.context.repoPath)).toBe(normalizePathForCompare(repoRoot))
    expect(result.context).toMatchObject({
      branch: 'main',
      executionMode: 'worktree',
      workingDirectory: expectedWorktree,
      worktreePath: expectedWorktree,
      baseRef: 'main',
    })
    expect(existsSync(expectedWorktree)).toBe(true)
    expect(sh(expectedWorktree, ['branch', '--show-current'])).toBe('')
    expect(normalizePathForCompare(updates.at(-1)?.gitRepoPath ?? '')).toBe(normalizePathForCompare(repoRoot))
    expect(updates.at(-1)).toMatchObject({
      workingDirectory: expectedWorktree,
      gitBranch: 'main',
      gitExecutionMode: 'worktree',
      gitWorktreePath: expectedWorktree,
      gitBaseRef: 'main',
    })
  })

  test('Given a dirty Worktree When removing it Then blocks deletion and preserves the user changes', () => {
    const repo = makeRepo()
    const worktree = join(repo, '.worktrees', 'dirty')
    sh(repo, ['worktree', 'add', worktree, 'feature/alpha'])
    writeFileSync(join(worktree, 'uncommitted.txt'), 'keep me\n', 'utf-8')

    expect(() => assertWorktreeClean(worktree)).toThrow('已阻止删除 Worktree')
    expect(() => removeSessionWorktree(repo, worktree)).toThrow('已阻止删除 Worktree')
    expect(existsSync(join(worktree, 'uncommitted.txt'))).toBe(true)
    // git 输出正斜杠且可能是长路径名；realpathSync 在 CI 上可能返回 8.3 短名（RUNNER~1）——
    // 只断言 porcelain 输出的 worktree 行以 .worktrees/<name> 结尾，避免路径名形态差异
    const porcelain = sh(repo, ['worktree', 'list', '--porcelain'])
    expect(porcelain.split('\n').some((l) => l.startsWith('worktree ') && l.endsWith('.worktrees/dirty'))).toBe(true)
  })

  test('Given an ignored user file in a Worktree When removing it Then blocks deletion and preserves the file', () => {
    const repo = makeRepo()
    const worktree = join(repo, '.worktrees', 'ignored')
    sh(repo, ['worktree', 'add', worktree, 'feature/alpha'])
    writeFileSync(join(worktree, 'credentials.secret'), 'keep me\n', 'utf-8')

    expect(() => assertWorktreeClean(worktree)).toThrow('已阻止删除 Worktree')
    expect(() => removeSessionWorktree(repo, worktree)).toThrow('已阻止删除 Worktree')
    expect(existsSync(join(worktree, 'credentials.secret'))).toBe(true)
    // git 输出正斜杠且可能是长路径名；realpathSync 在 CI 上可能返回 8.3 短名（RUNNER~1）——
    // 只断言 porcelain 输出的 worktree 行以 .worktrees/<name> 结尾，避免路径名形态差异
    const porcelain = sh(repo, ['worktree', 'list', '--porcelain'])
    expect(porcelain.split('\n').some((l) => l.startsWith('worktree ') && l.endsWith('.worktrees/ignored'))).toBe(true)
  })

  test('Given a clean Worktree When removing it Then removes the Worktree registration and directory', () => {
    const repo = makeRepo()
    const worktree = join(repo, '.worktrees', 'clean')
    sh(repo, ['worktree', 'add', worktree, 'feature/alpha'])

    removeSessionWorktree(repo, worktree)

    expect(existsSync(worktree)).toBe(false)
    expect(sh(repo, ['worktree', 'list', '--porcelain'])).not.toContain(`worktree ${worktree}`)
  })

  test('Given Local mode with dirty working tree When switching branch Then refuses without changing session meta', () => {
    const repo = makeRepo()
    writeFileSync(join(repo, 'dirty.txt'), 'dirty\n', 'utf-8')
    const updates: Partial<AgentSessionMeta>[] = []

    expect(() => prepareSessionGitContext({
      sessionId: 'session-2',
      repoPath: repo,
      executionMode: 'local',
      branch: 'feature/alpha',
    }, {
      updateSessionMeta: (_sessionId, update) => {
        updates.push(update)
        return { id: 'session-2', title: 'session', createdAt: 1, updatedAt: 2, ...update } as AgentSessionMeta
      },
    })).toThrow('工作区存在未提交改动')

    expect(sh(repo, ['branch', '--show-current'])).toBe('main')
    expect(updates).toHaveLength(0)
  })
})
