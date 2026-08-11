/** 用户界面中的工作区与项目标准术语。内部类型、IPC 与持久化字段继续使用既有英文名称。 */
export const WORKSPACE_TERMS = {
  noun: '工作区',
  management: '工作区管理',
  create: '新建工作区',
  select: '选择工作区',
  rename: '重命名工作区',
  remove: '删除工作区',
} as const

export const PROJECT_TERMS = {
  noun: '项目',
  create: '新建项目',
  select: '选择项目',
  selectOrCreate: '选择/新建项目',
  clear: '清除项目',
  workingDirectory: '项目工作目录',
} as const
