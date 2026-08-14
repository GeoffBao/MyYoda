import { describe, expect, test } from 'bun:test'
import { buildTaskCardViewModel } from '../task-card-view-model'
import type { KanbanItem } from '../types'

function item(overrides: Partial<KanbanItem> = {}): KanbanItem {
  return {
    id: 'task-1',
    title: 'Fix startup',
    columnId: 'in-progress',
    session: {
      id: 'session-1',
      title: 'Fix startup',
      createdAt: 1,
      updatedAt: 2,
      sessionStatus: 'completed',
    },
    task: {
      taskId: 'task-1',
      taskSlug: 'fix-startup',
      workspaceId: 'workspace-1',
      scope: { kind: 'project', projectId: 'project-1' },
      workflow: 'in-progress',
      labelIds: ['label-a', 'label-b'],
      title: 'Fix startup',
      revision: 1,
      createdAt: 1,
      updatedAt: 2,
      diagnostics: [],
      runSummary: { total: 0, active: 0, completed: 0, failed: 0 },
      legacyIdentity: false,
    },
    project: { id: 'project-1', name: 'MyYoda' },
    subtasks: [],
    ...overrides,
  } as KanbanItem
}

describe('buildTaskCardViewModel', () => {
  test('把 Task labels 和 project 作为看板主信息，隐藏普通 completed session 状态', () => {
    expect(buildTaskCardViewModel(item())).toEqual(expect.objectContaining({
      projectName: 'MyYoda',
      labelIds: ['label-a', 'label-b'],
      showSessionStatus: false,
    }))
  })

  test('仅在运行、阻塞或失败时突出 Session 执行态', () => {
    expect(buildTaskCardViewModel(item({ session: { ...item().session, sessionStatus: 'running' } })).showSessionStatus).toBe(true)
    expect(buildTaskCardViewModel(item({ session: { ...item().session, sessionStatus: 'failed' } })).showSessionStatus).toBe(true)
    expect(buildTaskCardViewModel(item({ session: { ...item().session, sessionStatus: 'blocked' } })).showSessionStatus).toBe(true)
  })

  test('Workspace Task 使用明确归属，不伪装成缺失 Project', () => {
    const vm = buildTaskCardViewModel(item({
      project: null,
      task: { ...item().task!, scope: { kind: 'workspace' } },
    }))
    expect(vm.projectName).toBe('工作区')
  })

  test('跨工作区视图（scope=all）携带 workspaceName 时优先显示工作区名', () => {
    const vm = buildTaskCardViewModel(item({
      workspaceName: 'LuxAgents',
      project: null,
      task: { ...item().task!, scope: { kind: 'workspace' } },
    }))
    expect(vm.projectName).toBe('LuxAgents')
  })
})
