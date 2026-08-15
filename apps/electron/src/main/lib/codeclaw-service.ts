/**
 * CodeClaw 桌面助手服务（主进程状态机）
 *
 * 移植自 clawd-on-desk（AGPL-3.0-only）：
 * - 细粒度动画状态（CodeClawVisual）由 SDK 消息/事件推导，随状态推送给桌宠渲染端
 * - 用户 idle 检测（鼠标长时间未动 + 无活跃会话）→ 渲染端驱动睡眠序列
 * - 光标屏幕坐标高频推送（CODECLAW_IPC_CHANNELS.CURSOR）→ 渲染端眼动追踪
 * - 权限气泡（interaction）把审批所需数据随会话下发，桌宠小窗直接复用主窗口审批服务
 */

import { ipcMain, Menu, screen, type BrowserWindow as ElectronBrowserWindow } from 'electron'
import {
  CODECLAW_IPC_CHANNELS,
  CODECLAW_THEMES,
  type CodeClawInteraction,
  type CodeClawInteractionKind,
  type CodeClawMiniRequest,
  type CodeClawPeekRequest,
  type CodeClawPhase,
  type CodeClawSessionSnapshot,
  type CodeClawSize,
  type CodeClawState,
  type CodeClawThemeId,
  type CodeClawVisual,
  DEFAULT_CODECLAW_SIZE,
  DEFAULT_CODECLAW_THEME_ID,
  isCodeClawSize,
  isCodeClawThemeId,
  type AgentStreamPayload,
} from '@myyoda/shared'
import { agentEventBus } from './agent-service'
import { getAgentSessionMeta } from './agent-session-manager'
import { getSettings, updateSettings } from './settings-service'
import {
  getCodeClawWindow,
  hideCodeClawWindow,
  moveCodeClawWindow,
  onCodeClawWindowReady,
  resizeCodeClawWindow,
  getCodeClawSize,
  setCodeClawMiniMode,
  setCodeClawPeek,
  showCodeClawWindow,
} from './codeclaw-window'

const UNREAD_RETAIN_MS = 10 * 60_000
const PUSH_THROTTLE_MS = 120
const AGENT_STREAM_PUSH_THROTTLE_MS = 1_500
/** 终态会话在 Map 中的最长保留时间：超过后回收，避免长期运行内存无限增长。 */
const SESSION_RETAIN_MS = 24 * 60 * 60_000
/**
 * 活跃会话（running / needs-interaction）无事件时的最长保留时间。
 * 活跃会话正常会持续刷新 lastActivityAt；若事件流因 Agent 异常终止等原因
 * 永久停更，仍需兜底回收，否则会与终态会话一样无限累积。
 */
const SESSION_ACTIVE_MAX_MS = 7 * 24 * 60 * 60_000

/** 鼠标轮询间隔（眼动追踪 + 用户 idle 检测共用）。 */
const CURSOR_POLL_MS = 300
/** 鼠标未移动超过该时长 → userIdle=true（对应上游 mouseIdleTimeout 默认 20s）。 */
const USER_IDLE_TIMEOUT_MS = 20_000

interface InternalCodeClawSession extends CodeClawSessionSnapshot {
  unread: boolean
  terminalAt?: number
}

export interface CodeClawServiceDeps {
  showAndFocusMainWindow: () => void
  openAgentSession: (sessionId: string, title: string) => void
  enabled?: () => boolean
}

let initialized = false
let serviceDeps: CodeClawServiceDeps | null = null
let disposeEventBus: (() => void) | null = null
let pushTimer: ReturnType<typeof setTimeout> | null = null
let lastStateJson = ''
let cursorTimer: ReturnType<typeof setInterval> | null = null
let lastCursor = { x: Number.NaN, y: Number.NaN }
let lastUserActiveAt = Date.now()
let wasUserIdle = false
let miniMode = false
const sessions = new Map<string, InternalCodeClawSession>()

function truncate(text: string, max = 72): string {
  const value = text.trim()
  return value.length <= max ? value : `${value.slice(0, max)}…`
}

