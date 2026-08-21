import type * as React from 'react'

export type RightWorkspacePanel = 'browser' | 'doc' | 'scratch'

/**
 * 计算右侧工作区最多三栏（browser / doc / scratch）的 flex 样式。
 *
 * 规则：
 * - 0 栏：返回空对象
 * - 1 栏：该栏 flex: 1 1 auto（占满）
 * - browser 和其余（doc/scratch 中可见的部分）两侧用 browserRatio 二分
 * - doc 和 scratch 两者都可见时，在各自所在的可用宽度内用 docScratchRatio 二分
 * - 每一侧「非最后一个可见栏」用 `flex: 0 0 calc(N% - 4px)`（4px 给拖拽分隔条留白，
 *   和现有 previewPaneStyle/scratchPaneStyle 的 -4px 约定一致），最后一个可见栏用
 *   `flex: 1 1 auto` 吃掉剩余空间，避免因浮点误差导致最后一栏差几像素。
 */
export function computeRightWorkspaceLayout(
  visiblePanels: RightWorkspacePanel[],
  browserRatio: number,
  docScratchRatio: number,
): Partial<Record<RightWorkspacePanel, React.CSSProperties>> {
  const result: Partial<Record<RightWorkspacePanel, React.CSSProperties>> = {}
  if (visiblePanels.length === 0) return result

  const hasBrowser = visiblePanels.includes('browser')
  const hasDoc = visiblePanels.includes('doc')
  const hasScratch = visiblePanels.includes('scratch')
  const restCount = (hasDoc ? 1 : 0) + (hasScratch ? 1 : 0)

  // browser 与「其余」的第一级切分
  let restWidthPercent = 100
  if (hasBrowser && restCount > 0) {
    const browserPercent = browserRatio * 100
    restWidthPercent = 100 - browserPercent
    const browserIsLast = visiblePanels[visiblePanels.length - 1] === 'browser'
    result.browser = browserIsLast
      ? { flex: '1 1 auto' }
      : { flex: `0 0 calc(${round1(browserPercent)}% - 4px)` }
  } else if (hasBrowser) {
    result.browser = { flex: '1 1 auto' }
  }

  // doc 与 scratch 在 restWidthPercent 范围内的第二级切分
  if (hasDoc && hasScratch) {
    const docPercent = restWidthPercent * docScratchRatio
    result.doc = { flex: `0 0 calc(${round1(docPercent)}% - 4px)` }
    result.scratch = { flex: '1 1 auto' }
  } else if (hasDoc) {
    result.doc = { flex: '1 1 auto' }
  } else if (hasScratch) {
    result.scratch = { flex: '1 1 auto' }
  }

  return result
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
