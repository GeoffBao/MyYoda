/**
 * Browser 主进程管理器（移植自 synara browserManager.ts，精简适配 MyYoda）。
 *
 * 职责：
 * - 每个 Agent 会话（threadId=sessionId）一个浏览器实例（WebContentsView 内嵌主窗口）
 * - 共享持久化会话分区 persist:lux-browser（登录态跨会话保留，参考 synara）
 * - tab 状态管理（MVP 支持单 tab，结构保留 tabs 数组便于后续扩展）
 * - 面板 bounds 同步（renderer 面板坐标 → WebContentsView 位置）
 * - 自动化 runtime 获取（给 host 层操作 WebContents）
 */

import { randomUUID } from 'node:crypto'
import { WebContentsView, type BrowserWindow, type WebContents } from 'electron'
import { join } from 'node:path'
import { getMainWindow } from '../main-window-store'
import type {
  BrowserPanelBounds,
  BrowserTabId,
  BrowserTabState,
  CommittedBrowserAnnotation,
  GuestAnnotationMarker,
  ThreadBrowserState,
  ThreadId,
} from './browser-types'
import {
  BROWSER_ANNOTATION_COMMAND_CHANNEL,
  BROWSER_ANNOTATION_GUEST_CHANNEL,
} from './browser-types'

export const BROWSER_SESSION_PARTITION = 'persist:lux-browser'
const ABOUT_BLANK_URL = 'about:blank'
const MAX_TABS_PER_THREAD = 8
const BROWSER_INACTIVE_TAB_SUSPEND_DELAY_MS = 60_000

export interface BrowserAutomationVisibleRuntime {
  readonly threadId: ThreadId
  readonly tabId: string
  readonly webContents: WebContents
}

export interface BrowserConsoleEntry {
  level: 'log' | 'warning' | 'error' | 'debug'
  message: string
  source: string
  timestamp: number
}

interface LiveTabRuntime {
  key: string
  threadId: ThreadId
  tabId: string
  webContents: WebContents
  view: WebContentsView
  isVisible: boolean
}

interface BrowserManagerOptions {
  annotationPreloadPath?: string
}

function defaultTitleForUrl(url: string): string {
  if (url === ABOUT_BLANK_URL) return 'New tab'
  try {
    const parsed = new URL(url)
    return parsed.hostname || url
  } catch {
    return url
  }
}

function normalizeBounds(bounds: BrowserPanelBounds | null): BrowserPanelBounds | null {
  if (!bounds) return null
  if (
    !Number.isFinite(bounds.x) ||
    !Number.isFinite(bounds.y) ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height)
  ) {
    return null
  }
  const width = Math.max(0, Math.floor(bounds.width))
  const height = Math.max(0, Math.floor(bounds.height))
  if (width === 0 || height === 0) return null
  return { x: Math.max(0, Math.floor(bounds.x)), y: Math.max(0, Math.floor(bounds.y)), width, height }
}

function isAllowedBrowserRuntimeNavigation(url: string, currentUrl: string): boolean {
  if (url === ABOUT_BLANK_URL) return true
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return true
    return false
  } catch {
    return false
  }
}

function createBrowserTab(url = ABOUT_BLANK_URL): BrowserTabState {
  return {
    id: randomUUID(),
    url,
    title: defaultTitleForUrl(url),
    status: 'suspended',
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    faviconUrl: null,
    lastCommittedUrl: null,
    lastError: null,
  }
}

function defaultThreadBrowserState(threadId: ThreadId): ThreadBrowserState {
  return {
    threadId,
    version: 0,
    open: false,
    activeTabId: null,
    tabs: [],
    lastError: null,
  }
}

type BrowserStateListener = (state: ThreadBrowserState) => void
type AnnotationCommittedListener = (annotation: CommittedBrowserAnnotation, threadId: ThreadId) => void