function getTitle(sessionId: string): string {
  try {
    const meta = getAgentSessionMeta(sessionId)
    return meta?.title?.trim() || sessionId.slice(0, 8)
  } catch {
    return sessionId.slice(0, 8)
  }
}

function ensureSession(sessionId: string): InternalCodeClawSession {
  let session = sessions.get(sessionId)
  if (!session) {
    const now = Date.now()
    session = {
      sessionId,
      title: getTitle(sessionId),
      phase: 'running',
      visual: 'working',
      detail: '正在准备…',
      attention: false,
      unread: false,
      startedAt: now,
      lastActivityAt: now,
    }
    sessions.set(sessionId, session)
  }
  return session
}

function setVisual(session: InternalCodeClawSession, visual: CodeClawVisual): void {
  if (session.visual !== visual) session.visual = visual
}

function setNeedsInteraction(
  sessionId: string,
  kind: CodeClawInteractionKind,
  detail: string,
  interaction?: CodeClawInteraction,
): void {
  const session = ensureSession(sessionId)
  session.phase = 'needs-interaction'
  session.visual = 'notification'
  session.interactionKind = kind
  session.interaction = interaction
  session.detail = detail
  session.attention = true
  session.lastActivityAt = Date.now()
}

function setRunning(session: InternalCodeClawSession, detail?: string, visual: CodeClawVisual = 'working'): void {
  session.phase = 'running'
  session.interactionKind = undefined
  session.interaction = undefined
  session.attention = false
  session.unread = false
  if (detail) session.detail = detail
  setVisual(session, visual)
  session.lastActivityAt = Date.now()
}

/** 从 AskUserRequest 构建气泡所需的精简问题结构。 */
function buildInteractionFromAskUser(request: {
  requestId: string
  questions?: Array<{
    question: string
    header?: string
    options?: Array<{ label: string; description?: string; preview?: string }>
    multiSelect?: boolean
  }>
}): CodeClawInteraction | undefined {
  const questions = request.questions ?? []
  const first = questions[0]
  if (!first) return undefined
  return {
    kind: 'ask_user_question',
    requestId: request.requestId,
    title: first.header || '需要你回答',
    description: truncate(first.question, 96),
    questions: questions.map((q) => ({
      question: q.question,
      header: q.header,
      options: (q.options ?? []).map((o) => ({ label: o.label, description: o.description, preview: o.preview })),
      multiSelect: q.multiSelect,
    })),
  }
}

/** 从 PermissionRequest 构建气泡。 */
function buildInteractionFromPermission(request: {
  requestId: string
  toolName?: string
  sdkDisplayName?: string
  description?: string
  sdkTitle?: string
  command?: string
  allowAlways?: boolean
}): CodeClawInteraction {
  const toolName = request.toolName || request.sdkDisplayName || '工具'
  const description = request.sdkTitle || request.description || request.command || `请求使用 ${toolName}`
  return {
    kind: 'permission',
    requestId: request.requestId,
    title: toolName,
    description: truncate(description, 120),
    allowAlways: request.allowAlways,
  }
}

/** 从 ExitPlanModeRequest 构建气泡。 */
function buildInteractionFromExitPlan(request: {
  requestId: string
  allowedPrompts?: Array<{ tool: string; prompt: string }>
}): CodeClawInteraction {
  const prompts = request.allowedPrompts ?? []
  return {
    kind: 'plan_review',
    requestId: request.requestId,
    title: '计划审批',
    description: prompts.length > 0
      ? `批准后执行 ${prompts.length} 个操作`
      : 'Agent 请求批准执行计划',
    allowedPrompts: prompts,
  }
}

function isDndEnabled(): boolean {
  return getSettings().codeClaw?.dnd === true
}

