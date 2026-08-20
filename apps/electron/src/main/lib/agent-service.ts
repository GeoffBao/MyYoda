/**
 * Agent 服务层（IPC 薄层）
 *
 * 职责：
 * - 创建 AgentOrchestrator / EventBus / Adapter 实例
 * - 注册 EventBus IPC 转发中间件（webContents.send）
 * - 导出 IPC handler 调用的薄包装函数
 * - 文件操作（saveFilesToAgentSession）
 *
 * 所有业务逻辑已委托给 AgentOrchestrator。
 */

import { dirname, relative } from 'node:path'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolveSafeChildPath } from './agent-file-path-policy'
import { BrowserWindow } from 'electron'
import type { WebContents } from 'electron'
import { AGENT_IPC_CHANNELS, MAX_ATTACHMENT_SIZE } from '@myyoda/shared'
import type {
  AgentSendInput,
  AgentGenerateTitleInput,
  AgentSaveFilesInput,
  AgentSaveWorkspaceFilesInput,
  AgentSavedFile,
  AgentStreamEvent,
  AgentStreamPayload,
  AgentQueueMessageInput,
  AgentDeferredQueueMessageInput,
  AgentQueuedMessageControlInput,
  AgentMoveQueuedMessageInput,
  AgentQueuedMessageSnapshot,
  MyYodaPermissionMode,
  AgentExternalRunSource,
  AgentMessage,
} from '@myyoda/shared'
import { PiAgentAdapter, cleanupPiRuntimeResources } from './adapters/pi-agent-adapter'
import { PiUtilityAdapter } from './adapters/pi-utility-adapter'
import { AgentEventBus } from './agent-event-bus'
import { AgentOrchestrator } from './agent-orchestrator'
import { getAgentSessionWorkspacePath, getWorkspaceFilesDir } from './config-paths'
import { getAgentSessionMeta, listAgentSessions, updateAgentSessionMeta } from './agent-session-manager'
import { setAgentStopper, setHeadlessAgentRunner } from './agent-headless-runner-registry'
import { getHeadlessAgentRunTarget } from './agent-headless-run-target'
import { assertRegisteredSessionUpload, resolveRegisteredUploadWorkspace } from './agent-upload-boundary-policy'
import { listAgentWorkspaces, getWorkspaceAttachedFiles } from './agent-workspace-manager'
import { sendAgentStreamComplete } from './agent-completion-payload'
import { AgentStreamForwarder } from './agent-stream-forwarder'
import { AgentQueueCoordinator } from './agent-queue-coordinator'
import { permissionService } from './agent-permission-service'
import { askUserService } from './agent-ask-user-service'
import { exitPlanService } from './agent-exit-plan-service'
import { listChannels } from './channel-manager'

// ===== 实例创建 =====

const eventBus = new AgentEventBus()
const useUtilityAgentRuntime = process.env.MYYODA_AGENT_RUNTIME !== 'in-process'
  && process.env.MYYODA_AGENT_RUNTIME !== 'off'
const adapter = useUtilityAgentRuntime ? new PiUtilityAdapter() : new PiAgentAdapter()
const orchestrator = new AgentOrchestrator(adapter, eventBus)

function getCompletionSessionOrigin(sessionId: string): { sourceDelegationId?: string; taskNodeId?: string } {
  try {
    const meta = getAgentSessionMeta(sessionId)
    return {
      ...(meta?.sourceDelegationId ? { sourceDelegationId: meta.sourceDelegationId } : {}),
      ...(meta?.taskNodeId ? { taskNodeId: meta.taskNodeId } : {}),
    }
  } catch {
    return {}
  }
}

/** 导出 EventBus 供飞书 Bridge 等外部服务订阅事件 */
export { eventBus as agentEventBus }

/** 获取 AgentOrchestrator 单例（供 oss-kanban task-handlers 使用） */
export function getOrchestrator(): AgentOrchestrator {
  return orchestrator
}

// 注册协作子会话 EventBus 阻塞事件监听
import('./agent-collaboration-tools').then(({ registerCollaborationEventBus }) => {
  registerCollaborationEventBus(eventBus)
}).catch(() => { /* collaboration 模块可能未加载 */ })

