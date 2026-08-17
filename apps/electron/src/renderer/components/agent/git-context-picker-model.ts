import type { GitBranchInfo, GitExecutionMode } from '@myyoda/shared'

export function sortGitBranchesForPicker(branches: readonly GitBranchInfo[]): GitBranchInfo[] {
  return [...branches].sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1
    if (a.local !== b.local) return a.local ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

export function filterGitBranches(branches: readonly GitBranchInfo[], query: string): GitBranchInfo[] {
  const normalizedQuery = query.trim().toLowerCase()
  const sorted = sortGitBranchesForPicker(branches)
  if (!normalizedQuery) return sorted
  return sorted.filter((branch) => branch.name.toLowerCase().includes(normalizedQuery))
}

/**
 * 分支下拉里的辅助文案。
 * 被其他 worktree 检出的分支只显示「检出于 <目录名>」的短提示，完整路径放进 title 属性，
 * 避免长路径把下拉行撑爆；占用语义（Local 下不可 checkout）由调用方另行渲染。
 */
export function formatGitBranchSubtitle(branch: GitBranchInfo): string {
  // current 优先：主 worktree 也会出现在 git worktree list 里，导致当前分支带 checkedOutPath，
  // 若先判断占用会把「当前分支」误标成「检出于 <主仓库目录>」。
  if (branch.current) return '当前分支'
  if (branch.checkedOutPath) {
    const segments = branch.checkedOutPath.split(/[\\/]/).filter(Boolean)
    const name = segments[segments.length - 1]
    return `检出于 ${name ?? branch.checkedOutPath}`
  }
  if (branch.upstream) return `跟踪 ${branch.upstream}`
  return branch.local ? '本地分支' : '远端分支'
}

/**
 * 解析首次挂载时的执行模式：
 * 1. 会话已绑定的 Git 上下文（重开空会话时优先回显，避免误建新 worktree）
 * 2. 该仓库上一次使用的模式（localStorage 按 repoPath 记忆，跨工作区/项目稳定）
 * 3. 默认 Local（安全：不意外创建 worktree）
 */
export function resolveInitialGitExecutionMode(input: {
  initialMode?: GitExecutionMode
  rememberedMode?: string
}): GitExecutionMode {
  if (input.initialMode === 'local' || input.initialMode === 'worktree') return input.initialMode
  return input.rememberedMode === 'worktree' ? 'worktree' : 'local'
}

export function canCheckoutBranchInLocal(branch: GitBranchInfo): boolean {
  return !branch.checkedOutPath || branch.current
}

/**
 * 模式记忆按「仓库路径」而不是项目/工作区 ID：同一个 repo 在不同工作区（或旧
 * projectId 模型）下共享偏好，也避免 workspace 化后 projectId 为 undefined 时
 * 所有新会话共用一个记忆键的缺陷。
 */
export function getGitModeStorageKey(repoPath: string): string {
  return `myyoda:git:execution-mode:${repoPath.replace(/[\\/]+$/, '')}`
}

/**
 * 判断会话已绑定的仓库与当前选择器目标仓库是否同一个 repo。
 * 会话绑定的是 repo root（git rev-parse --show-toplevel），而工作区可能绑定
 * 仓库内的子目录，因此用「相同或子路径」判定，保证子目录绑定的工作区也能回显。
 */
export function isSameBoundRepo(boundRepoPath: string | undefined, targetRepoPath: string): boolean {
  if (!boundRepoPath) return false
  // 大小写宽松：macOS/Windows 文件系统默认大小写不敏感，漏判会导致回显失效、
  // 重发时误建第二个 worktree（后果比 Linux 下误判两个同名不同大小写目录更重）。
  const bound = boundRepoPath.replace(/[\\/]+$/, '').toLowerCase()
  const target = targetRepoPath.replace(/[\\/]+$/, '').toLowerCase()
  if (bound === target) return true
  return target.startsWith(`${bound}/`) || target.startsWith(`${bound}\\`)
}

/**
 * Local 模式发送前解析最终分支：用户「未显式选择」分支时，跟随仓库实际 checkout
 * 的当前分支，而不是坚持发送时已经过期的选择器快照。
 *
 * 背景：选择器只在挂载时加载一次分支列表，若加载后用户在终端（或其他 Local 会话）
 * 切换了分支，发送时旧快照会触发一次意外的分支切换；仓库有未提交改动时还会被主进程
 * 守卫拦住报错。Local 模式的语义是与终端共享同一工作目录，默认选择跟随真实状态
 * 更符合直觉（显式选择的分支仍按原语义尝试切换，由主进程守卫保护）。
 *
 * detached HEAD 时 getGitRepoStatus 的 branch 是字符串 'HEAD'（git rev-parse
 * --abbrev-ref HEAD 的产物）而非 null，这里显式视为「无当前分支」保持原选择——
 * 原分支（若存在）从 detached 状态切回是安全的，而把 'HEAD' 作为目标会让
 * prepareSessionGitContext 的 `git switch HEAD` 直接 fatal。
 */
export function resolveLocalSendBranch(input: {
  executionMode: GitExecutionMode
  branch: string
  newBranchName?: string
  explicit?: boolean
  currentBranch: string | null
}): string {
  if (input.executionMode !== 'local') return input.branch
  if (input.newBranchName) return input.branch
  if (input.explicit) return input.branch
  if (!input.currentBranch || input.currentBranch === 'HEAD') return input.branch
  if (input.currentBranch === input.branch) return input.branch
  return input.currentBranch
}

/** 会话头部 Git 上下文常驻小徽标文案；无 gitBranch 时返回 null（会话未绑定 Git 上下文） */
export function formatSessionGitBadge(meta: {
  gitBranch?: string
  gitExecutionMode?: GitExecutionMode
  gitWorktreePath?: string
}): string | null {
  if (!meta.gitBranch) return null
  if (meta.gitExecutionMode === 'worktree') {
    const segments = (meta.gitWorktreePath ?? '').split(/[\\/]/).filter(Boolean)
    const name = segments[segments.length - 1]
    return `Worktree${name ? ` ${name}` : ''} · ${meta.gitBranch}`
  }
  return `Local · ${meta.gitBranch}`
}
