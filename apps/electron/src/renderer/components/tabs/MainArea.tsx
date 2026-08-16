/**
 * MainArea — 主内容区域
 *
 * 组合 TabBar + TabContent。Agent 模式下若预览面板打开，则在同一个 Panel 内分屏：
 * 顶部一行：左侧 TabBar + 右侧预览顶栏（含文件名、复制按钮）
 * 主体：左侧 TabContent + 右侧预览内容
 */

import * as React from 'react'
import type { BrowserViewState } from '@myyoda/shared'
import { useAtomValue, useSetAtom, useAtom, useStore } from 'jotai'
import {
  tabsAtom,
  activeTabIdAtom,
  activeTabAtom,
  scratchPadPanelOpenAtom,
  rightWorkspaceSplitRatioAtom,
} from '@/atoms/tab-atoms'
import { Panel } from '@/components/app-shell/Panel'
import { WelcomeView } from '@/components/welcome/WelcomeView'
import { previewPanelOpenMapAtom, previewSplitRatioAtom } from '@/atoms/preview-atoms'
import { PreviewPanel } from '@/components/diff/PreviewPanel'
import { ScratchPadPane } from '@/components/scratch-pad/ScratchPadView'
import { closeScratchInSplit } from '@/components/scratch-pad/scratch-pad-opener'
import { useTrackSessionView } from '@/hooks/useTrackSessionView'
import { TabBar } from './TabBar'
import { TabContent } from './TabContent'
import { AutomationFormView } from '@/components/automation/AutomationFormView'
import { PlanningView } from '@/components/planning/PlanningView'
import { AgentSkillsView } from '@/components/agent-skills/AgentSkillsView'
import { RepoWikiView } from '@/components/repo-wiki/RepoWikiView'
import { BotHubSettings } from '@/components/settings/BotHubSettings'
import { DiscoverView } from '@/components/discover/DiscoverView'
import { ExcalidrawView } from '@/components/excalidraw/ExcalidrawView'
import { automationFormAtom } from '@/atoms/automation-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { interfaceVariantAtom } from '@/atoms/theme'
import { appModeAtom } from '@/atoms/app-mode'
import { codeMainViewAtom } from '@/atoms/project-atoms'
import { cn } from '@/lib/utils'
import { resolveCodeMainRoute } from '@/components/app-shell/code-main-view-model'
import { WorkBoardView } from '@/components/work/WorkBoardView'
import { ProjectPageRoute } from '@/components/project/ProjectPageRoute'
import { browserPanelOpenMapAtom, browserPendingNavigationMapAtom, browserStateMapAtom } from '@/atoms/browser-atoms'
import { BrowserPanel } from '@/components/browser/BrowserPanel'
import { nextBrowserLayoutRevision } from '@/components/browser/browser-layout-revision'
import { terminalPanelOpenMapAtom, terminalStateMapAtom } from '@/atoms/terminal-atoms'
import { TerminalPanel } from '@/components/terminal/TerminalPanel'

interface BrowserClosingState {
  sessionId: string
  state: BrowserViewState | null
}

