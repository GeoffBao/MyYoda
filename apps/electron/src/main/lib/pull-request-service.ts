/**
 * Pull Request 服务（本地 gh CLI）
 *
 * 为 PR 创建 / 查看 / 合并 / 评论提供主进程实现，数据源为本机 `gh`（GitHub CLI）：
 *   - 所有鉴权走用户本机 `gh auth login`，MyYoda 不存储任何 GitHub 凭证
 *   - 列表/详情/diff 等只读命令：`gh pr view --json` 一次子进程
 *   - 创建：duplicate-PR 防护（先 `gh pr list` probe，已有 open PR 则复用）+ `gh pr create`
 *   - 合并：`gh pr merge <number> --<method> [--delete-branch]`
 *
 * ⚠️ 超时策略（重要）：
 * 网络类命令（push / gh pr create / gh pr view / gh pr merge 等）是秒级到分钟级的网络操作，
 * 必须用异步 execFile + 60-120s 超时——不能用 git-diff-service.ts 的本地 10s spawn 封装
 * （那是为毫秒级本地操作设计的，弱网下会直接超时失败）。
 * 与 community-skill-submit-service.ts 保持一致：git 60s / gh 120s。
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type {
  BranchWorktreeUsage,
  CreatePullRequestInput,
  CreatePullRequestResult,
  CurrentBranchPullRequest,
  GitPrStatus,
  PullRequestActionInput,
  PullRequestActionResult,
  PullRequestCheck,
  PullRequestComment,
  PullRequestCommentInput,
  PullRequestCommentResult,
  PullRequestCommit,
  PullRequestDetail,
  PullRequestDetailInput,
  PullRequestDiffResult,
  PullRequestListEntry,
  PullRequestsListInput,
  PullRequestsListResult,
  PullRequestMergeMethod,
  PullRequestPanelState,
} from '@myyoda/shared'
import { getGhCliStatus, resolveGhPath } from './gh-cli'
import { findAllGitRoots } from './git-diff-service'

/** 查找 Git 仓库根目录（向上后向下），失败返回 null */
async function findGitRoot(baseDir: string): Promise<string | null> {
  const roots = await findAllGitRoots(baseDir)
  return roots[0] ?? null
}

const execFileAsync = promisify(execFile)

// ===== 纯函数：类型归一化 / 状态机（可单测） =====

/** gh JSON 的 PR state 大写枚举 → 统一小写 */
export function normalizePullRequestState(raw: string | null | undefined): PullRequestListEntry['state'] {
  const v = (raw ?? '').toUpperCase()
  if (v === 'MERGED') return 'merged'
  if (v === 'CLOSED') return 'closed'
  return 'open'
}

/** gh JSON 的 check state 大写枚举 → 统一小写 */
export function normalizeCheckStatus(raw: string | null | undefined): PullRequestCheck['status'] {
  const v = (raw ?? '').toLowerCase() as PullRequestCheck['status']
  const allowed = new Set(['pending', 'success', 'failure', 'skipped', 'neutral', 'cancelled'])
  return allowed.has(v) ? v : 'pending'
}

/** 把 gh pr view --json 的 checks 数组归一化（兼容 statusCheckRollup / checks 两种形状） */
export function normalizeChecks(raw: unknown): PullRequestCheck[] {
  if (!Array.isArray(raw)) return []
  const out: PullRequestCheck[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const it = item as Record<string, unknown>
    // statusCheckRollup 条目可能嵌套 contexts；扁平收集
    const candidates: Array<Record<string, unknown>> = []
    if (typeof it.name === 'string') candidates.push(it)
    if (Array.isArray(it.contexts)) {
      for (const c of it.contexts) {
        if (c && typeof c === 'object') candidates.push(c as Record<string, unknown>)
      }
    }
    for (const c of candidates) {
      if (typeof c.name !== 'string') continue
      out.push({
        name: c.name,
        status: normalizeCheckStatus(typeof c.state === 'string' ? c.state : typeof c.status === 'string' ? c.status : 'pending'),
        description: typeof c.description === 'string' ? c.description : null,
        url: typeof c.url === 'string' ? c.url : null,
        startedAt: typeof c.startedAt === 'string' ? c.startedAt : null,
        completedAt: typeof c.completedAt === 'string' ? c.completedAt : null,
      })
    }
  }
  return out
}

