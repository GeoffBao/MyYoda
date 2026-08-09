/**
 * Browser 工具执行 host（移植自 synara desktopBrowserAutomationHost.ts，精简 MVP）。
 *
 * 职责：把 Agent 的 browser_* 工具调用分发到具体实现。
 * 与 runtime 解耦：executeTool 返回统一结构 { text, structured?, images? }，
 * 由注入层（Claude MCP / Pi customTools）包装成各自格式。
 */

import type { WebContents } from 'electron'
import type {
  BrowserSnapshotOutput,
  BrowserToolName,
  ThreadId,
} from './browser-types'
import type { BrowserAutomationVisibleRuntime } from './browser-cdp'
import {
  evaluateInContext,
  observePage,
  sendCdpCommand,
  throwIfAborted,
} from './browser-cdp'
import { captureSemanticSnapshot } from './browser-snapshot'
import {
  releaseBrowserTarget,
  resolveBrowserTarget,
} from './browser-targets'
import { BrowserAutomationHostError, browserHostError } from './browser-errors'
import type { DesktopBrowserManager } from './browser-manager'

export interface BrowserAutomationToolRequest {
  sessionId: string
  provider: string
  threadId: ThreadId
  name: BrowserToolName
  arguments: unknown
  workspaceRoot?: string
  signal?: AbortSignal
}

export interface BrowserToolExecutionResult {
  text: string
  structured?: unknown
  images?: Array<{ mimeType: string; data: string; width?: number; height?: number }>
}

