import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'
import { execFileSync } from 'node:child_process'
import type {
  AgentSessionMeta,
  GitBranchInfo,
  ListGitBranchesInput,
  PrepareSessionGitContextInput,
  PrepareSessionGitContextResult,
  SessionGitContext,
} from '@myyoda/shared'

interface PrepareOptions {
  updateSessionMeta?: (sessionId: string, updates: Partial<AgentSessionMeta>) => AgentSessionMeta
}

function runGit(repoPath: string, args: string[]): string {
  try {
    return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
      cwd: repoPath,
      encoding: 'utf-8',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch (error) {
    const stderr = error && typeof error === 'object' && 'stderr' in error
      ? String((error as { stderr?: unknown }).stderr ?? '').trim()
      : ''
    const message = stderr || (error instanceof Error ? error.message : String(error))
    throw new Error(message)
  }
}

function runGitOrNull(repoPath: string, args: string[]): string | null {
  try {
    return runGit(repoPath, args)
  } catch {
    return null
  }
}

function getRepoRoot(repoPath: string): string {
  const root = runGit(repoPath, ['rev-parse', '--show-toplevel'])
  return resolve(root)
}

function getCurrentBranch(repoPath: string): string {
  return runGitOrNull(repoPath, ['branch', '--show-current']) ?? ''
}

function hasDirtyChanges(repoPath: string): boolean {
  // Include ignored files as well: an ignored `.env`, generated asset, or user file
  // is still data that must never be removed by a session cleanup operation.
  return runGit(repoPath, ['status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching']).length > 0
}

function ensureValidBranchName(repoPath: string, branchName: string): void {
  if (!branchName.trim()) throw new Error('分支名不能为空')
  runGit(repoPath, ['check-ref-format', '--branch', branchName])
}

function parseWorktreeBranches(repoPath: string): Map<string, string> {
  const output = runGitOrNull(repoPath, ['worktree', 'list', '--porcelain']) ?? ''
  const map = new Map<string, string>()
  let currentPath = ''
  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      currentPath = resolve(line.slice('worktree '.length))
      continue
    }
    if (line.startsWith('branch refs/heads/')) {
      const branch = line.slice('branch refs/heads/'.length)
      map.set(branch, currentPath)
    }
  }
  return map
}