/** 计算 checks 摘要（pending/success/failure 计数），供状态行徽标用 */
export function summarizeChecks(checks: PullRequestCheck[]): { pending: number; success: number; failure: number } {
  const summary = { pending: 0, success: 0, failure: 0 }
  for (const check of checks) {
    if (check.status === 'pending') summary.pending++
    else if (check.status === 'success') summary.success++
    else if (check.status === 'failure' || check.status === 'cancelled') summary.failure++
  }
  return summary
}

/** gh JSON actor → PullRequestActor */
function normalizeActor(raw: unknown): PullRequestListEntry['author'] {
  if (!raw || typeof raw !== 'object') return null
  const a = raw as Record<string, unknown>
  if (typeof a.login !== 'string') return null
  return {
    login: a.login,
    name: typeof a.name === 'string' ? a.name : null,
    avatarUrl: typeof a.avatarUrl === 'string' ? a.avatarUrl : null,
    url: typeof a.url === 'string' ? a.url : null,
  }
}

/** gh JSON labels → PullRequestLabel[] */
function normalizeLabels(raw: unknown): PullRequestListEntry['labels'] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((l): l is Record<string, unknown> => !!l && typeof l === 'object')
    .map((l) => ({
      name: typeof l.name === 'string' ? l.name : String(l.name ?? ''),
      color: typeof l.color === 'string' ? l.color : null,
    }))
}

/** gh JSON reviewRequests → 是否要求当前用户 review */
function hasViewerReviewRequest(raw: unknown, viewer: string | null): boolean {
  if (!viewer || !Array.isArray(raw)) return false
  return raw.some(
    (r) => r && typeof r === 'object' &&
      (r as Record<string, unknown>).login === viewer,
  )
}

/** 仓库名（路径最后一段，去 .git） */
export function repoDisplayName(repoPath: string): string {
  const base = repoPath.split(/[\\/]/).filter(Boolean).pop() || repoPath
  return base.replace(/\.git$/, '')
}

/** 从分支名生成 PR 标题（snake/kebab → 可读标题） */
export function titleFromBranch(branch: string): string {
  const cleaned = branch.replace(/^feat[/_-]|^feature[/_-]|^fix[/_-]|^chore[/_-]|^docs[/_-]|^refactor[/_-]|^release[/_-]/i, '')
  const words = cleaned
    .split(/[/_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
  return words.join(' ') || branch
}

// ===== PR body 模板 =====

/** 生成 PR body（Summary / Changes / Testing / Checklist） */
export function buildPullRequestBody(input: { branch: string; repoName: string; latestCommitSubject?: string }): string {
  const subject = input.latestCommitSubject?.trim()
  const lines = [
    '## Summary',
    '',
    subject
      ? `- ${subject}`
      : `- 分支 \`${input.branch}\` 的改动`,
    '',
    '## Changes',
    '',
    '- （待补充）',
    '',
    '## Testing',
    '',
    '- （待补充）',
    '',
    '## Checklist',
    '',
    '- [ ] 本地验证通过',
    '- [ ] 相关测试通过',
    '- [ ] 文档已同步（如适用）',
  ]
  return lines.join('\n')
}

// ===== 子进程封装 =====

function extractProcessError(error: unknown): string {
  const stderr = error && typeof error === 'object' && 'stderr' in error
    ? String((error as { stderr?: unknown }).stderr ?? '').trim()
    : ''
  return stderr || (error instanceof Error ? error.message : String(error))
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf-8',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      timeout: 60_000,
      maxBuffer: 20 * 1024 * 1024,
    })
    return stdout.trim()
  } catch (error) {
    throw new Error(`git ${args[0] ?? ''} 失败: ${extractProcessError(error)}`)
  }
}

async function runGh(ghPath: string, args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(ghPath, args, {
      cwd,
      encoding: 'utf-8',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' },
      timeout: 120_000,
      maxBuffer: 20 * 1024 * 1024,
    })
    return stdout.trim()
  } catch (error) {
    // gh 命令失败（如 PR 不存在）时 stderr 是主要错误信息
    const stderr = error && typeof error === 'object' && 'stderr' in error
      ? String((error as { stderr?: unknown }).stderr ?? '').trim()
      : ''
    throw new Error(stderr || (error instanceof Error ? error.message : String(error)))
  }
}

