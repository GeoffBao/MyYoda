/**
 * Pull Request 按钮状态机 — 纯函数（视图模型）
 *
 * 输入：gh 状态 + git 状态 + 当前分支关联的 open PR，
 * 输出：主操作按钮的文案 / 可用性 / hint，供文件改动面板状态行渲染。
 * 逻辑参考 synara `GitActionsControl.logic.ts` 的 `resolveQuickAction`，
 * 按 LuxCoder 的「一个主操作按钮」交互收敛。
 */

import type {
  CurrentBranchPullRequest,
  GitPrStatus,
  GhCliStatus,
} from '@myyoda/shared'

/** 主操作动作类型 */
export type PullRequestPrimaryActionKind =
  /** 分支超前远程 + 无 open PR：Push & create PR（一步到位） */
  | 'push_and_create_pr'
  /** 已有 open PR：View PR（打开详情 Tab） */
  | 'view_pr'
  /** 默认分支上：先引导创建 feature 分支（确认框） */
  | 'default_branch_guide'
  /** gh 未安装/未登录：引导安装或登录 */
  | 'gh_setup'
  /** 无 origin remote / 无改动 / 已同步：禁用 + hint */
  | 'disabled'
  /** 分支落后远程：先拉取/同步（禁用 PR 创建） */
  | 'sync_needed'

export interface PullRequestPrimaryAction {
  kind: PullRequestPrimaryActionKind
  label: string
  disabled: boolean
  /** 禁用/引导时的提示文案（可展示在按钮旁） */
  hint: string | null
}

const GH_SETUP_HINT_INSTALL = '未检测到 gh（GitHub CLI）。安装后即可一键创建 PR：https://cli.github.com/'
const GH_SETUP_HINT_LOGIN = 'gh 未登录。运行 `gh auth login` 后即可创建 PR。'
const DEFAULT_BRANCH_HINT = '当前在默认分支上，PR 需要先创建 feature 分支。'
const SYNC_HINT = '当前分支落后远程，先同步（pull/rebase）再创建 PR。'
const NO_ORIGIN_HINT = '仓库没有 origin 远程，无法推送。'
const NO_CHANGES_HINT = '当前分支没有可推送的改动。'
const UP_TO_DATE_HINT = '分支已同步，没有需要创建 PR 的提交。'
const DETACHED_HINT = '当前处于 detached HEAD，请先检出分支。'

/**
 * 解析文件改动面板的 PR 主操作按钮。
 *
 * 优先级（从高到低）：
 * 1. gh 未安装/未登录 → gh_setup（禁用，引导）
 * 2. 无 git 状态/无分支 → disabled（detached hint）
 * 3. 已有 open PR → view_pr（打开详情）
 * 4. 分支落后远程 → sync_needed（禁用）
 * 5. 默认分支 → default_branch_guide（可点击，弹确认框创建 feature 分支）
 * 6. 无 origin → disabled
 * 7. 有 ahead 提交（或已推送）→ push_and_create_pr
 * 8. 其他 → disabled（无改动/已同步）
 */
export function resolvePullRequestPrimaryAction(input: {
  gh: GhCliStatus | null
  git: GitPrStatus | null
  currentBranchPr: CurrentBranchPullRequest | null
}): PullRequestPrimaryAction {
  const { gh, git, currentBranchPr } = input

  // gh 未就绪
  if (!gh?.installed) {
    return { kind: 'gh_setup', label: '创建 PR', disabled: true, hint: GH_SETUP_HINT_INSTALL }
  }
  if (!gh.authenticated) {
    return { kind: 'gh_setup', label: '创建 PR', disabled: true, hint: GH_SETUP_HINT_LOGIN }
  }

  // git 状态缺失
  if (!git?.repoPath) {
    return { kind: 'disabled', label: '创建 PR', disabled: true, hint: '当前目录不是 Git 仓库。' }
  }
  if (!git.branch) {
    return { kind: 'disabled', label: '创建 PR', disabled: true, hint: DETACHED_HINT }
  }

  // 已有 open PR：主操作变成查看
  if (currentBranchPr) {
    return { kind: 'view_pr', label: '查看 PR', disabled: false, hint: null }
  }

  // 落后远程：先同步
  if (git.behindCount > 0) {
    return { kind: 'sync_needed', label: '创建 PR', disabled: true, hint: SYNC_HINT }
  }

  // 默认分支：引导创建 feature 分支
  if (git.isDefaultBranch) {
    return {
      kind: 'default_branch_guide',
      label: git.hasChanges || git.aheadCount > 0 ? 'Push & create PR' : '创建 PR',
      disabled: !git.hasChanges && git.aheadCount <= 0,
      hint: DEFAULT_BRANCH_HINT,
    }
  }

  // 无 origin
  if (!git.hasOriginRemote) {
    return { kind: 'disabled', label: '创建 PR', disabled: true, hint: NO_ORIGIN_HINT }
  }

  // 有可推送的提交（ahead 或未推送分支带提交），或分支已推送但还没建 PR（hasUpstream，push 幂等）
  if (git.aheadCount > 0 || git.hasUpstream || git.hasChanges) {
    return { kind: 'push_and_create_pr', label: 'Push & create PR', disabled: false, hint: null }
  }

  // 无改动且已同步
  return { kind: 'disabled', label: '创建 PR', disabled: true, hint: git.hasUpstream ? UP_TO_DATE_HINT : NO_CHANGES_HINT }
}

/** 生成默认 PR 标题（从分支名推断） */
export function defaultPullRequestTitle(branch: string | null): string {
  if (!branch) return 'Untitled PR'
  const cleaned = branch.replace(/^feat[/_-]|^feature[/_-]|^fix[/_-]|^chore[/_-]|^docs[/_-]|^refactor[/_-]|^release[/_-]/i, '')
  const words = cleaned
    .split(/[/_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
  return words.join(' ') || branch
}

/** PR 状态行徽标：CI 汇总文本（如 "✓ 2 · 1 失败"），无检查时返回 null */
export function checksSummaryLabel(summary: CurrentBranchPullRequest['checksSummary'] | undefined): string | null {
  if (!summary) return null
  if (summary.pending === 0 && summary.success === 0 && summary.failure === 0) return null
  const parts: string[] = []
  if (summary.success > 0) parts.push(`✓ ${summary.success}`)
  if (summary.pending > 0) parts.push(`… ${summary.pending}`)
  if (summary.failure > 0) parts.push(`✗ ${summary.failure}`)
  return parts.join(' · ')
}