/**
 * 会话 → webContents 映射
 *
 * EventBus IPC 转发中间件通过此映射找到目标 webContents。
 * runAgent 开始时注册，结束时清理。
 */
const sessionWebContents = new Map<string, WebContents>()
/** 每个 renderer 当前可见的 Agent 会话；仅该会话维持 20fps partial。 */
const visibleAgentSessionByWebContents = new WeakMap<WebContents, string | null>()
const streamForwarder = new AgentStreamForwarder()

/**
 * 已挂载 destroyed 回收钩子的 webContents 集合。
 *
 * 同一个主窗口 webContents 可能被多次注册（飞书 Bridge 每条消息触发一次 runAgentHeadless），
 * 用 WeakSet 去重避免 once listener 在同一 wc 上累积，触发 MaxListenersExceededWarning。
 */
const wcWithCleanupHook = new WeakSet<WebContents>()

/**
 * 注册 sessionId → webContents 映射，并在 webContents 销毁时自动清理所有相关条目。
 *
 * 仅依赖 finally 块清理无法覆盖窗口关闭、渲染进程崩溃、headless 路径主窗口被替换等
 * webContents 提前销毁的场景——destroyed 事件兜底。
 */
function registerWebContents(sessionId: string, wc: WebContents): void {
  // 同一 sessionId 切换 renderer 时，先丢弃捕获旧 wc.send 的等待 partial，避免投递到旧窗口。
  const previousWebContents = sessionWebContents.get(sessionId)
  if (previousWebContents && previousWebContents !== wc) streamForwarder.clear(sessionId)
  // 旧 wc 的 destroyed 钩子仍由 WeakSet 持有，触发时会扫描 sessionWebContents 清理所有指向它的条目。
  sessionWebContents.set(sessionId, wc)
  if (wcWithCleanupHook.has(wc)) return
  wcWithCleanupHook.add(wc)
  wc.once('destroyed', () => {
    // 单个 wc 可能映射到多个 sessionId（同窗口多 tab），需要清理所有指向它的条目
    for (const [sid, mappedWc] of sessionWebContents) {
      if (mappedWc === wc) {
        sessionWebContents.delete(sid)
        streamForwarder.clear(sid)
      }
    }
    visibleAgentSessionByWebContents.delete(wc)
  })
}

function isMainRendererWindow(win: BrowserWindow): boolean {
  if (win.isDestroyed()) return false
  const url = win.webContents.getURL()
  if (!url) return false
  if (url.startsWith('data:')) return false
  return !url.includes('window=quick-task')
    && !url.includes('window=voice-dictation')
    && !url.includes('window=detached-preview')
    && !url.includes('window=codeclaw')
}

function getMainRendererWebContents(): WebContents | null {
  const win = BrowserWindow.getAllWindows().find(isMainRendererWindow)
  return win && !win.webContents.isDestroyed() ? win.webContents : null
}

/**
 * Renderer run 在创建飞书镜像卡片时尚未进入 orchestrator.activeSessions。
 * 在此期间保留启动槽位，避免会话迁移改变已接受请求的项目归属。
 * （本地 agentQueueCoordinator 实例在本文件靠后定义，仅在运行时被 isAgentSessionBusy 调用，模块加载顺序无影响）。
 */
const startingAgentSessions = new Set<string>()

export function reserveAgentSessionStart(sessionId: string): () => void {
  if (startingAgentSessions.has(sessionId) || orchestrator.isActive(sessionId)) {
    throw new Error('会话正在启动或运行中，请等待当前请求结束后再发送。')
  }
  startingAgentSessions.add(sessionId)
  return () => startingAgentSessions.delete(sessionId)
}

export function isAgentSessionBusy(sessionId: string): boolean {
  return startingAgentSessions.has(sessionId)
    || orchestrator.isActive(sessionId)
    || agentQueueCoordinator.hasPending(sessionId)
}

function publishRunStopped(
  sessionId: string,
  stoppedByUser: boolean | undefined,
  startedAt: number | undefined,
): void {
  if (!stoppedByUser) return
  eventBus.emit(sessionId, {
    kind: 'myyoda_event',
    event: {
      type: 'run_stopped',
      ...(startedAt != null ? { startedAt } : {}),
    },
  })
}

