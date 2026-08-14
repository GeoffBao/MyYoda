/**
 * TerminalViewport — 单个终端实例的 xterm.js 视图
 *
 * 生命周期：
 * 1. 挂载后立即订阅 onAgentTerminalData（按 terminalId 过滤；未 ready 的数据先缓冲）
 * 2. 调用 openAgentTerminal 让主进程 spawn pty（复用 running 实例时不重新 spawn）
 * 3. 输出推送 → term.write；用户输入 → writeAgentTerminal
 * 4. ResizeObserver + 防抖 → fit + resizeAgentTerminal
 * 5. 主题背景/前景/光标从 CSS 变量（--content-area/--foreground）实时读取，跟随应用主题
 *
 * 多终端场景：面板内多个实例共存，非激活实例保持挂载（display:none），
 * 切换回激活时 ResizeObserver 触发 fit。
 */

import * as React from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import { useAtomValue, useSetAtom } from 'jotai'
import { AlertCircle } from 'lucide-react'
import { resolvedThemeAtom } from '@/atoms/theme'
import { agentSessionsAtom } from '@/atoms/agent-atoms'
import { terminalStateMapAtom } from '@/atoms/terminal-atoms'
import { cn } from '@/lib/utils'
import { buildTerminalContextKey, shouldReopenTerminal } from './terminal-context-tracking'

const RESIZE_DEBOUNCE_MS = 120
const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24

function readCodeFont(): string | undefined {
  try {
    const font = getComputedStyle(document.documentElement).getPropertyValue('--theme-font-code').trim()
    return font || undefined
  } catch {
    return undefined
  }
}

/** 读取 CSS 变量（Tailwind HSL 格式）并带 alpha 返回为 rgba(...) 字符串；失败回退 fallback。 */
function readCssColorAlpha(variable: string, fallback: string, alpha: number): string {
  try {
    const probe = document.createElement('div')
    probe.style.cssText = `position:fixed;visibility:hidden;left:-9999px;top:-9999px;background:hsl(var(${variable}) / ${alpha})`
    document.body.appendChild(probe)
    const rgb = getComputedStyle(probe).backgroundColor
    probe.remove()
    if (!rgb || rgb === 'transparent' || rgb === 'rgba(0, 0, 0, 0)') return fallback
    return rgb
  } catch {
    return fallback
  }
}

const DARK_ANSI = {
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#e5e5e5',
}

const LIGHT_ANSI = {
  black: '#000000',
  red: '#cd3131',
  green: '#107c10',
  yellow: '#949800',
  blue: '#0451a5',
  magenta: '#bc05bc',
  cyan: '#0598bc',
  white: '#555555',
  brightBlack: '#666666',
  brightRed: '#cd3131',
  brightGreen: '#14ce14',
  brightYellow: '#b5ba00',
  brightBlue: '#0451a5',
  brightMagenta: '#bc05bc',
  brightCyan: '#0598bc',
  brightWhite: '#a5a5a5',
}

function buildThemeFromCss(isDark: boolean): Record<string, string> {
  // 默认行为：终端背景 = 正文背景（--content-area 不透明），前景/光标 = --foreground，
  // 选区 = --primary 半透明。与主题正文完全一致，无特殊分支。
  // 注意：Tailwind 变量是 HSL 分量格式（如 `29 18% 9%`），必须 hsl() 包裹才能解析。
  const background = readCssColorAlpha('--content-area', isDark ? 'rgba(30,30,30,1)' : 'rgba(255,255,255,1)', 1)
  const foreground = readCssColorAlpha('--foreground', isDark ? 'rgba(212,212,212,1)' : 'rgba(51,51,51,1)', 1)
  const selection = readCssColorAlpha('--primary', isDark ? 'rgba(38,79,120,0.4)' : 'rgba(173,214,255,0.4)', 0.4)
  return {
    ...(isDark ? DARK_ANSI : LIGHT_ANSI),
    background,
    foreground,
    cursor: foreground,
    selectionBackground: selection,
  }
}

interface TerminalViewportProps {
  sessionId: string
  /** 全局唯一终端实例 ID（`<sessionId>#<instanceId>`） */
  terminalId: string
  instanceId: number
  /** 是否可见（非激活实例保持挂载但隐藏，切换回来时自动 fit） */
  visible: boolean
  className?: string
}

