/**
 * AgentTerminalController — 会话内嵌终端（PTY）控制器
 *
 * 主进程侧持有终端实例的 node-pty 进程（cwd 与 Agent 执行目录一致），
 * 通过 IPC 与渲染进程 xterm.js 桥接：
 *  - open / write / resize / close / close-session / get-state（渲染 → 主）
 *  - TERMINAL_DATA（主 → 渲染，onData 推送）
 *  - TERMINAL_STATE_CHANGED（主 → 渲染，打开/退出状态）
 *
 * 多终端模型：一个 Agent 会话可打开多个终端实例，terminalId = `<sessionId>#<instanceId>`。
 * 实例级操作（write/resize/close）按 terminalId 定位；会话级操作（close-session）按前缀清理。
 *
 * 生命周期：面板关闭（closeSession）或单个 tab 关闭（close）即 kill 对应 pty；
 * 会话内 pty 仍在运行时重复 open 复用（不丢 shell 状态）；shell 退出后 open 重新 spawn。
 */

import { BrowserWindow } from 'electron'
import type { IPty } from 'node-pty'
import {
  AGENT_IPC_CHANNELS,
  type TerminalCloseInput,
  type TerminalOpenInput,
  type TerminalResizeInput,
  type TerminalViewState,
  type TerminalWriteInput,
} from '@myyoda/shared'
import { chmodSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

// CJS bundle（esbuild format=cjs）下 import.meta 为空对象；用 __filename 保证 createRequire 有效。
const require = createRequire(__filename)

export function buildTerminalId(sessionId: string, instanceId: number): string {
  return `${sessionId}#${instanceId}`
}

interface TerminalEntry {
  terminalId: string
  sessionId: string
  instanceId: number
  cwd: string
  shell: string
  pty: IPty
  cols: number
  rows: number
  running: boolean
  exitCode: number | null
  /** 输出滚动缓冲：预启动期间无订阅者时的数据暂存，面板挂载后 drain 回放 */
  buffer: string
  /** warmup 预启动时间戳；仅 warmup 实例设置（用于空闲回收） */
  warmupAt: number | null
  /** 用户是否打开过面板（true 后不再被空闲回收，随 tab 关闭/面板关闭清理） */
  panelOpened: boolean
}

/** 输出缓冲上限（128KB），超出后丢弃最旧内容。 */
const MAX_TERMINAL_BUFFER = 128 * 1024
/** warmup 预启动的空闲回收超时：超过该时长仍未打开面板则自动 kill。 */
const WARMUP_IDLE_TIMEOUT_MS = 10 * 60 * 1000
/** 空闲回收检查间隔。 */
const IDLE_CHECK_INTERVAL_MS = 60 * 1000

/** 解析默认 shell 路径（macOS 优先用户 SHELL，Windows 用 PowerShell）。 */
function resolveShellPath(): { shell: string; args: string[] } {
  if (process.platform === 'win32') {
    return { shell: 'powershell.exe', args: ['-NoLogo'] }
  }
  const shell = process.env.SHELL?.trim() || '/bin/zsh'
  // 交互式登录 shell：读取用户 rc 文件，对齐系统终端体验
  const name = shell.split('/').pop() ?? ''
  const args = name.includes('zsh') || name.includes('bash') ? ['-l'] : []
  return { shell, args }
}

/**
 * node-pty 的 spawn-helper 在部分安装/打包场景下缺少可执行位，
 * best-effort chmod（与 synara ensureNodePtySpawnHelperExecutable 同理）。
 */
function ensureSpawnHelperExecutable(): void {
  try {
    if (process.platform === 'win32') return
    const packageJsonPath = require.resolve('node-pty/package.json')
    const packageDir = dirname(packageJsonPath)
    const candidates = [
      join(packageDir, 'build', 'Release', 'spawn-helper'),
      join(packageDir, 'build', 'Debug', 'spawn-helper'),
      join(packageDir, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper'),
    ]
    for (const candidate of candidates) {
      try {
        statSync(candidate)
        chmodSync(candidate, 0o755)
        return
      } catch {
        // 继续尝试下一个候选路径
      }
    }
  } catch {
    // spawn-helper 权限修正失败不阻断终端启动（部分平台无需 helper）
  }
}

export class AgentTerminalController {
  private owner: BrowserWindow | null = null
  private readonly entries = new Map<string, TerminalEntry>()
  private idleTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly warmupIdleTimeoutMs: number = WARMUP_IDLE_TIMEOUT_MS,
    private readonly idleCheckIntervalMs: number = IDLE_CHECK_INTERVAL_MS,
  ) {}

  setOwnerWindow(window: BrowserWindow): void {
    this.owner = window
  }

  /** 打开（或复用）终端实例；cwd 必须已由调用方解析为存在的目录。 */
  open(input: TerminalOpenInput & { cwd: string }): TerminalViewState {
    const terminalId = buildTerminalId(input.sessionId, input.instanceId)
    const existing = this.entries.get(terminalId)
    if (existing) {
      if (existing.running) {
        // 面板重开/切换 tab 时复用正在运行的 pty（shell 状态不丢失）
        if (!input.warmup) existing.panelOpened = true
        return this.buildState(existing)
      }
      // 上次 shell 已退出：销毁旧 pty 重新 spawn
      try { existing.pty.kill() } catch { /* noop */ }
      this.entries.delete(terminalId)
    }

    ensureSpawnHelperExecutable()
    // node-pty 原生模块：保持 lazy require，避免渲染进程/非终端场景加载
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ptyModule = require('node-pty') as typeof import('node-pty')
    const { shell, args } = resolveShellPath()
    const cols = Math.max(2, Math.floor(input.cols) || 80)
    const rows = Math.max(2, Math.floor(input.rows) || 24)

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    }

    let pty: IPty
    try {
      if (process.platform === 'win32') {
        pty = ptyModule.spawn(shell, args, {
          cols,
          rows,
          cwd: input.cwd,
          env,
          name: 'xterm-256color',
          useConpty: true,
        })
      } else {
        pty = ptyModule.spawn(shell, args, {
          cols,
          rows,
          cwd: input.cwd,
          env,
          name: 'xterm-256color',
        })
      }
    } catch (error) {
      throw new Error(`无法启动终端：${error instanceof Error ? error.message : String(error)}`)
    }

    const entry: TerminalEntry = {
      terminalId,
      sessionId: input.sessionId,
      instanceId: input.instanceId,
      cwd: input.cwd,
      shell,
      pty,
      cols,
      rows,
      running: true,
      exitCode: null,
      buffer: '',
      warmupAt: input.warmup ? Date.now() : null,
      panelOpened: !input.warmup,
    }
    this.entries.set(terminalId, entry)
    if (input.warmup) this.ensureIdleReaper()

    pty.onData((data: string) => {
      const current = this.entries.get(terminalId)
      if (current) {
        // 滚动缓冲（截断保留最近内容），供面板挂载后回放
        current.buffer = (current.buffer + data).slice(-MAX_TERMINAL_BUFFER)
      }
      this.emit(AGENT_IPC_CHANNELS.TERMINAL_DATA, { terminalId, data } satisfies TerminalDataEventLike)
    })
    pty.onExit(({ exitCode }) => {
      const current = this.entries.get(terminalId)
      if (!current) return
      current.running = false
      current.exitCode = exitCode
      this.emit(AGENT_IPC_CHANNELS.TERMINAL_STATE_CHANGED, { state: this.buildState(current) })
    })

    if (!input.warmup) {
      this.emit(AGENT_IPC_CHANNELS.TERMINAL_STATE_CHANGED, { state: this.buildState(entry) })
    }
    return this.buildState(entry)
  }

  write(input: TerminalWriteInput): void {
    const entry = this.entries.get(input.terminalId)
    if (!entry || !entry.running) return
    try {
      entry.pty.write(input.data)
    } catch {
      // pty 已销毁时静默丢弃输入
    }
  }

  resize(input: TerminalResizeInput): void {
    const entry = this.entries.get(input.terminalId)
    if (!entry || !entry.running) return
    const cols = Math.max(2, Math.floor(input.cols) || entry.cols)
    const rows = Math.max(2, Math.floor(input.rows) || entry.rows)
    if (cols === entry.cols && rows === entry.rows) return
    entry.cols = cols
    entry.rows = rows
    try {
      entry.pty.resize(cols, rows)
    } catch {
      // shell 正在退出等场景 resize 可能失败，忽略
    }
  }

  /** 关闭单个终端实例。 */
  close(input: TerminalCloseInput): TerminalViewState | null {
    const entry = this.entries.get(input.terminalId)
    if (!entry) return null
    entry.running = false
    entry.exitCode = null
    const state = this.buildState(entry)
    try { entry.pty.kill() } catch { /* noop */ }
    this.entries.delete(input.terminalId)
    return state
  }

  /** 关闭会话的全部终端实例（面板整体关闭时调用）。 */
  closeSession(sessionId: string): void {
    const prefix = `${sessionId}#`
    for (const [terminalId, entry] of this.entries) {
      if (!terminalId.startsWith(prefix)) continue
      try { entry.pty.kill() } catch { /* noop */ }
      this.entries.delete(terminalId)
    }
  }

  getState(terminalId: string): TerminalViewState | null {
    const entry = this.entries.get(terminalId)
    return entry ? this.buildState(entry) : null
  }

  /** 拉取并清空输出缓冲（面板挂载时回放预启动期间的历史输出）。 */
  drainBuffer(terminalId: string): string {
    const entry = this.entries.get(terminalId)
    if (!entry) return ''
    const buffered = entry.buffer
    entry.buffer = ''
    return buffered
  }

  /** 应用退出/主窗口销毁时清理所有 pty。 */
  disposeAll(): void {
    if (this.idleTimer) {
      clearInterval(this.idleTimer)
      this.idleTimer = null
    }
    for (const entry of this.entries.values()) {
      try { entry.pty.kill() } catch { /* noop */ }
    }
    this.entries.clear()
  }

  /** 懒启动空闲回收定时器（仅存在 warmup 实例时运行）。 */
  private ensureIdleReaper(): void {
    if (this.idleTimer) return
    this.idleTimer = setInterval(() => this.reapIdleWarmups(), this.idleCheckIntervalMs)
  }

  /** 回收超时未打开面板的 warmup 实例，防止长时间挂机累积后台 shell。 */
  private reapIdleWarmups(): void {
    const now = Date.now()
    for (const [terminalId, entry] of this.entries) {
      if (entry.panelOpened) continue
      if (!entry.warmupAt) continue
      if (now - entry.warmupAt < this.warmupIdleTimeoutMs) continue
      try { entry.pty.kill() } catch { /* noop */ }
      this.entries.delete(terminalId)
    }
    // 没有终端实例时停掉定时器（避免空转）
    if (this.entries.size === 0 && this.idleTimer) {
      clearInterval(this.idleTimer)
      this.idleTimer = null
    }
  }

  private buildState(entry: TerminalEntry): TerminalViewState {
    return {
      terminalId: entry.terminalId,
      sessionId: entry.sessionId,
      instanceId: entry.instanceId,
      cwd: entry.cwd,
      shell: entry.shell,
      pid: entry.running ? entry.pty.pid : null,
      running: entry.running,
      exitCode: entry.exitCode,
      cols: entry.cols,
      rows: entry.rows,
    }
  }

  private emit(channel: string, payload: unknown): void {
    if (!this.owner || this.owner.isDestroyed()) return
    this.owner.webContents.send(channel, payload)
  }
}

/** 终端输出推送负载（与 shared TerminalDataEvent 对齐，本地声明避免循环依赖）。 */
interface TerminalDataEventLike {
  terminalId: string
  data: string
}

/** 全局单例：ipc.ts / index.ts 共享。 */
export const agentTerminalController = new AgentTerminalController()