// ===== Deferred queue 调度器（排队消息主进程调度） =====

/** 与渲染进程原 dispatchQueuedMessage 的调度前置检查保持一致。 */
function canDispatchQueuedMessage(sessionId: string, input: AgentDeferredQueueMessageInput): boolean {
  const meta = getAgentSessionMeta(sessionId)
  // 用户手动停止后等待下一次明确发送，不自动续发。
  if (meta?.stoppedByUser) return false
  // 只读 legacy 会话（需 continuation 的 Claude 历史会话）不能作为新 run 启动。
  if (meta?.legacyTranscript?.continuationRequired) return false
  // 阻塞中的交互请求（权限/AskUser/ExitPlan 审批）不能被自动派发打断。
  if (
    permissionService.getPendingRequests().some((request) => request.sessionId === sessionId) ||
    askUserService.getPendingRequests().some((request) => request.sessionId === sessionId) ||
    exitPlanService.getPendingRequests().some((request) => request.sessionId === sessionId)
  ) {
    return false
  }
  if (!input.channelId) return false
  const hasAvailableModel = listChannels().some((channel) => (
    channel.enabled && channel.models.some((model) => model.enabled)
  ))
  return hasAvailableModel
}

function getParentDir(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const idx = normalized.lastIndexOf('/')
  if (idx <= 0) return ''
  return normalized.slice(0, idx)
}

/**
 * 派发时补齐会话级附加目录/文件（渲染进程原 dispatch 在发送前做的合并）：
 * 会话 attachedDirectories + attachedFiles 父目录 + 工作区 attachedFiles 父目录 + 入队时携带的目录。
 */
function enrichDeferredQueueInput(input: AgentDeferredQueueMessageInput): AgentDeferredQueueMessageInput {
  try {
    const meta = getAgentSessionMeta(input.sessionId)
    const dirs = new Set<string>(input.additionalDirectories ?? [])
    for (const dir of meta?.attachedDirectories ?? []) dirs.add(dir)
    const workspaceId = input.workspaceId ?? meta?.workspaceId
    const workspaceSlug = workspaceId
      ? listAgentWorkspaces().find((workspace) => workspace.id === workspaceId)?.slug
      : undefined
    const workspaceFiles = workspaceSlug ? getWorkspaceAttachedFiles(workspaceSlug) : []
    for (const file of [...(meta?.attachedFiles ?? []), ...workspaceFiles]) {
      const parent = getParentDir(file)
      if (parent) dirs.add(parent)
    }
    return dirs.size > 0 ? { ...input, additionalDirectories: Array.from(dirs) } : input
  } catch {
    return input
  }
}

const agentQueueCoordinator = new AgentQueueCoordinator({
  isActive: (sessionId) => orchestrator.isActive(sessionId),
  getWebContents: (sessionId) => sessionWebContents.get(sessionId) ?? getMainRendererWebContents(),
  startRun: async (input, webContents) => {
    await runAgent(enrichDeferredQueueInput(input), webContents)
  },
  sendStatus: (webContents, status) => {
    if (!webContents.isDestroyed()) webContents.send(AGENT_IPC_CHANNELS.QUEUED_MESSAGE_STATUS, status)
  },
  canDispatch: canDispatchQueuedMessage,
})

// ===== EventBus IPC 转发中间件 =====

/**
 * 完成事件只需要侧栏/导航使用的轻量 meta。Pi 的 entry bindings 仅用于主进程
 * session fork/rewind，传到 renderer 会在长会话完成时徒增 IPC 序列化成本。
 */
function getSessionMetaForRenderer(sessionId: string) {
  const session = getAgentSessionMeta(sessionId)
  if (!session) return undefined
  const { piEntryBindings: _piEntryBindings, ...meta } = session
  return meta
}

