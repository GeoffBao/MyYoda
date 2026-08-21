import { describe, expect, test } from 'bun:test'
import { resolveEffectivePluginScope } from './agent-plugin-profile'

describe('resolveEffectivePluginScope', () => {
  test('无 project 时 MCP 走全局、Skills 自有层走工作区', () => {
    expect(
      resolveEffectivePluginScope({
        workspaceSlug: 'default',
        projectId: undefined,
        hasProjectMcp: false,
        hasProjectSkills: false,
      }),
    ).toEqual({
      workspaceSlug: 'default',
      projectId: undefined,
      mcpScope: 'global',
      skillsDirScope: 'workspace',
    })
  })

  test('project 只有 MCP overlay 时仅 MCP 走项目覆盖', () => {
    expect(
      resolveEffectivePluginScope({
        workspaceSlug: 'default',
        projectId: 'p1',
        hasProjectMcp: true,
        hasProjectSkills: false,
      }),
    ).toEqual({
      workspaceSlug: 'default',
      projectId: 'p1',
      mcpScope: 'project',
      skillsDirScope: 'workspace',
    })
  })

  test('project 只有 Skills overlay 时仅 Skills 自有层走项目', () => {
    expect(
      resolveEffectivePluginScope({
        workspaceSlug: 'default',
        projectId: 'p1',
        hasProjectMcp: false,
        hasProjectSkills: true,
      }),
    ).toEqual({
      workspaceSlug: 'default',
      projectId: 'p1',
      mcpScope: 'global',
      skillsDirScope: 'project',
    })
  })

  test('MCP 与 Skills overlay 都有时两层都走项目', () => {
    expect(
      resolveEffectivePluginScope({
        workspaceSlug: 'default',
        projectId: 'p1',
        hasProjectMcp: true,
        hasProjectSkills: true,
      }),
    ).toEqual({
      workspaceSlug: 'default',
      projectId: 'p1',
      mcpScope: 'project',
      skillsDirScope: 'project',
    })
  })

  test('无 workspaceSlug 时仍按 overlay 布尔算 scope，并原样回传 slug/projectId', () => {
    expect(
      resolveEffectivePluginScope({
        workspaceSlug: undefined,
        projectId: 'p1',
        hasProjectMcp: true,
        hasProjectSkills: false,
      }),
    ).toEqual({
      workspaceSlug: undefined,
      projectId: 'p1',
      mcpScope: 'project',
      skillsDirScope: 'workspace',
    })
  })

  test('无 projectId 时即使 overlay 布尔为 true 也不升到 project', () => {
    expect(
      resolveEffectivePluginScope({
        workspaceSlug: 'default',
        projectId: undefined,
        hasProjectMcp: true,
        hasProjectSkills: true,
      }),
    ).toEqual({
      workspaceSlug: 'default',
      projectId: undefined,
      mcpScope: 'global',
      skillsDirScope: 'workspace',
    })
  })
})
