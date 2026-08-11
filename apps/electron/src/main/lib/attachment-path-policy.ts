import { resolveSafeChildPath } from './agent-file-path-policy'

/** 解析附件相对路径，统一拒绝 traversal、绝对路径和 symlink 越界。 */
export function resolveSafeAttachmentPath(attachmentsRoot: string, localPath: string): string {
  return resolveSafeChildPath(attachmentsRoot, localPath)
}
