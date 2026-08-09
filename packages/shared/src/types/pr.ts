/**
 * Pull Request 相关类型定义
 *
 * 数据源为本机 `gh`（GitHub CLI），所有鉴权走用户本机 `gh auth login`，
 * MyYoda 不存储任何 GitHub 凭证（与社区 Skill 提交一致）。
 * 类型参考 synara `packages/contracts/src/pullRequests.ts`，转成 TS interface 风格。
 */

import type { GhCliStatus } from './agent'

/** PR 状态 */
export type PullRequestState = 'open' | 'closed' | 'merged'

/** PR 合并方式 */
export type PullRequestMergeMethod = 'merge' | 'squash' | 'rebase'

/** PR 操作动作 */
export type PullRequestAction = 'merge' | 'ready' | 'draft' | 'close' | 'reopen'

/** PR 涉及范围（列表筛选） */
export type PullRequestInvolvement = 'all' | 'reviewing' | 'authored'

/** 作者/参与者 */
export interface PullRequestActor {
  login: string
  name: string | null
  avatarUrl: string | null
  url: string | null
}

/** 标签 */
export interface PullRequestLabel {
  name: string
  color: string | null
}

/** CI 检查状态 */
export type PullRequestCheckStatus = 'pending' | 'success' | 'failure' | 'skipped' | 'neutral' | 'cancelled'

/** CI 检查 */
export interface PullRequestCheck {
  name: string
  status: PullRequestCheckStatus
  description: string | null
  url: string | null
  startedAt: string | null
  completedAt: string | null
}

/** 评论类型 */
export type PullRequestCommentKind = 'issue-comment' | 'review-comment' | 'review'

/** 评论/审查意见 */
export interface PullRequestComment {
  id: string
  kind: PullRequestCommentKind
  author: PullRequestActor | null
  body: string
  createdAt: string
  updatedAt: string | null
  url: string | null
  path: string | null
  reviewState: string | null
}

/** 提交 */
export interface PullRequestCommit {
  oid: string
  messageHeadline: string
  messageBody: string
  committedDate: string
  authors: PullRequestActor[]
}

/** 合并能力（由 gh 探测得出） */
export interface PullRequestMergeCapabilities {
  merge: boolean
  squash: boolean
  rebase: boolean
  deleteBranchOnMerge: boolean
}

/** PR 列表条目 */
export interface PullRequestListEntry {
  /** 所属 Git 仓库根目录（绝对路径） */
  repository: string
  /** 仓库显示名（如 "LuxAgents"） */
  repositoryName: string
  number: number
  title: string
  url: string
  author: PullRequestActor | null
  headBranch: string
  baseBranch: string
  state: PullRequestState
  isDraft: boolean
  additions: number
  deletions: number
  createdAt: string
  updatedAt: string
  /** review 结论：'APPROVED' / 'CHANGES_REQUESTED' / 'REVIEW_REQUIRED' 等 */
  reviewDecision: string | null
  /** 是否要求当前用户 review */
  viewerReviewRequested: boolean
  labels: PullRequestLabel[]
}

/** PR 列表输入 */
export interface PullRequestsListInput {
  /** 按当前用户参与度筛选；不传返回全部 open PR */
  involvement?: PullRequestInvolvement
  /** PR 状态筛选（open/closed/merged），默认 open */
  state?: PullRequestState
  /** 只列出指定仓库（绝对路径）下的 PR；不传则尝试自动收集候选仓库 */
  repoPaths?: string[]
  /** 强制刷新（跳过缓存） */
  forceRefresh?: boolean
}

/** PR 列表结果 */
export interface PullRequestsListResult {
  /** 当前 gh 登录用户（viewer），未登录为 null */
  viewer: string | null
  entries: PullRequestListEntry[]
}

/** PR 详情 */
export interface PullRequestDetail {
  repository: string
  repositoryName: string
  number: number
  title: string
  body: string
  url: string
  author: PullRequestActor | null
  state: PullRequestState
  isDraft: boolean
  mergeable: string | null
  mergeStateStatus: string | null
  reviewDecision: string | null
  additions: number
  deletions: number
  changedFiles: number
  headBranch: string
  baseBranch: string
  createdAt: string
  updatedAt: string
  mergedAt: string | null
  closedAt: string | null
  maintainerCanModify: boolean
  reviewers: PullRequestActor[]
  labels: PullRequestLabel[]
  checks: PullRequestCheck[]
  comments: PullRequestComment[]
  commentsTruncated: boolean
  commits: PullRequestCommit[]
  mergeCapabilities: PullRequestMergeCapabilities
}

