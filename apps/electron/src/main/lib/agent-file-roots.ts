/** Agent 会话文件根解析器
 *
 * 主进程是唯一的 effective cwd 来源。renderer 不拼接 managed Project 路径，
 * 避免右侧 Files 与 Agent 实际执行目录发生漂移。
 */

import type { AgentSessionFileRoots, AgentSessionMeta } from '@myyoda/shared'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { projectRepository } from './project-repository'
import { resolveSessionCwd } from './agent-cwd-resolver'
import { getAgentSessionWorkspacePath, getAgentWorkspacePath, getWorkspaceFilesDir } from './config-paths'

export interface BuildAgentSessionFileRootsInput {
  sessionDir: string
  workspaceFilesPath: string
  executionCwd: string
  executionSource: AgentSessionFileRoots['executionSource']
  projectId?: string
  /** 绑定 Project 的资产库目录；未绑定 Project 时为空。 */
  projectAssetsPath?: string
  /** Project 已绑定但目录不可达时的原始路径；透传给 UI 区分"未绑定"与"绑定但不可达"。 */
  projectUnavailablePath?: string
}

/** 纯函数构建文件根，便于 renderer contract 之外的单测覆盖。 */
export function buildAgentSessionFileRoots(input: BuildAgentSessionFileRootsInput): AgentSessionFileRoots {
  const sessionId = input.sessionDir.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
  const projectRoot = input.executionSource === 'sandbox' ? undefined : input.executionCwd

  return {
    sessionDir: input.sessionDir,
    executionCwd: input.executionCwd,
    executionSource: input.executionSource,
    ...(projectRoot ? { projectRoot } : {}),
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.projectAssetsPath ? { projectAssetsPath: input.projectAssetsPath } : {}),
    ...(input.projectUnavailablePath ? { projectUnavailablePath: input.projectUnavailablePath } : {}),
    workspaceFilesPath: input.workspaceFilesPath,
    sessionOutboxPath: join(input.workspaceFilesPath, 'Outbox', sessionId),
  }
}

/** 按当前 Agent 与 Project 运行规则解析会话文件根。 */
export function resolveAgentSessionFileRoots(
  sessionMeta: AgentSessionMeta,
  workspaceSlug: string,
): AgentSessionFileRoots {
  const sessionDir = getAgentSessionWorkspacePath(workspaceSlug, sessionMeta.id)
  const workspaceFilesPath = getWorkspaceFilesDir(workspaceSlug)
  const cwdResolution = resolveSessionCwd({
    gitWorktreePath: sessionMeta.gitWorktreePath,
    agentCwdMode: sessionMeta.agentCwdMode,
    projectId: sessionMeta.projectId,
    resolveProjectCwd: (projectId) => projectRepository.resolveEffectiveCwdForProject(getAgentWorkspacePath(workspaceSlug), projectId),
    sandboxCwd: sessionDir,
  })

  if ('unavailable' in cwdResolution) {
    const roots = buildAgentSessionFileRoots({
      sessionDir,
      workspaceFilesPath,
      executionCwd: sessionDir,
      executionSource: 'sandbox',
      projectId: sessionMeta.projectId,
      projectAssetsPath: resolveProjectAssetsPath(workspaceSlug, sessionMeta.projectId),
      projectUnavailablePath: cwdResolution.displayPath,
    })
    mkdirSync(roots.sessionOutboxPath, { recursive: true })
    return roots
  }

  const roots = buildAgentSessionFileRoots({
    sessionDir,
    workspaceFilesPath,
    executionCwd: cwdResolution.cwd,
    executionSource: cwdResolution.source,
    projectId: sessionMeta.projectId,
    projectAssetsPath: resolveProjectAssetsPath(workspaceSlug, sessionMeta.projectId),
  })
  mkdirSync(roots.sessionOutboxPath, { recursive: true })
  return roots
}

/** 绑定 Project 时解析其资产库目录；未绑定或解析失败时返回 undefined。 */
function resolveProjectAssetsPath(workspaceSlug: string, projectId?: string): string | undefined {
  if (!projectId) return undefined
  try {
    const loaded = projectRepository.getProjectAtRoot(getAgentWorkspacePath(workspaceSlug), projectId)
    return loaded?.assetsPath
  } catch {
    return undefined
  }
}
