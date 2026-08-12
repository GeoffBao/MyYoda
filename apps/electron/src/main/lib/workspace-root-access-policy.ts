import { existsSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'

export interface RegisteredWorkspaceRoot {
  workspaceId: string
  workspaceRoot: string
}

export interface WorkspaceRootRegistration {
  id: string
  root: string
}

/**
 * 将 Renderer 提供的 workspaceRoot 绑定到主进程已注册的 Workspace。
 * 不接受任意本地路径，也不使用字符串前缀判断，避免 sibling root 越权。
 */
export function resolveRegisteredWorkspaceRoot(
  requestedRoot: unknown,
  registrations: readonly WorkspaceRootRegistration[],
): RegisteredWorkspaceRoot | null {
  if (typeof requestedRoot !== 'string' || !requestedRoot.trim()) return null

  const requestedPath = resolve(requestedRoot)
  if (!existsSync(requestedPath)) return null

  let canonicalRequested: string
  try {
    canonicalRequested = realpathSync(requestedPath)
  } catch {
    return null
  }

  for (const registration of registrations) {
    if (typeof registration.id !== 'string' || typeof registration.root !== 'string') continue
    try {
      const canonicalRoot = realpathSync(resolve(registration.root))
      if (canonicalRoot === canonicalRequested) {
        return {
          workspaceId: registration.id,
          workspaceRoot: canonicalRoot,
        }
      }
    } catch {
      // 存量 Workspace 不可达时不把它当作已授权根。
    }
  }

  return null
}
