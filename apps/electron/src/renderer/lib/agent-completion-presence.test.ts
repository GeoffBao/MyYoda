import { describe, expect, test } from 'bun:test'
import { getAgentCompletionMarkers, isAgentSessionActiveForCompletion, notifyAgentCompletion, shouldNotifyAgentCompletion } from './agent-completion-presence'
import type { TabItem } from '@/atoms/tab-atoms'

describe('Agent 完成归属判断', () => {
  test('Given 当前激活的是同一个 Agent Tab When Agent 完成 Then 视为用户仍在查看', () => {
    const tabs: TabItem[] = [
      { id: '__scratch-pad__', type: 'scratch', sessionId: '__scratch-pad__', title: '草稿' },
      { id: 'agent-1', type: 'agent', sessionId: 'agent-1', title: '当前任务' },
    ]
    const input = {
      tabs,
      activeTabId: 'agent-1',
      currentAgentSessionId: 'agent-1',
      sessionId: 'agent-1',
      documentHasFocus: true,
    }

    expect(isAgentSessionActiveForCompletion(input)).toBe(true)
    expect(getAgentCompletionMarkers(input)).toEqual({
      markUnviewedCompleted: false,
    })
  })

  test('Given 当前激活的是草稿页 When 旧 Agent 完成 Then 视为后台完成', () => {
    const tabs: TabItem[] = [
      { id: '__scratch-pad__', type: 'scratch', sessionId: '__scratch-pad__', title: '草稿' },
      { id: 'agent-1', type: 'agent', sessionId: 'agent-1', title: '后台任务' },
    ]
    const input = {
      tabs,
      activeTabId: '__scratch-pad__',
      currentAgentSessionId: 'agent-1',
      sessionId: 'agent-1',
      documentHasFocus: true,
    }

    expect(isAgentSessionActiveForCompletion(input)).toBe(false)
    expect(getAgentCompletionMarkers(input)).toEqual({
      markUnviewedCompleted: true,
    })
  })

  test('Given Tab 状态尚未恢复但 currentAgentSessionId 匹配 When Agent 完成 Then 使用兼容判断', () => {
    expect(isAgentSessionActiveForCompletion({
      tabs: [],
      activeTabId: null,
      currentAgentSessionId: 'agent-1',
      sessionId: 'agent-1',
      documentHasFocus: true,
    })).toBe(true)
  })

  test('Given 当前激活的就是该 Agent Tab 但窗口在后台 When Agent 完成 Then 视为未查看并入账角标', () => {
    const tabs: TabItem[] = [
      { id: '__scratch-pad__', type: 'scratch', sessionId: '__scratch-pad__', title: '草稿' },
      { id: 'agent-1', type: 'agent', sessionId: 'agent-1', title: '当前任务' },
    ]
    const input = {
      tabs,
      activeTabId: 'agent-1',
      currentAgentSessionId: 'agent-1',
      sessionId: 'agent-1',
      documentHasFocus: false,
    }

    expect(isAgentSessionActiveForCompletion(input)).toBe(false)
    expect(getAgentCompletionMarkers(input)).toEqual({
      markUnviewedCompleted: true,
    })
  })

  test('Given 委派子会话完成 When session 存在 sourceDelegationId Then 不计入未读角标', () => {
    const tabs: TabItem[] = [
      { id: '__scratch-pad__', type: 'scratch', sessionId: '__scratch-pad__', title: '草稿' },
      { id: 'child-1', type: 'agent', sessionId: 'child-1', title: '委派子会话' },
    ]
    const input = {
      tabs,
      activeTabId: '__scratch-pad__',
      currentAgentSessionId: 'parent-1',
      sessionId: 'child-1',
      session: { sourceDelegationId: 'delegation-1' },
      documentHasFocus: true,
    }

    expect(isAgentSessionActiveForCompletion(input)).toBe(false)
    expect(getAgentCompletionMarkers(input)).toEqual({
      markUnviewedCompleted: false,
    })
  })

  test('Given Task DAG 子任务节点完成 When session 存在 taskNodeId Then 不计入未读角标', () => {
    const tabs: TabItem[] = [
      { id: '__scratch-pad__', type: 'scratch', sessionId: '__scratch-pad__', title: '草稿' },
      { id: 'node-a', type: 'agent', sessionId: 'node-a', title: '子任务节点' },
    ]
    const input = {
      tabs,
      activeTabId: '__scratch-pad__',
      currentAgentSessionId: 'root-1',
      sessionId: 'node-a',
      session: { taskNodeId: 'node-a' },
      documentHasFocus: true,
    }

    expect(isAgentSessionActiveForCompletion(input)).toBe(false)
    expect(getAgentCompletionMarkers(input)).toEqual({
      markUnviewedCompleted: false,
    })
  })
})