eventBus.use((sessionId, payload, next) => {
  // 兜底：未走 runAgent/runAgentHeadless 注册时（如旧 Conductor 直调），仍推到主窗口
  let wc = sessionWebContents.get(sessionId)
  if (!wc || wc.isDestroyed()) {
    const main = getMainRendererWebContents()
    if (main) {
      registerWebContents(sessionId, main)
      wc = main
    }
  }
  if (wc && !wc.isDestroyed()) {
    try {
      streamForwarder.forward(
        { sessionId, payload } as AgentStreamEvent,
        (event) => wc.send(AGENT_IPC_CHANNELS.STREAM_EVENT, event),
        visibleAgentSessionByWebContents.get(wc) === sessionId,
      )
    } catch (err) {
      console.error(`[EventBus] wc.send 失败: sessionId=${sessionId}, payload.kind=${(payload as Record<string, unknown>)?.kind}`, err)
    }
  }
  // 后台任务完成通知：解除该会话的 backgroundWaiting，重新评估 deferred queue。
  const message = (payload as { kind?: string; message?: { type?: string; subtype?: string } })?.message
  if (payload.kind === 'sdk_message' && message?.type === 'system' && message?.subtype === 'task_notification') {
    agentQueueCoordinator.onBackgroundTaskComplete(sessionId)
  }
  next()
})

/** renderer 切换标签时更新流式优先级；切入会话立即 flush 等待中的后台快照。 */
export function setVisibleAgentSession(webContents: WebContents, sessionId: string | null): void {
  const previousSessionId = visibleAgentSessionByWebContents.get(webContents)
  if (previousSessionId && previousSessionId !== sessionId) {
    // 切出后将已排队的前台帧按后台频率重排，避免继续以 20fps 发送。
    streamForwarder.reprioritize(previousSessionId, false)
  }
  visibleAgentSessionByWebContents.set(webContents, sessionId)
  if (sessionId) streamForwarder.promote(sessionId)
}

// ===== IPC 薄包装函数 =====

/**
 * 运行 Agent 并流式推送事件到渲染进程
 *
 * 注册 webContents 到 EventBus 映射，委托给 Orchestrator。
 */
