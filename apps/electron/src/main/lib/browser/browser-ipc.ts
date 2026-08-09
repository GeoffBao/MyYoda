/**
 * Browser IPC 处理器（移植自 synara browserIpc.ts，精简）。
 *
 * 职责：注册 renderer 面板 ↔ 主进程浏览器管理器的 IPC 通道。
 * - 打开/关闭/隐藏浏览器
 * - 面板 bounds 同步（renderer 面板坐标 → WebContentsView 位置）
 * - 导航/前进/后退/刷新
 * - 状态订阅（state 推送）
 */

import type { WebContents } from 'electron'
import { ipcMain, webContents, type IpcMain } from 'electron'
import { BROWSER_IPC_CHANNELS, type BrowserPanelBounds, type ThreadBrowserState } from '@myyoda/shared'
import { getBrowserManager } from './browser-tools-injector'

export function sendBrowserState(
  webContents: WebContents | null | undefined,
  state: ThreadBrowserState,
): void {
  webContents?.send(BROWSER_IPC_CHANNELS.stateEvent, state)
}

export function registerBrowserIpcHandlers(ipcMainRef: IpcMain = ipcMain): void {
  const browserManager = getBrowserManager()

  // 状态推送：所有已订阅的 renderer 都能收到（浏览器状态按 threadId 区分）
  browserManager.onState((state) => {
    for (const wc of webContents.getAllWebContents()) {
      if (wc.getType() === 'window' || wc.getType() === 'browserView') {
        sendBrowserState(wc, state)
      }
    }
  })

  ipcMainRef.removeHandler(BROWSER_IPC_CHANNELS.open)
  ipcMainRef.handle(BROWSER_IPC_CHANNELS.open, async (_event, input: { threadId: string; url?: string; newTab?: boolean }) => {
    return browserManager.open({ threadId: input.threadId, url: input.url, newTab: input.newTab })
  })

  ipcMainRef.removeHandler(BROWSER_IPC_CHANNELS.close)
  ipcMainRef.handle(BROWSER_IPC_CHANNELS.close, async (_event, input: { threadId: string }) => {
    browserManager.close({ threadId: input.threadId })
    return true
  })

  ipcMainRef.removeHandler(BROWSER_IPC_CHANNELS.closeTab)
  ipcMainRef.handle(BROWSER_IPC_CHANNELS.closeTab, async (_event, input: { threadId: string; tabId?: string }) => {
    return browserManager.closeTab({ threadId: input.threadId, tabId: input.tabId })
  })

  ipcMainRef.removeHandler(BROWSER_IPC_CHANNELS.selectTab)
  ipcMainRef.handle(BROWSER_IPC_CHANNELS.selectTab, async (_event, input: { threadId: string; tabId: string }) => {
    return browserManager.selectTab({ threadId: input.threadId, tabId: input.tabId })
  })

  ipcMainRef.removeHandler(BROWSER_IPC_CHANNELS.hide)
  ipcMainRef.handle(BROWSER_IPC_CHANNELS.hide, async (_event, input: { threadId: string }) => {
    browserManager.hide({ threadId: input.threadId })
    return true
  })

  ipcMainRef.removeHandler(BROWSER_IPC_CHANNELS.getState)
  ipcMainRef.handle(BROWSER_IPC_CHANNELS.getState, async (_event, input: { threadId: string }) => {
    return browserManager.getState({ threadId: input.threadId })
  })

  ipcMainRef.removeHandler(BROWSER_IPC_CHANNELS.setBounds)
  ipcMainRef.on(BROWSER_IPC_CHANNELS.setBounds, (_event, input: { threadId: string; bounds: BrowserPanelBounds | null }) => {
    browserManager.setPanelBounds({ threadId: input.threadId, bounds: input.bounds })
  })

  ipcMainRef.removeHandler(BROWSER_IPC_CHANNELS.navigate)
  ipcMainRef.handle(BROWSER_IPC_CHANNELS.navigate, async (_event, input: { threadId: string; url: string }) => {
    await browserManager.navigate({ threadId: input.threadId, url: input.url })
    return true
  })

  ipcMainRef.removeHandler(BROWSER_IPC_CHANNELS.back)
  ipcMainRef.handle(BROWSER_IPC_CHANNELS.back, async (_event, input: { threadId: string }) => {
    await browserManager.goBack({ threadId: input.threadId })
    return true
  })

  ipcMainRef.removeHandler(BROWSER_IPC_CHANNELS.forward)
  ipcMainRef.handle(BROWSER_IPC_CHANNELS.forward, async (_event, input: { threadId: string }) => {
    await browserManager.goForward({ threadId: input.threadId })
    return true
  })

  ipcMainRef.removeHandler(BROWSER_IPC_CHANNELS.reload)
  ipcMainRef.handle(BROWSER_IPC_CHANNELS.reload, async (_event, input: { threadId: string }) => {
    await browserManager.reload({ threadId: input.threadId })
    return true
  })

  // 标注拾取结果：committed 事件推送到 renderer + 查询/清空
  browserManager.onAnnotationCommitted((annotation, threadId) => {
    for (const wc of webContents.getAllWebContents()) {
      sendBrowserAnnotationCommitted(wc, threadId, annotation)
    }
  })

  ipcMainRef.removeHandler(BROWSER_IPC_CHANNELS.getAnnotations)
  ipcMainRef.handle(BROWSER_IPC_CHANNELS.getAnnotations, async (_event, input: { threadId: string }) => {
    return browserManager.getAnnotations({ threadId: input.threadId })
  })

  ipcMainRef.removeHandler(BROWSER_IPC_CHANNELS.clearAnnotations)
  ipcMainRef.handle(BROWSER_IPC_CHANNELS.clearAnnotations, async (_event, input: { threadId: string }) => {
    browserManager.clearPickedAnnotations({ threadId: input.threadId })
    return true
  })

  ipcMainRef.removeHandler(BROWSER_IPC_CHANNELS.setAnnotationInteractive)
  ipcMainRef.handle(BROWSER_IPC_CHANNELS.setAnnotationInteractive, async (_event, input: { threadId: string; interactive: boolean }) => {
    browserManager.setAnnotationInteractive({ threadId: input.threadId, interactive: input.interactive === true })
    return true
  })

  console.log('[Browser IPC] 已注册浏览器 IPC 处理器')
}

export function sendBrowserAnnotationCommitted(
  target: WebContents | null | undefined,
  threadId: string,
  annotation: { id: string; ref: string; role?: string; name?: string; selector?: string; comment: string },
): void {
  target?.send(BROWSER_IPC_CHANNELS.annotationCommitted, { threadId, annotation })
}