describe('Agent 完成桌面通知边界', () => {
  test('Given 顶层用户或自动任务会话成功完成 When 判断通知 Then 允许发送', () => {
    expect(shouldNotifyAgentCompletion({
      completion: { triggeredBy: 'user', resultSubtype: 'success' },
      hasStreamError: false,
    })).toBe(true)
    expect(shouldNotifyAgentCompletion({
      completion: { triggeredBy: 'automation', resultSubtype: 'success' },
      hasStreamError: false,
    })).toBe(true)
  })

  test('Given 协作子会话完成 When 来源为 delegation Then 不发送完成通知', () => {
    expect(shouldNotifyAgentCompletion({
      completion: { triggeredBy: 'delegation', resultSubtype: 'success' },
      hasStreamError: false,
    })).toBe(false)
  })

  test('Given 持久化委派子会话完成 When payload 或 session 存在 sourceDelegationId Then 不发送完成通知', () => {
    expect(shouldNotifyAgentCompletion({
      completion: { resultSubtype: 'success', sourceDelegationId: 'delegation-1' },
      hasStreamError: false,
    })).toBe(false)
    expect(shouldNotifyAgentCompletion({
      completion: { resultSubtype: 'success' },
      session: { sourceDelegationId: 'delegation-1' },
      hasStreamError: false,
    })).toBe(false)
  })

  test('Given Task DAG 子任务节点完成 When payload 或 session 存在 taskNodeId Then 不发送完成通知', () => {
    expect(shouldNotifyAgentCompletion({
      completion: { triggeredBy: 'work', resultSubtype: 'success', taskNodeId: 'node-a' },
      hasStreamError: false,
    })).toBe(false)
    expect(shouldNotifyAgentCompletion({
      completion: { triggeredBy: 'work', resultSubtype: 'success' },
      session: { taskNodeId: 'node-a' },
      hasStreamError: false,
    })).toBe(false)
  })

  test('Given Task 根会话或验收轮完成 When 没有 taskNodeId Then 保留顶层完成通知', () => {
    expect(shouldNotifyAgentCompletion({
      completion: { triggeredBy: 'work', resultSubtype: 'success' },
      session: {},
      hasStreamError: false,
    })).toBe(true)
  })

  test('Given 停止、错误、流错误或后台任务等待 When 判断通知 Then 不发送完成通知', () => {
    expect(shouldNotifyAgentCompletion({ completion: { stoppedByUser: true }, hasStreamError: false })).toBe(false)
    expect(shouldNotifyAgentCompletion({ completion: { resultSubtype: 'error_during_execution' }, hasStreamError: false })).toBe(false)
    expect(shouldNotifyAgentCompletion({ completion: { resultSubtype: 'success' }, hasStreamError: true })).toBe(false)
    expect(shouldNotifyAgentCompletion({ completion: { resultSubtype: 'success', backgroundTasksPending: true }, hasStreamError: false })).toBe(false)
  })

  test('Given notifyAgentCompletion 条件满足或不满足 Then 只在满足时调用 notify', () => {
    let count = 0
    notifyAgentCompletion({
      completion: { triggeredBy: 'user', resultSubtype: 'success' },
      hasStreamError: false,
      notify: () => { count += 1 },
    })
    notifyAgentCompletion({
      completion: { triggeredBy: 'delegation', resultSubtype: 'success' },
      hasStreamError: false,
      notify: () => { count += 1 },
    })

    expect(count).toBe(1)
  })
})
