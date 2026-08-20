import { describe, expect, test } from 'bun:test'
import { ensureWindowBoundsVisible, normalizeWindowBoundsToVisibleArea, type WindowBoundsController, type WindowDisplayLike } from './main-window-lifecycle'

const PRIMARY: WindowDisplayLike = { workArea: { x: 0, y: 0, width: 1920, height: 1080 } }
const OPTIONS = { minWidth: 800, minHeight: 600, fallbackWidth: 1400, fallbackHeight: 900 }

describe('normalizeWindowBoundsToVisibleArea', () => {
  test('完全无交叠（外接显示器断开）时重新居中到主屏', () => {
    const bounds = { x: 3000, y: 3000, width: 1400, height: 900 }
    const result = normalizeWindowBoundsToVisibleArea(bounds, [PRIMARY], PRIMARY, OPTIONS)
    expect(result.x).toBe(Math.round((1920 - 1400) / 2))
    expect(result.y).toBe(Math.round((1080 - 900) / 2))
    expect(result.width).toBe(1400)
    expect(result.height).toBe(900)
  })

  test('完全落在可见区域内时原样保留', () => {
    const bounds = { x: 100, y: 100, width: 1200, height: 800 }
    const result = normalizeWindowBoundsToVisibleArea(bounds, [PRIMARY], PRIMARY, OPTIONS)
    expect(result).toEqual(bounds)
  })

  // Codex review 发现的回归点：旧实现只要任意 1px 交叠就视为可见，
  // 会导致标题栏（唯一可拖拽找回窗口的位置）完全在屏外时窗口仍判定为"可见"而不重新定位。
  test('仅 1px 边缘交叠（标题栏不可达）时视为不可见并重新居中，而不是原样保留', () => {
    // 窗口标题栏顶部仅剩最右下角 1px 落在主屏内，标题栏区域实际不可达
    const bounds = { x: 1919, y: 1079, width: 1400, height: 900 }
    const result = normalizeWindowBoundsToVisibleArea(bounds, [PRIMARY], PRIMARY, OPTIONS)
    expect(result).not.toEqual(bounds)
    expect(result.x).toBe(Math.round((1920 - 1400) / 2))
    expect(result.y).toBe(Math.round((1080 - 900) / 2))
  })

  test('标题栏有达到最小可用宽高的交叠时原样保留（不误判为不可见）', () => {
    // 窗口整体向左越界，但 y=0 保证标题栏在垂直方向完全落在主屏内，
    // 水平方向仅剩 200px 宽度可见，超过最小可用阈值（120px）
    const bounds = { x: -1200, y: 0, width: 1400, height: 900 }
    const result = normalizeWindowBoundsToVisibleArea(bounds, [PRIMARY], PRIMARY, OPTIONS)
    expect(result).toEqual(bounds)
  })

  test('多显示器场景下任一显示器有可用标题栏交叠即视为可见', () => {
    const secondary: WindowDisplayLike = { workArea: { x: 1920, y: 0, width: 1920, height: 1080 } }
    const bounds = { x: 1800, y: 100, width: 400, height: 300 }
    const result = normalizeWindowBoundsToVisibleArea(bounds, [PRIMARY, secondary], PRIMARY, OPTIONS)
    expect(result).toEqual(bounds)
  })

  test('primaryDisplay.workArea 不可用时回退到硬编码默认尺寸', () => {
    const brokenPrimary: WindowDisplayLike = { workArea: { x: 0, y: 0, width: Number.NaN, height: 0 } }
    const bounds = { x: 9999, y: 9999, width: 1400, height: 900 }
    const result = normalizeWindowBoundsToVisibleArea(bounds, [], brokenPrimary, OPTIONS)
    expect(result.width).toBeGreaterThan(0)
    expect(result.height).toBeGreaterThan(0)
    expect(Number.isFinite(result.x)).toBe(true)
    expect(Number.isFinite(result.y)).toBe(true)
  })

  test('minWidth/minHeight 大于目标显示器尺寸时收缩不超出显示器范围', () => {
    const tinyDisplay: WindowDisplayLike = { workArea: { x: 0, y: 0, width: 640, height: 480 } }
    const bounds = { x: 5000, y: 5000, width: 1400, height: 900 }
    const result = normalizeWindowBoundsToVisibleArea(bounds, [tinyDisplay], tinyDisplay, { ...OPTIONS, minWidth: 800, minHeight: 600 })
    expect(result.width).toBeLessThanOrEqual(640)
    expect(result.height).toBeLessThanOrEqual(480)
  })
})

describe('ensureWindowBoundsVisible', () => {
  function makeWin(bounds: { x: number, y: number, width: number, height: number }, opts: { maximized?: boolean, fullScreen?: boolean } = {}): WindowBoundsController & { setBoundsCalls: typeof bounds[] } {
    const setBoundsCalls: (typeof bounds)[] = []
    return {
      isMaximized: () => opts.maximized ?? false,
      isFullScreen: () => opts.fullScreen ?? false,
      getBounds: () => bounds,
      setBounds: (b) => { setBoundsCalls.push(b) },
      setBoundsCalls,
    }
  }

  test('窗口不可见时调用 setBounds 重新定位并返回 true', () => {
    const win = makeWin({ x: 3000, y: 3000, width: 1400, height: 900 })
    const repositioned = ensureWindowBoundsVisible(win, [PRIMARY], PRIMARY, OPTIONS)
    expect(repositioned).toBe(true)
    expect(win.setBoundsCalls.length).toBe(1)
  })

  test('窗口已可见时不调用 setBounds，返回 false', () => {
    const win = makeWin({ x: 100, y: 100, width: 1200, height: 800 })
    const repositioned = ensureWindowBoundsVisible(win, [PRIMARY], PRIMARY, OPTIONS)
    expect(repositioned).toBe(false)
    expect(win.setBoundsCalls.length).toBe(0)
  })

  test('最大化窗口不主动覆盖 bounds（平台相关系统值，如 Windows 不可见边框）', () => {
    const win = makeWin({ x: 3000, y: 3000, width: 1400, height: 900 }, { maximized: true })
    const repositioned = ensureWindowBoundsVisible(win, [PRIMARY], PRIMARY, OPTIONS)
    expect(repositioned).toBe(false)
    expect(win.setBoundsCalls.length).toBe(0)
  })

  test('全屏窗口不主动覆盖 bounds（如 macOS 全屏包含菜单栏区域）', () => {
    const win = makeWin({ x: 3000, y: 3000, width: 1400, height: 900 }, { fullScreen: true })
    const repositioned = ensureWindowBoundsVisible(win, [PRIMARY], PRIMARY, OPTIONS)
    expect(repositioned).toBe(false)
    expect(win.setBoundsCalls.length).toBe(0)
  })
})
