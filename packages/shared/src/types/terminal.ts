/**
 * Agent 会话内嵌终端（PTY）类型定义
 *
 * 架构：主进程 node-pty 持有真实 shell 进程（cwd 与 Agent 执行目录一致），
 * 渲染进程 xterm.js 负责展示与交互，两者通过 IPC 桥接。
 *
 * 多终端模型：一个 Agent 会话可打开多个终端实例（面板内 tab），
 * 每个实例有全局唯一 terminalId（`<sessionId>#<instanceId>`，主进程/渲染层同规则生成）。
 *  - 渲染 → 主：open / write / resize / close / close-session / get-state
 *  - 主 → 渲染：data 推送（onData）、state-changed 推送（打开/退出）
 *
 * 生命周期：终端面板关闭（或单个 tab 关闭）即销毁对应 pty；重新打开重新 spawn。
 * 切换会话 tab 不销毁 pty（后台保留，重开面板复用 running 实例）。
 */

/** 主进程侧终端会话快照，用于渲染进程恢复/展示状态。 */
export interface TerminalViewState {
  /** 全局唯一终端实例 ID：`<sessionId>#<instanceId>` */
  terminalId: string
  sessionId: string
  /** 会话内实例序号（从 0 递增），用于 tab 标签排序 */
  instanceId: number
  /** pty 启动目录（与 Agent 执行 cwd 一致） */
  cwd: string
  /** shell 可执行文件路径（如 /bin/zsh） */
  shell: string
  /** 进程 PID；未启动或已退出时为 null */
  pid: number | null
  /** shell 是否仍在运行 */
  running: boolean
  /** 退出码；尚未退出为 null */
  exitCode: number | null
  /** pty 当前列数 */
  cols: number
  /** pty 当前行数 */
  rows: number
}

/** 打开终端（渲染 → 主） */
export interface TerminalOpenInput {
  sessionId: string
  /** 会话内实例序号（渲染层递增生成，主进程按同规则拼 terminalId） */
  instanceId: number
  /** 初始列数（xterm 挂载后首次 fit 的近似值） */
  cols: number
  rows: number
  /**
   * 预启动标记：会话激活时后台预热 shell（不推送 STATE_CHANGED，避免误触发面板）；
   * 用户点开面板时 open 复用 running pty + 回放输出缓冲，达到零等待体验。
   */
  warmup?: boolean
}

/** 写入输入（渲染 → 主） */
export interface TerminalWriteInput {
  terminalId: string
  data: string
}

/** 调整尺寸（渲染 → 主） */
export interface TerminalResizeInput {
  terminalId: string
  cols: number
  rows: number
}

/** 关闭单个终端实例（渲染 → 主） */
export interface TerminalCloseInput {
  terminalId: string
}

/** 终端输出推送（主 → 渲染） */
export interface TerminalDataEvent {
  terminalId: string
  data: string
}

/** 终端状态推送（主 → 渲染；打开成功 / 退出 / 错误时发送） */
export interface TerminalStateEvent {
  state: TerminalViewState
}
