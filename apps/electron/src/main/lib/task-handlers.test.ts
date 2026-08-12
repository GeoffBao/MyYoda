import { afterAll, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LABEL_IPC_CHANNELS, PROJECT_IPC_CHANNELS, TASK_IPC_CHANNELS } from '@myyoda/shared/channels'
import { saveTaskSpec } from '@myyoda/shared/tasks/storage'
import type { BrowserWindow as ElectronBrowserWindow } from 'electron'
import { mockElectronModule } from './__tests__/electron-mock'

type RegisteredHandler = (...args: unknown[]) => unknown

const registeredHandlers = new Map<string, RegisteredHandler>()

interface CapturedCreateSessionCall {
  workspaceId: string
  options: Record<string, unknown>
}

const capturedCreateSessionCalls: CapturedCreateSessionCall[] = []
let registeredWorkspaceRoot: string | undefined

afterAll(() => {
  if (registeredWorkspaceRoot) rmSync(registeredWorkspaceRoot, { recursive: true, force: true })
})

mock.module('./conductor-session-host', () => ({
  createMyYodaConductorSessionHost: async () => ({
    createSession: async (workspaceId: string, options: Record<string, unknown>) => {
      capturedCreateSessionCalls.push({ workspaceId, options })
      return { id: `fake-session-${(options.name as string | undefined) ?? 'untitled'}` }
    },
  }),
}))

mockElectronModule({
  app: { getPath: () => '/tmp/myyoda-test', isPackaged: false },
  ipcMain: {
    handle: (channel: string, handler: RegisteredHandler) => {
      registeredHandlers.set(channel, handler)
    },
  },
})

const {
  pauseTaskRun,
  stopTaskRun,
  materializeTaskFromSpec,
  assertAdoptableTaskDraftSession,
}: typeof import('./task-handlers') = await import('./task-handlers')
const taskHandlers = await import('./task-handlers')
type TaskRunnerController = import('./task-handlers').TaskRunnerController

function createController(): {
  controller: TaskRunnerController
  paused: Array<{ slug: string; runId: string }>
  stopped: Array<{ slug: string; runId: string }>
} {
  const paused: Array<{ slug: string; runId: string }> = []
  const stopped: Array<{ slug: string; runId: string }> = []
  return {
    controller: {
      pause: (slug, runId) => paused.push({ slug, runId }),
      stop: async (slug, runId) => { stopped.push({ slug, runId }) },
    },
    paused,
    stopped,
  }
}

describe('task handler runner hydration', () => {
  test('pause 从 resolver 获取 runner，而不是只操作内存注册表', async () => {
    const { controller, paused } = createController()
    let resolved = false

    await pauseTaskRun(
      async () => {
        resolved = true
        return controller
      },
      '/workspace',
      'workspace-1',
      'demo-task',
      'run-1',
    )

    expect(resolved).toBe(true)
    expect(paused).toEqual([{ slug: 'demo-task', runId: 'run-1' }])
  })

  test('stop 从 resolver 获取 runner，而不是缺少内存 runner 时静默返回', async () => {
    const { controller, stopped } = createController()
    let resolved = false

    await stopTaskRun(
      async () => {
        resolved = true
        return controller
      },
      '/workspace',
      'workspace-1',
      'demo-task',
      'run-1',
    )

    expect(resolved).toBe(true)
    expect(stopped).toEqual([{ slug: 'demo-task', runId: 'run-1' }])
  })
})