export async function runAgent(
  input: AgentSendInput,
  webContents: WebContents,
  extensions?: { piCustomTools?: import('@earendil-works/pi-coding-agent').ToolDefinition[] },
): Promise<void> {
  // 更新 webContents 映射（允许覆盖 — 由 orchestrator.activeSessions 处理真正的并发保护）
  registerWebContents(input.sessionId, webContents)
  // deferred queue 派发的 run 携带队列消息 ID（内部扩展，不进入持久化）
  const queueMessageId = (input as Partial<AgentDeferredQueueMessageInput>).queueMessageId
  // 开始新一轮执行时清除"完成未确认"标记
  try {
    updateAgentSessionMeta(input.sessionId, { completedButUnconfirmed: false })
  } catch { /* 新会话可能尚未写入索引 */ }
  // 自动任务会话"毕业"：用户手动发消息（非定时触发）即视为接管，标记后该会话回到普通项目列表，
  // 调度器也不再复用它注入新的定时运行。
  if (input.triggeredBy !== 'automation') {
    try {
      const meta = getAgentSessionMeta(input.sessionId)
      if (meta?.sourceAutomationId && !meta.automationGraduated) {
        updateAgentSessionMeta(input.sessionId, { automationGraduated: true })
        // 向渲染进程发送毕业事件，触发 toast 提示
        eventBus.emit(input.sessionId, {
          kind: 'myyoda_event',
          event: { type: 'automation_graduated' },
        })
      }
    } catch { /* 新会话可能尚未写入索引 */ }
  }
  // 记录本轮完成方式，供 try 块尾部（onComplete 未触发的异常路径）复用
  let completedBackgroundTasksPending = false
  let completedStoppedByUser = false
  try {
    await orchestrator.sendMessage(input, {
      onError: (error) => {
        if (!webContents.isDestroyed()) {
          webContents.send(AGENT_IPC_CHANNELS.STREAM_ERROR, {
            sessionId: input.sessionId,
            error,
          })
        }
      },
      onComplete: (messages, opts) => {
        completedBackgroundTasksPending = opts?.backgroundTasksPending === true
        completedStoppedByUser = opts?.stoppedByUser === true
        agentQueueCoordinator.onRunComplete(
          input.sessionId,
          queueMessageId,
          completedBackgroundTasksPending,
          completedStoppedByUser,
        )
        publishRunStopped(input.sessionId, opts?.stoppedByUser, opts?.startedAt)
        if (!webContents.isDestroyed()) {
          sendAgentStreamComplete(webContents, input, {
            messages,
            ...getCompletionSessionOrigin(input.sessionId),
            stoppedByUser: opts?.stoppedByUser ?? false,
            startedAt: opts?.startedAt,
            resultSubtype: opts?.resultSubtype,
            resultErrors: opts?.resultErrors,
            backgroundTasksPending: opts?.backgroundTasksPending,
            // 只读取刚完成的轻量 meta，renderer 可据此增量更新列表，避免再取 5,000+ 条全量会话。
            session: getSessionMetaForRenderer(input.sessionId),
          })
        }
      },
      onRunStarted: ({ startedAt }) => {
        eventBus.emit(input.sessionId, {
          kind: 'myyoda_event',
          event: { type: 'run_started', startedAt },
        })
      },
      onTitleUpdated: (title) => {
        eventBus.emit(input.sessionId, {
          kind: 'myyoda_event',
          event: { type: 'title_updated', title },
        })
        if (!webContents.isDestroyed()) {
          webContents.send(AGENT_IPC_CHANNELS.TITLE_UPDATED, {
            sessionId: input.sessionId,
            title,
          })
        }
      },
    }, extensions)
    // onComplete 未触发的拒绝路径（如新 run 被并发保护拒绝）也要重新评估队列。
    agentQueueCoordinator.onRunComplete(
      input.sessionId,
      queueMessageId,
      completedBackgroundTasksPending,
      completedStoppedByUser,
    )
  } catch (err) {
    console.error('[Agent 服务] runAgent 未处理异常:', err)
    const errorMessage = err instanceof Error ? err.message : '未知错误'
    if (!webContents.isDestroyed()) {
      webContents.send(AGENT_IPC_CHANNELS.STREAM_ERROR, {
        sessionId: input.sessionId,
        error: errorMessage,
      })
    }
    // 队列派发的消息失败时放回队首并通知渲染进程回滚展示（在 stream complete 之前送达，
    // 保证渲染进程能先恢复队列条目再清理本轮流式状态）。
    agentQueueCoordinator.onRunFailed(input.sessionId, queueMessageId)
    if (!webContents.isDestroyed()) {
      sendAgentStreamComplete(webContents, input, {
        messages: [],
        ...getCompletionSessionOrigin(input.sessionId),
        stoppedByUser: false,
      })
    }
  } finally {
    // 仅在 orchestrator 已完成此会话时清理映射
    // 避免被拒绝的请求误删仍在运行的会话映射
    if (!orchestrator.isActive(input.sessionId)) {
      sessionWebContents.delete(input.sessionId)
      streamForwarder.clear(input.sessionId)
    }
  }
}

/**
 * 无渲染进程的 Agent 运行（供飞书 Bridge 等外部调用方使用）
 *
 * 如果桌面窗口存在，同时注册 webContents 以便事件同步到桌面端 UI。
 * 事件同时通过 EventBus listeners 分发给飞书 Bridge。
 */
export interface RunAgentHeadlessCompleteOptions {
  stoppedByUser?: boolean
  startedAt?: number
  resultSubtype?: string
  resultErrors?: string[]
  backgroundTasksPending?: boolean
}

