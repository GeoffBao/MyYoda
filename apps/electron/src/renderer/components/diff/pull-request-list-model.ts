/**
 * Pull Request 列表分组纯函数（视图模型）
 *
 * 左侧栏 PR 入口把 open PR 按 viewer 参与度分组：
 *  - reviewing：viewer 被要求 review（reviewRequests 命中）或 review 待处理
 *  - authored：viewer 是作者
 *  - others：其余
 * 逻辑参考 synara `pullRequestList.logic.ts` 的 involvement 分组。
 */

import type { PullRequestListEntry } from '@myyoda/shared'

export type PullRequestGroupKey = 'reviewing' | 'authored' | 'others'

export interface PullRequestGroup {
  key: PullRequestGroupKey
  title: string
  entries: PullRequestListEntry[]
}

const GROUP_META: Record<PullRequestGroupKey, { title: string }> = {
  reviewing: { title: '待我 Review' },
  authored: { title: '我创建的' },
  others: { title: '其他' },
}

/** 判断一条 PR 是否属于「待我 review」组 */
export function isReviewingForViewer(entry: PullRequestListEntry, viewer: string | null): boolean {
  if (!viewer) return false
  if (entry.viewerReviewRequested) return true
  // 无 reviewRequests 数据时用 reviewDecision 兜底：待处理/需变更 视为待我 review
  if (entry.reviewDecision === 'REVIEW_REQUIRED' || entry.reviewDecision === 'CHANGES_REQUESTED') {
    return true
  }
  return false
}

/** 判断一条 PR 是否属于「我创建的」组 */
export function isAuthoredByViewer(entry: PullRequestListEntry, viewer: string | null): boolean {
  if (!viewer) return false
  return entry.author?.login === viewer
}

/** 按 viewer 参与度分组（reviewing 优先于 authored；两者都不命中进 others） */
export function groupPullRequests(
  entries: PullRequestListEntry[],
  viewer: string | null,
): PullRequestGroup[] {
  const reviewing: PullRequestListEntry[] = []
  const authored: PullRequestListEntry[] = []
  const others: PullRequestListEntry[] = []

  for (const entry of entries) {
    if (isReviewingForViewer(entry, viewer)) {
      reviewing.push(entry)
    } else if (isAuthoredByViewer(entry, viewer)) {
      authored.push(entry)
    } else {
      others.push(entry)
    }
  }

  return [
    { key: 'reviewing', title: GROUP_META.reviewing.title, entries: reviewing },
    { key: 'authored', title: GROUP_META.authored.title, entries: authored },
    { key: 'others', title: GROUP_META.others.title, entries: others },
  ]
}

/** 分组计数角标：待我 review 数（>99 显示 99+，复用 formatSidebarModuleCount 语义） */
export function formatPrListCount(count: number): string {
  return count > 99 ? '99+' : String(count)
}

/** 参与度筛选：all 返回全部；reviewing 只保留待 review；authored 只保留我创建的 */
export function filterByInvolvement(
  entries: PullRequestListEntry[],
  involvement: 'all' | 'reviewing' | 'authored',
  viewer: string | null,
): PullRequestListEntry[] {
  if (involvement === 'all') return entries
  if (involvement === 'reviewing') {
    return entries.filter((e) => isReviewingForViewer(e, viewer))
  }
  return entries.filter((e) => isAuthoredByViewer(e, viewer))
}

/** 按搜索词过滤 PR（标题 / 编号 / head 分支 / 作者 / 仓库名） */
export function filterBySearch(entries: PullRequestListEntry[], query: string): PullRequestListEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return entries
  return entries.filter((e) =>
    e.title.toLowerCase().includes(q)
    || String(e.number).includes(q)
    || e.headBranch.toLowerCase().includes(q)
    || e.repositoryName.toLowerCase().includes(q)
    || (e.author?.login ?? '').toLowerCase().includes(q)
  )
}