function handleMyYodaEvent(sessionId: string, event: import('@myyoda/shared').MyYodaEvent): void {
  switch (event.type) {
    case 'permission_request': {
      if (isDndEnabled()) {
        // 免打扰：交互静默，仅保持执行状态，不弹气泡（对应上游 DND 语义）。
        setRunning(ensureSession(sessionId), '执行中', 'working')
        break
      }
      const request = event.request
      setNeedsInteraction(sessionId, 'permission', request?.sdkTitle || request?.description || '等待权限确认',
        request ? buildInteractionFromPermission(request) : undefined)
      break
    }
    case 'ask_user_request': {
      if (isDndEnabled()) {
        setRunning(ensureSession(sessionId), '执行中', 'working')
        break
      }
      const request = event.request
      const question = request?.questions?.[0]?.question
        ?? request?.questions?.[0]?.header
        ?? '等待回答'
      setNeedsInteraction(sessionId, 'ask_user_question', truncate(question, 48),
        buildInteractionFromAskUser(request))
      break
    }
    case 'exit_plan_mode_request': {
      if (isDndEnabled()) {
        setRunning(ensureSession(sessionId), '执行中', 'working')
        break
      }
      const request = event.request
      setNeedsInteraction(sessionId, 'plan_review', '等待计划审批',
        buildInteractionFromExitPlan(request))
      break
    }
    case 'permission_resolved':
    case 'ask_user_resolved':
    case 'exit_plan_mode_resolved': {
      const session = sessions.get(sessionId)
      if (session && session.phase === 'needs-interaction') setRunning(session, '已响应，继续执行', 'working')
      break
    }
    case 'title_updated': {
      const session = sessions.get(sessionId)
      if (session && event.title) session.title = event.title
      break
    }
    case 'external_run_started':
    case 'run_resumed':
      setRunning(ensureSession(sessionId), '正在执行', 'working')
      break
    case 'retry': {
      const detail = event.status === 'attempt' ? `重试第 ${event.attempt ?? 1} 次` : '等待重试…'
      setRunning(ensureSession(sessionId), detail, 'working')
      break
    }
    default: {
      const session = sessions.get(sessionId)
      if (session) session.lastActivityAt = Date.now()
      break
    }
  }
}

function handleSdkMessage(sessionId: string, message: import('@myyoda/shared').SDKMessage): void {
  switch (message.type) {
    case 'assistant': {
      const assistant = message as import('@myyoda/shared').SDKAssistantMessage
      if (assistant.isReplay) return
      const session = ensureSession(sessionId)
      if (assistant.error) {
        session.phase = 'error'
        session.visual = 'error'
        session.detail = truncate(assistant.error.message || '执行出错', 60)
        session.attention = true
        session.unread = true
        session.terminalAt = Date.now()
        session.lastActivityAt = Date.now()
        return
      }
      setRunning(session)
      for (const block of assistant.message.content ?? []) {
        if (block.type === 'text' && 'text' in block && typeof block.text === 'string' && block.text.trim()) {
          session.detail = truncate(block.text, 56)
          setVisual(session, 'thinking')
        } else if (block.type === 'tool_use') {
          const input = 'input' in block && block.input && typeof block.input === 'object' ? block.input as Record<string, unknown> : {}
          const name = (input['_displayName'] as string | undefined) || ('name' in block && typeof block.name === 'string' ? block.name : undefined) || '工具'
          session.detail = `正在使用 ${name}`
          // 子任务类工具（task / dispatch 等）用 juggling，普通工具用 working。
          const toolName = 'name' in block && typeof block.name === 'string' ? block.name : ''
          const isSubtaskTool = toolName === 'task' || toolName === 'dispatch' || toolName === 'Task' || toolName === 'collaboration'
          setVisual(session, isSubtaskTool ? 'juggling' : 'working')
        }
      }
      break
    }
    case 'result': {
      const result = message as import('@myyoda/shared').SDKResultMessage
      const session = ensureSession(sessionId)
      if (result.subtype === 'success') {
        session.phase = 'completed'
        session.visual = 'attention'
        session.detail = '任务已完成'
      } else {
        session.phase = 'error'
        session.visual = 'error'
        session.detail = truncate(result.errors?.[0] || result.terminal_reason || '执行出错', 60)
      }
      session.attention = true
      session.unread = true
      session.terminalAt = Date.now()
      session.lastActivityAt = Date.now()
      break
    }
    case 'system': {
      const system = message as import('@myyoda/shared').SDKSystemMessage
      const session = ensureSession(sessionId)
      switch (system.subtype) {
        case 'task_started':
          setRunning(session, `子任务：${truncate(system.description || '', 36)}`, 'juggling')
          break
        case 'task_progress':
          setRunning(session, system.description ? `子任务：${truncate(system.description, 36)}` : '子任务推进中', 'juggling')
          break
        case 'compact_boundary':
          setRunning(session, '正在压缩上下文…', 'thinking')
          break
        case 'permission_denied':
          setNeedsInteraction(sessionId, 'permission', '权限被拒绝')
          break
        default:
          session.lastActivityAt = Date.now()
          break
      }
      break
    }
    case 'tool_progress':
      setRunning(ensureSession(sessionId), undefined, 'working')
      break
    default:
      break
  }
}

