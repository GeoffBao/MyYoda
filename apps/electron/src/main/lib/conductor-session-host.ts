import type {
  AgentMessage,
  AgentSessionMeta,
  AgentSendInput,
  AgentWorkspace,
  MyYodaPermissionMode,
} from '@myyoda/shared'
import type {
  ConductorSessionHost,
  ConductorSendMessageOptions,
  CreateSessionOptions,
  SessionCompletionEvent,
} from './task-runner'
import type { AgentSessionMetaUpdates } from './agent-session-manager'

export interface ConductorSessionCallbacks {
  onError: (error: string) => void
  onComplete: (options?: {
    stoppedByUser?: boolean
    startedAt?: number
    resultSubtype?: string
    resultErrors?: string[]
    backgroundTasksPending?: boolean
  }) => void
  onTitleUpdated: (title: string) => void
  onRunStarted?: (options: { startedAt: number }) => void
}

export interface ConductorOrchestrator {
  sendMessage(input: AgentSendInput, callbacks: ConductorSessionCallbacks): Promise<void>
  stop(sessionId: string): void
}

/** Work/Kanban 任务触发的 Agent 运行：必须走 headless+WC 注册，否则 Code 对话看不到执行过程。 */
export type ConductorAgentRunner = (
  input: AgentSendInput,
  callbacks: ConductorSessionCallbacks & { source?: 'work' },
) => Promise<void>

export interface ConductorSessionHostDependencies {
  createAgentSession: (
    title?: string,
    channelId?: string,
    workspaceId?: string,
    modelId?: string,
  ) => AgentSessionMeta
  getAgentSessionMeta: (sessionId: string) => AgentSessionMeta | undefined
  listAgentSessions?: () => AgentSessionMeta[]
  updateAgentSessionMeta: (sessionId: string, updates: AgentSessionMetaUpdates) => AgentSessionMeta
  getAgentSessionMessages: (sessionId: string) => AgentMessage[]
  getAgentWorkspace: (workspaceId: string) => AgentWorkspace | undefined
  getAgentSessionWorkspacePath: (workspaceSlug: string, sessionId: string) => string
  getDefaultAgentChannelId?: () => string | undefined
  getOrchestrator: () => ConductorOrchestrator
  /** 优先使用：注册主窗口 webContents，把 STREAM_EVENT 推到 Code 对话 */
  runAgent?: ConductorAgentRunner
}

type ConductorSessionMeta = AgentSessionMeta
type ConductorSessionMetaUpdates = AgentSessionMetaUpdates

interface CompletionState {
  dispatched: boolean
  sawError: boolean
}

export class MyYodaConductorSessionHost implements ConductorSessionHost {
  private readonly listeners = new Set<(event: SessionCompletionEvent) => void>()
  private readonly completionStates = new Map<string, CompletionState>()

  constructor(private readonly deps: ConductorSessionHostDependencies) {}

  async createSession(workspaceId: string, options: CreateSessionOptions): Promise<{ id: string }> {
    const permissionMode = mapPermissionMode(options.permissionMode)
    const channelId = options.llmConnection
      ?? (options.parentSessionId
        ? this.deps.getAgentSessionMeta(options.parentSessionId)?.channelId
        : undefined)
      ?? this.deps.getDefaultAgentChannelId?.()
    const session = this.deps.createAgentSession(
      options.name,
      channelId,
      workspaceId,
      options.model,
    )

    const updates: ConductorSessionMetaUpdates = {}
    if (permissionMode !== undefined) updates.permissionMode = permissionMode
    if (options.workingDirectory !== undefined) updates.workingDirectory = options.workingDirectory
    if (options.sessionStatus !== undefined) updates.sessionStatus = options.sessionStatus
    if (options.parentSessionId !== undefined) updates.parentSessionId = options.parentSessionId
    if (options.projectId !== undefined) updates.projectId = options.projectId
    if (options.taskSlug !== undefined) updates.taskSlug = options.taskSlug
    if (options.taskRunId !== undefined) updates.taskRunId = options.taskRunId
    if (options.taskNodeId !== undefined) updates.taskNodeId = options.taskNodeId
    if (options.taskAttempt !== undefined) updates.taskAttempt = options.taskAttempt
    if (options.taskCorrelationKey !== undefined) updates.taskCorrelationKey = options.taskCorrelationKey
    if (options.taskDraft !== undefined) updates.taskDraft = options.taskDraft
    if (Object.keys(updates).length > 0) {
      this.deps.updateAgentSessionMeta(session.id, updates)
    }

    return { id: session.id }
  }

