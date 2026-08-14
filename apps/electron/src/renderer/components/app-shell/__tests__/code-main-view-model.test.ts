import { describe, expect, test } from 'bun:test'
import {
  buildProjectPageNavigation,
  buildTaskBoardNavigation,
  isLegacyCoworkMode,
  isOverlayActiveView,
  normalizeAppModeForUi,
  resolveCodeMainRoute,
  shouldShowWorkViewInCode,
} from '../code-main-view-model'

describe('normalizeAppModeForUi / isLegacyCoworkMode', () => {
  test('cowork 归一为 agent，并标记为遗留模式', () => {
    expect(normalizeAppModeForUi('cowork')).toBe('agent')
    expect(isLegacyCoworkMode('cowork')).toBe(true)
  })

  test('chat / agent / scratch 保持原样', () => {
    expect(normalizeAppModeForUi('chat')).toBe('chat')
    expect(normalizeAppModeForUi('agent')).toBe('agent')
    expect(normalizeAppModeForUi('scratch')).toBe('scratch')
    expect(isLegacyCoworkMode('agent')).toBe(false)
  })
})

describe('Task Board / Project Page navigation', () => {
  test('Project Page 是独立主区路由，不会被 Task Board 分支吞掉', () => {
    expect(resolveCodeMainRoute({
      appMode: 'agent',
      codeMainView: 'project',
      activeView: 'conversations',
    })).toBe('project-page')
    expect(resolveCodeMainRoute({
      appMode: 'agent',
      codeMainView: 'tasks',
      activeView: 'conversations',
    })).toBe('task-board')
  })

  test('覆盖视图优先于 Project Page 路由', () => {
    expect(resolveCodeMainRoute({
      appMode: 'agent',
      codeMainView: 'project',
      activeView: 'planning',
    })).toBe('overlay')
  })

  test('Project Page 默认打开概览，而不是直接进入 Knowledge 编辑器', () => {
    expect(buildProjectPageNavigation('project-alpha')).toEqual(expect.objectContaining({
      activeProjectPageId: 'project-alpha',
      projectPageTab: 'overview',
    }))
  })

  test('打开 Project Page 只设置页面身份，不复用 Task Board project facet', () => {
    expect(buildProjectPageNavigation('project-alpha', 'assets')).toEqual({
      codeMainView: 'project',
      activeView: 'conversations',
      activeProjectPageId: 'project-alpha',
      projectPageTab: 'assets',
    })
  })

  test('从 Project Page 返回 Task Board 时保留正确 project facet', () => {
    expect(buildTaskBoardNavigation('project-alpha')).toEqual({
      codeMainView: 'tasks',
      activeView: 'conversations',
      selectedProjectId: 'project-alpha',
    })
    expect(buildTaskBoardNavigation(null)).toEqual({
      codeMainView: 'tasks',
      activeView: 'conversations',
      selectedProjectId: null,
    })
  })
})

describe('shouldShowWorkViewInCode', () => {
  test('agent 模式 + tasks 视图 + conversations → 显示正式 Project 看板', () => {
    expect(shouldShowWorkViewInCode({
      appMode: 'agent',
      codeMainView: 'tasks',
      activeView: 'conversations',
    })).toBe(true)
  })

  test('遗留 work 仍作为 Project 看板兼容 alias', () => {
    expect(shouldShowWorkViewInCode({
      appMode: 'agent',
      codeMainView: 'work',
      activeView: 'conversations',
    })).toBe(true)
  })

  test('agent 模式默认 session 视图不显示', () => {
    expect(shouldShowWorkViewInCode({
      appMode: 'agent',
      codeMainView: 'session',
      activeView: 'conversations',
    })).toBe(false)
  })

  test('planning / agent-skills 覆盖视图优先，让位', () => {
    expect(shouldShowWorkViewInCode({
      appMode: 'agent',
      codeMainView: 'work',
      activeView: 'planning',
    })).toBe(false)
    expect(shouldShowWorkViewInCode({
      appMode: 'agent',
      codeMainView: 'work',
      activeView: 'agent-skills',
    })).toBe(false)
  })

  test('agent-skills（Agent 插件）作为覆盖视图', () => {
    expect(shouldShowWorkViewInCode({
      appMode: 'agent',
      codeMainView: 'work',
      activeView: 'agent-skills',
    })).toBe(false)
  })

  test('非 agent 模式不经过此判定（遗留 cowork 由启动迁移处理）', () => {
    expect(shouldShowWorkViewInCode({
      appMode: 'cowork',
      codeMainView: 'work',
      activeView: 'conversations',
    })).toBe(false)
    expect(shouldShowWorkViewInCode({
      appMode: 'chat',
      codeMainView: 'work',
      activeView: 'conversations',
    })).toBe(false)
  })
})

describe('isOverlayActiveView', () => {
  test('isOverlayActiveView 识别覆盖视图（planning / agent-skills）', () => {
    expect(isOverlayActiveView('conversations')).toBe(false)
    expect(isOverlayActiveView('planning')).toBe(true)
    expect(isOverlayActiveView('agent-skills')).toBe(true)
  })
})