function handleAgentEvent(sessionId: string, payload: AgentStreamPayload): void {
  if (payload.kind === 'myyoda_event') handleMyYodaEvent(sessionId, payload.event)
  else if (payload.kind === 'sdk_message') handleSdkMessage(sessionId, payload.message)
}

function phaseScore(phase: CodeClawPhase): number {
  if (phase === 'needs-interaction') return 4
  if (phase === 'error') return 3
  if (phase === 'completed') return 2
  if (phase === 'running') return 1
  return 0
}

function isVisibleSession(session: InternalCodeClawSession, now: number): boolean {
  if (now - session.lastActivityAt >= SESSION_RETAIN_MS) return false
  if (session.phase === 'running' || session.phase === 'needs-interaction' || session.phase === 'error') return true
  return session.phase === 'completed'
    && session.unread
    && session.terminalAt !== undefined
    && now - session.terminalAt < UNREAD_RETAIN_MS
}

/**
 * 回收早已结束且长时间无活动的终态会话，防止 sessions Map 无限增长。
 * 终态会话（completed / error）在超过 SESSION_RETAIN_MS 无活动后清理；
 * 活跃会话（running / needs-interaction）在超过 SESSION_ACTIVE_MAX_MS
 * （事件流可能已永久中断）后同样兜底回收。
 */
function pruneExpiredSessions(now: number): void {
  for (const [sessionId, session] of sessions) {
    const isActive = session.phase === 'running' || session.phase === 'needs-interaction'
    const maxRetain = isActive ? SESSION_ACTIVE_MAX_MS : SESSION_RETAIN_MS
    if (now - session.lastActivityAt >= maxRetain) {
      sessions.delete(sessionId)
    }
  }
}

function compareSessions(a: InternalCodeClawSession, b: InternalCodeClawSession): number {
  return phaseScore(b.phase) - phaseScore(a.phase)
    || a.startedAt - b.startedAt
    || a.sessionId.localeCompare(b.sessionId)
}

function getThemeId(): CodeClawThemeId {
  const themeId = getSettings().codeClaw?.themeId
  return isCodeClawThemeId(themeId) ? themeId : DEFAULT_CODECLAW_THEME_ID
}

function buildState(): CodeClawState {
  const now = Date.now()
  pruneExpiredSessions(now)
  const visibleSessions = [...sessions.values()].filter((session) => isVisibleSession(session, now)).sort(compareSessions)
  const priority = visibleSessions[0]
  const phase = priority?.phase ?? 'idle'
  const activeSessionCount = visibleSessions.filter((session) => session.phase === 'running' || session.phase === 'needs-interaction').length
  const pendingInteractionCount = visibleSessions.filter((session) => session.phase === 'needs-interaction').length
  const unreadCompletedCount = visibleSessions.filter((session) => session.phase === 'completed').length
  const enabled = serviceDeps?.enabled?.() === true
  const userIdle = activeSessionCount === 0 && (now - lastUserActiveAt) >= USER_IDLE_TIMEOUT_MS
  return {
    visible: enabled,
    themeId: getThemeId(),
    prioritySession: priority ? toPublicSession(priority) : undefined,
    sessions: visibleSessions.map(toPublicSession),
    activeSessionCount,
    pendingInteractionCount,
    unreadCompletedCount,
    phase,
    visual: priority?.visual ?? 'idle',
    userIdle,
    miniMode,
    dnd: isDndEnabled(),
    size: getCodeClawSize(),
    soundEnabled: getSettings().codeClaw?.soundEnabled !== false,
    cursor: lastCursor,
    headline: priority?.title ?? 'CodeClaw',
    detail: priority?.detail ?? '准备协助你的研发工作',
    updatedAt: Math.max(0, ...visibleSessions.map((session) => session.lastActivityAt)),
  }
}