  async sendMessage(
    sessionId: string,
    message: string,
    options?: ConductorSendMessageOptions,
  ): Promise<void> {
    const meta = asConductorSessionMeta(this.deps.getAgentSessionMeta(sessionId))
    if (!meta) throw new Error(`Agent 会话不存在: ${sessionId}`)
    if (!meta.channelId) throw new Error(`Agent 会话缺少 channelId: ${sessionId}`)

    const state: CompletionState = { dispatched: false, sawError: false }
    this.completionStates.set(sessionId, state)
    const dispatch = (
      reason: SessionCompletionEvent['reason'],
      messages?: AgentMessage[],
      tokenUsage?: SessionCompletionEvent['tokenUsage'],
    ): void => {
      if (state.dispatched) return
      state.dispatched = true
      const persistedMessages = this.deps.getAgentSessionMessages(sessionId)
      const finalText = getFinalText(messages ?? [])
        ?? getFinalText(persistedMessages)
      const resolvedTokenUsage = tokenUsage
        ?? getTokenUsage(messages ?? [])
        ?? getTokenUsage(persistedMessages)
      this.dispatchCompletion({
        sessionId,
        workspaceId: meta.workspaceId ?? '',
        reason,
        ...(finalText !== undefined ? { finalText } : {}),
        ...(resolvedTokenUsage !== undefined ? { tokenUsage: resolvedTokenUsage } : {}),
      })
    }

    try {
      const workingDirectory = meta.workingDirectory
      const input: AgentSendInput = {
        sessionId,
        userMessage: message,
        channelId: meta.channelId,
        ...(meta.modelId !== undefined ? { modelId: meta.modelId } : {}),
        ...(meta.workspaceId !== undefined ? { workspaceId: meta.workspaceId } : {}),
        ...(workingDirectory !== undefined ? { additionalDirectories: [workingDirectory] } : {}),
        triggeredBy: 'work',
        ...(meta.permissionMode !== undefined ? { permissionModeOverride: meta.permissionMode } : {}),
        ...(options?.mentionedSkills?.length ? { mentionedSkills: options.mentionedSkills } : {}),
        ...(options?.mentionedMcpServers?.length
          ? { mentionedMcpServers: options.mentionedMcpServers }
          : {}),
        ...(options?.toolPolicy ? { toolPolicy: options.toolPolicy } : {}),
      }
      const sessionCallbacks: ConductorSessionCallbacks = {
        onError: () => {
          state.sawError = true
        },
        onComplete: (options) => {
          if (options?.backgroundTasksPending) return
          const reason = state.sawError || isErrorCompletion(options)
            ? 'error'
            : options?.stoppedByUser
              ? 'interrupted'
              : 'complete'
          // upstream #1627 起 complete 不再经回调传输完整 messages；dispatch 内部从磁盘读取
          dispatch(reason)
        },
        onTitleUpdated: () => { /* Conductor 不消费标题事件 */ },
      }
      // 必须走 runAgent（headless+WC），不能直接 orchestrator.sendMessage：
      // 否则 sessionWebContents 未注册，Code 对话收不到 STREAM_EVENT，执行过程空白。
      if (this.deps.runAgent) {
        await this.deps.runAgent(input, { ...sessionCallbacks, source: 'work' })
      } else {
        await this.deps.getOrchestrator().sendMessage(input, sessionCallbacks)
      }
    } catch (error) {
      dispatch('error')
      throw error
    } finally {
      if (!state.dispatched && state.sawError) dispatch('error')
      this.completionStates.delete(sessionId)
    }
  }

  async setSessionStatus(sessionId: string, status: string): Promise<void> {
    this.deps.updateAgentSessionMeta(sessionId, { sessionStatus: status })
  }

  async setKanbanColumn(sessionId: string, column: string | null): Promise<void> {
    this.deps.updateAgentSessionMeta(sessionId, { kanbanColumn: column ?? undefined })
  }

  async setTaskNodeCount(sessionId: string, count: number): Promise<void> {
    this.deps.updateAgentSessionMeta(sessionId, { taskNodeCount: count })
  }

  async setSessionProjectId(sessionId: string, projectId: string): Promise<void> {
    this.deps.updateAgentSessionMeta(sessionId, { projectId })
  }

  async cancelProcessing(sessionId: string, _silent?: boolean): Promise<void> {
    this.deps.getOrchestrator().stop(sessionId)
  }

  onSessionComplete(listener: (event: SessionCompletionEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSessionFinalText(sessionId: string): string | undefined {
    return getFinalText(this.deps.getAgentSessionMessages(sessionId))
  }

  getSessionWorkingDirectory(sessionId: string): string | undefined {
    const meta = asConductorSessionMeta(this.deps.getAgentSessionMeta(sessionId))
    if (meta?.workingDirectory !== undefined) return meta.workingDirectory
    if (!meta?.workspaceId) return undefined
    const workspace = this.deps.getAgentWorkspace(meta.workspaceId)
    return workspace
      ? this.deps.getAgentSessionWorkspacePath(workspace.slug, sessionId)
      : undefined
  }

  findSessionByTaskCorrelationKey(workspaceId: string, correlationKey: string): { id: string } | undefined {
    return this.deps.listAgentSessions?.().find((session) => (
      session.workspaceId === workspaceId && session.taskCorrelationKey === correlationKey
    ))
  }

  private dispatchCompletion(event: SessionCompletionEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event)
      } catch (error) {
        console.error('[Conductor] 完成监听器执行失败:', error)
      }
    }
  }
}

