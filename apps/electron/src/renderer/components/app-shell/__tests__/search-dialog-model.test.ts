import { describe, expect, test } from 'bun:test'
import { resolveSearchScope } from '../search-dialog-model'

describe('resolveSearchScope', () => {
  test('Given appMode=chat When 解析搜索范围 Then 只覆盖 Chat', () => {
    expect(resolveSearchScope('chat')).toEqual({ includeChatScope: true, includeAgentScope: false })
  })

  test('Given appMode=agent When 解析搜索范围 Then 只覆盖 Agent', () => {
    expect(resolveSearchScope('agent')).toEqual({ includeChatScope: false, includeAgentScope: true })
  })

  test('Given appMode=cowork（遗留 Work 模式，无对应会话类型）When 解析搜索范围 Then 同时覆盖 Chat + Agent，不返回空结果', () => {
    expect(resolveSearchScope('cowork')).toEqual({ includeChatScope: true, includeAgentScope: true })
  })

  test('Given appMode=scratch（草稿本，无对应会话类型）When 解析搜索范围 Then 同时覆盖 Chat + Agent，不返回空结果', () => {
    expect(resolveSearchScope('scratch')).toEqual({ includeChatScope: true, includeAgentScope: true })
  })
})
