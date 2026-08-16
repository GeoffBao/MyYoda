import { describe, expect, test } from 'bun:test'
import type { AgentSessionMeta } from '@myyoda/shared'
import {
  buildAgentSessionTrees,
  getSessionTreeActivityAt,
  getSessionTreeCustomGroupId,
  getSessionTreeProgress,
  getSessionTreeProjectId,
  getSessionTreeStatus,
  sortSessionTrees,
  treeContainsSessionId,
} from '../sidebar-session-tree'

function session(id: string, overrides: Partial<AgentSessionMeta> = {}): AgentSessionMeta {
  return {
    id,
    title: id,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('buildAgentSessionTrees', () => {
  test('Task 与 collaboration 子会话进入同一父会话树', () => {
    const trees = buildAgentSessionTrees([
      session('task-child', { parentSessionId: 'parent', taskSlug: 'release', taskNodeId: 'build' }),
      session('parent', { taskSlug: 'release' }),
      session('delegated-child', { parentSessionId: 'parent', sourceDelegationId: 'delegation-1' }),
    ])

    expect(trees).toHaveLength(1)
    expect(trees[0]?.session.id).toBe('parent')
    expect(trees[0]?.childSessions.map((child) => child.id)).toEqual(['task-child', 'delegated-child'])
  })

  test('父会话缺失时子会话退化为根行，不会消失', () => {
    const trees = buildAgentSessionTrees([
      session('orphan', { parentSessionId: 'missing', taskNodeId: 'build' }),
    ])

    expect(trees.map((tree) => tree.session.id)).toEqual(['orphan'])
  })

  test('委派子会话的父会话尚未到达时暂不渲染为根，避免父会话到达后重复/闪烁', () => {
    const trees = buildAgentSessionTrees([
      session('delegated-orphan', { parentSessionId: 'missing', sourceDelegationId: 'delegation-1' }),
      session('normal'),
    ])

    expect(trees.map((tree) => tree.session.id)).toEqual(['normal'])
  })

  test('委派子会话父会话到达后，正常挂载为子节点（非孤儿场景不受影响）', () => {
    const trees = buildAgentSessionTrees([
      session('delegated-child', { parentSessionId: 'parent', sourceDelegationId: 'delegation-1' }),
      session('parent'),
    ])

    expect(trees.map((tree) => tree.session.id)).toEqual(['parent'])
    expect(trees[0]?.childSessions.map((child) => child.id)).toEqual(['delegated-child'])
  })

  test('可见父节点的上层祖先被过滤时，后代仍挂到最近可见父节点', () => {
    const trees = buildAgentSessionTrees([
      session('child', { parentSessionId: 'filtered-root' }),
      session('grandchild', { parentSessionId: 'child' }),
    ])

    expect(trees.map((tree) => tree.session.id)).toEqual(['child'])
    expect(trees[0]?.childSessions.map((child) => child.id)).toEqual(['grandchild'])
  })

  test('超过一层的后代扁平收纳到根任务，保证当前单层 UI 可见', () => {
    const trees = buildAgentSessionTrees([
      session('root'),
      session('child', { parentSessionId: 'root' }),
      session('grandchild', { parentSessionId: 'child' }),
    ])

    expect(trees).toHaveLength(1)
    expect(trees[0]?.childSessions.map((child) => child.id)).toEqual(['child', 'grandchild'])
  })

  test('隐藏 taskDraft 草稿会话及其意外产生的后代，避免生成阶段污染侧边栏', () => {
    const trees = buildAgentSessionTrees([
      session('draft', { taskDraft: true }),
      session('child', { parentSessionId: 'draft', sourceDelegationId: 'd1' }),
      session('grandchild', { parentSessionId: 'child' }),
      session('normal'),
    ])

    expect(trees.map((tree) => tree.session.id)).toEqual(['normal'])
  })
})

describe('session tree aggregates', () => {
  test('聚合状态遵循 blocked > running > completed > idle', () => {
    const [tree] = buildAgentSessionTrees([
      session('parent'),
      session('running-child', { parentSessionId: 'parent' }),
      session('blocked-child', { parentSessionId: 'parent' }),
    ])
    const indicators = new Map([
      ['parent', 'completed' as const],
      ['running-child', 'running' as const],
      ['blocked-child', 'blocked' as const],
    ])

    expect(getSessionTreeStatus(tree!, indicators)).toBe('blocked')
  })

  test('任务族活跃时间取父子会话最大 updatedAt', () => {
    const [tree] = buildAgentSessionTrees([
      session('parent', { updatedAt: 10 }),
      session('child', { parentSessionId: 'parent', updatedAt: 30 }),
    ])

    expect(getSessionTreeActivityAt(tree!)).toBe(30)
  })

  test('根未绑定项目/分组时回退最近子会话，根绑定值始终优先', () => {
    const [fallbackTree] = buildAgentSessionTrees([
      session('parent'),
      session('older', { parentSessionId: 'parent', projectId: 'p-old', customGroupId: 'g-old', updatedAt: 10 }),
      session('newer', { parentSessionId: 'parent', projectId: 'p-new', customGroupId: 'g-new', updatedAt: 20 }),
    ])
    const [rootBoundTree] = buildAgentSessionTrees([
      session('bound-parent', { projectId: 'p-root', customGroupId: 'g-root' }),
      session('child', { parentSessionId: 'bound-parent', projectId: 'p-child', customGroupId: 'g-child' }),
    ])

    expect(getSessionTreeProjectId(fallbackTree!)).toBe('p-new')
    expect(getSessionTreeCustomGroupId(fallbackTree!)).toBe('g-new')
    expect(getSessionTreeProjectId(rootBoundTree!)).toBe('p-root')
    expect(getSessionTreeCustomGroupId(rootBoundTree!)).toBe('g-root')
  })

  test('sortBy 同时作用于根任务与子会话', () => {
    const trees = buildAgentSessionTrees([
      session('parent-b', { title: 'B' }),
      session('child-z', { title: 'Z', parentSessionId: 'parent-b' }),
      session('child-a', { title: 'A', parentSessionId: 'parent-b' }),
      session('parent-a', { title: 'A' }),
    ])
    const sorted = sortSessionTrees(trees, 'alphabetical')

    expect(sorted.map((tree) => tree.session.id)).toEqual(['parent-a', 'parent-b'])
    expect(sorted[1]?.childSessions.map((child) => child.id)).toEqual(['child-a', 'child-z'])
  })

  test('Task 重跑按 taskNodeId 取最新会话计算进度，避免出现 3/2', () => {
    const [tree] = buildAgentSessionTrees([
      session('parent', { taskSlug: 'release', taskNodeCount: 2 }),
      session('build-old', {
        parentSessionId: 'parent', taskSlug: 'release', taskNodeId: 'build',
        createdAt: 10, sessionStatus: 'done',
      }),
      session('build-new', {
        parentSessionId: 'parent', taskSlug: 'release', taskNodeId: 'build',
        createdAt: 20, sessionStatus: 'in-progress',
      }),
      session('test', {
        parentSessionId: 'parent', taskSlug: 'release', taskNodeId: 'test',
        createdAt: 15, sessionStatus: 'done',
      }),
    ])

    expect(getSessionTreeProgress(tree!, new Map())).toEqual({ completed: 1, total: 2 })
  })

  test('普通协作树按直接子会话完成态计数', () => {
    const [tree] = buildAgentSessionTrees([
      session('parent'),
      session('done', { parentSessionId: 'parent', sourceDelegationId: 'd1', delegationStatus: 'completed' }),
      session('running', { parentSessionId: 'parent', sourceDelegationId: 'd2', delegationStatus: 'running' }),
    ])

    expect(getSessionTreeProgress(tree!, new Map())).toEqual({ completed: 1, total: 2 })
    expect(treeContainsSessionId(tree!, 'running')).toBe(true)
  })
})
