import { describe, expect, test } from 'bun:test'
import { computeRightWorkspaceLayout, type RightWorkspacePanel } from '../right-workspace-layout'

describe('computeRightWorkspaceLayout', () => {
  test('Given 只有 browser 可见 When 计算布局 Then browser 占满、其余无样式', () => {
    const result = computeRightWorkspaceLayout(['browser'], 0.5, 0.58)
    expect(result.browser).toEqual({ flex: '1 1 auto' })
    expect(result.doc).toBeUndefined()
    expect(result.scratch).toBeUndefined()
  })

  test('Given browser + doc 可见 When 计算布局 Then 按 browserRatio 二分', () => {
    const result = computeRightWorkspaceLayout(['browser', 'doc'], 0.4, 0.58)
    expect(result.browser).toEqual({ flex: '0 0 calc(40% - 4px)' })
    expect(result.doc).toEqual({ flex: '1 1 auto' })
  })

  test('Given doc + scratch 可见（无 browser）When 计算布局 Then 复用 docScratchRatio，行为与改造前一致', () => {
    const result = computeRightWorkspaceLayout(['doc', 'scratch'], 0.4, 0.58)
    expect(result.doc).toEqual({ flex: '0 0 calc(58% - 4px)' })
    expect(result.scratch).toEqual({ flex: '1 1 auto' })
  })

  test('Given 三栏全部可见 When 计算布局 Then browser 用 browserRatio，doc/scratch 在剩余空间内再按 docScratchRatio 二分', () => {
    const result = computeRightWorkspaceLayout(['browser', 'doc', 'scratch'], 0.4, 0.58)
    expect(result.browser).toEqual({ flex: '0 0 calc(40% - 4px)' })
    // 剩余 60% 空间内，doc:scratch = 0.58:0.42 → doc 应占整体的 60% * 58% = 34.8%
    expect(result.doc).toEqual({ flex: '0 0 calc(34.8% - 4px)' })
    expect(result.scratch).toEqual({ flex: '1 1 auto' })
  })

  test('Given 空数组 When 计算布局 Then 返回空对象', () => {
    expect(computeRightWorkspaceLayout([], 0.4, 0.58)).toEqual({})
  })
})
