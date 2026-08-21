import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TaskSpec } from '@myyoda/shared/tasks/schema'
import type { ExpertPackage, TeamSquad } from '@myyoda/shared/experts'
import { buildTeamExecutionSpec } from './team-run'
import {
  appendRunLog,
  initializeRun,
  loadTaskRecord,
  readRunContextSnapshot,
  readRunLog,
  runDir,
  saveTaskRecord,
  saveTaskSpec,
  writeRunSpecSnapshot,
} from '@myyoda/shared/tasks/storage'
import {
  TaskRunner,
  type ConductorSendMessageOptions,
  type ConductorSessionHost,
  type CreateSessionOptions,
  type SessionCompletionEvent,
  type TaskRunnerDeps,
} from './task-runner'

const tempRoots: string[] = []

function createTempWorkspaceRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'myyoda-task-runner-'))
  tempRoots.push(root)
  return root
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function buildSpec(overrides: Partial<TaskSpec> = {}): TaskSpec {
  return {
    id: 'demo-task',
    title: 'Demo task',
    goal: 'Keep task runner scheduling deterministic',
    runner: 'conduct',
    nodes: [
      {
        id: 'draft',
        kind: 'session',
        prompt: 'draft the task',
      },
    ],
    ...overrides,
  }
}

class FakeConductorSessionHost implements ConductorSessionHost {
  readonly createdSessions: Array<{ id: string; workspaceId: string; options: CreateSessionOptions }> = []
  readonly sentMessages = new Map<string, string[]>()
  readonly sentOptions = new Map<string, Array<ConductorSendMessageOptions | undefined>>()
  readonly cancelledSessions: string[] = []
  readonly statusUpdates: Array<{ sessionId: string; status: string }> = []
  readonly kanbanUpdates: Array<{ sessionId: string; column: string | null }> = []
  readonly taskNodeCounts: Array<{ sessionId: string; count: number }> = []

  private readonly listeners = new Set<(evt: SessionCompletionEvent) => void>()
  private readonly finalTexts = new Map<string, string>()
  private readonly workingDirectories = new Map<string, string>()
  private nextSessionId = 1

  async createSession(workspaceId: string, options: CreateSessionOptions): Promise<{ id: string }> {
    const id = `session-${this.nextSessionId++}`
    this.createdSessions.push({ id, workspaceId, options })
    if (options.workingDirectory) {
      this.workingDirectories.set(id, options.workingDirectory)
    }
    return { id }
  }

  async sendMessage(
    sessionId: string,
    message: string,
    options?: ConductorSendMessageOptions,
  ): Promise<void> {
    const existing = this.sentMessages.get(sessionId) ?? []
    existing.push(message)
    this.sentMessages.set(sessionId, existing)
    const optionLog = this.sentOptions.get(sessionId) ?? []
    optionLog.push(options)
    this.sentOptions.set(sessionId, optionLog)
  }

  async setSessionStatus(sessionId: string, status: string): Promise<void> {
    this.statusUpdates.push({ sessionId, status })
  }

  async setKanbanColumn(sessionId: string, column: string | null): Promise<void> {
    this.kanbanUpdates.push({ sessionId, column })
  }

  async setTaskNodeCount(sessionId: string, count: number): Promise<void> {
    this.taskNodeCounts.push({ sessionId, count })
  }

  async cancelProcessing(sessionId: string): Promise<void> {
    this.cancelledSessions.push(sessionId)
  }

