/**
 * Browser 语义快照（移植自 synara semanticSnapshot.ts 的逻辑层，脚本常量在
 * browser-snapshot-script.ts）。
 *
 * 职责：在隔离的 automation world 里收集语义快照（交互元素 refs + 可见文本），
 * 返回给 Agent 用于理解页面并定位元素（click/type 按 ref）。
 */

import { randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import type { BrowserTabId } from './browser-types'
import type { BrowserAutomationVisibleRuntime } from './browser-cdp'
import { drainOnAbort, evaluateInContext, observePage, sendCdpCommand, throwIfAborted } from './browser-cdp'
import { browserHostError } from './browser-errors'
import {
  BROWSER_AUTOMATION_WORLD_NAME,
  BROWSER_SEMANTIC_SNAPSHOT_EXPRESSION,
} from './browser-snapshot-script'

const MAX_STRUCTURED_SNAPSHOT_BYTES = 512 * 1024
const MAX_VISIBLE_TEXT_BYTES = 6 * 1024
const MAX_CONTEXT_ANCESTORS = 4
const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024

export interface BrowserSnapshotHandle {
  readonly snapshotId: string
  readonly tabId: string
  readonly contextId: number
  readonly generation: number
  readonly humanControlEpoch: number
}

interface RawSemanticElement {
  readonly ref: string
  readonly role: string
  readonly name: string
  readonly selector?: string
  readonly context?: readonly { readonly role: string; readonly name: string }[]
  readonly description?: string
  readonly value?: string
  readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  readonly states: readonly string[]
}

interface RawSemanticSnapshot {
  readonly generation: number
  readonly elements: readonly RawSemanticElement[]
  readonly visibleText: string
  readonly semanticTruncated: boolean
  readonly visibleTextTruncated: boolean
}

export interface BrowserSnapshotHostOutput {
  readonly snapshotId: string
  readonly tabId: string
  readonly url: string
  readonly title: string
  readonly capturedAt: string
  readonly viewport: { readonly width: number; readonly height: number; readonly deviceScaleFactor: number }
  readonly elements: Array<{
    ref: string
    role: string
    name: string
    selector?: string
    context?: Array<{ role: string; name: string }>
    description?: string
    value?: string
    bounds: { x: number; y: number; width: number; height: number }
    states: string[]
  }>
  readonly visibleText: string
  readonly truncationReasons: string[]
  readonly diagnostics?: Array<{ code: string; message: string }>
  readonly image?: { mimeType: string; width: number; height: number; byteLength: number }
}

const boundedUtf8 = (value: string, maximumBytes: number): string => {
  const bytes = Buffer.from(value, 'utf8')
  if (bytes.byteLength <= maximumBytes) return value
  let end = maximumBytes
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1
  return bytes.subarray(0, end).toString('utf8')
}

export const createAutomationWorld = async (
  runtime: BrowserAutomationVisibleRuntime,
  signal?: AbortSignal,
): Promise<number> => {
  throwIfAborted(signal)
  await sendCdpCommand(runtime, 'Page.enable', {}, signal)
  await sendCdpCommand(runtime, 'Runtime.enable', {}, signal)
  const tree = await sendCdpCommand<{
    readonly frameTree?: { readonly frame?: { readonly id?: string } }
  }>(runtime, 'Page.getFrameTree', {}, signal)
  const frameId = tree.frameTree?.frame?.id
  if (!frameId) throw new Error('The visible browser has no main frame.')
  const world = await sendCdpCommand<{ readonly executionContextId?: number }>(
    runtime,
    'Page.createIsolatedWorld',
    { frameId, worldName: BROWSER_AUTOMATION_WORLD_NAME, grantUniveralAccess: false },
    signal,
  )
  throwIfAborted(signal)
  if (!world.executionContextId) throw new Error('The browser automation world is unavailable.')
  return world.executionContextId
}

export const captureSemanticSnapshot = async (
  runtime: BrowserAutomationVisibleRuntime,
  input: {
    readonly includeImage: boolean
    readonly includeDiagnostics: boolean
    readonly humanControlEpoch: number
  },
  signal?: AbortSignal,
): Promise<{
  readonly output: { structuredContent: BrowserSnapshotHostOutput; image?: { mimeType: string; width: number; height: number; byteLength: number; data: string } }
  readonly handle: BrowserSnapshotHandle
}> => {
  throwIfAborted(signal)
  const contextId = await createAutomationWorld(runtime, signal)
  const semantic = await evaluateInContext<RawSemanticSnapshot>(
    runtime,
    BROWSER_SEMANTIC_SNAPSHOT_EXPRESSION,
    { contextId, signal },
  )
  if (!semantic.value || !Array.isArray(semantic.value.elements)) {
    throw new Error('The browser semantic snapshot was malformed.')
  }
  const page = await observePage(runtime, signal)
  const snapshotId = randomUUID()
  const truncationReasons: string[] = []
  if (semantic.value.semanticTruncated) truncationReasons.push('semantic-element-limit')
  if (
    semantic.value.visibleTextTruncated ||
    Buffer.byteLength(semantic.value.visibleText, 'utf8') > MAX_VISIBLE_TEXT_BYTES
  ) {
    truncationReasons.push('visible-text-limit')
  }
  let structuredContent: BrowserSnapshotHostOutput = {
    snapshotId,
    tabId: runtime.tabId as BrowserTabId,
    url: boundedUtf8(page.url, 8_192),
    title: boundedUtf8(page.title, 2_048),
    capturedAt: new Date().toISOString(),
    viewport: page.viewport,
    elements: semantic.value.elements.map((element) => ({
      ...element,
      name: boundedUtf8(element.name, 256),
      context: (element.context ?? [])
        .slice(0, MAX_CONTEXT_ANCESTORS)
        .map((ancestor: { readonly role: string; readonly name: string }) => ({
          role: ancestor.role,
          name: boundedUtf8(ancestor.name, 512),
        })),
      ...(element.description ? { description: boundedUtf8(element.description, 256) } : {}),
      ...(element.value ? { value: boundedUtf8(element.value, 1_024) } : {}),
      states: [...element.states].slice(0, 24),
    })),
    visibleText: boundedUtf8(semantic.value.visibleText, MAX_VISIBLE_TEXT_BYTES),
    truncationReasons,
  }
  if (input.includeDiagnostics) {
    structuredContent = {
      ...structuredContent,
      diagnostics: [
        { code: 'semantic-runtime', message: 'Snapshot collected from the shared Electron browser runtime.' },
        { code: 'closed-shadow-unobservable', message: 'Closed shadow roots created before snapshot collection cannot be observed safely.' },
      ],
    }
  }

  while (
    Buffer.byteLength(JSON.stringify(structuredContent), 'utf8') > MAX_STRUCTURED_SNAPSHOT_BYTES &&
    structuredContent.elements.length > 0
  ) {
    structuredContent = {
      ...structuredContent,
      elements: structuredContent.elements.slice(0, -1),
      truncationReasons: structuredContent.truncationReasons.includes('structured-byte-limit')
        ? structuredContent.truncationReasons
        : [...structuredContent.truncationReasons, 'structured-byte-limit'],
    }
  }
  if (Buffer.byteLength(JSON.stringify(structuredContent), 'utf8') > MAX_STRUCTURED_SNAPSHOT_BYTES) {
    browserHostError({
      code: 'BrowserSnapshotTooLarge',
      retryable: true,
      phase: 'snapshot',
      effectMayHaveCommitted: false,
      tabId: runtime.tabId as BrowserTabId,
    })
  }

  let image: { mimeType: string; width: number; height: number; byteLength: number; data: string } | undefined
  if (input.includeImage) {
    throwIfAborted(signal)
    let nativeImage = await drainOnAbort(runtime.webContents.capturePage(), signal)
    throwIfAborted(signal)
    const originalSize = nativeImage.getSize()
    if (originalSize.width > 3_840 || originalSize.height > 2_160) {
      const scale = Math.min(3_840 / originalSize.width, 2_160 / originalSize.height)
      nativeImage = nativeImage.resize({
        width: Math.max(1, Math.floor(originalSize.width * scale)),
        height: Math.max(1, Math.floor(originalSize.height * scale)),
        quality: 'best',
      })
    }
    const png = nativeImage.toPNG()
    const size = nativeImage.getSize()
    if (png.byteLength === 0 || png.byteLength > MAX_SCREENSHOT_BYTES) {
      browserHostError({
        code: 'BrowserSnapshotTooLarge',
        retryable: true,
        phase: 'snapshot',
        effectMayHaveCommitted: false,
        tabId: runtime.tabId as BrowserTabId,
      })
    }
    const imageMetadata = {
      mimeType: 'image/png',
      width: Math.max(1, size.width),
      height: Math.max(1, size.height),
      byteLength: png.byteLength,
    }
    structuredContent = { ...structuredContent, image: imageMetadata }
    image = { ...imageMetadata, data: png.toString('base64') }
  }

  return {
    output: { structuredContent, ...(image ? { image } : {}) },
    handle: {
      snapshotId,
      tabId: runtime.tabId,
      contextId,
      generation: semantic.value.generation,
      humanControlEpoch: input.humanControlEpoch,
    },
  }
}