describe('task handler Kanban payloads', () => {
  test('项目 create/update handlers 返回 preload 可解包的 LoadedProject', () => {
    const registerHandlers = Reflect.get(taskHandlers, 'registerTaskHandlers')
    expect(registerHandlers).toBeInstanceOf(Function)
    if (typeof registerHandlers !== 'function') return

    const workspaceRoot = mkdtempSync(join(tmpdir(), 'myyoda-project-handler-'))
    registeredWorkspaceRoot = workspaceRoot
    const windowStub = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: () => undefined,
      },
    } as unknown as ElectronBrowserWindow
    registerHandlers(windowStub, {
      workspaceRegistrations: () => [{ id: 'workspace-test', root: workspaceRoot }],
    })
    const createHandler = registeredHandlers.get(PROJECT_IPC_CHANNELS.CREATE)
    const updateHandler = registeredHandlers.get(PROJECT_IPC_CHANNELS.UPDATE)
    const projectDeleteHandler = registeredHandlers.get(PROJECT_IPC_CHANNELS.DELETE)
    const projectImpactHandler = registeredHandlers.get(PROJECT_IPC_CHANNELS.ANALYZE_DELETE_IMPACT)
    const taskImpactHandler = registeredHandlers.get(TASK_IPC_CHANNELS.ANALYZE_DELETE_IMPACT)
    expect(createHandler).toBeInstanceOf(Function)
    expect(updateHandler).toBeInstanceOf(Function)
    expect(projectDeleteHandler).toBeInstanceOf(Function)
    expect(projectImpactHandler).toBeInstanceOf(Function)
    expect(taskImpactHandler).toBeInstanceOf(Function)
    if (!createHandler || !updateHandler || !projectDeleteHandler || !projectImpactHandler || !taskImpactHandler) return

    expect(() => createHandler(undefined, join(workspaceRoot, '..', 'unregistered-root'), { name: '越权项目' })).toThrow(/未注册/)

      const created = createHandler(undefined, workspaceRoot, { name: '发布计划' })
      expect(created).toEqual(expect.objectContaining({
        config: expect.objectContaining({ name: '发布计划' }),
        workspaceRootPath: realpathSync(workspaceRoot),
      }))

      if (typeof created !== 'object' || created === null) throw new Error('create handler 未返回对象')
      const config = Reflect.get(created, 'config')
      if (typeof config !== 'object' || config === null) throw new Error('create handler 未返回 config')
      const slug = Reflect.get(config, 'slug')
      if (typeof slug !== 'string') throw new Error('create handler 未返回 slug')
      const updated = updateHandler(undefined, workspaceRoot, slug, { description: '桌面端' })
      expect(updated).toEqual(expect.objectContaining({
        config: expect.objectContaining({ description: '桌面端' }),
        workspaceRootPath: realpathSync(workspaceRoot),
      }))
      expect(projectImpactHandler(undefined, workspaceRoot, slug)).toEqual(expect.objectContaining({
        taskCount: 0,
        activeRunCount: 0,
      }))
      expect(() => projectDeleteHandler(undefined, workspaceRoot, slug)).toThrow(/先归档/)
      updateHandler(undefined, workspaceRoot, slug, { archivedAt: Date.now() })
      const purgeImpact = projectImpactHandler(undefined, workspaceRoot, slug) as { confirmationToken?: string }
      expect(purgeImpact.confirmationToken).toBeString()
      expect(() => projectDeleteHandler(undefined, workspaceRoot, slug, purgeImpact.confirmationToken)).not.toThrow()

      const secondCreated = createHandler(undefined, workspaceRoot, { name: '含引用项目' })
      if (typeof secondCreated !== 'object' || secondCreated === null) throw new Error('create handler 未返回第二个项目')
      const secondConfig = Reflect.get(secondCreated, 'config')
      if (typeof secondConfig !== 'object' || secondConfig === null) throw new Error('create handler 未返回第二个 config')
      const secondSlug = Reflect.get(secondConfig, 'slug') as string
      const secondId = Reflect.get(secondConfig, 'id') as string
      updateHandler(undefined, workspaceRoot, secondSlug, { archivedAt: Date.now() })

      saveTaskSpec(workspaceRoot, {
        id: 'referenced-task',
        title: 'Referenced task',
        goal: 'Keep project reference safe',
        project: secondId,
        runner: 'conduct',
        nodes: [{ id: 'node', kind: 'session', prompt: 'test' }],
      })
      expect(() => projectDeleteHandler(undefined, workspaceRoot, secondSlug)).toThrow(/仍有关联/)

      saveTaskSpec(workspaceRoot, {
        id: 'impact-task',
        title: 'Impact task',
        goal: 'Test impact IPC',
        runner: 'conduct',
        nodes: [{ id: 'node', kind: 'session', prompt: 'test' }],
      })
      expect(taskImpactHandler(undefined, workspaceRoot, 'impact-task')).toEqual(expect.objectContaining({
        runCount: 0,
        sessionCount: 0,
      }))
  })

  test('session label assignment rejects a workspace mismatch before persistence', () => {
    const validateAssignment = Reflect.get(taskHandlers, 'validateSessionLabelAssignment')
    expect(validateAssignment).toBeInstanceOf(Function)
    if (typeof validateAssignment !== 'function') return

    expect(() => validateAssignment('/workspaces/alpha', {
      id: 'session-1',
      title: 'Session',
      workspaceId: 'workspace-beta',
      createdAt: 1,
      updatedAt: 1,
    }, [], (workspaceId: string) => workspaceId === 'workspace-beta' ? '/workspaces/beta' : undefined)).toThrow(/Workspace/)

    const workspaceRoot = mkdtempSync(join(tmpdir(), 'myyoda-session-label-handler-'))
    try {
      expect(() => validateAssignment(workspaceRoot, {
        id: 'session-2',
        title: 'Session',
        createdAt: 1,
        updatedAt: 1,
      }, ['unknown'])).toThrow(/不存在/)
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  test('label persistence handlers validate IDs before calling persistence', () => {
    expect(registeredHandlers.get(LABEL_IPC_CHANNELS.SET_SESSION_LABELS)).toBeInstanceOf(Function)
    const taskHandler = registeredHandlers.get(LABEL_IPC_CHANNELS.SET_TASK_LABELS)
    expect(taskHandler).toBeInstanceOf(Function)
    if (!taskHandler) return

    const workspaceRoot = registeredWorkspaceRoot
    expect(workspaceRoot).toBeString()
    if (!workspaceRoot) return
    expect(() => taskHandler(undefined, workspaceRoot, 'workspace-test', 'task-1', ['unknown'])).toThrow(/不存在/)
  })

  test('set_kanban_column 返回更新后的 AgentSessionMeta', () => {
    const setKanbanColumn = Reflect.get(taskHandlers, 'setSessionKanbanColumn')
    expect(setKanbanColumn).toBeInstanceOf(Function)
    if (typeof setKanbanColumn !== 'function') return

    const result = setKanbanColumn('session-1', 'done', (sessionId: string, updates: { kanbanColumn?: string }) => ({
      id: sessionId,
      title: '任务会话',
      createdAt: 1,
      updatedAt: 2,
      ...updates,
    }))

    expect(result).toEqual(expect.objectContaining({ id: 'session-1', kanbanColumn: 'done' }))
  })

  test('validate payload 保留 warnings', () => {
    const buildPayload = Reflect.get(taskHandlers, 'buildTaskValidationPayload')
    expect(buildPayload).toBeInstanceOf(Function)
    if (typeof buildPayload !== 'function') return

    const warnings = [{ file: 'task.yaml', path: 'nodes.a', message: '依赖建议', severity: 'warning' as const }]
    const result = buildPayload({ valid: true, errors: [], warnings })

    expect(result).toEqual(expect.objectContaining({ valid: true, errors: [], warnings }))
  })

  test('set_kanban_column 可联动同步 sessionStatus', () => {
    const setKanbanColumn = Reflect.get(taskHandlers, 'setSessionKanbanColumn')
    expect(setKanbanColumn).toBeInstanceOf(Function)
    if (typeof setKanbanColumn !== 'function') return

    const result = setKanbanColumn(
      'session-1',
      'in-progress',
      (sessionId: string, updates: { kanbanColumn?: string; sessionStatus?: string }) => ({
        id: sessionId,
        title: '任务会话',
        createdAt: 1,
        updatedAt: 2,
        ...updates,
      }),
      { sessionStatus: 'coding' },
    )

    expect(result).toEqual(expect.objectContaining({
      id: 'session-1',
      kanbanColumn: 'in-progress',
      sessionStatus: 'coding',
    }))
  })

  test('Workspace Task 从 workspace root/config.json 解析默认 cwd', () => {
    const resolveCwd = Reflect.get(taskHandlers, 'resolveTaskWorkingDirectoryResult')
    expect(resolveCwd).toBeInstanceOf(Function)
    if (typeof resolveCwd !== 'function') return

    const workspaceRoot = mkdtempSync(join(tmpdir(), 'myyoda-workspace-cwd-root-'))
    const workspaceCwd = mkdtempSync(join(tmpdir(), 'myyoda-workspace-cwd-target-'))
    try {
      writeFileSync(join(workspaceRoot, 'config.json'), JSON.stringify({ defaultWorkingDirectory: workspaceCwd }))
      expect(resolveCwd(workspaceRoot, {})).toEqual({
        status: 'resolved',
        cwd: realpathSync(workspaceCwd),
        source: 'workspace',
      })
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
      rmSync(workspaceCwd, { recursive: true, force: true })
    }
  })

  test('set_project_id 有有效 cwd 时写入 workingDirectory，解绑不清除', () => {
    const buildUpdates = Reflect.get(taskHandlers, 'buildSetProjectIdUpdates')
    expect(buildUpdates).toBeInstanceOf(Function)
    if (typeof buildUpdates !== 'function') return

    expect(buildUpdates('proj-1', '/repo/app')).toEqual({
      projectId: 'proj-1',
      workingDirectory: '/repo/app',
      kanbanColumn: 'todo',
    })
    // 无有效 cwd（不可用外部目录）：不带 workingDirectory 键，保留会话已有目录
    expect(buildUpdates('proj-1', undefined)).toEqual({ projectId: 'proj-1', kanbanColumn: 'todo' })
    expect(Object.hasOwn(buildUpdates('proj-1', undefined) as object, 'workingDirectory')).toBe(false)
    // 解绑：清空 projectId，但不写 workingDirectory，也不动看板列
    expect(buildUpdates(undefined, undefined)).toEqual({ projectId: undefined })
    expect(Object.hasOwn(buildUpdates(undefined, '/repo/app') as object, 'workingDirectory')).toBe(false)
    expect(Object.hasOwn(buildUpdates(undefined, undefined) as object, 'kanbanColumn')).toBe(false)
  })

  test('set_project_id 看板列顺位：无列/收件箱 → 待办，已整理列不动', () => {
    const buildUpdates = Reflect.get(taskHandlers, 'buildSetProjectIdUpdates')
    expect(buildUpdates).toBeInstanceOf(Function)
    if (typeof buildUpdates !== 'function') return

    // 从未上板（无列）→ 待办
    expect(buildUpdates('proj-1', undefined, undefined)).toEqual({ projectId: 'proj-1', kanbanColumn: 'todo' })
    // 滞留历史收件箱 → 待办
    expect(buildUpdates('proj-1', undefined, 'inbox')).toEqual({ projectId: 'proj-1', kanbanColumn: 'todo' })
    // 用户已拖到其他列 → 尊重整理结果
    expect(buildUpdates('proj-1', undefined, 'in-progress')).toEqual({ projectId: 'proj-1' })
    expect(Object.hasOwn(buildUpdates('proj-1', undefined, 'done') as object, 'kanbanColumn')).toBe(false)
  })

  test('resolveSessionDropStatus 内置列联动：待办/已完成写状态，进行中不写', () => {
    const resolveDrop = Reflect.get(taskHandlers, 'resolveSessionDropStatus')
    expect(resolveDrop).toBeInstanceOf(Function)
    if (typeof resolveDrop !== 'function') return

    const session = { id: 's-1', title: '任务', createdAt: 1, updatedAt: 2, sessionStatus: 'todo' }
    const getSession = () => session

    expect(resolveDrop('s-1', 'todo', getSession)).toBe('todo')
    expect(resolveDrop('s-1', 'done', getSession)).toBe('done')
    // 进行中列不写状态：running 由系统派生，拖放只是整理
    expect(resolveDrop('s-1', 'in-progress', getSession)).toBeUndefined()
    // 无项目会话同样享受内置列联动
    expect(resolveDrop('s-1', null, getSession)).toBeUndefined()
  })

  test('resolveSessionDropStatus 运行护栏：running 会话拖列不降级 badge', () => {
    const resolveDrop = Reflect.get(taskHandlers, 'resolveSessionDropStatus')
    expect(resolveDrop).toBeInstanceOf(Function)
    if (typeof resolveDrop !== 'function') return

    const running = { id: 's-2', title: '运行中任务', createdAt: 1, updatedAt: 2, sessionStatus: 'running' }
    expect(resolveDrop('s-2', 'todo', () => running)).toBeUndefined()
    expect(resolveDrop('s-2', 'done', () => running)).toBeUndefined()
  })

  test('采用生成草稿时清除 taskDraft 并恢复待办状态', () => {
    const buildPatch = Reflect.get(taskHandlers, 'buildAdoptedTaskSessionPatch')
    expect(buildPatch).toBeInstanceOf(Function)
    if (typeof buildPatch !== 'function') return

    expect(buildPatch({ id: 'release-task', project: 'project-a' })).toEqual({
      taskSlug: 'release-task',
      projectId: 'project-a',
      taskDraft: undefined,
      sessionStatus: 'todo',
    })

    const validCwd = mkdtempSync(join(tmpdir(), 'myyoda-task-seed-cwd-'))
    try {
      expect(buildPatch(
        {
          id: 'release-task',
          project: 'project-a',
          cwd: validCwd,
          defaults: { model: 'claude-sonnet', llmConnection: 'channel-1', permissionMode: 'allow-all' },
        },
        '/workspace',
      )).toEqual({
        taskSlug: 'release-task',
        projectId: 'project-a',
        workingDirectory: realpathSync(validCwd),
        modelId: 'claude-sonnet',
        channelId: 'channel-1',
        permissionMode: 'bypassPermissions',
        taskDraft: undefined,
        sessionStatus: 'todo',
      })
    } finally {
      rmSync(validCwd, { recursive: true, force: true })
    }
  })

  test('只允许 taskDraft 草稿会话被生成路径转正，防止 stale id 污染普通会话', () => {
    const draft = { id: 'draft-session', title: '草稿', createdAt: 1, updatedAt: 1, taskDraft: true }
    expect(assertAdoptableTaskDraftSession('draft-session', { id: 'release-task' }, () => draft)).toBe(draft)

    expect(() => assertAdoptableTaskDraftSession(
      'plain-session',
      { id: 'release-task' },
      () => ({ id: 'plain-session', title: '普通会话', createdAt: 1, updatedAt: 1 }),
    )).toThrow('生成草稿会话已失效')

    expect(() => assertAdoptableTaskDraftSession(
      'other-task',
      { id: 'release-task' },
      () => ({ id: 'other-task', title: '其他任务', createdAt: 1, updatedAt: 1, taskSlug: 'other-task' }),
    )).toThrow('生成草稿已绑定到其他任务')
  })
})

describe('materializeTaskFromSpec', () => {
  test('落盘 task.yaml 并创建 todo 状态的新会话，且向 createSession 转发完整字段', async () => {
    const { loadTaskSpec } = await import('@myyoda/shared/tasks/storage')
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'myyoda-materialize-task-'))
    capturedCreateSessionCalls.length = 0
    try {
      const spec = {
        id: 'demo-task',
        title: 'Demo Task',
        goal: '完成一件事',
        project: 'demo-project',
        runner: 'conduct' as const,
        nodes: [{ id: 'main', kind: 'session' as const, prompt: '完成一件事' }],
      }

      const result = await materializeTaskFromSpec(workspaceRoot, 'workspace-1', spec)

      expect(result.slug).toBe('demo-task')
      expect(result.orchestratorSessionId).toBe('fake-session-Demo Task')

      const loaded = loadTaskSpec(workspaceRoot, 'demo-task')
      expect(loaded?.valid).toBe(true)
      expect(loaded?.spec?.title).toBe('Demo Task')

      // 核实 createSession 收到的完整 options —— 防止未来重构悄悄丢掉
      // taskSlug / sessionStatus / projectId 等字段导致新建的任务会话状态不对。
      expect(capturedCreateSessionCalls).toHaveLength(1)
      const call = capturedCreateSessionCalls[0]
      if (!call) throw new Error('createSession 未被调用')
      expect(call.workspaceId).toBe('workspace-1')
      expect(call.options).toEqual(expect.objectContaining({
        name: 'Demo Task',
        taskSlug: 'demo-task',
        sessionStatus: 'todo',
        projectId: 'demo-project',
      }))
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  test('slug 已被占用时追加后缀，不覆盖既有 task.yaml 也不孤儿化其 orchestrator 会话', async () => {
    const { loadTaskSpec } = await import('@myyoda/shared/tasks/storage')
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'myyoda-materialize-task-collision-'))
    capturedCreateSessionCalls.length = 0
    try {
      const first = {
        id: 'demo-task',
        title: 'Demo Task',
        goal: '完成第一件事',
        runner: 'conduct' as const,
        nodes: [{ id: 'main', kind: 'session' as const, prompt: '完成第一件事' }],
      }
      const second = {
        id: 'demo-task',
        title: 'Demo Task Again',
        goal: '完成第二件事',
        runner: 'conduct' as const,
        nodes: [{ id: 'main', kind: 'session' as const, prompt: '完成第二件事' }],
      }

      const firstResult = await materializeTaskFromSpec(workspaceRoot, 'workspace-1', first)
      const secondResult = await materializeTaskFromSpec(workspaceRoot, 'workspace-1', second)

      expect(firstResult.slug).toBe('demo-task')
      expect(secondResult.slug).toBe('demo-task-2')
      expect(secondResult.orchestratorSessionId).not.toBe(firstResult.orchestratorSessionId)

      const firstLoaded = loadTaskSpec(workspaceRoot, 'demo-task')
      expect(firstLoaded?.spec?.goal).toBe('完成第一件事')

      const secondLoaded = loadTaskSpec(workspaceRoot, 'demo-task-2')
      expect(secondLoaded?.valid).toBe(true)
      expect(secondLoaded?.spec?.id).toBe('demo-task-2')
      expect(secondLoaded?.spec?.goal).toBe('完成第二件事')

      expect(capturedCreateSessionCalls).toHaveLength(2)
      expect(capturedCreateSessionCalls[1]?.options).toEqual(expect.objectContaining({
        taskSlug: 'demo-task-2',
      }))
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })
})
