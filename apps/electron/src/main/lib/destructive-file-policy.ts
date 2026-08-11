import { sep } from 'node:path'

/**
 * 删除只能作用于已授权根目录下的子项，不能把 capability root 本身当作普通文件删除。
 *
 * 分两组：
 * - resolvedForbiddenRoots：绝对不能作为直接删除目标（workspace root / metadata dir / session dir）。
 * - resolvedAllowedRoots：其子项允许删除（由 isPathAllowed 推导的授权根）。
 *
 * 调用方必须先完成 realpath 和存在性校验；此函数只负责边界判断。
 */
export function isSafeDeleteTarget(
  resolvedTarget: string,
  resolvedForbiddenRoots: readonly string[],
  resolvedAllowedRoots: readonly string[],
): boolean {
  if (!resolvedTarget) return false

  // 先全局拒绝：任何 forbidden root 都不可直接作为删除目标。
  // 这解决了 previous some() 单参数实现的绕过：workspace root 是
  // agent-workspaces/ 的子项，会被父级根判定为"可删除的子项"。
  if (resolvedForbiddenRoots.some((root) => Boolean(root) && resolvedTarget === root)) {
    return false
  }

  // 必须是某个已授权根目录下的子项。
  if (resolvedAllowedRoots.length === 0) return false
  return resolvedAllowedRoots.some(
    (root) => Boolean(root) && resolvedTarget !== root && resolvedTarget.startsWith(root + sep),
  )
}
