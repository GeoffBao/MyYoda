/**
 * MarketplaceTab — 市场目录（统一发现中心：官方连接器 + 社区技能）
 *
 * 对标 OpenAI Plugins / Trae Marketplace 的「预置目录 + 用户决策安装」：
 * - 本地官方连接器（marketplace.json）与远程社区 Skill/连接器（myyoda-skills manifest）同构浏览；
 * - 类型筛选（全部/连接器/技能）+ 分类下钻；技能条目展示版本与下载量；
 * - 「安装」= connector 写入 chat-tools.json marketplaceInstalled（远程先快照），技能走 communityInstallSkill/本地复制；
 * - 需要凭据的条目安装后可在卡片上直接配置（存 toolCredentials['marketplace:<id>']）；
 * - 「卸载」移除注入，凭据保留以便重装复用；skill 已安装引导去技能 Tab 管理；
 * - 远程市场不可用时本地条目照常渲染，skill 分类给出重试。
 */

import * as React from 'react'
import { Download, ExternalLink, Plug, ShieldCheck, Trash2, Loader2, CheckCircle2, KeyRound, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { MarketplaceItem, MarketplaceItemWithStatus } from '@myyoda/shared'
import { getBuiltinMcpIcon } from '@/lib/builtin-mcp-icons'
import { useWorkspaceActions } from '@/hooks/useWorkspaceActions'

type MarketFilter = 'all' | 'connector' | 'skill'

const FILTERS: Array<{ key: MarketFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'connector', label: '连接器' },
  { key: 'skill', label: '技能' },
]

const VENDOR_LABEL: Record<string, string> = {
  official: '官方',
  community: '社区',
  myyoda: 'MyYoda',
}

/** 连接器分类固定顺序（条目中出现的分类按此排序，未列出的追加到末尾） */
const CONNECTOR_CATEGORY_ORDER = [
  '协作办公',
  '研发与交付',
  '设计协作',
  '搜索与自动化',
  '数据与基础设施',
  '知识',
  '系统能力',
]

/** service 层为 skill 条目附加的元数据（类型上以交叉扩展传递） */
type MarketItemWithMeta = MarketplaceItemWithStatus & { version?: string; downloads?: number }

