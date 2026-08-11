import { z } from 'zod'
import type {
  CreateProjectInput,
  LoadedProject,
  ProjectAsset,
  ProjectConfig,
  ProjectPromptContext,
  UpdateProjectInput,
  UploadProjectAssetInput,
} from '@myyoda/shared/projects'
import {
  createProject as createProjectInStorage,
  deleteProject as deleteProjectInStorage,
  deleteProjectAsset as deleteProjectAssetInStorage,
  getProjectMemoryPath,
  listProjectAssets as listProjectAssetsInStorage,
  loadProject,
  loadProjectById,
  loadProjectMemory,
  loadWorkspaceProjects,
  readProjectMemory,
  updateProject as updateProjectInStorage,
  uploadProjectAsset as uploadProjectAssetInStorage,
  writeProjectMemory as writeProjectMemoryInStorage,
} from '../../../../../packages/shared/src/projects/storage.ts'
import { getAgentWorkspace } from './agent-workspace-manager'
import { getAgentWorkspacePath } from './config-paths'
import {
  assertRunnableCwd,
  resolveEffectiveCwd,
  type EffectiveCwdResult,
} from './project-path-service'

const WorkspaceIdSchema = z.string().min(1, 'workspaceId 必填')
const ProjectSlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'project slug 必须是 URL-safe slug')
const ProjectNameSchema = z.string().trim().min(1, '项目名称不能为空')
const OptionalProjectStringSchema = z.string().optional()
const ProjectKindSchema = z.enum(['project', 'home', 'ad-hoc'])
const KanbanColumnDefSchema = z.object({
  id: z.string().min(1, '列 id 不能为空'),
  name: z.string().min(1, '列名称不能为空'),
  color: z.string().optional(),
  dropStatusId: z.string().optional(),
})
const CreateProjectInputSchema = z.object({
  name: ProjectNameSchema,
  description: OptionalProjectStringSchema,
  workingDirectory: OptionalProjectStringSchema,
  details: OptionalProjectStringSchema,
  colorTheme: OptionalProjectStringSchema,
  color: OptionalProjectStringSchema,
  kind: ProjectKindSchema.optional(),
})
const UpdateProjectInputSchema = z.object({
  name: ProjectNameSchema.optional(),
  description: OptionalProjectStringSchema,
  workingDirectory: OptionalProjectStringSchema,
  details: OptionalProjectStringSchema,
  colorTheme: OptionalProjectStringSchema,
  color: OptionalProjectStringSchema,
  archivedAt: z.number().optional(),
  defaultExpertId: OptionalProjectStringSchema,
  kanbanColumns: z.array(KanbanColumnDefSchema).optional(),
})

export interface ProjectRepositoryOptions {
  resolveWorkspaceRoot?: (workspaceId: string) => string
}

function resolveWorkspaceRootFromManager(workspaceId: string): string {
  const workspace = getAgentWorkspace(workspaceId)
  if (!workspace) {
    throw new Error(`工作区不存在: ${workspaceId}`)
  }
  return getAgentWorkspacePath(workspace.slug)
}

function requireLoadedProject(workspaceRoot: string, slug: string): LoadedProject {
  const project = loadProject(workspaceRoot, slug)
  if (!project) throw new Error(`项目创建或更新后无法重新加载: ${slug}`)
  return project
}

export class ProjectRepository {
  constructor(private readonly options: ProjectRepositoryOptions = {}) {}

  private resolveWorkspaceRoot(workspaceId: string): string {
    const parsedWorkspaceId = WorkspaceIdSchema.parse(workspaceId)
    return (this.options.resolveWorkspaceRoot ?? resolveWorkspaceRootFromManager)(parsedWorkspaceId)
  }

  private parseProjectSlug(projectSlug: string): string {
    return ProjectSlugSchema.parse(projectSlug)
  }

  private parseCreateProjectInput(input: CreateProjectInput): CreateProjectInput {
    return CreateProjectInputSchema.parse(input)
  }

