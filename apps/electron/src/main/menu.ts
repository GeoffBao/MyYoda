import { Menu, shell, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '@myyoda/shared'

/**
 * 菜单缩放（role: zoomIn/zoomOut/resetZoom）不会触发 webContents 的 'zoom-changed' 事件
 * （该事件仅在滚轮/触控板缩放时触发），因此改用自定义 click 处理并显式广播新的缩放系数。
 * 内嵌浏览器 WebContentsView 的 bounds 换算依赖这个广播（renderer 的 CSS px 在非 100%
 * 缩放下与原生视图的 DIP 坐标不再 1:1，需要按缩放系数换算，见 BrowserPanel.tsx）。
 */
function applyZoomDelta(delta: number) {
  return (_menuItem: Electron.MenuItem, win: Electron.BaseWindow | undefined): void => {
    if (!win || win.isDestroyed() || !(win instanceof BrowserWindow)) return
    const wc = win.webContents
    const nextLevel = delta === 0 ? 0 : Math.max(-8, Math.min(9, wc.getZoomLevel() + delta))
    wc.setZoomLevel(nextLevel)
    wc.send(IPC_CHANNELS.WINDOW_ZOOM_FACTOR_CHANGED, wc.getZoomFactor())
  }
}

export function createApplicationMenu(): Menu {
  const isMac = process.platform === 'darwin'

  /**
   * 菜单快捷键说明：
   *
   * 大部分快捷键由渲染进程的 shortcut-registry 统一管理。
   * 但 Cmd+W 需要在菜单中拦截（否则 macOS 默认关闭窗口），
   * 改为通知渲染进程关闭当前标签页。
   */

  const template: Electron.MenuItemConstructorOptions[] = [
    // 应用菜单 (仅 macOS)
    ...(isMac
      ? [
          {
            label: 'MyYoda',
            submenu: [
              { role: 'about' as const, label: '关于 MyYoda' },
              { type: 'separator' as const },
              { role: 'services' as const, label: '服务' },
              { type: 'separator' as const },
              { role: 'hide' as const, label: '隐藏 MyYoda' },
              { role: 'hideOthers' as const, label: '隐藏其他' },
              { role: 'unhide' as const, label: '显示全部' },
              { type: 'separator' as const },
              { role: 'quit' as const, label: '退出 MyYoda' },
            ],
          },
        ]
      : []),

    // 文件菜单
    {
      label: '文件',
      submenu: [
        // Cmd+W / Ctrl+W：主窗口关闭当前标签页；独立规划窗口关闭自身。
        {
          label: '关闭标签页',
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            const win = BrowserWindow.getFocusedWindow()
            if (!win) return

            let windowType: string | null = null
            try {
              windowType = new URL(win.webContents.getURL()).searchParams.get('window')
            } catch {
              // 窗口尚未加载页面时沿用主窗口的安全默认行为。
            }
            if (windowType === 'planning' || windowType === 'workspace-memory') {
              win.close()
              return
            }

            win.webContents.send('menu:close-tab')
          },
        },
        ...(isMac ? [] : [{ type: 'separator' as const }, { role: 'quit' as const, label: '退出' }]),
      ],
    },

    // 编辑菜单
    {
      label: '编辑',
      submenu: [
        { role: 'undo' as const, label: '撤销' },
        { role: 'redo' as const, label: '重做' },
        { type: 'separator' as const },
        { role: 'cut' as const, label: '剪切' },
        { role: 'copy' as const, label: '复制' },
        { role: 'paste' as const, label: '粘贴' },
        ...(isMac
          ? [
              { role: 'pasteAndMatchStyle' as const, label: '粘贴并匹配样式' },
              { role: 'delete' as const, label: '删除' },
              { role: 'selectAll' as const, label: '全选' },
            ]
          : [{ role: 'delete' as const, label: '删除' }, { type: 'separator' as const }, { role: 'selectAll' as const, label: '全选' }]),
      ],
    },

    // 视图菜单
    {
      label: '视图',
      submenu: [
        { role: 'reload' as const, label: '重新加载' },
        { role: 'forceReload' as const, label: '强制重新加载' },
        { role: 'toggleDevTools' as const, label: '切换开发者工具' },
        { type: 'separator' as const },
        // 原生 role: zoomIn/zoomOut/resetZoom 不会触发 webContents 的 zoom-changed 事件，
        // 改为自定义 click 处理以便广播新缩放系数给 renderer（内嵌浏览器 bounds 换算依赖）；
        // 加速键沿用与原 role 相同的默认值。
        { label: '重置缩放', accelerator: 'CmdOrCtrl+0', click: applyZoomDelta(0) },
        { label: '放大', accelerator: 'CmdOrCtrl+Plus', click: applyZoomDelta(0.5) },
        { label: '缩小', accelerator: 'CmdOrCtrl+-', click: applyZoomDelta(-0.5) },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const, label: '切换全屏' },
      ],
    },

    // 窗口菜单
    {
      label: '窗口',
      submenu: [
        { role: 'minimize' as const, label: '最小化' },
        { role: 'zoom' as const, label: '缩放' },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const, label: '前置全部窗口' },
              { type: 'separator' as const },
              { role: 'window' as const, label: '窗口' },
            ]
          : [{ role: 'close' as const, label: '关闭' }]),
      ],
    },

    // 帮助菜单
    {
      label: '帮助',
      role: 'help' as const,
      submenu: [
        {
          label: '了解更多',
          click: async () => {
            await shell.openExternal('https://github.com/GeoffBao/MyYoda')
          },
        },
      ],
    },
  ]

  return Menu.buildFromTemplate(template)
}