/** 解析仓库的默认分支（base branch），供 create 默认值 */
export async function getDefaultBranch(repoPath: string): Promise<string> {
  try {
    const remote = await runGit(repoPath, ['rev-parse', '--abbrev-ref', 'origin/HEAD'])
    if (remote && !remote.startsWith('origin/HEAD')) return remote.replace(/^origin\//, '')
  } catch {
    // 忽略，走 fallback
  }
  try {
    const branch = await runGit(repoPath, ['symbolic-ref', '--short', 'HEAD'])
    if (branch && branch !== 'HEAD') return branch
  } catch {
    // 忽略
  }
  return 'main'
}

/** 获取当前 HEAD 分支名 */
export async function getCurrentBranch(repoPath: string): Promise<string | null> {
  try {
    const branch = await runGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
    return branch === 'HEAD' ? null : branch
  } catch {
    return null
  }
}

const FALLBACK_DEFAULT_BRANCH_NAMES = new Set(['main', 'master'])

/** 判断分支名是否是默认分支（main/master） */
export function isDefaultBranchName(branch: string): boolean {
  return FALLBACK_DEFAULT_BRANCH_NAMES.has(branch)
}

/** 获取当前分支的推送状态（PR 按钮状态机输入），失败字段降级为 false/0 */
export async function getGitPrStatus(repoPath: string): Promise<GitPrStatus> {
  const root = await findGitRoot(repoPath)
  if (!root) {
    return { branch: null, isDefaultBranch: false, hasUpstream: false, aheadCount: 0, behindCount: 0, hasOriginRemote: false, hasChanges: false, repoPath: null }
  }
  const empty: GitPrStatus = { branch: null, isDefaultBranch: false, hasUpstream: false, aheadCount: 0, behindCount: 0, hasOriginRemote: false, hasChanges: false, repoPath: root }

  const branch = await getCurrentBranch(root)
  if (!branch) return empty

  // hasUpstream：判断是否有 origin/HEAD 或 tracking
  let hasUpstream = false
  let aheadCount = 0
  let behindCount = 0
  let hasOriginRemote = false
  let hasChanges = false

  try {
    const remotes = await runGit(root, ['remote'])
    hasOriginRemote = remotes.split('\n').map((r) => r.trim()).includes('origin')
  } catch {
    // 忽略
  }

  try {
    // 判断 tracking upstream（如 origin/feat/xxx）
    const upstream = await runGit(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
    hasUpstream = !!upstream && upstream !== 'HEAD' && !upstream.startsWith('fatal')
  } catch {
    // 无 upstream
  }

  if (hasUpstream) {
    try {
      const counts = await runGit(root, ['rev-list', '--left-right', '--count', 'HEAD...@{u}'])
      const parts = counts.split(/\s+/).map((n) => parseInt(n, 10))
      aheadCount = parts[0] !== undefined && Number.isFinite(parts[0]) ? parts[0] : 0
      behindCount = parts[1] !== undefined && Number.isFinite(parts[1]) ? parts[1] : 0
    } catch {
      // 忽略
    }
  } else if (hasOriginRemote) {
    // 无 upstream 但有 origin：尝试对比 origin/<branch>，探测 ahead（可能尚未推送）
    try {
      const counts = await runGit(root, ['rev-list', '--left-right', '--count', `HEAD...origin/${branch}`])
      const parts = counts.split(/\s+/).map((n) => parseInt(n, 10))
      aheadCount = parts[0] !== undefined && Number.isFinite(parts[0]) ? parts[0] : 0
      behindCount = parts[1] !== undefined && Number.isFinite(parts[1]) ? parts[1] : 0
    } catch {
      // origin/<branch> 不存在（从未推送），视为 ahead
      try {
        const mainAhead = await runGit(root, ['rev-list', '--count', 'HEAD', '--not', '--remotes=origin'])
        const n = parseInt(mainAhead, 10)
        aheadCount = Number.isFinite(n) ? n : 0
      } catch {
        // 忽略
      }
    }
  }

  try {
    const status = await runGit(root, ['status', '--porcelain'])
    hasChanges = status.length > 0
  } catch {
    // 忽略
  }

  return {
    branch,
    isDefaultBranch: isDefaultBranchName(branch),
    hasUpstream,
    aheadCount,
    behindCount,
    hasOriginRemote,
    hasChanges,
    repoPath: root,
  }
}

/** 获取 PR 状态行面板的一次性数据（gh + git + 当前分支 PR），供文件改动面板状态行使用 */
export async function getPullRequestPanelState(repoPath: string): Promise<PullRequestPanelState> {
  const gh = getGhCliStatus()
  const git = await getGitPrStatus(repoPath)
  let currentBranchPr: CurrentBranchPullRequest | null = null
  if (gh.installed && gh.authenticated && git.repoPath && git.branch) {
    try {
      currentBranchPr = await getCurrentBranchPullRequest(git.repoPath)
    } catch {
      currentBranchPr = null
    }
  }
  return { gh, git, currentBranchPr }
}

/** 最近一次提交的 subject（用于 PR 标题兜底） */
export async function getLatestCommitSubject(repoPath: string, branch: string): Promise<string | undefined> {
  try {
    const subject = await runGit(repoPath, ['log', '-1', '--format=%s', branch])
    return subject || undefined
  } catch {
    return undefined
  }
}

// ===== 只读查询 =====

/** 检查 gh 状态；未就绪时抛错（供写操作前置校验） */
function assertGhReady(ghPath: string): void {
  const status = getGhCliStatus()
  if (!status.installed) {
    throw new Error('未检测到 gh（GitHub CLI），请先安装：https://cli.github.com/')
  }
  if (!status.authenticated) {
    throw new Error('gh 未登录，请先在终端运行 `gh auth login`')
  }
  void ghPath
}

/**
 * 获取当前分支关联的 open PR（文件改动面板状态行用）。
 * 找不到时返回 null（不代表错误）。
 */
export async function getCurrentBranchPullRequest(repoPath: string): Promise<CurrentBranchPullRequest | null> {
  const status = getGhCliStatus()
  if (!status.installed || !status.authenticated) return null
  const root = await findGitRoot(repoPath)
  if (!root) return null
  const branch = await getCurrentBranch(root)
  if (!branch) return null

  const ghPath = resolveGhPath()
  try {
    const json = await runGh(ghPath, ['pr', 'view', '--json', 'number,title,url,state,isDraft,statusCheckRollup', '--jq', '.', branch], root)
    if (!json || json === 'null') return null
    const data = JSON.parse(json) as Record<string, unknown>
    if (typeof data.number !== 'number') return null
    const checks = normalizeChecks(data.statusCheckRollup ?? [])
    return {
      repoPath: root,
      number: data.number,
      title: typeof data.title === 'string' ? data.title : `#${data.number}`,
      url: typeof data.url === 'string' ? data.url : '',
      isDraft: data.isDraft === true,
      state: normalizePullRequestState(typeof data.state === 'string' ? data.state : 'open'),
      checksSummary: summarizeChecks(checks),
    }
  } catch {
    // gh pr view 找不到关联 PR 时返回非零；视为无 PR
    return null
  }
}

/** 列出 PR（按状态筛选；默认 open） */
export async function listPullRequests(input: PullRequestsListInput): Promise<PullRequestsListResult> {
  const status = getGhCliStatus()
  if (!status.installed || !status.authenticated) {
    return { viewer: null, entries: [] }
  }
  const ghPath = resolveGhPath()
  const viewer = status.login ?? null
  const state = input.state ?? 'open'

  const repoPaths = input.repoPaths && input.repoPaths.length > 0
    ? input.repoPaths
    : await collectRepoPaths()
  const entries: PullRequestListEntry[] = []

  for (const repoPath of repoPaths) {
    const root = await findGitRoot(repoPath)
    if (!root) continue
    try {
      const json = await runGh(ghPath, ['pr', 'list', '--state', state, '--json', 'number,title,url,state,isDraft,headRefName,baseRefName,author,labels,reviewDecision,reviewRequests,additions,deletions,createdAt,updatedAt,statusCheckRollup'], root)
      if (!json) continue
      const rawList = JSON.parse(json) as Array<Record<string, unknown>>
      for (const pr of rawList) {
        const number = typeof pr.number === 'number' ? pr.number : Number(pr.number)
        if (!Number.isFinite(number)) continue
        const entry: PullRequestListEntry = {
          repository: root,
          repositoryName: repoDisplayName(root),
          number,
          title: typeof pr.title === 'string' ? pr.title : `#${number}`,
          url: typeof pr.url === 'string' ? pr.url : '',
          author: normalizeActor(pr.author),
          headBranch: typeof pr.headRefName === 'string' ? pr.headRefName : '',
          baseBranch: typeof pr.baseRefName === 'string' ? pr.baseRefName : '',
          state: normalizePullRequestState(typeof pr.state === 'string' ? pr.state : 'open'),
          isDraft: pr.isDraft === true,
          additions: typeof pr.additions === 'number' ? pr.additions : 0,
          deletions: typeof pr.deletions === 'number' ? pr.deletions : 0,
          createdAt: typeof pr.createdAt === 'string' ? pr.createdAt : '',
          updatedAt: typeof pr.updatedAt === 'string' ? pr.updatedAt : '',
          reviewDecision: typeof pr.reviewDecision === 'string' ? pr.reviewDecision : null,
          viewerReviewRequested: hasViewerReviewRequest(pr.reviewRequests, viewer),
          labels: normalizeLabels(pr.labels),
        }
        // involvement 筛选（reviewing = viewer 被要求 review 或 reviewDecision 待定；authored = 作者是 viewer）
        if (input.involvement === 'reviewing') {
          if (!entry.viewerReviewRequested && entry.reviewDecision !== 'REVIEW_REQUIRED' && entry.reviewDecision !== 'CHANGES_REQUESTED') continue
        } else if (input.involvement === 'authored') {
          if (!entry.author || entry.author.login !== viewer) continue
        }
        entries.push(entry)
      }
    } catch {
      // 单个仓库失败不阻断整体列表
      continue
    }
  }

  // gh `--state closed` 会把 merged PR 也返回（merged 本质也是 closed）——
  // 但 UI 的 Closed / Merged 是两个独立筛选，这里把 merged 从 closed 结果中剔除。
  const filteredEntries = state === 'closed'
    ? entries.filter((e) => e.state !== 'merged')
    : entries

  // 排序：最近更新的在前
  filteredEntries.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
  return { viewer, entries: filteredEntries }
}

/** 收集可列 PR 的仓库候选：当前目录 + 常见工作区根（由渲染端显式传入更可控，此处仅回退） */
async function collectRepoPaths(): Promise<string[]> {
  // 渲染端总是显式传 repoPath；无参场景返回空，由调用方决定
  return []
}

/** 获取 PR 详情（含评论/commits/checks） */
export async function getPullRequestDetail(input: PullRequestDetailInput): Promise<PullRequestDetail> {
  const status = getGhCliStatus()
  if (!status.installed || !status.authenticated) {
    throw new Error('gh 未就绪：请先安装 gh 并运行 `gh auth login`')
  }
  const root = await findGitRoot(input.repoPath)
  if (!root) throw new Error('未找到 Git 仓库根目录')
  const ghPath = resolveGhPath()

  const json = await runGh(ghPath, ['pr', 'view', String(input.number), '--json', 'number,title,body,url,state,isDraft,mergeable,mergeStateStatus,reviewDecision,additions,deletions,changedFiles,headRefName,baseRefName,createdAt,updatedAt,mergedAt,closedAt,maintainerCanModify,author,labels,reviews,comments,commits,statusCheckRollup,reviewRequests', '--jq', '.'], root)
  const data = JSON.parse(json) as Record<string, unknown>

  const number = typeof data.number === 'number' ? data.number : Number(input.number)
  const checks = normalizeChecks(data.statusCheckRollup ?? [])
  const comments = normalizeComments(data)
  const state = normalizePullRequestState(typeof data.state === 'string' ? data.state : 'open')

  return {
    repository: root,
    repositoryName: repoDisplayName(root),
    number,
    title: typeof data.title === 'string' ? data.title : `#${number}`,
    body: typeof data.body === 'string' ? data.body : '',
    url: typeof data.url === 'string' ? data.url : '',
    author: normalizeActor(data.author),
    state,
    isDraft: data.isDraft === true,
    mergeable: typeof data.mergeable === 'string' ? data.mergeable : null,
    mergeStateStatus: typeof data.mergeStateStatus === 'string' ? data.mergeStateStatus : null,
    reviewDecision: typeof data.reviewDecision === 'string' ? data.reviewDecision : null,
    additions: typeof data.additions === 'number' ? data.additions : 0,
    deletions: typeof data.deletions === 'number' ? data.deletions : 0,
    changedFiles: typeof data.changedFiles === 'number' ? data.changedFiles : 0,
    headBranch: typeof data.headRefName === 'string' ? data.headRefName : '',
    baseBranch: typeof data.baseRefName === 'string' ? data.baseRefName : '',
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : '',
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
    mergedAt: typeof data.mergedAt === 'string' ? data.mergedAt : null,
    closedAt: typeof data.closedAt === 'string' ? data.closedAt : null,
    maintainerCanModify: data.maintainerCanModify === true,
    reviewers: normalizeReviewers(data.reviews),
    labels: normalizeLabels(data.labels),
    checks,
    comments,
    commentsTruncated: false,
    commits: normalizeCommits(data.commits),
    mergeCapabilities: {
      merge: state === 'open',
      squash: state === 'open',
      rebase: state === 'open',
      deleteBranchOnMerge: state === 'open',
    },
  }
}

/** 从 reviews 数组派生 reviewers（去重，按首次出现顺序） */
function normalizeReviewers(raw: unknown): PullRequestDetail['reviewers'] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: PullRequestDetail['reviewers'] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const author = normalizeActor((r as Record<string, unknown>).author)
    if (author && !seen.has(author.login)) {
      seen.add(author.login)
      out.push(author)
    }
  }
  return out
}

