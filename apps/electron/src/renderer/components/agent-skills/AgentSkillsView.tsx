/**
 * AgentSkillsView — Yoda 插件中心（专家 / 专家团 / 技能 / 连接器 / 记忆 统一配置）
 *
 * 全屏模式（activeView='agent-skills'）：左侧栏「Yoda 插件」独立入口，Home / Code 共享；
 * `embedded` prop 保留供未来嵌入其他容器复用，当前无消费者。
 *
 * 结构：
 * - 标题栏（全屏模式）：Yoda 插件 + 当前工作区切换器（多工作区时显示，复用 useWorkspaceActions）
 * - 工具条：专家 / 专家团 / 技能 / 连接器 / 记忆 切换 + 搜索 + 新建/导入入口
 * - 内容：各能力 tab 卡片/列表，点击打开详情；连接器 Tab 为 Mico 风格卡片网格 + 居中详情 Modal；记忆复用 WorkspaceMemoryTab
 *
 * 注意：此处“工作区”对应 Proma 上游 UI 中的“项目”概念（同一个 AgentWorkspace 实体，Proma 仅在展示层重命名）；
 * MyYoda 另有一层嵌套的真正“项目”（KanbanProject，自带目录绑定），与此处切换器无关，不要混淆。
 * 记忆（Memory）已对齐 Proma：不区分项目范围，统一为工作区记忆页。
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { Blocks, Check, ChevronDown, ChevronRight, FolderOpen, Search, Plus, Store, Sparkles, Loader2, Building2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { agentPendingPromptAtom, workspaceCapabilitiesVersionAtom } from '@/atoms/agent-atoms'
import { agentSkillsTabAtom } from '@/atoms/active-view'
import { chatToolsAtom } from '@/atoms/chat-tool-atoms'
import { useCreateSession } from '@/hooks/useCreateSession'
import { useWorkspaceActions } from '@/hooks/useWorkspaceActions'


import type { BuiltinMcpServerSummary, McpServerEntry, SkillMeta } from '@myyoda/shared'
import { useAgentSkillsData } from './useAgentSkillsData'
import { LocalProjectBadge } from './LocalProjectBadge'
import { SkillCard } from './SkillCard'
import { SkillDetailSheet } from './SkillDetailSheet'
import { McpDetailSheet } from './McpDetailSheet'
import { BuiltinMcpDetailSheet } from './BuiltinMcpDetailSheet'
import { ImportSkillDialog } from './ImportSkillDialog'
import { ConnectorsTab } from './ConnectorsTab'
import { ConnectorDetailDialog } from './ConnectorDetailDialog'
import { ConnectorCredentials, CONNECTOR_CREDENTIAL_SPECS } from './ConnectorCredentials'

import { OrgSkillImportDialog } from './OrgSkillImportDialog'
import { CommunityMarketDialog } from './CommunityMarketDialog'
import {
  WecomSettings,
  WebSearchSettings,
  NanoBananaSettings,
  ReadwiseSettings,
  WereadSettings,
} from '@/components/settings/ToolSettings'
import { AgentExpertsView } from '@/components/agent-experts/AgentExpertsView'
import { WorkspaceMemoryTab } from './WorkspaceMemoryTab'
import { groupSkills } from './skillGrouping'
import { getBuiltinMcpIcon } from '@/lib/builtin-mcp-icons'

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
  // 对齐「项目=工作区」：Skills/MCP 全部工作区级（无嵌套项目覆盖），顶部选择器只做工作区切换
  const data = useAgentSkillsData(null)
  const bumpCapabilities = useSetAtom(workspaceCapabilitiesVersionAtom)
  const setPendingPrompt = useSetAtom(agentPendingPromptAtom)
  const chatTools = useAtomValue(chatToolsAtom)
  const { createAgent } = useCreateSession()

  const [tab, setTab] = useAtom(agentSkillsTabAtom)
  const [search, setSearch] = React.useState('')
  // 专家 / 专家团 Tab：数量与“新建专家”触发 token（由工具条按钮递增，AgentExpertsView 收到后打开弹窗）
  const [expertsCount, setExpertsCount] = React.useState(0)
  const [teamsCount, setTeamsCount] = React.useState(0)
  const [createExpertRequest, setCreateExpertRequest] = React.useState(0)

  // 加载专家/专家团数量（侧栏入口移除后，插件视图自身维护角标数据）
  React.useEffect(() => {
    let cancelled = false
    window.electronAPI.experts.list()
      .then((list) => {
        if (cancelled) return
        setExpertsCount(list.filter((e) => (e.kind ?? 'expert') === 'expert').length)
        setTeamsCount(list.filter((e) => e.kind === 'team').length)
      })
      .catch((cause) => console.error('[AgentSkills] 加载专家数量失败:', cause))
    return () => { cancelled = true }
  }, [])
  const [selectedSkillSlug, setSelectedSkillSlug] = React.useState<string | null>(null)
  const [mcpSheetOpen, setMcpSheetOpen] = React.useState(false)
  const [editingMcp, setEditingMcp] = React.useState<{ name: string; entry: McpServerEntry } | null>(null)
  const [selectedBuiltinMcp, setSelectedBuiltinMcp] = React.useState<BuiltinMcpServerSummary | null>(null)
  /** 打开凭据配置 Modal 的连接器 id（wecom/readwise/weread/nano-banana/web-search） */
  const [configureServerId, setConfigureServerId] = React.useState<string | null>(null)
  const [showImport, setShowImport] = React.useState(false)
  const [showOrgImport, setShowOrgImport] = React.useState(false)
  const [showCommunityMarket, setShowCommunityMarket] = React.useState(false)
  const [pendingDeleteSkill, setPendingDeleteSkill] = React.useState<SkillMeta | null>(null)
  const [pendingDeleteMcpName, setPendingDeleteMcpName] = React.useState<string | null>(null)
  const [isDeletingSkill, setIsDeletingSkill] = React.useState(false)
  const [isDeletingMcp, setIsDeletingMcp] = React.useState(false)
  const [classifyingSkills, setClassifyingSkills] = React.useState(false)
  const [wsPopoverOpen, setWsPopoverOpen] = React.useState(false)

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

  const customSkills = filteredSkills.filter((s) => !data.defaultSkillSlugs.has(s.slug))
  const builtinSkills = filteredSkills.filter((s) => data.defaultSkillSlugs.has(s.slug))
  const updateCount = data.skills.filter((s) => s.hasUpdate).length

  const userMcpEntries = React.useMemo(() => {
    return Object.entries(data.mcpConfig.servers ?? {})
      .filter(([name]) => name !== 'memos-cloud')
      .filter(([name]) => !q || name.toLowerCase().includes(q))
  }, [data.mcpConfig, q])

  const builtinMcpServers = React.useMemo(() => {
    if (!q) return data.builtinMcpServers
    return data.builtinMcpServers.filter((server) =>
      server.name.toLowerCase().includes(q) ||
      server.displayName.toLowerCase().includes(q) ||
      server.description.toLowerCase().includes(q) ||
      server.tools.some((tool) => tool.name.toLowerCase().includes(q) || tool.description.toLowerCase().includes(q)),
    )
  }, [data.builtinMcpServers, q])

  // 不含搜索过滤的 MCP 总数（Tab 计数与空态判断用）
  const mcpCount = React.useMemo(
    () => Object.keys(data.mcpConfig.servers ?? {}).filter((n) => n !== 'memos-cloud').length + data.builtinMcpServers.length,
    [data.mcpConfig, data.builtinMcpServers],
  )
  // 连接器 Tab 计数：内置/用户 MCP + 增强工具（联网搜索 + 自定义工具）
  const connectorToolCount = chatTools.filter((t) => t.meta.id === 'web-search' || t.meta.category === 'custom').length
  const connectorCount = mcpCount + connectorToolCount
  // Memory Tab 计数：工作区记忆（AGENTS.md + 长期记忆文件数）；项目选择不影响记忆页（对齐 Proma，无独立 Project Knowledge）
  const workspaceMemoryCount = (data.capabilities?.memory.agentsMd.exists ? 1 : 0) + (data.capabilities?.memory.autoMemory.fileCount ?? 0)
  const memoryCount = workspaceMemoryCount

  const selectedSkill = data.skills.find((s) => s.slug === selectedSkillSlug) ?? null
  const selectedIsBuiltin = selectedSkill ? data.defaultSkillSlugs.has(selectedSkill.slug) : false

  const openSkillFolder = (slug: string): void => {
    if (data.skillsDir) window.electronAPI.openFile(`${data.skillsDir}/${slug}`)
  }

  const configureBuiltinMcp = React.useCallback((serverId: string): void => {
    // 打开对应连接器的凭据配置 Modal（居中，Mico 风格），不再跳 API Tab
    setSelectedBuiltinMcp(null)
    setConfigureServerId(serverId)
  }, [])

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

  // 注意：不在这里整体拦截 —— 专家 / 专家团 / API 数据不依赖工作区，应始终可用；
  // 仅 Skills / MCP 需要工作区，在内容区按 Tab 单独拦截。

  return (
    <div className={embedded ? 'flex flex-col' : 'flex h-full flex-col overflow-hidden'}>
      {/* 标题栏：全屏模式保留；embedded（设置面板内）由设置面板导航提供标题，隐藏以免重复 */}
      {!embedded && (
        <div className="titlebar-no-drag mx-auto flex w-full max-w-6xl shrink-0 items-center justify-between px-8 pt-14 pb-4">
          <div className="flex items-center gap-2.5">
            <Blocks className="size-6 text-foreground/70" />
            <h1 className="text-2xl font-semibold text-foreground">插件</h1>
          </div>

          {/* 范围切换：当前工作区默认（跨 Project 共享，今天的行为）+ 该工作区下嵌套的 Project（Skills/MCP 项目级覆盖），
              以及切换到其他工作区。Memory 不受此处项目选择影响，始终还是工作区级。 */}
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
              {/* 工作区切换（项目=工作区：Skills / MCP / 记忆均按工作区独立） */}
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
      )}

      {/* 工具条 */}
      <div className={cn('titlebar-no-drag flex w-full items-center gap-3 shrink-0', embedded ? 'flex-wrap' : 'mx-auto max-w-6xl px-8 pb-4')}>
        {/* 专家 / 专家团 / 技能 / 连接器 / 记忆 切换（MCP + API 已合并为连接器，2026-08-19） */}
        <div className="relative flex h-8 items-stretch rounded-xl bg-muted p-0.5">
          <div
            className={cn(
              'absolute bottom-0.5 top-0.5 w-[calc(20%-2px)] rounded-lg bg-background shadow-sm transition-transform duration-base ease-out',
              tab === 'experts' && 'translate-x-0',
              tab === 'teams' && 'translate-x-full',
              tab === 'skills' && 'translate-x-[200%]',
              tab === 'connectors' && 'translate-x-[300%]',
              tab === 'memory' && 'translate-x-[400%]',
            )}
          />
          {([
            { value: 'experts' as const, label: '专家', count: expertsCount },
            { value: 'teams' as const, label: '专家团', count: teamsCount },
            { value: 'skills' as const, label: '技能', count: data.skills.length },
            { value: 'connectors' as const, label: '连接器', count: connectorCount },
            { value: 'memory' as const, label: '记忆', count: memoryCount },
          ]).map(({ value, label, count }) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={cn(
                'relative z-[1] flex min-w-[96px] items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-medium transition-colors duration-base',
                tab === value ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
              <span className="text-[11px] tabular-nums text-muted-foreground">{count}</span>
            </button>
          ))}
        </div>

        {/* 搜索框（连接器 Tab 同样支持按名称/描述搜索） */}
        <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border/60 bg-content-area px-3 transition-colors focus-within:border-primary/40">
          <Search size={14} className="shrink-0 text-foreground/40" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tab === 'experts' ? '搜索专家名称或 slug...' : tab === 'teams' ? '搜索专家团名称或角色...' : tab === 'skills' ? '搜索技能...' : tab === 'connectors' ? '搜索连接器...' : '搜索记忆文件...'}
            className="w-full bg-transparent text-[13px] text-foreground placeholder:text-foreground/35 focus:outline-none"
          />
        </div>

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

        {/* 新增 MCP */}
        {tab === 'connectors' && (
          <button
            type="button"
            onClick={() => { setEditingMcp(null); setMcpSheetOpen(true) }}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            <Plus size={14} />
            <span>添加服务器</span>
          </button>
        )}
      </div>

      {/* 内容 */}
      <div className={cn(embedded ? 'mt-4' : 'min-h-0 flex-1 overflow-y-auto scrollbar-thin')}>
        <div className={embedded ? '' : 'mx-auto w-full max-w-6xl px-8 pb-10'}>
          {data.loading ? (
            <div className="py-20 text-center text-sm text-muted-foreground">加载中...</div>
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
          ) : tab === 'connectors' ? (
            <ConnectorsTab
              builtinServers={builtinMcpServers}
              userEntries={userMcpEntries}
              onOpenBuiltin={setSelectedBuiltinMcp}
              onOpenMcp={(name, entry) => { setEditingMcp({ name, entry }); setMcpSheetOpen(true) }}
              onToggleBuiltin={data.toggleBuiltinMcp}
              onToggleMcp={data.toggleMcp}
              onAddMcp={() => { setEditingMcp(null); setMcpSheetOpen(true) }}
              onConfigure={configureBuiltinMcp}
              externalSearch={search}
            />
          ) : !data.hasWorkspace ? (
            <EmptyState
              icon={<Blocks className="size-8 text-foreground/30" />}
              title="未选择工作区"
              hint="请先选择或创建一个工作区，再来管理它的 Skills、连接器与 Memory。"
            />
          ) : tab === 'skills' ? (
            <SkillsTab
              customSkills={customSkills}
              builtinSkills={builtinSkills}
              total={data.skills.length}
              updateCount={updateCount}
              updatingSkill={data.updatingSkill}
              isProjectScope={false}
              isBuiltin={(slug) => data.defaultSkillSlugs.has(slug)}
              onOpen={setSelectedSkillSlug}
              onToggle={data.toggleSkill}
              onUpdate={data.updateSkill}
              onImport={() => setShowImport(true)}
            />
          ) : tab === 'memory' ? (
            // 记忆页统一为工作区记忆（AGENTS.md + memory/ 文件列表 + 授权引导，Proma 形态）；
            // 项目选择器只影响 Skills/连接器 的项目级覆盖，不再切出独立的 Project Knowledge 编辑器（已对齐移除）
            <WorkspaceMemoryTab workspaceSlug={data.workspaceSlug} search={search} />
          ) : null}
        </div>
      </div>

      {/* 详情抽屉 */}
      <SkillDetailSheet
        skill={selectedSkill}
        workspaceSlug={data.workspaceSlug}
        isBuiltin={selectedIsBuiltin}
        updating={data.updatingSkill === selectedSkill?.slug}
        onOpenChange={(open) => { if (!open) setSelectedSkillSlug(null) }}
        onToggle={(enabled) => selectedSkill && data.toggleSkill(selectedSkill.slug, enabled)}
        onUpdate={() => selectedSkill && data.updateSkill(selectedSkill.slug)}
        onRequestDelete={() => selectedSkill && setPendingDeleteSkill(selectedSkill)}
        onOpenFolder={() => selectedSkill && openSkillFolder(selectedSkill.slug)}
        onChanged={() => bumpCapabilities((v) => v + 1)}
      />

      {/* Skill 删除确认 */}
      <ConfirmDialog
        open={pendingDeleteSkill !== null}
        onOpenChange={(open) => { if (!open) setPendingDeleteSkill(null) }}
        title={`确认删除 Skill「${pendingDeleteSkill?.name}」？`}
        description="删除后将无法恢复，确定要卸载这个 Skill 吗？"
        confirmLabel="删除"
        loadingLabel="删除中..."
        loading={isDeletingSkill}
        onConfirm={async () => {
          if (!pendingDeleteSkill || isDeletingSkill) return
          setIsDeletingSkill(true)
          const ok = await data.deleteSkill(pendingDeleteSkill.slug, pendingDeleteSkill.name)
          setIsDeletingSkill(false)
          setPendingDeleteSkill(null)
          if (ok) setSelectedSkillSlug(null)
        }}
      />

      {/* MCP 删除确认 */}
      <ConfirmDialog
        open={pendingDeleteMcpName !== null}
        onOpenChange={(open) => { if (!open) setPendingDeleteMcpName(null) }}
        title={`确认删除 MCP 服务器「${pendingDeleteMcpName}」？`}
        description="删除后将无法恢复，确定要删除这个 MCP 服务器吗？"
        confirmLabel="删除"
        loadingLabel="删除中..."
        loading={isDeletingMcp}
        onConfirm={async () => {
          if (!pendingDeleteMcpName || isDeletingMcp) return
          setIsDeletingMcp(true)
          await data.deleteMcp(pendingDeleteMcpName)
          setIsDeletingMcp(false)
          setPendingDeleteMcpName(null)
        }}
      />

      <McpDetailSheet
        open={mcpSheetOpen}
        server={editingMcp}
        workspaceSlug={data.workspaceSlug}
        onOpenChange={(open) => { setMcpSheetOpen(open); if (!open) bumpCapabilities((v) => v + 1) }}
        onSaved={() => setMcpSheetOpen(false)}
        onChanged={() => bumpCapabilities((v) => v + 1)}
      />

      <BuiltinMcpDetailSheet
        open={!!selectedBuiltinMcp}
        server={selectedBuiltinMcp}
        onOpenChange={(open) => { if (!open) setSelectedBuiltinMcp(null) }}
        onConfigure={configureBuiltinMcp}
      />

      {/* 凭据配置 Modal（居中，Mico 风格） */}
      <ConnectorDetailDialog
        open={configureServerId !== null}
        onOpenChange={(open) => { if (!open) setConfigureServerId(null) }}
        eyebrow="预置连接器"
        title={configureServerId ? (CONFIGURE_META[configureServerId]?.title ?? '') : ''}
        icon={
          configureServerId === 'web-search'
            ? <Search size={22} />
            : configureServerId
              ? getBuiltinMcpIcon(configureServerId)
              : undefined
        }
        tags={configureServerId ? (CONFIGURE_META[configureServerId]?.tags ?? []) : []}
      >
        {configureServerId === 'wecom' && <WecomSettings />}
        {configureServerId === 'readwise' && <ReadwiseSettings />}
        {configureServerId === 'weread' && <WereadSettings />}
        {configureServerId === 'nano-banana' && <NanoBananaSettings />}
        {configureServerId === 'web-search' && <WebSearchSettings />}
        {configureServerId && CONNECTOR_CREDENTIAL_SPECS[configureServerId] && (
          <ConnectorCredentials connectorId={configureServerId} />
        )}
      </ConnectorDetailDialog>

      <ImportSkillDialog
        open={showImport}
        onOpenChange={setShowImport}
        workspaceSlug={data.workspaceSlug}
        installedSkills={data.skills}
        onImported={() => bumpCapabilities((v) => v + 1)}
      />

      <OrgSkillImportDialog
        open={showOrgImport}
        onOpenChange={setShowOrgImport}
        workspaceSlug={data.workspaceSlug}
        installedSkills={data.skills}
        onImported={() => bumpCapabilities((v) => v + 1)}
      />

      <CommunityMarketDialog
        open={showCommunityMarket}
        onOpenChange={setShowCommunityMarket}
        workspaceSlug={data.workspaceSlug}
        installedSkills={data.skills}
        onImported={() => bumpCapabilities((v) => v + 1)}
      />
    </div>
  )
}

