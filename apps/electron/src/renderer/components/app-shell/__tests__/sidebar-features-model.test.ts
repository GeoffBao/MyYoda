import { describe, expect, test } from 'bun:test'
import { FEATURE_ITEM_KINDS, isFeatureItemActive, anyFeatureActive, type FeatureViewContext } from '../sidebar-features-model'

const ctx = (overrides: Partial<FeatureViewContext> = {}): FeatureViewContext => ({
  activeView: 'conversations',
  mode: 'agent',
  codeMainView: 'session',
  ...overrides,
})

describe('isFeatureItemActive', () => {
  test('Given 计划视图激活 When 判定 planning Then true', () => {
    expect(isFeatureItemActive('planning', ctx({ activeView: 'planning' }))).toBe(true)
  })
  test('Given 看板视图激活（agent + tasks + conversations）When 判定 board Then true', () => {
    expect(isFeatureItemActive('board', ctx({ codeMainView: 'tasks' }))).toBe(true)
  })
  test('Given chat 模式 tasks 主视图 When 判定 board Then false（看板仅 agent）', () => {
    expect(isFeatureItemActive('board', ctx({ mode: 'chat', codeMainView: 'tasks' }))).toBe(false)
  })
  test('Given 画布 gallery 激活 When 判定 canvas Then true', () => {
    expect(isFeatureItemActive('canvas', ctx({ activeView: 'excalidraw-gallery' }))).toBe(true)
    expect(isFeatureItemActive('canvas', ctx({ activeView: 'excalidraw-editor' }))).toBe(true)
  })
  test('Given 插件视图激活 When 判定 skills Then true', () => {
    expect(isFeatureItemActive('skills', ctx({ activeView: 'agent-skills' }))).toBe(true)
  })
  test('Given 知识库视图激活 When 判定 wiki Then true', () => {
    expect(isFeatureItemActive('wiki', ctx({ activeView: 'repo-wiki' }))).toBe(true)
  })
  test('Given 普通会话视图 When 判定任意 kind Then false', () => {
    for (const kind of FEATURE_ITEM_KINDS) {
      expect(isFeatureItemActive(kind, ctx())).toBe(false)
    }
  })
})

describe('anyFeatureActive', () => {
  test('Given 任一功能视图激活 When 聚合判定 Then true', () => {
    expect(anyFeatureActive(ctx({ activeView: 'planning' }))).toBe(true)
    expect(anyFeatureActive(ctx({ codeMainView: 'tasks' }))).toBe(true)
    expect(anyFeatureActive(ctx({ activeView: 'excalidraw-editor' }))).toBe(true)
  })
  test('Given 无功能视图激活（含 discover 视图）When 聚合判定 Then false', () => {
    expect(anyFeatureActive(ctx())).toBe(false)
    expect(anyFeatureActive(ctx({ activeView: 'discover' }))).toBe(false)
  })
})