function normalizeCommits(raw: unknown): PullRequestCommit[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .map((c) => ({
      oid: typeof c.oid === 'string' ? c.oid : '',
      messageHeadline: typeof c.messageHeadline === 'string' ? c.messageHeadline : typeof c.message === 'string' ? c.message : '',
      messageBody: typeof c.messageBody === 'string' ? c.messageBody : '',
      committedDate: typeof c.committedDate === 'string' ? c.committedDate : '',
      authors: Array.isArray(c.authors) ? c.authors.map((a) => normalizeActor(a)).filter((a): a is NonNullable<typeof a> => a !== null) : [],
    }))
}

function normalizeComments(data: Record<string, unknown>): PullRequestComment[] {
  const out: PullRequestComment[] = []
  // 普通 issue comments
  if (Array.isArray(data.comments)) {
    for (const c of data.comments) {
      if (!c || typeof c !== 'object') continue
      const it = c as Record<string, unknown>
      out.push({
        id: String(it.id ?? `issue-${out.length}`),
        kind: 'issue-comment',
        author: normalizeActor(it.author),
        body: typeof it.body === 'string' ? it.body : '',
        createdAt: typeof it.createdAt === 'string' ? it.createdAt : '',
        updatedAt: typeof it.updatedAt === 'string' ? it.updatedAt : null,
        url: typeof it.url === 'string' ? it.url : null,
        path: null,
        reviewState: null,
      })
    }
  }
  // reviews（含 reviewState）
  if (Array.isArray(data.reviews)) {
    for (const r of data.reviews) {
      if (!r || typeof r === 'string') continue
      const it = r as Record<string, unknown>
      out.push({
        id: String(it.id ?? `review-${out.length}`),
        kind: 'review',
        author: normalizeActor(it.author),
        body: typeof it.body === 'string' ? it.body : '',
        createdAt: typeof it.submittedAt === 'string' ? it.submittedAt : typeof it.createdAt === 'string' ? it.createdAt : '',
        updatedAt: null,
        url: typeof it.url === 'string' ? it.url : null,
        path: null,
        reviewState: typeof it.state === 'string' ? it.state : null,
      })
    }
  }
  // 按时间排序（越新越靠后，Timeline 纵向排列时新的在下）
  out.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
  return out
}

