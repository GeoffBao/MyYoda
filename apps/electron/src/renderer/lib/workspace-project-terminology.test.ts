import { describe, expect, test } from 'bun:test'
import { PROJECT_TERMS, WORKSPACE_TERMS } from './workspace-project-terminology.ts'

describe('工作区与项目用户术语', () => {
  test('AgentWorkspace 只呈现为工作区，不再呈现为空间容器或项目', () => {
    expect(WORKSPACE_TERMS).toEqual({
      noun: '工作区',
      management: '工作区管理',
      create: '新建工作区',
      select: '选择工作区',
      rename: '重命名工作区',
      remove: '删除工作区',
      files: '工作区文件',
      memory: '工作区记忆',
    })
    expect(Object.values(WORKSPACE_TERMS).join('')).not.toContain('空间')
    expect(Object.values(WORKSPACE_TERMS).join('')).not.toContain('项目')
  })

  test('Craft Project 只呈现为项目，并明确实际目录是项目工作目录', () => {
    expect(PROJECT_TERMS).toEqual({
      noun: '项目',
      create: '新建项目',
      select: '选择项目',
      selectOrCreate: '选择/新建项目',
      clear: '清除项目',
      workingDirectory: '项目工作目录',
      files: '项目文件',
      knowledge: '项目知识',
    })
    expect(Object.values(PROJECT_TERMS).join('')).not.toContain('工作区')
  })
})