export class DesktopBrowserManager {
  private window: BrowserWindow | null = null
  private readonly states = new Map<ThreadId, ThreadBrowserState>()
  private readonly runtimes = new Map<string, LiveTabRuntime>()
  private readonly panelBounds = new Map<ThreadId, BrowserPanelBounds>()
  private readonly stateListeners = new Set<BrowserStateListener>()
  private readonly suspendTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly consoleLogs = new Map<string, BrowserConsoleEntry[]>()
  private readonly annotationMarkersByRuntimeKey = new Map<string, GuestAnnotationMarker[]>()
  private readonly annotationsByThread = new Map<ThreadId, CommittedBrowserAnnotation[]>()
  private readonly annotationCommittedListeners = new Set<AnnotationCommittedListener>()
  private readonly annotationPreloadPath?: string

  constructor(options: BrowserManagerOptions = {}) {
    this.annotationPreloadPath = options.annotationPreloadPath
  }

  // ===== 生命周期 =====

  /** 主窗口就绪后调用：拿到窗口引用，挂载/清理视图。 */
  attachWindow(window: BrowserWindow): void {
    this.window = window
    window.on('closed', () => {
      this.dispose()
    })
    window.on('resize', () => {
      // 窗口尺寸变化时按当前 bounds 重排活动视图
      for (const [threadId] of this.states) {
        const bounds = this.panelBounds.get(threadId)
        if (bounds) this.applyBounds(threadId, bounds)
      }
    })
  }

  dispose(): void {
    for (const runtime of this.runtimes.values()) {
      try {
        runtime.view.webContents.close()
      } catch { /* 已销毁 */ }
    }
    this.runtimes.clear()
    this.states.clear()
    this.panelBounds.clear()
    this.consoleLogs.clear()
    this.annotationMarkersByRuntimeKey.clear()
    this.annotationsByThread.clear()
    this.annotationCommittedListeners.clear()
    this.stateListeners.clear()
    for (const timer of this.suspendTimers.values()) clearTimeout(timer)
    this.suspendTimers.clear()
  }

  // ===== 状态订阅（renderer 同步） =====

  onState(listener: BrowserStateListener): () => void {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }

  private emitState(threadId: ThreadId): void {
    const state = this.states.get(threadId)
    if (!state) return
    state.version += 1
    const clone: ThreadBrowserState = {
      ...state,
      tabs: state.tabs.map((tab) => ({ ...tab })),
    }
    for (const listener of this.stateListeners) listener(clone)
  }

  // ===== 会话状态 =====

  getState(input: { threadId: ThreadId }): ThreadBrowserState {
    const state = this.states.get(input.threadId)
    if (!state) return defaultThreadBrowserState(input.threadId)
    return { ...state, tabs: state.tabs.map((tab) => ({ ...tab })) }
  }

  // ===== 面板 =====

  setPanelBounds(input: { threadId: ThreadId; bounds: BrowserPanelBounds | null }): void {
    const normalized = normalizeBounds(input.bounds)
    if (!normalized) {
      this.panelBounds.delete(input.threadId)
      this.hideRuntime(input.threadId)
      return
    }
    this.panelBounds.set(input.threadId, normalized)
    this.applyBounds(input.threadId, normalized)
  }

  private applyBounds(threadId: ThreadId, bounds: BrowserPanelBounds): void {
    const win = this.window ?? getMainWindow()
    const state = this.states.get(threadId)
    const activeTabId = state?.activeTabId ?? null
    // 只显示活动 tab，隐藏同会话其他 tab
    for (const runtime of this.runtimes.values()) {
      if (runtime.threadId !== threadId) continue
      const shouldShow = runtime.tabId === activeTabId
      if (shouldShow && !runtime.isVisible) {
        runtime.isVisible = true
        if (win && !win.isDestroyed()) {
          runtime.view.setBounds(bounds)
          win.contentView.addChildView(runtime.view)
        }
      } else if (!shouldShow && runtime.isVisible) {
        runtime.isVisible = false
        if (win && !win.isDestroyed()) {
          win.contentView.removeChildView(runtime.view)
        }
      }
    }
  }