/** 获取 PR diff（复用渲染端 DiffView 渲染 patch） */
export async function getPullRequestDiff(input: PullRequestDetailInput): Promise<PullRequestDiffResult> {
  const status = getGhCliStatus()
  if (!status.installed || !status.authenticated) {
    throw new Error('gh 未就绪：请先安装 gh 并运行 `gh auth login`')
  }
  const root = await findGitRoot(input.repoPath)
  if (!root) throw new Error('未找到 Git 仓库根目录')
  const ghPath = resolveGhPath()
  const patch = await runGh(ghPath, ['pr', 'diff', String(input.number)], root)
  return { patch, truncated: patch.length > 5 * 1024 * 1024 }
}

// ===== 写操作 =====

/** 创建 PR（duplicate-PR 防护：已存在同 head 分支的 open PR 则复用） */
export async function createPullRequest(input: CreatePullRequestInput): Promise<CreatePullRequestResult> {
  const ghPath = resolveGhPath()
  assertGhReady(ghPath)
  const root = await findGitRoot(input.repoPath)
  if (!root) throw new Error('未找到 Git 仓库根目录')

  let headBranch = input.headBranch

  // 0. 默认分支引导：自动创建 feature 分支（feat/<branch>-<date>）并切换
  if (input.autoCreateFeatureBranch) {
    const currentBranch = await getCurrentBranch(root)
    if (currentBranch && isDefaultBranchName(currentBranch)) {
      const suffix = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      headBranch = `feat/${currentBranch}-${suffix}`
      // 分支已存在则切过去；不存在则创建
      try {
        await runGit(root, ['checkout', '-B', headBranch, 'origin/main'])
      } catch {
        await runGit(root, ['checkout', '-b', headBranch])
      }
    }
  }

  // 0.5 自动生成 title/body（不传时用分支名 + 最近提交）
  let title = input.title
  let body = input.body
  if (input.autoGenerateTitleAndBody || !title || !body) {
    if (!title) title = titleFromBranch(headBranch)
    if (!body) {
      const latestSubject = await getLatestCommitSubject(root, headBranch)
      body = buildPullRequestBody({ branch: headBranch, repoName: repoDisplayName(root), latestCommitSubject: latestSubject })
    }
  }

  // 1. duplicate 防护：同 head 分支已存在 open PR 则复用
  try {
    const existing = await runGh(ghPath, ['pr', 'list', '--state', 'open', '--head', headBranch, '--json', 'number,url', '--jq', '.[0]'], root)
    if (existing && existing !== 'null' && existing !== '') {
      const parsed = JSON.parse(existing) as { number?: unknown; url?: unknown }
      const number = typeof parsed.number === 'number' ? parsed.number : Number(parsed.number)
      if (Number.isFinite(number)) {
        return {
          number,
          url: typeof parsed.url === 'string' ? parsed.url : '',
          reusedExisting: true,
        }
      }
    }
  } catch {
    // probe 失败不阻断，继续尝试 create（create 自身会再次报错）
  }

  // 2. 确保分支已推送（幂等 push）
  await runGit(root, ['push', '-u', 'origin', headBranch])

  // 3. 生成 body 文件（gh 支持 --body-file 避免 shell 转义问题）
  const tmpDir = mkdtempSync(join(tmpdir(), 'myyoda-pr-'))
  const bodyPath = join(tmpDir, 'pr-body.md')
  try {
    writeFileSync(bodyPath, body, 'utf-8')
    const args = [
      'pr', 'create',
      '--base', input.baseBranch,
      '--head', headBranch,
      '--title', title,
      '--body-file', bodyPath,
    ]
    if (input.draft) args.push('--draft')
    const url = await runGh(ghPath, args, root)
    // gh pr create 输出 PR url，形如 https://github.com/owner/repo/pull/123（没有 #123 片段）
    const numberMatch = url.match(/\/pull\/(\d+)/)
    const number = numberMatch ? Number(numberMatch[1]) : 0
    return {
      number: Number.isFinite(number) && number > 0 ? number : 0,
      url,
      reusedExisting: false,
    }
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // 忽略清理失败
    }
  }
}

