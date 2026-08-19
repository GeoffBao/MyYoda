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
 * - projectId 未传：工作区级（今天的行为）。
 * - projectId 传入：Skills / MCP 读写全部路由到该嵌套 Project 自己的存储（未配置时后端自动回退，
 *   这里前端直接调用项目专属 IPC，天然拿到项目级空数据，不需要额外判断）。
 * - Memory（记忆）与内置 MCP（builtinMcpServers）**不随 projectId 变化**：前者始终工作区级
 *   （AGENTS.md 只在工作区层可写），后者是全局设置，与工作区/项目无关。
 * - 「更新 Skill 来源」（社区/组织同步）v1 只支持工作区级；项目级调用会被 updateSkill 内部拦截并提示。
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
  skills: SkillMeta[]
  defaultSkillSlugs: Set<string>
  skillsDir: string
  mcpConfig: WorkspaceMcpConfig
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
  /** 重新拉取工作区能力摘要（凭据保存后刷新内置连接器卡片状态，如「需配置」→「已启用」） */
  refreshBuiltinMcp: () => Promise<void>
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
  const [mcpConfig, setMcpConfig] = React.useState<WorkspaceMcpConfig>({ servers: {} })
  const [capabilities, setCapabilities] = React.useState<WorkspaceCapabilities | null>(null)
  const [builtinMcpServers, setBuiltinMcpServers] = React.useState<BuiltinMcpServerSummary[]>([])
  const [updatingSkill, setUpdatingSkill] = React.useState<string | null>(null)

  const loadData = React.useCallback(async () => {
    if (!workspaceSlug) {
      setSkills([])
      setMcpConfig({ servers: {} })
      setCapabilities(null)
      setBuiltinMcpServers([])
      setSkillsDir('')
      setLoading(false)
      return
    }
    try {
      // 工作区能力摘要（builtinMcpServers + memory）始终按工作区取，与 scope 无关
      const [defaultSlugs, workspaceCapabilities] = await Promise.all([
        window.electronAPI.getDefaultSkillSlugs(),
        window.electronAPI.getWorkspaceCapabilities(workspaceSlug),
      ])
      setDefaultSkillSlugs(new Set(defaultSlugs))
      setCapabilities(workspaceCapabilities)
      setBuiltinMcpServers(workspaceCapabilities.builtinMcpServers)

      // Skills / MCP / 目录按当前 scope（工作区或某个嵌套 Project）取
      const [config, skillList, dir] = scopeProjectId
        ? await Promise.all([
          window.electronAPI.getProjectMcpConfig(workspaceSlug, scopeProjectId),
          window.electronAPI.getProjectSkills(workspaceSlug, scopeProjectId),
          window.electronAPI.getProjectSkillsDir(workspaceSlug, scopeProjectId),
        ])
        : await Promise.all([
          window.electronAPI.getWorkspaceMcpConfig(workspaceSlug),
          window.electronAPI.getWorkspaceSkills(workspaceSlug),
          window.electronAPI.getWorkspaceSkillsDir(workspaceSlug),
        ])
      setMcpConfig(config)
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
      if (scopeProjectId) {
        await window.electronAPI.toggleProjectSkill(workspaceSlug, scopeProjectId, slug, enabled)
      } else {
        await window.electronAPI.toggleWorkspaceSkill(workspaceSlug, slug, enabled)
      }
      setSkills((prev) => prev.map((s) => (s.slug === slug ? { ...s, enabled } : s)))
    } catch (error) {
      console.error('[Agent 技能] 切换 Skill 状态失败:', error)
      toast.error('切换 Skill 状态失败')
    }
  }, [workspaceSlug, scopeProjectId])

  const deleteSkill = React.useCallback(async (slug: string, name: string): Promise<boolean> => {
    try {
      if (scopeProjectId) {
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
  }, [workspaceSlug, scopeProjectId, bumpCapabilitiesVersion])

  const updateSkill = React.useCallback(async (slug: string) => {
    if (!workspaceSlug || updatingSkill) return
    // v1：Skill 来源更新（社区/组织同步）仅支持工作区级；项目级 Skill 目前没有导入来源追踪体系。
    if (scopeProjectId) {
      toast.error('项目级 Skill 暂不支持一键更新来源，请到工作区 Skills 里操作对应来源')
      return
    }
    setUpdatingSkill(slug)
    try {
      const existing = skills.find((s) => s.slug === slug)
      const updated = existing?.importSource?.sourceType === 'organization'
        ? await window.electronAPI.orgUpdateSkill(workspaceSlug, slug)
        : await window.electronAPI.updateSkillFromSource(workspaceSlug, slug)
      setSkills((prev) => prev.map((s) => (s.slug === slug ? updated : s)))
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

  const toggleMcp = React.useCallback(async (name: string, enabled: boolean) => {
    try {
      const entry = mcpConfig.servers[name]
      if (!entry) return
      const newConfig: WorkspaceMcpConfig = {
        servers: { ...mcpConfig.servers, [name]: { ...entry, enabled } },
      }
      if (scopeProjectId) {
        await window.electronAPI.saveProjectMcpConfig(workspaceSlug, scopeProjectId, newConfig)
      } else {
        await window.electronAPI.saveWorkspaceMcpConfig(workspaceSlug, newConfig)
      }
      setMcpConfig(newConfig)
      bumpCapabilitiesVersion((v) => v + 1)
    } catch (error) {
      console.error('[Agent 技能] 切换 MCP 服务器状态失败:', error)
      toast.error('切换 MCP 状态失败')
    }
  }, [workspaceSlug, scopeProjectId, mcpConfig, bumpCapabilitiesVersion])

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
      if (scopeProjectId) {
        await window.electronAPI.saveProjectMcpConfig(workspaceSlug, scopeProjectId, newConfig)
      } else {
        await window.electronAPI.saveWorkspaceMcpConfig(workspaceSlug, newConfig)
      }
      setMcpConfig(newConfig)
      bumpCapabilitiesVersion((v) => v + 1)
      toast.success(`已删除 MCP 服务器：${name}`)
    } catch (error) {
      console.error('[Agent 技能] 删除 MCP 服务器失败:', error)
      toast.error('删除 MCP 服务器失败')
    }
  }, [workspaceSlug, scopeProjectId, mcpConfig, bumpCapabilitiesVersion])

  /** 重新拉取工作区能力摘要（凭据保存后刷新内置连接器卡片状态，如「需配置」→「已启用」） */
  const refreshBuiltinMcp = React.useCallback(async (): Promise<void> => {
    if (!workspaceSlug) return
    try {
      const nextCapabilities = await window.electronAPI.getWorkspaceCapabilities(workspaceSlug)
      setCapabilities(nextCapabilities)
      setBuiltinMcpServers(nextCapabilities.builtinMcpServers)
    } catch (error) {
      console.error('[Agent 技能] 刷新内置连接器状态失败:', error)
    }
  }, [workspaceSlug])

  return {
    workspaceSlug,
    workspaceName: currentWorkspace?.name ?? '',
    hasWorkspace: !!currentWorkspace,
    loading,
    skills,
    defaultSkillSlugs,
    skillsDir,
    mcpConfig,
    capabilities,
    builtinMcpServers,
    updatingSkill,
    toggleSkill,
    deleteSkill,
    updateSkill,
    toggleMcp,
    toggleBuiltinMcp,
    deleteMcp,
    refreshBuiltinMcp,
  }
}