  private hideRuntime(threadId: ThreadId): void {
    const win = this.window ?? getMainWindow()
    for (const runtime of this.runtimes.values()) {
      if (runtime.threadId !== threadId) continue
      if (runtime.isVisible) {
        runtime.isVisible = false
        if (win && !win.isDestroyed()) {
          win.contentView.removeChildView(runtime.view)
        }
      }
    }
  }

  // ===== 打开 / 关闭 =====

  async open(input: { threadId: ThreadId; url?: string; newTab?: boolean }): Promise<{ tabId: string; state: ThreadBrowserState }> {
    const threadId = input.threadId
    let state = this.states.get(threadId)
    if (!state) {
      state = defaultThreadBrowserState(threadId)
      this.states.set(threadId, state)
    }
    const existing = this.activeRuntime(threadId)
    const url = input.url && input.url.trim().length > 0 ? input.url.trim() : ABOUT_BLANK_URL

    // 复用活动 tab（默认行为）；newTab=true 时新建 tab
    if (existing && input.newTab !== true) {
      state.open = true
      state.lastError = null
      const tab = state.tabs.find((t) => t.id === existing.tabId)
      if (tab) {
        tab.url = url
        tab.title = defaultTitleForUrl(url)
        tab.status = 'live'
        tab.isLoading = true
        tab.lastError = null
      }
      this.navigateRuntime(existing, url)
      this.emitState(threadId)
      return { tabId: existing.tabId, state: this.getState({ threadId }) }
    }

    // 无活动 runtime 但有 suspended tab（首次创建失败）：复用最近一个 suspended tab 重试创建，
    // 避免无主窗口/失败场景下每次 open 都叠加一个永不加载的 tab。
    if (!existing && state.tabs.length > 0 && input.newTab !== true) {
      const stale = state.tabs[state.tabs.length - 1]
      if (stale) {
        state.activeTabId = stale.id
        stale.url = url
        stale.title = defaultTitleForUrl(url)
        stale.isLoading = true
        stale.lastError = null
        const runtime = this.createRuntime(threadId, stale.id, url)
        if (runtime) {
          stale.status = 'live'
          const bounds = this.panelBounds.get(threadId)
          if (bounds) this.applyBounds(threadId, bounds)
          this.emitState(threadId)
          return { tabId: stale.id, state: this.getState({ threadId }) }
        }
        stale.status = 'suspended'
        stale.lastError = 'Browser runtime unavailable.'
        this.emitState(threadId)
        return { tabId: stale.id, state: this.getState({ threadId }) }
      }
    }

    // 新建 tab + runtime；超上限时自动关闭最老的 tab
    const existingTabs = state.tabs
    if (existingTabs.length >= MAX_TABS_PER_THREAD) {
      const oldest = existingTabs[0]
      if (oldest) this.destroyTab(threadId, oldest.id)
    }
    const tab = createBrowserTab(url)
    state.tabs = [...state.tabs, tab]
    state.open = true
    state.activeTabId = tab.id
    state.lastError = null

    const runtime = this.createRuntime(threadId, tab.id, url)
    if (!runtime) {
      tab.status = 'suspended'
      tab.lastError = 'Browser runtime unavailable.'
      this.emitState(threadId)
      return { tabId: tab.id, state: this.getState({ threadId }) }
    }

    // 立即应用面板 bounds（若面板已打开，新 tab 成为活动 tab 并显示）
    const bounds = this.panelBounds.get(threadId)
    if (bounds) this.applyBounds(threadId, bounds)
    this.emitState(threadId)
    return { tabId: tab.id, state: this.getState({ threadId }) }
  }