// ===== Skills Tab =====

interface SkillsTabProps {
  customSkills: SkillMeta[]
  builtinSkills: SkillMeta[]
  total: number
  updateCount: number
  updatingSkill: string | null
  /** 当前是否处于嵌套 Project 范围（仅影响空列表提示文案中“其他工作区”/“其他项目”的描述） */
  isProjectScope: boolean
  isBuiltin: (slug: string) => boolean
  onOpen: (slug: string) => void
  onToggle: (slug: string, enabled: boolean) => void
  onUpdate: (slug: string) => void
  /** 打开导入弹窗（按当前 scope 已在上层路由好），空列表下直接给一个可点击的入口，不再只用文字描述 */
  onImport: () => void
}

function SkillsTab({
  customSkills,
  builtinSkills,
  total,
  updateCount,
  updatingSkill,
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
  if (customSkills.length === 0 && builtinSkills.length === 0) {
    return <EmptyState icon={<Search className="size-8 text-foreground/30" />} title="没有匹配的 Skill" hint="试试更换搜索关键词。" />
  }

  return (
    <div className="flex flex-col gap-8">
      {updateCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/[0.06] px-3 py-2 text-[13px] text-blue-600 dark:text-blue-400">
          有 {updateCount} 个 Skill 可更新到来源最新版本
        </div>
      )}
      {customSkills.length > 0 && (
        <SkillSection title="我的 Skills" skills={customSkills} isBuiltin={isBuiltin} updatingSkill={updatingSkill} onOpen={onOpen} onToggle={onToggle} onUpdate={onUpdate} />
      )}
      {builtinSkills.length > 0 && (
        <SkillSection title="系统内置" skills={builtinSkills} isBuiltin={isBuiltin} updatingSkill={updatingSkill} onOpen={onOpen} onToggle={onToggle} onUpdate={onUpdate} />
      )}
    </div>
  )
}

