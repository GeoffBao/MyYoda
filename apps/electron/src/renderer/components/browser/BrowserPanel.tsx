/**
 * BrowserPanel - 内嵌浏览器面板（synara 移植）
 *
 * 左侧栏「浏览器」入口对应的全屏视图。真正的网页内容由主进程的
 * WebContentsView 渲染并覆盖在本组件的 content-area 上；本组件负责：
 * - 工具栏（返回/前进/刷新/地址栏/打开）
 * - 把 content-area 的几何 bounds 同步给主进程（setBounds）
 * - 订阅主进程状态推送（URL/title/加载态）并渲染
 *
 * threadId = 当前活跃 Agent 会话的 sessionId。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAtomValue } from 'jotai'
import { activeSessionIdAtom } from '@/atoms/tab-atoms'
import type { ThreadBrowserState } from '@myyoda/shared'

const TOOLBAR_HEIGHT = 44

interface PickedAnnotation {
  id: string
  ref: string
  role?: string
  name?: string
  selector?: string
  comment: string
}

export function BrowserPanel(): React.JSX.Element {
  const threadId = useAtomValue(activeSessionIdAtom)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const threadRef = useRef<string | null>(null)
  const [state, setState] = useState<ThreadBrowserState | null>(null)
  const [urlInput, setUrlInput] = useState('')
  const [picked, setPicked] = useState<PickedAnnotation[]>([])
  const [picking, setPicking] = useState(false)
  const zoomFactorRef = useRef(1)
  const resyncBoundsRef = useRef<(() => void) | null>(null)

  threadRef.current = threadId

  // 页面缩放系数（Cmd+/Cmd-、菜单缩放、滚轮/触控板缩放）：WebContentsView.setBounds 用的是
  // 窗口 DIP，getBoundingClientRect 返回的是当前缩放下的 CSS px，只有 100% 缩放时两者相等。
  // 用 ref 而非 state，避免缩放变化时把 bounds-sync effect（依赖 [threadId, state?.open]）
  // 重新触发导致不必要的 hide()/重新挂载；zoomFactorRef 变化后主动调一次 sync（见下方 effect）。
  useEffect(() => {
    let cancelled = false
    void window.electronAPI.getZoomFactor().then((factor) => {
      if (!cancelled && Number.isFinite(factor) && factor > 0) zoomFactorRef.current = factor
    })
    const unsubscribe = window.electronAPI.onZoomFactorChange((factor) => {
      if (Number.isFinite(factor) && factor > 0) {
        zoomFactorRef.current = factor
        resyncBoundsRef.current?.()
      }
    })
    return () => { cancelled = true; unsubscribe() }
  }, [])

  // 订阅状态推送
  useEffect(() => {
    const unsubscribe = window.electronAPI.browser.onStateChange((next) => {
      if (next.threadId === threadRef.current) {
        setState(next)
      }
    })
    if (threadId) {
      void window.electronAPI.browser.getState(threadId).then((s) => setState(s))
    }
    return unsubscribe
  }, [threadId])

  // 订阅标注拾取结果 + 初次拉取
  useEffect(() => {
    const unsubscribe = window.electronAPI.browser.onAnnotationCommitted((tid, annotation) => {
      if (tid === threadRef.current) {
        setPicked((prev) => [...prev, annotation])
      }
    })
    if (threadId) {
      void window.electronAPI.browser.getAnnotations(threadId).then((list) => setPicked(list))
    }
    return unsubscribe
  }, [threadId])

  // content-area bounds 同步到主进程（WebContentsView 覆盖其上）
  // 依赖 state?.open：Agent 先 browser_open、用户后切到面板时，contentRef 是
  // open 后才条件渲染，effect 必须随 open 状态重新执行才能定位视图。
  useEffect(() => {
    if (!threadId || !state?.open) return
    const el = contentRef.current
    if (!el) return

    const sync = (): void => {
      const rect = el.getBoundingClientRect()
      // Electron WebContentsView.setBounds 使用窗口 DIP（逻辑像素）；getBoundingClientRect
      // 返回的是当前页面缩放（zoomFactor）下的 CSS px。绝不能乘 devicePixelRatio（那是
      // Retina 概念，与此无关，乘了会让视图在 Retina 屏上膨胀 2 倍覆盖工具栏）；但
      // zoomFactor（Cmd+/Cmd- 或滚轮缩放，非 100% 时）必须乘，否则非 100% 缩放下视图
      // 同样会错位/超出覆盖到地址栏导致无法点击输入。100% 时 zoomFactor=1，等价于直传。
      const zoom = zoomFactorRef.current
      window.electronAPI.browser.setBounds(threadId, {
        x: Math.round(rect.left * zoom),
        y: Math.round(rect.top * zoom),
        width: Math.round(rect.width * zoom),
        height: Math.round(rect.height * zoom),
      })
    }
    resyncBoundsRef.current = sync

    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(el)
    window.addEventListener('resize', sync)
    return () => {
      resyncBoundsRef.current = null
      observer.disconnect()
      window.removeEventListener('resize', sync)
      // 面板卸载/关闭时隐藏 WebContentsView，防止原生视图残留盖住其他视图
      window.electronAPI.browser.hide(threadId)
      // 退出拾取模式，避免下次打开面板时标注框仍可点击（状态残留）
      window.electronAPI.browser.setAnnotationInteractive(threadId, false)
    }
  }, [threadId, state?.open])

  const openUrl = useCallback(async () => {
    if (!threadId) return
    const raw = urlInput.trim()
    const url = raw && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) ? `https://${raw}` : (raw || undefined)
    await window.electronAPI.browser.open(threadId, url)
    if (url) setUrlInput('')
  }, [threadId, urlInput])

  const goBack = useCallback(async () => { if (threadId) void window.electronAPI.browser.back(threadId) }, [threadId])
  const goForward = useCallback(async () => { if (threadId) void window.electronAPI.browser.forward(threadId) }, [threadId])
  const reload = useCallback(async () => { if (threadId) void window.electronAPI.browser.reload(threadId) }, [threadId])
  const closeBrowser = useCallback(async () => {
    if (threadId) void window.electronAPI.browser.close(threadId)
    setPicking(false)
  }, [threadId])
  const togglePicking = useCallback(async () => {
    if (!threadId) return
    const next = !picking
    await window.electronAPI.browser.setAnnotationInteractive(threadId, next)
    setPicking(next)
  }, [threadId, picking])
  const selectTab = useCallback(async (tabId: string) => { if (threadId) void window.electronAPI.browser.selectTab(threadId, tabId) }, [threadId])
  const closeTab = useCallback(async (tabId: string) => { if (threadId) void window.electronAPI.browser.closeTab(threadId, tabId) }, [threadId])
  const newTab = useCallback(async () => { if (threadId) void window.electronAPI.browser.open(threadId, undefined, true) }, [threadId])

  const activeTab = state?.tabs.find((t) => t.id === state.activeTabId) ?? null

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* Tab 条：多 tab 切换（Agent browser_open newTab / 工具栏新建） */}
      {state?.open && state.tabs.length > 0 && (
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-2 py-1">
          {state.tabs.map((tab) => (
            <div
              key={tab.id}
              className={`group flex min-w-0 max-w-[180px] cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-[11px] ${tab.id === state.activeTabId ? 'border-accent bg-accent/10 text-foreground' : 'border-transparent text-foreground-muted hover:bg-surface-muted'}`}
              onClick={() => void selectTab(tab.id)}
              title={tab.title || tab.url}
            >
              <span className="truncate">{tab.title || tab.url || 'New tab'}</span>
              <button
                className="shrink-0 rounded p-0.5 text-foreground-muted opacity-0 hover:bg-surface-muted hover:text-foreground group-hover:opacity-100"
                onClick={(e) => { e.stopPropagation(); void closeTab(tab.id) }}
                title="关闭标签页"
                aria-label={`关闭标签页 ${tab.title || ''}`}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            className="shrink-0 rounded-md px-2 py-1 text-xs text-foreground-muted hover:bg-surface-muted hover:text-foreground"
            onClick={() => void newTab()}
            title="新建标签页"
            aria-label="新建标签页"
          >
            +
          </button>
        </div>
      )}

      {/* 工具栏 */}
      <div
        className="flex shrink-0 items-center gap-2 border-b border-border px-3"
        style={{ height: TOOLBAR_HEIGHT }}
      >
        <button
          className="btn-icon"
          onClick={goBack}
          disabled={!state?.open}
          title="后退"
          aria-label="后退"
        >
          ←
        </button>
        <button
          className="btn-icon"
          onClick={goForward}
          disabled={!state?.open}
          title="前进"
          aria-label="前进"
        >
          →
        </button>
        <button
          className="btn-icon"
          onClick={reload}
          disabled={!state?.open}
          title="刷新"
          aria-label="刷新"
        >
          ⟳
        </button>
        <form
          className="flex flex-1 items-center gap-2"
          onSubmit={(e) => { e.preventDefault(); void openUrl() }}
        >
          <input
            className="h-7 w-full rounded-md border border-border bg-surface-muted px-2 text-xs text-foreground outline-none focus:border-accent"
            value={activeTab?.url && !urlInput ? activeTab.url : urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="输入网址或搜索，例如 example.com"
            aria-label="地址栏"
          />
        </form>
        <button
          className={`btn-icon ${picking ? 'text-accent' : ''}`}
          onClick={() => void togglePicking()}
          disabled={!state?.open}
          title={picking ? '退出拾取模式' : '拾取元素（点击页面标注框）'}
          aria-label={picking ? '退出拾取模式' : '拾取元素'}
        >
          🖱️
        </button>
        <button
          className="btn-icon"
          onClick={closeBrowser}
          disabled={!state?.open}
          title="关闭浏览器"
          aria-label="关闭浏览器"
        >
          ✕
        </button>
      </div>

      {/* 状态栏（加载态 / 错误） */}
      {(activeTab?.isLoading || activeTab?.lastError) && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1 text-[11px] text-foreground-muted">
          {activeTab?.isLoading && <span className="text-accent">加载中…</span>}
          {activeTab?.lastError && <span className="text-red-500">错误: {activeTab.lastError}</span>}
          {activeTab?.title && <span className="truncate">{activeTab.title}</span>}
        </div>
      )}

      {/* 已拾取标注（用户点击页面标注框拾取的元素） */}
      {picked.length > 0 && (
        <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-border px-3 py-1.5">
          <span className="shrink-0 text-[11px] font-medium text-foreground-muted">已拾取 {picked.length} 个元素：</span>
          {picked.map((item) => (
            <span key={`${item.ref}-${item.comment}`} className="shrink-0 rounded-md bg-accent/10 px-2 py-0.5 text-[11px] text-foreground">
              [{item.ref}] {item.role ?? 'element'}{item.name ? ` “${item.name.slice(0, 24)}”` : ''}{item.comment ? ` · ${item.comment.slice(0, 30)}` : ''}
            </span>
          ))}
          <button
            className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-foreground-muted hover:bg-surface-muted hover:text-foreground"
            onClick={() => { if (threadId) void window.electronAPI.browser.clearAnnotations(threadId); setPicked([]) }}
            title="清空拾取结果"
          >
            ✕
          </button>
        </div>
      )}

      {/* 网页内容区：WebContentsView 覆盖在此区域 */}
      {!state?.open ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-foreground-muted">
          <div className="text-3xl">🌐</div>
          <p className="text-sm">浏览器尚未打开。告诉 Agent「打开浏览器」或用上方地址栏打开。</p>
        </div>
      ) : (
        <div ref={contentRef} className="relative flex-1 overflow-hidden" data-browser-content />
      )}
    </div>
  )
}
