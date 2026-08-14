/**
 * project-onboarding-model — 整个工作区首次建 Agent 会话时弹一次「创建项目」引导
 *
 * 参考 Synara：全新工作区第一次新建会话会引导创建项目，之后不再打扰。
 * 用 localStorage 记一次性标记（同 git-context-picker-model.ts 的 getProjectGitModeStorageKey 模式），
 * 而不是给 AgentWorkspace 加持久化字段——这只是个一次性 UI 提示，不是需要跨端同步的业务数据。
 */

export function getProjectOnboardingStorageKey(workspaceId: string): string {
  return `myyoda:workspace:${workspaceId}:projectOnboardingSeen`
}

/**
 * 是否应该弹一次「创建项目」引导。
 * - 没有 workspaceId：无法定位标记，不弹
 * - 该工作区已经有项目（workspace=项目 模型：绑定了工程目录，或已有会话）：不弹
 * - 已经弹过（alreadySeen 由调用方读 localStorage 传入）：不再弹
 */
export function shouldPromptProjectOnboarding(input: {
  workspaceId: string | undefined
  hasAnyProjectInWorkspace: boolean
  alreadySeen: boolean
}): boolean {
  if (!input.workspaceId) return false
  if (input.hasAnyProjectInWorkspace) return false
  if (input.alreadySeen) return false
  return true
}