/** PR 操作（merge / ready / draft / close / reopen） */
export async function pullRequestAction(input: PullRequestActionInput): Promise<PullRequestActionResult> {
  const ghPath = resolveGhPath()
  assertGhReady(ghPath)
  const root = await findGitRoot(input.repoPath)
  if (!root) throw new Error('未找到 Git 仓库根目录')
  const num = String(input.number)

  let url = ''
  switch (input.action) {
    case 'merge': {
      const args = ['pr', 'merge', num]
      const method: PullRequestMergeMethod = input.mergeMethod ?? 'squash'
      args.push(`--${method}`)
      if (input.deleteBranch) args.push('--delete-branch')
      await runGh(ghPath, args, root)
      const detail = JSON.parse(await runGh(ghPath, ['pr', 'view', num, '--json', 'url', '--jq', '.'], root)) as { url?: unknown }
      url = typeof detail.url === 'string' ? detail.url : ''
      break
    }
    case 'ready': {
      await runGh(ghPath, ['pr', 'ready', num], root)
      url = await prUrlAfterAction(root, num, ghPath)
      break
    }
    case 'draft': {
      // gh pr ready --undo 把 PR 转回 draft
      await runGh(ghPath, ['pr', 'ready', '--undo', num], root)
      url = await prUrlAfterAction(root, num, ghPath)
      break
    }
    case 'close': {
      await runGh(ghPath, ['pr', 'close', num], root)
      url = await prUrlAfterAction(root, num, ghPath)
      break
    }
    case 'reopen': {
      await runGh(ghPath, ['pr', 'reopen', num], root)
      url = await prUrlAfterAction(root, num, ghPath)
      break
    }
    default:
      throw new Error(`不支持的 PR 操作: ${String(input.action)}`)
  }

  return { repoPath: root, number: input.number, url }
}

