/**
 * ConnectorsTab — 连接器 Tab（MCP + API 合并，对标小米 Mico 连接器市场）
 *
 * 顶部：分类 chip 筛选（全部/协作办公/研发与交付/设计协作/搜索与自动化/数据与基础设施/系统能力/我的/自定义）
 * 主体：4 列卡片网格（ConnectorCard），点击打开对应详情（居中 Modal / MCP 编辑 Sheet / 自定义工具详情）。
 */

import * as React from 'react'
import { Plug, Search, Globe, Trash2, GitBranch, Compass, BookOpen } from 'lucide-react'
import { useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { chatToolsAtom } from '@/atoms/chat-tool-atoms'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { BuiltinMcpServerSummary, McpServerEntry, MarketplaceItemWithStatus } from '@myyoda/shared'
import { getBuiltinMcpIcon } from '@/lib/builtin-mcp-icons'
import { ConnectorCard } from './ConnectorCard'
import { ConnectorDetailDialog } from './ConnectorDetailDialog'
import { ConnectorCollectionDialog, type ConnectorCollection } from './ConnectorCollectionDialog'

// ===== 品类 =====

export type ConnectorCategory = 'all' | 'office' | 'knowledge' | 'code' | 'design' | 'search' | 'data' | 'system' | 'mine' | 'custom'

const CHIPS: Array<{ key: ConnectorCategory; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'office', label: '协作办公' },
  { key: 'knowledge', label: '知识' },
  { key: 'code', label: '研发与交付' },
  { key: 'design', label: '设计协作' },
  { key: 'search', label: '搜索与自动化' },
  { key: 'data', label: '数据与基础设施' },
  { key: 'system', label: '系统能力' },
  { key: 'mine', label: '我的' },
  { key: 'custom', label: '自定义' },
]

const CATEGORY_LABEL: Record<Exclude<ConnectorCategory, 'all'>, string> = {
  office: '协作办公',
  knowledge: '知识',
  code: '研发与交付',
  design: '设计协作',
  search: '搜索与自动化',
  data: '数据与基础设施',
  system: '系统能力',
  mine: '我的 MCP',
  custom: '自定义',
}

const CATEGORY_ORDER: Array<Exclude<ConnectorCategory, 'all'>> = [
  'office',
  'knowledge',
  'code',
  'design',
  'search',
  'data',
  'system',
  'mine',
  'custom',
]

/** 内置 MCP 服务器 → 连接器品类映射 */
function categoryOfBuiltin(server: BuiltinMcpServerSummary): Exclude<ConnectorCategory, 'all'> {
  switch (server.category) {
    case 'office':
      return 'office'
    case 'knowledge':
      return 'knowledge'
    case 'browser':
    case 'code':
      return 'code'
    case 'media':
    case 'design':
      return 'design'
    case 'search':
      return 'search'
    case 'data':
      return 'data'
    default:
      return 'system'
  }
}

/** 市场条目分类（中文）→ 连接器品类 */
function categoryOfMarketplace(category: string | undefined): Exclude<ConnectorCategory, 'all'> {
  switch (category) {
    case '协作办公': return 'office'
    case '知识': return 'knowledge'
    case '研发与交付': return 'code'
    case '设计协作': return 'design'
    case '搜索与自动化': return 'search'
    case '数据与基础设施': return 'data'
    default: return 'system'
  }
}

/** 需要凭据配置的连接器（打开凭据配置 Modal）；其余内置连接器打开只读详情 Modal */
const CONFIGURABLE_IDS = new Set([
  'weread', 'nano-banana', 'web-search',
  'github', 'gitlab', 'notion', 'figma', 'brave-search', 'exa', 'browserbase', 'sqlite',
])

/** 精选集合（对标 OpenAI Plugins Collections：推荐组合一键启用） */
const COLLECTIONS: ConnectorCollection[] = [
  {
    id: 'dev-essentials',
    title: '开发必备',
    description: '代码托管与版本管理',
    icon: <GitBranch size={16} />,
    connectorIds: ['github', 'gitlab', 'git'],
  },
  {
    id: 'deep-research',
    title: '深度研究',
    description: '搜索与内容抓取',
    icon: <Compass size={16} />,
    connectorIds: ['brave-search', 'exa', 'fetch'],
  },
  {
    id: 'personal-knowledge',
    title: '个人知识库',
    description: '阅读笔记与文档',
    icon: <BookOpen size={16} />,
    connectorIds: ['weread', 'notion'],
  },
]

// ===== 卡片视图模型 =====

