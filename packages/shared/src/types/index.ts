/**
 * Shared type definitions for MyYoda
 */

// Placeholder types - will be expanded as needed
export interface Workspace {
  id: string
  name: string
  path: string
}

// 运行时相关类型
export * from './runtime'

// 渠道（AI 供应商）相关类型
export * from './channel'

// 代理配置相关类型
export * from './proxy'

// Chat 相关类型
export * from './chat'

// Agent 相关类型
export * from './agent'
export * from './reasoning-profile'

// Agent Provider 适配器接口
export * from './agent-provider'

// 环境检测相关类型
export * from './environment'

// 第三方安装包（Git、Node.js 等）相关类型
export * from './installer'

// GitHub Release 相关类型
export * from './github'

// Pull Request 相关类型与 IPC 通道
export * from './pr'

// 本地化版本历史（Release Notes）相关类型
export * from './release-notes'

// 系统提示词相关类型
export * from './system-prompt'

// Chat 工具（function calling）相关类型
export * from './chat-tool'

// 飞书集成相关类型
export * from './feishu'

// 钉钉集成相关类型
export * from './dingtalk'

// 微信集成相关类型
export * from './wechat'

// 定时任务（Automation）相关类型
export * from './automation'
// 本地任务与日程（Planning）相关类型
export * from './planning'

// Agent 专家包 IPC 通道
export { EXPERT_IPC_CHANNELS } from '../experts/channels'

// 内嵌浏览器（synara 移植）类型与 IPC 通道
export * from './browser'

// Projects 相关类型（仅类型，避免 renderer 引入 Node.js 文件存储实现）
export type * from '../projects/types'

// Tasks（Conductor）相关类型（仅类型，运行时实现从 @myyoda/shared/tasks 导入）
export type * from '../tasks/schema'
export type * from '../tasks/refs'
export type * from '../tasks/validate'
export type * from '../tasks/storage'

// Protocol 通道常量
export * from '../protocol/channels'

// CodeClaw 桌面助手相关类型
export * from './codeclaw'