  /** 切换活动 tab（多 tab 场景下由 renderer tab 条或 host 调用）。 */
  selectTab(input: { threadId: ThreadId; tabId: string }): boolean {
    const state = this.states.get(input.threadId)
    if (!state || !state.tabs.some((t) => t.id === input.tabId)) return false
    state.activeTabId = input.tabId
    const bounds = this.panelBounds.get(input.threadId)
    if (bounds) this.applyBounds(input.threadId, bounds)
    this.emitState(input.threadId)
    return true
  }

  /** 关闭指定 tab；未指定时关闭活动 tab。返回关闭后剩余的活动 tabId。 */
  closeTab(input: { threadId: ThreadId; tabId?: string }): { closedTabId: string | null; activeTabId: string | null } {
    const state = this.states.get(input.threadId)
    if (!state) return { closedTabId: null, activeTabId: null }
    const tabId = input.tabId ?? state.activeTabId
    if (!tabId || !state.tabs.some((t) => t.id === tabId)) {
      return { closedTabId: null, activeTabId: state.activeTabId }
    }
    this.destroyTab(input.threadId, tabId)
    const index = state.tabs.findIndex((t) => t.id === tabId)
    state.tabs = state.tabs.filter((t) => t.id !== tabId)
    if (state.activeTabId === tabId) {
      // 切到相邻 tab（优先右侧，否则左侧）
      const next = state.tabs[Math.min(index, state.tabs.length - 1)] ?? state.tabs[state.tabs.length - 1] ?? null
      state.activeTabId = next?.id ?? null
    }
    if (state.tabs.length === 0) {
      state.open = false
      state.activeTabId = null
      state.lastError = null
    }
    const bounds = this.panelBounds.get(input.threadId)
    if (bounds) this.applyBounds(input.threadId, bounds)
    this.emitState(input.threadId)
    return { closedTabId: tabId, activeTabId: state.activeTabId }
  }

  close(input: { threadId: ThreadId }): void {
    const state = this.states.get(input.threadId)
    if (!state) return
    for (const tab of [...state.tabs]) {
      this.destroyTab(input.threadId, tab.id)
    }
    state.tabs = []
    state.open = false
    state.activeTabId = null
    state.lastError = null
    this.emitState(input.threadId)
  }

  hide(input: { threadId: ThreadId }): void {
    this.hideRuntime(input.threadId)
  }

  // ===== 导航 =====

  async navigate(input: { threadId: ThreadId; tabId?: string; url: string }): Promise<void> {
    const runtime = this.runtimeFor(input.threadId, input.tabId)
    const state = this.states.get(input.threadId)
    if (!runtime || !state) return
    const tab = state.tabs.find((t) => t.id === runtime.tabId)
    if (tab) {
      tab.url = input.url
      tab.isLoading = true
      tab.lastError = null
      this.emitState(input.threadId)
    }
    this.navigateRuntime(runtime, input.url)
  }

  async goBack(input: { threadId: ThreadId; tabId?: string }): Promise<void> {
    const runtime = this.runtimeFor(input.threadId, input.tabId)
    if (!runtime) return
    const wc = runtime.webContents
    if (wc.navigationHistory.canGoBack()) {
      wc.navigationHistory.goBack()
    }
    this.emitState(input.threadId)
  }

  async goForward(input: { threadId: ThreadId; tabId?: string }): Promise<void> {
    const runtime = this.runtimeFor(input.threadId, input.tabId)
    if (!runtime) return
    const wc = runtime.webContents
    if (wc.navigationHistory.canGoForward()) {
      wc.navigationHistory.goForward()
    }
    this.emitState(input.threadId)
  }

  async reload(input: { threadId: ThreadId; tabId?: string }): Promise<void> {
    const runtime = this.runtimeFor(input.threadId, input.tabId)
    if (!runtime) return
    runtime.webContents.reload()
    const state = this.states.get(input.threadId)
    const tab = state?.tabs.find((t) => t.id === runtime.tabId)
    if (tab) {
      tab.isLoading = true
      tab.lastError = null
      this.emitState(input.threadId)
    }
  }