export function TerminalViewport({ sessionId, terminalId, instanceId, visible, className }: TerminalViewportProps): React.ReactElement {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const termRef = React.useRef<Terminal | null>(null)
  const fitAddonRef = React.useRef<FitAddon | null>(null)
  const pendingDataRef = React.useRef('')
  const readyRef = React.useRef(false)
  const resizeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const fitTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSizeRef = React.useRef<{ cols: number; rows: number }>({ cols: DEFAULT_COLS, rows: DEFAULT_ROWS })
  const resolvedTheme = useAtomValue(resolvedThemeAtom)
  const setTerminalStateMap = useSetAtom(terminalStateMapAtom)
  const [error, setError] = React.useState<string | null>(null)
  const visibleRef = React.useRef(visible)
  visibleRef.current = visible

  // 会话改绑工作区/项目会改变 pty cwd；归属变化时触发重开（清理旧 xterm → 重新 open，
  // 主进程会校验 cwd 并重启 pty）。判定逻辑见 terminal-context-tracking（纯函数 + 单测）。
  const sessions = useAtomValue(agentSessionsAtom)
  const sessionContextKey = React.useMemo(
    () => buildTerminalContextKey(sessions.find((item) => item.id === sessionId)),
    [sessions, sessionId],
  )
  const [contextVersion, setContextVersion] = React.useState(0)
  const lastContextKeyRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    const decision = shouldReopenTerminal(lastContextKeyRef.current, sessionContextKey)
    lastContextKeyRef.current = decision.nextLastKey
    if (decision.reopen) setContextVersion((version) => version + 1)
  }, [sessionContextKey])

  // 创建 xterm + 订阅数据 + open pty（terminalId 或会话归属变化时重开）
  React.useEffect(() => {
    const mount = containerRef.current
    if (!mount) return
    let disposed = false

    const fontFamily = readCodeFont()
    const term = new Terminal({
      fontSize: 12,
      ...(fontFamily ? { fontFamily } : {}),
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 5000,
      allowProposedApi: true,
      theme: buildThemeFromCss(resolvedTheme === 'dark'),
    })
    const fitAddon = new FitAddon()
    const searchAddon = new SearchAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(searchAddon)
    term.open(mount)
    termRef.current = term
    fitAddonRef.current = fitAddon

    // 挂载后立即尝试 fit（不等 open IPC 返回），保证容器就绪时 xterm 尺寸先正确
    try { fitAddon.fit() } catch { /* 容器尚未布局，后续兜底 */ }
    // 即时反馈：pty spawn + shell 启动（~1s）期间显示启动提示，resolve 后清屏换 prompt
    term.write('\x1b[90m[正在启动终端…]\x1b[0m\r\n')

    // 先订阅再 open：主进程 spawn 后的首批输出不会丢失
    const unsubscribeData = window.electronAPI.onAgentTerminalData((event) => {
      if (event.terminalId !== terminalId) return
      if (readyRef.current && termRef.current) {
        termRef.current.write(event.data)
      } else {
        pendingDataRef.current += event.data
      }
    })
    const unsubscribeState = window.electronAPI.onAgentTerminalStateChanged((event) => {
      if (event.state.terminalId !== terminalId) return
      if (!event.state.running) {
        readyRef.current = false
        if (termRef.current) {
          termRef.current.write(`\r\n\x1b[90m[进程已退出，退出码 ${event.state.exitCode ?? '?'}]\x1b[0m\r\n`)
        }
      }
    })

    // 用户输入 → pty
    const inputDisposable = term.onData((data) => {
      void window.electronAPI.writeAgentTerminal({ terminalId, data }).catch(() => undefined)
    })

    // 打开 pty（此时已有订阅，首批输出进入 buffer 或直接写入）
    let cancelled = false
    void window.electronAPI
      .openAgentTerminal({ sessionId, instanceId, cols: DEFAULT_COLS, rows: DEFAULT_ROWS })
      .then(async (state) => {
        if (cancelled || disposed) return
        // 同步状态到全局 map（warmup/复用时主进程不推送 STATE_CHANGED，这里补写）
        setTerminalStateMap((previous) => { const next = new Map(previous); next.set(terminalId, state); return next })
        // 关键：ready + flush 不依赖 rAF（窗口繁忙/失焦时 rAF 可能延迟执行，
        // 导致 pty 首帧输出一直停留在缓冲里、屏幕空白）。
        readyRef.current = true
        term.clear()
        // 回放主进程缓冲的历史输出（预启动期间无订阅者时暂存的数据，如 shell prompt）。
        // 注意：主进程 onData 先写 buffer 再推送 DATA，所以 pendingData 中的内容
        // 一定已包含在 buffer 里；这里先清空 pendingData，避免与回放内容重复显示。
        pendingDataRef.current = ''
        const buffered = await window.electronAPI.getAgentTerminalBuffer(terminalId).catch(() => '')
        if (cancelled || disposed) return
        if (buffered) term.write(buffered)
        if (pendingDataRef.current) {
          term.write(pendingDataRef.current)
          pendingDataRef.current = ''
        }
        // 多时机 fit + focus：立即一次（容器可能已就绪）→ rAF 一次（布局完成后）→ 定时兜底
        fitAndFocus()
        requestAnimationFrame(() => { if (!cancelled && !disposed) fitAndFocus() })
        fitTimerRef.current = setTimeout(() => { if (!cancelled && !disposed) fitAndFocus() }, 200)
        scheduleResize(term, fitAddon)
      })
      .catch((reason: unknown) => {
        if (cancelled || disposed) return
        const message = reason instanceof Error ? reason.message : String(reason)
        setError(message)
        term.write(`\r\n\x1b[31m无法启动终端：${message}\x1b[0m\r\n`)
      })

    function fitAndFocus(): void {
      if (disposed || !termRef.current || !fitAddonRef.current) return
      try {
        fitAddonRef.current.fit()
        const cols = termRef.current.cols
        const rows = termRef.current.rows
        if (cols !== lastSizeRef.current.cols || rows !== lastSizeRef.current.rows) {
          lastSizeRef.current = { cols, rows }
          void window.electronAPI.resizeAgentTerminal({ terminalId, cols, rows }).catch(() => undefined)
        }
      } catch {
        // 容器尚未布局，ResizeObserver / 后续 fit 兜底
      }
      if (visibleRef.current) termRef.current.focus()
    }

    // 容器尺寸变化 → fit + resize（防抖）
    const resizeObserver = new ResizeObserver(() => {
      scheduleResize(term, fitAddon)
    })
    resizeObserver.observe(mount)

    function scheduleResize(termInstance: Terminal, fit: FitAddon): void {
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)
      resizeTimerRef.current = setTimeout(() => {
        resizeTimerRef.current = null
        if (disposed || !readyRef.current) return
        try {
          fit.fit()
          const cols = termInstance.cols
          const rows = termInstance.rows
          if (cols !== lastSizeRef.current.cols || rows !== lastSizeRef.current.rows) {
            lastSizeRef.current = { cols, rows }
            void window.electronAPI.resizeAgentTerminal({ terminalId, cols, rows }).catch(() => undefined)
          }
        } catch {
          // 容器不可见/未布局时跳过
        }
      }, RESIZE_DEBOUNCE_MS)
    }

    return () => {
      disposed = true
      cancelled = true
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)
      if (fitTimerRef.current) clearTimeout(fitTimerRef.current)
      unsubscribeData()
      unsubscribeState()
      inputDisposable.dispose()
      resizeObserver.disconnect()
      try { term.dispose() } catch { /* noop */ }
      termRef.current = null
      fitAddonRef.current = null
      readyRef.current = false
      pendingDataRef.current = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalId, contextVersion])

  // 主题跟随：读取 CSS 变量构建 xterm theme。
  // 预设切换（Haze → Night Owl 等 custom pack）通过改写 html 的 class/style 投影 CSS 变量，
  // resolvedTheme（dark/light）可能不变 → 用 MutationObserver 监听属性变化重新应用，
  // 覆盖 system 深浅、具名风格、custom 预设、scenic 玻璃等所有主题变化场景。
  React.useEffect(() => {
    const apply = (): void => {
      if (!termRef.current) return
      termRef.current.options.theme = buildThemeFromCss(resolvedTheme === 'dark')
    }
    apply()
    const observer = new MutationObserver(apply)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
    return () => observer.disconnect()
  }, [resolvedTheme])

  // 切换回可见时立即 fit + 聚焦
  React.useEffect(() => {
    if (!visible) return
    if (!readyRef.current) return
    requestAnimationFrame(() => {
      if (!termRef.current || !fitAddonRef.current) return
      try { fitAddonRef.current.fit() } catch { /* noop */ }
      termRef.current.focus()
    })
  }, [visible])

  return (
    <div className={cn('relative h-full w-full overflow-hidden', className)}>
      {error && (
        <div className="absolute left-2 top-2 z-10 flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded border border-destructive/30 bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
          <AlertCircle className="size-3 shrink-0" />
          <span className="truncate">{error}</span>
        </div>
      )}
      <div ref={containerRef} className="h-full w-full" />
    </div>
  )
}
