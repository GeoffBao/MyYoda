/**
 * ConnectorsTab — 插件中心「连接器」：MCP + API 工具 + 自定义 HTTP 合成列表
 *
 * 卡片打开分流：
 * - user-mcp → McpDetailSheet（由父级 onOpenMcp 挂载）
 * - builtin-mcp → BuiltinMcpDetailSheet（由父级 onOpenBuiltin 挂载）
 * - api-tool / custom-http → 本组件内 ConnectorDetailDialog
 *
 * nano-banana 配置：父级关闭 BuiltinMcpDetailSheet 后通过 openConnectorSourceId
 * 打开 ConnectorDetailDialog（DefaultBody 渲染 NanoBananaSettings）。
 */

import * as React from 'react'
import { AlertTriangle, FolderOpen, Globe, Plus, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { useAtomValue, useSetAtom } from 'jotai'
import { chatToolsAtom } from '@/atoms/chat-tool-atoms'
import { buildConnectorItems, type ConnectorItem } from '@/lib/connectors-model'
import type { BuiltinMcpServerSummary, GlobalScopeReviewHints, McpServerEntry } from '@myyoda/shared'
import { ConnectorCard, connectorKindLabel } from './ConnectorCard'
import { ConnectorDetailDialog } from './ConnectorDetailDialog'

interface ConnectorsTabProps {
  builtinServers: BuiltinMcpServerSummary[]
  userEntries: Array<[string, McpServerEntry]>
  query: string
  mcpIsProjectOverride: boolean
  reviewHints: GlobalScopeReviewHints | null
  onDismissHints: () => void
  onAddMcp: () => void
  onOpenMcp: (name: string, entry: McpServerEntry) => void
  onOpenBuiltin: (server: BuiltinMcpServerSummary) => void
  onToggleBuiltin: (id: string, enabled: boolean) => Promise<void> | void
  onToggleMcp: (name: string, enabled: boolean) => Promise<void> | void
  /** 父级请求打开某个 sourceId 的 ConnectorDetailDialog（如 nano-banana 配置） */
  openConnectorSourceId?: string | null
  onOpenConnectorConsumed?: () => void
  /** 仅 user-mcp：卡片垃圾桶回调，父级 ConfirmDialog 确认后走 deleteMcp */
  onRequestDeleteMcp?: (name: string) => void
}

export function ConnectorsTab({
  builtinServers,
  userEntries,
  query,
  mcpIsProjectOverride,
  reviewHints,
  onDismissHints,
  onAddMcp,
  onOpenMcp,
  onOpenBuiltin,
  onToggleBuiltin,
  onToggleMcp,
  openConnectorSourceId,
  onOpenConnectorConsumed,
  onRequestDeleteMcp,
}: ConnectorsTabProps): React.ReactElement {
  const chatTools = useAtomValue(chatToolsAtom)
  const setChatTools = useSetAtom(chatToolsAtom)
  const [selected, setSelected] = React.useState<ConnectorItem | null>(null)

  const items = React.useMemo(
    () => buildConnectorItems({ builtinServers, userEntries, chatTools }),
    [builtinServers, chatTools, userEntries],
  )

  const q = query.trim().toLowerCase()
  const filtered = React.useMemo(() => {
    if (!q) return items
    return items.filter((item) => {
      const kindLabel = connectorKindLabel(item.kind).toLowerCase()
      return (
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.categoryLabel.toLowerCase().includes(q) ||
        kindLabel.includes(q)
      )
    })
  }, [items, q])

  React.useEffect(() => {
    if (!openConnectorSourceId) return
    const item = items.find((candidate) => candidate.sourceId === openConnectorSourceId)
    if (item) {
      setSelected(item)
    } else {
      console.error('[连接器] 未找到要打开的连接器:', openConnectorSourceId)
      toast.error('未找到对应连接器')
    }
    onOpenConnectorConsumed?.()
  }, [items, onOpenConnectorConsumed, openConnectorSourceId])

  const openItem = React.useCallback((item: ConnectorItem): void => {
    switch (item.kind) {
      case 'user-mcp': {
        const entry = userEntries.find(([name]) => name === item.sourceId)?.[1]
        if (!entry) {
          console.error('[连接器] 未找到用户 MCP:', item.sourceId)
          toast.error('未找到该 MCP 服务器')
          return
        }
        onOpenMcp(item.sourceId, entry)
        return
      }
      case 'builtin-mcp': {
        const server = builtinServers.find((candidate) => candidate.id === item.sourceId)
        if (!server) {
          console.error('[连接器] 未找到内置 MCP:', item.sourceId)
          toast.error('未找到该内置 MCP')
          return
        }
        onOpenBuiltin(server)
        return
      }
      case 'api-tool':
      case 'custom-http':
        setSelected(item)
        return
      default: {
        const _exhaustive: never = item.kind
        return _exhaustive
      }
    }
  }, [builtinServers, onOpenBuiltin, onOpenMcp, userEntries])

  const toggle = React.useCallback(async (item: ConnectorItem, enabled: boolean): Promise<void> => {
    try {
      switch (item.kind) {
        case 'builtin-mcp':
          await onToggleBuiltin(item.sourceId, enabled)
          return
        case 'user-mcp':
          await onToggleMcp(item.sourceId, enabled)
          return
        case 'api-tool':
        case 'custom-http':
          await window.electronAPI.updateChatToolState(item.sourceId, { enabled })
          setChatTools(await window.electronAPI.getChatTools())
          return
        default: {
          const _exhaustive: never = item.kind
          return _exhaustive
        }
      }
    } catch (error) {
      console.error('[连接器] 切换状态失败:', error)
      toast.error('切换连接器状态失败')
    }
  }, [onToggleBuiltin, onToggleMcp, setChatTools])

  const hasReviewHints = !!reviewHints && (
    reviewHints.leftoverWorkspaceMcp.length > 0 || reviewHints.mcpSuffixedServers.length > 0
  )

  const scopeBanner = (
    <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-content-area px-3 py-2 text-[13px] text-foreground/60">
      {mcpIsProjectOverride ? (
        <>
          <FolderOpen size={14} className="shrink-0 text-purple-500" />
          <span>当前项目已配置专属 MCP，完全覆盖全局配置，仅本项目生效</span>
        </>
      ) : (
        <>
          <Globe size={14} className="shrink-0 text-indigo-500" />
          <span>MCP 为全局配置，所有工作区共享使用；切换工作区不会改变这份列表</span>
        </>
      )}
    </div>
  )

  const hintsBanner = hasReviewHints && reviewHints && (
    <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[13px] leading-5 text-amber-700 dark:text-amber-400">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <div className="flex-1 space-y-1">
        <div>升级时已将各工作区的 MCP 合并进全局配置，发现以下需要你确认：</div>
        {reviewHints.mcpSuffixedServers.length > 0 && (
          <div className="text-amber-600/80 dark:text-amber-400/70">
            同名冲突已加后缀保留：{reviewHints.mcpSuffixedServers.join('、')}（可在下方列表里重命名或删除冗余项）
          </div>
        )}
        {reviewHints.leftoverWorkspaceMcp.length > 0 && (
          <div className="text-amber-600/80 dark:text-amber-400/70">
            以下工作区迁移尚未完成：{reviewHints.leftoverWorkspaceMcp.join('、')}（重启 MyYoda 会自动重试）
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onDismissHints}
        className="shrink-0 rounded p-1 text-amber-600/60 transition-colors hover:bg-amber-500/10 hover:text-amber-700 dark:text-amber-400/60"
      >
        <X size={14} />
      </button>
    </div>
  )

  let body: React.ReactNode
  if (items.length === 0) {
    body = <EmptyConnectors onAddMcp={onAddMcp} />
  } else if (filtered.length === 0) {
    body = <EmptySearch />
  } else {
    body = (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((item) => (
          <ConnectorCard
            key={item.id}
            item={item}
            onOpen={() => openItem(item)}
            onToggle={(enabled) => void toggle(item, enabled)}
            onRequestDelete={
              item.kind === 'user-mcp' && onRequestDeleteMcp
                ? () => onRequestDeleteMcp(item.sourceId)
                : undefined
            }
          />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      {scopeBanner}
      {hintsBanner}
      {body}
      <ConnectorDetailDialog
        open={!!selected}
        item={selected}
        onOpenChange={(open) => { if (!open) setSelected(null) }}
      />
    </div>
  )
}

function EmptyConnectors({ onAddMcp }: { onAddMcp: () => void }): React.ReactElement {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 pt-24 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-foreground/[0.04]">
        <Plus className="size-8 text-foreground/30" />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="text-[15px] font-medium text-foreground/85">暂无连接器</div>
        <p className="text-[13px] leading-relaxed text-foreground/50">
          点击下方按钮添加 MCP 服务器。API Key 工具配置后会出现在此列表。
        </p>
      </div>
      <button
        type="button"
        onClick={onAddMcp}
        className="mt-2 flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
      >
        <Plus size={14} />
        <span>添加服务器</span>
      </button>
    </div>
  )
}

function EmptySearch(): React.ReactElement {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 pt-24 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-foreground/[0.04]">
        <Search className="size-8 text-foreground/30" />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="text-[15px] font-medium text-foreground/85">没有匹配的连接器</div>
        <p className="text-[13px] leading-relaxed text-foreground/50">试试更换搜索关键词。</p>
      </div>
    </div>
  )
}
