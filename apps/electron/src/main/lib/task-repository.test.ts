import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TaskSpec } from '../../../../../packages/shared/src/tasks/schema.ts'
import { saveTaskRecord, taskRecordPath } from '../../../../../packages/shared/src/tasks/storage.ts'
import { TaskRepository } from './task-repository'

const tempRoots: string[] = []

function createTempWorkspaceRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'myyoda-main-task-repo-'))
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
    goal: 'Keep the Task 5 slice bounded',
    runner: 'conduct',
    nodes: [
      {
        id: 'draft',
        kind: 'session',
        prompt: 'draft the slice',
      },
    ],
    ...overrides,
  }
}

function createRepository(workspaceRoots: Record<string, string>): TaskRepository {
  return new TaskRepository({
    resolveWorkspaceRoot(workspaceId) {
      const root = workspaceRoots[workspaceId]
      if (!root) {
        throw new Error(`未知工作区: ${workspaceId}`)
      }
      return root
    },
  })
}

describe('TaskRepository', () => {
  test('缺失任务时返回 null', () => {
    const repository = createRepository({ 'ws-alpha': createTempWorkspaceRoot() })

    expect(repository.getTask('ws-alpha', 'missing-task')).toBeNull()
  })

  test('validateTask 拒绝无效 spec', () => {
    const repository = createRepository({ 'ws-alpha': createTempWorkspaceRoot() })

    const result = repository.validateTask({
      id: 'demo-task',
      title: 'Broken task',
      goal: 'broken',
      runner: 'conduct',
      nodes: [
        {
          id: 'draft',
          kind: 'session',
          prompt: 'draft the slice',
          depends_on: ['missing-node'],
        },
      ],
    })

    expect(result.valid).toBe(false)
    expect(result.errors.some((issue) => issue.path.includes('depends_on'))).toBe(true)
  })

  test('saveTask 后可列出并重新加载 TaskSpec', () => {
    const repository = createRepository({ 'ws-alpha': createTempWorkspaceRoot() })
    const spec = buildSpec()

    repository.saveTask('ws-alpha', spec)

    expect(repository.listTasks('ws-alpha')).toEqual(['demo-task'])
    expect(repository.getTask('ws-alpha', 'demo-task')).toEqual(
      expect.objectContaining({
        valid: true,
        spec,
      }),
    )
  })

  test('listTaskAggregates 合成旧 Task 身份但只读不写 task.json', () => {
    const workspaceRoot = createTempWorkspaceRoot()
    const repository = createRepository({ 'ws-alpha': workspaceRoot })
    const spec = buildSpec()
    repository.saveTask('ws-alpha', spec)

    expect(repository.listTaskAggregates('ws-alpha')).toEqual([
      expect.objectContaining({
        taskId: 'legacy:ws-alpha:demo-task',
        taskSlug: 'demo-task',
        spec,
        record: null,
        legacyIdentity: true,
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: 'missing-task-record', severity: 'warning' }),
        ]),
      }),
    ])
    expect(existsSync(taskRecordPath(workspaceRoot, spec.id))).toBe(false)
  })

  test('显式迁移入口回填旧 TaskRecord，listTaskAggregates 随后使用稳定 ID', () => {
    const workspaceRoot = createTempWorkspaceRoot()
    const repository = createRepository({ 'ws-alpha': workspaceRoot })
    repository.saveTask('ws-alpha', buildSpec({ id: 'migrate-me' }))

    const migration = repository.migrateLegacyTaskRecords('ws-alpha', [], {
      now: () => 100,
      generateTaskId: () => '018f47a8-6c26-7a13-9bf6-7c8d4f2e4c72',
    })

    expect(migration.migrated).toEqual([
      expect.objectContaining({ taskSlug: 'migrate-me', taskId: '018f47a8-6c26-7a13-9bf6-7c8d4f2e4c72' }),
    ])
    expect(repository.listTaskAggregates('ws-alpha')).toEqual([
      expect.objectContaining({
        taskId: '018f47a8-6c26-7a13-9bf6-7c8d4f2e4c72',
        legacyIdentity: false,
      }),
    ])
  })

  test('listTaskAggregateSummaries 从 TaskRepository 投影 Workspace / Project scope 与恢复健康度', () => {
    const workspaceRoot = createTempWorkspaceRoot()
    const repository = createRepository({ 'ws-alpha': workspaceRoot })
    repository.saveTask('ws-alpha', buildSpec({ id: 'workspace-task', title: 'Workspace task' }))
    repository.saveTask('ws-alpha', buildSpec({ id: 'project-task', title: 'Project task', project: 'project-alpha' }))
    saveTaskRecord(workspaceRoot, {
      schemaVersion: 1,
      taskId: '018f47a8-6c26-7a13-9bf6-7c8d4f2e4c72',
      slug: 'project-task',
      revision: 1,
      workflow: 'in-progress',
      labelIds: ['urgent'],
      orchestratorSessionId: 'session-project',
      createdAt: 10,
      updatedAt: 20,
    })

    expect(repository.listTaskAggregateSummaries('ws-alpha')).toEqual([
      expect.objectContaining({
        taskId: '018f47a8-6c26-7a13-9bf6-7c8d4f2e4c72',
        taskSlug: 'project-task',
        title: 'Project task',
        scope: { kind: 'project', projectId: 'project-alpha' },
        workflow: 'in-progress',
        labelIds: ['urgent'],
        orchestratorSessionId: 'session-project',
        health: 'ready',
      }),
      expect.objectContaining({
        taskId: 'legacy:ws-alpha:workspace-task',
        taskSlug: 'workspace-task',
        title: 'Workspace task',
        scope: { kind: 'workspace' },
        workflow: 'todo',
        health: 'warning',
        legacyIdentity: true,
      }),
    ])
  })

  test('updateTaskWorkflow 以 stable taskId 更新 workflow、revision 与时间戳', () => {
    const workspaceRoot = createTempWorkspaceRoot()
    const repository = createRepository({ 'ws-alpha': workspaceRoot })
    const taskId = '018f47a8-6c26-7a13-9bf6-7c8d4f2e4c72'
    repository.saveTask('ws-alpha', buildSpec({ id: 'workflow-task' }))
    saveTaskRecord(workspaceRoot, {
      schemaVersion: 1,
      taskId,
      slug: 'workflow-task',
      revision: 1,
      workflow: 'todo',
      labelIds: [],
      createdAt: 10,
      updatedAt: 10,
    })

    const updated = repository.updateTaskWorkflow('ws-alpha', taskId, 'in-progress', undefined, () => 42)

    expect(updated).toEqual(expect.objectContaining({ taskId, workflow: 'in-progress', updatedAt: 42 }))
    expect(repository.getTaskAggregateById('ws-alpha', taskId)?.record).toEqual(
      expect.objectContaining({ revision: 2, workflow: 'in-progress', updatedAt: 42 }),
    )
  })

  test('updateTaskWorkflow 不会静默物化 legacy TaskRecord', () => {
    const repository = createRepository({ 'ws-alpha': createTempWorkspaceRoot() })
    repository.saveTask('ws-alpha', buildSpec({ id: 'legacy-workflow' }))

    expect(() => repository.updateTaskWorkflow(
      'ws-alpha',
      'legacy:ws-alpha:legacy-workflow',
      'done',
    )).toThrow('稳定 TaskRecord')
  })

  test('updateTaskWorkflow 按 stable taskId 与 revision 更新 TaskRecord', () => {
    const workspaceRoot = createTempWorkspaceRoot()
    const repository = createRepository({ 'ws-alpha': workspaceRoot })
    const taskId = '018f47a8-6c26-7a13-9bf6-7c8d4f2e4c72'
    repository.saveTask('ws-alpha', buildSpec({ id: 'workflow-task' }))
    saveTaskRecord(workspaceRoot, {
      schemaVersion: 1,
      taskId,
      slug: 'workflow-task',
      revision: 3,
      workflow: 'todo',
      labelIds: [],
      createdAt: 1,
      updatedAt: 2,
    })

    expect(repository.updateTaskWorkflow('ws-alpha', taskId, 'in-progress', 3)).toEqual(
      expect.objectContaining({ taskId, workflow: 'in-progress' }),
    )
    expect(repository.getTaskAggregateById('ws-alpha', taskId)?.record).toEqual(
      expect.objectContaining({ revision: 4, workflow: 'in-progress' }),
    )
    expect(() => repository.updateTaskWorkflow('ws-alpha', taskId, 'done', 3))
      .toThrow('revision 冲突')
  })

  test('updateTaskSpec 原地更新同一 slug 并递增 TaskRecord revision', () => {
    const workspaceRoot = createTempWorkspaceRoot()
    const repository = createRepository({ 'ws-alpha': workspaceRoot })
    const taskId = '018f47a8-6c26-7a13-9bf6-7c8d4f2e4c72'
    repository.saveTask('ws-alpha', buildSpec({ id: 'editable-task', title: '旧标题' }))
    saveTaskRecord(workspaceRoot, {
      schemaVersion: 1,
      taskId,
      slug: 'editable-task',
      revision: 2,
      workflow: 'todo',
      labelIds: [],
      orchestratorSessionId: 'session-1',
      createdAt: 1,
      updatedAt: 1,
    })

    const updated = repository.updateTaskSpec(
      'ws-alpha',
      taskId,
      buildSpec({ id: 'editable-task', title: '新标题', goal: '更新目标' }),
      () => 50,
    )
    expect(updated).toEqual(expect.objectContaining({
      taskId,
      taskSlug: 'editable-task',
      title: '新标题',
      goal: '更新目标',
      revision: 3,
      updatedAt: 50,
    }))
    expect(repository.listTasks('ws-alpha')).toEqual(['editable-task'])
    expect(() => repository.updateTaskSpec(
      'ws-alpha',
      taskId,
      buildSpec({ id: 'renamed-task' }),
    )).toThrow('Task slug 不可在编辑时变更')
  })

  test('updateTaskMetadata 以 Task 为边界重命名和归档，不改 Session', () => {
    const workspaceRoot = createTempWorkspaceRoot()
    const repository = createRepository({ 'ws-alpha': workspaceRoot })
    const taskId = '018f47a8-6c26-7a13-9bf6-7c8d4f2e4c72'
    repository.saveTask('ws-alpha', buildSpec({ id: 'metadata-task', title: '旧标题' }))
    saveTaskRecord(workspaceRoot, {
      schemaVersion: 1,
      taskId,
      slug: 'metadata-task',
      revision: 1,
      workflow: 'todo',
      labelIds: [],
      createdAt: 1,
      updatedAt: 1,
    })

    const renamed = repository.updateTaskMetadata(
      'ws-alpha', taskId, { title: '新标题', archived: true, expectedRevision: 1 }, () => 50,
    )
    expect(renamed).toEqual(expect.objectContaining({
      taskId,
      title: '新标题',
      archivedAt: 50,
      revision: 2,
    }))
    expect(repository.getTask('ws-alpha', 'metadata-task')?.spec?.title).toBe('新标题')
  })

  test('updateTaskMetadata 更新 Task labelIds，不改变标题和归档状态', () => {
    const workspaceRoot = createTempWorkspaceRoot()
    const repository = createRepository({ 'ws-alpha': workspaceRoot })
    const taskId = '018f47a8-6c26-7a13-9bf6-7c8d4f2e4c72'
    repository.saveTask('ws-alpha', buildSpec({ id: 'label-test', title: '标签任务' }))
    saveTaskRecord(workspaceRoot, {
      schemaVersion: 1,
      taskId,
      slug: 'label-test',
      revision: 1,
      workflow: 'todo',
      labelIds: [],
      createdAt: 1,
      updatedAt: 1,
    })

    const updated = repository.updateTaskMetadata('ws-alpha', taskId, { labelIds: ['label-a', 'label-b'], expectedRevision: 1 }, () => 50)
    expect(updated).toEqual(expect.objectContaining({
      taskId,
      title: '标签任务',
      labelIds: ['label-a', 'label-b'],
      revision: 2,
      updatedAt: 50,
    }))
    expect(updated.archivedAt).toBeUndefined()
  })

  test('updateTaskMetadata 持久化独立看板列 kanbanColumn，不影响其它字段', () => {
    const workspaceRoot = createTempWorkspaceRoot()
    const repository = createRepository({ 'ws-alpha': workspaceRoot })
    const taskId = '018f47a8-6c26-7a13-9bf6-7c8d4f2e4c72'
    repository.saveTask('ws-alpha', buildSpec({ id: 'kanban-column-test', title: '看板列任务' }))
    saveTaskRecord(workspaceRoot, {
      schemaVersion: 1,
      taskId,
      slug: 'kanban-column-test',
      revision: 1,
      workflow: 'in-progress',
      labelIds: [],
      createdAt: 1,
      updatedAt: 1,
    })

    const updated = repository.updateTaskMetadata(
      'ws-alpha', taskId, { kanbanColumn: 'col-abc123', expectedRevision: 1 }, () => 50,
    )
    expect(updated).toEqual(expect.objectContaining({
      taskId,
      kanbanColumn: 'col-abc123',
      workflow: 'in-progress',
      revision: 2,
      updatedAt: 50,
    }))
    expect(updated.title).toBe('看板列任务')
    expect(updated.archivedAt).toBeUndefined()

    // 重新读取（从磁盘重建聚合），确认列位置真正落盘
    const reloaded = repository.listTaskAggregateSummaries('ws-alpha').find((task) => task.taskId === taskId)
    expect(reloaded?.kanbanColumn).toBe('col-abc123')
    expect(reloaded?.workflow).toBe('in-progress')
  })

  test('updateTaskMetadata 空 patch（仅 kanbanColumn: undefined）应报错', () => {
    const workspaceRoot = createTempWorkspaceRoot()
    const repository = createRepository({ 'ws-alpha': workspaceRoot })
    const taskId = '018f47a8-6c26-7a13-9bf6-7c8d4f2e4c72'
    repository.saveTask('ws-alpha', buildSpec({ id: 'empty-patch-test', title: '空补丁' }))
    saveTaskRecord(workspaceRoot, {
      schemaVersion: 1,
      taskId,
      slug: 'empty-patch-test',
      revision: 1,
      workflow: 'todo',
      labelIds: [],
      createdAt: 1,
      updatedAt: 1,
    })

    expect(() => repository.updateTaskMetadata(
      'ws-alpha', taskId, { kanbanColumn: undefined },
    )).toThrow('Task metadata patch 不能为空')
  })

  test('按稳定 taskId 查找 TaskAggregate，并发现 record-only 恢复项', () => {
    const workspaceRoot = createTempWorkspaceRoot()
    const repository = createRepository({ 'ws-alpha': workspaceRoot })
    const taskId = '018f47a8-6c26-7a13-9bf6-7c8d4f2e4c72'
    saveTaskRecord(workspaceRoot, {
      schemaVersion: 1,
      taskId,
      slug: 'record-only',
      revision: 1,
      workflow: 'needs-review',
      labelIds: ['label-a'],
      createdAt: 1,
      updatedAt: 2,
    })

    expect(repository.getTaskAggregateById('ws-alpha', taskId)).toEqual(
      expect.objectContaining({
        taskId,
        taskSlug: 'record-only',
        spec: null,
        record: expect.objectContaining({ workflow: 'needs-review', labelIds: ['label-a'] }),
        legacyIdentity: false,
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: 'missing-task-spec', severity: 'error' }),
        ]),
      }),
    )
  })

  test('getRunState 聚合 snapshot、run-log 和 node output', () => {
    const repository = createRepository({ 'ws-alpha': createTempWorkspaceRoot() })
    const spec = buildSpec()

    repository.saveTask('ws-alpha', spec)
    repository.writeRunSpecSnapshot('ws-alpha', spec.id, 'run-1', spec)
    repository.appendRunLog('ws-alpha', spec.id, 'run-1', {
      t: '2026-07-13T00:00:00.000Z',
      kind: 'run-started',
      taskId: spec.id,
      runId: 'run-1',
    })
    repository.appendRunLog('ws-alpha', spec.id, 'run-1', {
      t: '2026-07-13T00:00:01.000Z',
      kind: 'node-scheduled',
      nodeId: 'draft',
    })
    repository.appendRunLog('ws-alpha', spec.id, 'run-1', {
      t: '2026-07-13T00:00:02.000Z',
      kind: 'node-spawned',
      nodeId: 'draft',
      sessionId: 'session-1',
    })
    repository.appendRunLog('ws-alpha', spec.id, 'run-1', {
      t: '2026-07-13T00:00:03.000Z',
      kind: 'node-finished',
      nodeId: 'draft',
      sessionId: 'session-1',
      state: 'done',
    })
    repository.writeNodeOutput('ws-alpha', spec.id, 'run-1', 'draft', {
      text: 'done',
      params: { summary: 'ok' },
    })

    expect(repository.listRuns('ws-alpha', spec.id)).toEqual(['run-1'])
    expect(repository.getRunState('ws-alpha', spec.id, 'run-1')).toEqual(
      expect.objectContaining({
        taskId: 'demo-task',
        runId: 'run-1',
        spec,
        log: expect.arrayContaining([
          expect.objectContaining({ kind: 'run-started' }),
          expect.objectContaining({ kind: 'node-finished', state: 'done' }),
        ]),
        nodeOutputs: {
          draft: {
            text: 'done',
            params: { summary: 'ok' },
          },
        },
        nodeStates: {
          draft: {
            attempt: 1,
            sessionId: 'session-1',
            state: 'done',
          },
        },
      }),
    )
  })

  test('live task.yaml 缺失时仍优先读取历史 Run snapshot', () => {
    const repository = createRepository({ 'ws-alpha': createTempWorkspaceRoot() })
    const spec = buildSpec({ id: 'historical-task', title: 'Historical snapshot' })

    repository.writeRunSpecSnapshot('ws-alpha', spec.id, 'run-snapshot', spec)
    repository.appendRunLog('ws-alpha', spec.id, 'run-snapshot', {
      t: '2026-07-13T00:05:00.000Z',
      kind: 'run-started',
      taskId: spec.id,
      runId: 'run-snapshot',
    })

    expect(repository.getTask('ws-alpha', spec.id)).toBeNull()
    expect(repository.getRunState('ws-alpha', spec.id, 'run-snapshot')).toEqual(
      expect.objectContaining({
        runId: 'run-snapshot',
        spec,
      }),
    )
  })

  test('getRunState 在 spec 缺失时也会从 run-log 节点事件恢复 nodeStates', () => {
    const repository = createRepository({ 'ws-alpha': createTempWorkspaceRoot() })

    repository.appendRunLog('ws-alpha', 'orphan-task', 'run-2', {
      t: '2026-07-13T00:10:00.000Z',
      kind: 'run-started',
      taskId: 'orphan-task',
      runId: 'run-2',
    })
    repository.appendRunLog('ws-alpha', 'orphan-task', 'run-2', {
      t: '2026-07-13T00:10:01.000Z',
      kind: 'node-scheduled',
      nodeId: 'draft',
    })
    repository.appendRunLog('ws-alpha', 'orphan-task', 'run-2', {
      t: '2026-07-13T00:10:02.000Z',
      kind: 'node-spawned',
      nodeId: 'draft',
      sessionId: 'session-2',
    })
    repository.appendRunLog('ws-alpha', 'orphan-task', 'run-2', {
      t: '2026-07-13T00:10:03.000Z',
      kind: 'node-finished',
      nodeId: 'draft',
      sessionId: 'session-2',
      state: 'done',
    })
    repository.appendRunLog('ws-alpha', 'orphan-task', 'run-2', {
      t: '2026-07-13T00:10:04.000Z',
      kind: 'node-retry',
      nodeId: 'retry-only',
      attempt: 2,
      reason: 'transient',
    })
    repository.writeNodeOutput('ws-alpha', 'orphan-task', 'run-2', 'draft', {
      text: 'recovered',
      params: { summary: 'rehydrated' },
    })

    expect(repository.getRunState('ws-alpha', 'orphan-task', 'run-2')).toEqual(
      expect.objectContaining({
        spec: null,
        nodeOutputs: {
          draft: {
            text: 'recovered',
            params: { summary: 'rehydrated' },
          },
        },
        nodeStates: {
          draft: {
            attempt: 1,
            sessionId: 'session-2',
            state: 'done',
          },
          'retry-only': {
            attempt: 0,
            state: 'pending',
          },
        },
      }),
    )
  })
})
