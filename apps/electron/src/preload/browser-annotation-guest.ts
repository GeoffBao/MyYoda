/**
 * Browser 元素标注 Guest Preload（移植自 synara browserAnnotations，适配版）
 *
 * 注入到内嵌浏览器的每个页面（WebContentsView preload）。职责：
 * - 页面就绪后通知主进程（browser:annotation-guest ready）
 * - 收到 sync-markers 后渲染标注框（半透明高亮框 + ref 编号徽标）
 * - **滚动/元素移动跟踪**：markers 带唯一 CSS selector，用 rAF 循环按 selector
 *   实时查询元素位置，标注框始终吸附在元素上
 * - **点击拾取 picker**：标注框可点击，点击后弹出注释卡片（role/name + 注释输入），
 *   确认提交 committed / 取消或 Esc 发 cancelled
 *
 * 协议：
 *   main → guest  browser:annotation-command  { kind: sync-markers|clear|start-session|cancel-session }
 *   guest → main  browser:annotation-guest    { kind: ready|committed|cancelled }
 */

import { ipcRenderer } from 'electron'

const COMMAND_CHANNEL = 'browser:annotation-command'
const GUEST_CHANNEL = 'browser:annotation-guest'

export interface GuestAnnotationMarker {
  id: string
  label: string
  x: number
  y: number
  width: number
  height: number
  role?: string
  name?: string
  selector?: string
}

interface CommittedAnnotation {
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

let markers: GuestAnnotationMarker[] = []
let activeSessionId: string | null = null
let interactive = false
let selectedMarker: GuestAnnotationMarker | null = null
let comment = ''
let overlay: HTMLElement | null = null
let boxLayer: HTMLElement | null = null
let interactionLayer: HTMLElement | null = null
let composerEl: HTMLElement | null = null
let rafId: number | null = null
let domReady = document.readyState === 'complete' || document.readyState === 'interactive'

function createGuestSessionId(): string {
  try {
    return typeof globalThis.crypto !== 'undefined' && 'randomUUID' in globalThis.crypto
      ? globalThis.crypto.randomUUID()
      : `g-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
  } catch {
    return `g-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
  }
}

// ===== overlay 构建 =====

function ensureOverlay(): HTMLElement | null {
  if (!document.body) return null
  if (overlay && document.body.contains(overlay)) return overlay
  overlay = document.createElement('div')
  overlay.setAttribute('data-lux-browser-annotations', '')
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;overflow:hidden;' +
    'pointer-events:none;font-family:-apple-system,"Segoe UI",sans-serif;'
  boxLayer = document.createElement('div')
  boxLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;'
  interactionLayer = document.createElement('div')
  interactionLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;'
  overlay.appendChild(boxLayer)
  overlay.appendChild(interactionLayer)
  document.body.appendChild(overlay)
  return overlay
}

// ===== 元素定位（按 selector 实时跟踪） =====

function resolveElementBounds(marker: GuestAnnotationMarker): { el: Element; rect: DOMRect } | null {
  if (marker.selector) {
    try {
      const el = document.querySelector(marker.selector)
      if (el && el.isConnected) {
        const rect = el.getBoundingClientRect()
        if (rect.width > 0 || rect.height > 0) return { el, rect }
      }
    } catch { /* selector invalid */ }
  }
  return null
}

function currentMarkerBounds(marker: GuestAnnotationMarker): DOMRect | null {
  const resolved = resolveElementBounds(marker)
  if (resolved) return resolved.rect
  // 兜底：快照时坐标
  const rect = {
    left: marker.x, top: marker.y,
    width: marker.width, height: marker.height,
    right: marker.x + marker.width, bottom: marker.y + marker.height,
  } as DOMRect
  return rect.width > 0 || rect.height > 0 ? rect : null
}

// ===== 渲染 =====

function renderMarkers(): void {
  const root = ensureOverlay()
  if (!root || !boxLayer) return
  boxLayer.innerHTML = ''
  interactionLayer!.innerHTML = ''

  for (const marker of markers) {
    const bounds = currentMarkerBounds(marker)
    if (!bounds) continue

    const box = document.createElement('div')
    box.setAttribute('data-lux-ref', marker.id)
    const selected = selectedMarker?.id === marker.id
    // 默认 pointer-events:none（标注只展示不拦截页面交互，避免挡住用户点击输入）；
    // 拾取模式（interactive）下才可点击。
    const pointerEvents = interactive || selected ? 'auto' : 'none'
    box.style.cssText =
      `position:absolute;left:${bounds.left}px;top:${bounds.top}px;` +
      `width:${bounds.width}px;height:${bounds.height}px;box-sizing:border-box;` +
      (selected
        ? 'border:2px solid rgba(249,115,22,.95);background:rgba(249,115,22,.18);box-shadow:0 0 0 2px rgba(249,115,22,.35);'
        : 'border:2px solid rgba(59,130,246,.9);background:rgba(59,130,246,.12);') +
      `border-radius:4px;pointer-events:${pointerEvents};cursor:${interactive ? 'pointer' : 'default'};`
    if (interactive || selected) {
      box.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        handleMarkerClick(marker)
      })
    }
    const badge = document.createElement('span')
    badge.textContent = marker.label
    badge.style.cssText =
      'position:absolute;top:-22px;left:-2px;background:#3b82f6;color:#fff;' +
      'font:600 12px/20px -apple-system,"Segoe UI",sans-serif;padding:0 7px;' +
      'border-radius:6px;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.25);pointer-events:none;'
    box.appendChild(badge)
    boxLayer.appendChild(box)
  }
  renderComposer()
}

