/**
 * useAgentSkillsData — Agent 技能视图的数据层
 *
 * 封装当前工作区（或工作区下某个嵌套 Project）的 Skills / MCP 加载与增删改逻辑（IPC 调用），
 * 供「Agent 技能」全屏视图复用。当前 Skills 页面挂载期间固定初始快照，
 * 避免文件监听导致的重排和整页跳动；开关仅更新对应卡片的 enabled 字段，不 bump 版本。
 * 离开后下次进入、切换工作区或切换范围时再重新读取完整能力列表。删除/更新/MCP 写操作仍会 bump
 * workspaceCapabilitiesVersionAtom，通知侧边栏等订阅方刷新。
 *
 * 范围（scope）：
 * - MCP 现在是「全局唯一配置」（~/.myyoda/mcp.json，所有工作区共享）：projectId 未传时读写
 *   全局配置；projectId 传入且该 Project 已自己配置过 MCP 时，读写路由到项目专属存储（完全覆盖，
 *   不与全局合并）。切换工作区不会改变 MCP 列表——这是预期行为，不是 bug。
 * - Skills 是「全局默认 + 工作区/项目覆盖」三层：始终通过 getAllEffectiveSkills 读取全局 + 工作区
 *   （+ 已配置的嵌套 Project）合并后的完整列表，每个 SkillMeta 带 scope 标签。写操作
 *   （toggle/delete）按该 Skill 实际所在层路由到 global / workspace / project 对应 IPC。
 * - Memory（记忆）与内置 MCP（builtinMcpServers）**不随 projectId 变化**：前者始终工作区级
 *   （AGENTS.md 只在工作区层可写），后者是全局设置，与工作区/项目无关。
 * - 「更新 Skill 来源」（社区/组织同步）v1 只支持工作区级；项目级 Skill 与全局 Skill 目前都不会
 *   出现 hasUpdate（全局 Skill 没有导入来源追踪），调用会被拦截并提示。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import {
  agentWorkspacesAtom,
  currentAgentWorkspaceIdAtom,
  workspaceCapabilitiesVersionAtom,
} from '@/atoms/agent-atoms'
import type { BuiltinMcpServerSummary, SkillMeta, WorkspaceCapabilities, WorkspaceMcpConfig } from '@myyoda/shared'

export interface AgentSkillsData {
  /** 当前工作区（未选中时为 null） */
  workspaceSlug: string
  workspaceName: string
  hasWorkspace: boolean
  loading: boolean
  /** 生效的 Skill 列表（全局 + 工作区 + 已配置的项目，三层合并，带 scope/shadowedByGlobal） */
  skills: SkillMeta[]
  defaultSkillSlugs: Set<string>
  /** 当前 scope（工作区或项目）自有的 Skills 目录，用于“打开目录”“AI 分类”等定位到具体路径 */
  skillsDir: string
  /** 全局 Skills 目录（~/.myyoda/global-skills/） */
  globalSkillsDir: string
  /** 生效的 MCP 配置：projectId 未传或项目未自配置时为全局配置，否则为项目覆盖配置 */
  mcpConfig: WorkspaceMcpConfig
  /** 当前 mcpConfig 是否来自项目覆盖（true）还是全局配置（false），供 UI 提示区分 */
  mcpIsProjectOverride: boolean
  /** 工作区级能力摘要（builtinMcpServers / memory），不随 projectId 变化 */
  capabilities: WorkspaceCapabilities | null
  builtinMcpServers: BuiltinMcpServerSummary[]
  updatingSkill: string | null
  toggleSkill: (slug: string, enabled: boolean) => Promise<void>
  deleteSkill: (slug: string, name: string) => Promise<boolean>
  updateSkill: (slug: string) => Promise<void>
  toggleMcp: (name: string, enabled: boolean) => Promise<void>
  toggleBuiltinMcp: (id: string, enabled: boolean) => Promise<void>
  deleteMcp: (name: string) => Promise<void>
  /** 在系统文件管理器中打开某个 Skill 所在目录（按其 scope 自动定位到 global/workspace/project） */
  openSkillFolder: (skill: SkillMeta) => void
}