export async function runAgentHeadless(
  input: AgentSendInput,
  callbacks: {
    onError: (error: string) => void
    onComplete: (messages?: AgentMessage[], options?: RunAgentHeadlessCompleteOptions) => void
    onTitleUpdated: (title: string) => void
    source?: AgentExternalRunSource
    originSessionId?: string
  },
  extensions?: { piCustomTools?: import('@earendil-works/pi-coding-agent').ToolDefinition[] },
): Promise<void> {
  // 委派子会话优先回到父会话所在 renderer，外部无界面运行才回退任意主窗口。
  const wc = getHeadlessAgentRunTarget(
    sessionWebContents,
    callbacks.originSessionId,
    getMainRendererWebContents,
  )
  const runInput: AgentSendInput = input.startedAt != null ? input : { ...input, startedAt: Date.now() }
  const startedAt = runInput.startedAt!
  if (wc) {
    registerWebContents(runInput.sessionId, wc)
  }

  // 记录本轮完成方式，供 try 块尾部（onComplete 未触发的异常路径）复用
  let completedBackgroundTasksPending = false
  let completedStoppedByUser = false

  try {
    await orchestrator.sendMessage(runInput, {
      onError: (error) => {
        callbacks.onError(error)
        // 同步到渲染进程
        if (wc && !wc.isDestroyed()) {
          wc.send(AGENT_IPC_CHANNELS.STREAM_ERROR, {
            sessionId: runInput.sessionId,
            error,
          })
        }
      },
      onComplete: (messages, opts) => {
        // 不再经回调传输完整 messages（上游 #1627 性能优化）；
        // conductor 等调用方通过磁盘读取兜底，options 仍完整传递。
        callbacks.onComplete(undefined, opts)
        completedBackgroundTasksPending = opts?.backgroundTasksPending === true
        completedStoppedByUser = opts?.stoppedByUser === true
        agentQueueCoordinator.onRunComplete(
          runInput.sessionId,
          undefined,
          completedBackgroundTasksPending,
          completedStoppedByUser,
        )
        publishRunStopped(runInput.sessionId, opts?.stoppedByUser, opts?.startedAt)
        // 同步到渲染进程
        if (wc && !wc.isDestroyed()) {
          sendAgentStreamComplete(wc, runInput, {
            ...getCompletionSessionOrigin(runInput.sessionId),
            stoppedByUser: opts?.stoppedByUser ?? false,
            startedAt: opts?.startedAt,
            resultSubtype: opts?.resultSubtype,
            resultErrors: opts?.resultErrors,
            backgroundTasksPending: opts?.backgroundTasksPending,
            // 只读取刚完成的轻量 meta，renderer 可据此增量更新列表，避免再取 5,000+ 条全量会话。
            session: getSessionMetaForRenderer(runInput.sessionId),
          })
        }
      },
      onTitleUpdated: (title) => {
        callbacks.onTitleUpdated(title)
        eventBus.emit(runInput.sessionId, {
          kind: 'myyoda_event',
          event: { type: 'title_updated', title },
        })
        // 同步到渲染进程
        if (wc && !wc.isDestroyed()) {
          wc.send(AGENT_IPC_CHANNELS.TITLE_UPDATED, {
            sessionId: runInput.sessionId,
            title,
          })
        }
      },
      onRunStarted: ({ startedAt: persistedStartedAt }) => {
        const session = getAgentSessionMeta(runInput.sessionId)
        eventBus.emit(runInput.sessionId, {
          kind: 'myyoda_event',
          event: {
            type: 'external_run_started',
            source: callbacks.source ?? 'bridge',
            sessionId: runInput.sessionId,
            title: session?.title,
            workspaceId: session?.workspaceId ?? runInput.workspaceId,
            modelId: runInput.modelId,
            startedAt: persistedStartedAt,
            ...(session ? { session } : {}),
          },
        })
      },
    })
    agentQueueCoordinator.onRunComplete(runInput.sessionId, undefined, completedBackgroundTasksPending, completedStoppedByUser)
  } catch (err) {
    console.error('[Agent 服务] runAgentHeadless 未处理异常:', err)
    const errorMessage = err instanceof Error ? err.message : '未知错误'
    callbacks.onError(errorMessage)
    callbacks.onComplete()
    if (wc && !wc.isDestroyed()) {
      wc.send(AGENT_IPC_CHANNELS.STREAM_ERROR, { sessionId: runInput.sessionId, error: errorMessage })
      sendAgentStreamComplete(wc, runInput, {
        messages: [],
        ...getCompletionSessionOrigin(runInput.sessionId),
        stoppedByUser: false,
        startedAt,
      })
    }
  } finally {
    if (!orchestrator.isActive(runInput.sessionId)) {
      sessionWebContents.delete(runInput.sessionId)
      streamForwarder.clear(runInput.sessionId)
    }
  }
}

/**
 * 生成 Agent 会话标题
 */