  // ===== 自动化 runtime =====

  /**
   * 获取可操作的 runtime（WebContents + tabId），供 host 层执行 CDP 操作。
   * 默认活动 tab；可指定 tabId。
   */
  getAutomationRuntime(input: { threadId: ThreadId; tabId?: string }): BrowserAutomationVisibleRuntime | null {
    const runtime = this.runtimeFor(input.threadId, input.tabId)
    if (!runtime) return null
    return { threadId: input.threadId, tabId: runtime.tabId, webContents: runtime.webContents }
  }

  /** 当前活动 runtime（无则 null）。 */
  activeRuntime(threadId: ThreadId): LiveTabRuntime | null {
    const state = this.states.get(threadId)
    if (!state?.activeTabId) return null
    return this.runtimes.get(buildRuntimeKey(threadId, state.activeTabId)) ?? null
  }

  /** 指定 tab 的 runtime；未指定时用活动 tab。 */
  private runtimeFor(threadId: ThreadId, tabId?: string): LiveTabRuntime | null {
    if (tabId) {
      const state = this.states.get(threadId)
      if (!state?.tabs.some((t) => t.id === tabId)) return null
      return this.runtimes.get(buildRuntimeKey(threadId, tabId)) ?? null
    }
    return this.activeRuntime(threadId)
  }

  /** 读取该会话的浏览器控制台日志（browser_logs 工具用）。 */
  readConsoleLogs(input: { threadId: ThreadId }): BrowserConsoleEntry[] {
    return [...(this.consoleLogs.get(input.threadId) ?? [])]
  }

  /** 清空该会话的浏览器控制台日志。 */
  clearConsoleLogs(input: { threadId: ThreadId }): void {
    this.consoleLogs.delete(input.threadId)
  }

  // ===== 元素标注（投影模式） =====

  /**
   * 把语义快照的元素标注投影到页面（画高亮框 + ref 编号）。
   * 若页面尚未 ready，markers 会暂存并在 guest ready 后自动推送。
   */
  syncAnnotations(input: { threadId: ThreadId; tabId?: string; markers: GuestAnnotationMarker[] }): void {
    const runtime = this.runtimeFor(input.threadId, input.tabId)
    const key = input.tabId
      ? buildRuntimeKey(input.threadId, input.tabId)
      : (runtime ? buildRuntimeKey(input.threadId, runtime.tabId) : null)
    if (!runtime || !key) return
    this.annotationMarkersByRuntimeKey.set(key, input.markers)
    if (!runtime.webContents.isDestroyed()) {
      runtime.webContents.send(BROWSER_ANNOTATION_COMMAND_CHANNEL, {
        kind: 'sync-markers',
        markers: input.markers,
      })
    }
  }

  /** 清除某 tab 的标注。 */
  clearAnnotations(input: { threadId: ThreadId; tabId?: string }): void {
    const runtime = this.runtimeFor(input.threadId, input.tabId)
    const key = input.tabId
      ? buildRuntimeKey(input.threadId, input.tabId)
      : (runtime ? buildRuntimeKey(input.threadId, runtime.tabId) : null)
    if (!key) return
    this.annotationMarkersByRuntimeKey.delete(key)
    if (runtime && !runtime.webContents.isDestroyed()) {
      runtime.webContents.send(BROWSER_ANNOTATION_COMMAND_CHANNEL, { kind: 'clear' })
    }
  }

  /** 切换标注拾取模式：interactive=true 时标注框可点击（用户拾取元素）。 */
  setAnnotationInteractive(input: { threadId: ThreadId; tabId?: string; interactive: boolean }): void {
    const runtime = this.runtimeFor(input.threadId, input.tabId)
    if (!runtime || runtime.webContents.isDestroyed()) return
    runtime.webContents.send(BROWSER_ANNOTATION_COMMAND_CHANNEL, {
      kind: 'set-interactive',
      interactive: input.interactive,
    })
  }

