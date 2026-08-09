/**
 * Browser 内置工具本地类型定义（移植自 synara @synara/contracts 的浏览器部分，
 * 精简为 MyYoda 需要的子集，不引入 @synara/contracts 依赖）。
 */

export type ThreadId = string
export type BrowserTabId = string

export type BrowserAriaRole =
  | 'alert' | 'alertdialog' | 'application' | 'article' | 'banner' | 'button'
  | 'cell' | 'checkbox' | 'columnheader' | 'combobox' | 'complementary' | 'contentinfo'
  | 'definition' | 'dialog' | 'directory' | 'document' | 'feed' | 'figure'
  | 'form' | 'grid' | 'gridcell' | 'group' | 'heading' | 'img' | 'link' | 'list'
  | 'listbox' | 'listitem' | 'log' | 'main' | 'marquee' | 'math' | 'menu'
  | 'menubar' | 'menuitem' | 'menuitemcheckbox' | 'menuitemradio' | 'meter'
  | 'navigation' | 'none' | 'note' | 'option' | 'presentation' | 'progressbar'
  | 'radio' | 'radiogroup' | 'region' | 'row' | 'rowgroup' | 'rowheader'
  | 'scrollbar' | 'search' | 'searchbox' | 'separator' | 'slider' | 'spinbutton'
  | 'status' | 'switch' | 'tab' | 'table' | 'tablist' | 'tabpanel' | 'term'
  | 'textbox' | 'timer' | 'toolbar' | 'tooltip' | 'tree' | 'treegrid' | 'treeitem'

export type BrowserElementRef = string

export interface BrowserPanelBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface BrowserTabState {
  id: BrowserTabId
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
  threadId: ThreadId
  version: number
  open: boolean
  activeTabId: BrowserTabId | null
  tabs: BrowserTabState[]
  lastError: string | null
}

export interface BrowserNodeTarget {
  ref?: BrowserElementRef
  snapshotId?: string
  selector?: string
  locator?: {
    kind: 'role' | 'text' | 'placeholder' | 'testId' | 'label'
    role?: BrowserAriaRole
    text?: string
    value?: string
    exact?: boolean
    name?: string
  }
}

export interface BrowserPointerTarget {
  point?: { x: number; y: number }
  ref?: BrowserElementRef
  snapshotId?: string
  selector?: string
  locator?: BrowserNodeTarget['locator']
}

/** 快照产物：元素 ref 列表 + 可见文本（供 Agent 理解页面并定位元素）。 */
export interface BrowserSnapshotOutput {
  url: string
  title: string
  elements: Array<{
    ref: string
    role: string
    name: string
    context?: Array<{ role: string; name: string }>
    description?: string
    value?: string
    bounds: { x: number; y: number; width: number; height: number }
    states: string[]
  }>
  visibleText: string
  semanticTruncated: boolean
}

export interface BrowserAutomationErrorInput {
  code: string
  retryable?: boolean
  phase?: string
  effectMayHaveCommitted?: boolean
  tabId?: BrowserTabId
  message?: string
}

export interface BrowserAutomationError {
  code: string
  retryable: boolean
  phase: string
  effectMayHaveCommitted: boolean
  tabId?: BrowserTabId
  message: string
}

export interface BrowserMcpToolErrorEnvelope {
  error: BrowserAutomationError
}

export const BROWSER_TOOL_NAMES = [
  'browser_status',
  'browser_tabs',
  'browser_open',
  'browser_navigate',
  'browser_back',
  'browser_forward',
  'browser_reload',
  'browser_resize',
  'browser_snapshot',
  'browser_screenshot',
  'browser_logs',
  'browser_click',
  'browser_hover',
  'browser_drag',
  'browser_type',
  'browser_select',
  'browser_upload',
  'browser_press',
  'browser_scroll',
  'browser_wait',
  'browser_evaluate',
  'browser_close',
] as const

export type BrowserToolName = (typeof BROWSER_TOOL_NAMES)[number]

export interface BrowserAutomationToolRequest {
  sessionId: string
  provider: string
  threadId: ThreadId
  name: BrowserToolName
  arguments: unknown
  workspaceRoot?: string
  signal?: AbortSignal
}

/** 元素标注投影（guest preload 渲染在页面上的标注框）。 */
export interface GuestAnnotationMarker {
  id: string
  label: string
  x: number
  y: number
  width: number
  height: number
  role?: string
  name?: string
  /** 唯一 CSS selector，供 guest 按元素实时定位（滚动/移动跟踪）。 */
  selector?: string
}

/** 用户点击标注框拾取元素后提交的标注结果。 */
export interface CommittedBrowserAnnotation {
  id: string
  ref: string
  role?: string
  name?: string
  selector?: string
  comment: string
  x: number
  y: number
  width: number
  height: number
}

export const BROWSER_ANNOTATION_COMMAND_CHANNEL = 'browser:annotation-command'
export const BROWSER_ANNOTATION_GUEST_CHANNEL = 'browser:annotation-guest'
