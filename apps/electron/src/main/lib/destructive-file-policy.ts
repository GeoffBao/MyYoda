import { sep } from 'node:path'

/**
 * 删除只能作用于已授权根目录下的子项，不能把 capability root 本身当作普通文件删除。
 * 调用方必须先完成 realpath 和存在性校验；此函数只负责边界判断。
 */
export function isSafeDeleteTarget(
  resolvedTarget: string,
  resolvedProtectedRoots: readonly string[],
): boolean {
  if (!resolvedTarget || resolvedProtectedRoots.length === 0) return false
  return resolvedProtectedRoots.some((root) => Boolean(root) && resolvedTarget !== root && resolvedTarget.startsWith(root + sep))
}
