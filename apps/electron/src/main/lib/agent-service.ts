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
  MyYodaPermissionMode,
  AgentExternalRunSource,
  AgentMessage,
} from '@myyoda/shared'
import { PiAgentAdapter, cleanupPiRuntimeResources } from './adapters/pi-agent-adapter'
import { AgentEventBus } from './agent-event-bus'
import { AgentOrchestrator } from './agent-orchestrator'
import { getAgentSessionWorkspacePath, getWorkspaceFilesDir } from './config-paths'
import { getAgentSessionMeta, listAgentSessions, updateAgentSessionMeta } from './agent-session-manager'
import { setAgentStopper, setHeadlessAgentRunner } from './agent-headless-runner-registry'
import { getHeadlessAgentRunTarget } from './agent-headless-run-target'
import { assertRegisteredSessionUpload, resolveRegisteredUploadWorkspace } from './agent-upload-boundary-policy'
import { listAgentWorkspaces } from './agent-workspace-manager'
import { sendAgentStreamComplete } from './agent-completion-payload'
import { AgentStreamForwarder } from './agent-stream-forwarder'

// ===== 实例创建 =====

const eventBus = new AgentEventBus()
const adapter = new PiAgentAdapter()
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
      onComplete: (opts) => {
        publishRunStopped(input.sessionId, opts?.stoppedByUser, opts?.startedAt)
        if (!webContents.isDestroyed()) {
          sendAgentStreamComplete(webContents, input, {
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
      onRunStarted: ({ startedAt }) => {
        eventBus.emit(input.sessionId, {
          kind: 'myyoda_event',
          event: { type: 'run_started', startedAt },
        })
      },
    }, extensions)
  } catch (err) {
    console.error('[Agent 服务] runAgent 未处理异常:', err)
    const errorMessage = err instanceof Error ? err.message : '未知错误'
    if (!webContents.isDestroyed()) {
      webContents.send(AGENT_IPC_CHANNELS.STREAM_ERROR, {
        sessionId: input.sessionId,
        error: errorMessage,
      })
      sendAgentStreamComplete(webContents, input, {
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
      onComplete: (opts) => {
        // 不再经回调传输完整 messages（上游 #1627 性能优化）；
        // conductor 等调用方通过磁盘读取兜底，options 仍完整传递。
        callbacks.onComplete(undefined, opts)
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
            workspaceId: runInput.workspaceId ?? session?.workspaceId,
            modelId: runInput.modelId,
            channelId: runInput.channelId,
            startedAt: persistedStartedAt,
          },
        })
      },
    })
  } catch (err) {
    console.error('[Agent 服务] runAgentHeadless 未处理异常:', err)
    const errorMessage = err instanceof Error ? err.message : '未知错误'
    callbacks.onError(errorMessage)
    callbacks.onComplete()
    if (wc && !wc.isDestroyed()) {
      wc.send(AGENT_IPC_CHANNELS.STREAM_ERROR, { sessionId: runInput.sessionId, error: errorMessage })
      sendAgentStreamComplete(wc, runInput, {
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
  orchestrator.stop(sessionId)
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