function toPublicSession(session: InternalCodeClawSession): CodeClawSessionSnapshot {
  return {
    sessionId: session.sessionId,
    title: session.title,
    phase: session.phase,
    visual: session.visual,
    interactionKind: session.interactionKind,
    interaction: session.interaction,
    detail: session.detail,
    attention: session.attention,
    startedAt: session.startedAt,
    lastActivityAt: session.lastActivityAt,
  }
}

function pushState(): void {
  const state = buildState()
  const json = JSON.stringify(state)
  if (json === lastStateJson) return
  lastStateJson = json
  if (state.visible) showCodeClawWindow()
  else hideCodeClawWindow()
  const win = getCodeClawWindow()
  if (!win || win.isDestroyed()) return
  if (!win.webContents.isDestroyed()) win.webContents.send(CODECLAW_IPC_CHANNELS.STATE, state)
}

function schedulePush(delay = PUSH_THROTTLE_MS): void {
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(() => {
    pushTimer = null
    pushState()
  }, delay)
}

function requiresImmediatePush(payload: AgentStreamPayload): boolean {
  if (payload.kind !== 'myyoda_event') return false
  return payload.event.type === 'permission_request'
    || payload.event.type === 'ask_user_request'
    || payload.event.type === 'exit_plan_mode_request'
    || payload.event.type === 'permission_resolved'
    || payload.event.type === 'ask_user_resolved'
    || payload.event.type === 'exit_plan_mode_resolved'
}

/** 轮询全局光标：驱动 userIdle 检测 + 眼动追踪光标推送。 */
function startCursorPolling(): void {
  if (cursorTimer) return
  cursorTimer = setInterval(() => {
    try {
      const point = screen.getCursorScreenPoint()
      if (point.x !== lastCursor.x || point.y !== lastCursor.y) {
        lastCursor = { x: point.x, y: point.y }
        lastUserActiveAt = Date.now()
        const win = getCodeClawWindow()
        if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
          win.webContents.send(CODECLAW_IPC_CHANNELS.CURSOR, lastCursor)
        }
        // 用户从 idle 恢复活动时立即刷新 userIdle 状态。
        if (wasUserIdle) schedulePush()
      }
      const userIdle = (Date.now() - lastUserActiveAt) >= USER_IDLE_TIMEOUT_MS
      if (userIdle !== wasUserIdle) {
        wasUserIdle = userIdle
        schedulePush()
      }
    } catch {
      // screen 不可用（窗口销毁过程中）时静默跳过。
    }
  }, CURSOR_POLL_MS)
}

function stopCursorPolling(): void {
  if (cursorTimer) {
    clearInterval(cursorTimer)
    cursorTimer = null
  }
}

export function setCodeClawTheme(themeId: CodeClawThemeId): void {
  const current = getSettings().codeClaw ?? {}
  updateSettings({ codeClaw: { ...current, themeId } })
  schedulePush()
}

export function setCodeClawSize(size: CodeClawSize): void {
  resizeCodeClawWindow(size)
  schedulePush()
}

export function setCodeClawDnd(dnd: boolean): void {
  const current = getSettings().codeClaw ?? {}
  updateSettings({ codeClaw: { ...current, dnd } })
  schedulePush()
}

export function setCodeClawSound(enabled: boolean): void {
  const current = getSettings().codeClaw ?? {}
  updateSettings({ codeClaw: { ...current, soundEnabled: enabled } })
  schedulePush()
}

/** 切换 Mini 模式（托盘/右键菜单共用；同步 service 与窗口状态）。 */
export function setCodeClawMiniModeControl(mini: boolean): void {
  miniMode = mini
  setCodeClawMiniMode(mini, 'right')
  schedulePush()
}