/** 在 Electron 主进程中延迟加载真实服务，避免纯逻辑测试触发 Electron 模块。 */
export async function createMyYodaConductorSessionHost(): Promise<MyYodaConductorSessionHost> {
  const [sessionManager, agentService, workspaceManager, configPaths, settingsService] = await Promise.all([
    import('./agent-session-manager'),
    import('./agent-service'),
    import('./agent-workspace-manager'),
    import('./config-paths'),
    import('./settings-service'),
  ])
  return new MyYodaConductorSessionHost({
    createAgentSession: (title, channelId, workspaceId, modelId) => {
      // Pi-only：不传 agentCwdMode，createAgentSession 默认按 project 语义。
      return sessionManager.createAgentSession(title, channelId, workspaceId, modelId)
    },
    getAgentSessionMeta: sessionManager.getAgentSessionMeta,
    listAgentSessions: sessionManager.listAgentSessions,
    updateAgentSessionMeta: sessionManager.updateAgentSessionMeta,
    getAgentSessionMessages: sessionManager.getAgentSessionMessages,
    getAgentWorkspace: workspaceManager.getAgentWorkspace,
    getAgentSessionWorkspacePath: configPaths.getAgentSessionWorkspacePath,
    getDefaultAgentChannelId: () => settingsService.getSettings().agentChannelId,
    getOrchestrator: agentService.getOrchestrator,
    runAgent: (input, callbacks) => agentService.runAgentHeadless(input, {
      onError: callbacks.onError,
      onComplete: (_messages, options) => callbacks.onComplete(options),
      onTitleUpdated: callbacks.onTitleUpdated,
      source: callbacks.source ?? 'work',
    }),
  })
}

export const createConductorSessionHost = createMyYodaConductorSessionHost

function mapPermissionMode(mode: string | undefined): MyYodaPermissionMode | undefined {
  if (mode === undefined) return undefined

  switch (mode) {
    case 'allow-all':
    case 'bypassPermissions':
      return 'bypassPermissions'
    case 'auto':
      // 历史 SDK auto 审批 ≈ 完全自动
      return 'bypassPermissions'
    case 'safe':
    case 'ask':
      // 历史「需确认」不得静默升权为 bypass；收敛到计划模式
      return 'plan'
    case 'plan':
      return 'plan'
    default:
      throw new Error(`不支持的权限模式: ${mode}`)
  }
}

function isErrorCompletion(options: { resultSubtype?: string; resultErrors?: string[] } | undefined): boolean {
  return Boolean(
    options?.resultErrors?.length
      || options?.resultSubtype?.startsWith('error'),
  )
}

function getFinalText(messages: AgentMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const text = getAssistantText(messages[index])
    if (text?.trim()) return text
  }
  return undefined
}

function getAssistantText(message: AgentMessage | undefined): string | undefined {
  if (!message) return undefined
  const raw = message as unknown as Record<string, unknown>
  if (raw.role === 'assistant' && typeof raw.content === 'string') return raw.content
  const nested = asRecord(raw.message)
  const blocks = nested?.content
  if (!Array.isArray(blocks)) return undefined
  const text = blocks
    .map((block) => {
      const record = asRecord(block)
      return record?.type === 'text' && typeof record.text === 'string' ? record.text : ''
    })
    .filter(Boolean)
    .join('\n')
  return text || undefined
}

function getTokenUsage(messages: AgentMessage[]): SessionCompletionEvent['tokenUsage'] | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const raw = asRecord(messages[index])
    const directUsage = toTokenUsage(raw?.usage)
    if (directUsage) return directUsage

    const nestedUsage = toTokenUsage(asRecord(raw?.message)?.usage)
    if (nestedUsage) return nestedUsage
  }
  return undefined
}

function toTokenUsage(value: unknown): SessionCompletionEvent['tokenUsage'] | undefined {
  const record = asRecord(value)
  if (!record) return undefined

  const inputTokens = getFiniteNumber(record.inputTokens) ?? getFiniteNumber(record.input_tokens)
  const outputTokens = getFiniteNumber(record.outputTokens) ?? getFiniteNumber(record.output_tokens)
  if (inputTokens === undefined && outputTokens === undefined) return undefined

  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
  }
}

function getFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asConductorSessionMeta(meta: AgentSessionMeta | undefined): ConductorSessionMeta | undefined {
  return meta as ConductorSessionMeta | undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : undefined
}