  private parseUpdateProjectInput(input: UpdateProjectInput): UpdateProjectInput {
    return UpdateProjectInputSchema.parse(input)
  }

  // ===== workspaceId 路径（内部服务用） =====

  listProjects(workspaceId: string): LoadedProject[] {
    return this.listProjectsAtRoot(this.resolveWorkspaceRoot(workspaceId))
  }

  getProject(workspaceId: string, projectSlug: string): LoadedProject | null {
    return loadProject(this.resolveWorkspaceRoot(workspaceId), this.parseProjectSlug(projectSlug))
  }

  createProject(workspaceId: string, input: CreateProjectInput): ProjectConfig {
    return this.createProjectAtRoot(this.resolveWorkspaceRoot(workspaceId), input).config
  }

  updateProject(workspaceId: string, projectSlug: string, input: UpdateProjectInput): ProjectConfig {
    return this.updateProjectAtRoot(this.resolveWorkspaceRoot(workspaceId), projectSlug, input).config
  }

  deleteProject(workspaceId: string, projectSlug: string): void {
    this.deleteProjectAtRoot(this.resolveWorkspaceRoot(workspaceId), projectSlug)
  }

  listProjectAssets(workspaceId: string, projectSlug: string): ProjectAsset[] {
    return this.listProjectAssetsAtRoot(this.resolveWorkspaceRoot(workspaceId), projectSlug)
  }

  uploadProjectAsset(workspaceId: string, projectSlug: string, input: UploadProjectAssetInput): ProjectAsset {
    return this.uploadProjectAssetAtRoot(this.resolveWorkspaceRoot(workspaceId), projectSlug, input)
  }

  deleteProjectAsset(workspaceId: string, projectSlug: string, filename: string): void {
    this.deleteProjectAssetAtRoot(this.resolveWorkspaceRoot(workspaceId), projectSlug, filename)
  }

  readProjectMemory(workspaceId: string, projectSlug: string): string {
    return this.readProjectMemoryAtRoot(this.resolveWorkspaceRoot(workspaceId), projectSlug)
  }

  writeProjectMemory(workspaceId: string, projectSlug: string, content: string): void {
    this.writeProjectMemoryAtRoot(this.resolveWorkspaceRoot(workspaceId), projectSlug, content)
  }

  // ===== workspaceRoot 路径（IPC 直接用） =====

  listProjectsAtRoot(workspaceRoot: string): LoadedProject[] {
    return loadWorkspaceProjects(workspaceRoot)
  }

  getProjectAtRoot(workspaceRoot: string, idOrSlug: string): LoadedProject | null {
    const bySlug = /^[a-z0-9][a-z0-9-]*$/.test(idOrSlug)
      ? loadProject(workspaceRoot, idOrSlug)
      : null
    return bySlug ?? loadProjectById(workspaceRoot, idOrSlug)
  }

  createProjectAtRoot(workspaceRoot: string, input: CreateProjectInput): LoadedProject {
    const config = createProjectInStorage(workspaceRoot, this.parseCreateProjectInput(input))
    return requireLoadedProject(workspaceRoot, config.slug)
  }

  updateProjectAtRoot(workspaceRoot: string, projectSlug: string, input: UpdateProjectInput): LoadedProject {
    const slug = this.parseProjectSlug(projectSlug)
    const parsed = this.parseUpdateProjectInput(input)
    const existing = loadProject(workspaceRoot, slug)
    if (existing?.config.kind && existing.config.kind !== 'project') {
      if (parsed.name !== undefined && parsed.name !== existing.config.name) {
        throw new Error('隐藏容器 Project 不支持重命名')
      }
      if (parsed.archivedAt !== undefined) {
        throw new Error('隐藏容器 Project 不支持归档')
      }
    }
    const config = updateProjectInStorage(workspaceRoot, slug, parsed)
    return requireLoadedProject(workspaceRoot, config.slug)
  }