export async function generateAgentTitle(input: AgentGenerateTitleInput): Promise<string | null> {
  return orchestrator.generateTitle(input)
}

/**
 * 中止指定会话的 Agent 执行
 */
export function stopAgent(sessionId: string): void {
  orchestrator.stop(sessionId, agentQueueCoordinator.isDispatching(sessionId))
}

setHeadlessAgentRunner(runAgentHeadless)
setAgentStopper(stopAgent)

/**
 * 快照回退：回退到指定消息点，恢复文件 + 截断对话
 */
export async function rewindAgentSession(
  sessionId: string,
  assistantMessageUuid: string,
): Promise<import('@myyoda/shared').RewindSessionResult> {
  return orchestrator.rewindSession(sessionId, assistantMessageUuid)
}

/**
 * 检查指定会话是否正在运行
 */
export function isAgentSessionActive(sessionId: string): boolean {
  return orchestrator.isActive(sessionId)
}

/** 是否存在任意运行中 Agent，供更新器等全局生命周期服务安全判断。 */
export function hasActiveAgentSessions(): boolean {
  return orchestrator.hasActiveSessions()
}

/** 中止所有活跃的 Agent 会话（应用退出时调用） */
export function stopAllAgents(): void {
  orchestrator.stopAll()
}

/**
 * 退出前清理 Pi runtime 资源。
 *
 * 必须在 stopAllAgents() 之后调用。同步执行，确保 before-quit 能在 Electron 超时前完成。
 */
export function killOrphanedClaudeSubprocesses(): void {
  // Claude runtime 已于 2026-08 退役，此函数仅保留兼容 app lifecycle 调用。
  cleanupPiRuntimeResources()
}

/**
 * 运行中动态切换会话的权限模式
 *
 * 同时更新 MyYoda 侧（canUseTool 动态读取）和 SDK 侧（query.setPermissionMode）。
 */
export async function updateAgentPermissionMode(sessionId: string, mode: MyYodaPermissionMode): Promise<void> {
  await orchestrator.updateSessionPermissionMode(sessionId, mode)
}

// ===== 流式追加消息 =====

/**
 * 在 Agent 流式中追加发送消息
 *
 * 使用 'now' 优先级立即注入 SDK 并持久化。
 */
export async function queueAgentMessage(
  input: AgentQueueMessageInput,
  _webContents: WebContents,
): Promise<string> {
  return orchestrator.queueMessage(
    input.sessionId,
    input.userMessage,
    input.rawUserMessage,
    undefined,
    input.uuid,
    { interrupt: input.interrupt },
    input.mentionedSkills,
    input.mentionedMcpServers,
    input.mentionedSessionIds,
    input.mentionedTodoIds,
    input.mentionedCalendarEventIds,
  )
}

// ===== Deferred queue 操作（排队消息主进程调度） =====

/** 将等待当前 run 结束的消息交给主进程调度器。 */
export function enqueueAgentQueuedMessage(input: AgentDeferredQueueMessageInput, webContents: WebContents): void {
  registerWebContents(input.sessionId, webContents)
  agentQueueCoordinator.enqueue(input)
}

export function cancelAgentQueuedMessage(input: AgentQueuedMessageControlInput): boolean {
  return agentQueueCoordinator.cancel(input)
}

export function moveAgentQueuedMessage(input: AgentMoveQueuedMessageInput): boolean {
  return agentQueueCoordinator.move(input)
}

export function clearAgentQueuedMessages(sessionId: string): void {
  agentQueueCoordinator.clear(sessionId)
}

/** 返回指定会话 deferred queue 的展示投影（renderer 重载后重建队列 UI）。 */
export function getAgentQueuedMessageSnapshots(sessionId: string): AgentQueuedMessageSnapshot[] {
  return agentQueueCoordinator.listSnapshots(sessionId)
}

/** 渠道配置变化后重新评估各会话队列（ipc.ts 渠道 handler 调用）。 */
export function pokeAgentQueuedMessages(): void {
  agentQueueCoordinator.pokeAll()
}

// ===== 文件操作 =====

/**
 * 保存文件到 Agent session 工作目录
 *
 * 将 base64 编码的文件写入 session 的 cwd，供 Agent 通过 Read 工具读取。
 */