interface ConnectorItem {
  key: string
  name: string
  description: string
  icon: React.ReactNode
  category: Exclude<ConnectorCategory, 'all'>
  categoryLabel: string
  statusLabel?: string
  statusTone?: 'success' | 'warning' | 'muted'
  vendorLabel?: string
  enabled: boolean
  hasToggle: boolean
}

// ===== Props =====

interface ConnectorsTabProps {
  builtinServers: BuiltinMcpServerSummary[]
  userEntries: Array<[string, McpServerEntry]>
  /** 市场目录条目（含安装状态）：已安装的连接器/CLI 展示为卡片 */
  marketplaceItems?: MarketplaceItemWithStatus[]
  onOpenBuiltin: (server: BuiltinMcpServerSummary) => void
  onOpenMcp: (name: string, entry: McpServerEntry) => void
  onToggleBuiltin: (id: string, enabled: boolean) => void
  onToggleMcp: (name: string, enabled: boolean) => void
  onAddMcp: () => void
  onConfigure: (serverId: string) => void
  /** 打开市场条目的凭据/详情（serverId 形如 marketplace:<id>） */
  onConfigureMarketplace: (serverId: string) => void
  /** 市场条目卸载后刷新（重新拉取市场列表） */
  onMarketplaceChanged?: () => void
  externalSearch: string
}

function builtinStatus(server: BuiltinMcpServerSummary): { label: string; tone: 'success' | 'warning' | 'muted' } {
  if (!server.enabled) return { label: '已关闭', tone: 'muted' }
  if (server.available) return { label: '已启用', tone: 'success' }
  return { label: '需配置', tone: 'warning' }
}

/** 重新加载工具列表并同步到 atom（与 ToolSettings 中的 refreshChatTools 等价） */
async function refreshTools(
  setter: (tools: Awaited<ReturnType<typeof window.electronAPI.getChatTools>>) => void,
): Promise<void> {
  const tools = await window.electronAPI.getChatTools()
  setter(tools)
}