function formatDownloads(count: number | undefined): string {
  if (count === undefined) return ''
  if (count < 1000) return String(count)
  return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}k`
}

export function MarketplaceTab(): React.ReactElement {
  const { workspaces, currentWorkspaceId } = useWorkspaceActions()
  const workspaceSlug = React.useMemo(
    () => workspaces.find((w) => w.id === currentWorkspaceId)?.slug ?? '',
    [workspaces, currentWorkspaceId],
  )
  const [items, setItems] = React.useState<MarketplaceItemWithStatus[]>([])
  const [remoteAvailable, setRemoteAvailable] = React.useState(true)
  const [loading, setLoading] = React.useState(true)
  const [filter, setFilter] = React.useState<MarketFilter>('all')
  const [category, setCategory] = React.useState<string | null>(null)
  const [installing, setInstalling] = React.useState<string | null>(null)
  const [uninstalling, setUninstalling] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    try {
      const list = await window.electronAPI.marketplaceList(workspaceSlug)
      setItems(list.items)
      setRemoteAvailable(list.remoteAvailable)
    } catch (error) {
      console.error('[市场] 加载失败:', error)
      toast.error('市场加载失败')
      setRemoteAvailable(false)
    } finally {
      setLoading(false)
    }
  }, [workspaceSlug])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  // 切换类型筛选时重置分类下钻
  React.useEffect(() => {
    setCategory(null)
  }, [filter])

  const filtered = React.useMemo(() => {
    let list = items
    if (filter !== 'all') list = list.filter((item) => item.type === filter)
    if (category) list = list.filter((item) => item.category === category)
    return list
  }, [items, filter, category])

  /** 分类 chip：仅类型筛选非「全部」时显示；connector 按固定集合顺序，skill 按条目数量降序 */
  const categoryChips = React.useMemo((): Array<{ label: string; count: number }> => {
    if (filter === 'all') return []
    const counts = new Map<string, number>()
    for (const item of items) {
      if (item.type !== filter || !item.category) continue
      counts.set(item.category, (counts.get(item.category) ?? 0) + 1)
    }
    const entries = [...counts.entries()]
    if (filter === 'connector') {
      const orderOf = (label: string): number => {
        const idx = CONNECTOR_CATEGORY_ORDER.indexOf(label)
        return idx === -1 ? CONNECTOR_CATEGORY_ORDER.length : idx
      }
      entries.sort((a, b) => orderOf(a[0]) - orderOf(b[0]) || a[0].localeCompare(b[0]))
    } else {
      entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    }
    return entries.map(([label, count]) => ({ label, count }))
  }, [items, filter])

  const handleInstall = async (item: MarketplaceItem): Promise<void> => {
    setInstalling(item.id)
    try {
      await window.electronAPI.marketplaceInstall(item.id, workspaceSlug)
      toast.success(`已安装 ${item.name}`)
      await refresh()
    } catch (error) {
      console.error(`[市场] 安装失败（${item.id}）:`, error)
      toast.error(`安装失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setInstalling(null)
    }
  }

  const handleUninstall = async (item: MarketplaceItem): Promise<void> => {
    setUninstalling(item.id)
    try {
      await window.electronAPI.marketplaceUninstall(item.id)
      toast.success(`已卸载 ${item.name}`)
      await refresh()
    } catch (error) {
      console.error(`[市场] 卸载失败（${item.id}）:`, error)
      toast.error('卸载失败')
    } finally {
      setUninstalling(null)
    }
  }

  if (loading) {
    return <div className="py-16 text-center text-sm text-muted-foreground">市场加载中...</div>
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <div className="text-[15px] font-semibold text-foreground">市场目录</div>
        <div className="text-[12px] leading-relaxed text-muted-foreground">
          官方稳定连接器与社区贡献的技能统一发现中心：按需安装、零占用。连接器安装后自动注入 Agent 会话，凭据在连接器页配置；技能安装后进入技能页管理。
        </div>
      </div>

      {/* 类型筛选 */}
      <div className="flex items-center gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={cn(
              'rounded-full px-3 py-1 text-[12px] font-medium transition-colors duration-fast',
              filter === f.key
                ? 'bg-foreground text-background'
                : 'bg-muted text-muted-foreground hover:bg-foreground/10 hover:text-foreground',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* 分类筛选（仅类型筛选非「全部」时显示） */}
      {categoryChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {categoryChips.map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={() => setCategory(category === c.label ? null : c.label)}
              className={cn(
                'rounded-full px-3 py-1 text-[12px] font-medium transition-colors duration-fast',
                category === c.label
                  ? 'bg-primary/10 text-primary ring-1 ring-primary/30'
                  : 'bg-muted/60 text-muted-foreground hover:bg-foreground/10 hover:text-foreground',
              )}
            >
              {c.label}
              <span className="ml-1 text-[11px] tabular-nums opacity-60">{c.count}</span>
            </button>
          ))}
        </div>
      )}

      {/* 条目网格 / 空态 */}
      {filtered.length === 0 ? (
        filter === 'skill' && !remoteAvailable ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="text-sm font-medium text-foreground/80">远程市场不可用</div>
            <div className="text-[12px] leading-relaxed text-muted-foreground">
              无法连接远程技能市场，请检查网络后重试；本地连接器条目不受影响。
            </div>
            <Button
              size="sm"
              variant="outline"
              className="mt-1"
              onClick={() => {
                setLoading(true)
                void refresh()
              }}
            >
              <RefreshCw size={14} />
              重试
            </Button>
          </div>
        ) : (
          <div className="py-16 text-center text-sm text-muted-foreground">该分类暂无条目</div>
        )
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((raw) => {
            const item = raw as MarketItemWithMeta
            return (
              <div
                key={item.id}
                className="group flex h-full flex-col gap-3 rounded-2xl border border-border/60 bg-background p-4"
              >
                {/* 头部 */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-content-area shadow-sm">
                      {item.iconKey ? getBuiltinMcpIcon(item.iconKey) : <Plug size={20} />}
                    </div>
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <h3 className="truncate text-[15px] font-semibold text-foreground" title={item.name}>
                        {item.name}
                      </h3>
                      <span
                        className={cn(
                          'w-fit rounded px-1 py-px text-[10px] font-medium',
                          item.vendor === 'official'
                            ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                            : item.vendor === 'myyoda'
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                              : 'bg-foreground/5 text-muted-foreground',
                        )}
                      >
                        {VENDOR_LABEL[item.vendor] ?? item.vendor}
                      </span>
                    </div>
                  </div>
                  {item.installed ? (
                    <span className="flex shrink-0 items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 size={12} /> 已安装
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-md bg-foreground/5 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                      未安装
                    </span>
                  )}
                </div>

                {/* 描述 */}
                <p className="line-clamp-2 min-h-[2.25rem] text-[13px] leading-snug text-muted-foreground">
                  {item.description}
                </p>

                {/* 元数据 */}
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  {item.category && (
                    <span className="rounded-full bg-accent/60 px-2 py-0.5 text-[11px] font-medium text-accent-foreground">
                      {item.category}
                    </span>
                  )}
                  {item.type === 'skill' && (
                    <span className="flex items-center gap-1 rounded-full bg-foreground/[0.04] px-2 py-0.5 text-[11px] font-medium">
                      {item.version && <span>v{item.version}</span>}
                      {item.version && item.downloads !== undefined && <span className="opacity-50">·</span>}
                      {item.downloads !== undefined && <span>{formatDownloads(item.downloads)} 次安装</span>}
                    </span>
                  )}
                  {item.credentialFields && item.credentialFields.length > 0 && (
                    <span className="flex items-center gap-0.5 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                      <KeyRound size={10} /> 需凭据
                    </span>
                  )}
                  {item.homepage && (
                    <a
                      href={item.homepage}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-0.5 text-muted-foreground/70 hover:text-foreground"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink size={10} />
                      {item.author ?? '主页'}
                    </a>
                  )}
                </div>

                {/* 操作 */}
                <div className="mt-auto flex items-center justify-between gap-2 border-t border-border/40 pt-3">
                  {item.installed && item.type === 'skill' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      onClick={() => toast.info(`「${item.name}」已安装，可在「技能」Tab 中管理`) }
                    >
                      <CheckCircle2 size={14} />
                      <span>已安装</span>
                    </Button>
                  ) : item.installed ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      disabled={uninstalling === item.id}
                      onClick={() => void handleUninstall(item)}
                    >
                      {uninstalling === item.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                      <span>卸载</span>
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={installing === item.id}
                      onClick={() => void handleInstall(item)}
                    >
                      {installing === item.id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                      <span>安装</span>
                    </Button>
                  )}
                  {item.installed && item.type === 'connector' && (
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <ShieldCheck size={12} className="text-emerald-500" />
                      已注入会话
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
