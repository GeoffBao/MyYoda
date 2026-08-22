/**
 * AgentSkillsView — Yoda 插件中心（总览 / 专家 / 专家团 / 技能 / 连接器 / 记忆）
 *
 * 全屏模式（activeView='agent-skills'）：左侧栏「Yoda 插件」独立入口，Home / Code 共享；
 * `embedded` prop 保留供未来嵌入其他容器复用，当前无消费者。
 *
 * 结构：
 * - 标题栏（全屏模式）：插件 + 插件作用域选择器（默认配置 / Project）+ 工作区切换器（二者独立）
 * - 工具条：规范插件 Tab 切换 + 搜索 + 新建/导入入口
 * - 内容：各插件能力卡片/列表，点击打开详情抽屉；记忆复用 WorkspaceMemoryTab
 *
 * 作用域真实规则（不要写成「Workspace 默认 MCP + Project 覆盖」）：
 * - MCP：全局 ~/.myyoda/mcp.json（所有工作区共享）；仅当项目 hasProjectMcpServers 时整份替换。
 * - Skills：全局 + 工作区 + 项目三层 overlay；项目层只在 hasProjectSkills 时出现。
 * - Chat tools / builtin MCP / 专家 / 专家团：全局，与选择器无关。
 * - Memory：工作区级，选择器不改变记忆页。
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { Blocks, Check, ChevronDown, ChevronRight, FolderOpen, Search, Plus, Store, Sparkles, Loader2, Building2, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { agentPendingPromptAtom, workspaceCapabilitiesVersionAtom } from '@/atoms/agent-atoms'
import { activeViewAtom, agentSkillsTabAtom } from '@/atoms/active-view'
import { chatToolsAtom } from '@/atoms/chat-tool-atoms'
import { serverKanbanProjectsAtom } from '@/atoms/project-atoms'
import { filterPickableKanbanProjects } from '@/components/app-shell/kanban/types'
import { useCreateSession } from '@/hooks/useCreateSession'
import { useWorkspaceActions } from '@/hooks/useWorkspaceActions'
import {
  PLUGIN_CENTER_TABS,
  normalizePluginCenterTab,
  pluginCenterTabIndex,
  pluginCenterTabWidthPercent,
  type PluginCenterTab,
} from '@/lib/plugin-center-model'
import { buildPluginOverviewModel } from '@/lib/plugin-overview-model'
import { buildConnectorItems } from '@/lib/connectors-model'
import {
  buildPluginScopeOptions,
  describePluginScopeNotice,
  resolveMcpWriteProjectId,
  syncPluginScope,
  type PluginScope,
  type PluginScopeFlags,
} from '@/lib/plugin-scope-model'
import type { GlobalScopeReviewHints, McpServerEntry, SkillMeta } from '@myyoda/shared'
import { useAgentSkillsData, getSkillKey } from './useAgentSkillsData'
import { PluginOverviewTab } from './PluginOverviewTab'
import { PluginScopeSelector } from './PluginScopeSelector'
import { ConnectorsTab } from './ConnectorsTab'
import { LocalProjectBadge } from './LocalProjectBadge'
import { SkillCard } from './SkillCard'
import { SkillDetailSheet } from './SkillDetailSheet'
import { McpDetailSheet } from './McpDetailSheet'
import { AddConnectorMenu } from './AddConnectorMenu'
import { CustomHttpConnectorDialog } from './CustomHttpConnectorDialog'
import { ImportSkillDialog } from './ImportSkillDialog'

import { OrgSkillImportDialog } from './OrgSkillImportDialog'
import { CommunityMarketDialog } from './CommunityMarketDialog'
import { AgentExpertsView } from '@/components/agent-experts/AgentExpertsView'
import { WorkspaceMemoryTab } from './WorkspaceMemoryTab'
import { groupSkills } from './skillGrouping'

function buildSkillClassificationPrompt(input: {
  workspaceName: string
  skillsDir: string
  skills: SkillMeta[]
}): string {
  const skillList = input.skills
    .map((skill) => {
      const meta: string[] = []
      if (skill.group) meta.push(`group=${skill.group}`)
      return `- ${skill.slug} (${skill.name})${meta.length > 0 ? ` [${meta.join('; ')}]` : ''}`
    })
    .join('\n')

  return `请帮我整理当前工作区 Skills 的分组。

工作区：${input.workspaceName || '当前工作区'}
Skills 目录：${input.skillsDir}

当前已安装 Skills：
${skillList || '- 暂无'}

目标：
1. 逐个读取 Skills 目录下每个子目录的 SKILL.md，基于实际 description 和正文内容判断用途，不要只靠 slug、文件夹名或固定前缀猜分类。
2. 为每个 Skill 补全或修正 frontmatter 中的 group：
   - group 是一个简短、稳定的一级分组，直接用人类可读名称，例如 "Lark"、"文档"、"演示文稿"、"规划协作"。这些只是例子，不是固定枚举；请根据实际内容归纳。
   - 分组数量要克制，优先让用户能快速折叠/浏览，不要把每个细分场景都做成新组。
3. 只修改每个 SKILL.md 的 YAML frontmatter；保留 name、description、version、license、icon 等已有字段，不要改正文内容。
4. 对已有 group 做增量修订：明显准确的保留，不准确、缺失或过粗的再调整。
5. 同一平台或同一能力域的 Skills 应该归到同一个 group。
6. 如果某个 Skill 内容证据不足，放入 "未分组"，不要编造用途。
7. 只处理上述 Skills 目录内的 Skill，不要修改仓库 bundled default-skills、README、AGENTS.md 或其他 unrelated 文件。

写入格式示例：

---
name: example
description: ...
group: Lark
version: "1.0.0"
---

完成后请回复：
- 修改了多少个 Skill
- 使用了哪些 group，各自包含哪些 Skill
- 哪些 Skill 的分类不确定，以及原因
- 是否有需要用户确认或后续合并同类项的建议`
}

export function AgentSkillsView({ embedded = false }: { embedded?: boolean }): React.ReactElement {
  const { workspaces, currentWorkspaceId, selectWorkspace } = useWorkspaceActions()
  const kanbanProjects = useAtomValue(serverKanbanProjectsAtom)
  const capabilitiesVersion = useAtomValue(workspaceCapabilitiesVersionAtom)
  const [pluginScope, setPluginScope] = React.useState<PluginScope>({ kind: 'workspace' })
  const [projectScopeFlags, setProjectScopeFlags] = React.useState<Record<string, PluginScopeFlags>>({})
  const scopeProjectId = pluginScope.kind === 'project' ? pluginScope.projectId : null
  // MCP 全局共享；Skills 三层 overlay。projectId 只在选中 Project 时传入。
  const data = useAgentSkillsData(scopeProjectId)
  const mcpWriteProjectId = resolveMcpWriteProjectId(scopeProjectId, data.mcpIsProjectOverride)
  const bumpCapabilities = useSetAtom(workspaceCapabilitiesVersionAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const setPendingPrompt = useSetAtom(agentPendingPromptAtom)
  const chatTools = useAtomValue(chatToolsAtom)
  const setChatTools = useSetAtom(chatToolsAtom)
  const { createAgent } = useCreateSession()

  const [rawTab, setRawTab] = useAtom(agentSkillsTabAtom)
  const tab = normalizePluginCenterTab(rawTab)
  const setTab = React.useCallback((next: PluginCenterTab) => setRawTab(next), [setRawTab])
  const [search, setSearch] = React.useState('')
  // 专家 / 专家团 Tab：数量与“新建专家”触发 token（由工具条按钮递增，AgentExpertsView 收到后打开弹窗）
  const [expertsCount, setExpertsCount] = React.useState(0)
  const [teamsCount, setTeamsCount] = React.useState(0)
  const [createExpertRequest, setCreateExpertRequest] = React.useState(0)
  const [openExpertAfterNavigation, setOpenExpertAfterNavigation] = React.useState(false)

  React.useEffect(() => {
    if (tab !== 'experts' || !openExpertAfterNavigation) return
    setOpenExpertAfterNavigation(false)
    setCreateExpertRequest((current) => current + 1)
  }, [openExpertAfterNavigation, tab])

  const handleCreateExpert = React.useCallback((): void => {
    if (tab === 'experts') {
      setCreateExpertRequest((current) => current + 1)
      return
    }
    setOpenExpertAfterNavigation(true)
    setTab('experts')
  }, [setTab, tab])

  // 加载专家/专家团数量（侧栏入口移除后，插件视图自身维护角标数据）。
  // 切回总览/专家/专家团 Tab 时重拉，避免视图内新建/删除专家后计数与总览「已启用」数字 stale。
  React.useEffect(() => {
    if (tab !== 'overview' && tab !== 'experts' && tab !== 'teams') return
    let cancelled = false
    window.electronAPI.experts.list()
      .then((list) => {
        if (cancelled) return
        setExpertsCount(list.filter((e) => (e.kind ?? 'expert') === 'expert').length)
        setTeamsCount(list.filter((e) => e.kind === 'team').length)
      })
      .catch((cause) => console.error('[AgentSkills] 加载专家数量失败:', cause))
    return () => { cancelled = true }
  }, [tab])

  // 连接器全局作用域迁移后续提示（遗留工作区 mcp.json / 同名冲突后缀）：
  // 只在进入连接器 Tab 时拉一次，避免与技能/专家等无关 Tab 也发请求。
  const [globalScopeHints, setGlobalScopeHints] = React.useState<GlobalScopeReviewHints | null>(null)
  const [hintsDismissed, setHintsDismissed] = React.useState(false)
  React.useEffect(() => {
    if (tab !== 'connectors') return
    let cancelled = false
    window.electronAPI.getGlobalScopeReviewHints()
      .then((hints) => { if (!cancelled) setGlobalScopeHints(hints) })
      .catch((cause) => console.error('[AgentSkills] 获取迁移提示失败:', cause))
    return () => { cancelled = true }
  }, [tab])
  // 存 getSkillKey(skill)（scope+slug 复合键），不能单存 slug——三层合并后同名可能跨 scope 存在多份（shadowedByGlobal 场景）
  const [selectedSkillKey, setSelectedSkillKey] = React.useState<string | null>(null)
  const [mcpSheetOpen, setMcpSheetOpen] = React.useState(false)
  const [httpDialogOpen, setHttpDialogOpen] = React.useState(false)
  const [editingMcp, setEditingMcp] = React.useState<{ name: string; entry: McpServerEntry } | null>(null)
  const [openConnectorId, setOpenConnectorId] = React.useState<string | null>(null)
  const [showImport, setShowImport] = React.useState(false)
  const [showOrgImport, setShowOrgImport] = React.useState(false)
  const [showCommunityMarket, setShowCommunityMarket] = React.useState(false)
  const [pendingDeleteSkill, setPendingDeleteSkill] = React.useState<SkillMeta | null>(null)
  const [isDeletingSkill, setIsDeletingSkill] = React.useState(false)
  const [pendingDeleteMcpName, setPendingDeleteMcpName] = React.useState<string | null>(null)
  const [pendingDeleteHttp, setPendingDeleteHttp] = React.useState<{ id: string; name: string } | null>(null)
  const [isDeletingMcp, setIsDeletingMcp] = React.useState(false)
  const [classifyingSkills, setClassifyingSkills] = React.useState(false)
  const [wsPopoverOpen, setWsPopoverOpen] = React.useState(false)

  const pluginScopeOptions = React.useMemo(
    () => buildPluginScopeOptions({ projects: kanbanProjects, flags: projectScopeFlags }),
    [kanbanProjects, projectScopeFlags],
  )

  React.useEffect(() => {
    setPluginScope((current) => {
      const next = syncPluginScope(current, pluginScopeOptions)
      if (current.kind === 'workspace' && next.kind === 'workspace') return current
      if (
        current.kind === 'project'
        && next.kind === 'project'
        && current.projectId === next.projectId
        && current.projectName === next.projectName
        && current.hasOwnMcp === next.hasOwnMcp
        && current.hasOwnSkills === next.hasOwnSkills
      ) {
        return current
      }
      return next
    })
  }, [pluginScopeOptions])

  React.useEffect(() => {
    const slug = data.workspaceSlug
    if (!slug) {
      setProjectScopeFlags({})
      return
    }
    const projectIds = filterPickableKanbanProjects(kanbanProjects).map((project) => project.id)
    let cancelled = false
    void Promise.all(projectIds.map(async (projectId) => {
      const [hasOwnMcp, hasOwnSkills] = await Promise.all([
        window.electronAPI.hasProjectMcpServers(slug, projectId),
        window.electronAPI.hasProjectSkills(slug, projectId),
      ])
      return [projectId, { hasOwnMcp, hasOwnSkills }] as const
    })).then((entries) => {
      if (!cancelled) setProjectScopeFlags(Object.fromEntries(entries))
    }).catch((error: unknown) => {
      console.error('[插件作用域] 查询项目覆盖标记失败:', error)
    })
    return () => { cancelled = true }
  }, [data.workspaceSlug, kanbanProjects, capabilitiesVersion])

  const q = search.trim().toLowerCase()

  const filteredSkills = React.useMemo(() => {
    return data.skills.filter((s) => {
      if (!q) return true
      return s.name.toLowerCase().includes(q) ||
        s.slug.toLowerCase().includes(q) ||
        (s.description ?? '').toLowerCase().includes(q) ||
        (s.group ?? '').toLowerCase().includes(q)
    })
  }, [data.skills, q])

  const updateCount = data.skills.filter((s) => s.hasUpdate).length
  const shadowedCount = data.skills.filter((s) => s.shadowedByGlobal).length

  // 不按搜索预过滤：ConnectorsTab 对聚合后的 ConnectorItem 做搜索。仍排除 memos-cloud。
  const userMcpEntries = React.useMemo(() => {
    return Object.entries(data.mcpConfig.servers ?? {})
      .filter(([name]) => name !== 'memos-cloud')
  }, [data.mcpConfig])

  const pluginOverview = React.useMemo(() => {
    const overviewUserMcpEntries = Object.entries(data.mcpConfig.servers ?? {})
      .filter(([name, entry]) => name !== 'memos-cloud' && !entry.isBuiltin)

    return buildPluginOverviewModel({
      skills: data.skills,
      expertsCount,
      teamsCount,
      builtinMcpServers: data.builtinMcpServers,
      userMcpEntries: overviewUserMcpEntries,
      chatTools,
    })
  }, [
    chatTools,
    data.builtinMcpServers,
    data.mcpConfig.servers,
    data.skills,
    expertsCount,
    teamsCount,
  ])

  // Memory Tab 计数：工作区记忆（AGENTS.md + 长期记忆文件数）；项目选择不影响记忆页
  const workspaceMemoryCount = (data.capabilities?.memory.agentsMd.exists ? 1 : 0) + (data.capabilities?.memory.autoMemory.fileCount ?? 0)
  const memoryCount = workspaceMemoryCount
  const connectorItems = React.useMemo(
    () => buildConnectorItems({
      builtinServers: data.builtinMcpServers,
      userEntries: userMcpEntries,
      chatTools,
    }),
    [chatTools, data.builtinMcpServers, userMcpEntries],
  )
  const tabCounts: Record<PluginCenterTab, number> = {
    overview: pluginOverview.summary.enabledPlugins,
    experts: expertsCount,
    teams: teamsCount,
    skills: data.skills.length,
    connectors: connectorItems.length,
    memory: memoryCount,
  }

  const selectedSkill = selectedSkillKey ? data.skills.find((s) => getSkillKey(s) === selectedSkillKey) ?? null : null
  const selectedIsBuiltin = selectedSkill ? data.defaultSkillSlugs.has(selectedSkill.slug) : false

  const consumeOpenConnector = React.useCallback((): void => {
    setOpenConnectorId(null)
  }, [])

  const openConnector = React.useCallback((connectorId: string): void => {
    setTab('connectors')
    setOpenConnectorId(connectorId)
  }, [setTab])

  const handleClassifySkills = React.useCallback(async (): Promise<void> => {
    if (classifyingSkills) return
    if (!data.skillsDir) {
      toast.error('无法定位当前工作区 Skills 目录')
      return
    }
    setClassifyingSkills(true)
    try {
      const sessionId = await createAgent()
      if (!sessionId) {
        toast.error('创建 Agent 会话失败')
        return
      }
      setPendingPrompt({
        sessionId,
        message: buildSkillClassificationPrompt({
          workspaceName: data.workspaceName,
          skillsDir: data.skillsDir,
          skills: data.skills,
        }),
      })
      toast.success('已创建 Skills 分类整理会话')
    } catch (error) {
      console.error('[Agent 技能] 创建 Skills 分类会话失败:', error)
      toast.error(error instanceof Error ? error.message : '创建 Skills 分类会话失败')
    } finally {
      setClassifyingSkills(false)
    }
  }, [classifyingSkills, createAgent, data.skills, data.skillsDir, data.workspaceName, setPendingPrompt])

  // 注意：不在这里整体拦截 —— 总览 / 专家 / 专家团数据不依赖工作区，应始终可用；
  // 仅技能 / 连接器 / 记忆需要工作区，在内容区按 Tab 单独拦截。

  return (
    <div className={embedded ? 'flex flex-col' : 'flex h-full flex-col overflow-hidden'}>
      {/* 标题栏：全屏模式保留；embedded（设置面板内）由设置面板导航提供标题，隐藏以免重复 */}
      {!embedded && (
        <div className="titlebar-no-drag mx-auto flex w-full max-w-6xl shrink-0 items-center justify-between px-8 pt-14 pb-4">
          <div className="flex items-center gap-2.5">
            <Blocks className="size-6 text-foreground/70" />
            <h1 className="text-2xl font-semibold text-foreground">插件</h1>
          </div>

          {/* 插件作用域（默认配置 / Project）与工作区切换器并列，互不替代。
              记忆 / 专家 / 专家团不受作用域影响。 */}
          <div className="flex items-center gap-2">
            <PluginScopeSelector
              scope={pluginScope}
              options={pluginScopeOptions}
              onChange={setPluginScope}
            />
            <Popover open={wsPopoverOpen} onOpenChange={setWsPopoverOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="titlebar-no-drag flex items-center gap-2 rounded-lg border border-border/60 bg-content-area px-3 py-1.5 text-[13px] font-medium text-foreground/80 transition-colors hover:bg-foreground/[0.04]"
              >
                <FolderOpen size={14} className="text-foreground/45" />
                <span className="max-w-[180px] truncate">{data.workspaceName || '选择工作区'}</span>
                {workspaces.find((w) => w.id === currentWorkspaceId)?.projectRootPath ? (
                  <LocalProjectBadge workingDirectory={workspaces.find((w) => w.id === currentWorkspaceId)?.projectRootPath} />
                ) : null}
                <ChevronDown size={14} className="text-foreground/45" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="max-h-[440px] w-72 overflow-y-auto scrollbar-thin p-1">
              {/* 工作区切换（项目=工作区：技能 / 连接器 / 记忆均按工作区独立） */}
              <div className="px-2 pb-1.5 pt-1.5 text-[11px] font-medium text-muted-foreground/70">
                切换工作区
              </div>
              {workspaces.map((w) => {
                const isCurrent = w.id === currentWorkspaceId
                return (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => {
                      if (!isCurrent) {
                        selectWorkspace(w.id, { resetView: false })
                        toast.success(`已切换到工作区「${w.name}」`)
                      }
                      setWsPopoverOpen(false)
                    }}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-[13px] transition-colors',
                      isCurrent ? 'bg-accent text-accent-foreground' : 'text-foreground/80 hover:bg-accent/50',
                    )}
                  >
                    <FolderOpen size={15} className="mt-0.5 shrink-0 text-foreground/45" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{w.name}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {w.projectRootPath ?? '托管目录（workspace-files/）'}
                      </span>
                    </span>
                    {w.projectRootPath && (
                      <LocalProjectBadge workingDirectory={w.projectRootPath} className="bg-foreground/[0.05] text-foreground/40" />
                    )}
                    {isCurrent && <Check size={14} className="shrink-0 text-primary" />}
                  </button>
                )
              })}
            </PopoverContent>
            </Popover>
          </div>
        </div>
      )}

      {/* 工具条 */}
      <div className={cn('titlebar-no-drag flex w-full items-center gap-3 shrink-0', embedded ? 'flex-wrap' : 'mx-auto max-w-6xl px-8 pb-4')}>
        {/* 插件中心规范 Tab：总览 / 专家 / 专家团 / 技能 / 连接器 / 记忆 */}
        <div className="relative flex h-8 items-stretch rounded-xl bg-muted p-0.5">
          <div
            className="absolute bottom-0.5 top-0.5 rounded-lg bg-background shadow-sm transition-transform duration-base ease-out"
            style={{
              width: `calc(${pluginCenterTabWidthPercent()}% - 2px)`,
              transform: `translateX(${pluginCenterTabIndex(tab) * 100}%)`,
            }}
          />
          {PLUGIN_CENTER_TABS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={cn(
                'relative z-[1] flex min-w-[96px] items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-medium transition-colors duration-base',
                tab === value ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
              <span className="text-[11px] tabular-nums text-muted-foreground">{tabCounts[value]}</span>
            </button>
          ))}
        </div>

        {/* 总览 v1 暂不提供搜索；其他规范 Tab 使用模型内的搜索提示。 */}
        {tab !== 'overview' && (
          <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border/60 bg-content-area px-3 transition-colors focus-within:border-primary/40">
            <Search size={14} className="shrink-0 text-foreground/40" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={PLUGIN_CENTER_TABS.find((item) => item.value === tab)?.searchPlaceholder ?? '搜索插件...'}
              className="w-full bg-transparent text-[13px] text-foreground placeholder:text-foreground/35 focus:outline-none"
            />
          </div>
        )}

        {/* 新建专家：仅在专家 Tab 显示，通过 token 触发嵌入视图的弹窗 */}
        {tab === 'experts' && (
          <button
            type="button"
            onClick={() => setCreateExpertRequest((n) => n + 1)}
            className="flex h-8 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            <Plus size={14} />
            <span>新建专家</span>
          </button>
        )}

        {/* 社区市场：工作区级 Skills（项目=工作区，无项目级覆盖） */}
        {tab === 'skills' && (
          <button
            type="button"
            onClick={() => setShowCommunityMarket(true)}
            className="flex h-8 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 text-[13px] font-medium text-emerald-600 shadow-sm transition-colors hover:bg-emerald-500/20 dark:text-emerald-400"
          >
            <Store size={14} />
            <span>社区市场</span>
          </button>
        )}

        {/* Skills：AI 分类（工作区级） */}
        {tab === 'skills' && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => void handleClassifySkills()}
                disabled={classifyingSkills || data.skills.length === 0}
                className="flex h-8 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border/60 bg-content-area px-3 text-[13px] font-medium text-foreground/80 shadow-sm transition-colors hover:bg-foreground/[0.04] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {classifyingSkills ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                <span>AI 分类</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">创建 Agent 会话，读取 SKILL.md 内容并补全 group</TooltipContent>
          </Tooltip>
        )}

        {/* Skills：导入（工作区级，从其他工作区导入） */}
        {tab === 'skills' && (
          <button
            type="button"
            onClick={() => setShowImport(true)}
            className="flex h-8 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border/60 bg-content-area px-3 text-[13px] font-medium text-foreground/80 shadow-sm transition-colors hover:bg-foreground/[0.04]"
          >
            <Plus size={14} />
            <span>导入</span>
          </button>
        )}

        {/* Skills：从企业组织导入 */}
        {tab === 'skills' && (
          <button
            type="button"
            onClick={() => setShowOrgImport(true)}
            className="flex h-8 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 text-[13px] font-medium text-indigo-600 shadow-sm transition-colors hover:bg-indigo-500/20 dark:text-indigo-400"
          >
            <Building2 size={14} />
            <span>从企业组织导入</span>
          </button>
        )}

        {/* 添加自定义连接（连接器 Tab 工具条；内置连接器已在列表中） */}
        {tab === 'connectors' && (
          <AddConnectorMenu
            onAddMcp={() => { setEditingMcp(null); setMcpSheetOpen(true) }}
            onAddHttp={() => setHttpDialogOpen(true)}
          />
        )}
      </div>

      {/* 内容 */}
      <div className={cn(embedded ? 'mt-4' : 'min-h-0 flex-1 overflow-y-auto scrollbar-thin')}>
        <div className={embedded ? '' : 'mx-auto w-full max-w-6xl px-8 pb-10'}>
          {data.loading ? (
            <div className="py-20 text-center text-sm text-muted-foreground">加载中...</div>
          ) : (
            <>
              {pluginScope.kind === 'project' && tab !== 'experts' && tab !== 'teams' && tab !== 'memory' && (
                <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-[13px] text-amber-700 dark:text-amber-300">
                  {describePluginScopeNotice(pluginScope)}
                </div>
              )}
              {tab === 'overview' ? (
            <PluginOverviewTab
              model={pluginOverview}
              onOpenTab={setTab}
              onCreateExpert={handleCreateExpert}
              onOpenConnector={openConnector}
              onOpenCommunityMarket={() => setShowCommunityMarket(true)}
              onOpenMessaging={() => setActiveView('messaging')}
            />
          ) : tab === 'experts' ? (
            <AgentExpertsView
              embedded
              kind="expert"
              externalSearch={search}
              createRequestToken={createExpertRequest}
            />
          ) : tab === 'teams' ? (
            <AgentExpertsView
              embedded
              kind="team"
              externalSearch={search}
            />
          ) : !data.hasWorkspace ? (
            <EmptyState
              icon={<Blocks className="size-8 text-foreground/30" />}
              title="未选择工作区"
              hint="请先选择或创建一个工作区，再来管理它的技能、连接器与记忆。"
            />
          ) : tab === 'skills' ? (
            <SkillsTab
              skills={filteredSkills}
              total={data.skills.length}
              updateCount={updateCount}
              shadowedCount={shadowedCount}
              isSkillUpdating={data.isSkillUpdating}
              isProjectScope={pluginScope.kind === 'project'}
              isBuiltin={(slug) => data.defaultSkillSlugs.has(slug)}
              onOpen={(skill) => setSelectedSkillKey(getSkillKey(skill))}
              onToggle={data.toggleSkill}
              onUpdate={data.updateSkill}
              onImport={() => setShowImport(true)}
            />
          ) : tab === 'connectors' ? (
            <ConnectorsTab
              builtinServers={data.builtinMcpServers}
              userEntries={userMcpEntries}
              query={search}
              mcpIsProjectOverride={data.mcpIsProjectOverride}
              reviewHints={hintsDismissed ? null : globalScopeHints}
              onDismissHints={() => setHintsDismissed(true)}
              onToggleBuiltin={data.toggleBuiltinMcp}
              onToggleMcp={data.toggleMcp}
              onAddMcp={() => { setEditingMcp(null); setMcpSheetOpen(true) }}
              onAddHttp={() => setHttpDialogOpen(true)}
              workspaceSlug={data.workspaceSlug}
              projectId={mcpWriteProjectId}
              onUserMcpChanged={() => {
                bumpCapabilities((v) => v + 1)
                void data.reload()
              }}
              openConnectorId={openConnectorId}
              onOpenConnectorConsumed={consumeOpenConnector}
              onRequestDeleteMcp={setPendingDeleteMcpName}
              onRequestDeleteHttp={setPendingDeleteHttp}
            />
          ) : tab === 'memory' ? (
            // 记忆页始终工作区级；作用域选择器不改变记忆页
            <WorkspaceMemoryTab workspaceSlug={data.workspaceSlug} search={search} />
          ) : null}
            </>
          )}
        </div>
      </div>

      {/* 详情抽屉 */}
      <SkillDetailSheet
        skill={selectedSkill}
        workspaceSlug={data.workspaceSlug}
        projectId={scopeProjectId}
        isBuiltin={selectedIsBuiltin}
        updating={selectedSkill ? data.isSkillUpdating(selectedSkill) : false}
        onOpenChange={(open) => { if (!open) setSelectedSkillKey(null) }}
        onToggle={(enabled) => selectedSkill && data.toggleSkill(selectedSkill, enabled)}
        onUpdate={() => selectedSkill && data.updateSkill(selectedSkill)}
        onRequestDelete={() => selectedSkill && setPendingDeleteSkill(selectedSkill)}
        onOpenFolder={() => selectedSkill && data.openSkillFolder(selectedSkill)}
        onChanged={() => bumpCapabilities((v) => v + 1)}
      />

      {/* Skill 删除确认：全局 Skill 影响所有共享该层的工作区，文案单独说明影响范围，不与工作区/项目级混用同一句描述 */}
      <ConfirmDialog
        open={pendingDeleteSkill !== null}
        onOpenChange={(open) => { if (!open) setPendingDeleteSkill(null) }}
        title={`确认删除 Skill「${pendingDeleteSkill?.name}」？`}
        description={
          pendingDeleteSkill?.scope === 'global'
            ? '这是全局 Skill，删除将影响所有共享该层的工作区，且无法恢复，确定要卸载吗？'
            : '删除后将无法恢复，确定要卸载这个 Skill 吗？'
        }
        confirmLabel="删除"
        loadingLabel="删除中..."
        loading={isDeletingSkill}
        onConfirm={async () => {
          if (!pendingDeleteSkill || isDeletingSkill) return
          setIsDeletingSkill(true)
          const ok = await data.deleteSkill(pendingDeleteSkill)
          setIsDeletingSkill(false)
          setPendingDeleteSkill(null)
          if (ok) setSelectedSkillKey(null)
        }}
      />

      <ConfirmDialog
        open={pendingDeleteMcpName !== null}
        onOpenChange={(open) => { if (!open) setPendingDeleteMcpName(null) }}
        title={`确认删除连接器「${pendingDeleteMcpName}」？`}
        description={
          data.mcpIsProjectOverride
            ? '将从本项目的连接器覆盖配置中删除，不影响全局配置。'
            : '这是全局连接器配置，删除将影响所有工作区，且无法恢复。'
        }
        confirmLabel="删除"
        loadingLabel="删除中..."
        loading={isDeletingMcp}
        onConfirm={async () => {
          if (!pendingDeleteMcpName || isDeletingMcp) return
          setIsDeletingMcp(true)
          const deletedName = pendingDeleteMcpName
          await data.deleteMcp(deletedName)
          setIsDeletingMcp(false)
          setPendingDeleteMcpName(null)
          if (editingMcp?.name === deletedName) {
            setMcpSheetOpen(false)
            setEditingMcp(null)
          }
        }}
      />

      <ConfirmDialog
        open={pendingDeleteHttp !== null}
        onOpenChange={(open) => { if (!open) setPendingDeleteHttp(null) }}
        title={`确认删除连接器「${pendingDeleteHttp?.name}」？`}
        description="删除后无法恢复。这是自定义 HTTP 连接器，不影响全局 MCP 配置。"
        confirmLabel="删除"
        loadingLabel="删除中..."
        onConfirm={async () => {
          if (!pendingDeleteHttp) return
          const { id, name } = pendingDeleteHttp
          try {
            await window.electronAPI.deleteCustomChatTool(id)
            setChatTools(await window.electronAPI.getChatTools())
            toast.success(`已删除工具：${name}`)
          } catch {
            toast.error('删除工具失败')
          } finally {
            setPendingDeleteHttp(null)
          }
        }}
      />

      <McpDetailSheet
        open={mcpSheetOpen}
        server={editingMcp}
        workspaceSlug={data.workspaceSlug}
        projectId={mcpWriteProjectId}
        onOpenChange={(open) => {
          setMcpSheetOpen(open)
          if (!open) {
            void data.refreshMcpConfig()
            bumpCapabilities((v) => v + 1)
          }
        }}
        onSaved={() => {
          setMcpSheetOpen(false)
          void data.refreshMcpConfig()
        }}
        onChanged={() => {
          void data.refreshMcpConfig()
          bumpCapabilities((v) => v + 1)
        }}
      />

      <CustomHttpConnectorDialog
        open={httpDialogOpen}
        onOpenChange={setHttpDialogOpen}
        onCreated={() => {
          void window.electronAPI.getChatTools().then(setChatTools)
        }}
      />

      <ImportSkillDialog
        open={showImport}
        onOpenChange={setShowImport}
        workspaceSlug={data.workspaceSlug}
        projectId={scopeProjectId}
        installedSkills={data.skills}
        onImported={() => bumpCapabilities((v) => v + 1)}
      />

      <OrgSkillImportDialog
        open={showOrgImport}
        onOpenChange={setShowOrgImport}
        workspaceSlug={data.workspaceSlug}
        projectScoped={!!scopeProjectId}
        installedSkills={data.skills}
        onImported={() => bumpCapabilities((v) => v + 1)}
      />

      <CommunityMarketDialog
        open={showCommunityMarket}
        onOpenChange={setShowCommunityMarket}
        workspaceSlug={data.workspaceSlug}
        projectScoped={!!scopeProjectId}
        installedSkills={data.skills}
        onImported={() => bumpCapabilities((v) => v + 1)}
      />
    </div>
  )
}

