import { atom } from 'jotai'
import type { TerminalViewState } from '@myyoda/shared'
import { currentAgentSessionIdAtom } from './agent-atoms'

/** 每个 Agent 会话的终端面板开关。主进程仍是 pty 状态权威。 */
export const terminalPanelOpenMapAtom = atom<Map<string, boolean>>(new Map())
export const terminalStateMapAtom = atom<Map<string, TerminalViewState>>(new Map())

/** 终端抽屉高度（px），全局共享，可拖拽调整。 */
export const terminalDrawerHeightAtom = atom<number>(260)

/** 当前会话的终端状态（用于面板标题栏展示 cwd / 运行状态）。 */
export const currentSessionTerminalStateAtom = atom<TerminalViewState | null>((get) => {
  const sessionId = get(currentAgentSessionIdAtom)
  return sessionId ? get(terminalStateMapAtom).get(sessionId) ?? null : null
})
