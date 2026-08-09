import { describe, expect, test } from 'bun:test'
import { filterPickableKanbanProjects, isHiddenKanbanProjectKind, type KanbanProject } from '../types'

function project(id: string, kind?: KanbanProject['kind']): KanbanProject {
  return { id, name: id, ...(kind ? { kind } : {}) }
}

describe('isHiddenKanbanProjectKind', () => {
  test('历史遗留 home/ad-hoc kind 仍判定为隐藏（存量 config 兼容）', () => {
    expect(isHiddenKanbanProjectKind('home')).toBe(true)
    expect(isHiddenKanbanProjectKind('ad-hoc')).toBe(true)
  })

  test('project 和 undefined 判定为非隐藏', () => {
    expect(isHiddenKanbanProjectKind('project')).toBe(false)
    expect(isHiddenKanbanProjectKind(undefined)).toBe(false)
  })
})

describe('filterPickableKanbanProjects', () => {
  test('排除历史隐藏容器 Project，保留真实 Project 与缺省 kind 的旧数据', () => {
    const projects = [project('p1'), project('p2', 'project'), project('home-1', 'home'), project('adhoc-1', 'ad-hoc')]
    expect(filterPickableKanbanProjects(projects).map((p) => p.id)).toEqual(['p1', 'p2'])
  })
})
