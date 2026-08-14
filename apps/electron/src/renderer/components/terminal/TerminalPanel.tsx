/**
 * TerminalPanel — 会话底部终端抽屉（多终端）
 *
 * 挂在 MainArea 左侧内容区（TabBar + TabContent）下方，打开时压缩会话高度。
 * 顶部有拖拽手柄可调整高度；标题栏包含终端 tab 栏（可新建/关闭多个终端实例）；
 * 面板关闭（X）即销毁该会话的全部 pty。
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { Plus, SquareTerminal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { terminalDrawerHeightAtom, terminalPanelOpenMapAtom, terminalStateMapAtom } from '@/atoms/terminal-atoms'
import { TerminalViewport } from './TerminalViewport'

const MIN_HEIGHT = 120
const MAX_HEIGHT = 600

interface TerminalInstance {
  terminalId: string
  instanceId: number
}

function buildTerminalId(sessionId: string, instanceId: number): string {
  return `${sessionId}#${instanceId}`
}

interface TerminalPanelProps {
  sessionId: string
  onClose: () => void
}

export function TerminalPanel({ sessionId, onClose }: TerminalPanelProps): React.ReactElement {
  const [height, setHeight] = useAtom(terminalDrawerHeightAtom)
  const setOpenMap = useSetAtom(terminalPanelOpenMapAtom)
  const setStateMap = useSetAtom(terminalStateMapAtom)
  const stateMap = useAtomValue(terminalStateMapAtom)
  const draggingRef = React.useRef(false)
  const nextInstanceIdRef = React.useRef(0)

  // 面板挂载时创建第一个终端实例
  const [terminals, setTerminals] = React.useState<TerminalInstance[]>(() => [
    { terminalId: buildTerminalId(sessionId, 0), instanceId: 0 },
  ])
  const [activeTerminalId, setActiveTerminalId] = React.useState<string>(() => buildTerminalId(sessionId, 0))

  // 面板关闭：销毁该会话全部 pty + 清理全局状态
  const close = React.useCallback(async () => {
    const closeSession = (window.electronAPI as Partial<typeof window.electronAPI>).closeAgentTerminalSession
    if (typeof closeSession === 'function') {
      try { await closeSession(sessionId) } catch { /* noop */ }
    }
    setOpenMap((previous) => { const next = new Map(previous); next.delete(sessionId); return next })
    setStateMap((previous) => {
      const next = new Map(previous)
      const prefix = `${sessionId}#`
      for (const key of next.keys()) {
        if (key.startsWith(prefix)) next.delete(key)
      }
      return next
    })
    onClose()
  }, [onClose, sessionId, setOpenMap, setStateMap])

  // 新建终端实例
  const createTerminal = React.useCallback(() => {
    const instanceId = ++nextInstanceIdRef.current
    const terminalId = buildTerminalId(sessionId, instanceId)
    setTerminals((previous) => [...previous, { terminalId, instanceId }])
    setActiveTerminalId(terminalId)
  }, [sessionId])

  // 关闭单个终端实例
  const closeTerminal = React.useCallback((terminalId: string) => {
    const closeTerminalApi = (window.electronAPI as Partial<typeof window.electronAPI>).closeAgentTerminal
    if (typeof closeTerminalApi === 'function') {
      try { void closeTerminalApi({ terminalId }) } catch { /* noop */ }
    }
    setStateMap((previous) => { const next = new Map(previous); next.delete(terminalId); return next })
    setTerminals((previous) => {
      const next = previous.filter((t) => t.terminalId !== terminalId)
      return next
    })
    // 关闭的是激活实例时，切到最后一个剩余实例（在 updater 外计算，保持 updater 纯函数）
    setActiveTerminalId((current) => {
      if (current !== terminalId) return current
      const remaining = terminals.filter((t) => t.terminalId !== terminalId)
      return remaining.at(-1)?.terminalId ?? ''
    })
  }, [setStateMap, terminals])

  // 顶部拖拽手柄：调整抽屉高度
  const handleDragStart = React.useCallback((event: React.PointerEvent) => {
    event.preventDefault()
    draggingRef.current = true
    const startY = event.clientY
    const startHeight = height
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'row-resize'

    const onMove = (moveEvent: PointerEvent): void => {
      if (!draggingRef.current) return
      const next = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, startHeight + (startY - moveEvent.clientY)))
      setHeight(next)
    }
    const onUp = (): void => {
      draggingRef.current = false
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }, [height, setHeight])

  // 激活实例的状态（标题栏展示 cwd/运行状态）
  const activeState = activeTerminalId ? stateMap.get(activeTerminalId) ?? null : null
  const running = activeState?.running ?? false
  const cwd = activeState?.cwd ?? ''

  return (
    <div
      className="relative flex min-h-0 flex-col overflow-hidden border-t border-border/60 bg-content-area"
      style={{ height: `${Math.max(MIN_HEIGHT, height)}px` }}
    >
      {/* 拖拽手柄 */}
      <div
        className="absolute inset-x-0 top-0 z-20 h-1.5 cursor-row-resize hover:bg-primary/30"
        onPointerDown={handleDragStart}
        aria-label="调整终端高度"
      />
      {/* 标题栏 */}
      <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border/30 bg-muted/20 pl-3 pr-2">
        <SquareTerminal className="size-3.5 shrink-0 text-primary" />
        <span className="shrink-0 text-[11px] font-medium text-foreground">终端</span>
        {/* 终端实例 tab 栏 */}
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-none">
          {terminals.map((terminal) => (
            <div
              key={terminal.terminalId}
              className={cn(
                'group flex h-6 shrink-0 items-center gap-1 rounded px-2 text-[11px]',
                terminal.terminalId === activeTerminalId
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
              )}
            >
              <button
                type="button"
                className="min-w-0"
                onClick={() => setActiveTerminalId(terminal.terminalId)}
              >
                <span className="truncate">Terminal {terminal.instanceId + 1}</span>
              </button>
              {terminals.length > 1 && (
                <button
                  type="button"
                  className="shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-60 hover:bg-muted hover:opacity-100"
                  aria-label={`关闭 Terminal ${terminal.instanceId + 1}`}
                  onClick={() => closeTerminal(terminal.terminalId)}
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          ))}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant="ghost" size="icon" className="size-6 shrink-0" onClick={createTerminal} aria-label="新建终端">
                <Plus className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom"><p>新建终端</p></TooltipContent>
          </Tooltip>
        </div>
        <span className="hidden shrink-0 font-mono text-[11px] text-muted-foreground lg:block" title={cwd}>
          {cwd || '未连接'}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded px-1.5 py-px text-[10px] font-medium',
              running ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground',
            )}
            title={running ? cwd ? `运行中 · ${cwd}` : '运行中' : '进程已退出'}
          >
            {running ? (
              <>
                {/* 运行指示器（synara 风格）：三个跳动点，CSS 动画不占 React 渲染 */}
                <span className="inline-grid size-2.5 grid-cols-3 grid-rows-1 gap-px" aria-hidden="true">
                  <span className="terminal-running-dot size-1 rounded-full bg-current" style={{ animationDelay: '0ms' }} />
                  <span className="terminal-running-dot size-1 rounded-full bg-current" style={{ animationDelay: '120ms' }} />
                  <span className="terminal-running-dot size-1 rounded-full bg-current" style={{ animationDelay: '240ms' }} />
                </span>
                运行中
              </>
            ) : (
              '已退出'
            )}
          </span>
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="size-6 shrink-0" onClick={() => void close()}>
              <X className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom"><p>关闭终端</p></TooltipContent>
        </Tooltip>
      </div>
      {/* xterm 内容区：多实例层叠，仅激活实例可见（其余保持挂载保留状态） */}
      <div className="relative min-h-0 flex-1">
        {terminals.map((terminal) => (
          <div
            key={terminal.terminalId}
            className={cn('absolute inset-0', terminal.terminalId === activeTerminalId ? '' : 'hidden')}
          >
            <TerminalViewport
              sessionId={sessionId}
              terminalId={terminal.terminalId}
              instanceId={terminal.instanceId}
              visible={terminal.terminalId === activeTerminalId}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
