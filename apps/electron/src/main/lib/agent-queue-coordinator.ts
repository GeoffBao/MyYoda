import type { WebContents } from 'electron'
import type {
  AgentDeferredQueueMessageInput,
  AgentMoveQueuedMessageInput,
  AgentQueuedMessageControlInput,
  AgentQueuedMessageSnapshot,
  AgentQueuedMessageStatus,
} from '@myyoda/shared'

interface QueueEntry {
  input: AgentDeferredQueueMessageInput
  displaySnapshot?: AgentQueuedMessageSnapshot
}

/** 派发中的条目：保留完整 input，失败时才能把消息放回队首。 */
interface DispatchingEntry {
  messageId: string
  input: AgentDeferredQueueMessageInput
}

export interface AgentQueueCoordinatorOptions {
  /** 会话是否正在运行（orchestrator.isActive）。 */
  isActive: (sessionId: string) => boolean
  /** 会话当前绑定的 webContents（无绑定则回退主窗口）。 */
  getWebContents: (sessionId: string) => WebContents | null
  /** 启动一轮 run（由 agent-service 注入 runAgent）。 */
  startRun: (input: AgentDeferredQueueMessageInput, webContents: WebContents) => Promise<void>
  /** 推送队列状态到渲染进程（started / failed）。 */
  sendStatus: (webContents: WebContents, status: AgentQueuedMessageStatus) => void
  /**
   * 调度前置检查（除 isActive 之外的安全条件）：
   * 阻塞中的权限/AskUser/ExitPlan 请求、用户手动停止、只读 legacy 会话、
   * 渠道/模型不可用等。全部通过才允许派发。
   */
  canDispatch: (sessionId: string, input: AgentDeferredQueueMessageInput) => boolean
}

/**
 * 主进程持有 deferred queue；renderer 只保留展示投影。
 *
 * 相比 upstream 简化版，额外保留 MyYoda 本地渲染进程调度器的安全检查与失败回滚：
 * - canDispatch：派发前逐个校验阻塞请求 / stoppedByUser / continuationRequired / 渠道可用性
 * - suppressed：派发失败的队首重新入队后抑制自动重试，直到用户调整队列（与本地行为一致）
 * - backgroundWaiting：run 完成但后台任务未结束期间不派发，task_notification 到达后再唤醒
 */
export class AgentQueueCoordinator {
  private readonly queues = new Map<string, QueueEntry[]>()
  private readonly dispatching = new Map<string, DispatchingEntry>()
  /** 派发失败被放回队首的消息：在用户调整队列前抑制自动重试，避免重试风暴。 */
  private readonly suppressed = new Map<string, string>()
  /** 后台任务等待中的会话（turn 主体结束但 task 还在飞），期间不派发新消息。 */
  private readonly backgroundWaiting = new Set<string>()
  /** 应用退出后禁止再 enqueue / tryDispatch，避免 in-flight startRun 拉起新进程。 */
  private shuttingDown = false

  constructor(private readonly options: AgentQueueCoordinatorOptions) {}

  enqueue(input: AgentDeferredQueueMessageInput): void {
    if (this.shuttingDown) return
    const queue = this.queues.get(input.sessionId) ?? []
    if (queue.some((entry) => entry.input.queueMessageId === input.queueMessageId)) return
    queue.push({ input, displaySnapshot: input.displaySnapshot })
    this.queues.set(input.sessionId, queue)
    this.tryDispatch(input.sessionId)
  }

  /** 返回指定会话当前队列的展示投影（不含已派发条目），供 renderer 重载后重建队列 UI。 */
  listSnapshots(sessionId: string): AgentQueuedMessageSnapshot[] {
    const queue = this.queues.get(sessionId)
    if (!queue) return []
    return queue
      .map((entry) => entry.displaySnapshot)
      .filter((snapshot): snapshot is AgentQueuedMessageSnapshot => snapshot !== undefined)
  }

  cancel(input: AgentQueuedMessageControlInput): boolean {
    const queue = this.queues.get(input.sessionId)
    if (!queue) return false
    const index = queue.findIndex((entry) => entry.input.queueMessageId === input.messageId)
    if (index < 0) return false
    queue.splice(index, 1)
    if (queue.length === 0) this.queues.delete(input.sessionId)
    this.reconcileSuppression(input.sessionId)
    return true
  }

  move(input: AgentMoveQueuedMessageInput): boolean {
    const queue = this.queues.get(input.sessionId)
    if (!queue || input.sourceId === input.targetId) return false
    const sourceIndex = queue.findIndex((entry) => entry.input.queueMessageId === input.sourceId)
    const targetIndex = queue.findIndex((entry) => entry.input.queueMessageId === input.targetId)
    if (sourceIndex < 0 || targetIndex < 0) return false
    const [source] = queue.splice(sourceIndex, 1)
    if (!source) return false
    const adjustedTarget = queue.findIndex((entry) => entry.input.queueMessageId === input.targetId)
    const insertIndex = input.placement === 'after' ? adjustedTarget + 1 : adjustedTarget
    queue.splice(insertIndex, 0, source)
    this.reconcileSuppression(input.sessionId)
    return true
  }

