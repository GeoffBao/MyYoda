/**
 * WorktreeSelector 的纯模型函数：detached 判定、展示名、排序、折叠判定。
 * 与组件分离以便单测；UI 展示逻辑都集中在这里。
 */
import type { WorktreeInfo } from '@myyoda/shared'

/** detached HEAD 的 worktree 通常由外部工具（Claude Code 等）自动生成，对"文件改动"面板是噪音 */
export function isDetached(wt: WorktreeInfo): boolean {
  return wt.branch === '(detached)'
}

/** worktree 展示名：有分支用分支名，detached 用目录名（用户能认出的部分） */
export function worktreeDisplayName(wt: WorktreeInfo): string {
  return isDetached(wt) ? wt.name : wt.branch
}

/**
 * 排序：有分支名的在前（用户/团队真正在用的），detached 残留排后面；同类按目录名排序。
 */
export function sortWorktreesForSelector(worktrees: WorktreeInfo[]): WorktreeInfo[] {
  return [...worktrees].sort((a, b) => {
    const aNamed = isDetached(a) ? 1 : 0
    const bNamed = isDetached(b) ? 1 : 0
    if (aNamed !== bNamed) return aNamed - bNamed
    return a.name.localeCompare(b.name)
  })
}

/**
 * detached worktree 数量超过 1 时折叠成「其他 N 个 detached worktree」，
 * 避免下拉被外部工具残留刷屏。
 */
export function shouldCollapseDetached(worktrees: WorktreeInfo[]): boolean {
  return worktrees.filter(isDetached).length > 1
}