async function prUrlAfterAction(root: string, number: string, ghPath: string): Promise<string> {
  try {
    const detail = JSON.parse(await runGh(ghPath, ['pr', 'view', number, '--json', 'url', '--jq', '.'], root)) as { url?: unknown }
    return typeof detail.url === 'string' ? detail.url : ''
  } catch {
    return ''
  }
}

/** 发表评论 */
export async function addPullRequestComment(input: PullRequestCommentInput): Promise<PullRequestCommentResult> {
  const ghPath = resolveGhPath()
  assertGhReady(ghPath)
  const root = await findGitRoot(input.repoPath)
  if (!root) throw new Error('未找到 Git 仓库根目录')

  const tmpDir = mkdtempSync(join(tmpdir(), 'myyoda-pr-comment-'))
  const bodyPath = join(tmpDir, 'comment-body.md')
  try {
    writeFileSync(bodyPath, input.body, 'utf-8')
    await runGh(ghPath, ['pr', 'comment', String(input.number), '--body-file', bodyPath], root)
    return { url: '' }
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // 忽略清理失败
    }
  }
}

/** 检出 PR 到本地（gh pr checkout，在当前 worktree 执行会切换分支） */
export async function checkoutPullRequest(repoPath: string, number: number): Promise<{ branch: string }> {
  const ghPath = resolveGhPath()
  assertGhReady(ghPath)
  const root = await findGitRoot(repoPath)
  if (!root) throw new Error('未找到 Git 仓库根目录')
  await runGh(ghPath, ['pr', 'checkout', String(number)], root)
  const branch = await getCurrentBranch(root)
  return { branch: branch ?? '' }
}