export function MainArea(): React.ReactElement {
  // 记录每个会话上次停留的视图（对话 / 预览），供切回时重建预览 Tab
  useTrackSessionView()

  const tabs = useAtomValue(tabsAtom)
  const activeTabId = useAtomValue(activeTabIdAtom)
  const setActiveTabId = useSetAtom(activeTabIdAtom)
  const activeTab = useAtomValue(activeTabAtom)
  const automationFormOpen = useAtomValue(automationFormAtom).open
  const activeView = useAtomValue(activeViewAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const appMode = useAtomValue(appModeAtom)
  const codeMainView = useAtomValue(codeMainViewAtom)
  // Task Board 与 Project Page 是两个独立主区路由，覆盖视图优先级见 code-main-view-model。
  const codeMainRoute = resolveCodeMainRoute({ appMode, codeMainView, activeView })
  const interfaceVariant = useAtomValue(interfaceVariantAtom)
  const isClassic = interfaceVariant === 'classic'
  const store = useStore()

  // Tab 内容渲染降级为非紧急：TabBar 立即高亮新 tab，主区域昂贵渲染（含 PreviewPanel 中
  // DiffTabContent → ProseMirror editor mount + Shiki tokenize）让出主线程，避免点击 tab
  // 后必须等主区域渲染完才能看到 tab 切换效果
  const deferredActiveTabId = React.useDeferredValue(activeTabId)

  const previewOpenMap = useAtomValue(previewPanelOpenMapAtom)
  const [browserOpenMap, setBrowserOpenMap] = useAtom(browserPanelOpenMapAtom)
  const [browserStateMap, setBrowserStateMap] = useAtom(browserStateMapAtom)
  const setPendingNavigationMap = useSetAtom(browserPendingNavigationMapAtom)
  const [terminalOpenMap, setTerminalOpenMap] = useAtom(terminalPanelOpenMapAtom)
  const [terminalStateMap, setTerminalStateMap] = useAtom(terminalStateMapAtom)
  const [splitRatio, setSplitRatio] = useAtom(previewSplitRatioAtom)
  const [rightWorkspaceRatio, setRightWorkspaceRatio] = useAtom(rightWorkspaceSplitRatioAtom)
  const previewDragging = React.useRef(false)
  const rightWorkspaceDragging = React.useRef(false)
  const browserSessionId = activeTab?.type === 'agent' ? activeTab.sessionId : null

  const publishBrowserState = React.useCallback((state: BrowserViewState) => {
    setBrowserStateMap((previous) => { const next = new Map(previous); next.set(state.sessionId, state); return next })
    setBrowserOpenMap((previous) => { const next = new Map(previous); next.set(state.sessionId, true); return next })
  }, [setBrowserOpenMap, setBrowserStateMap])

  React.useEffect(() => {
    // Vite renderer 可在 preload 热重载前先更新；旧 bridge 时浏览器功能不可用，
    // 但绝不能让整个主界面崩溃。完整 Electron preload 就绪后会正常订阅。
    const subscribe = (window.electronAPI as Partial<typeof window.electronAPI>).onAgentBrowserStateChanged
    if (typeof subscribe !== 'function') return
    return subscribe(publishBrowserState)
  }, [publishBrowserState])

  React.useEffect(() => {
    if (!browserSessionId) return
    const getState = (window.electronAPI as Partial<typeof window.electronAPI>).getAgentBrowserState
    if (typeof getState !== 'function') return
    let cancelled = false
    void getState(browserSessionId)
      .then((state) => {
        if (!cancelled && state) publishBrowserState(state)
      })
      // 后台会话及已删除会话会被主进程拒绝或返回空状态；无需打断当前界面。
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [browserSessionId, publishBrowserState])

  // 终端状态推送（主进程 → 渲染）：打开/退出时更新 state map（key = terminalId）。
  const publishTerminalState = React.useCallback((event: { state: import('@myyoda/shared').TerminalViewState }) => {
    setTerminalStateMap((previous) => { const next = new Map(previous); next.set(event.state.terminalId, event.state); return next })
    setTerminalOpenMap((previous) => { const next = new Map(previous); next.set(event.state.sessionId, true); return next })
  }, [setTerminalOpenMap, setTerminalStateMap])

  React.useEffect(() => {
    const subscribe = (window.electronAPI as Partial<typeof window.electronAPI>).onAgentTerminalStateChanged
    if (typeof subscribe !== 'function') return
    return subscribe(publishTerminalState)
  }, [publishTerminalState])

  // 浏览器面板关闭过渡（对齐 Proma #1663）：关闭时先记录快照 state 再置 open=false，
  // 面板保持挂载播放滑出动画，动画结束后 clearClosedBrowser 清理 state。
  const [browserClosingState, setBrowserClosingState] = React.useState<BrowserClosingState | null>(null)
  const browserIsOpen = !!browserSessionId && (browserOpenMap.get(browserSessionId) ?? false)
  const showBrowserPanel = browserIsOpen && activeView === 'conversations'
  const showBrowserClosing = !!browserClosingState
    && browserClosingState.sessionId === browserSessionId
    && activeView === 'conversations'
    && !showBrowserPanel
  const browserState = browserSessionId ? browserStateMap.get(browserSessionId) ?? null : null
  const browserPanelSessionId = showBrowserPanel
    ? browserSessionId
    : showBrowserClosing
      ? browserClosingState?.sessionId ?? null
      : null
  const browserPanelState = showBrowserPanel ? browserState : browserClosingState?.state ?? null
  // 终端抽屉：仅 agent 会话、打开状态、会话视图下显示（底部弹出，不占用右侧工作区）
  const terminalSessionId = activeTab?.type === 'agent' ? activeTab.sessionId : null

  // 会话激活时预启动终端（warmup）：后台 spawn shell，用户点开终端面板时
  // open 复用 running pty + 回放输出缓冲 → 立即显示 prompt（对齐 synara 体验）。
  // 延迟 400ms 再 spawn：避免快速连续切换 tab 时的 spawn 风暴（切换离开即取消）。
  React.useEffect(() => {
    if (!terminalSessionId) return
    const open = (window.electronAPI as Partial<typeof window.electronAPI>).openAgentTerminal
    if (typeof open !== 'function') return
    let cancelled = false
    const timer = setTimeout(() => {
      if (cancelled) return
      void open({ sessionId: terminalSessionId, instanceId: 0, cols: 80, rows: 24, warmup: true })
        .catch(() => undefined)
    }, 400)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [terminalSessionId])
  const showTerminalPanel = !!terminalSessionId && (terminalOpenMap.get(terminalSessionId) ?? false) && activeView === 'conversations'
  const previewOpen =
    activeTab?.type === 'agent' && (previewOpenMap.get(activeTab.sessionId) ?? false) && !showBrowserPanel
  const previewSessionId = activeTab?.type === 'agent' ? activeTab.sessionId : null
  const scratchPanelOpen = useAtomValue(scratchPadPanelOpenAtom)
  const showScratchPanel =
    activeTab?.type === 'agent' && scratchPanelOpen && activeView === 'conversations' && !showBrowserPanel

  // 关闭动画状态：当 previewOpen 从 true → false 时，播放退出动画再移除 DOM
  // 在 render 阶段同步派生 closing，避免中间帧出现 flex: 1 1 auto 导致左侧瞬间跳到 100% 宽
  // （flex-basis: auto 与 calc() 之间无法插值，transition 不生效，视觉上会被解读为"重新渲染"）
  const [closingState, setClosingState] = React.useState(false)
  const prevPreviewStateRef = React.useRef({ open: previewOpen, sessionId: previewSessionId })

  let closing = closingState
  const prev = prevPreviewStateRef.current
  if (prev.open && !previewOpen && prev.sessionId === previewSessionId) {
    closing = true
  }
  if (previewOpen || prev.sessionId !== previewSessionId) {
    closing = false
  }
  if (closing !== closingState) {
    setClosingState(closing)
  }

  React.useEffect(() => {
    prevPreviewStateRef.current = { open: previewOpen, sessionId: previewSessionId }
  }, [previewOpen, previewSessionId])

  const showPreview = (previewOpen || closing) && previewSessionId && activeView === 'conversations'
  const showPreviewClosingOnly = closing && !previewOpen
  const showPreviewPane = !!showPreview && !(showPreviewClosingOnly && showScratchPanel)
  const showBothRightPanels = showPreviewPane && showScratchPanel

  const handlePreviewDragStart = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    previewDragging.current = true
    const startX = e.clientX
    const startRatio = splitRatio
    const containerEl = (e.currentTarget as HTMLElement).closest('[data-split-container]') as HTMLElement | null
    const containerWidth = containerEl?.clientWidth ?? 1
    let rafId = 0

    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    document.querySelectorAll('iframe').forEach((f) => { (f as HTMLElement).style.pointerEvents = 'none' })

    const onMouseMove = (ev: MouseEvent) => {
      if (!previewDragging.current) return
      if (rafId) return
      rafId = requestAnimationFrame(() => {
        rafId = 0
        const delta = ev.clientX - startX
        const newRatio = Math.max(0.3, Math.min(0.8, startRatio + delta / containerWidth))
        setSplitRatio(newRatio)
      })
    }
    const onMouseUp = () => {
      previewDragging.current = false
      if (rafId) cancelAnimationFrame(rafId)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      document.querySelectorAll('iframe').forEach((f) => { (f as HTMLElement).style.pointerEvents = '' })
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [splitRatio, setSplitRatio])

  const handleRightWorkspaceDragStart = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    rightWorkspaceDragging.current = true
    const startX = e.clientX
    const startRatio = rightWorkspaceRatio
    const containerEl = (e.currentTarget as HTMLElement).closest('[data-right-workspace]') as HTMLElement | null
    const containerWidth = containerEl?.clientWidth ?? 1
    let rafId = 0

    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    document.querySelectorAll('iframe').forEach((f) => { (f as HTMLElement).style.pointerEvents = 'none' })

    const onMouseMove = (ev: MouseEvent) => {
      if (!rightWorkspaceDragging.current) return
      if (rafId) return
      rafId = requestAnimationFrame(() => {
        rafId = 0
        const delta = ev.clientX - startX
        const newRatio = Math.max(0.3, Math.min(0.7, startRatio + delta / containerWidth))
        setRightWorkspaceRatio(newRatio)
      })
    }
    const onMouseUp = () => {
      rightWorkspaceDragging.current = false
      if (rafId) cancelAnimationFrame(rafId)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      document.querySelectorAll('iframe').forEach((f) => { (f as HTMLElement).style.pointerEvents = '' })
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [rightWorkspaceRatio, setRightWorkspaceRatio])

  const handleCloseScratchPanel = React.useCallback(() => {
    closeScratchInSplit(store)
  }, [store])

  React.useEffect(() => {
    if (tabs.length === 0) {
      console.warn('[FLASH-DEBUG] MainArea: tabs.length === 0, showing WelcomeView!', new Error().stack)
    }
  }, [tabs.length])

  React.useEffect(() => {
    if (tabs.length > 0 && !activeTabId) {
      setActiveTabId(tabs[0]!.id)
    }
  }, [tabs, activeTabId, setActiveTabId])

  // 关闭动画期间右侧面板的定位样式（脱离 flex 流，保持原宽度，translateX 向右滑出）
  const closingOverlayStyle: React.CSSProperties | undefined = closing
    ? {
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: `${splitRatio * 100}%`,
        width: `${(1 - splitRatio) * 100}%`,
        zIndex: 1,
        display: 'flex',
        pointerEvents: 'none',
      }
    : undefined

  // 左侧容器宽度：右侧工作区打开时固定占 splitRatio；其他情况（含 closing 动画期间）
  // 直接 1 1 auto 占满——closing 时右侧 absolute 脱离 flex 流，所以左侧自然占 100%。
  const showRightPanel = showBrowserPanel || showScratchPanel || showPreviewPane
  const leftFlexStyle: React.CSSProperties = showRightPanel
    ? { flex: `0 0 calc(${splitRatio * 100}% - 6px)` }
    : { flex: '1 1 auto' }
  const previewPaneStyle: React.CSSProperties = showBothRightPanels
    ? { flex: `0 0 calc(${rightWorkspaceRatio * 100}% - 4px)` }
    : { flex: '1 1 auto' }
  const scratchPaneStyle: React.CSSProperties = showBothRightPanels
    ? { flex: `0 0 calc(${(1 - rightWorkspaceRatio) * 100}% - 4px)` }
    : { flex: '1 1 auto' }

  return (
    <>
      <Panel
        variant="grow"
        className={cn('refined-content bg-content-area', isClassic && 'rounded-2xl shadow-xl dark:shadow-sm')}
      >
        <div className="flex flex-1 min-h-0 relative overflow-hidden" data-split-container>
          {/* 左侧：TabBar + TabContent（始终保持在同一 DOM 位置，避免 Tab 切换时 unmount）
              注：宽度变化不用 transition——文字逐帧 reflow 会导致行末字符抖动，
              视觉上像"内容从右向左推送"。让左侧瞬间变宽，由右侧 absolute 滑出动画
              覆盖期内呈现"被剥离"的视觉效果。 */}
          <div
            className={cn('flex flex-col min-w-0 h-full relative', showPreview && 'mr-0.5')}
            style={leftFlexStyle}
          >
            {appMode === 'cowork' ? (
              // 遗留 cowork 兜底：AppShell 会迁移到 agent + codeMainView='work'；
              // 保留此分支避免迁移前一帧空白。
              <WorkBoardView />
            ) : codeMainRoute === 'task-board' ? (
              <WorkBoardView />
            ) : codeMainRoute === 'project-page' ? (
              <ProjectPageRoute />
            ) : activeView === 'planning' ? (
              automationFormOpen ? (
                // 定时任务设置页：与列表同层级替换中间区，不经过 TabBar，避免切换时闪出会话 Tab。
                <AutomationFormView />
              ) : (
                // Task 日历：Todo / 日历 / 定时任务合一，全屏取代 TabBar + TabContent
                <PlanningView />
              )
            ) : activeView === 'agent-skills' ? (
              // Yoda 插件视图：专家 / Skills / MCP / API / Memory 合一，Home / Code 共享，全屏取代 TabBar + TabContent
              <AgentSkillsView />
            ) : activeView === 'repo-wiki' ? (
              // Yoda 知识库：Project 模式知识库入口（待开发占位）
              <RepoWikiView />
            ) : activeView === 'messaging' ? (
              // 消息：IM 集成（飞书 / 微信 / 即将上线渠道占位），全屏取代 TabBar + TabContent
              <BotHubSettings />
            ) : activeView === 'discover' ? (
              // 发现：官方内容流 + 社区讨论 + 反馈
              <DiscoverView />
            ) : activeView === 'excalidraw-gallery' || activeView === 'excalidraw-editor' ? (
              <ExcalidrawView />
            ) : (
              <>
                <TabBar />
                {automationFormOpen ? (
                  // 兼容从会话内入口打开任务设置的场景。
                  <AutomationFormView />
                ) : tabs.length === 0 ? (
                  <WelcomeView />
                ) : deferredActiveTabId ? (
                  <div className="flex-1 min-h-0 titlebar-no-drag">
                    <TabContent tabId={deferredActiveTabId} />
                  </div>
                ) : null}
                {showTerminalPanel && terminalSessionId && (
                  <div className="relative shrink-0">
                    <TerminalPanel
                      key={terminalSessionId}
                      sessionId={terminalSessionId}
                      onClose={() => {
                        setTerminalOpenMap((previous) => { const next = new Map(previous); next.delete(terminalSessionId); return next })
                      }}
                    />
                  </div>
                )}
              </>
            )}
          </div>

          {/* 右侧：预览/草稿工作区。Preview 和草稿可在同一右侧槽位内并排显示。 */}
          {showRightPanel && (
            <div
              className={cn(closing && !showScratchPanel ? 'animate-preview-slide-out' : 'flex flex-1 min-w-0')}
              style={closing && !showScratchPanel ? closingOverlayStyle : undefined}
              onAnimationEnd={(e) => {
                if (closing && e.target === e.currentTarget) setClosingState(false)
              }}
            >
              {!(closing && !showScratchPanel) && (
                <div
                  className="w-[8px] cursor-col-resize bg-border/40 hover:bg-primary/30 active:bg-primary/50 transition-colors flex-shrink-0 self-stretch"
                  onMouseDown={handlePreviewDragStart}
                />
              )}
              <div className="flex flex-1 min-w-0 h-full overflow-hidden" data-right-workspace>
                {showBrowserPanel && browserSessionId && (
                  <div className="min-w-0 h-full overflow-hidden flex-1">
                    <BrowserPanel
                      sessionId={browserSessionId}
                      state={browserState}
                      onClose={() => {
                        setBrowserOpenMap((previous) => { const next = new Map(previous); next.set(browserSessionId, false); return next })
                        setBrowserStateMap((previous) => { const next = new Map(previous); next.delete(browserSessionId); return next })
                        setPendingNavigationMap((previous) => { const next = new Map(previous); next.delete(browserSessionId); return next })
                      }}
                    />
                  </div>
                )}
                {showPreviewPane && previewSessionId && (
                  <div className="min-w-0 h-full overflow-hidden" style={previewPaneStyle}>
                    <PreviewPanel sessionId={previewSessionId} />
                  </div>
                )}
                {showBothRightPanels && (
                  <div
                    className="w-[8px] cursor-col-resize bg-border/40 hover:bg-primary/30 active:bg-primary/50 transition-colors flex-shrink-0 self-stretch"
                    onMouseDown={handleRightWorkspaceDragStart}
                  />
                )}
                {showScratchPanel && (
                  <div className="min-w-0 h-full overflow-hidden" style={scratchPaneStyle}>
                    <ScratchPadPane onClose={handleCloseScratchPanel} />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </Panel>
    </>
  )
}
