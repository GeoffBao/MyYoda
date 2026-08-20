export interface TabBarActionLayout {
  scrollPaddingClassName: string
  shortcutPositionClassName: string
  panelPositionClassName: string
}

/**
 * 保持 Tab 栏右侧操作区与窗口控制按钮分离，同时为标签滚动区留出空间。
 * hasTerminalButton：终端按钮（28px + 8px gap）额外占用 36px。
 * hasCanvasButton：画布按钮同样占用 36px，固定排在终端按钮左边，
 * 只有 hasTerminalButton 为 true 时才会生效（画布按钮不单独出现在终端右边）。
 */
export function getTabBarActionLayout(
  isWindows: boolean,
  hasPanelButton: boolean,
  hasBrowserButton = false,
  hasTerminalButton = false,
  hasCanvasButton = false,
): TabBarActionLayout {
  const canvasExtra = hasTerminalButton && hasCanvasButton ? 36 : 0

  if (!isWindows) {
    const base = hasPanelButton
      ? (hasBrowserButton
        ? (hasTerminalButton ? 148 : 112)
        : 80)
      : (hasBrowserButton
        ? (hasTerminalButton ? 116 : 80)
        : 40)
    // 无画布按钮时保留原有的 Tailwind 静态类名（pr-28/pr-20/pr-10 等），
    // 避免不必要地改变既有产物的类名字符串；有画布按钮时数值需要动态相加，改用任意值类。
    const legacyClassName = hasPanelButton
      ? (hasBrowserButton
        ? (hasTerminalButton ? 'pr-[148px]' : 'pr-28')
        : 'pr-20')
      : (hasBrowserButton
        ? (hasTerminalButton ? 'pr-[116px]' : 'pr-20')
        : 'pr-10')
    return {
      scrollPaddingClassName: canvasExtra > 0 ? `pr-[${base + canvasExtra}px]` : legacyClassName,
      shortcutPositionClassName: hasPanelButton
        ? 'inset-y-0 items-end pb-[3px] z-10 right-9'
        : 'inset-y-0 items-end pb-[3px] z-10 right-1',
      panelPositionClassName: 'inset-y-0 right-1 items-end pb-[3px] z-10',
    }
  }

  const base = hasPanelButton
    ? (hasBrowserButton
      ? (hasTerminalButton ? 282 : 246)
      : 218)
    : (hasBrowserButton
      ? (hasTerminalButton ? 254 : 218)
      : 190)
  return {
    scrollPaddingClassName: `pr-[${base + canvasExtra}px]`,
    shortcutPositionClassName: hasPanelButton
      ? `inset-y-0 items-end pb-[3px] z-10 right-[${158 + canvasExtra}px]`
      : `inset-y-0 items-end pb-[3px] z-10 right-[${130 + canvasExtra}px]`,
    panelPositionClassName: 'inset-y-0 right-[126px] items-end pb-[3px] z-10',
  }
}
