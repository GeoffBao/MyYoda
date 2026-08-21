export interface EffectivePluginScopeInput {
  workspaceSlug: string | undefined
  projectId: string | undefined
  hasProjectMcp: boolean
  hasProjectSkills: boolean
}

export interface EffectivePluginScope {
  workspaceSlug: string | undefined
  projectId: string | undefined
  mcpScope: 'global' | 'project'
  skillsDirScope: 'workspace' | 'project'
}

/**
 * 解析会话运行时 MCP / Skills 自有层该读哪一层。
 *
 * 对齐 orchestrator 现有规则，不改变注入内容：
 * - MCP：项目有自己的 mcp 才整份覆盖，否则读全局 ~/.myyoda/mcp.json
 * - Skills 自有层目录（标注用）：项目有自己的 skills 才用项目目录，否则工作区目录
 */
export function resolveEffectivePluginScope(input: EffectivePluginScopeInput): EffectivePluginScope {
  return {
    workspaceSlug: input.workspaceSlug,
    projectId: input.projectId,
    mcpScope: input.projectId && input.hasProjectMcp ? 'project' : 'global',
    skillsDirScope: input.projectId && input.hasProjectSkills ? 'project' : 'workspace',
  }
}
