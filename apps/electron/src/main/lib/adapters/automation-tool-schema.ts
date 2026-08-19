import { Type } from 'typebox'
import type { CreateAutomationInput, UpdateAutomationInput } from '@myyoda/shared'

export type AutomationScheduleType = CreateAutomationInput['scheduleType']

/**
 * 部分模型工具调用传输层会把可选属性显式物化出来。在此桥接边界，
 * 先把不影响当前调度模式的字段丢弃，再应用与直接 IPC 调用方共享的严格域校验。
 */
export function discardInapplicableAutomationScheduleFields(
  input: Partial<CreateAutomationInput | UpdateAutomationInput>,
  scheduleType: AutomationScheduleType,
): void {
  if (scheduleType !== 'interval') {
    input.activeWindowStart = undefined
    input.activeWindowEnd = undefined
    input.activeWeekdays = undefined
  }
  if (scheduleType !== 'daily' && scheduleType !== 'weekly' && scheduleType !== 'monthly') {
    input.timeOfDay = undefined
  }
  if (scheduleType !== 'weekly') input.dayOfWeek = undefined
  if (scheduleType !== 'monthly') input.dayOfMonth = undefined
  if (scheduleType !== 'once') input.scheduledAt = undefined
  // 部分传输层把省略/null 的 maxRuns 解码为 0；两者都表示不限次。
  if (input.maxRuns === 0) input.maxRuns = null
}

export const automationCreateToolParameters = Type.Object({
  name: Type.String({ description: '任务名，简短说明长期反复执行的目标' }),
  prompt: Type.String({ description: '每次触发时发送给 Agent 的完整自然语言指令' }),
  scheduleType: Type.Union([
    Type.Literal('interval'),
    Type.Literal('daily'),
    Type.Literal('weekly'),
    Type.Literal('monthly'),
    Type.Literal('once'),
  ], { description: '调度类型' }),
  intervalMinutes: Type.Optional(Type.Number({ description: '固定间隔分钟数；scheduleType=interval 时必填' })),
  activeWindowStart: Type.Optional(Type.String({ description: 'interval 的每日有效开始时刻，HH:MM；需与 activeWindowEnd 同时设置' })),
  activeWindowEnd: Type.Optional(Type.String({ description: 'interval 的每日有效结束时刻（不包含），HH:MM；需与 activeWindowStart 同时设置' })),
  activeWeekdays: Type.Optional(Type.Array(Type.Number({ description: '运行日：0=周日，1=周一 … 6=周六；空数组表示每天' }), { description: 'interval 的周内运行日集合，例如工作日传 [1,2,3,4,5]' })),
  timeOfDay: Type.Optional(Type.String({ description: '每天/每周/每月触发时间，24 小时制 HH:MM' })),
  dayOfWeek: Type.Optional(Type.Number({ description: '每周触发日，0=周日，...，6=周六' })),
  dayOfMonth: Type.Optional(Type.Number({ description: '每月触发日，1-31' })),
  scheduledAt: Type.Optional(Type.Number({ description: '一次性任务的绝对触发时间（毫秒时间戳）；scheduleType=once 时必填' })),
  maxRuns: Type.Optional(Type.Union([
    Type.Number({ description: '最大运行次数上限；达到后任务自动停用' }),
    Type.Null({ description: '清除运行次数上限，长期运行' }),
  ])),
  active: Type.Optional(Type.Boolean({ description: '创建后是否启用，默认 true' })),
  sessionMode: Type.Optional(Type.Union([Type.Literal('daily'), Type.Literal('reuse')], { description: '会话模式' })),
  projectId: Type.Optional(Type.String({ description: '绑定的项目 ID（可选，仅 executionMode=create_task 时生效）：任务运行会话挂载到该项目（cwd 用项目工作目录）。不传则挂在工作区根目录' })),
  executionMode: Type.Optional(Type.Union([Type.Literal('create_task'), Type.Literal('run_only')], { description: '输出模式：create_task=每次运行创建可追踪的任务并挂载到项目；run_only=仅运行不关联项目（默认在工作区目录运行）。默认 run_only' })),
})