export function listGitBranchesForSession(input: ListGitBranchesInput): GitBranchInfo[] {
  const repoRoot = getRepoRoot(input.repoPath)
  const currentBranch = getCurrentBranch(repoRoot)
  const occupiedByBranch = parseWorktreeBranches(repoRoot)
  const format = '%(refname)%00%(refname:short)%00%(objectname:short)%00%(upstream:short)'
  const refs = ['refs/heads']
  if (input.includeRemote) refs.push('refs/remotes')
  const output = runGit(repoRoot, ['for-each-ref', `--format=${format}`, ...refs])

  return output
    .split('\n')
    .filter(Boolean)
    .map((line): GitBranchInfo => {
      const [ref = '', shortName = '', head = '', upstream = ''] = line.split('\0')
      const local = ref.startsWith('refs/heads/')
      // 不用 git 的 `%(refname:short)`：当仓库存在与分支同名的 tag（如 tag `main` + branch `main`）时，
      // git 会为消歧义返回 `heads/main` 而不是 `main`，而 `git switch`/`git worktree add -b` 只接受
      // 纯粹的 refs/heads/ 短名，传入消歧义后的名字会报 "fatal: a branch is expected, got 'refs/heads/main'"。
      // 直接从完整 ref 路径截取短名，绕开 git 的消歧义逻辑，保证名字始终可直接喂给 switch/worktree。
      const name = local
        ? ref.slice('refs/heads/'.length)
        : ref.replace(/^refs\/remotes\/[^/]+\//, '')
      return {
        name,
        ref,
        local,
        current: local && name === currentBranch,
        upstream: upstream || undefined,
        head: head || undefined,
        checkedOutPath: local ? occupiedByBranch.get(name) : undefined,
      }
    })
    .sort((a, b) => {
      if (a.current !== b.current) return a.current ? -1 : 1
      if (a.local !== b.local) return a.local ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

function slugify(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return slug || 'session-worktree'
}

/**
 * 确保仓库内的 `.worktrees/` 不会被 `git status --porcelain` 当作未跟踪改动。
 *
 * 写入 `.git/info/exclude`（仓库本地忽略规则，不进入用户提交历史），而不是
 * 追加到受版本控制的 `.gitignore`——避免代产品行为污染用户的提交/PR diff。
 * 若已被任意规则忽略，或写入失败（如只读文件系统），静默跳过，不阻塞 worktree 创建。
 */
function ensureWorktreesIgnored(repoRoot: string): void {
  try {
    if (runGitOrNull(repoRoot, ['check-ignore', '.worktrees']) !== null) return
    const excludePath = join(repoRoot, '.git', 'info', 'exclude')
    const marker = '/.worktrees/'
    const existing = existsSync(excludePath) ? readFileSync(excludePath, 'utf-8') : ''
    if (existing.split('\n').some((line) => line.trim() === marker)) return
    const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : ''
    writeFileSync(excludePath, `${existing}${prefix}${marker}\n`, { flag: 'a' })
  } catch {
    // best effort：忽略规则写入失败不应阻塞 worktree 创建本身
  }
}

/** 根据绝对路径在 `git worktree list` 中查找对应条目的分支绑定情况 */
function getWorktreeInfoByPath(repoRoot: string, worktreePath: string): { branch: string | null; detached: boolean } | null {
  const output = runGitOrNull(repoRoot, ['worktree', 'list', '--porcelain']) ?? ''
  const target = resolve(worktreePath)
  let current = ''
  let found = false
  let branch: string | null = null
  let detached = false
  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (found) break
      current = resolve(line.slice('worktree '.length))
      found = current === target
      continue
    }
    if (!found) continue
    if (line.startsWith('branch refs/heads/')) branch = line.slice('branch refs/heads/'.length)
    if (line.trim() === 'detached') detached = true
  }
  return found ? { branch, detached } : null
}

/**
 * 移除会话对应的 Git Worktree（供正常清理和失败回滚共用）。
 * 只允许 Git 自身在确认干净后完成删除；Git 删除失败时保留目录并抛错，
 * 避免用物理递归删除制造不可恢复的数据损失或 Worktree 元数据竞态。
 */
export function assertWorktreeClean(worktreePath: string): void {
  if (!existsSync(worktreePath)) return
  try {
    if (hasDirtyChanges(worktreePath)) {
      throw new Error(`工作区存在未提交改动，已阻止删除 Worktree: ${worktreePath}`)
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('已阻止删除 Worktree')) throw error
    throw new Error(`无法确认 Worktree 是否干净，已阻止删除: ${worktreePath}`)
  }
}

export function removeSessionWorktree(repoRoot: string, worktreePath: string): void {
  assertWorktreeClean(worktreePath)
  try {
    runGit(repoRoot, ['worktree', 'remove', worktreePath])
  } catch (error) {
    throw new Error(`Git Worktree 删除失败，已保留目录以避免数据丢失: ${worktreePath}`, { cause: error })
  }
}

function worktreePathFor(repoRoot: string, input: PrepareSessionGitContextInput): string {
  const slug = slugify(input.slug ?? input.newBranchName ?? `${input.sessionId}-${input.branch}`)
  const root = resolve(repoRoot)
  const target = resolve(root, '.worktrees', slug)
  const allowedPrefix = `${resolve(root, '.worktrees')}${sep}`
  if (!target.startsWith(allowedPrefix)) {
    throw new Error('Worktree 路径非法')
  }
  return target
}

function persistContext(
  input: PrepareSessionGitContextInput,
  context: SessionGitContext,
  options?: PrepareOptions,
): void {
  options?.updateSessionMeta?.(input.sessionId, {
    workingDirectory: context.workingDirectory,
    gitRepoPath: context.repoPath,
    gitBranch: context.branch,
    gitExecutionMode: context.executionMode,
    gitWorktreePath: context.worktreePath,
    gitBaseRef: context.baseRef,
  })
}

function prepareLocalContext(
  repoRoot: string,
  input: PrepareSessionGitContextInput,
  options?: PrepareOptions,
): PrepareSessionGitContextResult {
  const targetBranch = input.newBranchName ?? input.branch
  if (input.newBranchName) ensureValidBranchName(repoRoot, input.newBranchName)
  const currentBranch = getCurrentBranch(repoRoot)
  if (currentBranch !== targetBranch && hasDirtyChanges(repoRoot)) {
    throw new Error('工作区存在未提交改动，已阻止 Local 分支切换')
  }
  const occupiedPath = parseWorktreeBranches(repoRoot).get(targetBranch)
  if (occupiedPath && resolve(occupiedPath) !== repoRoot) {
    throw new Error(`分支 ${targetBranch} 已被其他 worktree checkout: ${occupiedPath}`)
  }
  if (input.newBranchName) {
    runGit(repoRoot, ['switch', '-c', input.newBranchName, input.branch])
  } else if (currentBranch !== targetBranch) {
    runGit(repoRoot, ['switch', targetBranch])
  }

  const context: SessionGitContext = {
    repoPath: repoRoot,
    branch: targetBranch,
    executionMode: 'local',
    workingDirectory: repoRoot,
    baseRef: input.branch,
  }
  persistContext(input, context, options)
  return { context, createdWorktree: false }
}

function prepareWorktreeContext(
  repoRoot: string,
  input: PrepareSessionGitContextInput,
  options?: PrepareOptions,
): PrepareSessionGitContextResult {
  const worktreePath = worktreePathFor(repoRoot, input)
  const branch = input.newBranchName ?? input.branch
  let createdWorktree = false

  if (!existsSync(worktreePath)) {
    mkdirSync(join(repoRoot, '.worktrees'), { recursive: true })
    ensureWorktreesIgnored(repoRoot)
    if (input.newBranchName) {
      ensureValidBranchName(repoRoot, input.newBranchName)
      runGit(repoRoot, ['worktree', 'add', '-b', input.newBranchName, worktreePath, input.branch])
    } else {
      runGit(repoRoot, ['worktree', 'add', '--detach', worktreePath, input.branch])
    }
    createdWorktree = true
  } else {
    // 复用已存在的 worktree 目录前，校验其真实绑定分支与本次请求一致，
    // 避免不同会话因目录名（由 slug/newBranchName 推导）巧合相同而被悄悄合并到同一工作目录。
    const existingInfo = getWorktreeInfoByPath(repoRoot, worktreePath)
    if (input.newBranchName) {
      if (!existingInfo || existingInfo.detached || existingInfo.branch !== input.newBranchName) {
        throw new Error(
          `Worktree 目录 "${basename(worktreePath)}" 已存在但绑定分支不一致` +
          `（当前: ${existingInfo ? (existingInfo.detached ? 'detached' : existingInfo.branch) : '未知'}，期望: ${input.newBranchName}），` +
          '请更换分支名，或先清理该 worktree 后重试',
        )
      }
    } else if (!existingInfo || !existingInfo.detached) {
      throw new Error(
        `Worktree 目录 "${basename(worktreePath)}" 已被分支 ${existingInfo?.branch ?? '未知'} 占用，` +
        '与本次请求的模式不一致，请更换名称或先清理该 worktree 后重试',
      )
    }
  }

  const context: SessionGitContext = {
    repoPath: repoRoot,
    branch,
    executionMode: 'worktree',
    workingDirectory: worktreePath,
    worktreePath,
    baseRef: input.branch,
  }

  try {
    persistContext(input, context, options)
  } catch (error) {
    if (createdWorktree) {
      removeSessionWorktree(repoRoot, worktreePath)
    }
    throw error
  }

  return { context, createdWorktree }
}

export function prepareSessionGitContext(
  input: PrepareSessionGitContextInput,
  options?: PrepareOptions,
): PrepareSessionGitContextResult {
  const repoRoot = getRepoRoot(input.repoPath)
  if (input.executionMode === 'local') {
    return prepareLocalContext(repoRoot, input, options)
  }
  return prepareWorktreeContext(repoRoot, input, options)
}

export function describeSessionGitContext(context: SessionGitContext): string {
  const location = context.executionMode === 'worktree'
    ? `Worktree ${basename(context.workingDirectory)}`
    : 'Local'
  return `${location} · ${context.branch}`
}
