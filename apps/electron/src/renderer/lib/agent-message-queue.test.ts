import { describe, expect, test } from 'bun:test'
import {
  buildQueuedMessageSendPayload,
  getQueuedMessageDisplayParts,
  parseQueuedMessageMentions,
  shouldAutoDispatchQueuedMessage,
} from './agent-message-queue'

const baseDispatchOptions = {
  queueLength: 1,
  running: false,
  backgroundWaiting: false,
  stoppedByUser: false,
  hasBlockingRequests: false,
  hasChannel: true,
  hasAvailableModel: true,
}

describe('shouldAutoDispatchQueuedMessage（后台队列自动派发的闸门条件）', () => {
  test('Given 队列非空且无阻塞条件 When 判断是否派发 Then 允许', () => {
    expect(shouldAutoDispatchQueuedMessage(baseDispatchOptions)).toBe(true)
  })

  test('Given 队列为空 When 判断是否派发 Then 拒绝', () => {
    expect(shouldAutoDispatchQueuedMessage({ ...baseDispatchOptions, queueLength: 0 })).toBe(false)
  })

  for (const [field, value] of [
    ['running', true],
    ['backgroundWaiting', true],
    ['stoppedByUser', true],
    ['hasBlockingRequests', true],
    ['hasChannel', false],
    ['hasAvailableModel', false],
  ] as const) {
    test(`Given ${field}=${value} When 判断是否派发 Then 拒绝`, () => {
      expect(shouldAutoDispatchQueuedMessage({ ...baseDispatchOptions, [field]: value })).toBe(false)
    })
  }
})

describe('queued message @file mention path decoding (Agent 侧真实路径)', () => {
  test('decodes percent-encoded @file path back to the real path with spaces', () => {
    const text = '请查看 @file:%2FUsers%2Fme%2FMy%20report.pdf 这份报告'
    const result = parseQueuedMessageMentions(text)
    expect(result.cleanedText).toBe('请查看 @file:/Users/me/My report.pdf 这份报告')
  })

  test('keeps legacy unencoded @file paths unchanged', () => {
    const text = '参考 @file:notes/brief.md 内容'
    const result = parseQueuedMessageMentions(text)
    expect(result.cleanedText).toBe('参考 @file:notes/brief.md 内容')
  })

  test('decode does not affect skill / mcp / session mentions removal', () => {
    const text = '@file:%2FUsers%2Fme%2FMy%20report.pdf /skill:brainstorming #mcp:playwright &session:session-123'
    const result = parseQueuedMessageMentions(text)
    expect(result.cleanedText).toBe('@file:/Users/me/My report.pdf')
    expect(result.mentionedSkills).toEqual(['brainstorming'])
    expect(result.mentionedMcpServers).toEqual(['playwright'])
    expect(result.mentionedSessionIds).toEqual(['session-123'])
  })

  test('buildQueuedMessageSendPayload sdkText contains the real (decoded) file path', () => {
    const payload = buildQueuedMessageSendPayload({
      id: 'msg-1',
      text: '看下 @file:%2FUsers%2Fme%2FMy%20report.pdf',
      createdAt: Date.now(),
    })
    expect(payload.sdkText).toContain('@file:/Users/me/My report.pdf')
  })

  test('getQueuedMessageDisplayParts shows the full filename for encoded paths with spaces', () => {
    const parts = getQueuedMessageDisplayParts('看下 @file:%2FUsers%2Fme%2FMy%20report.pdf 这份报告')
    const fileRef = parts.find((p) => p.type === 'reference' && p.referenceType === 'file')
    expect(fileRef).toBeDefined()
    if (fileRef && 'referenceType' in fileRef) {
      // id 保留协议原始值（编码）；label 是展示层解码后的完整文件名
      expect(fileRef.id).toBe('%2FUsers%2Fme%2FMy%20report.pdf')
      expect(fileRef.label).toBe('My report.pdf')
    }
  })
})