/** 托盘/菜单读取当前桌宠控制状态。 */
export function getCodeClawControlSnapshot(): {
  enabled: boolean
  miniMode: boolean
  dnd: boolean
  themeId: CodeClawThemeId
  size: CodeClawSize
  soundEnabled: boolean
} {
  const settings = getSettings().codeClaw ?? {}
  return {
    enabled: settings.enabled === true,
    miniMode,
    dnd: settings.dnd === true,
    themeId: isCodeClawThemeId(settings.themeId) ? settings.themeId : DEFAULT_CODECLAW_THEME_ID,
    size: getCodeClawSize(),
    soundEnabled: settings.soundEnabled !== false,
  }
}

/** 构建桌宠右键菜单（渲染端 contextmenu → 主进程原生菜单）。 */
function buildCodeClawContextMenu(): Menu {
  const settings = getSettings().codeClaw ?? {}
  const currentSize = settings.size ?? DEFAULT_CODECLAW_SIZE
  const currentTheme = isCodeClawThemeId(settings.themeId) ? settings.themeId : DEFAULT_CODECLAW_THEME_ID
  return Menu.buildFromTemplate([
    {
      label: miniMode ? '退出 Mini 模式' : '进入 Mini 模式',
      click: () => {
        miniMode = !miniMode
        setCodeClawMiniMode(miniMode, 'right')
        schedulePush()
      },
    },
    { type: 'separator' },
    {
      label: '主题',
      submenu: CODECLAW_THEMES.map((theme) => ({
        label: theme.name,
        type: 'radio' as const,
        checked: theme.id === currentTheme,
        click: () => setCodeClawTheme(theme.id),
      })),
    },
    {
      label: '尺寸',
      submenu: ([
        ['s', '小'],
        ['m', '中'],
        ['l', '大'],
      ] as const).map(([id, label]) => ({
        label,
        type: 'radio' as const,
        checked: currentSize === id,
        click: () => setCodeClawSize(id),
      })),
    },
    { type: 'separator' },
    {
      label: '免打扰',
      type: 'checkbox' as const,
      checked: settings.dnd === true,
      click: (item) => setCodeClawDnd(item.checked),
    },
    {
      label: '音效',
      type: 'checkbox' as const,
      checked: settings.soundEnabled !== false,
      click: (item) => setCodeClawSound(item.checked),
    },
    { type: 'separator' },
    {
      label: '打开 MyYoda',
      click: () => serviceDeps?.showAndFocusMainWindow(),
    },
  ])
}

function markCodeClawSessionViewed(sessionId: string): void {
  const session = sessions.get(sessionId)
  if (!session || session.phase !== 'completed' || !session.unread) return
  session.unread = false
  session.attention = false
  schedulePush()
}

function openCodeClawSession(sessionId?: string): void {
  if (!serviceDeps) return
  const target = sessionId ? sessions.get(sessionId) : buildState().prioritySession
  if (!target) {
    serviceDeps.showAndFocusMainWindow()
    return
  }
  markCodeClawSessionViewed(target.sessionId)
  serviceDeps.openAgentSession(target.sessionId, target.title)
  serviceDeps.showAndFocusMainWindow()
  schedulePush()
}