// ===== Skills Tab =====

interface SkillsTabProps {
  /** 全量生效 Skill（已按搜索过滤），内部按 scope 分组渲染 */
  skills: SkillMeta[]
  total: number
  updateCount: number
  /** 被同名全局 Skill 遮蔽、实际不生效的工作区/项目层副本数量 */
  shadowedCount: number
  /** 按 scope+slug 定位判断某个 Skill 是否在更新中（同名跨 scope 时不会串号） */
  isSkillUpdating: (skill: SkillMeta) => boolean
  /** 当前是否处于嵌套 Project 范围（仅影响空列表提示文案中“其他工作区”/“其他项目”的描述） */
  isProjectScope: boolean
  isBuiltin: (slug: string) => boolean
  /** 以下三个回调均传完整 SkillMeta，不传裸 slug——防止同名跨 scope（shadowedByGlobal）时操作错卡片 */
  onOpen: (skill: SkillMeta) => void
  onToggle: (skill: SkillMeta, enabled: boolean) => void
  onUpdate: (skill: SkillMeta) => void
  /** 打开导入弹窗（按当前 scope 已在上层路由好），空列表下直接给一个可点击的入口，不再只用文字描述 */
  onImport: () => void
}

function SkillsTab({
  skills,
  total,
  updateCount,
  shadowedCount,
  isSkillUpdating,
  isProjectScope,
  isBuiltin,
  onOpen,
  onToggle,
  onUpdate,
  onImport,
}: SkillsTabProps): React.ReactElement {
  if (total === 0) {
    return (
      <EmptyState
        icon={<Blocks className="size-8 text-foreground/30" />}
        title="暂无 Skill"
        hint={isProjectScope ? '可以让 MyYoda 帮你联网查找并安装 Skill，或点击下方按钮从工作区共享配置/其他项目导入。' : '可以在 Project 模式下让 MyYoda 帮你联网查找并安装 Skill，或点击下方按钮从其他工作区导入。'}
        action={
          <button
            type="button"
            onClick={onImport}
            className="mt-2 flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            <Plus size={14} />
            <span>{isProjectScope ? '从工作区默认/其他项目导入' : '从其他工作区导入'}</span>
          </button>
        }
      />
    )
  }
  if (skills.length === 0) {
    return <EmptyState icon={<Search className="size-8 text-foreground/30" />} title="没有匹配的 Skill" hint="试试更换搜索关键词。" />
  }

  // 按作用域分组：项目（最具体）→ 工作区（日常自定义/导入）→ 全局（预置 + 所有工作区共享，最通用），
  // 与阶段性“优先看自己当前上下文”的阅读习惯一致。
  const projectSkills = skills.filter((s) => s.scope === 'project')
  const workspaceSkills = skills.filter((s) => s.scope !== 'project' && s.scope !== 'global')
  const globalSkills = skills.filter((s) => s.scope === 'global')

  return (
    <div className="flex flex-col gap-8">
      {isProjectScope && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[13px] text-amber-700 dark:text-amber-400">
          <AlertTriangle size={14} className="shrink-0" />
          社区安装与导入仍写入工作区 Skills，不会自动创建项目级副本。
        </div>
      )}
      {updateCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/[0.06] px-3 py-2 text-[13px] text-blue-600 dark:text-blue-400">
          有 {updateCount} 个 Skill 可更新到来源最新版本
        </div>
      )}
      {shadowedCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[13px] text-amber-700 dark:text-amber-400">
          <AlertTriangle size={14} className="shrink-0" />
          有 {shadowedCount} 个 Skill 与全局同名、实际不会生效（卡片右上角标注“已被遮蔽”），建议重命名或删除
        </div>
      )}
      {projectSkills.length > 0 && (
        <SkillSection title="本项目 Skills" skills={projectSkills} isBuiltin={isBuiltin} isSkillUpdating={isSkillUpdating} onOpen={onOpen} onToggle={onToggle} onUpdate={onUpdate} />
      )}
      {workspaceSkills.length > 0 && (
        <SkillSection title="工作区 Skills" skills={workspaceSkills} isBuiltin={isBuiltin} isSkillUpdating={isSkillUpdating} onOpen={onOpen} onToggle={onToggle} onUpdate={onUpdate} />
      )}
      {globalSkills.length > 0 && (
        <SkillSection
          title="全局 Skills"
          subtitle="所有工作区共享"
          skills={globalSkills}
          isBuiltin={isBuiltin}
          isSkillUpdating={isSkillUpdating}
          onOpen={onOpen}
          onToggle={onToggle}
          onUpdate={onUpdate}
        />
      )}
    </div>
  )
}