export function ConnectorsTab({
  builtinServers,
  userEntries,
  marketplaceItems = [],
  onOpenBuiltin,
  onOpenMcp,
  onToggleBuiltin,
  onToggleMcp,
  onAddMcp,
  onConfigure,
  onConfigureMarketplace,
  onMarketplaceChanged,
  externalSearch,
}: ConnectorsTabProps): React.ReactElement {
  const [category, setCategory] = React.useState<ConnectorCategory>('all')
  const [selectedCustomToolId, setSelectedCustomToolId] = React.useState<string | null>(null)
  const [activeCollection, setActiveCollection] = React.useState<ConnectorCollection | null>(null)
  const chatTools = useAtomValue(chatToolsAtom)
  const setChatTools = useSetAtom(chatToolsAtom)

  const q = externalSearch.trim().toLowerCase()

  // 增强工具：联网搜索 + 自定义 HTTP 工具
  const webSearchTool = React.useMemo(
    () => chatTools.find((t) => t.meta.id === 'web-search'),
    [chatTools],
  )
  const customTools = React.useMemo(
    () => chatTools.filter((t) => t.meta.category === 'custom'),
    [chatTools],
  )

  // 聚合卡片列表
  const items = React.useMemo((): ConnectorItem[] => {
    const list: ConnectorItem[] = []

    for (const server of builtinServers) {
      const cat = categoryOfBuiltin(server)
      const status = builtinStatus(server)
      list.push({
        key: `builtin:${server.id}`,
        name: server.displayName,
        description: server.description,
        icon: getBuiltinMcpIcon(server.id),
        category: cat,
        categoryLabel: CATEGORY_LABEL[cat],
        statusLabel: status.label,
        statusTone: status.tone,
        vendorLabel: server.source?.vendor === 'official' ? '官方' : server.source?.vendor === 'myyoda' ? '自研' : undefined,
        enabled: server.enabled,
        hasToggle: true,
      })
    }

    if (webSearchTool) {
      const enabled = webSearchTool.enabled
      const status = enabled
        ? webSearchTool.available
          ? { label: '已启用', tone: 'success' as const }
          : { label: '需配置', tone: 'warning' as const }
        : { label: '已关闭', tone: 'muted' as const }
      list.push({
        key: 'web-search',
        name: '联网搜索',
        description: '为 Agent 提供实时联网搜索能力，可配置 Tavily / Brave 等搜索 API Key。',
        icon: <Search size={20} />,
        category: 'search',
        categoryLabel: CATEGORY_LABEL.search,
        statusLabel: status.label,
        statusTone: status.tone,
        enabled,
        hasToggle: true,
      })
    }

    for (const [name, entry] of userEntries) {
      const enabled = entry.enabled !== false
      list.push({
        key: `mcp:${name}`,
        name,
        description: entry.type === 'stdio' ? (entry.command ?? '') : (entry.url ?? ''),
        icon: <Plug size={20} />,
        category: 'mine',
        categoryLabel: CATEGORY_LABEL.mine,
        statusLabel: enabled ? '已启用' : '已关闭',
        statusTone: enabled ? 'success' : 'muted',
        enabled,
        hasToggle: true,
      })
    }

    for (const tool of customTools) {
      const enabled = tool.enabled
      list.push({
        key: `custom:${tool.meta.id}`,
        name: tool.meta.name,
        description: tool.meta.description,
        icon: <Globe size={20} />,
        category: 'custom',
        categoryLabel: CATEGORY_LABEL.custom,
        statusLabel: enabled ? '已启用' : '已关闭',
        statusTone: enabled ? 'success' : 'muted',
        enabled,
        hasToggle: true,
      })
    }

    for (const item of marketplaceItems) {
      // 连接器 Tab 只展示市场安装的连接器/CLI；技能类条目（chatcut/heygen 等）归技能 Tab
      if (!item.installed || item.type !== 'connector') continue
      const cat = categoryOfMarketplace(item.category)
      const isCli = item.installKind === 'cli'
      // CLI 连接器：系统安装+认证状态区分
      const statusLabel = isCli
        ? (!item.systemInstalled ? '未安装'
          : !item.authenticated ? '需认证' : '系统已安装')
        : (item.hasCredentials ? '已启用' : '需配置')
      const statusTone = isCli
        ? (!item.systemInstalled ? 'muted'
          : !item.authenticated ? 'warning' : 'success')
        : (item.hasCredentials ? 'success' : 'warning')
      list.push({
        key: `marketplace:${item.id}`,
        name: item.name,
        description: isCli ? `${item.description}（CLI 工具）` : item.description,
        icon: item.iconKey ? getBuiltinMcpIcon(item.iconKey) : <Plug size={20} />,
        category: cat,
        categoryLabel: CATEGORY_LABEL[cat],
        statusLabel,
        statusTone,
        vendorLabel: item.vendor === 'official' ? '官方' : item.vendor === 'community' ? '社区' : undefined,
        // 开关 = 注入启用状态（marketplaceInstalled）；垃圾桶 = 彻底移除
        enabled: item.marketplaceInstalled ?? false,
        hasToggle: true,
      })
    }

    return list
  }, [builtinServers, userEntries, customTools, webSearchTool, marketplaceItems])

  // 搜索 + 品类过滤
  const filtered = React.useMemo(() => {
    return items.filter((item) => {
      if (category !== 'all' && item.category !== category) return false
      if (!q) return true
      return (
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.categoryLabel.toLowerCase().includes(q)
      )
    })
  }, [items, category, q])

  const total = items.length

  // 点击卡片 → 按类型打开对应详情
  const handleOpen = (item: ConnectorItem): void => {
    if (item.key.startsWith('builtin:')) {
      const serverId = item.key.slice('builtin:'.length)
      const server = builtinServers.find((s) => s.id === serverId)
      if (!server) return
      if (CONFIGURABLE_IDS.has(serverId)) {
        onConfigure(serverId)
      } else {
        onOpenBuiltin(server)
      }
      return
    }
    if (item.key === 'web-search') {
      onConfigure('web-search')
      return
    }
    if (item.key.startsWith('mcp:')) {
      const name = item.key.slice('mcp:'.length)
      const entry = userEntries.find(([n]) => n === name)
      if (entry) onOpenMcp(entry[0], entry[1])
      return
    }
    if (item.key.startsWith('marketplace:')) {
      onConfigureMarketplace(item.key)
      return
    }
    if (item.key.startsWith('custom:')) {
      setSelectedCustomToolId(item.key.slice('custom:'.length))
    }
  }

  const handleToggle = (item: ConnectorItem, enabled: boolean): void => {
    if (item.key.startsWith('builtin:')) {
      onToggleBuiltin(item.key.slice('builtin:'.length), enabled)
    } else if (item.key.startsWith('marketplace:')) {
      const id = item.key.slice('marketplace:'.length)
      void window.electronAPI
        .marketplaceToggle(id, enabled)
        .then(() => onMarketplaceChanged?.())
        .catch((error) => {
          console.error(`[连接器] 切换失败（${id}）:`, error)
          toast.error('切换失败')
        })
    } else if (item.key === 'web-search') {
      void window.electronAPI.updateChatToolState('web-search', { enabled }).then(() => refreshTools(setChatTools))
    } else if (item.key.startsWith('mcp:')) {
      onToggleMcp(item.key.slice('mcp:'.length), enabled)
    } else if (item.key.startsWith('custom:')) {
      void window.electronAPI.updateChatToolState(item.key.slice('custom:'.length), { enabled }).then(() => refreshTools(setChatTools))
    }
  }

  /** 卸载市场安装的连接器（移除注入；CLI 保留系统，凭据保留） */
  const handleRemoveMarketplace = (item: ConnectorItem): void => {
    const id = item.key.slice('marketplace:'.length)
    void window.electronAPI
      .marketplaceUninstall(id)
      .then(() => {
        toast.success(`已从会话移除 ${item.name}`)
        onMarketplaceChanged?.()
      })
      .catch((error) => {
        console.error(`[连接器] 卸载失败（${id}）:`, error)
        toast.error('移除失败')
      })
  }

  // 集合引导面板：点击某项 → 关闭面板 → 打开对应凭据配置 / 只读详情
  const handleCollectionItem = (server: BuiltinMcpServerSummary): void => {
    setActiveCollection(null)
    if (CONFIGURABLE_IDS.has(server.id)) {
      onConfigure(server.id)
    } else {
      onOpenBuiltin(server)
    }
  }

  const selectedCustomTool = selectedCustomToolId
    ? customTools.find((t) => t.meta.id === selectedCustomToolId)
    : null

  // 空状态
  if (total === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-24 text-center">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-foreground/[0.04]">
          <Plug size={28} className="text-foreground/30" />
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="text-[15px] font-medium text-foreground/85">还没有连接器</div>
          <div className="text-[13px] leading-relaxed text-foreground/50">
            预置连接器开箱即用；也可以添加你自己的 MCP 服务器。
          </div>
        </div>
        <Button onClick={onAddMcp}>
          <Plug size={14} />
          <span>添加 MCP 服务器</span>
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {/* 精选集合（对标 OpenAI Plugins Collections）：推荐组合一键启用，仅在「全部」分类显示 */}
      {category === 'all' && builtinServers.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {COLLECTIONS.map((collection) => {
            const servers = collection.connectorIds
              .map((id) => builtinServers.find((s) => s.id === id))
              .filter((s): s is BuiltinMcpServerSummary => Boolean(s))
            const configuredCount = servers.filter((s) => s.enabled && s.available).length
            return (
              <button
                key={collection.id}
                type="button"
                onClick={() => setActiveCollection(collection)}
                className="group flex flex-col gap-2.5 rounded-xl border border-dashed border-border/70 bg-content-area/50 p-3.5 text-left transition-colors hover:border-primary/40 hover:bg-content-area/80"
              >
                <div className="flex items-center gap-2">
                  <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    {collection.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-foreground">{collection.title}</div>
                    <div className="truncate text-[11px] text-muted-foreground">{collection.description}</div>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {configuredCount === servers.length ? (
                      <span className="text-emerald-600 dark:text-emerald-400">全部配置完成</span>
                    ) : (
                      `已配置 ${configuredCount}/${servers.length}`
                    )}
                  </span>
                  <span className="text-[11px] font-medium text-primary opacity-70 transition-opacity group-hover:opacity-100">
                    去配置 →
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* 分类 chip 筛选（对标 Mico 顶部分类） */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-thin">
        {CHIPS.map((chip) => (
          <button
            key={chip.key}
            type="button"
            onClick={() => setCategory(chip.key)}
            className={cn(
              'shrink-0 rounded-full px-3 py-1 text-[12px] font-medium transition-colors duration-fast',
              category === chip.key
                ? 'bg-foreground text-background'
                : 'bg-muted text-muted-foreground hover:bg-foreground/10 hover:text-foreground',
            )}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {/* 全部页：按分类分块展示；具体分类：4 列网格 */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="text-[14px] font-medium text-foreground/70">没有匹配的连接器</div>
          <div className="text-[13px] text-foreground/45">试试更换分类或搜索关键词。</div>
        </div>
      ) : category === 'all' ? (
        <div className="flex flex-col gap-8">
          {CATEGORY_ORDER.map((cat) => {
            const catItems = filtered.filter((item) => item.category === cat)
            if (catItems.length === 0) return null
            return (
              <section key={cat} className="flex flex-col gap-3">
                <div className="text-sm font-semibold text-foreground">{CATEGORY_LABEL[cat]}</div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                  {catItems.map((item) => (
                    <ConnectorCard
                      key={item.key}
                      id={item.key}
                      name={item.name}
                      description={item.description}
                      icon={item.icon}
                      categoryLabel={item.categoryLabel}
                      statusLabel={item.statusLabel}
                      statusTone={item.statusTone}
                      vendorLabel={item.vendorLabel}
                      enabled={item.enabled}
                      onOpen={() => handleOpen(item)}
                      onToggle={(enabled) => handleToggle(item, enabled)}
                    />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {filtered.map((item) => (
            <ConnectorCard
              key={item.key}
              id={item.key}
              name={item.name}
              description={item.description}
              icon={item.icon}
              categoryLabel={item.categoryLabel}
              statusLabel={item.statusLabel}
              statusTone={item.statusTone}
              vendorLabel={item.vendorLabel}
              enabled={item.enabled}
              onOpen={() => handleOpen(item)}
              onToggle={(enabled) => handleToggle(item, enabled)}
              onRemove={item.key.startsWith('marketplace:') ? () => handleRemoveMarketplace(item) : undefined}
            />
          ))}
        </div>
      )}

      {/* 精选集合配置引导面板 */}
      <ConnectorCollectionDialog
        open={activeCollection !== null}
        onOpenChange={(open) => {
          if (!open) setActiveCollection(null)
        }}
        collection={activeCollection}
        servers={builtinServers}
        onOpenServer={handleCollectionItem}
      />

      {/* 自定义工具详情（居中 Modal） */}
      <ConnectorDetailDialog
        open={selectedCustomTool !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedCustomToolId(null)
        }}
        eyebrow="自定义连接器"
        title={selectedCustomTool?.meta.name ?? ''}
        icon={<Globe size={22} />}
        tags={
          selectedCustomTool?.meta.httpConfig
            ? ['HTTP', selectedCustomTool.meta.httpConfig.method, '自定义']
            : ['自定义']
        }
        primaryLabel={selectedCustomTool?.enabled ? '禁用' : '启用'}
        onPrimary={() => {
          if (!selectedCustomTool) return
          void window.electronAPI
            .updateChatToolState(selectedCustomTool.meta.id, {
              enabled: !selectedCustomTool.enabled,
            })
            .then(() => refreshTools(setChatTools))
          setSelectedCustomToolId(null)
        }}
      >
        {selectedCustomTool && (
          <div className="flex flex-col gap-4">
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              {selectedCustomTool.meta.description}
            </p>
            {selectedCustomTool.meta.httpConfig && (
              <div className="flex flex-col gap-2">
                <InfoRow label="URL 模板" value={selectedCustomTool.meta.httpConfig.urlTemplate} mono />
                <InfoRow label="方法" value={selectedCustomTool.meta.httpConfig.method} />
                {selectedCustomTool.meta.params.length > 0 && (
                  <InfoRow
                    label="参数"
                    value={selectedCustomTool.meta.params.map((p) => p.name).join('、')}
                  />
                )}
              </div>
            )}
            <div className="flex items-center justify-between rounded-lg bg-muted/45 px-3 py-2.5">
              <span className="text-[13px] font-medium text-foreground">启用状态</span>
              <Switch
                checked={selectedCustomTool.enabled}
                onCheckedChange={(checked) => {
                  void window.electronAPI
                    .updateChatToolState(selectedCustomTool.meta.id, { enabled: checked })
                    .then(() => refreshTools(setChatTools))
                }}
              />
            </div>
            <div className="flex justify-end border-t border-border/60 pt-3">
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => {
                  const tool = selectedCustomTool
                  setSelectedCustomToolId(null)
                  void window.electronAPI
                    .deleteCustomChatTool(tool.meta.id)
                    .then(() => refreshTools(setChatTools))
                    .then(() => toast.success(`已删除工具：${tool.meta.name}`))
                    .catch(() => toast.error('删除工具失败'))
                }}
              >
                <Trash2 size={14} />
                <span>删除该工具</span>
              </Button>
            </div>
          </div>
        )}
      </ConnectorDetailDialog>
    </div>
  )
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }): React.ReactElement {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-muted/45 px-3 py-2.5">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      <span className={cn('break-all text-[13px] text-foreground', mono && 'font-mono text-[12px]')}>
        {value}
      </span>
    </div>
  )
}