export function initCodeClawService(deps: CodeClawServiceDeps): void {
  if (initialized) return
  initialized = true
  serviceDeps = deps

  disposeEventBus = agentEventBus.on((sessionId, payload) => {
    if (deps.enabled?.() === false) return
    lastUserActiveAt = Date.now()
    handleAgentEvent(sessionId, payload)
    schedulePush(requiresImmediatePush(payload) ? PUSH_THROTTLE_MS : AGENT_STREAM_PUSH_THROTTLE_MS)
  })

  onCodeClawWindowReady(() => {
    lastStateJson = ''
    pushState()
  })

  startCursorPolling()

  ipcMain.handle(CODECLAW_IPC_CHANNELS.MOVE, (_event, req: { x: number; y: number }) => {
    if (typeof req?.x === 'number' && typeof req?.y === 'number') moveCodeClawWindow(req.x, req.y)
  })

  ipcMain.handle(CODECLAW_IPC_CHANNELS.OPEN_MAIN_WINDOW, () => {
    deps.showAndFocusMainWindow()
  })

  ipcMain.handle(CODECLAW_IPC_CHANNELS.OPEN_SESSION, (_event, sessionId?: unknown) => {
    openCodeClawSession(typeof sessionId === 'string' ? sessionId : undefined)
  })

  ipcMain.handle(CODECLAW_IPC_CHANNELS.MARK_SESSION_VIEWED, (_event, sessionId: unknown) => {
    if (typeof sessionId === 'string' && sessionId.length > 0) markCodeClawSessionViewed(sessionId)
  })

  ipcMain.handle(CODECLAW_IPC_CHANNELS.SET_THEME, (_event, themeId: unknown) => {
    if (isCodeClawThemeId(themeId)) setCodeClawTheme(themeId)
  })

  ipcMain.handle(CODECLAW_IPC_CHANNELS.SET_MINI_MODE, (_event, req: CodeClawMiniRequest) => {
    if (!req || typeof req !== 'object') return
    miniMode = req.mini === true
    setCodeClawMiniMode(req.mini === true, req.edge === 'left' ? 'left' : 'right')
    schedulePush()
  })

  ipcMain.handle(CODECLAW_IPC_CHANNELS.PEEK_MINI, (_event, req: CodeClawPeekRequest) => {
    if (!req || typeof req !== 'object') return
    setCodeClawPeek(req.peek === true)
  })

  ipcMain.handle(CODECLAW_IPC_CHANNELS.SET_SIZE, (_event, size: unknown) => {
    if (isCodeClawSize(size)) setCodeClawSize(size)
  })

  ipcMain.handle(CODECLAW_IPC_CHANNELS.SET_DND, (_event, dnd: unknown) => {
    if (typeof dnd === 'boolean') setCodeClawDnd(dnd)
  })

  ipcMain.handle(CODECLAW_IPC_CHANNELS.SET_SOUND, (_event, enabled: unknown) => {
    if (typeof enabled === 'boolean') setCodeClawSound(enabled)
  })

  ipcMain.handle(CODECLAW_IPC_CHANNELS.OPEN_CONTEXT_MENU, (event) => {
    const win = event.sender as unknown as { getOwnerBrowserWindow?: () => ElectronBrowserWindow | null }
    const owner = win.getOwnerBrowserWindow?.() ?? null
    if (owner && !owner.isDestroyed()) {
      buildCodeClawContextMenu().popup({ window: owner })
    }
  })
}

export function refreshCodeClawConfiguration(): void {
  lastStateJson = ''
  schedulePush()
}

export function publishCodeClawNow(): void {
  lastStateJson = ''
  pushState()
}

export function disposeCodeClawService(): void {
  stopCursorPolling()
  if (disposeEventBus) {
    disposeEventBus()
    disposeEventBus = null
  }
  if (pushTimer) {
    clearTimeout(pushTimer)
    pushTimer = null
  }
  ipcMain.removeHandler(CODECLAW_IPC_CHANNELS.MOVE)
  ipcMain.removeHandler(CODECLAW_IPC_CHANNELS.OPEN_MAIN_WINDOW)
  ipcMain.removeHandler(CODECLAW_IPC_CHANNELS.OPEN_SESSION)
  ipcMain.removeHandler(CODECLAW_IPC_CHANNELS.MARK_SESSION_VIEWED)
  ipcMain.removeHandler(CODECLAW_IPC_CHANNELS.SET_THEME)
  ipcMain.removeHandler(CODECLAW_IPC_CHANNELS.SET_MINI_MODE)
  ipcMain.removeHandler(CODECLAW_IPC_CHANNELS.PEEK_MINI)
  ipcMain.removeHandler(CODECLAW_IPC_CHANNELS.SET_SIZE)
  ipcMain.removeHandler(CODECLAW_IPC_CHANNELS.SET_DND)
  ipcMain.removeHandler(CODECLAW_IPC_CHANNELS.SET_SOUND)
  ipcMain.removeHandler(CODECLAW_IPC_CHANNELS.OPEN_CONTEXT_MENU)
  initialized = false
  serviceDeps = null
  sessions.clear()
  lastStateJson = ''
  wasUserIdle = false
  miniMode = false
  lastCursor = { x: Number.NaN, y: Number.NaN }
}
