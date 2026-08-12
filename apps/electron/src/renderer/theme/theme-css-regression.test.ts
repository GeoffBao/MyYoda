import { describe, expect, test } from 'bun:test'

const globalsCssPath = `${import.meta.dir}/../styles/globals.css`
const appShellPath = `${import.meta.dir}/../components/app-shell/AppShell.tsx`

/** 读取 globals.css 并归一化换行（Windows CRLF → LF），保证换行敏感的断言跨平台稳定 */
async function readGlobalsCss(): Promise<string> {
  const text = await Bun.file(globalsCssPath).text()
  return text.replace(/\r\n/g, '\n')
}

/**
 * Scenic 背景层只能托住内容，不能覆盖设置页 overlay 自身的定位。
 * 这个契约防止 shell 的通用子元素规则把 absolute overlay 改成 relative。
 */
describe('ThemePack Scenic layout CSS', () => {
  test('不会用通用直接子元素规则覆盖设置 overlay 的 absolute 定位', async () => {
    const css = await readGlobalsCss()

    expect(css).not.toContain('html.theme-custom .shell-bg > *')
    expect(css).toContain('html.theme-custom.theme-scenic .shell-bg')
    expect(css).toContain(':root.ui-modern.theme-custom .refined-sidebar')
    expect(css).toContain(':root.ui-modern.theme-custom .refined-content')
    expect(css).toContain(':root.ui-modern.theme-custom .refined-inspector')
    expect(css).toContain(':root.ui-modern.theme-custom .tabbar-bg')
    expect(css).toContain(':root.ui-modern.theme-custom [data-input-mode] > div:first-child')
    expect(css).toContain(':root.ui-modern.theme-custom:not(.theme-scenic) .refined-content')
    expect(css).toContain(':root.ui-modern.theme-custom.theme-scenic .session-header-polished')
    expect(css).toContain(':root.ui-modern.theme-custom.theme-scenic .titlebar-drag-region')
    expect(css).toContain(':root.ui-modern.theme-custom.theme-scenic .refined-content')
    expect(css).toContain('.translucent-windows:not(.theme-scenic) .crt-sidebar')
  })

  test('composer 容器提升 stacking context，scenic 毛玻璃不能把内部弹层困在消息区内容之下', async () => {
    const css = await readGlobalsCss()

    // Haze/Scenic 给 composer 注入 backdrop-filter（创建 stacking context，z-index:0），
    // 会把内部上弹面板（如项目选择器 z-50）困在 z-0，被消息区空状态内容区（z-10）盖住，
    // 导致面板顶部项目点不动。必须给 composer 显式提层。
    expect(css).toContain(':root:not(.ui-classic) [data-input-mode] > div:first-child')
    expect(css).toMatch(/\[data-input-mode\] > div:first-child\s*\{[^}]*position: relative;[^}]*z-index: 20;/s)
  })

  test('主题材质不会改变原有工作台外层几何', async () => {
    const [css, appShell] = await Promise.all([
      readGlobalsCss(),
      Bun.file(appShellPath).text(),
    ])

    expect(appShell).not.toContain('modern-workbench-frame')
    expect(appShell).not.toContain('modern-workbench-sidebar-slot')
    expect(appShell).not.toContain('modern-workbench-main-slot')
    expect(appShell).not.toContain('modern-workbench-overlay')
    expect(css).not.toContain('modern-workbench-frame')
    expect(css).not.toContain('modern-workbench-sidebar-slot')
    expect(css).not.toContain('modern-workbench-main-slot')
    expect(css).not.toContain('modern-workbench-overlay')
    expect(appShell).toContain("isClassic && 'p-2'")
  })

  test('Haze/ThemePack 的玻璃面板只作用现代界面，经典界面保留自己的材质', async () => {
    const css = await readGlobalsCss()

    expect(css).toContain(':root.ui-modern.theme-custom .refined-sidebar')
    expect(css).toContain(':root.ui-modern.theme-custom .refined-content')
    expect(css).toContain(':root.ui-modern.translucent-windows .crt-sidebar')
    expect(css).not.toContain('html.theme-custom .refined-sidebar,\nhtml.theme-custom .refined-inspector')
    expect(css).not.toContain('.translucent-windows .crt-sidebar,\n.translucent-windows .tabbar-bg')
    expect(css).toContain('.tabbar-bg {\n  position: relative;\n  background-color: hsl(var(--tabbar-surface));\n  -webkit-backdrop-filter: none;\n  backdrop-filter: none;')
  })
})
