import { describe, expect, test } from 'bun:test'
import type { AgentSessionMeta, TaskAggregateSummary } from '@myyoda/shared'
import {
  buildKanbanViewModel,
  deriveSubtaskRunState,
  type KanbanProject,
  type KanbanTaskRun,
  type TeambitionBinding,
} from '../kanban-view-model'

function createSession(overrides: Partial<AgentSessionMeta>): AgentSessionMeta {
  return {
    id: 'session-default',
    title: '默认会话',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

const projects: KanbanProject[] = [
  { id: 'project-a', name: '项目 A' },
  { id: 'project-b', name: '项目 B' },
]

function createTask(overrides: Partial<TaskAggregateSummary>): TaskAggregateSummary {
  return {
    taskId: '11111111-1111-4111-8111-111111111111',
    taskSlug: 'default-task',
    title: '默认 Task',
    scope: { kind: 'workspace' },
    workflow: 'todo',
    labelIds: [],
    runCount: 0,
    legacyIdentity: false,
    health: 'ready',
    diagnostics: [],
    ...overrides,
  }
}

describe('buildKanbanViewModel', () => {
  test('正式模式只投影 TaskRepository summaries，并以 stable taskId 为卡片身份', () => {
    const taskId = '22222222-2222-4222-8222-222222222222'
    const model = buildKanbanViewModel({
      projects,
      tasks: [createTask({
        taskId,
        taskSlug: 'workspace-release',
        title: 'Workspace 发布任务',
        workflow: 'needs-review',
        orchestratorSessionId: 'task-session',
        updatedAt: 50,
      })],
      sessions: [
        createSession({ id: 'plain-session', title: '普通聊天', updatedAt: 60 }),
        createSession({ id: 'task-session', title: '旧会话标题', taskSlug: 'workspace-release', updatedAt: 40 }),
      ],
      runs: [],
      bindings: [],
      filter: { projectId: null },
    })

    expect(model.listItems).toHaveLength(1)
    expect(model.listItems[0]).toEqual(expect.objectContaining({
      id: taskId,
      title: 'Workspace 发布任务',
      columnId: 'needs-review',
      hasSession: true,
    }))
    expect(model.listItems[0]?.task?.taskSlug).toBe('workspace-release')
  })

  test('Task 自带 kanbanColumn 时优先于 workflow 推导的默认列', () => {
    const taskId = '22222222-2222-4222-8222-222222222222'
    const model = buildKanbanViewModel({
      projects,
      tasks: [createTask({
        taskId,
        taskSlug: 'custom-column-task',
        title: '自定义列任务',
        workflow: 'in-progress',
        // 独立于状态徽标的列位置：卡片应落在 col-design 而不是「进行中」
        kanbanColumn: 'col-design',
        updatedAt: 50,
      })],
      sessions: [],
      runs: [],
      bindings: [],
      filter: { projectId: null },
    })

    expect(model.listItems).toHaveLength(1)
    expect(model.listItems[0]).toEqual(expect.objectContaining({
      id: taskId,
      title: '自定义列任务',
      columnId: 'col-design',
    }))
    expect(model.listItems[0]?.task?.workflow).toBe('in-progress')
  })

  test('没有 orchestrator Session 的恢复项仍显示诊断卡片，Project facet 来自 Task scope', () => {
    const taskId = '33333333-3333-4333-8333-333333333333'
    const model = buildKanbanViewModel({
      projects,
      tasks: [createTask({
        taskId,
        taskSlug: 'recovered-task',
        title: '待恢复 Task',
        scope: { kind: 'project', projectId: 'project-a' },
        health: 'warning',
        diagnostics: [{ code: 'missing-session', severity: 'warning', message: '缺少 Session' }],
      })],
      sessions: [],
      runs: [],
      bindings: [],
      filter: { projectId: 'project-a' },
    })

    expect(model.listItems).toHaveLength(1)
    expect(model.listItems[0]).toEqual(expect.objectContaining({
      id: taskId,
      hasSession: false,
      project: expect.objectContaining({ id: 'project-a' }),
    }))
  })

  test('scope 明确区分全部、Workspace Task 与指定 Project', () => {
    const tasks = [
      createTask({ taskId: 'workspace-task', taskSlug: 'workspace-task' }),
      createTask({ taskId: 'project-a-task', taskSlug: 'project-a-task', scope: { kind: 'project', projectId: 'project-a' } }),
      createTask({ taskId: 'project-b-task', taskSlug: 'project-b-task', scope: { kind: 'project', projectId: 'project-b' } }),
    ]
    const base = { projects, tasks, sessions: [], runs: [], bindings: [] }

    expect(buildKanbanViewModel({ ...base, filter: { scope: { kind: 'all' } } }).listItems.map((item) => item.id)).toHaveLength(3)
    expect(buildKanbanViewModel({ ...base, filter: { scope: { kind: 'workspace' } } }).listItems.map((item) => item.id)).toEqual(['workspace-task'])
    expect(buildKanbanViewModel({ ...base, filter: { scope: { kind: 'project', projectId: 'project-a' } } }).listItems.map((item) => item.id)).toEqual(['project-a-task'])
  })

  test('Workflow facet 无需选择 Label 也能独立生效', () => {
    const model = buildKanbanViewModel({
      projects,
      tasks: [
        createTask({ taskId: 'todo-task', taskSlug: 'todo-task', workflow: 'todo' }),
        createTask({ taskId: 'review-task', taskSlug: 'review-task', workflow: 'needs-review' }),
      ],
      sessions: [],
      runs: [],
      bindings: [],
      filter: { scope: { kind: 'all' }, workflow: 'needs-review', labelIds: [] },
    })

    expect(model.listItems.map((item) => item.id)).toEqual(['review-task'])
  })

  test('Label facet 内为 OR，并与 scope/workflow 做 AND', () => {
    const model = buildKanbanViewModel({
      projects,
      tasks: [
        createTask({ taskId: 'match-a', taskSlug: 'match-a', workflow: 'todo', labelIds: ['label-a'] }),
        createTask({ taskId: 'match-b', taskSlug: 'match-b', workflow: 'todo', labelIds: ['label-b', 'other'] }),
        createTask({ taskId: 'wrong-workflow', taskSlug: 'wrong-workflow', workflow: 'done', labelIds: ['label-a'] }),
        createTask({ taskId: 'wrong-scope', taskSlug: 'wrong-scope', scope: { kind: 'project', projectId: 'project-a' }, workflow: 'todo', labelIds: ['label-a'] }),
      ],
      sessions: [],
      runs: [],
      bindings: [],
      filter: {
        scope: { kind: 'workspace' },
        workflow: 'todo',
        labelIds: ['label-a', 'label-b'],
        includeUnlabeled: false,
      },
    })

    expect(model.listItems.map((item) => item.id)).toEqual(['match-a', 'match-b'])
  })

  test('无标签可单独筛选；默认不会混入无标签 Task', () => {
    const tasks = [
      createTask({ taskId: 'labeled', taskSlug: 'labeled', labelIds: ['label-a'] }),
      createTask({ taskId: 'unlabeled', taskSlug: 'unlabeled', labelIds: [] }),
    ]
    const base = { projects, tasks, sessions: [], runs: [], bindings: [] }

    expect(buildKanbanViewModel({
      ...base,
      filter: { scope: { kind: 'all' }, labelIds: [], includeUnlabeled: true },
    }).listItems.map((item) => item.id)).toEqual(['unlabeled'])
    expect(buildKanbanViewModel({
      ...base,
      filter: { scope: { kind: 'all' }, labelIds: ['label-a'] },
    }).listItems.map((item) => item.id)).toEqual(['labeled'])
  })

  test('未显式拖放的新会话默认落入待办列（不做收件箱 triage）', () => {
    const model = buildKanbanViewModel({
      projects,
      sessions: [createSession({ id: 'fresh-session', title: '整理需求', updatedAt: 30 })],
      runs: [],
      bindings: [],
      filter: { projectId: null },
    })

    expect(model.listItems).toEqual([
      expect.objectContaining({ id: 'fresh-session', columnId: 'todo', project: null }),
    ])
  })

  test('为任务会话派生节点进度', () => {
    const runs: KanbanTaskRun[] = [
      {
        taskSlug: 'release',
        runId: 'run-1',
        nodeStates: { build: 'done', verify: 'running', publish: 'pending' },
      },
    ]

    const model = buildKanbanViewModel({
      projects,
      sessions: [createSession({
        id: 'task-session',
        taskSlug: 'release',
        taskRunId: 'run-1',
        taskNodeCount: 3,
        updatedAt: 20,
      })],
      runs,
      bindings: [],
      filter: { projectId: null },
    })

    expect(model.listItems[0]?.taskRun).toEqual({ completedNodes: 1, totalNodes: 3 })
    expect(model.listItems[0]?.subtasks.map((row) => row.title)).toEqual(['build', 'verify', 'publish'])
    expect(model.listItems[0]?.subtasks.map((row) => row.runState)).toEqual(['done', 'running', 'pending'])
  })

  test('合并 child session 与 spec nodes 为子任务行', () => {
    const model = buildKanbanViewModel({
      projects,
      sessions: [
        createSession({ id: 'parent', title: '主任务', taskSlug: 'release', updatedAt: 40 }),
        createSession({
          id: 'child-1',
          title: '构建',
          parentSessionId: 'parent',
          taskNodeId: 'build',
          sessionStatus: 'done',
          modelId: 'm1',
          updatedAt: 39,
        }),
      ],
      runs: [],
      bindings: [],
      filter: { projectId: null },
      specNodesBySlug: new Map([
        ['release', [
          { id: 'build', title: '构建' },
          { id: 'verify', title: '验证' },
        ]],
      ]),
    })

    expect(model.listItems[0]?.subtasks).toEqual([
      expect.objectContaining({ id: 'child-1', title: '构建', runState: 'done', sessionId: 'child-1' }),
      expect.objectContaining({ id: 'node:verify', title: '验证', runState: 'pending' }),
    ])
  })

  test('无 Project 会话 project 为 null，不再懒归类到历史隐藏容器', () => {
    // 即使 projects 里存在历史 ad-hoc 隐藏容器，未绑定会话也不再懒归类到它
    const projectsWithLegacyAdHoc: KanbanProject[] = [
      ...projects,
      { id: 'ad-hoc-1', name: '临时会话', kind: 'ad-hoc' },
    ]
    const model = buildKanbanViewModel({
      projects: projectsWithLegacyAdHoc,
      sessions: [
        createSession({ id: 'no-project', title: '未绑定项目的会话' }),
        createSession({ id: 'has-project', title: '已绑定项目的会话', projectId: 'project-a' }),
      ],
      runs: [],
      bindings: [],
      filter: {},
    })

    expect(model.listItems.find((item) => item.id === 'no-project')?.project).toBeNull()
    expect(model.listItems.find((item) => item.id === 'has-project')?.project?.id).toBe('project-a')
  })

  test('未提供隐藏容器 Project 时无 Project 会话仍展示为 null（向后兼容旧调用方）', () => {
    const model = buildKanbanViewModel({
      projects,
      sessions: [createSession({ id: 'no-project', title: '未绑定项目的会话' })],
      runs: [],
      bindings: [],
      filter: {},
    })

    expect(model.listItems.find((item) => item.id === 'no-project')?.project).toBeNull()
  })

  test('按项目筛选时排除其他项目的会话', () => {
    const model = buildKanbanViewModel({
      projects,
      sessions: [
        createSession({ id: 'project-a-session', projectId: 'project-a', updatedAt: 30 }),
        createSession({ id: 'project-b-session', projectId: 'project-b', updatedAt: 20 }),
      ],
      runs: [],
      bindings: [],
      filter: { projectId: 'project-a' },
    })

    expect(model.listItems.map((item) => item.id)).toEqual(['project-a-session'])
  })

  test('列表与看板使用相同的卡片顺序和派生的 Teambition 字段', () => {
    const bindings: TeambitionBinding[] = [
      {
        bindingId: 'binding-1',
        sessionId: 'bound-session',
        taskId: 'TW-1',
        title: '同步状态',
        status: 'coding',
        syncState: 'pending',
      },
    ]
    const model = buildKanbanViewModel({
      projects,
      sessions: [
        createSession({ id: 'older-session', updatedAt: 10 }),
        createSession({ id: 'bound-session', updatedAt: 40 }),
        createSession({ id: 'middle-session', updatedAt: 20 }),
      ],
      runs: [],
      bindings,
      filter: { projectId: null },
    })

    expect(model.boardItems.map((item) => item.id)).toEqual(model.listItems.map((item) => item.id))
    expect(model.listItems[0]?.teambition).toEqual({
      bindingId: 'binding-1',
      taskId: 'TW-1',
      title: '同步状态',
      status: 'coding',
      syncState: 'pending',
    })
  })

  test('顶层看板排除归档、生成草稿和子会话', () => {
    const model = buildKanbanViewModel({
      projects,
      sessions: [
        createSession({ id: 'visible-session', updatedAt: 50 }),
        createSession({ id: 'archived-session', archived: true, updatedAt: 40 }),
        createSession({ id: 'draft-session', taskDraft: true, updatedAt: 30 }),
        createSession({ id: 'child-session', parentSessionId: 'visible-session', updatedAt: 20 }),
      ],
      runs: [],
      bindings: [],
      filter: { projectId: null },
    })

    expect(model.listItems.map((item) => item.id)).toEqual(['visible-session'])
  })

  test('解析任务专家优先于项目默认专家', () => {
    const model = buildKanbanViewModel({
      projects: [{ id: 'project-a', name: '项目 A', defaultExpertId: 'general' }],
      sessions: [createSession({
        id: 'task-session',
        projectId: 'project-a',
        taskSlug: 'release',
        updatedAt: 20,
      })],
      runs: [],
      bindings: [],
      filter: { projectId: null },
      expertIdsBySlug: new Map([['release', 'architect']]),
    })

    expect(model.listItems[0]?.expertId).toBe('architect')
  })

  test('任务未设专家时回退项目默认', () => {
    const model = buildKanbanViewModel({
      projects: [{ id: 'project-a', name: '项目 A', defaultExpertId: 'driver' }],
      sessions: [createSession({
        id: 'task-session',
        projectId: 'project-a',
        taskSlug: 'release',
        updatedAt: 20,
      })],
      runs: [],
      bindings: [],
      filter: { projectId: null },
    })

    expect(model.listItems[0]?.expertId).toBe('driver')
  })
})

describe('deriveSubtaskRunState', () => {
  test('needs-review 不成 failed', () => {
    expect(deriveSubtaskRunState(createSession({ sessionStatus: 'needs-review' }))).toBe('needs-review')
  })

  test('failed 与用户中断仍为 failed', () => {
    expect(deriveSubtaskRunState(createSession({ sessionStatus: 'failed' }))).toBe('failed')
    expect(deriveSubtaskRunState(createSession({ stoppedByUser: true, sessionStatus: 'running' }))).toBe('failed')
  })
})
