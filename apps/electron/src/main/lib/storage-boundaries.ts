/**
 * 工作区目录清理边界：这些目录不是 Session orphan，可长期保存。
 *
 * 这份名单是从 MyYoda 原样继承的"孤儿检测"黑名单模型：扫描 workspaceRoot 下的顶层目录，
 * 不在这份名单里、又不匹配任一活跃 session id / workspace slug 的，就当孤儿删除。
 * MyYoda 自身没有 projects/excalidraw，所以这份名单对它是完整的；MyYoda 之后独立新增的
 * 每一个"每工作区一份、长期持久化"的顶层目录都必须补进来，否则会被当成孤儿 session 目录整个清空
 * （曾经真实发生：projects/ 和 excalidraw/ 漏登记，用户点"清理孤儿工作区文件"后 Project 数据被删）。
 * `storage-boundaries.test.ts` 的反射测试会在 config-paths.ts 新增顶层目录 getter 时自动兜底，
 * 但跨包定义的目录（如 packages/shared/src/projects/storage.ts 的 'projects'）需要手动登记。
 */
const WORKSPACE_METADATA_DIRS = new Set([
  'workspace-files',
  'skills',
  'skills-inactive',
  '.claude',
  '.claude-plugin',
  '.recovery-trash',
  'excalidraw',
  /** agent-workspace-manager.ts:getWorkspaceAutoMemoryDir — MyYoda Workspace Memory 根目录 */
  'memory',
  /** packages/shared/src/projects/storage.ts:getWorkspaceProjectsPath — 跨包定义，无法被反射测试自动发现 */
  'projects',
  /** packages/shared/src/tasks/storage.ts — 跨包定义 */
  'tasks',
  /** workspace-label-service.ts:workspaceLabelsConfigPath — 跨包定义 */
  'labels',
  /** expert-binding-service.ts:workspaceExpertBindingsDir — 跨包定义 */
  'expert-bindings',
])

export function isWorkspaceMetadataDir(entryName: string): boolean {
  return WORKSPACE_METADATA_DIRS.has(entryName)
}

export function getWorkspaceMetadataDirNames(): readonly string[] {
  return [...WORKSPACE_METADATA_DIRS]
}
