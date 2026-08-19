/**
 * MarketplaceTab — 市场目录（plugin_creator）
 *
 * 对标 OpenAI Plugins / Trae Marketplace 的「预置目录 + 用户决策安装」：
 * - 目录条目（官方/稳定优先）内置在 marketplace.json，未安装零占用；
 * - 每个条目显示来源（官方/社区/MyYoda）、作者、主页、安装状态；
 * - 「安装」= 写入 chat-tools.json marketplaceInstalled，注入会话；
 * - 需要凭据的条目安装后可在卡片上直接配置（存 toolCredentials['marketplace:<id>']）；
 * - 「卸载」移除注入，凭据保留以便重装复用。
 */

import * as React from 'react'
import { Download, ExternalLink, Plug, ShieldCheck, Trash2, Loader2, CheckCircle2, KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { MarketplaceItem, MarketplaceItemWithStatus } from '@myyoda/shared'
import { getBuiltinMcpIcon } from '@/lib/builtin-mcp-icons'

type MarketFilter = 'all' | 'connector' | 'skill'

const FILTERS: Array<{ key: MarketFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'connector', label: '连接器' },
  { key: 'skill', label: 'Skill' },
]

const VENDOR_LABEL: Record<string, string> = {
  official: '官方',
  community: '社区',
  myyoda: 'MyYoda',
}

export function MarketplaceTab(): React.ReactElement {
  const [items, setItems] = React.useState<MarketplaceItemWithStatus[]>([])
  const [loading, setLoading] = React.useState(true)
  const [filter, setFilter] = React.useState<MarketFilter>('all')
  const [installing, setInstalling] = React.useState<string | null>(null)
  const [uninstalling, setUninstalling] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    try {
      const list = await window.electronAPI.marketplaceList()
      setItems(list)
    } catch (error) {
      console.error('[市场] 加载失败:', error)
      toast.error('市场加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const filtered = React.useMemo(() => {
    if (filter === 'all') return items
    return items.filter((item) => item.type === filter)
  }, [items, filter])

  const handleInstall = async (item: MarketplaceItem): Promise<void> => {
    setInstalling(item.id)
    try {
      await window.electronAPI.marketplaceInstall(item.id)
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
          预置的官方与稳定第三方集成，按需安装、零占用。安装后自动注入 Agent 会话，凭据在连接器页配置。
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

      {/* 条目网格 */}
      {filtered.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">该分类暂无条目</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((item) => (
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
                {item.installed ? (
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
                  <Button size="sm" variant="outline" disabled={installing === item.id} onClick={() => void handleInstall(item)}>
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
          ))}
        </div>
      )}
    </div>
  )
}