interface BrowserToolTarget {
  ref?: string
  snapshotId?: string
  selector?: string
  locator?: {
    kind: 'role' | 'text' | 'placeholder' | 'testId' | 'label'
    role?: string
    text?: string
    value?: string
    exact?: boolean
    name?: string
  }
  point?: { x: number; y: number }
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> => {
  throwIfAborted(signal)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

const compactJson = (value: unknown): string => JSON.stringify(value, null, 2)

export class DesktopBrowserAutomationHost {
  private readonly browserManager: DesktopBrowserManager

  constructor(browserManager: DesktopBrowserManager) {
    this.browserManager = browserManager
  }

  async executeTool(request: BrowserAutomationToolRequest): Promise<BrowserToolExecutionResult> {
    const { name } = request
    switch (name) {
      case 'browser_status':
        return this.status(request)
      case 'browser_tabs':
        return this.tabs(request)
      case 'browser_open':
        return this.open(request)
      case 'browser_navigate':
        return this.navigate(request)
      case 'browser_back':
        return this.back(request)
      case 'browser_forward':
        return this.forward(request)
      case 'browser_reload':
        return this.reload(request)
      case 'browser_snapshot':
        return this.snapshot(request)
      case 'browser_screenshot':
        return this.screenshot(request)
      case 'browser_click':
        return this.click(request)
      case 'browser_hover':
        return this.hover(request)
      case 'browser_drag':
        return this.drag(request)
      case 'browser_type':
        return this.type(request)
      case 'browser_select':
        return this.select(request)
      case 'browser_upload':
        return this.upload(request)
      case 'browser_press':
        return this.press(request)
      case 'browser_scroll':
        return this.scroll(request)
      case 'browser_wait':
        return this.wait(request)
      case 'browser_evaluate':
        return this.evaluate(request)
      case 'browser_logs':
        return this.logs(request)
      case 'browser_resize':
        return this.resize(request)
      case 'browser_close':
        return this.close(request)
      default:
        browserHostError({ code: 'BrowserToolNotFound', message: `Unknown browser tool: ${name}` })
    }
  }

  // ===== 状态 =====

  private status(request: BrowserAutomationToolRequest): BrowserToolExecutionResult {
    const state = this.browserManager.getState({ threadId: request.threadId })
    const active = this.browserManager.getAutomationRuntime({ threadId: request.threadId })
    return {
      text: compactJson({
        open: state.open,
        tabs: state.tabs.length,
        activeTabId: state.activeTabId,
        attached: active !== null,
      }),
      structured: { open: state.open, tabs: state.tabs.length, activeTabId: state.activeTabId },
    }
  }

  private tabs(request: BrowserAutomationToolRequest): BrowserToolExecutionResult {
    const state = this.browserManager.getState({ threadId: request.threadId })
    return {
      text: compactJson(state.tabs.map((tab) => ({
        id: tab.id,
        url: tab.url,
        title: tab.title,
        status: tab.status,
        isLoading: tab.isLoading,
      }))),
      structured: state.tabs,
    }
  }

  private async open(request: BrowserAutomationToolRequest): Promise<BrowserToolExecutionResult> {
    const args = (request.arguments ?? {}) as { url?: string; newTab?: boolean }
    const url = typeof args.url === 'string' && args.url.trim() ? args.url.trim() : 'about:blank'
    const result = await this.browserManager.open({ threadId: request.threadId, url, newTab: args.newTab === true })
    const state = result.state
    const page = state.tabs.find((t) => t.id === result.tabId)
    return {
      text: compactJson({ tabId: result.tabId, url: page?.url ?? url, title: page?.title, tabs: state.tabs.length }),
      structured: { tabId: result.tabId, url: page?.url ?? url, title: page?.title, tabs: state.tabs.length },
    }
  }

  private async navigate(request: BrowserAutomationToolRequest): Promise<BrowserToolExecutionResult> {
    const args = (request.arguments ?? {}) as { url?: string }
    const url = typeof args.url === 'string' ? args.url.trim() : ''
    if (!url) browserHostError({ code: 'BrowserInvalidInput', message: 'url is required' })
    await this.browserManager.navigate({ threadId: request.threadId, url })
    return { text: `Navigated to ${url}` }
  }

  private async back(request: BrowserAutomationToolRequest): Promise<BrowserToolExecutionResult> {
    await this.browserManager.goBack({ threadId: request.threadId })
    return { text: 'Went back' }
  }

  private async forward(request: BrowserAutomationToolRequest): Promise<BrowserToolExecutionResult> {
    await this.browserManager.goForward({ threadId: request.threadId })
    return { text: 'Went forward' }
  }

  private async reload(request: BrowserAutomationToolRequest): Promise<BrowserToolExecutionResult> {
    await this.browserManager.reload({ threadId: request.threadId })
    return { text: 'Reloaded' }
  }

  // ===== 快照 / 截图 =====

  private async snapshot(request: BrowserAutomationToolRequest): Promise<BrowserToolExecutionResult> {
    const args = (request.arguments ?? {}) as { includeImage?: boolean }
    const runtime = this.requireRuntime(request)
    const result = await captureSemanticSnapshot(runtime, {
      includeImage: args.includeImage === true,
      includeDiagnostics: false,
      humanControlEpoch: 0,
    }, request.signal)
    const { structuredContent, image } = result.output
    // 元素标注投影：把快照元素画到页面上（高亮框 + ref 编号），用户可直观看到 Agent 将操作哪些元素
    try {
      this.browserManager.syncAnnotations({
        threadId: request.threadId,
        tabId: runtime.tabId,
        markers: structuredContent.elements.slice(0, 40).map((el) => ({
          id: el.ref,
          label: el.ref,
          x: Math.round(el.bounds.x),
          y: Math.round(el.bounds.y),
          width: Math.round(el.bounds.width),
          height: Math.round(el.bounds.height),
          role: el.role,
          name: el.name,
          selector: el.selector,
        })),
      })
    } catch (error) {
      console.warn('[Browser] 标注投影失败（不影响快照）:', error instanceof Error ? error.message : error)
    }
    const textParts = [
      `# ${structuredContent.title}`,
      `URL: ${structuredContent.url}`,
      `Snapshot: ${structuredContent.snapshotId} (${structuredContent.elements.length} elements)`,
      '',
      ...structuredContent.elements.map((el) => {
        const stateText = el.states.length > 0 ? ` [${el.states.join(',')}]` : ''
        const valueText = el.value ? ` = "${el.value}"` : ''
        const contextText = el.context && el.context.length > 0
          ? ` (${el.context.map((c) => `${c.role}:${c.name}`).join(' > ')})`
          : ''
        return `- [${el.ref}] ${el.role} "${el.name}"${contextText}${stateText}${valueText} @ ${el.bounds.x},${el.bounds.y} ${el.bounds.width}x${el.bounds.height}`
      }),
      '',
      '--- visible text ---',
      structuredContent.visibleText,
    ]
    const text = textParts.join('\n')
    const truncated = structuredContent.visibleText.length > 3_000
    return {
      text: truncated ? `${text.slice(0, 12_000)}\n\n[visible text truncated]` : text,
      structured: structuredContent,
      ...(image ? { images: [image] } : {}),
    }
  }

  private async screenshot(request: BrowserAutomationToolRequest): Promise<BrowserToolExecutionResult> {
    const args = (request.arguments ?? {}) as { fullPage?: boolean }
    const runtime = this.requireRuntime(request)
    void args
    const result = await captureSemanticSnapshot(runtime, {
      includeImage: true,
      includeDiagnostics: false,
      humanControlEpoch: 0,
    }, request.signal)
    const image = result.output.image
    if (!image) browserHostError({ code: 'BrowserSnapshotTooLarge', retryable: true, phase: 'snapshot' })
    return {
      text: `Captured ${image!.width}x${image!.height} screenshot (${image!.byteLength} bytes). Page: ${result.output.structuredContent.url}`,
      structured: { url: result.output.structuredContent.url, width: image!.width, height: image!.height },
      images: [{ mimeType: image!.mimeType, data: image!.data, width: image!.width, height: image!.height }],
    }
  }

  // ===== 输入动作 =====

  private async click(request: BrowserAutomationToolRequest): Promise<BrowserToolExecutionResult> {
    const args = (request.arguments ?? {}) as { target?: BrowserToolTarget; ref?: string; selector?: string; point?: { x: number; y: number } }
    const runtime = this.requireRuntime(request)
    const target = normalizeTargetInput(args)
    if (!target) {
      browserHostError({ code: 'BrowserInvalidInput', message: 'browser_click requires a target (ref/selector/locator/point)' })
    }
    const resolved = await resolveBrowserTarget(runtime, target, undefined, {
      resolvePointElement: true,
      signal: request.signal,
    })
    try {
      await dispatchMouseClick(runtime, resolved.point, request.signal)
    } finally {
      await releaseBrowserTarget(runtime, resolved, request.signal)
    }
    return {
      text: `Clicked ${resolved.info.role ?? 'element'} at (${Math.round(resolved.point.x)}, ${Math.round(resolved.point.y)})${resolved.info.name ? `: "${resolved.info.name}"` : ''}`,
      structured: { point: resolved.point, role: resolved.info.role, name: resolved.info.name },
    }
  }

  private async hover(request: BrowserAutomationToolRequest): Promise<BrowserToolExecutionResult> {
    const args = (request.arguments ?? {}) as { target?: BrowserToolTarget; ref?: string; selector?: string; point?: { x: number; y: number } }
    const runtime = this.requireRuntime(request)
    const target = normalizeTargetInput(args)
    if (!target) {
      browserHostError({ code: 'BrowserInvalidInput', message: 'browser_hover requires a target' })
    }
    const resolved = await resolveBrowserTarget(runtime, target, undefined, {
      resolvePointElement: true,
      signal: request.signal,
    })
    try {
      await sendCdpCommand(runtime, 'Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: resolved.point.x,
        y: resolved.point.y,
      }, request.signal)
    } finally {
      await releaseBrowserTarget(runtime, resolved, request.signal)
    }
    return {
      text: `Hovered ${resolved.info.role ?? 'element'} at (${Math.round(resolved.point.x)}, ${Math.round(resolved.point.y)})`,
      structured: { point: resolved.point },
    }
  }

  private async drag(request: BrowserAutomationToolRequest): Promise<BrowserToolExecutionResult> {
    const args = (request.arguments ?? {}) as { source?: BrowserToolTarget; target?: BrowserToolTarget; steps?: number }
    const runtime = this.requireRuntime(request)
    if (!args.source) browserHostError({ code: 'BrowserInvalidInput', message: 'browser_drag requires source' })
    if (!args.target) browserHostError({ code: 'BrowserInvalidInput', message: 'browser_drag requires target' })
    const source = await resolveBrowserTarget(runtime, args.source, undefined, { signal: request.signal })
    let targetResolved: Awaited<ReturnType<typeof resolveBrowserTarget>> | undefined
    try {
      targetResolved = await resolveBrowserTarget(runtime, args.target, undefined, { signal: request.signal })
      await dispatchMouseDrag(runtime, source.point, targetResolved.point, {
        steps: Math.max(1, Math.min(30, args.steps ?? 10)),
        signal: request.signal,
      })
    } finally {
      if (targetResolved) await releaseBrowserTarget(runtime, targetResolved, request.signal)
      await releaseBrowserTarget(runtime, source, request.signal)
    }
    return {
      text: `Dragged from (${Math.round(source.point.x)}, ${Math.round(source.point.y)}) to (${Math.round(targetResolved.point.x)}, ${Math.round(targetResolved.point.y)})`,
      structured: { source: source.point, target: targetResolved.point },
    }
  }

  private async select(request: BrowserAutomationToolRequest): Promise<BrowserToolExecutionResult> {
    const args = (request.arguments ?? {}) as { target?: BrowserToolTarget; ref?: string; selector?: string; values?: string[] | string }
    const runtime = this.requireRuntime(request)
    const target = normalizeTargetInput(args)
    if (!target) browserHostError({ code: 'BrowserInvalidInput', message: 'browser_select requires a target' })
    const values = Array.isArray(args.values) ? args.values : (typeof args.values === 'string' ? [args.values] : [])
    if (values.length === 0) browserHostError({ code: 'BrowserInvalidInput', message: 'browser_select requires values' })
    const resolved = await resolveBrowserTarget(runtime, target, undefined, { signal: request.signal })
    try {
      const result = await evaluateInContext<{ ok: boolean; selected: string[] }>(
        runtime,
        selectExpression(JSON.stringify(values)),
        { signal: request.signal, effectMayHaveCommitted: true },
      )
      const value = result.value
      if (!value?.ok) {
        browserHostError({ code: 'BrowserInputUnsupported', message: 'Could not select option (target may not be a <select>)' })
      }
      return {
        text: `Selected ${value!.selected.join(', ')}`,
        structured: { selected: value!.selected },
      }
    } finally {
      await releaseBrowserTarget(runtime, resolved, request.signal)
    }
  }

  private async upload(request: BrowserAutomationToolRequest): Promise<BrowserToolExecutionResult> {
    const args = (request.arguments ?? {}) as { target?: BrowserToolTarget; ref?: string; selector?: string; files?: string[] | string }
    const runtime = this.requireRuntime(request)
    const target = normalizeTargetInput(args)
    if (!target) browserHostError({ code: 'BrowserInvalidInput', message: 'browser_upload requires a target (file input)' })
    const files = Array.isArray(args.files) ? args.files : (typeof args.files === 'string' ? [args.files] : [])
    if (files.length === 0) browserHostError({ code: 'BrowserInvalidInput', message: 'browser_upload requires files' })

    // 工作区根目录限制：仅允许上传 workspace 内的文件（防任意路径读取/写入）
    const root = request.workspaceRoot
    if (!root) browserHostError({ code: 'BrowserUploadDenied', message: 'browser_upload requires a workspace root to resolve file paths' })
    const { isAbsolute, resolve, normalize } = await import('node:path')
    const { existsSync } = await import('node:fs')
    const normalizedRoot = normalize(resolve(root))
    const absoluteFiles = files.map((file) => {
      const absolute = isAbsolute(file) ? resolve(file) : resolve(process.cwd(), file)
      if (!absolute.startsWith(normalizedRoot + '/') && absolute !== normalizedRoot) {
        browserHostError({ code: 'BrowserUploadDenied', message: `File is outside the workspace root: ${file}` })
      }
      if (!existsSync(absolute)) {
        browserHostError({ code: 'BrowserUploadDenied', message: `File does not exist: ${file}` })
      }
      return absolute
    })

    const resolved = await resolveBrowserTarget(runtime, target, undefined, { signal: request.signal })
    try {
      // objectId → nodeId → setFileInputFiles
      await sendCdpCommand(runtime, 'DOM.enable', {}, request.signal)
      const node = await sendCdpCommand<{ nodeId?: number }>(runtime, 'DOM.requestNode', {
        objectId: resolved.objectId,
      }, request.signal)
      if (!node.nodeId) browserHostError({ code: 'BrowserTargetNotFound', message: 'Could not resolve file input node' })
      await sendCdpCommand(runtime, 'DOM.setFileInputFiles', {
        nodeId: node.nodeId,
        files: absoluteFiles,
      }, request.signal, { effectMayHaveCommitted: true })
      return {
        text: `Uploaded ${absoluteFiles.length} file(s) to ${resolved.info.role ?? 'file input'}`,
        structured: { files: absoluteFiles.map((f) => f.replace(normalizedRoot + '/', '')) },
      }
    } finally {
      await releaseBrowserTarget(runtime, resolved, request.signal)
    }
  }

  private async type(request: BrowserAutomationToolRequest): Promise<BrowserToolExecutionResult> {
    const args = (request.arguments ?? {}) as {
      target?: BrowserToolTarget
      ref?: string
      selector?: string
      text?: string
      enter?: boolean
    }
    const text = typeof args.text === 'string' ? args.text : ''
    const runtime = this.requireRuntime(request)
    const target = normalizeTargetInput(args)
    if (!target) {
      // 无目标：聚焦当前页面后直接输入
      await insertText(runtime, text, request.signal)
      return { text: `Typed ${text.length} characters into the page` }
    }
    const resolved = await resolveBrowserTarget(runtime, target, undefined, {
      requireEditable: true,
      signal: request.signal,
    })
    try {
      // 先点击聚焦目标，再插入文本
      await dispatchMouseClick(runtime, resolved.point, request.signal)
      await sleep(60, request.signal)
      await insertText(runtime, text, request.signal)
      if (args.enter === true) {
        await dispatchKey(runtime, 'Enter', request.signal)
      }
    } finally {
      await releaseBrowserTarget(runtime, resolved, request.signal)
    }
    return {
      text: `Typed ${text.length} characters into ${resolved.info.role ?? 'element'}${args.enter === true ? ' and pressed Enter' : ''}`,
      structured: { role: resolved.info.role, name: resolved.info.name },
    }
  }

  private async press(request: BrowserAutomationToolRequest): Promise<BrowserToolExecutionResult> {
    const args = (request.arguments ?? {}) as { key?: string; target?: BrowserToolTarget; ref?: string }
    const key = typeof args.key === 'string' ? args.key : ''
    if (!key) browserHostError({ code: 'BrowserInvalidInput', message: 'key is required' })
    const runtime = this.requireRuntime(request)
    const target = normalizeTargetInput(args)
    if (target) {
      const resolved = await resolveBrowserTarget(runtime, target, undefined, { signal: request.signal })
      try {
        await dispatchMouseClick(runtime, resolved.point, request.signal)
        await sleep(40, request.signal)
      } finally {
        await releaseBrowserTarget(runtime, resolved, request.signal)
      }
    }
    await dispatchKey(runtime, key, request.signal)
    return { text: `Pressed ${key}` }
  }

  private async scroll(request: BrowserAutomationToolRequest): Promise<BrowserToolExecutionResult> {
    const args = (request.arguments ?? {}) as { deltaX?: number; deltaY?: number; direction?: 'up' | 'down'; amount?: number }
    const runtime = this.requireRuntime(request)
    const page = await observePage(runtime, request.signal)
    const deltaY = args.direction === 'up' ? -(args.amount ?? 300) : args.direction === 'down' ? (args.amount ?? 300) : (args.deltaY ?? 300)
    const deltaX = args.deltaX ?? 0
    await sendCdpCommand(runtime, 'Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: Math.round(page.viewport.width / 2),
      y: Math.round(page.viewport.height / 2),
      deltaX,
      deltaY,
    }, request.signal)
    return { text: `Scrolled by ${deltaX},${deltaY}` }
  }

