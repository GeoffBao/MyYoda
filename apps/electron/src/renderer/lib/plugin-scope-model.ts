import type { KanbanProject } from '@/components/app-shell/kanban/types'
import { filterPickableKanbanProjects } from '@/components/app-shell/kanban/types'

/** UI 默认档：全局 MCP + 当前工作区 Skills overlay。 */
export type PluginScope =
  | { kind: 'workspace' }
  | {
      kind: 'project'
      projectId: string
      projectName: string
      hasOwnMcp: boolean
      hasOwnSkills: boolean
    }

export interface PluginScopeFlags {
  hasOwnMcp: boolean
  hasOwnSkills: boolean
}

export interface PluginScopeOption {
  id: string
  label: string
  description: string
  scope: PluginScope
}

const WORKSPACE_DESCRIPTION = '连接器全局共享（所有工作区）；Skills 为当前工作区叠加全局。'

function flagsOf(flags: Record<string, PluginScopeFlags> | undefined, projectId: string): PluginScopeFlags {
  return flags?.[projectId] ?? { hasOwnMcp: false, hasOwnSkills: false }
}

function describeProjectFlags(flags: PluginScopeFlags): string {
  if (flags.hasOwnMcp && flags.hasOwnSkills) {
    return '连接器完全覆盖全局，仅本项目生效；含项目级 Skills'
  }
  if (flags.hasOwnMcp) return '连接器完全覆盖全局，仅本项目生效'
  if (flags.hasOwnSkills) return '含项目级 Skills'
  return 'Skills 叠加工作区/全局；连接器沿用全局配置'
}

export function buildPluginScopeOptions(input: {
  projects: KanbanProject[]
  flags?: Record<string, PluginScopeFlags>
}): PluginScopeOption[] {
  const options: PluginScopeOption[] = [
    {
      id: 'workspace',
      label: '默认配置',
      description: WORKSPACE_DESCRIPTION,
      scope: { kind: 'workspace' },
    },
  ]

  for (const project of filterPickableKanbanProjects(input.projects)) {
    const flags = flagsOf(input.flags, project.id)
    options.push({
      id: `project:${project.id}`,
      label: project.name,
      description: describeProjectFlags(flags),
      scope: {
        kind: 'project',
        projectId: project.id,
        projectName: project.name,
        hasOwnMcp: flags.hasOwnMcp,
        hasOwnSkills: flags.hasOwnSkills,
      },
    })
  }

  return options
}

export function describePluginScope(scope: PluginScope): string {
  switch (scope.kind) {
    case 'workspace':
      return `正在查看默认配置。${WORKSPACE_DESCRIPTION}`
    case 'project':
      return `正在查看项目「${scope.projectName}」。${describeProjectFlags(scope)}`
    default: {
      const _exhaustive: never = scope
      return _exhaustive
    }
  }
}

/** 内容区 notice：连接器 / Skills 两维分开说，禁止「沿用 Workspace 默认」那种混写。 */
export function describePluginScopeNotice(scope: PluginScope): string | null {
  switch (scope.kind) {
    case 'workspace':
      return null
    case 'project': {
      const mcpLine = scope.hasOwnMcp
        ? '连接器完全覆盖全局，仅本项目生效'
        : '连接器沿用全局配置'
      const skillsLine = scope.hasOwnSkills
        ? '含项目级 Skills'
        : 'Skills 叠加工作区/全局'
      return `项目「${scope.projectName}」：${skillsLine}；${mcpLine}`
    }
    default: {
      const _exhaustive: never = scope
      return _exhaustive
    }
  }
}

/** 项目从可选项消失时回到默认档（工作区切换后 atom 已按当前 slug 过滤，不再比对 workspaceId）。 */
export function resolvePluginScope(scope: PluginScope, projects: readonly KanbanProject[]): PluginScope {
  switch (scope.kind) {
    case 'workspace':
      return scope
    case 'project': {
      const stillPickable = filterPickableKanbanProjects(projects).some((project) => project.id === scope.projectId)
      return stillPickable ? scope : { kind: 'workspace' }
    }
    default: {
      const _exhaustive: never = scope
      return _exhaustive
    }
  }
}

export function applyPluginScopeFlags(
  scope: PluginScope,
  flags: Record<string, PluginScopeFlags> | undefined,
): PluginScope {
  switch (scope.kind) {
    case 'workspace':
      return scope
    case 'project': {
      const next = flagsOf(flags, scope.projectId)
      if (next.hasOwnMcp === scope.hasOwnMcp && next.hasOwnSkills === scope.hasOwnSkills) return scope
      return {
        kind: 'project',
        projectId: scope.projectId,
        projectName: scope.projectName,
        hasOwnMcp: next.hasOwnMcp,
        hasOwnSkills: next.hasOwnSkills,
      }
    }
    default: {
      const _exhaustive: never = scope
      return _exhaustive
    }
  }
}

/** 用当前可选项同步 scope：项目消失则回默认档，flags 以 option.scope 为准。 */
export function syncPluginScope(scope: PluginScope, options: readonly PluginScopeOption[]): PluginScope {
  switch (scope.kind) {
    case 'workspace':
      return scope
    case 'project': {
      const match = options.find((option) => option.scope.kind === 'project' && option.scope.projectId === scope.projectId)
      return match?.scope.kind === 'project' ? match.scope : { kind: 'workspace' }
    }
    default: {
      const _exhaustive: never = scope
      return _exhaustive
    }
  }
}

/** 仅当项目已有连接器覆盖时才写入项目档；否则编辑沿用全局，避免把空配置存成整份覆盖。 */
export function resolveMcpWriteProjectId(
  scopeProjectId: string | null | undefined,
  mcpIsProjectOverride: boolean,
): string | null {
  if (!mcpIsProjectOverride) return null
  return scopeProjectId ?? null
}
