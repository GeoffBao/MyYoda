import { describe, expect, test } from 'bun:test'
import type {
  AgentMessage,
  AgentSessionMeta,
  AgentSendInput,
  AgentWorkspace,
} from '@myyoda/shared'
import {
  MyYodaConductorSessionHost,
  type ConductorSessionHostDependencies,
} from './conductor-session-host'
import type { SessionCompletionEvent } from './task-runner'

function createMeta(overrides: Partial<AgentSessionMeta> = {}): AgentSessionMeta {
  return {
    id: 'session-1',
    title: '原有标题',
    channelId: 'channel-1',
    workspaceId: 'workspace-1',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function createDependencies(): {
  deps: ConductorSessionHostDependencies
  sentInputs: AgentSendInput[]
  persistedMessages: AgentMessage[]
  callbacks: {
    onError: (error: string) => void
    onComplete: (options?: {
      stoppedByUser?: boolean
      resultSubtype?: string
      resultErrors?: string[]
      backgroundTasksPending?: boolean
    }) => void
  }
  updates: Array<Record<string, unknown>>
  stopped: string[]
  created: string[]
  createdChannelIds: Array<string | undefined>
} {
  const sentInputs: AgentSendInput[] = []
  const updates: Array<Record<string, unknown>> = []
  const stopped: string[] = []
  const created: string[] = []
  const createdChannelIds: Array<string | undefined> = []
  const persistedMessages: AgentMessage[] = []
  let callbacks: {
    onError: (error: string) => void
    onComplete: (options?: {
      stoppedByUser?: boolean
      resultSubtype?: string
      resultErrors?: string[]
      backgroundTasksPending?: boolean
    }) => void
    onTitleUpdated: (title: string) => void
  } | undefined
  const workspace: AgentWorkspace = {
    id: 'workspace-1',
    name: '测试工作区',
    slug: 'workspace-slug',
    createdAt: 1,
    updatedAt: 1,
  }
  const session = createMeta()

  const deps: ConductorSessionHostDependencies = {
    createAgentSession: (_title, channelId) => {
      created.push(session.id)
      createdChannelIds.push(channelId)
      if (channelId !== undefined) session.channelId = channelId
      return session
    },
    getAgentSessionMeta: () => session,
    updateAgentSessionMeta: (_id, patch) => {
      updates.push(patch)
      Object.assign(session, patch)
      return session
    },
    getAgentSessionMessages: () => persistedMessages,
    getAgentWorkspace: () => workspace,
    getAgentSessionWorkspacePath: (slug, sessionId) => `/workspaces/${slug}/${sessionId}`,
    getOrchestrator: () => ({
      sendMessage: async (input, nextCallbacks) => {
        sentInputs.push(input)
        callbacks = {
          onError: nextCallbacks.onError,
          onComplete: nextCallbacks.onComplete,
          onTitleUpdated: nextCallbacks.onTitleUpdated,
        }
      },
      stop: (sessionId) => {
        stopped.push(sessionId)
      },
    }),
  }

  return {
    deps,
    sentInputs,
    persistedMessages,
    get callbacks() {
      if (!callbacks) throw new Error('测试回调尚未注册')
      return callbacks
    },
    updates,
    stopped,
    created,
    createdChannelIds,
  }
}

describe('MyYodaConductorSessionHost', () => {
  test('创建 session 时映射 OSS 选项并持久化 Conductor 元数据', async () => {
    const testDeps = createDependencies()
    const { deps, updates } = testDeps
    const host = new MyYodaConductorSessionHost(deps)

    await expect(host.createSession('workspace-1', {
      name: '节点标题',
      llmConnection: 'channel-1',
      model: 'model-1',
      permissionMode: 'allow-all',
      sessionStatus: 'in-progress',
      parentSessionId: 'parent-1',
      projectId: 'project-1',
      taskSlug: 'demo',
      taskRunId: 'run-1',
      taskNodeId: 'node-1',
      taskAttempt: 2,
      taskCorrelationKey: 'task/run-1/node-1/2',
      taskDraft: true,
    })).resolves.toEqual({ id: 'session-1' })

    expect(testDeps.createdChannelIds).toEqual(['channel-1'])
    expect(updates).toEqual([{
      permissionMode: 'bypassPermissions',
      sessionStatus: 'in-progress',
      parentSessionId: 'parent-1',
      projectId: 'project-1',
      taskSlug: 'demo',
      taskRunId: 'run-1',
      taskNodeId: 'node-1',
      taskAttempt: 2,
      taskCorrelationKey: 'task/run-1/node-1/2',
      taskDraft: true,
    }])
  })

  test('按 Workspace + correlation key 查找已创建的节点 Session', () => {
    const testDeps = createDependencies()
    const deps = Object.assign(testDeps.deps, {
      listAgentSessions: () => [
        { id: 'other-workspace', title: 'other', workspaceId: 'workspace-2', taskCorrelationKey: 'task/run/node/1', createdAt: 1, updatedAt: 1 },
        { id: 'matched', title: 'matched', workspaceId: 'workspace-1', taskCorrelationKey: 'task/run/node/1', createdAt: 1, updatedAt: 1 },
      ],
    })
    const host = new MyYodaConductorSessionHost(deps)

    expect(host.findSessionByTaskCorrelationKey('workspace-1', 'task/run/node/1')).toEqual(
      expect.objectContaining({ id: 'matched' }),
    )
  })

  test('历史 safe/ask 权限映射到 plan，不得升权为 bypass', async () => {
    const askDeps = createDependencies()
    const askHost = new MyYodaConductorSessionHost(askDeps.deps)
    await askHost.createSession('workspace-1', { permissionMode: 'ask' })
    expect(askDeps.updates[0]).toMatchObject({ permissionMode: 'plan' })

    const safeDeps = createDependencies()
    const safeHost = new MyYodaConductorSessionHost(safeDeps.deps)
    await safeHost.createSession('workspace-1', { permissionMode: 'safe' })
    expect(safeDeps.updates[0]).toMatchObject({ permissionMode: 'plan' })
  })

  test('未知权限模式显式失败且不创建 session', async () => {
    const { deps, created } = createDependencies()
    const host = new MyYodaConductorSessionHost(deps)

    await expect(host.createSession('workspace-1', {
      permissionMode: 'unsupported-mode',
    })).rejects.toThrow('不支持的权限模式: unsupported-mode')
    expect(created).toEqual([])
  })

  test('未指定显式渠道时，生成 session 使用配置的默认 Agent 渠道', async () => {
    const testDeps = createDependencies()
    const deps = Object.assign(testDeps.deps, {
      getDefaultAgentChannelId: () => 'configured-default-channel',
    })
    const host = new MyYodaConductorSessionHost(deps)

    await host.createSession('workspace-1', { name: '生成 task' })
    await host.sendMessage('session-1', '生成 task 内容')

    expect(testDeps.createdChannelIds).toEqual(['configured-default-channel'])
    expect(testDeps.sentInputs[0]?.channelId).toBe('configured-default-channel')
  })

  test('子 session 未指定渠道时优先继承父 session 元数据中的渠道', async () => {
    const testDeps = createDependencies()
    const deps = Object.assign(testDeps.deps, {
      getDefaultAgentChannelId: () => 'configured-default-channel',
    })
    const host = new MyYodaConductorSessionHost(deps)

    await host.createSession('workspace-1', { parentSessionId: 'session-1' })

    expect(testDeps.createdChannelIds).toEqual(['channel-1'])
  })

  test('发送消息时映射 AgentSendInput，并将错误与完成回调合并为一次完成事件', async () => {
    const testDeps = createDependencies()
    const { deps, sentInputs } = testDeps
    const host = new MyYodaConductorSessionHost(deps)
    const events: Array<{ reason: string; finalText?: string }> = []
    host.onSessionComplete((event) => {
      events.push({ reason: event.reason, finalText: event.finalText })
    })

    const sending = host.sendMessage('session-1', '执行节点')
    await sending
    expect(sentInputs).toEqual([expect.objectContaining({
      sessionId: 'session-1',
      userMessage: '执行节点',
    })])

    testDeps.callbacks.onError('执行失败')
    testDeps.persistedMessages.push({ id: 'assistant-1', role: 'assistant', content: '最终结果', createdAt: 2 })
    testDeps.callbacks.onComplete()
    testDeps.callbacks.onComplete()

    expect(events).toEqual([{ reason: 'error', finalText: '最终结果' }])
  })

  test('生成草稿消息透传 toolPolicy=none，确保上层可禁用所有工具', async () => {
    const testDeps = createDependencies()
    const { deps, sentInputs } = testDeps
    const host = new MyYodaConductorSessionHost(deps)

    await host.sendMessage('session-1', '生成 task.yaml', { toolPolicy: 'none' })

    expect(sentInputs[0]).toEqual(expect.objectContaining({
      sessionId: 'session-1',
      userMessage: '生成 task.yaml',
      toolPolicy: 'none',
    }))
  })

  test('优先走 runAgent（headless+WC），确保 Code 对话能收到流式事件', async () => {
    const testDeps = createDependencies()
    const runAgentInputs: AgentSendInput[] = []
    let runAgentSource: string | undefined
    const deps: ConductorSessionHostDependencies = {
      ...testDeps.deps,
      runAgent: async (input, callbacks) => {
        runAgentInputs.push(input)
        runAgentSource = callbacks.source
        // upstream #1627 起 onComplete 不再携带 messages，终态文本从磁盘回读
        testDeps.persistedMessages.push({ id: 'assistant-1', role: 'assistant', content: '子任务完成', createdAt: 2 })
        callbacks.onComplete()
      },
    }
    const host = new MyYodaConductorSessionHost(deps)
    const events: SessionCompletionEvent[] = []
    host.onSessionComplete((event) => events.push(event))

    await host.sendMessage('session-1', '执行节点')

    expect(runAgentInputs).toEqual([expect.objectContaining({
      sessionId: 'session-1',
      userMessage: '执行节点',
      triggeredBy: 'work',
    })])
    expect(runAgentSource).toBe('work')
    expect(testDeps.sentInputs).toEqual([])
    expect(events).toEqual([expect.objectContaining({
      sessionId: 'session-1',
      reason: 'complete',
      finalText: '子任务完成',
    })])
  })

  test('后台任务未完成时不派发终态，最终完成时映射 token usage', async () => {
    const testDeps = createDependencies()
    const host = new MyYodaConductorSessionHost(testDeps.deps)
    const events: SessionCompletionEvent[] = []
    host.onSessionComplete((event) => events.push(event))

    await host.sendMessage('session-1', '执行后台节点')
    const sdkResult = {
      type: 'result',
      subtype: 'success',
      usage: { input_tokens: 12, output_tokens: 7 },
    } as unknown as AgentMessage

    testDeps.callbacks.onComplete({ backgroundTasksPending: true })
    expect(events).toEqual([])

    testDeps.persistedMessages.push(sdkResult)
    testDeps.callbacks.onComplete()
    expect(events).toEqual([{
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      reason: 'complete',
      tokenUsage: { inputTokens: 12, outputTokens: 7 },
    }])
  })

  test('创建时保存工作目录，并在后续 AgentSendInput 中传递该目录', async () => {
    const testDeps = createDependencies()
    const host = new MyYodaConductorSessionHost(testDeps.deps)

    await host.createSession('workspace-1', {
      workingDirectory: '/repo/project',
    })
    expect(testDeps.updates).toEqual([{ workingDirectory: '/repo/project' }])
    expect(host.getSessionWorkingDirectory('session-1')).toBe('/repo/project')

    await host.sendMessage('session-1', '继续执行')
    expect(testDeps.sentInputs[0]).toEqual(expect.objectContaining({
      additionalDirectories: ['/repo/project'],
    }))
  })

  test('metadata helpers 使用专用字段，工作目录来自 workspace 元数据，取消调用 stop', async () => {
    const { deps, updates, stopped } = createDependencies()
    const host = new MyYodaConductorSessionHost(deps)

    await host.setSessionStatus('session-1', 'done')
    await host.setKanbanColumn('session-1', 'done')
    await host.setKanbanColumn('session-1', null)
    await host.setTaskNodeCount('session-1', 3)
    await host.setSessionProjectId('session-1', 'project-2')
    await host.cancelProcessing('session-1', true)

    expect(updates).toEqual([
      { sessionStatus: 'done' },
      { kanbanColumn: 'done' },
      { kanbanColumn: undefined },
      { taskNodeCount: 3 },
      { projectId: 'project-2' },
    ])
    expect(host.getSessionWorkingDirectory('session-1')).toBe('/workspaces/workspace-slug/session-1')
    expect(stopped).toEqual(['session-1'])
  })

  test('完成回调没有消息时回读持久化消息作为最终文本', async () => {
    const testDeps = createDependencies()
    const host = new MyYodaConductorSessionHost(testDeps.deps)
    const events: SessionCompletionEvent[] = []
    host.onSessionComplete((event) => events.push(event))

    const persisted = testDeps.deps.getAgentSessionMessages('session-1')
    persisted.push({ id: 'assistant-1', role: 'assistant', content: '持久化结果', createdAt: 2 })
    await host.sendMessage('session-1', '执行节点')
    testDeps.callbacks.onComplete()

    expect(events).toHaveLength(1)
    expect(events[0]?.finalText).toBe('持久化结果')
  })
})
