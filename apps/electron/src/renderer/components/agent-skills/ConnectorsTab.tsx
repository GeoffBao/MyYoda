/**
 * ConnectorsTab — 连接器（对标小米 Mico / PR #105）
 *
 * 顶部：作用域说明 + 需配置引导；分类/生命周期 chip；主体按品类分块的卡片网格。
 * 卡片不暴露 MCP/API；详情统一走居中 ConnectorDetailDialog。
 * 「添加连接器」下拉：本地/远程服务（MCP 表单）或自定义 HTTP。已有连接的编辑在详情弹层内完成。
 */

import * as React from 'react'
import { AlertTriangle, ArrowRight, FolderOpen, Globe, Plus, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { useAtomValue, useSetAtom } from 'jotai'
import { chatToolsAtom } from '@/atoms/chat-tool-atoms'
import { cn } from '@/lib/utils'
import {
  buildConnectorItems,
  CONNECTOR_FILTER_CHIPS,
  filterConnectorItems,
  groupConnectorItems,
  isConnectorAttentionStatus,
  type ConnectorFilterChip,
  type ConnectorItem,
} from '@/lib/connectors-model'
import type { BuiltinMcpServerSummary, GlobalScopeReviewHints, McpServerEntry } from '@myyoda/shared'
import { ConnectorCard } from './ConnectorCard'
import { ConnectorDetailDialog } from './ConnectorDetailDialog'
import { AddConnectorMenu } from './AddConnectorMenu'

interface ConnectorsTabProps {
  builtinServers: BuiltinMcpServerSummary[]
  userEntries: Array<[string, McpServerEntry]>
  query: string
  mcpIsProjectOverride: boolean
  reviewHints: GlobalScopeReviewHints | null
  onDismissHints: () => void
  onAddMcp: () => void
  onAddHttp: () => void
  onToggleBuiltin: (id: string, enabled: boolean) => Promise<void> | void
  onToggleMcp: (name: string, enabled: boolean) => Promise<void> | void
  workspaceSlug: string
  projectId?: string | null
  onUserMcpChanged?: () => void
  /** 要自动打开的连接器完整 id（带 kind 命名空间，如 api:web-search / builtin:chrome-devtools） */
  openConnectorId?: string | null
  onOpenConnectorConsumed?: () => void
  onRequestDeleteMcp?: (name: string) => void
  onRequestDeleteHttp?: (item: { id: string; name: string }) => void
}

export function ConnectorsTab({
  builtinServers,
  userEntries,
  query,
  mcpIsProjectOverride,
  reviewHints,
  onDismissHints,
  onAddMcp,
  onAddHttp,
  onToggleBuiltin,
  onToggleMcp,
  workspaceSlug,
  projectId,
  onUserMcpChanged,
  openConnectorId,
  onOpenConnectorConsumed,
  onRequestDeleteMcp,
  onRequestDeleteHttp,
}: ConnectorsTabProps): React.ReactElement {
  const chatTools = useAtomValue(chatToolsAtom)
  const setChatTools = useSetAtom(chatToolsAtom)
  const [toolsFetchDone, setToolsFetchDone] = React.useState(chatTools.length > 0)

  React.useEffect(() => {
    if (chatTools.length > 0) {
      setToolsFetchDone(true)
      return
    }
    let cancelled = false
    void window.electronAPI.getChatTools()
      .then((tools) => {
        if (!cancelled) setChatTools(tools)
      })
      .catch((error) => {
        console.error('[连接器] 加载工具列表失败:', error)
      })
      .finally(() => {
        if (!cancelled) setToolsFetchDone(true)
      })
    return () => {
      cancelled = true
    }
  }, [chatTools.length, setChatTools])
  const [selected, setSelected] = React.useState<ConnectorItem | null>(null)
  const [chip, setChip] = React.useState<ConnectorFilterChip>('all')

  const items = React.useMemo(
    () => buildConnectorItems({ builtinServers, userEntries, chatTools }),
    [builtinServers, chatTools, userEntries],
  )
  const filtered = React.useMemo(
    () => filterConnectorItems(items, query, chip),
    [chip, items, query],
  )
  const groups = React.useMemo(() => groupConnectorItems(filtered), [filtered])

  const openItem = React.useCallback((item: ConnectorItem): void => {
    setSelected(item)
  }, [])

  React.useEffect(() => {
    if (!openConnectorId) return
    const item = items.find((candidate) => candidate.id === openConnectorId)
    if (item) {
      openItem(item)
      onOpenConnectorConsumed?.()
      return
    }
    if (!toolsFetchDone) return
    console.error('[连接器] 未找到要打开的连接器:', openConnectorId)
    toast.error('未找到对应连接器')
    onOpenConnectorConsumed?.()
  }, [items, onOpenConnectorConsumed, openConnectorId, openItem, toolsFetchDone])

  React.useEffect(() => {
    if (!selected) return
    const next = items.find((item) => item.id === selected.id)
    if (!next) {
      setSelected(null)
      return
    }
    if (
      next.enabled !== selected.enabled
      || next.status !== selected.status
      || next.available !== selected.available
      || next.statusReason !== selected.statusReason
    ) {
      setSelected(next)
    }
  }, [items, selected])

  const toggle = React.useCallback(async (item: ConnectorItem, enabled: boolean): Promise<void> => {
    try {
      switch (item.kind) {
        case 'builtin-mcp':
          await onToggleBuiltin(item.sourceId, enabled)
          if (item.sourceId === 'nano-banana') {
            await window.electronAPI.updateChatToolState('nano-banana', { enabled })
            setChatTools(await window.electronAPI.getChatTools())
          }
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

  let body: React.ReactNode
  if (items.length === 0) {
    body = <EmptyConnectors onAddMcp={onAddMcp} onAddHttp={onAddHttp} />
  } else if (filtered.length === 0) {
    body = <EmptySearch />
  } else if (chip === 'all' && !query.trim()) {
    body = (
      <div className="flex flex-col gap-8">
        {groups.map((group) => (
          <section key={group.categoryLabel} className="flex flex-col gap-3">
            <div className="text-sm font-semibold text-foreground">{group.categoryLabel}</div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {group.items.map((item) => (
                <ConnectorCard
                  key={item.id}
                  item={item}
                  onOpen={() => openItem(item)}
                  onToggle={(enabled) => void toggle(item, enabled)}
                  onRequestDelete={
                    item.kind === 'user-mcp' && onRequestDeleteMcp
                      ? () => onRequestDeleteMcp(item.sourceId)
                      : item.kind === 'custom-http' && onRequestDeleteHttp
                        ? () => onRequestDeleteHttp({ id: item.sourceId, name: item.name })
                        : undefined
                  }
                />
              ))}
            </div>
          </section>
        ))}
        <p className="text-[12px] leading-relaxed text-foreground/45">
          当前内置 Chrome 浏览器、联网搜索、Nano Banana 生图。更多第三方连接后续加入；现在可添加本地/远程服务或自定义 HTTP。
        </p>
      </div>
    )
  } else {
    body = (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filtered.map((item) => (
          <ConnectorCard
            key={item.id}
            item={item}
            onOpen={() => openItem(item)}
            onToggle={(enabled) => void toggle(item, enabled)}
            onRequestDelete={
              item.kind === 'user-mcp' && onRequestDeleteMcp
                ? () => onRequestDeleteMcp(item.sourceId)
                : item.kind === 'custom-http' && onRequestDeleteHttp
                  ? () => onRequestDeleteHttp({ id: item.sourceId, name: item.name })
                  : undefined
            }
          />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <ScopeBanner mcpIsProjectOverride={mcpIsProjectOverride} />
      {hasReviewHints && reviewHints && (
        <HintsBanner hints={reviewHints} onDismiss={onDismissHints} />
      )}

      {chip === 'all' && !query.trim() && (
        <NeedsConfigGuide items={items} onOpen={openItem} />
      )}

      {items.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-thin">
          {CONNECTOR_FILTER_CHIPS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              onClick={() => setChip(entry.key)}
              className={cn(
                'shrink-0 rounded-full px-3 py-1 text-[12px] font-medium transition-[background-color,color] duration-fast ease-out',
                chip === entry.key
                  ? 'bg-foreground text-background'
                  : 'bg-muted text-muted-foreground hover:bg-foreground/10 hover:text-foreground',
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>
      )}

      {body}

      <ConnectorDetailDialog
        open={!!selected}
        item={selected}
        onOpenChange={(open) => { if (!open) setSelected(null) }}
        builtinServers={builtinServers}
        userEntries={userEntries}
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        onToggle={(item, enabled) => void toggle(item, enabled)}
        onUserMcpChanged={onUserMcpChanged}
        onDeletedHttp={() => setSelected(null)}
      />
    </div>
  )
}

function ScopeBanner({ mcpIsProjectOverride }: { mcpIsProjectOverride: boolean }): React.ReactElement {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-content-area px-3 py-2 text-[13px] text-foreground/60">
      {mcpIsProjectOverride ? (
        <>
          <FolderOpen size={14} className="shrink-0 text-foreground/45" />
          <span>当前项目已配置专属连接器，完全覆盖全局配置，仅本项目生效</span>
        </>
      ) : (
        <>
          <Globe size={14} className="shrink-0 text-foreground/45" />
          <span>连接器配置全局共享，所有工作区共用；切换工作区不会改变这份列表</span>
        </>
      )}
    </div>
  )
}

function HintsBanner({
  hints,
  onDismiss,
}: {
  hints: GlobalScopeReviewHints
  onDismiss: () => void
}): React.ReactElement {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[13px] leading-5 text-amber-700 dark:text-amber-400">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <div className="flex-1 space-y-1">
        <div>升级时已将各工作区的连接器合并进全局配置，发现以下需要你确认：</div>
        {hints.mcpSuffixedServers.length > 0 && (
          <div className="text-amber-600/80 dark:text-amber-400/70">
            同名冲突已加后缀保留：{hints.mcpSuffixedServers.join('、')}（可在下方列表里重命名或删除冗余项）
          </div>
        )}
        {hints.leftoverWorkspaceMcp.length > 0 && (
          <div className="text-amber-600/80 dark:text-amber-400/70">
            以下工作区迁移尚未完成：{hints.leftoverWorkspaceMcp.join('、')}（重启 MyYoda 会自动重试）
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 rounded p-1 text-amber-600/60 transition-[background-color,color] duration-fast ease-out hover:bg-amber-500/10 hover:text-amber-700 dark:text-amber-400/60"
      >
        <X size={14} />
      </button>
    </div>
  )
}

function NeedsConfigGuide({
  items,
  onOpen,
}: {
  items: ConnectorItem[]
  onOpen: (item: ConnectorItem) => void
}): React.ReactElement | null {
  const pending = items.filter((item) => isConnectorAttentionStatus(item.status))
  if (pending.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      {pending.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onOpen(item)}
          className="group flex items-center justify-between gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/[0.08] px-4 py-3 text-left transition-[border-color,background-color,transform] duration-fast ease-out hover:border-amber-500/40 active:scale-[var(--press-scale)]"
        >
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-foreground">{item.name}</span>
            <span className="block truncate text-[12px] text-foreground/55">
              {item.statusReason ?? '需要配置后才能给 Agent 使用'}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-amber-700 dark:text-amber-400">
            {item.nextActionLabel ?? '去配置'}
            <ArrowRight size={14} className="transition-transform duration-fast ease-out group-hover:translate-x-0.5" />
          </span>
        </button>
      ))}
    </div>
  )
}

function EmptyConnectors({
  onAddMcp,
  onAddHttp,
}: {
  onAddMcp: () => void
  onAddHttp: () => void
}): React.ReactElement {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 pt-24 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-foreground/[0.04]">
        <Plus className="size-8 text-foreground/30" />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="text-[15px] font-medium text-foreground/85">暂无连接器</div>
        <p className="text-[13px] leading-relaxed text-foreground/50">
          添加自定义连接，或配置内置搜索 / 生图 / 浏览器能力。
        </p>
      </div>
      <AddConnectorMenu onAddMcp={onAddMcp} onAddHttp={onAddHttp} className="mt-2" />
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
        <p className="text-[13px] leading-relaxed text-foreground/50">试试更换分类或搜索关键词。</p>
      </div>
    </div>
  )
}