  onSessionComplete(listener: (evt: SessionCompletionEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSessionFinalText(sessionId: string): string | undefined {
    return this.finalTexts.get(sessionId)
  }

  getSessionWorkingDirectory(sessionId: string): string | undefined {
    return this.workingDirectories.get(sessionId)
  }

  findSessionByTaskCorrelationKey(workspaceId: string, correlationKey: string): { id: string } | undefined {
    return this.createdSessions.find((session) => (
      session.workspaceId === workspaceId && session.options.taskCorrelationKey === correlationKey
    ))
  }

  completeSession(
    sessionId: string,
    overrides: Partial<SessionCompletionEvent> & Pick<SessionCompletionEvent, 'workspaceId'>,
  ): void {
    if (overrides.finalText !== undefined) {
      this.finalTexts.set(sessionId, overrides.finalText)
    }
    const event: SessionCompletionEvent = {
      sessionId,
      workspaceId: overrides.workspaceId,
      reason: overrides.reason ?? 'complete',
      ...(overrides.finalMessageId ? { finalMessageId: overrides.finalMessageId } : {}),
      ...(overrides.finalText !== undefined ? { finalText: overrides.finalText } : {}),
      ...(overrides.tokenUsage ? { tokenUsage: overrides.tokenUsage } : {}),
    }
    for (const listener of [...this.listeners]) {
      listener(event)
    }
  }
}

function createRunner(
  workspaceRoot: string,
  host: FakeConductorSessionHost,
  runId = 'run-1',
  overrides: Partial<TaskRunnerDeps> = {},
): TaskRunner {
  return new TaskRunner({
    host,
    workspaceId: 'ws-1',
    workspaceRoot,
    defaultMaxParallel: 2,
    genRunId: () => runId,
    now: () => '2026-07-13T00:00:00.000Z',
    ...overrides,
  })
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('TaskRunner', () => {
  test('重复 runId 必须拒绝且不得覆盖 snapshot 或追加旧日志', () => {
    const workspaceRoot = createTempWorkspaceRoot()
    saveTaskSpec(workspaceRoot, buildSpec())
    const firstHost = new FakeConductorSessionHost()
    const secondHost = new FakeConductorSessionHost()

    createRunner(workspaceRoot, firstHost, 'run-fixed').run('demo-task', { verifyOnComplete: false })
    const originalLog = readRunLog(workspaceRoot, 'demo-task', 'run-fixed')

    expect(() => createRunner(workspaceRoot, secondHost, 'run-fixed').run('demo-task', { verifyOnComplete: false }))
      .toThrow(/runId|已存在|占用|活跃 Run/i)
    expect(readRunLog(workspaceRoot, 'demo-task', 'run-fixed')).toEqual(originalLog)
  })

  test('Run 使用稳定 taskId 并冻结 cwd 到 context、日志和所有 child Session', async () => {
    const workspaceRoot = createTempWorkspaceRoot()
    saveTaskSpec(workspaceRoot, buildSpec())
    saveTaskRecord(workspaceRoot, {
      schemaVersion: 1,
      taskId: '018f47a8-6c26-7a13-9bf6-7c8d4f2e4c72',
      slug: 'demo-task',
      revision: 1,
      workflow: 'todo',
      labelIds: [],
      createdAt: 1,
      updatedAt: 1,
    })
    const host = new FakeConductorSessionHost()
    const runner = createRunner(workspaceRoot, host, 'run-context', {
      resolveTaskWorkingDirectory: () => ({
        status: 'resolved',
        cwd: '/repo/frozen',
        source: 'workspace',
      }),
    })

    const snapshot = runner.run('demo-task', { verifyOnComplete: false })
    await flushAsyncWork()

    expect(snapshot).toEqual(expect.objectContaining({
      taskId: '018f47a8-6c26-7a13-9bf6-7c8d4f2e4c72',
      effectiveCwd: '/repo/frozen',
      effectiveCwdSource: 'workspace',
    }))
    expect(readRunContextSnapshot(workspaceRoot, 'demo-task', 'run-context')).toEqual(
      expect.objectContaining({
        taskId: '018f47a8-6c26-7a13-9bf6-7c8d4f2e4c72',
        effectiveCwd: '/repo/frozen',
        effectiveCwdSource: 'workspace',
        scope: { kind: 'workspace' },
      }),
    )
    expect(readRunLog(workspaceRoot, 'demo-task', 'run-context')[0]).toEqual(
      expect.objectContaining({
        kind: 'run-started',
        taskId: '018f47a8-6c26-7a13-9bf6-7c8d4f2e4c72',
        taskSlug: 'demo-task',
        effectiveCwd: '/repo/frozen',
      }),
    )
    expect(host.createdSessions[0]?.options.workingDirectory).toBe('/repo/frozen')
  })

  test('cwd resolver blocked 时不创建 Run 目录或 child Session', () => {
    const workspaceRoot = createTempWorkspaceRoot()
    saveTaskSpec(workspaceRoot, buildSpec())
    const host = new FakeConductorSessionHost()
    const runner = createRunner(workspaceRoot, host, 'run-blocked', {
      resolveTaskWorkingDirectory: () => ({ status: 'blocked', reason: 'missing-cwd' }),
    })

    expect(() => runner.run('demo-task')).toThrow(/工作目录|cwd|Project|Workspace/i)
    expect(existsSync(runDir(workspaceRoot, 'demo-task', 'run-blocked'))).toBe(false)
    expect(host.createdSessions).toEqual([])
  })

  test('恢复时按 correlation key 复用已创建 Session，不重复派发副作用', async () => {
    const workspaceRoot = createTempWorkspaceRoot()
    const spec = buildSpec()
    saveTaskSpec(workspaceRoot, spec)
    initializeRun(workspaceRoot, spec.id, 'run-recover-intent', spec, {
      schemaVersion: 1,
      taskId: spec.id,
      taskSlug: spec.id,
      runId: 'run-recover-intent',
      scope: { kind: 'workspace' },
      createdAt: '2026-07-13T00:00:00.000Z',
      verifyOnComplete: false,
    })
    const correlationKey = `${spec.id}/run-recover-intent/draft/1`
    appendRunLog(workspaceRoot, spec.id, 'run-recover-intent', {
      t: '2026-07-13T00:00:00.000Z',
      seq: 1,
      kind: 'run-started',
      taskId: spec.id,
      taskSlug: spec.id,
      runId: 'run-recover-intent',
      verifyOnComplete: false,
    })
    appendRunLog(workspaceRoot, spec.id, 'run-recover-intent', {
      t: '2026-07-13T00:00:01.000Z',
      seq: 2,
      kind: 'node-scheduled',
      nodeId: 'draft',
    })
    appendRunLog(workspaceRoot, spec.id, 'run-recover-intent', {
      t: '2026-07-13T00:00:02.000Z',
      seq: 3,
      kind: 'node-dispatch-intent',
      nodeId: 'draft',
      attempt: 1,
      correlationKey,
    })

    const host = new FakeConductorSessionHost()
    host.createdSessions.push({
      id: 'session-existing',
      workspaceId: 'ws-1',
      options: {
        taskSlug: spec.id,
        taskRunId: 'run-recover-intent',
        taskNodeId: 'draft',
        taskAttempt: 1,
        taskCorrelationKey: correlationKey,
      },
    })
    host.completeSession('session-existing', { workspaceId: 'ws-1', finalText: 'already completed' })
    const runner = createRunner(workspaceRoot, host, 'unused', {
      isSessionActive: () => false,
    })

    runner.resume(spec.id, 'run-recover-intent')
    await flushAsyncWork()

    expect(host.createdSessions).toHaveLength(1)
    await expect(runner.waitUntilSettled(spec.id, 'run-recover-intent')).resolves.toEqual(
      expect.objectContaining({
        status: 'completed',
        nodes: [expect.objectContaining({ id: 'draft', state: 'done', sessionId: 'session-existing', attempt: 1 })],
      }),
    )
  })

  test('按依赖顺序调度节点', async () => {
    const workspaceRoot = createTempWorkspaceRoot()
    saveTaskSpec(workspaceRoot, buildSpec({
      nodes: [
        { id: 'draft', kind: 'session', prompt: 'draft the task' },
        { id: 'review', kind: 'session', prompt: 'review ${nodes.draft.output}', depends_on: ['draft'] },
      ],
    }))

    const host = new FakeConductorSessionHost()
    const runner = createRunner(workspaceRoot, host)

    runner.run('demo-task', { verifyOnComplete: false })
    await flushAsyncWork()
    expect(host.createdSessions.map((session) => session.options.taskNodeId)).toEqual(['draft'])

    host.completeSession('session-1', { workspaceId: 'ws-1', finalText: 'draft output' })
    await flushAsyncWork()

    expect(host.createdSessions.map((session) => session.options.taskNodeId)).toEqual(['draft', 'review'])
    expect(host.sentMessages.get('session-2')?.[0]).toContain('review draft output')

    host.completeSession('session-2', { workspaceId: 'ws-1', finalText: 'reviewed' })

    await expect(runner.waitUntilSettled('demo-task', 'run-1')).resolves.toEqual(
      expect.objectContaining({
        status: 'completed',
        nodes: [
          expect.objectContaining({ id: 'draft', state: 'done', attempt: 1 }),
          expect.objectContaining({ id: 'review', state: 'done', attempt: 1 }),
        ],
      }),
    )
  })

  test('Run 生命周期只自动 todo → in-progress → needs-review，不覆盖用户终态', async () => {
    const workspaceRoot = createTempWorkspaceRoot()
    const spec = buildSpec()
    saveTaskSpec(workspaceRoot, spec)
    saveTaskRecord(workspaceRoot, {
      schemaVersion: 1,
      taskId: '018f47a8-6c26-7a13-9bf6-7c8d4f2e4c72',
      slug: spec.id,
      revision: 1,
      workflow: 'todo',
      labelIds: [],
      createdAt: 1,
      updatedAt: 1,
    })
    const host = new FakeConductorSessionHost()
    const runner = createRunner(workspaceRoot, host)

    runner.run(spec.id, { verifyOnComplete: false })
    expect(loadTaskRecord(workspaceRoot, spec.id)).toEqual(expect.objectContaining({
      kind: 'valid',
      record: expect.objectContaining({ workflow: 'in-progress', revision: 2 }),
    }))

    await flushAsyncWork()
    host.completeSession('session-1', { workspaceId: 'ws-1', finalText: 'done' })
    await runner.waitUntilSettled(spec.id, 'run-1')
    expect(loadTaskRecord(workspaceRoot, spec.id)).toEqual(expect.objectContaining({
      kind: 'valid',
      record: expect.objectContaining({ workflow: 'needs-review', revision: 3 }),
    }))

    const settledRecord = loadTaskRecord(workspaceRoot, spec.id)
    if (settledRecord.kind !== 'valid') throw new Error('expected valid TaskRecord')
    saveTaskRecord(workspaceRoot, { ...settledRecord.record, workflow: 'done', revision: 4 })
    const secondHost = new FakeConductorSessionHost()
    const secondRunner = createRunner(workspaceRoot, secondHost, 'run-2')
    secondRunner.run(spec.id, { verifyOnComplete: false })
    await flushAsyncWork()
    secondHost.completeSession('session-1', { workspaceId: 'ws-1', finalText: 'done again' })
    await secondRunner.waitUntilSettled(spec.id, 'run-2')
    expect(loadTaskRecord(workspaceRoot, spec.id)).toEqual(expect.objectContaining({
      kind: 'valid',
      record: expect.objectContaining({ workflow: 'done', revision: 4 }),
    }))
  })

  test('遵守 max_parallel 限制，直到有空槽才继续派发', async () => {
    const workspaceRoot = createTempWorkspaceRoot()
    saveTaskSpec(workspaceRoot, buildSpec({
      max_parallel: 2,
      nodes: [
        { id: 'a', kind: 'session', prompt: 'task a' },
        { id: 'b', kind: 'session', prompt: 'task b' },
        { id: 'c', kind: 'session', prompt: 'task c' },
      ],
    }))

    const host = new FakeConductorSessionHost()
    const runner = createRunner(workspaceRoot, host)

    runner.run('demo-task', { verifyOnComplete: false })
    await flushAsyncWork()
    expect(host.createdSessions.map((session) => session.options.taskNodeId)).toEqual(['a', 'b'])

    host.completeSession('session-1', { workspaceId: 'ws-1', finalText: 'done a' })
    await flushAsyncWork()

    expect(host.createdSessions.map((session) => session.options.taskNodeId)).toEqual(['a', 'b', 'c'])
  })

  test('pause 阻止新的派发，resume 后继续调度', async () => {
    const workspaceRoot = createTempWorkspaceRoot()
    saveTaskSpec(workspaceRoot, buildSpec({
      max_parallel: 1,
      nodes: [
        { id: 'a', kind: 'session', prompt: 'task a' },
        { id: 'b', kind: 'session', prompt: 'task b' },
      ],
    }))

    const host = new FakeConductorSessionHost()
    const runner = createRunner(workspaceRoot, host)

    runner.run('demo-task', { verifyOnComplete: false })
    await flushAsyncWork()
    runner.pause('demo-task', 'run-1')

    host.completeSession('session-1', { workspaceId: 'ws-1', finalText: 'done a' })

    expect(host.createdSessions.map((session) => session.options.taskNodeId)).toEqual(['a'])

    runner.resume('demo-task', 'run-1')
    await flushAsyncWork()

    expect(host.createdSessions.map((session) => session.options.taskNodeId)).toEqual(['a', 'b'])
  })

  test('stop 会取消所有活跃子 session 并进入 stopped', async () => {
    const workspaceRoot = createTempWorkspaceRoot()
    saveTaskSpec(workspaceRoot, buildSpec({
      max_parallel: 2,
      nodes: [
        { id: 'a', kind: 'session', prompt: 'task a' },
        { id: 'b', kind: 'session', prompt: 'task b' },
      ],
    }))

    const host = new FakeConductorSessionHost()
    const runner = createRunner(workspaceRoot, host)

    runner.run('demo-task', { verifyOnComplete: false })
    await flushAsyncWork()

    await runner.stop('demo-task', 'run-1')

    expect(host.cancelledSessions).toEqual(['session-1', 'session-2'])
    expect(runner.getRunState('demo-task', 'run-1')).toEqual(
      expect.objectContaining({
        status: 'stopped',
        nodes: [
          expect.objectContaining({ id: 'a', state: 'cancelled' }),
          expect.objectContaining({ id: 'b', state: 'cancelled' }),
        ],
      }),
    )
  })

  test('已结算 Run 只保留有界快照，不长期持有 ActiveRun', async () => {
    const workspaceRoot = createTempWorkspaceRoot()
    saveTaskSpec(workspaceRoot, buildSpec())
    const host = new FakeConductorSessionHost()
    let runSequence = 0
    const runner = createRunner(workspaceRoot, host, 'unused', {
      genRunId: () => `run-${++runSequence}`,
    })

    for (let index = 1; index <= 51; index += 1) {
      const runId = `run-${index}`
      runner.run('demo-task', { verifyOnComplete: false })
      await flushAsyncWork()
      host.completeSession(`session-${index}`, { workspaceId: 'ws-1', finalText: `done-${index}` })
      await runner.waitUntilSettled('demo-task', runId)
    }

    expect(runner.getRunState('demo-task', 'run-1')).toBeNull()
    expect(runner.getRunState('demo-task', 'run-51')).toEqual(
      expect.objectContaining({ status: 'completed' }),
    )
  })

  test('失败后按 retry 设置重试，并将失败原因注入下一次 prompt', async () => {
    const workspaceRoot = createTempWorkspaceRoot()
    saveTaskSpec(workspaceRoot, buildSpec({
      nodes: [
        {
          id: 'draft',
          kind: 'session',
          prompt: 'draft the task',
          retry: { limit: 1, when: 'error' },
        },
      ],
    }))

    const host = new FakeConductorSessionHost()
    const runner = createRunner(workspaceRoot, host)

    runner.run('demo-task', { verifyOnComplete: false })
    await flushAsyncWork()
    host.completeSession('session-1', { workspaceId: 'ws-1', reason: 'error' })
    await flushAsyncWork()

    expect(host.createdSessions.map((session) => session.options.taskNodeId)).toEqual(['draft', 'draft'])
    expect(host.sentMessages.get('session-2')?.[0]).toContain('Previous attempt failed: error')

    host.completeSession('session-2', { workspaceId: 'ws-1', finalText: 'fixed output' })

    await expect(runner.waitUntilSettled('demo-task', 'run-1')).resolves.toEqual(
      expect.objectContaining({
        status: 'completed',
        nodes: [expect.objectContaining({ id: 'draft', state: 'done', attempt: 2 })],
      }),
    )
  })

  test('rehydrate 不会重复派发已经 spawn 过的节点', async () => {
    const workspaceRoot = createTempWorkspaceRoot()
    saveTaskSpec(workspaceRoot, buildSpec())

    const firstHost = new FakeConductorSessionHost()
    const firstRunner = createRunner(workspaceRoot, firstHost)
    firstRunner.run('demo-task', { verifyOnComplete: false })
    await flushAsyncWork()

    expect(firstHost.createdSessions.map((session) => session.options.taskNodeId)).toEqual(['draft'])

    const rehydratedHost = new FakeConductorSessionHost()
    const rehydratedRunner = createRunner(workspaceRoot, rehydratedHost)

    rehydratedRunner.resume('demo-task', 'run-1')
    await flushAsyncWork()

    expect(rehydratedHost.createdSessions).toHaveLength(0)
    expect(rehydratedRunner.getRunState('demo-task', 'run-1')).toEqual(
      expect.objectContaining({
        status: 'running',
        nodes: [expect.objectContaining({ id: 'draft', state: 'running', sessionId: 'session-1', attempt: 1 })],
      }),
    )
  })

  test('rehydrate 优先使用运行快照而不是已被编辑的 live task.yaml', async () => {
    const workspaceRoot = createTempWorkspaceRoot()
    saveTaskSpec(workspaceRoot, buildSpec({
      nodes: [
        { id: 'draft', kind: 'session', prompt: 'draft the task' },
        { id: 'review', kind: 'session', prompt: 'review ${nodes.draft.output}', depends_on: ['draft'] },
      ],
    }))

    const firstHost = new FakeConductorSessionHost()
    const firstRunner = createRunner(workspaceRoot, firstHost)
    firstRunner.run('demo-task', { verifyOnComplete: false })
    await flushAsyncWork()

    saveTaskSpec(workspaceRoot, buildSpec({
      nodes: [
        { id: 'draft', kind: 'session', prompt: 'draft the task (mutated)' },
        { id: 'review', kind: 'session', prompt: 'MUTATED ${nodes.draft.output}', depends_on: ['draft'] },
      ],
    }))

    const rehydratedHost = new FakeConductorSessionHost()
    const rehydratedRunner = createRunner(workspaceRoot, rehydratedHost)

    rehydratedRunner.resume('demo-task', 'run-1')
    await flushAsyncWork()

    rehydratedHost.completeSession('session-1', { workspaceId: 'ws-1', finalText: 'draft output' })
    await flushAsyncWork()

    expect(rehydratedHost.createdSessions.map((session) => session.options.taskNodeId)).toEqual(['review'])
    const reviewSessionId = rehydratedHost.createdSessions[0]?.id
    expect(reviewSessionId).toBeDefined()
    expect(rehydratedHost.sentMessages.get(reviewSessionId ?? '')?.[0]).toContain('review draft output')
    expect(rehydratedHost.sentMessages.get(reviewSessionId ?? '')?.[0]).not.toContain('MUTATED')
  })

  test('rehydrate 会恢复运行参数与 verifyOnComplete，避免受 live task.yaml 漂移影响', async () => {
    const workspaceRoot = createTempWorkspaceRoot()
    saveTaskSpec(workspaceRoot, buildSpec({
      params: [
        { name: 'topic', type: 'string', default: 'beta' },
      ],
      nodes: [
        { id: 'draft', kind: 'session', prompt: 'draft ${params.topic}' },
        { id: 'review', kind: 'session', prompt: 'review ${params.topic} ${nodes.draft.output}', depends_on: ['draft'] },
      ],
    }))

    const firstHost = new FakeConductorSessionHost()
    const firstRunner = createRunner(workspaceRoot, firstHost)
    firstRunner.run('demo-task', {
      orchestratorSessionId: 'orchestrator-1',
      params: { topic: 'alpha' },
      verifyOnComplete: false,
    })
    await flushAsyncWork()

    saveTaskSpec(workspaceRoot, buildSpec({
      params: [
        { name: 'topic', type: 'string', default: 'gamma' },
      ],
      nodes: [
        { id: 'draft', kind: 'session', prompt: 'draft ${params.topic} (mutated)' },
        { id: 'review', kind: 'session', prompt: 'MUTATED ${params.topic} ${nodes.draft.output}', depends_on: ['draft'] },
      ],
    }))

    const rehydratedHost = new FakeConductorSessionHost()
    const rehydratedRunner = createRunner(workspaceRoot, rehydratedHost)

    rehydratedRunner.resume('demo-task', 'run-1')
    await flushAsyncWork()

    rehydratedHost.completeSession('session-1', { workspaceId: 'ws-1', finalText: 'draft output' })
    await flushAsyncWork()

    expect(rehydratedHost.createdSessions.map((session) => session.options.taskNodeId)).toEqual(['review'])
    const reviewSessionId = rehydratedHost.createdSessions[0]?.id
    expect(reviewSessionId).toBeDefined()
    expect(rehydratedHost.sentMessages.get(reviewSessionId ?? '')?.[0]).toContain('review alpha draft output')
    expect(rehydratedHost.sentMessages.get(reviewSessionId ?? '')?.[0]).not.toContain('MUTATED')

    rehydratedHost.completeSession(reviewSessionId ?? '', { workspaceId: 'ws-1', finalText: 'reviewed alpha' })

    await expect(rehydratedRunner.waitUntilSettled('demo-task', 'run-1')).resolves.toEqual(
      expect.objectContaining({
        status: 'completed',
      }),
    )
    expect(rehydratedHost.sentMessages.has('orchestrator-1')).toBe(false)
  })

  test('legacy rehydrate 使用 spec 默认参数并默认进入 verifyOnComplete', async () => {
    const workspaceRoot = createTempWorkspaceRoot()
    const originalSpec = buildSpec({
      params: [
        { name: 'topic', type: 'string', default: 'alpha' },
      ],
      nodes: [
        { id: 'draft', kind: 'session', prompt: 'draft ${params.topic}' },
        { id: 'review', kind: 'session', prompt: 'review ${params.topic} ${nodes.draft.output}', depends_on: ['draft'] },
      ],
    })
    saveTaskSpec(workspaceRoot, originalSpec)

    appendRunLog(workspaceRoot, 'demo-task', 'run-1', {
      t: '2026-07-13T00:00:00.000Z',
      kind: 'run-started',
      taskId: 'demo-task',
      runId: 'run-1',
      orchestratorSessionId: 'orchestrator-1',
    })
    appendRunLog(workspaceRoot, 'demo-task', 'run-1', {
      t: '2026-07-13T00:00:01.000Z',
      kind: 'node-scheduled',
      nodeId: 'draft',
    })
    appendRunLog(workspaceRoot, 'demo-task', 'run-1', {
      t: '2026-07-13T00:00:02.000Z',
      kind: 'node-spawned',
      nodeId: 'draft',
      sessionId: 'session-1',
    })
    writeRunSpecSnapshot(workspaceRoot, 'demo-task', 'run-1', originalSpec)

    saveTaskSpec(workspaceRoot, buildSpec({
      params: [
        { name: 'topic', type: 'string', default: 'gamma' },
      ],
      nodes: [
        { id: 'draft', kind: 'session', prompt: 'draft ${params.topic} (mutated)' },
        { id: 'review', kind: 'session', prompt: 'MUTATED ${params.topic} ${nodes.draft.output}', depends_on: ['draft'] },
      ],
    }))

    const host = new FakeConductorSessionHost()
    const runner = createRunner(workspaceRoot, host)

    runner.resume('demo-task', 'run-1')
    await flushAsyncWork()
    host.completeSession('session-1', { workspaceId: 'ws-1', finalText: 'draft output' })
    await flushAsyncWork()

    const reviewSessionId = host.createdSessions[0]?.id
    expect(reviewSessionId).toBeDefined()
    expect(host.sentMessages.get(reviewSessionId ?? '')?.[0]).toContain('review alpha draft output')
    expect(host.sentMessages.get(reviewSessionId ?? '')?.[0]).not.toContain('MUTATED')

    host.completeSession(reviewSessionId ?? '', { workspaceId: 'ws-1', finalText: 'reviewed alpha' })
    await flushAsyncWork()

    expect(runner.getRunState('demo-task', 'run-1')).toEqual(
      expect.objectContaining({ status: 'verifying' }),
    )
    expect(host.sentMessages.get('orchestrator-1')?.[0]).toContain('Verify the final result')
  })

  test('注入专家 preamble 并合并 skills', async () => {
    const workspaceRoot = createTempWorkspaceRoot()
    saveTaskSpec(workspaceRoot, buildSpec({
      skills: ['task-skill'],
      defaults: { expertId: 'architect' },
      nodes: [{ id: 'draft', kind: 'session', prompt: 'draft the task' }],
    }))
    const host = new FakeConductorSessionHost()
    const runner = new TaskRunner({
      host,
      workspaceId: 'ws-1',
      workspaceRoot,
      defaultMaxParallel: 2,
      genRunId: () => 'run-1',
      now: () => '2026-07-13T00:00:00.000Z',
      getExpert: (id) => id === 'architect'
        ? {
            id: 'architect',
            label: '软件架构师',
            skillSlugs: ['task-skill', 'pdf'],
            mcpIds: ['filesystem', 'browser'],
            channelBindings: [],
            identityMd: 'I am architect',
            soulMd: 'calm',
            rulesMd: 'no secrets',
          }
        : null,
    })
    runner.run('demo-task', { verifyOnComplete: false })
    await flushAsyncWork()
    const message = host.sentMessages.get('session-1')?.[0] ?? ''
    expect(message).toContain('Apply these skills: [skill:task-skill] [skill:pdf]')
    expect(message).toContain('<agent_expert id="architect"')
    expect(message).toContain('I am architect')
    expect(message).toContain('draft the task')
    expect(host.sentOptions.get('session-1')?.[0]).toEqual({
      mentionedSkills: ['task-skill', 'pdf'],
      mentionedMcpServers: ['filesystem', 'browser'],
    })
  })

  test('专家缺失时仍派发且无 agent_expert 块', async () => {
    const workspaceRoot = createTempWorkspaceRoot()
    saveTaskSpec(workspaceRoot, buildSpec({
      defaults: { expertId: 'missing' },
      nodes: [{ id: 'draft', kind: 'session', prompt: 'draft the task' }],
    }))
    const host = new FakeConductorSessionHost()
    const runner = new TaskRunner({
      host,
      workspaceId: 'ws-1',
      workspaceRoot,
      genRunId: () => 'run-1',
      getExpert: () => null,
    })
    runner.run('demo-task', { verifyOnComplete: false })
    await flushAsyncWork()
    const message = host.sentMessages.get('session-1')?.[0] ?? ''
    expect(message).not.toContain('<agent_expert')
    expect(message).toContain('draft the task')
  })

  test('无 defaults.expertId 时回退项目 defaultExpertId', async () => {
    const workspaceRoot = createTempWorkspaceRoot()
    saveTaskSpec(workspaceRoot, buildSpec({
      project: 'proj-1',
      nodes: [{ id: 'draft', kind: 'session', prompt: 'draft the task' }],
    }))
    const host = new FakeConductorSessionHost()
    const runner = new TaskRunner({
      host,
      workspaceId: 'ws-1',
      workspaceRoot,
      genRunId: () => 'run-1',
      resolveProjectDefaultExpertId: (id) => (id === 'proj-1' ? 'qa' : null),
      getExpert: (id) => id === 'qa'
        ? {
            id: 'qa',
            label: '软件测试',
            skillSlugs: [],
            mcpIds: [],
            channelBindings: [],
            identityMd: 'qa identity',
            soulMd: '',
            rulesMd: '',
          }
        : null,
    })
    runner.run('demo-task', { verifyOnComplete: false })
    await flushAsyncWork()
    expect(host.sentMessages.get('session-1')?.[0]).toContain('qa identity')
  })

  test('团队展开：成员节点注入各自专家 preamble，汇总节点引用成员输出后完成（最小闭环）', async () => {
    const workspaceRoot = createTempWorkspaceRoot()
    const team: TeamSquad = {
      id: 'dev-team',
      label: '软件研发全流程团',
      kind: 'team',
      leaderExpertId: 'delivery-manager',
      members: [
        { expertId: 'architect', role: '架构设计' },
        { expertId: 'general', role: '编码实现' },
      ],
    }
    const baseSpec = buildSpec()
    const leaderOutput: TaskSpec = {
      id: 'plan',
      title: '委派计划',
      goal: baseSpec.goal,
      runner: 'conduct',
      nodes: [
        { id: 'design', kind: 'session', title: '设计', expertId: 'architect', prompt: '出架构方案' },
        { id: 'impl', kind: 'session', title: '实现', expertId: 'general', prompt: '按设计实现', depends_on: ['design'] },
      ],
    }
    const built = buildTeamExecutionSpec({ team, leaderSpec: leaderOutput, baseSpec })
    expect(built.ok).toBe(true)
    const expandedSpec = built.spec!
    saveTaskSpec(workspaceRoot, expandedSpec)

    const host = new FakeConductorSessionHost()
    const expertPackages: Record<string, ExpertPackage> = {
      architect: {
        id: 'architect', label: '软件架构师', skillSlugs: ['brainstorming'], mcpIds: [], channelBindings: [],
        identityMd: '架构师身份', soulMd: '', rulesMd: '',
      },
      general: {
        id: 'general', label: '通用软件专家', skillSlugs: [], mcpIds: [], channelBindings: [],
        identityMd: '通用专家身份', soulMd: '', rulesMd: '',
      },
      'delivery-manager': {
        id: 'delivery-manager', label: '软件交付经理', skillSlugs: [], mcpIds: [], channelBindings: [],
        identityMd: '交付经理身份', soulMd: '', rulesMd: '',
      },
    }
    const runner = createRunner(workspaceRoot, host, 'run-team', {
      getExpert: (id) => expertPackages[id] ?? null,
    })

    runner.runWithSpec(expandedSpec, 'demo-task', { verifyOnComplete: false })
    await flushAsyncWork()

    // 第一批：design（architect）
    expect(host.sentMessages.get('session-1')?.[0]).toContain('<agent_expert id="architect"')
    expect(host.sentMessages.get('session-1')?.[0]).toContain('架构师身份')
    // impl 依赖 design，尚未派发
    expect(host.sentMessages.has('session-2')).toBe(false)

    host.completeSession('session-1', { workspaceId: 'ws-1', finalText: '架构方案产出' })
    await flushAsyncWork()

    // 第二批：impl（general）
    expect(host.sentMessages.get('session-2')?.[0]).toContain('<agent_expert id="general"')
    expect(host.sentMessages.get('session-2')?.[0]).toContain('通用专家身份')

    host.completeSession('session-2', { workspaceId: 'ws-1', finalText: '实现代码产出' })
    await flushAsyncWork()

    // 第三批：团长汇总节点（delivery-manager），引用成员输出
    const summaryPrompt = host.sentMessages.get('session-3')?.[0] ?? ''
    expect(summaryPrompt).toContain('<agent_expert id="delivery-manager"')
    expect(summaryPrompt).toContain('架构方案产出')
    expect(summaryPrompt).toContain('实现代码产出')

    host.completeSession('session-3', { workspaceId: 'ws-1', finalText: '最终交付' })
    await expect(runner.waitUntilSettled('demo-task', 'run-team')).resolves.toEqual(
      expect.objectContaining({
        status: 'completed',
        nodes: expect.arrayContaining([
          expect.objectContaining({ id: 'design', state: 'done' }),
          expect.objectContaining({ id: 'impl', state: 'done' }),
          expect.objectContaining({ id: 'team-summary', state: 'done' }),
        ]),
      }),
    )
  })
})
