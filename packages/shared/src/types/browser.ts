/**
 * 内嵌浏览器（synara 移植）共享类型与 IPC 通道
 */

export interface BrowserPanelBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface BrowserTabState {
  id: string
  url: string
  title: string
  status: 'live' | 'suspended'
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  faviconUrl: string | null
  lastCommittedUrl: string | null
  lastError: string | null
}

export interface ThreadBrowserState {
  threadId: string
  version: number
  open: boolean
  activeTabId: string | null
  tabs: BrowserTabState[]
  lastError: string | null
}

export const BROWSER_IPC_CHANNELS = {
  open: 'browser:open',
  close: 'browser:close',
  closeTab: 'browser:close-tab',
  selectTab: 'browser:select-tab',
  hide: 'browser:hide',
  getState: 'browser:get-state',
  setBounds: 'browser:set-bounds',
  navigate: 'browser:navigate',
  back: 'browser:back',
  forward: 'browser:forward',
  reload: 'browser:reload',
  subscribeState: 'browser:subscribe-state',
  stateEvent: 'browser:state-event',
  getAnnotations: 'browser:get-annotations',
  clearAnnotations: 'browser:clear-annotations',
  annotationCommitted: 'browser:annotation-committed',
  setAnnotationInteractive: 'browser:set-annotation-interactive',
} as const
