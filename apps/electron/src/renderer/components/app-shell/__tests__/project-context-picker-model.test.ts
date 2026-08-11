import { describe, expect, test } from 'bun:test'
import {
  allowsSkipProject,
  buildPickerSections,
  shouldHonorBrowseRequest,
  type PickerProject,
} from '../project-context-picker-model.ts'

const projects: PickerProject[] = [
  { id: 'p1', name: 'Alpha', workingDirectory: '/repos/alpha', updatedAt: '2026-07-20T10:00:00.000Z' },
  { id: 'p2', name: 'Beta', workingDirectory: '/repos/beta', updatedAt: '2026-07-21T10:00:00.000Z' },
  { id: 'p3', name: 'Archived', workingDirectory: '/repos/old', updatedAt: '2026-07-01T10:00:00.000Z', archivedAt: '2026-07-10T00:00:00.000Z' },
]

describe('project-context-picker-model', () => {
  test('allowsSkipProject：会话可跳过，任务不可', () => {
    expect(allowsSkipProject('session')).toBe(true)
    expect(allowsSkipProject('task')).toBe(false)
  })

  test('session 可清除项目；task 首屏不显示 Workspace Task 入口', () => {
    const session = buildPickerSections({
      mode: 'session',
      projects,
      recentProjectIds: ['p2'],
      selectedProjectId: 'p2',
    })
    expect(session.actions.map((a) => a.id)).toContain('skip')

    const task = buildPickerSections({
      mode: 'task',
      projects,
      recentProjectIds: ['p2'],
      selectedProjectId: 'p2',
    })
    expect(task.actions.map((a) => a.id)).not.toContain('skip')
    expect(task.actions.map((a) => a.id)).not.toContain('workspace-task')
  })

  test('项目选择器动作使用项目术语，不把 Craft Project 称为工作区', () => {
    const sections = buildPickerSections({
      mode: 'session',
      projects,
      recentProjectIds: [],
      selectedProjectId: 'p1',
    })

    expect(sections.actions).toEqual([
      { id: 'create', label: '新建项目…' },
      { id: 'browse', label: '使用现有项目文件夹…' },
      { id: 'skip', label: '清除项目' },
    ])
    expect(sections.actions.map((action) => action.label).join('')).not.toContain('工作区')
  })

  test('projects：最近使用的排前面，不与其余项目重复', () => {
    const sections = buildPickerSections({
      mode: 'session',
      projects,
      recentProjectIds: ['p2'],
    })
    // p2 只出现一次（排在最前），p1 紧随其后，归档项目 p3 不出现
    expect(sections.projects.map((p) => p.id)).toEqual(['p2', 'p1'])
  })

  test('projects：无最近使用记录时按项目自身 updatedAt 倒序', () => {
    const sections = buildPickerSections({
      mode: 'session',
      projects,
      recentProjectIds: [],
    })
    expect(sections.projects.map((p) => p.id)).toEqual(['p2', 'p1'])
  })

  test('skip 动作只在已绑定项目时出现：未绑定时清除跟直接关闭没区别，不占位', () => {
    const unbound = buildPickerSections({
      mode: 'session',
      projects,
      recentProjectIds: ['p2'],
    })
    expect(unbound.actions.map((a) => a.id)).not.toContain('skip')

    const bound = buildPickerSections({
      mode: 'session',
      projects,
      recentProjectIds: ['p2'],
      selectedProjectId: 'p1',
    })
    expect(bound.actions.map((a) => a.id)).toContain('skip')
  })

  test('shouldHonorBrowseRequest：挂载时不回放历史 token', () => {
    const mounted = shouldHonorBrowseRequest({ browseRequest: 3, baseline: null })
    expect(mounted.honor).toBe(false)
    expect(mounted.nextBaseline).toBe(3)

    const same = shouldHonorBrowseRequest({ browseRequest: 3, baseline: 3 })
    expect(same.honor).toBe(false)

    const bumped = shouldHonorBrowseRequest({ browseRequest: 4, baseline: 3 })
    expect(bumped.honor).toBe(true)
    expect(bumped.nextBaseline).toBe(4)

    const zero = shouldHonorBrowseRequest({ browseRequest: 0, baseline: 3 })
    expect(zero.honor).toBe(false)
    expect(zero.nextBaseline).toBe(0)
  })
})
