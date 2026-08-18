import { describe, expect, test } from 'bun:test'
import {
  findRecallableDraftSession,
  resolveCreateAgentWorkspaceId,
  resolveDefaultProjectId,
  shouldMarkDraft,
  type DraftSessionCandidate,
  type ProjectRecencyCandidate,
} from '../create-agent-session-flow.ts'

describe('create-agent-session-flow', () => {
  test('draft 默认 true，显式 false 才关闭', () => {
    expect(shouldMarkDraft({})).toBe(true)
    expect(shouldMarkDraft({ draft: true })).toBe(true)
    expect(shouldMarkDraft({ draft: false })).toBe(false)
  })

  test('workspaceId 优先于当前工作区', () => {
    expect(resolveCreateAgentWorkspaceId({ workspaceId: 'ws-b' }, 'ws-a')).toBe('ws-b')
    expect(resolveCreateAgentWorkspaceId({}, 'ws-a')).toBe('ws-a')
    expect(resolveCreateAgentWorkspaceId({}, null)).toBeUndefined()
  })
})

describe('findRecallableDraftSession', () => {
  const base: DraftSessionCandidate[] = [
    { id: 'a', title: '新 Agent 会话', workspaceId: 'ws-1', createdAt: 100 },
    { id: 'b', title: '新 Agent 会话', workspaceId: 'ws-1', createdAt: 200 },
    { id: 'c', title: '新 Agent 会话', workspaceId: 'ws-2', createdAt: 300 },
    { id: 'd', title: '新 Agent 会话', workspaceId: 'ws-1', projectId: 'proj-1', createdAt: 400 },
  ]

  test('无候选草稿时返回 null', () => {
    const result = findRecallableDraftSession({
      candidates: base,
      draftSessionIds: new Set(),
      draftTexts: new Map(),
      workspaceId: 'ws-1',
    })
    expect(result).toBeNull()
  })

  test('草稿存在但输入为空时不回收（空草稿不算"找不回的内容"）', () => {
    const result = findRecallableDraftSession({
      candidates: base,
      draftSessionIds: new Set(['a']),
      draftTexts: new Map([['a', '   ']]),
      workspaceId: 'ws-1',
    })
    expect(result).toBeNull()
  })

  test('同工作区多个候选取 createdAt 最新的一个', () => {
    const result = findRecallableDraftSession({
      candidates: base,
      draftSessionIds: new Set(['a', 'b']),
      draftTexts: new Map([['a', '写了一半'], ['b', '最新草稿']]),
      workspaceId: 'ws-1',
    })
    expect(result?.id).toBe('b')
  })

  test('当前工作区无草稿时跨工作区兜底', () => {
    const result = findRecallableDraftSession({
      candidates: base,
      draftSessionIds: new Set(['c']),
      draftTexts: new Map([['c', '别的工作区的内容']]),
      workspaceId: 'ws-1',
    })
    expect(result?.id).toBe('c')
  })

  test('当前工作区有草稿时优先，即使其他工作区草稿更新', () => {
    const result = findRecallableDraftSession({
      candidates: base,
      draftSessionIds: new Set(['a', 'c']),
      draftTexts: new Map([['a', '本工作区草稿'], ['c', '别的工作区更新内容']]),
      workspaceId: 'ws-1',
    })
    expect(result?.id).toBe('a')
  })

  test('绑定 projectId 的草稿不参与回收', () => {
    const result = findRecallableDraftSession({
      candidates: base,
      draftSessionIds: new Set(['d']),
      draftTexts: new Map([['d', '项目下的草稿']]),
      workspaceId: 'ws-1',
    })
    expect(result).toBeNull()
  })
})

describe('resolveDefaultProjectId', () => {
  const sessions: ProjectRecencyCandidate[] = [
    { workspaceId: 'ws-1', updatedAt: 100 }, // 无项目的历史会话，不参与
    { workspaceId: 'ws-1', projectId: 'proj-old', updatedAt: 200 },
    { workspaceId: 'ws-1', projectId: 'proj-new', updatedAt: 300 },
    { workspaceId: 'ws-2', projectId: 'proj-other-ws', updatedAt: 400 }, // 别的工作区，不参与
  ]

  test('显式指定 projectId 时直接返回，不做默认绑定', () => {
    const result = resolveDefaultProjectId({
      explicitProjectId: 'proj-explicit',
      recallDraft: true,
      sessions,
      workspaceId: 'ws-1',
    })
    expect(result).toBe('proj-explicit')
  })

  test('非 recallDraft（程序化建会话）不做默认绑定', () => {
    const result = resolveDefaultProjectId({
      recallDraft: false,
      sessions,
      workspaceId: 'ws-1',
    })
    expect(result).toBeUndefined()
  })

  test('recallDraft 且未显式指定项目时，绑定同工作区最近更新的项目', () => {
    const result = resolveDefaultProjectId({
      recallDraft: true,
      sessions,
      workspaceId: 'ws-1',
    })
    expect(result).toBe('proj-new')
  })

  test('同工作区没有任何带项目的历史会话时返回 undefined', () => {
    const result = resolveDefaultProjectId({
      recallDraft: true,
      sessions,
      workspaceId: 'ws-3',
    })
    expect(result).toBeUndefined()
  })
})
