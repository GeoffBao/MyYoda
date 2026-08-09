/**
 * Browser 工具单例注册中心
 *
 * 管理 DesktopBrowserManager + DesktopBrowserAutomationHost 的单例，
 * 供 Claude runtime（createSdkMcpServer）与 Pi runtime（defineTool）共用，
 * 也供 renderer IPC（browser-ipc）与主窗口挂载使用。
 */

import type { BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DesktopBrowserManager } from './browser-manager'
import { DesktopBrowserAutomationHost } from './browser-host'

let manager: DesktopBrowserManager | null = null
let host: DesktopBrowserAutomationHost | null = null

function annotationPreloadPath(): string | undefined {
  // guest preload 与主进程 preload 一起构建在 dist/ 下（build:guest-preload / watch:guest-preload）。
  // 构建管线曾遗漏这一步导致文件缺失时静默失效（preload 加载失败但页面仍能打开，只是标注/
  // 拾取功能不生效），这里显式校验存在性并打日志，避免下次再次踩坑却毫无提示。
  const path = join(__dirname, 'browser-annotation-guest.cjs')
  if (!existsSync(path)) {
    console.warn(
      `[Browser] 标注 guest preload 缺失: ${path}\n` +
        '  请运行 `bun run build:guest-preload`（或完整 `bun run build`）后重启应用，' +
        '否则内嵌浏览器的元素标注/点击拾取功能不会生效。',
    )
    return undefined
  }
  return path
}

export function getBrowserManager(): DesktopBrowserManager {
  if (!manager) {
    manager = new DesktopBrowserManager({ annotationPreloadPath: annotationPreloadPath() })
  }
  return manager
}

export function getBrowserHost(): DesktopBrowserAutomationHost {
  if (!host) {
    host = new DesktopBrowserAutomationHost(getBrowserManager())
  }
  return host
}

/** 主窗口就绪后调用：挂载浏览器视图。 */
export function attachBrowserToWindow(window: BrowserWindow): void {
  getBrowserManager().attachWindow(window)
}

/** 应用退出清理。 */
export function disposeBrowserRuntime(): void {
  if (manager) {
    manager.dispose()
    manager = null
    host = null
  }
}
