/**
 * AgentSkillsView — Yoda 插件中心（专家 / 专家团 / Skills / MCP / API 统一配置）
 *
 * 全屏模式（activeView='agent-skills'）：左侧栏「Yoda 插件」独立入口，Home / Code 共享；
 * `embedded` prop 保留供未来嵌入其他容器复用，当前无消费者。
 *
 * 结构：
 * - 标题栏（全屏模式）：Yoda 插件
 * - 工具条：专家 / 专家团 / Skills / MCP / API 切换 + 搜索 + 新建/导入入口
 * - 内容：各能力 tab 卡片/列表，点击打开详情抽屉
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { Blocks, ChevronRight, Search, Plus, Store, Sparkles, Loader2, Building2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { agentPendingPromptAtom, workspaceCapabilitiesVersionAtom } from '@/atoms/agent-atoms'
import { agentSkillsTabAtom } from '@/atoms/active-view'
import { toolSettingsFocusAtom, type ToolSettingsFocus } from '@/atoms/settings-tab'
import { chatToolsAtom } from '@/atoms/chat-tool-atoms'
import { useCreateSession } from '@/hooks/useCreateSession'
import type { BuiltinMcpServerSummary, McpServerEntry, SkillMeta } from '@myyoda/shared'
import { useAgentSkillsData } from './useAgentSkillsData'
import { SkillCard } from './SkillCard'
import { McpCard } from './McpCard'
import { SkillDetailSheet } from './SkillDetailSheet'
import { McpDetailSheet } from './McpDetailSheet'
import { BuiltinMcpDetailSheet } from './BuiltinMcpDetailSheet'
import { ImportSkillDialog } from './ImportSkillDialog'
import { OrgSkillImportDialog } from './OrgSkillImportDialog'
import { CommunityMarketDialog } from './CommunityMarketDialog'
import { EnhancedToolsPanel } from '@/components/settings/ToolSettings'
import { AgentExpertsView } from '@/components/agent-experts/AgentExpertsView'
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
  const data = useAgentSkillsData()
  const bumpCapabilities = useSetAtom(workspaceCapabilitiesVersionAtom)
  const setPendingPrompt = useSetAtom(agentPendingPromptAtom)
  const setToolSettingsFocus = useSetAtom(toolSettingsFocusAtom)
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
  const [showImport, setShowImport] = React.useState(false)
  const [showOrgImport, setShowOrgImport] = React.useState(false)
  const [showCommunityMarket, setShowCommunityMarket] = React.useState(false)
  const [pendingDeleteSkill, setPendingDeleteSkill] = React.useState<SkillMeta | null>(null)
  const [pendingDeleteMcpName, setPendingDeleteMcpName] = React.useState<string | null>(null)
  const [isDeletingSkill, setIsDeletingSkill] = React.useState(false)
  const [isDeletingMcp, setIsDeletingMcp] = React.useState(false)
  const [classifyingSkills, setClassifyingSkills] = React.useState(false)

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
  // API（增强工具）Tab 计数：已启用的增强工具数量（联网搜索 / Nano Banana / 自定义工具）
  const apiToolCount = chatTools.filter((t) => t.enabled).length

  const selectedSkill = data.skills.find((s) => s.slug === selectedSkillSlug) ?? null
  const selectedIsBuiltin = selectedSkill ? data.defaultSkillSlugs.has(selectedSkill.slug) : false

  const openSkillFolder = (slug: string): void => {
    if (data.skillsDir) window.electronAPI.openFile(`${data.skillsDir}/${slug}`)
  }

  const configureBuiltinMcp = React.useCallback((serverId: string): void => {
    const focusMap: Partial<Record<string, ToolSettingsFocus>> = {
      'nano-banana': 'nano-banana',
    }
    const focus = focusMap[serverId]
    if (!focus) return
    // 增强工具已并入本视图 API Tab：切到 API Tab 并滚动到对应区块，不再跳设置弹窗
    setToolSettingsFocus(focus)
    setTab('api')
    setSelectedBuiltinMcp(null)
  }, [setTab, setToolSettingsFocus])

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
        <div className="titlebar-no-drag mx-auto flex w-full max-w-6xl shrink-0 items-center px-8 pt-14 pb-4">
          <div className="flex items-center gap-2.5">
            <Blocks className="size-6 text-foreground/70" />
            <h1 className="text-2xl font-semibold text-foreground">Yoda 插件</h1>
          </div>
        </div>
      )}

      {/* 工具条 */}
      <div className={cn('titlebar-no-drag flex w-full items-center gap-3 shrink-0', embedded ? 'flex-wrap' : 'mx-auto max-w-6xl px-8 pb-4')}>
        {/* 专家 / 专家团 / Skills / MCP / API 切换（Context 已升级为 Code 左侧模块） */}
        <div className="relative flex h-8 items-stretch rounded-xl bg-muted p-0.5">
          <div
            className={cn(
              'absolute bottom-0.5 top-0.5 w-[calc(20%-2px)] rounded-lg bg-background shadow-sm transition-transform duration-base ease-out',
              tab === 'experts' && 'translate-x-0',
              tab === 'teams' && 'translate-x-full',
              tab === 'skills' && 'translate-x-[200%]',
              tab === 'mcp' && 'translate-x-[300%]',
              tab === 'api' && 'translate-x-[400%]',
            )}
          />
          {([
            { value: 'experts' as const, label: '专家', count: expertsCount },
            { value: 'teams' as const, label: '专家团', count: teamsCount },
            { value: 'skills' as const, label: 'Skills', count: data.skills.length },
            { value: 'mcp' as const, label: 'MCP', count: mcpCount },
            { value: 'api' as const, label: 'API', count: apiToolCount },
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

        {/* 搜索框（API 占位 Tab 无搜索逻辑，隐藏） */}
        {tab !== 'api' && (
          <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border/60 bg-content-area px-3 transition-colors focus-within:border-primary/40">
            <Search size={14} className="shrink-0 text-foreground/40" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tab === 'experts' ? '搜索专家名称或 slug...' : tab === 'teams' ? '搜索专家团名称或角色...' : tab === 'skills' ? '搜索 Skills...' : '搜索 MCP 服务器...'}
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

        {/* 社区市场 */}
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

        {/* Skills：从其他工作区导入 */}
        {tab === 'skills' && (
          <>
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
            <button
              type="button"
              onClick={() => setShowImport(true)}
              className="flex h-8 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border/60 bg-content-area px-3 text-[13px] font-medium text-foreground/80 shadow-sm transition-colors hover:bg-foreground/[0.04]"
            >
              <Plus size={14} />
              <span>导入</span>
            </button>
            <button
              type="button"
              onClick={() => setShowOrgImport(true)}
              className="flex h-8 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 text-[13px] font-medium text-indigo-600 shadow-sm transition-colors hover:bg-indigo-500/20 dark:text-indigo-400"
            >
              <Building2 size={14} />
              <span>从企业组织导入</span>
            </button>
          </>
        )}

        {/* 新增 MCP */}
        {tab === 'mcp' && (
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
          ) : tab === 'api' ? (
            <EnhancedToolsPanel />
          ) : !data.hasWorkspace ? (
            <EmptyState
              icon={<Blocks className="size-8 text-foreground/30" />}
              title="未选择工作区"
              hint="请先选择或创建一个工作区，再来管理它的 Skills 与 MCP。"
            />
          ) : tab === 'skills' ? (
            <SkillsTab
              customSkills={customSkills}
              builtinSkills={builtinSkills}
              total={data.skills.length}
              updateCount={updateCount}
              updatingSkill={data.updatingSkill}
              isBuiltin={(slug) => data.defaultSkillSlugs.has(slug)}
              onOpen={setSelectedSkillSlug}
              onToggle={data.toggleSkill}
              onUpdate={data.updateSkill}
            />
          ) : tab === 'mcp' ? (
            <McpTab
              userEntries={userMcpEntries}
              builtinServers={builtinMcpServers}
              total={mcpCount}
              onOpen={(name, entry) => { setEditingMcp({ name, entry }); setMcpSheetOpen(true) }}
              onOpenBuiltin={setSelectedBuiltinMcp}
              onToggle={data.toggleMcp}
              onToggleBuiltin={data.toggleBuiltinMcp}
              onRequestDelete={setPendingDeleteMcpName}
              onAdd={() => { setEditingMcp(null); setMcpSheetOpen(true) }}
            />
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
  isBuiltin: (slug: string) => boolean
  onOpen: (slug: string) => void
  onToggle: (slug: string, enabled: boolean) => void
  onUpdate: (slug: string) => void
}

function SkillsTab({
  customSkills,
  builtinSkills,
  total,
  updateCount,
  updatingSkill,
  isBuiltin,
  onOpen,
  onToggle,
  onUpdate,
}: SkillsTabProps): React.ReactElement {
  if (total === 0) {
    return <EmptyState icon={<Blocks className="size-8 text-foreground/30" />} title="暂无 Skill" hint="可以在 Project 模式下让 MyYoda 帮你联网查找并安装 Skill，或从其他工作区导入。" />
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

// ===== MCP Tab =====

interface McpTabProps {
  userEntries: Array<[string, McpServerEntry]>
  builtinServers: BuiltinMcpServerSummary[]
  total: number
  onOpen: (name: string, entry: McpServerEntry) => void
  onOpenBuiltin: (server: BuiltinMcpServerSummary) => void
  onToggle: (name: string, enabled: boolean) => void
  onToggleBuiltin: (id: string, enabled: boolean) => void
  onRequestDelete: (name: string) => void
  onAdd: () => void
}

function McpTab({ userEntries, builtinServers, total, onOpen, onOpenBuiltin, onToggle, onToggleBuiltin, onRequestDelete, onAdd }: McpTabProps): React.ReactElement {
  if (total === 0) {
    return (
      <EmptyState
        icon={<Plus className="size-8 text-foreground/30" />}
        title="还没有 MCP 服务器"
        hint="点击右上角「添加服务器」开始，或在 Project 模式下让 MyYoda 帮你查找并配置。"
        action={
          <button
            type="button"
            onClick={onAdd}
            className="mt-2 flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            <Plus size={14} />
            <span>添加服务器</span>
          </button>
        }
      />
    )
  }
  if (userEntries.length === 0 && builtinServers.length === 0) {
    return <EmptyState icon={<Search className="size-8 text-foreground/30" />} title="没有匹配的 MCP 服务器" hint="试试更换搜索关键词。" />
  }

  return (
    <div className="flex flex-col gap-8">
      {userEntries.length > 0 && (
        <McpSection title="我的 MCP" count={userEntries.length}>
          {userEntries.map(([name, entry]) => (
            <McpCard
              key={name}
              name={name}
              entry={entry}
              onOpen={() => onOpen(name, entry)}
              onToggle={(enabled) => onToggle(name, enabled)}
              onRequestDelete={() => onRequestDelete(name)}
            />
          ))}
        </McpSection>
      )}

      {builtinServers.length > 0 && (
        <McpSection title="MyYoda 内置" count={builtinServers.length}>
          {builtinServers.map((server) => (
            <McpCard
              key={server.id}
              name={server.displayName}
              entry={{
                type: 'stdio',
                command: 'MyYoda 运行时注入',
                enabled: server.enabled,
                isBuiltin: true,
              }}
              description={server.description}
              targetLabel={server.availabilityReason ?? 'MyYoda 运行时注入'}
              statusLabel={getBuiltinMcpStatus(server).label}
              statusTone={getBuiltinMcpStatus(server).tone}
              readOnly
              onOpen={() => onOpenBuiltin(server)}
              onToggle={(enabled) => onToggleBuiltin(server.id, enabled)}
            />
          ))}
        </McpSection>
      )}
    </div>
  )
}

function getBuiltinMcpStatus(server: BuiltinMcpServerSummary): { label: string; tone: 'success' | 'warning' | 'muted' } {
  if (!server.enabled) return { label: '已关闭', tone: 'muted' }
  if (server.available) return { label: '可用', tone: 'success' }
  return { label: '需配置', tone: 'warning' }
}

function McpSection({ title, count, children }: { title: string; count: number; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 px-1">
        <span className="text-[13px] font-medium text-foreground/55">{title}</span>
        <span className="text-[12px] tabular-nums text-foreground/35">{count}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {children}
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
