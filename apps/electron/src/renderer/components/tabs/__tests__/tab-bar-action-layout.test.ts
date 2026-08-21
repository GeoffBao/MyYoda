import { describe, expect, test } from 'bun:test'
import { getTabBarActionLayout } from '../tab-bar-action-layout'

describe('getTabBarActionLayout', () => {
  test('Given mac + 面板+浏览器+终端+画布全部存在 When 计算布局 Then 预留宽度比只有终端多 36px', () => {
    const withoutCanvas = getTabBarActionLayout(false, true, true, true, false)
    const withCanvas = getTabBarActionLayout(false, true, true, true, true)
    expect(withoutCanvas.scrollPaddingClassName).toBe('pr-[148px]')
    expect(withCanvas.scrollPaddingClassName).toBe('pr-[184px]')
  })

  test('Given windows + 全部按钮存在 When 计算布局 Then 预留宽度比只有终端多 36px', () => {
    const withoutCanvas = getTabBarActionLayout(true, true, true, true, false)
    const withCanvas = getTabBarActionLayout(true, true, true, true, true)
    expect(withoutCanvas.scrollPaddingClassName).toBe('pr-[282px]')
    expect(withCanvas.scrollPaddingClassName).toBe('pr-[318px]')
  })

  test('Given 没有终端按钮 When 传入 hasCanvasButton=true Then 画布参数被忽略（画布固定排终端左边，终端不在时画布也不显示）', () => {
    const layout = getTabBarActionLayout(false, true, true, false, true)
    expect(layout.scrollPaddingClassName).toBe('pr-28')
  })
})