  onRunComplete(
    sessionId: string,
    queueMessageId: string | undefined,
    backgroundTasksPending: boolean,
    stoppedByUser: boolean,
  ): void {
    if (queueMessageId && this.dispatching.get(sessionId)?.messageId === queueMessageId) {
      this.dispatching.delete(sessionId)
    }
    if (backgroundTasksPending) {
      this.backgroundWaiting.add(sessionId)
      return
    }
    this.backgroundWaiting.delete(sessionId)
    if (stoppedByUser) return
    this.tryDispatch(sessionId)
  }

  /** run 初始化/执行异常：把已派发的消息放回队首并抑制自动重试。 */
  onRunFailed(sessionId: string, queueMessageId: string | undefined): void {
    if (!queueMessageId) return
    const dispatching = this.dispatching.get(sessionId)
    if (dispatching?.messageId !== queueMessageId) return
    this.dispatching.delete(sessionId)
    const queue = this.queues.get(sessionId) ?? []
    queue.unshift({ input: dispatching.input, displaySnapshot: dispatching.input.displaySnapshot })
    this.queues.set(sessionId, queue)
    this.suppressed.set(sessionId, queueMessageId)
    const webContents = this.options.getWebContents(sessionId)
    if (webContents && !webContents.isDestroyed()) {
      this.options.sendStatus(webContents, {
        sessionId,
        messageId: queueMessageId,
        status: 'failed',
        userMessage: dispatching.input.userMessage,
        rawUserMessage: dispatching.input.rawUserMessage,
        startedAt: dispatching.input.startedAt ?? Date.now(),
      })
    }
  }

  onBackgroundTaskComplete(sessionId: string): void {
    this.backgroundWaiting.delete(sessionId)
    this.tryDispatch(sessionId)
  }

  isDispatching(sessionId: string): boolean {
    return this.dispatching.has(sessionId)
  }

  hasPending(sessionId: string): boolean {
    return this.dispatching.has(sessionId) || (this.queues.get(sessionId)?.length ?? 0) > 0
  }

  clear(sessionId: string): void {
    this.queues.delete(sessionId)
    this.dispatching.delete(sessionId)
    this.suppressed.delete(sessionId)
    this.backgroundWaiting.delete(sessionId)
  }

  /** 应用退出时释放全部会话队列，避免遗留 dispatch Promise。 */
  clearAll(): void {
    this.shuttingDown = true
    this.queues.clear()
    this.dispatching.clear()
    this.suppressed.clear()
    this.backgroundWaiting.clear()
  }

  /** 外部状态变化（如渠道启用/禁用）后重新评估所有会话的队列。 */
  pokeAll(): void {
    if (this.shuttingDown) return
    for (const sessionId of [...this.queues.keys()]) {
      this.tryDispatch(sessionId)
    }
  }

  private reconcileSuppression(sessionId: string): void {
    const suppressedId = this.suppressed.get(sessionId)
    if (suppressedId === undefined) return
    const headId = this.queues.get(sessionId)?.[0]?.input.queueMessageId
    if (headId !== suppressedId) {
      this.suppressed.delete(sessionId)
      this.tryDispatch(sessionId)
    }
  }

  private tryDispatch(sessionId: string): void {
    if (this.shuttingDown) return
    if (this.dispatching.has(sessionId)) return
    const queue = this.queues.get(sessionId)
    const head = queue?.[0]
    if (!head) return
    // 失败的队首在用户调整队列前保持抑制，避免订阅回调触发自动重试风暴。
    if (this.suppressed.get(sessionId) === head.input.queueMessageId) return
    if (this.backgroundWaiting.has(sessionId)) return
    if (this.options.isActive(sessionId)) return
    if (!this.options.canDispatch(sessionId, head.input)) return

    const entry = queue!.shift()!
    if (queue!.length === 0) this.queues.delete(sessionId)

    const messageId = entry.input.queueMessageId
    this.dispatching.set(sessionId, { messageId, input: entry.input })
    const webContents = this.options.getWebContents(sessionId)
    if (!webContents || webContents.isDestroyed()) {
      queue!.unshift(entry)
      if (queue) this.queues.set(sessionId, queue!)
      this.dispatching.delete(sessionId)
      return
    }
    const startedAt = Date.now()
    this.options.sendStatus(webContents, {
      sessionId,
      messageId,
      status: 'started',
      userMessage: entry.input.userMessage,
      rawUserMessage: entry.input.rawUserMessage,
      startedAt,
    })
    void this.options.startRun({ ...entry.input, startedAt, userMessageUuid: messageId }, webContents)
      .finally(() => {
        if (this.dispatching.get(sessionId)?.messageId === messageId) {
          this.dispatching.delete(sessionId)
        }
      })
  }
}