  /** 读取该会话已拾取的标注结果。 */
  getAnnotations(input: { threadId: ThreadId }): CommittedBrowserAnnotation[] {
    return [...(this.annotationsByThread.get(input.threadId) ?? [])]
  }

  /** 清空该会话已拾取的标注结果。 */
  clearPickedAnnotations(input: { threadId: ThreadId }): void {
    this.annotationsByThread.delete(input.threadId)
  }

  /** 订阅标注拾取结果。返回取消订阅函数。 */
  onAnnotationCommitted(listener: AnnotationCommittedListener): () => void {
    this.annotationCommittedListeners.add(listener)
    return () => this.annotationCommittedListeners.delete(listener)
  }

  // ===== 内部：runtime 创建/销毁 =====

  private createRuntime(threadId: ThreadId, tabId: string, url: string): LiveTabRuntime | null {
    const win = this.window ?? getMainWindow()
    if (!win || win.isDestroyed()) return null
    const key = buildRuntimeKey(threadId, tabId)
    try {
      const view = new WebContentsView({
        webPreferences: {
          partition: BROWSER_SESSION_PARTITION,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
          ...(this.annotationPreloadPath
            ? { preload: this.annotationPreloadPath, additionalArguments: [`--lux-thread=${threadId}`] }
            : {}),
        },
      })
      const runtime: LiveTabRuntime = {
        key,
        threadId,
        tabId,
        webContents: view.webContents,
        view,
        isVisible: false,
      }
      this.runtimes.set(key, runtime)

      // 页面事件 → 状态同步
      view.webContents.on('did-start-loading', () => {
        const state = this.states.get(threadId)
        const tab = state?.tabs.find((t) => t.id === tabId)
        if (tab) {
          tab.isLoading = true
          this.emitState(threadId)
        }
      })
      view.webContents.on('did-stop-loading', () => {
        const state = this.states.get(threadId)
        const tab = state?.tabs.find((t) => t.id === tabId)
        if (tab) {
          tab.isLoading = false
          this.emitState(threadId)
        }
      })
      view.webContents.on('did-navigate', (_event, url, httpResponseCode, _status) => {
        const state = this.states.get(threadId)
        const tab = state?.tabs.find((t) => t.id === tabId)
        if (tab) {
          tab.url = url
          tab.lastCommittedUrl = url
          tab.title = view.webContents.getTitle() || defaultTitleForUrl(url)
          tab.isLoading = false
          tab.lastError = Number(httpResponseCode) >= 400 ? `HTTP ${httpResponseCode}` : null
          this.emitState(threadId)
        }
      })
      view.webContents.on('page-title-updated', (_event, title) => {
        const state = this.states.get(threadId)
        const tab = state?.tabs.find((t) => t.id === tabId)
        if (tab) {
          tab.title = title || defaultTitleForUrl(tab.url)
          this.emitState(threadId)
        }
      })
      view.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame) return
        const state = this.states.get(threadId)
        const tab = state?.tabs.find((t) => t.id === tabId)
        if (tab) {
          tab.isLoading = false
          tab.lastError = errorDescription || `Failed (${errorCode})`
          this.emitState(threadId)
        }
      })

      // 控制台日志环形缓冲（browser_logs 读取）
      view.webContents.on('console-message', (_event, level, message, line, sourceId) => {
        const entries = this.consoleLogs.get(threadId) ?? []
        entries.push({
          level: level === 0 ? 'log' : level === 1 ? 'warning' : level === 2 ? 'error' : 'debug',
          message: String(message).slice(0, 2_000),
          source: `${sourceId ?? 'page'}:${line}`,
          timestamp: Date.now(),
        })
        if (entries.length > 500) entries.splice(0, entries.length - 500)
        this.consoleLogs.set(threadId, entries)
      })

      // 标注 guest 消息：ready / session-started / committed / cancelled
      view.webContents.on('ipc-message', (_event, channel, ...args) => {
        if (channel !== BROWSER_ANNOTATION_GUEST_CHANNEL) return
        const message = args[0] as { kind?: string; sessionId?: string; annotation?: CommittedBrowserAnnotation } | undefined
        if (!message || typeof message !== 'object') return
        if (message.kind === 'ready') {
          const markers = this.annotationMarkersByRuntimeKey.get(key)
          if (markers && markers.length > 0 && !view.webContents.isDestroyed()) {
            view.webContents.send(BROWSER_ANNOTATION_COMMAND_CHANNEL, { kind: 'sync-markers', markers })
          }
          return
        }
        if (message.kind === 'session-started') {
          // 拾取会话开始：无需额外状态，等待 committed/cancelled
          return
        }
        if (message.kind === 'committed' && message.annotation) {
          const annotations = this.annotationsByThread.get(threadId) ?? []
          annotations.push(message.annotation)
          this.annotationsByThread.set(threadId, annotations.slice(-200))
          for (const listener of this.annotationCommittedListeners) {
            try { listener(message.annotation, threadId) } catch { /* 监听器隔离 */ }
          }
          return
        }
        if (message.kind === 'cancelled') {
          // 拾取取消：无持久状态需清理
          return
        }
      })

      // 会话就绪后开始导航
      void view.webContents.loadURL(url).catch(() => {
        // 导航失败由 did-fail-load 处理
      })
      return runtime
    } catch (error) {
      console.error(`[Browser] 创建 runtime 失败 (${threadId}/${tabId}):`, error)
      return null
    }
  }

  private destroyRuntime(runtime: LiveTabRuntime): void {
    const timer = this.suspendTimers.get(runtime.key)
    if (timer) {
      clearTimeout(timer)
      this.suspendTimers.delete(runtime.key)
    }
    this.runtimes.delete(runtime.key)
    const win = this.window ?? getMainWindow()
    if (win && !win.isDestroyed()) {
      try {
        win.contentView.removeChildView(runtime.view)
      } catch { /* 已移除 */ }
    }
    try {
      runtime.webContents.close()
    } catch { /* 已销毁 */ }
  }

  /** 销毁指定 tab 的 runtime（不移除 tabs 状态，由调用方同步状态）。 */
  private destroyTab(threadId: ThreadId, tabId: string): void {
    const key = buildRuntimeKey(threadId, tabId)
    const runtime = this.runtimes.get(key)
    this.annotationMarkersByRuntimeKey.delete(key)
    if (runtime) this.destroyRuntime(runtime)
  }

  private navigateRuntime(runtime: LiveTabRuntime, url: string): void {
    if (!isAllowedBrowserRuntimeNavigation(url, runtime.webContents.getURL())) {
      const state = this.states.get(runtime.threadId)
      const tab = state?.tabs.find((t) => t.id === runtime.tabId)
      if (tab) {
        tab.lastError = `Blocked navigation to ${url}`
        this.emitState(runtime.threadId)
      }
      return
    }
    void runtime.webContents.loadURL(url).catch(() => {
      // 导航失败由 did-fail-load 处理
    })
  }

  /** 供 renderer 面板检查：给定 thread 是否已打开。 */
  isOpen(threadId: ThreadId): boolean {
    return this.states.get(threadId)?.open ?? false
  }

  /** 供 IPC 信任校验：给定 webContentsId 是否属于本管理器创建的 runtime。 */
  isTrustedRenderer(webContentsId: number): boolean {
    for (const runtime of this.runtimes.values()) {
      if (runtime.webContents.id === webContentsId) return true
    }
    return false
  }
}

function buildRuntimeKey(threadId: ThreadId, tabId: string): string {
  return `${threadId}:${tabId}`
}

export { join }