  private async wait(request: BrowserAutomationToolRequest): Promise<BrowserToolExecutionResult> {
    const args = (request.arguments ?? {}) as { ms?: number; timeout?: number }
    const ms = Math.min(Math.max(0, Math.round(args.ms ?? args.timeout ?? 500)), 30_000)
    await sleep(ms, request.signal)
    return { text: `Waited ${ms}ms` }
  }

  private async evaluate(request: BrowserAutomationToolRequest): Promise<BrowserToolExecutionResult> {
    const args = (request.arguments ?? {}) as { expression?: string }
    const expression = typeof args.expression === 'string' ? args.expression.trim() : ''
    if (!expression) browserHostError({ code: 'BrowserInvalidInput', message: 'browser_evaluate requires expression' })
    const runtime = this.requireRuntime(request)
    let value: unknown
    try {
      const response = await evaluateInContext(runtime, expression, {
        userGesture: true,
        returnByValue: true,
        awaitPromise: true,
        effectMayHaveCommitted: true,
        signal: request.signal,
      })
      value = response.value
    } catch (error) {
      if (error instanceof BrowserAutomationHostError) throw error
      browserHostError({
        code: 'BrowserEvaluationFailed',
        retryable: false,
        phase: 'evaluate',
        effectMayHaveCommitted: true,
        message: `Expression failed: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
    throwIfAborted(request.signal)
    let serialized = ''
    try {
      serialized = JSON.stringify(value)
    } catch {
      serialized = ''
    }
    if (!serialized || serialized.length > 262_144) {
      browserHostError({
        code: 'BrowserEvaluationResultTooLarge',
        retryable: false,
        phase: 'evaluate',
        effectMayHaveCommitted: true,
      })
    }
    return {
      text: serialized,
      structured: value,
    }
  }

  private async logs(request: BrowserAutomationToolRequest): Promise<BrowserToolExecutionResult> {
    const args = (request.arguments ?? {}) as { limit?: number; includeConsole?: boolean }
    const runtime = this.requireRuntime(request)
    const entries = this.browserManager.readConsoleLogs({ threadId: request.threadId })
    const limit = Math.max(1, Math.min(500, args.limit ?? 100))
    const slice = entries.slice(-limit)
    return {
      text: JSON.stringify(slice.map((entry) => ({ level: entry.level, message: entry.message })), null, 2),
      structured: slice.map((entry) => ({ level: entry.level, message: entry.message, source: entry.source })),
    }
  }

  private async resize(request: BrowserAutomationToolRequest): Promise<BrowserToolExecutionResult> {
    const args = (request.arguments ?? {}) as { width?: number; height?: number }
    const runtime = this.requireRuntime(request)
    const width = Math.max(320, Math.min(3_840, Math.round(args.width ?? 1_280)))
    const height = Math.max(240, Math.min(2_160, Math.round(args.height ?? 800)))
    const page = await observePage(runtime, request.signal)
    await sendCdpCommand(runtime, 'Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: page.viewport.deviceScaleFactor,
      mobile: false,
      screenWidth: width,
      screenHeight: height,
    }, request.signal, { effectMayHaveCommitted: true })
    const observed = await observePage(runtime, request.signal)
    return {
      text: `Resized viewport to ${observed.viewport.width}x${observed.viewport.height}`,
      structured: { requested: { width, height }, observed: observed.viewport },
    }
  }

  private async close(request: BrowserAutomationToolRequest): Promise<BrowserToolExecutionResult> {
    const args = (request.arguments ?? {}) as { tabId?: string }
    if (typeof args.tabId === 'string' && args.tabId) {
      const result = this.browserManager.closeTab({ threadId: request.threadId, tabId: args.tabId })
      return { text: `Closed tab ${args.tabId}; active tab now ${result.activeTabId ?? 'none'}` }
    }
    this.browserManager.close({ threadId: request.threadId })
    return { text: 'Closed the browser panel' }
  }

  // ===== 内部 =====

  private requireRuntime(request: BrowserAutomationToolRequest): BrowserAutomationVisibleRuntime {
    const runtime = this.browserManager.getAutomationRuntime({ threadId: request.threadId })
    if (!runtime) {
      browserHostError({
        code: 'BrowserNotOpen',
        retryable: true,
        phase: 'runtime',
        message: 'No browser open for this session. Call browser_open first.',
      })
    }
    return runtime
  }
}

function normalizeTargetInput(args: Record<string, unknown>): BrowserToolTarget | null {
  if (args.target && typeof args.target === 'object') return args.target as BrowserToolTarget
  if (typeof args.ref === 'string') return { ref: args.ref, snapshotId: typeof args.snapshotId === 'string' ? args.snapshotId : undefined }
  if (typeof args.selector === 'string') return { selector: args.selector }
  if (args.point && typeof args.point === 'object') return { point: args.point as { x: number; y: number } }
  if (args.locator && typeof args.locator === 'object') return { locator: args.locator as BrowserToolTarget['locator'] }
  return null
}

// ===== CDP 输入动作 =====

const selectExpression = (valuesJson: string): string => String.raw`(() => {
  const el = globalThis.__luxBrowserAutomationV1.currentTarget;
  if (!el || el.nodeType !== 1) return { ok: false };
  if (el.localName !== "select") return { ok: false };
  const values = ${valuesJson};
  const selected = [];
  for (const option of Array.from(el.options)) {
    const match = values.includes(option.value) || values.includes(option.textContent.trim());
    option.selected = match;
    if (match) selected.push(option.value || option.textContent.trim());
  }
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: selected.length > 0, selected };
})()`

async function dispatchMouseDrag(
  runtime: BrowserAutomationVisibleRuntime,
  from: { x: number; y: number },
  to: { x: number; y: number },
  options: { steps: number; signal?: AbortSignal },
): Promise<void> {
  await sendCdpCommand(runtime, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: from.x,
    y: from.y,
  }, options.signal)
  await sendCdpCommand(runtime, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: from.x,
    y: from.y,
    button: 'left',
    clickCount: 1,
  }, options.signal)
  const steps = Math.max(1, options.steps)
  for (let index = 1; index <= steps; index += 1) {
    const t = index / steps
    await sendCdpCommand(runtime, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
      button: 'left',
      buttons: 1,
    }, options.signal)
  }
  await sendCdpCommand(runtime, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: to.x,
    y: to.y,
    button: 'left',
    clickCount: 1,
  }, options.signal)
}

async function dispatchMouseClick(
  runtime: BrowserAutomationVisibleRuntime,
  point: { x: number; y: number },
  signal?: AbortSignal,
): Promise<void> {
  await sendCdpCommand(runtime, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: point.x,
    y: point.y,
  }, signal)
  await sendCdpCommand(runtime, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  }, signal)
  await sendCdpCommand(runtime, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  }, signal)
}

async function insertText(runtime: BrowserAutomationVisibleRuntime, text: string, signal?: AbortSignal): Promise<void> {
  if (!text) return
  await sendCdpCommand(runtime, 'Input.insertText', { text }, signal)
}

async function dispatchKey(runtime: BrowserAutomationVisibleRuntime, key: string, signal?: AbortSignal): Promise<void> {
  const normalized = key === 'Space' || key === ' ' ? ' ' : key
  if (normalized.length === 1) {
    await sendCdpCommand(runtime, 'Input.dispatchKeyEvent', { type: 'keyDown', text: normalized, key: normalized }, signal)
    await sendCdpCommand(runtime, 'Input.dispatchKeyEvent', { type: 'keyUp', key: normalized }, signal)
    return
  }
  const cdpKey = key.toLowerCase()
  await sendCdpCommand(runtime, 'Input.dispatchKeyEvent', { type: 'keyDown', key: cdpKey, code: key }, signal)
  await sendCdpCommand(runtime, 'Input.dispatchKeyEvent', { type: 'keyUp', key: cdpKey, code: key }, signal)
}

export { sleep as browserSleep }
