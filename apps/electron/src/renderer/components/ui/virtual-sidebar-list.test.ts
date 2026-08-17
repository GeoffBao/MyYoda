import { describe, expect, test } from 'bun:test'
import { shouldRemeasureOnVisibilityChange } from './virtual-sidebar-list'

describe('侧栏虚拟列表：display:none 恢复后重新测量', () => {
  test('Given 初始可见 When 首次交叉回调触发 Then 不触发 measure（避免首帧无意义调用）', () => {
    const result = shouldRemeasureOnVisibilityChange(false, true)
    expect(result).toEqual({ shouldMeasure: false, nextWasHidden: false })
  })

  test('Given 容器被祖先 display:none 隐藏 When 交叉状态变为不可见 Then 标记 wasHidden 且不 measure', () => {
    const result = shouldRemeasureOnVisibilityChange(false, false)
    expect(result).toEqual({ shouldMeasure: false, nextWasHidden: true })
  })

  test('Given 容器曾被隐藏（设置面板打开后关闭） When 恢复可见 Then 触发 measure 并清除隐藏标记', () => {
    const result = shouldRemeasureOnVisibilityChange(true, true)
    expect(result).toEqual({ shouldMeasure: true, nextWasHidden: false })
  })

  test('Given 容器持续保持隐藏 When 交叉回调再次报告不可见 Then 维持 wasHidden 不重复触发', () => {
    const result = shouldRemeasureOnVisibilityChange(true, false)
    expect(result).toEqual({ shouldMeasure: false, nextWasHidden: true })
  })

  test('Given 完整生命周期：可见→隐藏→恢复可见 When 依次应用状态转换 Then 仅在恢复时触发一次 measure', () => {
    let wasHidden = false
    const calls: boolean[] = []

    const apply = (isIntersecting: boolean): void => {
      const { shouldMeasure, nextWasHidden } = shouldRemeasureOnVisibilityChange(wasHidden, isIntersecting)
      wasHidden = nextWasHidden
      calls.push(shouldMeasure)
    }

    apply(true) // 初始挂载即可见
    apply(false) // 设置面板打开，祖先 display:none
    apply(true) // 设置面板关闭，恢复可见

    expect(calls).toEqual([false, false, true])
  })
})
