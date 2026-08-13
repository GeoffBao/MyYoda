import type { AppMode } from '@/atoms/app-mode'

export interface SearchScope {
  /** 是否应该搜索 Chat 会话（标题 + 正文） */
  includeChatScope: boolean
  /** 是否应该搜索 Agent 会话（标题 + 正文） */
  includeAgentScope: boolean
}

/**
 * 根据当前 appMode 决定全局搜索应该覆盖哪些会话类型。
 *
 * chat/agent 是有对应会话类型的主模式，隔离到各自类型可以减少噪音（对齐上游
 * “模式隔离模糊搜索”的设计）。但 MyYoda 比上游多出 cowork（遗留 Work 模式）
 * 和 scratch（草稿本）这两个没有对应会话类型的模式；全局搜索在这两个模式下
 * 仍应可用，因此退回到改动前“同时搜索 Chat + Agent”的行为，而不是返回空结果。
 */
export function resolveSearchScope(appMode: AppMode): SearchScope {
  const isChatMode = appMode === 'chat'
  const isAgentMode = appMode === 'agent'
  const isScopedMode = isChatMode || isAgentMode
  return {
    includeChatScope: isChatMode || !isScopedMode,
    includeAgentScope: isAgentMode || !isScopedMode,
  }
}
