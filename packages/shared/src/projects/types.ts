/**
 * 项目类型定义 — Projects & Kanban
 *
 * 项目是 workspace 级的分组实体，将会话、工作目录和共享资产组织在一起。
 * 参照 OSS: packages/shared/src/projects/types.ts
 *
 * 磁盘结构:
 * {workspaceRootPath}/projects/{projectSlug}/
 *   ├── config.json   — 项目配置
 *   └── assets/       — 上传的文件（PDF、图片、文档）
 */

/**
 * 看板列定义（对齐 craft-agents-oss 的 KanbanColumnDef）
 *
 * 列位置（column）与状态徽标（statusId）解耦：
 * - id：列的唯一标识，卡片拖入该列时写入 TaskRecord.kanbanColumn
 * - name：列标题
 * - dropStatusId：拖卡片到此列时自动套用的状态（可选，松耦合存 TaskWorkflow 字符串）
 * - color：列主题色（可选）
 */
export interface KanbanColumnDef {
  id: string;
  name: string;
  dropStatusId?: string;
  color?: string;
}

/**
 * 项目主配置（存储在 config.json 中）
 */
export interface ProjectConfig {
  id: string;
  slug: string;
  name: string;
  /** 列表/详情中显示的简短描述 */
  description?: string;
  /** 绑定的工作目录绝对路径；新会话继承此路径 */
  workingDirectory?: string;
  /** 注入系统提示词的自由文本 */
  details?: string;
  /** 可选颜色主题 ID */
  colorTheme?: string;
  /** 强调色（hex），会话列表中显示 */
  color?: string;
  createdAt: number;
  updatedAt: number;
  /** 归档时间（设置后从侧边栏隐藏但保留磁盘数据） */
  archivedAt?: number;
  /** 默认 Agent 专家 ID（仅存储展示，本阶段不注入编排器） */
  defaultExpertId?: string;
  /**
   * Project 归属类型；缺省（undefined）等价于 'project'，即用户创建的普通项目。
   * 'home' / 'ad-hoc' 是历史遗留的隐藏容器 kind（存量 config 读兼容）；新建项目不再产生。
   */
  kind?: 'project' | 'home' | 'ad-hoc';
  /** 项目自定义看板列；未设置时用全局默认列（列即状态） */
  kanbanColumns?: KanbanColumnDef[];
  /**
   * 项目记忆（MEMORY.md）存放位置，创建时一次性决定，不做事后迁移：
   * - 'project'：落在 `workingDirectory/.context/MEMORY.md`，跟随项目真实文件夹
   * - 'workspace' / 未设置：沿用 MyYoda 托管目录 `projects/{slug}/MEMORY.md`（老项目、空白项目的默认行为，保持完全兼容）
   */
  memoryLocation?: 'workspace' | 'project';
}

/**
 * 项目资产（读取时从 assets 目录解析）
 */
export interface ProjectAsset {
  filename: string;
  sizeBytes: number;
  mimeType: string;
  uploadedAt: number;
  /** 磁盘绝对路径（运行时解析，不持久化） */
  absolutePath: string;
}

/**
 * 创建项目的输入（不含自动生成字段）
 */
export interface CreateProjectInput {
  name: string;
  description?: string;
  workingDirectory?: string;
  details?: string;
  colorTheme?: string;
  color?: string;
  /** 历史遗留字段（隐藏容器 kind）；普通创建入口不应传递，新项目不再产生。 */
  kind?: 'project' | 'home' | 'ad-hoc';
}

/**
 * 完全加载的项目（配置 + 文件夹路径）
 */
export interface LoadedProject {
  config: ProjectConfig;
  /** 项目文件夹绝对路径 */
  folderPath: string;
  /** 项目 assets 目录绝对路径 */
  assetsPath: string;
  /** workspace 根路径 */
  workspaceRootPath: string;
  /** workspace ID（派生自 basename(workspaceRootPath)） */
  workspaceId: string;
}

/**
 * 项目上下文（用于系统提示词注入）
 * 与 ProjectConfig 解耦以便隔离测试 prompt builder
 */
export interface ProjectPromptContext {
  name: string;
  description?: string;
  details?: string;
  /** 项目工程代码所在的工作目录绝对路径（用户绑定时指定） */
  workingDirectory?: string;
  assetsPath: string;
  /** 引用文件的轻量清单（最新优先）；内容按需读取 */
  assets: { filename: string; mimeType: string; sizeBytes: number }[];
  /** MEMORY.md 绝对路径，Agent 知道在哪里持久化知识 */
  memoryPath: string;
  /** 已按 token 上限截断的 MEMORY.md 内容 */
  memoryContent?: string;
  /** workingDirectory 是否为本会话绑定的 Git Worktree 隔离路径（而非 Project 静态配置） */
  isWorktree?: boolean;
}

/**
 * 项目更新输入
 */
export interface UpdateProjectInput {
  name?: string;
  description?: string;
  workingDirectory?: string;
  details?: string;
  colorTheme?: string;
  color?: string;
  /** 设置值为 undefined 以取消归档 */
  archivedAt?: number;
  /** 默认 Agent 专家 ID（仅存储展示，本阶段不注入编排器） */
  defaultExpertId?: string;
  /** 项目自定义看板列；传 undefined 保持现状，传 [] 清除自定义列回退默认 */
  kanbanColumns?: KanbanColumnDef[];
}

/**
 * 上传项目资产的输入
 */
export interface UploadProjectAssetInput {
  filename: string;
  /** Base64 编码的内容（IPC 跨进程传输首选） */
  base64?: string;
  /** 纯文本内容（小文本/Markdown 上传） */
  text?: string;
  /** 磁盘源文件绝对路径（复制到 assets 目录） */
  sourcePath?: string;
}
