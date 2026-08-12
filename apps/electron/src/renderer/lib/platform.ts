/**
 * Windows 自定义 WindowControls 按钮区域总宽度（3 buttons × ~42px）。
 * 拖拽层和内容区需避让此宽度，防止 OS hitmask 冲突。
 */
export const WINDOW_CONTROLS_WIDTH_PX = 126
export const WINDOW_CONTROLS_INSET_RIGHT = 'right-[126px]'
export const WINDOW_CONTROLS_PADDING_RIGHT = 'pr-[126px]'

/**
 * macOS 原生红绿灯（trafficLightPosition: { x: 18, y: 18 }）占用区域宽度。
 * 侧边栏展开/折叠为图标 rail 时，侧边栏自身顶部留白负责避让；但侧边栏折叠为
 * 完全隐藏（宽度 0）后，TabBar 会顶到窗口最左侧，需要自己避让，否则收起按钮
 * 和第一个标签会和红绿灯重叠。
 */
export const MAC_TRAFFIC_LIGHTS_WIDTH_PX = 80
export const MAC_TRAFFIC_LIGHTS_PADDING_LEFT = 'pl-[80px]'

export function getWindowControlsPaddingClass(isWindows: boolean): string {
  return isWindows ? WINDOW_CONTROLS_PADDING_RIGHT : ''
}

export function detectIsWindows(): boolean {
  const platform =
    typeof navigator !== 'undefined' &&
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
  if (typeof platform === 'string' && platform.toLowerCase().includes('win')) {
    return true
  }
  return typeof navigator !== 'undefined' && /win/i.test(navigator.platform || '')
}

export function detectIsMac(): boolean {
  const platform =
    typeof navigator !== 'undefined' &&
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
  if (typeof platform === 'string' && platform.toLowerCase().includes('mac')) {
    return true
  }
  return typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || '')
}