function renderComposer(): void {
  const root = ensureOverlay()
  if (!root) return
  if (composerEl?.parentElement) composerEl.remove()
  composerEl = null
  if (!selectedMarker) return

  const bounds = currentMarkerBounds(selectedMarker)
  if (!bounds) return
  composerEl = document.createElement('div')
  composerEl.style.cssText =
    `position:absolute;left:${Math.max(8, Math.min(bounds.left, window.innerWidth - 240))}px;` +
    `top:${Math.max(8, bounds.bottom + 8)}px;width:230px;background:#fff;color:#111;` +
    'border:1px solid rgba(0,0,0,.15);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.2);' +
    'pointer-events:auto;z-index:10;overflow:hidden;'
  const header = document.createElement('div')
  header.style.cssText = 'padding:8px 10px;border-bottom:1px solid rgba(0,0,0,.08);font-size:11px;'
  header.textContent = `${selectedMarker.label} · ${selectedMarker.role ?? 'element'}${selectedMarker.name ? ` · ${selectedMarker.name.slice(0, 60)}` : ''}`
  const textarea = document.createElement('textarea')
  textarea.placeholder = '可选注释…'
  textarea.value = comment
  textarea.style.cssText =
    'width:calc(100% - 20px);margin:8px 10px 0;height:56px;border:1px solid rgba(0,0,0,.15);' +
    'border-radius:6px;padding:6px;font:13px/1.4 -apple-system,"Segoe UI",sans-serif;resize:none;' +
    'outline:none;box-sizing:border-box;color:#111;background:#fff;'
  textarea.addEventListener('input', () => { comment = textarea.value })
  const footer = document.createElement('div')
  footer.style.cssText = 'display:flex;justify-content:flex-end;gap:6px;padding:8px 10px;'
  const cancelBtn = document.createElement('button')
  cancelBtn.textContent = '取消'
  cancelBtn.style.cssText = btnStyle('transparent', '#444')
  cancelBtn.addEventListener('click', () => cancelSelection())
  const submitBtn = document.createElement('button')
  submitBtn.textContent = '确认'
  submitBtn.style.cssText = btnStyle('#3b82f6', '#fff')
  submitBtn.addEventListener('click', () => submitAnnotation())
  footer.appendChild(cancelBtn)
  footer.appendChild(submitBtn)
  composerEl.appendChild(header)
  composerEl.appendChild(textarea)
  composerEl.appendChild(footer)
  root.appendChild(composerEl)
  textarea.focus({ preventScroll: true })
}

