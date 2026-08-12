import type { FileAccessOptions } from '@myyoda/shared'

/** 只保留主进程可解释的文件访问上下文；Renderer 不能请求 unrestricted 绕过根校验。 */
export function normalizeFileAccessOptions(value?: FileAccessOptions | string[]): FileAccessOptions | undefined {
  if (!value || Array.isArray(value) || typeof value !== 'object') return undefined

  return {
    sessionId: typeof value.sessionId === 'string' ? value.sessionId : undefined,
    workspaceSlug: typeof value.workspaceSlug === 'string' ? value.workspaceSlug : undefined,
    candidateBasePaths: Array.isArray(value.candidateBasePaths)
      ? value.candidateBasePaths.filter((path): path is string => typeof path === 'string' && path.length > 0)
      : undefined,
  }
}
