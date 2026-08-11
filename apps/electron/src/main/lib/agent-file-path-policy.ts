import { existsSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

function isWithinRoot(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(root + sep)
}

function realpathNearestExisting(path: string): string {
  let current = path
  while (!existsSync(current)) {
    const parent = dirname(current)
    if (parent === current) return resolve(path)
    current = parent
  }
  return realpathSync(current)
}

function validateRelativeFilename(filename: string): void {
  if (!filename || filename.includes('\0') || isAbsolute(filename) || /^[A-Za-z]:[\\/]/.test(filename) || filename.startsWith('\\')) {
    throw new Error('文件名必须是非空相对路径')
  }

  const segments = filename.split(/[\\/]/)
  if (segments.some((segment) => segment === '..' || segment === '.')) {
    throw new Error('文件名包含非法路径段')
  }
}

/**
 * 解析写入受管 root 的子路径，并拒绝 traversal、前缀碰撞和 symlink escape。
 * root/父目录可以尚未创建，但最近存在祖先必须仍位于 root 内。
 */
export function resolveSafeChildPath(root: string, filename: string): string {
  validateRelativeFilename(filename)

  const requestedRoot = resolve(root)
  const rootExists = existsSync(requestedRoot)
  const resolvedRoot = rootExists ? realpathSync(requestedRoot) : requestedRoot
  const rootBoundary = rootExists ? resolvedRoot : realpathNearestExisting(dirname(requestedRoot))
  const candidate = resolve(rootExists ? resolvedRoot : requestedRoot, filename)
  const lexicalRelative = relative(rootExists ? resolvedRoot : rootBoundary, candidate)
  if (rootExists && (lexicalRelative.startsWith('..') || isAbsolute(lexicalRelative))) {
    throw new Error('文件路径越出受管根目录')
  }

  const existingParent = realpathNearestExisting(dirname(candidate))
  if (!isWithinRoot(existingParent, rootBoundary)) {
    throw new Error('文件父目录通过符号链接越出受管根目录')
  }

  if (existsSync(candidate)) {
    const resolvedCandidate = realpathSync(candidate)
    if (!isWithinRoot(resolvedCandidate, resolvedRoot)) {
      throw new Error('文件目标通过符号链接越出受管根目录')
    }
  }

  return candidate
}