function btnStyle(background: string, color: string): string {
  return `background:${background};color:${color};border:1px solid ${background === 'transparent' ? 'rgba(0,0,0,.2)' : background};border-radius:6px;padding:4px 12px;font:500 12px/1.4 -apple-system,"Segoe UI",sans-serif;cursor:pointer;`
}

// ===== 交互 =====

function handleMarkerClick(marker: GuestAnnotationMarker): void {
  // 无活动会话时自动启动拾取会话（session-started 通知主进程）
  if (!activeSessionId) {
    activeSessionId = createGuestSessionId()
    ipcRenderer.send(GUEST_CHANNEL, {
      kind: 'session-started',
      sessionId: activeSessionId,
      ref: marker.id,
    })
  }
  if (selectedMarker?.id === marker.id) return
  selectedMarker = marker
  comment = ''
  renderMarkers()
}

function clearSelection(): void {
  selectedMarker = null
  comment = ''
  renderMarkers()
}

function cancelSelection(): void {
  if (activeSessionId) {
    ipcRenderer.send(GUEST_CHANNEL, { kind: 'cancelled', sessionId: activeSessionId })
  }
  clearSelection()
}

function submitAnnotation(): void {
  if (!activeSessionId || !selectedMarker) return
  const bounds = currentMarkerBounds(selectedMarker)
  const annotation: CommittedAnnotation = {
    id: selectedMarker.id,
    ref: selectedMarker.id,
    role: selectedMarker.role,
    name: selectedMarker.name,
    selector: selectedMarker.selector,
    comment,
    x: bounds ? Math.round(bounds.left) : selectedMarker.x,
    y: bounds ? Math.round(bounds.top) : selectedMarker.y,
    width: bounds ? Math.round(bounds.width) : selectedMarker.width,
    height: bounds ? Math.round(bounds.height) : selectedMarker.height,
  }
  ipcRenderer.send(GUEST_CHANNEL, { kind: 'committed', sessionId: activeSessionId, annotation })
  clearSelection()
}

// ===== 跟踪循环 =====

function startTracking(): void {
  if (rafId !== null) return
  const loop = (): void => {
    if (markers.length > 0 || selectedMarker) renderMarkers()
    rafId = requestAnimationFrame(loop)
  }
  rafId = requestAnimationFrame(loop)
}

function stopTracking(): void {
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
}

// ===== 通信 =====

function sendReady(): void {
  ipcRenderer.send(GUEST_CHANNEL, { kind: 'ready' })
}

ipcRenderer.on(COMMAND_CHANNEL, (_event, command: unknown) => {
  const c = command as { kind?: string; markers?: GuestAnnotationMarker[]; sessionId?: string; interactive?: boolean } | null
  if (!c || typeof c !== 'object') return
  switch (c.kind) {
    case 'sync-markers':
      markers = Array.isArray(c.markers) ? c.markers : []
      clearSelection()
      renderMarkers()
      startTracking()
      break
    case 'clear':
      markers = []
      clearSelection()
      stopTracking()
      break
    case 'set-interactive':
      interactive = c.interactive === true
      if (!interactive) clearSelection()
      renderMarkers()
      break
    case 'start-session':
      activeSessionId = typeof c.sessionId === 'string' ? c.sessionId : null
      break
    case 'cancel-session':
      activeSessionId = null
      interactive = false
      clearSelection()
      break
  }
})

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && activeSessionId) {
    cancelSelection()
  }
})

function boot(): void {
  domReady = true
  sendReady()
}

if (domReady) {
  boot()
} else {
  document.addEventListener('DOMContentLoaded', boot, { once: true })
}