interface SkillSectionProps {
  title: string
  /** 可选副标题，用于补充说明该层的作用范围（如“所有工作区共享”） */
  subtitle?: string
  skills: SkillMeta[]
  isBuiltin: (slug: string) => boolean
  isSkillUpdating: (skill: SkillMeta) => boolean
  onOpen: (skill: SkillMeta) => void
  onToggle: (skill: SkillMeta, enabled: boolean) => void
  onUpdate: (skill: SkillMeta) => void
}

function SkillSection({ title, subtitle, skills, isBuiltin, isSkillUpdating, onOpen, onToggle, onUpdate }: SkillSectionProps): React.ReactElement {
  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(new Set())
  const groups = React.useMemo(() => groupSkills(skills), [skills])

  const toggleGroup = React.useCallback((groupId: string): void => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }, [])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 px-1">
        <span className="text-[13px] font-medium text-foreground/55">{title}</span>
        <span className="text-[12px] tabular-nums text-foreground/35">{skills.length}</span>
        {subtitle && <span className="text-[12px] text-foreground/30">· {subtitle}</span>}
      </div>
      <div className="flex flex-col gap-4">
        {groups.map((group) => {
          const collapsed = collapsedGroups.has(group.id)
          return (
            <div key={group.id} className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                className="flex h-8 items-center gap-2 rounded-lg px-1 text-left text-[13px] font-medium text-foreground/65 transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
              >
                <ChevronRight size={14} className={cn('text-foreground/35 transition-transform', !collapsed && 'rotate-90')} />
                <span>{group.title}</span>
                <span className="text-[12px] tabular-nums text-foreground/35">{group.skills.length}</span>
              </button>
              {!collapsed && (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {group.skills.map((skill) => (
                    <SkillCard
                      key={getSkillKey(skill)}
                      skill={skill}
                      isBuiltin={isBuiltin(skill.slug)}
                      updating={isSkillUpdating(skill)}
                      onOpen={() => onOpen(skill)}
                      onToggle={(enabled) => onToggle(skill, enabled)}
                      onUpdate={() => onUpdate(skill)}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ===== Empty State =====

function EmptyState({ icon, title, hint, action }: { icon: React.ReactNode; title: string; hint: string; action?: React.ReactNode }): React.ReactElement {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 pt-24 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-foreground/[0.04]">{icon}</div>
      <div className="flex flex-col gap-1.5">
        <div className="text-[15px] font-medium text-foreground/85">{title}</div>
        <div className="text-[13px] leading-relaxed text-foreground/50">{hint}</div>
      </div>
      {action}
    </div>
  )
}