interface SkillSectionProps {
  title: string
  skills: SkillMeta[]
  isBuiltin: (slug: string) => boolean
  updatingSkill: string | null
  onOpen: (slug: string) => void
  onToggle: (slug: string, enabled: boolean) => void
  onUpdate: (slug: string) => void
}

function SkillSection({ title, skills, isBuiltin, updatingSkill, onOpen, onToggle, onUpdate }: SkillSectionProps): React.ReactElement {
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
                      key={skill.slug}
                      skill={skill}
                      isBuiltin={isBuiltin(skill.slug)}
                      updating={updatingSkill === skill.slug}
                      onOpen={() => onOpen(skill.slug)}
                      onToggle={(enabled) => onToggle(skill.slug, enabled)}
                      onUpdate={() => onUpdate(skill.slug)}
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

// ===== 凭据配置 Modal 元信息 =====

/** 可配置凭据的连接器 → Modal 头部标题与标签（Mico 风格） */
const CONFIGURE_META: Record<string, { title: string; tags: string[] }> = {
  wecom: { title: '企业微信', tags: ['MCP 连接器', '协作办公', '官方 wecom-cli'] },
  readwise: { title: 'Readwise', tags: ['MCP 连接器', '协作办公', 'REST API 直连'] },
  weread: { title: '微信读书', tags: ['MCP 连接器', '协作办公', 'Agent Gateway'] },
  'nano-banana': { title: 'Nano Banana 生图', tags: ['MCP 连接器', '设计协作', 'Gemini'] },
  'web-search': { title: '联网搜索', tags: ['内置工具', '搜索与自动化'] },
  github: { title: 'GitHub', tags: ['MCP 连接器', '研发与交付', '官方 server'] },
  gitlab: { title: 'GitLab', tags: ['MCP 连接器', '研发与交付', '官方 server'] },
  notion: { title: 'Notion', tags: ['MCP 连接器', '协作办公', '官方 server'] },
  figma: { title: 'Figma', tags: ['MCP 连接器', '设计协作', '官方 developer MCP'] },
  'brave-search': { title: 'Brave Search', tags: ['MCP 连接器', '搜索与自动化', '官方 server'] },
  exa: { title: 'Exa', tags: ['MCP 连接器', '搜索与自动化', '官方 server'] },
  browserbase: { title: 'Browserbase', tags: ['MCP 连接器', '搜索与自动化', '官方 server'] },
  sqlite: { title: 'SQLite 数据库', tags: ['自研桥接', '数据与基础设施', '只读查询'] },
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