export function saveFilesToAgentSession(input: AgentSaveFilesInput): AgentSavedFile[] {
  const { workspace, session } = assertRegisteredSessionUpload(
    input.workspaceSlug,
    input.sessionId,
    listAgentWorkspaces().map(({ id, slug }) => ({ id, slug })),
    listAgentSessions().map(({ id, workspaceId }) => ({ id, workspaceId })),
  )
  const sessionDir = getAgentSessionWorkspacePath(workspace.slug, session.id)
  const results: AgentSavedFile[] = []
  const usedPaths = new Set<string>()

  for (const file of input.files) {
    let targetPath = resolveSafeChildPath(sessionDir, file.filename)

    // 防止同名文件覆盖
    if (usedPaths.has(targetPath) || existsSync(targetPath)) {
      const dotIdx = file.filename.lastIndexOf('.')
      const baseName = dotIdx > 0 ? file.filename.slice(0, dotIdx) : file.filename
      const ext = dotIdx > 0 ? file.filename.slice(dotIdx) : ''
      let counter = 1
      let candidate = resolveSafeChildPath(sessionDir, `${baseName}-${counter}${ext}`)
      while (usedPaths.has(candidate) || existsSync(candidate)) {
        counter++
        candidate = resolveSafeChildPath(sessionDir, `${baseName}-${counter}${ext}`)
      }
      targetPath = candidate
    }
    usedPaths.add(targetPath)

    mkdirSync(dirname(targetPath), { recursive: true })

    const buffer = Buffer.from(file.data, 'base64')
    writeFileSync(targetPath, buffer)

    const actualFilename = relative(sessionDir, targetPath)
    results.push({ filename: actualFilename, targetPath })
    console.log(`[Agent 服务] 文件已保存: ${targetPath} (${buffer.length} bytes)`)
  }

  return results
}

/**
 * 保存文件到工作区文件目录
 *
 * 将 base64 编码的文件写入工作区 workspace-files/ 目录，所有会话均可访问。
 */
export function saveFilesToWorkspaceFiles(input: AgentSaveWorkspaceFilesInput): AgentSavedFile[] {
  const workspace = resolveRegisteredUploadWorkspace(
    input.workspaceSlug,
    listAgentWorkspaces().map(({ id, slug }) => ({ id, slug })),
  )
  if (!workspace) throw new Error('Workspace slug 未注册')
  const wsFilesDir = getWorkspaceFilesDir(workspace.slug)
  const results: AgentSavedFile[] = []
  const usedPaths = new Set<string>()

  for (const file of input.files) {
    let targetPath = resolveSafeChildPath(wsFilesDir, file.filename)

    // 防止同名文件覆盖
    if (usedPaths.has(targetPath) || existsSync(targetPath)) {
      const dotIdx = file.filename.lastIndexOf('.')
      const baseName = dotIdx > 0 ? file.filename.slice(0, dotIdx) : file.filename
      const ext = dotIdx > 0 ? file.filename.slice(dotIdx) : ''
      let counter = 1
      let candidate = resolveSafeChildPath(wsFilesDir, `${baseName}-${counter}${ext}`)
      while (usedPaths.has(candidate) || existsSync(candidate)) {
        counter++
        candidate = resolveSafeChildPath(wsFilesDir, `${baseName}-${counter}${ext}`)
      }
      targetPath = candidate
    }
    usedPaths.add(targetPath)

    mkdirSync(dirname(targetPath), { recursive: true })

    if (file.data.length * 0.75 > MAX_ATTACHMENT_SIZE) {
      console.warn(`[Agent 服务] 工作区文件超过 100MB 限制，跳过: ${file.filename} (预估 ${(file.data.length * 0.75 / 1024 / 1024).toFixed(1)}MB)`)
      continue
    }

    const buffer = Buffer.from(file.data, 'base64')
    writeFileSync(targetPath, buffer)

    const actualFilename = relative(wsFilesDir, targetPath)
    results.push({ filename: actualFilename, targetPath })
    console.log(`[Agent 服务] 工作区文件已保存: ${targetPath} (${buffer.length} bytes)`)
  }

  return results
}