/** 查询分支是否被其他 worktree 占用（merge --delete-branch 安全） */
export async function getBranchWorktreeUsage(repoPath: string, branch: string): Promise<BranchWorktreeUsage> {
  const root = await findGitRoot(repoPath)
  if (!root) return { branch, worktrees: [], mainRepoOnBranch: false }
  const worktrees = await listWorktreesWithBranch(root)
  const occupied: string[] = []
  let mainRepoOnBranch = false
  for (const wt of worktrees) {
    if (wt.branch === branch) {
      if (wt.isMain) mainRepoOnBranch = true
      else occupied.push(wt.path)
    }
  }
  return { branch, worktrees: occupied, mainRepoOnBranch }
}

/** 复用 git-diff-service 的 worktree 列表；导入太重则用 git 命令轻量实现 */
async function listWorktreesWithBranch(repoPath: string): Promise<Array<{ path: string; branch: string; isMain: boolean }>> {
  try {
    const output = await runGit(repoPath, ['worktree', 'list', '--porcelain'])
    const mainRoot = await findGitRoot(repoPath)
    const result: Array<{ path: string; branch: string; isMain: boolean }> = []
    for (const block of output.split('\n\n').filter(Boolean)) {
      let path = ''
      let branch = ''
      for (const line of block.split('\n')) {
        if (line.startsWith('worktree ')) path = line.slice('worktree '.length)
        else if (line.startsWith('branch refs/heads/')) branch = line.slice('branch refs/heads/'.length)
        else if (line === 'detached') branch = '(detached)'
      }
      if (!path) continue
      result.push({
        path,
        branch,
        isMain: !!mainRoot && path.replace(/[\\/]+$/, '') === mainRoot.replace(/[\\/]+$/, ''),
      })
    }
    return result
  } catch {
    return []
  }
}