  assertProjectDeletableAtRoot(workspaceRoot: string, projectSlug: string): string {
    const slug = this.parseProjectSlug(projectSlug)
    const existing = loadProject(workspaceRoot, slug)
    if (existing?.config.kind && existing.config.kind !== 'project') {
      throw new Error('隐藏容器 Project 不支持删除')
    }
    return slug
  }

  deleteProjectAtRoot(workspaceRoot: string, projectSlug: string): void {
    const slug = this.assertProjectDeletableAtRoot(workspaceRoot, projectSlug)
    deleteProjectInStorage(workspaceRoot, slug)
  }

  listProjectAssetsAtRoot(workspaceRoot: string, projectSlug: string): ProjectAsset[] {
    return listProjectAssetsInStorage(workspaceRoot, this.parseProjectSlug(projectSlug))
  }

  uploadProjectAssetAtRoot(
    workspaceRoot: string,
    projectSlug: string,
    input: UploadProjectAssetInput,
  ): ProjectAsset {
    return uploadProjectAssetInStorage(workspaceRoot, this.parseProjectSlug(projectSlug), input)
  }

  deleteProjectAssetAtRoot(workspaceRoot: string, projectSlug: string, filename: string): void {
    deleteProjectAssetInStorage(workspaceRoot, this.parseProjectSlug(projectSlug), filename)
  }

  readProjectMemoryAtRoot(workspaceRoot: string, projectSlug: string): string {
    return readProjectMemory(workspaceRoot, this.parseProjectSlug(projectSlug))
  }

  writeProjectMemoryAtRoot(workspaceRoot: string, projectSlug: string, content: string): void {
    writeProjectMemoryInStorage(workspaceRoot, this.parseProjectSlug(projectSlug), content)
  }

  /** 解析项目有效工作目录（托管 workdir 或可访问的外部主目录）；不可用时返回 undefined */
  resolveWorkingDirectory(workspaceRoot: string, projectId?: string): string | undefined {
    const result = this.resolveEffectiveCwdForProject(workspaceRoot, projectId)
    if (!result || result.status === 'unavailable') return undefined
    return result.cwd
  }

  /** 查询 Project 有效 cwd 与路径状态（含 unavailable，供 UI / 运行前校验） */
  resolveEffectiveCwdForProject(
    workspaceRoot: string,
    projectId?: string,
  ): EffectiveCwdResult | null {
    if (!projectId) return null
    const loaded = this.getProjectAtRoot(workspaceRoot, projectId)
    if (!loaded) return null
    return resolveEffectiveCwd(workspaceRoot, loaded.config)
  }

  /** 运行前断言有效 cwd；不可用主目录不静默回退 */
  requireRunnableWorkingDirectory(workspaceRoot: string, projectId?: string): string | undefined {
    if (!projectId) return undefined
    const result = this.resolveEffectiveCwdForProject(workspaceRoot, projectId)
    if (!result) return undefined
    return assertRunnableCwd(result)
  }

  /** 构建注入 Agent prompt 的项目上下文 */
  buildPromptContext(workspaceRoot: string, projectId: string): ProjectPromptContext | null {
    const project = this.getProjectAtRoot(workspaceRoot, projectId)
    if (!project) return null
    const assets = listProjectAssetsInStorage(workspaceRoot, project.config.slug)
    const memoryContent = loadProjectMemory(workspaceRoot, project.config.slug)
    return {
      name: project.config.name,
      ...(project.config.description ? { description: project.config.description } : {}),
      ...(project.config.details ? { details: project.config.details } : {}),
      ...(project.config.workingDirectory ? { workingDirectory: project.config.workingDirectory } : {}),
      assetsPath: project.assetsPath,
      assets: assets.map((asset) => ({
        filename: asset.filename,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
      })),
      memoryPath: getProjectMemoryPath(workspaceRoot, project.config.slug),
      ...(memoryContent ? { memoryContent } : {}),
    }
  }
}

/** 主进程单例：IPC 与冷启动共用 */
export const projectRepository = new ProjectRepository()
