/**
 * Agent 会话执行 cwd 决策
 *
 * 优先级（从高到低）：
 * 1. Git Worktree 绑定路径（会话级隔离，创建后不随 Project 变化）
 * 2. 工作区绑定的本地项目根目录（workspace.projectRootPath，对齐 Proma：工作区=项目）
 * 3. 新会话（agentCwdMode === 'project'）绑定的 Project 工作目录（动态解析，
 *    Project 重新关联目录后自动生效；存量 KanbanProject 兼容）
 * 4. 会话隔离沙箱目录（历史会话兼容 / 未绑定目录时的托管兜底）
 *
 * 纯函数，不直接依赖 projectRepository / 文件系统，便于单测覆盖决策分支。
 */

import type { EffectiveCwdResult } from './project-path-service'

export interface ResolveSessionCwdInput {
  /** 会话绑定的 Git Worktree 路径；存在时优先级最高 */
  gitWorktreePath?: string
  /** 工作区绑定的本地项目根目录（workspace.projectRootPath）；存在时优先于 Project 工作目录 */
  workspaceProjectRootPath?: string
  /** 会话的 cwd 语义标记；历史会话缺失时应传 undefined（按 'session' 解释） */
  agentCwdMode?: 'session' | 'project'
  /** 会话关联的 Project ID */
  projectId?: string
  /** 解析指定 Project 的有效 cwd；仅在 agentCwdMode === 'project' 且 projectId 存在时调用 */
  resolveProjectCwd: (projectId: string) => EffectiveCwdResult | null
  /** 会话隔离沙箱目录（托管目录），作为最终兜底 */
  sandboxCwd: string
}

export type SessionCwdSource = 'worktree' | 'workspace-root' | 'project' | 'sandbox'

export interface ResolveSessionCwdResult {
  cwd: string
  source: SessionCwdSource
}

export interface ResolveSessionCwdUnavailable {
  unavailable: true
  /** 供错误提示展示的原始路径（可能已不存在） */
  displayPath?: string
}

export function resolveSessionCwd(
  input: ResolveSessionCwdInput,
): ResolveSessionCwdResult | ResolveSessionCwdUnavailable {
  if (input.gitWorktreePath) {
    return { cwd: input.gitWorktreePath, source: 'worktree' }
  }

  if (input.workspaceProjectRootPath) {
    return { cwd: input.workspaceProjectRootPath, source: 'workspace-root' }
  }

  if (input.agentCwdMode === 'project' && input.projectId) {
    const result = input.resolveProjectCwd(input.projectId)
    if (result?.status === 'unavailable') {
      return { unavailable: true, displayPath: result.displayPath }
    }
    if (result?.cwd) {
      return { cwd: result.cwd, source: 'project' }
    }
  }

  return { cwd: input.sandboxCwd, source: 'sandbox' }
}

/**
 * 若本次 cwd 来自 worktree 绑定，覆写项目上下文的 workingDirectory 并标记 isWorktree，
 * 让注入 prompt 的 `<project_working_directory>` 与实际 cwd（worktree 路径）保持一致，
 * 不再和 `<working_directory>` 互相矛盾；否则原样透传。
 *
 * 结构化泛型、不依赖 @myyoda/shared 的 ProjectPromptContext 类型，保持本文件纯函数、
 * 不引入跨包类型耦合，便于单测覆盖。
 */
export function applyWorktreeProjectContextOverride<T extends { workingDirectory?: string }>(
  projectContext: T | null,
  cwdSource: SessionCwdSource | undefined,
  agentCwd: string | undefined,
): (T & { isWorktree?: boolean }) | null {
  if (!projectContext || cwdSource !== 'worktree' || !agentCwd) return projectContext
  return { ...projectContext, workingDirectory: agentCwd, isWorktree: true }
}