/** PR 详情输入 */
export interface PullRequestDetailInput {
  repoPath: string
  number: number
}

/** PR diff 结果 */
export interface PullRequestDiffResult {
  patch: string
  truncated: boolean
}

/** PR 操作输入（merge/ready/draft/close/reopen） */
export interface PullRequestActionInput {
  repoPath: string
  number: number
  action: PullRequestAction
  mergeMethod?: PullRequestMergeMethod
  /** merge 时是否删除 head 分支 */
  deleteBranch?: boolean
}

/** PR 操作结果 */
export interface PullRequestActionResult {
  repoPath: string
  number: number
  /** 操作后的 PR url */
  url: string
}

/** 评论输入 */
export interface PullRequestCommentInput {
  repoPath: string
  number: number
  body: string
}

/** 评论结果 */
export interface PullRequestCommentResult {
  url: string
}

/** 创建 PR 输入 */
export interface CreatePullRequestInput {
  /** Git 仓库根目录（绝对路径） */
  repoPath: string
  headBranch: string
  baseBranch: string
  title: string
  body: string
  /** 创建为 Draft PR */
  draft?: boolean
  /** 当前在默认分支上时，自动创建 feature 分支（feat/<branch>-<date>）并切换再继续 */
  autoCreateFeatureBranch?: boolean
  /** 不传 title/body 时，主进程从分支名/最近提交自动生成（配合默认标题） */
  autoGenerateTitleAndBody?: boolean
}

/** 创建 PR 结果 */
export interface CreatePullRequestResult {
  number: number
  url: string
  /** 是否复用了已存在的 open PR（duplicate-PR 防护） */
  reusedExisting: boolean
}

/** 当前分支关联的 open PR（文件改动面板状态行用） */
export interface CurrentBranchPullRequest {
  repoPath: string
  number: number
  title: string
  url: string
  isDraft: boolean
  state: PullRequestState
  checksSummary: {
    pending: number
    success: number
    failure: number
  }
}

/** 分支是否被其他 worktree 占用（merge --delete-branch 安全检查） */
export interface BranchWorktreeUsage {
  branch: string
  /** 占用该分支的 worktree 绝对路径；空数组表示未被其他 worktree 占用 */
  worktrees: string[]
  /** 当前仓库主目录是否也在该分支上 */
  mainRepoOnBranch: boolean
}

/** 当前分支的 Git 推送状态（PR 按钮状态机输入） */
export interface GitPrStatus {
  branch: string | null
  /** 当前分支是否是默认分支（main/master） */
  isDefaultBranch: boolean
  hasUpstream: boolean
  /** 本地领先上游的提交数 */
  aheadCount: number
  /** 本地落后上游的提交数 */
  behindCount: number
  hasOriginRemote: boolean
  hasChanges: boolean
  /** Git 仓库根目录（绝对路径） */
  repoPath: string | null
}

/** PR 状态行面板的一次性拉取结果（gh 状态 + git 状态 + 当前分支 PR） */
export interface PullRequestPanelState {
  gh: GhCliStatus
  git: GitPrStatus
  currentBranchPr: CurrentBranchPullRequest | null
}

/** PR 相关 IPC 通道常量 */
export const PR_IPC_CHANNELS = {
  /** 获取本机 gh CLI 状态 */
  GH_STATUS: 'pr:gh-status',
  /** 获取 PR 状态行面板的一次性数据（gh + git + 当前分支 PR） */
  PANEL_STATE: 'pr:panel-state',
  /** 获取当前分支关联的 open PR */
  GET_CURRENT_BRANCH_PR: 'pr:get-current-branch-pr',
  /** 获取仓库默认分支名（main/master） */
  GET_DEFAULT_BRANCH: 'pr:get-default-branch',
  /** 创建 PR（含 push + duplicate 防护） */
  CREATE: 'pr:create',
  /** 列出 open PR（可分组） */
  LIST: 'pr:list',
  /** 获取 PR 详情 */
  DETAIL: 'pr:detail',
  /** 获取 PR diff */
  DIFF: 'pr:diff',
  /** PR 操作（merge/ready/draft/close/reopen） */
  ACTION: 'pr:action',
  /** 发表评论 */
  COMMENT: 'pr:comment',
  /** 检出 PR 到本地 */
  CHECKOUT: 'pr:checkout',
  /** 查询分支是否被其他 worktree 占用（merge --delete-branch 安全） */
  BRANCH_WORKTREE_USAGE: 'pr:branch-worktree-usage',
} as const

export type PrIpcChannel = (typeof PR_IPC_CHANNELS)[keyof typeof PR_IPC_CHANNELS]