export function useAgentSkillsData(projectId?: string | null): AgentSkillsData {
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const bumpCapabilitiesVersion = useSetAtom(workspaceCapabilitiesVersionAtom)

  const currentWorkspace = workspaces.find((w) => w.id === currentWorkspaceId)
  const workspaceSlug = currentWorkspace?.slug ?? ''
  const scopeProjectId = projectId ?? null

  const [loading, setLoading] = React.useState(true)
  const [skills, setSkills] = React.useState<SkillMeta[]>([])
  const [defaultSkillSlugs, setDefaultSkillSlugs] = React.useState<Set<string>>(new Set())
  const [skillsDir, setSkillsDir] = React.useState('')
  const [globalSkillsDir, setGlobalSkillsDir] = React.useState('')
  const [mcpConfig, setMcpConfig] = React.useState<WorkspaceMcpConfig>({ servers: {} })
  const [mcpIsProjectOverride, setMcpIsProjectOverride] = React.useState(false)
  const [capabilities, setCapabilities] = React.useState<WorkspaceCapabilities | null>(null)
  const [builtinMcpServers, setBuiltinMcpServers] = React.useState<BuiltinMcpServerSummary[]>([])
  const [updatingSkill, setUpdatingSkill] = React.useState<string | null>(null)

  const loadData = React.useCallback(async () => {
    if (!workspaceSlug) {
      setSkills([])
      setMcpConfig({ servers: {} })
      setMcpIsProjectOverride(false)
      setCapabilities(null)
      setBuiltinMcpServers([])
      setSkillsDir('')
      setGlobalSkillsDir('')
      setLoading(false)
      return
    }
    try {
      // 工作区能力摘要（builtinMcpServers + memory）始终按工作区取，与 scope 无关
      const [defaultSlugs, workspaceCapabilities, globalDir] = await Promise.all([
        window.electronAPI.getDefaultSkillSlugs(),
        window.electronAPI.getWorkspaceCapabilities(workspaceSlug),
        window.electronAPI.getGlobalSkillsDir(),
      ])
      setDefaultSkillSlugs(new Set(defaultSlugs))
      setCapabilities(workspaceCapabilities)
      setBuiltinMcpServers(workspaceCapabilities.builtinMcpServers)
      setGlobalSkillsDir(globalDir)

      // MCP：项目已自配置时用项目覆盖，否则用全局唯一配置（不再按工作区隔离）
      const projectHasOwnMcp = scopeProjectId ? await window.electronAPI.hasProjectMcpServers(workspaceSlug, scopeProjectId) : false
      setMcpIsProjectOverride(projectHasOwnMcp)
      const config = projectHasOwnMcp && scopeProjectId
        ? await window.electronAPI.getProjectMcpConfig(workspaceSlug, scopeProjectId)
        : await window.electronAPI.getGlobalMcpConfig()
      setMcpConfig(config)

      // Skills：全局 + 工作区 + 已配置项目三层合并；skillsDir 仍取“当前 scope 自有目录”供打开/分类用
      const [skillList, dir] = await Promise.all([
        window.electronAPI.getAllEffectiveSkills(workspaceSlug, scopeProjectId ?? undefined),
        scopeProjectId
          ? window.electronAPI.getProjectSkillsDir(workspaceSlug, scopeProjectId)
          : window.electronAPI.getWorkspaceSkillsDir(workspaceSlug),
      ])
      setSkills(skillList)
      setSkillsDir(dir)
    } catch (error) {
      console.error('[Agent 技能] 加载配置失败:', error)
    } finally {
      setLoading(false)
    }
  }, [workspaceSlug, scopeProjectId])

  // 只在进入页面、切换工作区或切换范围（Project/工作区默认）时读取；不订阅 capabilitiesVersion——
  // 文件监听会在切换开关后异步推送能力变化，这里刻意不订阅它，防止扫描 active/inactive 目录后重排当前列表。
  React.useEffect(() => {
    setLoading(true)
    void loadData()
  }, [loadData])

  const toggleSkill = React.useCallback(async (slug: string, enabled: boolean) => {
    try {
      const target = skills.find((s) => s.slug === slug)
      if (target?.scope === 'global') {
        await window.electronAPI.toggleGlobalSkill(slug, enabled)
      } else if (target?.scope === 'project' && scopeProjectId) {
        await window.electronAPI.toggleProjectSkill(workspaceSlug, scopeProjectId, slug, enabled)
      } else {
        await window.electronAPI.toggleWorkspaceSkill(workspaceSlug, slug, enabled)
      }
      setSkills((prev) => prev.map((s) => (s.slug === slug ? { ...s, enabled } : s)))
    } catch (error) {
      console.error('[Agent 技能] 切换 Skill 状态失败:', error)
      toast.error('切换 Skill 状态失败')
    }
  }, [workspaceSlug, scopeProjectId, skills])

  const deleteSkill = React.useCallback(async (slug: string, name: string): Promise<boolean> => {
    try {
      const target = skills.find((s) => s.slug === slug)
      if (target?.scope === 'global') {
        await window.electronAPI.deleteGlobalSkill(slug)
      } else if (target?.scope === 'project' && scopeProjectId) {
        await window.electronAPI.deleteProjectSkill(workspaceSlug, scopeProjectId, slug)
      } else {
        await window.electronAPI.deleteWorkspaceSkill(workspaceSlug, slug)
      }
      setSkills((prev) => prev.filter((s) => s.slug !== slug))
      bumpCapabilitiesVersion((v) => v + 1)
      toast.success(`已删除 Skill：${name}`)
      return true
    } catch (error) {
      console.error('[Agent 技能] 删除 Skill 失败:', error)
      toast.error('删除 Skill 失败')
      return false
    }
  }, [workspaceSlug, scopeProjectId, skills, bumpCapabilitiesVersion])

  const updateSkill = React.useCallback(async (slug: string) => {
    if (!workspaceSlug || updatingSkill) return
    const target = skills.find((s) => s.slug === slug)
    // v1：Skill 来源更新（社区/组织同步）仅支持工作区级；全局/项目级 Skill 没有导入来源追踪体系。
    if (target?.scope === 'global') {
      toast.error('全局 Skill 暂不支持一键更新来源')
      return
    }
    if (scopeProjectId) {
      toast.error('项目级 Skill 暂不支持一键更新来源，请到工作区 Skills 里操作对应来源')
      return
    }
    setUpdatingSkill(slug)
    try {
      const existing = target
      const updated = existing?.importSource?.sourceType === 'organization'
        ? await window.electronAPI.orgUpdateSkill(workspaceSlug, slug)
        : await window.electronAPI.updateSkillFromSource(workspaceSlug, slug)
      setSkills((prev) => prev.map((s) => (s.slug === slug ? { ...updated, scope: s.scope } : s)))
      bumpCapabilitiesVersion((v) => v + 1)
      toast.success(`已同步更新 Skill：${updated.name}`)
    } catch (error) {
      console.error('[Agent 技能] 更新 Skill 失败:', error)
      const message = error instanceof Error ? error.message : '未知错误'
      toast.error('更新 Skill 失败', { description: message })
    } finally {
      setUpdatingSkill(null)
    }
  }, [workspaceSlug, scopeProjectId, updatingSkill, bumpCapabilitiesVersion, skills])

  const openSkillFolder = React.useCallback((skill: SkillMeta): void => {
    const baseDir = skill.scope === 'global' ? globalSkillsDir : skillsDir
    if (baseDir) window.electronAPI.openFile(`${baseDir}/${skill.slug}`)
  }, [globalSkillsDir, skillsDir])

  const toggleMcp = React.useCallback(async (name: string, enabled: boolean) => {
    try {
      const entry = mcpConfig.servers[name]
      if (!entry) return
      const newConfig: WorkspaceMcpConfig = {
        servers: { ...mcpConfig.servers, [name]: { ...entry, enabled } },
      }
      if (mcpIsProjectOverride && scopeProjectId) {
        await window.electronAPI.saveProjectMcpConfig(workspaceSlug, scopeProjectId, newConfig)
      } else {
        await window.electronAPI.saveGlobalMcpConfig(newConfig)
      }
      setMcpConfig(newConfig)
      bumpCapabilitiesVersion((v) => v + 1)
    } catch (error) {
      console.error('[Agent 技能] 切换 MCP 服务器状态失败:', error)
      toast.error('切换 MCP 状态失败')
    }
  }, [workspaceSlug, scopeProjectId, mcpConfig, mcpIsProjectOverride, bumpCapabilitiesVersion])

  // 内置 MCP（nano-banana / 浏览器工具等）是全局设置，与工作区、项目均无关，scope 切换不影响它
  const toggleBuiltinMcp = React.useCallback(async (id: string, enabled: boolean) => {
    try {
      const nextCapabilities = await window.electronAPI.setBuiltinMcpEnabled(workspaceSlug, id, enabled)
      setCapabilities(nextCapabilities)
      setBuiltinMcpServers(nextCapabilities.builtinMcpServers)
      bumpCapabilitiesVersion((v) => v + 1)
      toast.success(enabled ? '已启用内置 MCP' : '已关闭内置 MCP')
    } catch (error) {
      console.error('[Agent 技能] 切换内置 MCP 状态失败:', error)
      toast.error('切换内置 MCP 状态失败')
    }
  }, [workspaceSlug, bumpCapabilitiesVersion])

  const deleteMcp = React.useCallback(async (name: string) => {
    const entry = mcpConfig.servers[name]
    if (entry?.isBuiltin) return
    try {
      const newServers = { ...mcpConfig.servers }
      delete newServers[name]
      const newConfig: WorkspaceMcpConfig = { servers: newServers }
      if (mcpIsProjectOverride && scopeProjectId) {
        await window.electronAPI.saveProjectMcpConfig(workspaceSlug, scopeProjectId, newConfig)
      } else {
        await window.electronAPI.saveGlobalMcpConfig(newConfig)
      }
      setMcpConfig(newConfig)
      bumpCapabilitiesVersion((v) => v + 1)
      toast.success(`已删除 MCP 服务器：${name}`)
    } catch (error) {
      console.error('[Agent 技能] 删除 MCP 服务器失败:', error)
      toast.error('删除 MCP 服务器失败')
    }
  }, [workspaceSlug, scopeProjectId, mcpConfig, mcpIsProjectOverride, bumpCapabilitiesVersion])

  return {
    workspaceSlug,
    workspaceName: currentWorkspace?.name ?? '',
    hasWorkspace: !!currentWorkspace,
    loading,
    skills,
    defaultSkillSlugs,
    skillsDir,
    globalSkillsDir,
    mcpConfig,
    mcpIsProjectOverride,
    capabilities,
    builtinMcpServers,
    updatingSkill,
    toggleSkill,
    deleteSkill,
    updateSkill,
    toggleMcp,
    toggleBuiltinMcp,
    deleteMcp,
    openSkillFolder,
  }
}
