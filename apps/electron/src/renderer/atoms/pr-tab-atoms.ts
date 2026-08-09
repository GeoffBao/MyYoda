/**
 * PR Tab Atoms — PR 详情 Tab 的运行期状态
 *
 * 与 preview（每会话一个预览文件）不同，PR Tab 是「一个 PR 一个 Tab、可同时开多个」，
 * 因此不复用 previewFileMapAtom，单独维护一层 Map<tabId, PrTabState>。
 * key 与 tab-atoms 的 PR Tab ID 一致（__pr__:<repoPath>::<number>）。
 */

import { atom } from 'jotai'

/** PR Tab 的状态 */
export interface PrTabState {
  repoPath: string
  number: number
  /** PR 标题（Tab 标题用） */
  title: string
  /** 是否正在加载详情 */
  loading: boolean
  /** 详情加载错误（null = 无错误） */
  error: string | null
  /** 当前激活的详情子 Tab（summary / code / timeline） */
  activeSection: 'summary' | 'code' | 'timeline'
  /** 是否需要刷新（合并/评论/状态变化后置 true，重新拉详情） */
  needsRefresh: boolean
}

/** PR Tab 状态 Map：key = PR Tab ID（__pr__:<repoPath>::<number>） */
export const pullRequestTabStateMapAtom = atom<Map<string, PrTabState>>(new Map())
