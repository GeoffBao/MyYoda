/**
 * StorageSettings — 磁盘管理设置面板
 *
 * 布局：Hero 总览（环形图 + 分类明细）→ 分类卡片网格（可行动）→ 会话存储优化 → 自动清理。
 * 展示各数据类别的磁盘占用、体积最大的会话文件（排名条形图）、孤儿残留，
 * 以及可安全自动/手动清理的临时与归档数据。
 */

import * as React from 'react'
import {
  Archive,
  Database,
  Film,
  FolderOpen,
  HardDrive,
  Images,
  MessageCircle,
  MessagesSquare,
  Paperclip,
  RefreshCw,
  Trash2,
  TriangleAlert,
  Wrench,
} from 'lucide-react'
import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsToggle,
} from './primitives'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import { Button } from '../ui/button'
import { ConfirmDialog } from '../ui/confirm-dialog'
import { cn } from '@/lib/utils'

interface StorageTopItem {
  sessionId: string
  title: string
  bytes: number
  archived: boolean
  updatedAt: number
}

interface StorageCategory {
  label: string
  key: string
  bytes: number
  count: number
  hasOrphans: boolean
  orphanBytes: number
  orphanCount: number
  orphanItems: Array<{ kind: string; path: string; bytes: number; count: number }>
  orphanItemsTruncated: boolean
  topItems?: StorageTopItem[]
}

interface StorageStats {
  categories: StorageCategory[]
  totalBytes: number
  calculatedAt: number
}

interface CleanupResult {
  freedBytes: number
  deletedCount: number
  errors: string[]
}

interface PreviewCleanupResult {
  reclaimableBytes: number
  affectedCount: number
}

interface StripImagesResult {
  freedBytes: number
  affectedSessions: number
  errors: string[]
}

/** 操作结果统一视图：deletedCount（文件/项数）与 affectedSessions（会话数）二选一 */
interface ActionFeedback {
  freedBytes: number
  processedCount: number
  errors: string[]
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatUpdatedAt(timestamp: number): string {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000))
  if (diffDays <= 0) return '今天更新'
  if (diffDays === 1) return '昨天更新'
  if (diffDays < 30) return `${diffDays} 天前更新`
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })
}

// ===== 视觉配置 =====

interface CategoryVisual {
  color: string
  icon: React.ComponentType<{ size?: number | string; className?: string; style?: React.CSSProperties }>
}

const CATEGORY_VISUALS: Record<string, CategoryVisual> = {
  'agent-sessions': { color: '#38bdf8', icon: MessagesSquare },
  'sdk-config': { color: '#a78bfa', icon: Database },
  workspaces: { color: '#34d399', icon: FolderOpen },
  conversations: { color: '#fbbf24', icon: MessageCircle },
  attachments: { color: '#fb7185', icon: Paperclip },
  'temp-files': { color: '#fb923c', icon: Wrench },
  'discover-cache': { color: '#22d3ee', icon: Film },
}

const FALLBACK_VISUAL: CategoryVisual = { color: '#94a3b8', icon: HardDrive }

function categoryVisual(category: StorageCategory): CategoryVisual {
  return CATEGORY_VISUALS[category.key] ?? FALLBACK_VISUAL
}

// ===== Hero 环形图 =====

const DONUT_RADIUS = 42
const DONUT_STROKE = 13
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS

function StorageDonut({ categories, totalBytes }: { categories: StorageCategory[]; totalBytes: number }): React.ReactElement {
  // 小分类合并为「其他」，避免环图碎片化
  const sorted = [...categories].filter((cat) => cat.bytes > 0).sort((a, b) => b.bytes - a.bytes)
  const segments: Array<{ key: string; color: string; bytes: number }> = []
  let otherBytes = 0
  for (const cat of sorted) {
    const pct = (cat.bytes / totalBytes) * 100
    if (pct >= 2 && segments.length < 5) {
      segments.push({ key: cat.key, color: categoryVisual(cat).color, bytes: cat.bytes })
    } else {
      otherBytes += cat.bytes
    }
  }
  if (otherBytes > 0) {
    segments.push({ key: '__other', color: '#64748b', bytes: otherBytes })
  }

  let offset = 0
  const arcs = segments.map((segment) => {
    const pct = (segment.bytes / totalBytes) * 100
    const dash = (pct / 100) * DONUT_CIRCUMFERENCE
    const arc = { ...segment, pct, dash, offset }
    offset += dash
    return arc
  })

  return (
    <div className="relative h-[124px] w-[124px] shrink-0">
      <svg viewBox="0 0 108 108" className="h-full w-full -rotate-90">
        <circle
          cx="54"
          cy="54"
          r={DONUT_RADIUS}
          fill="none"
          strokeWidth={DONUT_STROKE}
          className="stroke-muted"
        />
        {arcs.map((arc) => (
          <circle
            key={arc.key}
            cx="54"
            cy="54"
            r={DONUT_RADIUS}
            fill="none"
            stroke={arc.color}
            strokeWidth={DONUT_STROKE}
            strokeLinecap="round"
            strokeDasharray={`${arc.dash} ${DONUT_CIRCUMFERENCE - arc.dash}`}
            strokeDashoffset={-arc.offset}
            className="transition-[stroke-dasharray] duration-500 ease-out"
          />
        ))}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-sm font-semibold tabular-nums text-foreground/90">
          {formatBytes(totalBytes)}
        </span>
        <span className="text-[10px] text-foreground/40">已使用</span>
      </div>
    </div>
  )
}

// ===== 分类明细图例 =====

function CategoryLegend({ categories, totalBytes }: { categories: StorageCategory[]; totalBytes: number }): React.ReactElement {
  const sorted = [...categories].sort((a, b) => b.bytes - a.bytes)
  return (
    <div className="flex flex-1 flex-col justify-center gap-2">
      {sorted.map((cat) => {
        const visual = categoryVisual(cat)
        const pct = totalBytes > 0 ? Math.round((cat.bytes / totalBytes) * 100) : 0
        const Icon = visual.icon
        return (
          <div key={cat.key} className="flex items-center gap-2.5 text-[13px]">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: visual.color }} />
            <Icon size={14} className="shrink-0 text-foreground/40" />
            <span className="min-w-0 flex-1 truncate text-foreground/70">{cat.label}</span>
            <span className="shrink-0 tabular-nums text-foreground/60">{formatBytes(cat.bytes)}</span>
            <span className="w-10 shrink-0 text-right tabular-nums text-foreground/35">{pct}%</span>
          </div>
        )
      })}
    </div>
  )
}

// ===== 分类卡片 =====

interface CategoryCardProps {
  category: StorageCategory
  onCleanTemp: () => void
  onCleanDiscover: () => void
  cleaningKey: string | null
  sessionsExpanded: boolean
  onToggleSessions: () => void
  onCleanOrphans: () => void
  cleaningOrphans: boolean
  totalBytes: number
}

function CategoryCard({
  category,
  onCleanTemp,
  onCleanDiscover,
  cleaningKey,
  sessionsExpanded,
  onToggleSessions,
  onCleanOrphans,
  cleaningOrphans,
  totalBytes,
}: CategoryCardProps): React.ReactElement {
  const visual = categoryVisual(category)
  const Icon = visual.icon
  const pct = totalBytes > 0 ? (category.bytes / totalBytes) * 100 : 0
  const hasAction = category.key === 'temp-files' || category.key === 'discover-cache'
  const isSessionCategory = category.key === 'agent-sessions'

  return (
    <div className={cn('settings-card rounded-xl p-4 transition-[border-color,box-shadow] duration-fast hover:shadow-sm', isSessionCategory && 'sm:col-span-2')}>
      <div className="flex items-start gap-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${visual.color}1f` }}
        >
          <Icon size={17} className="text-foreground/80" style={{ color: visual.color }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-sm font-medium text-foreground/90">{category.label}</span>
            <span className="shrink-0 text-sm tabular-nums text-foreground/70">{formatBytes(category.bytes)}</span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-foreground/40">
            <span>{category.count} 个文件</span>
            {pct > 0 && (
              <>
                <span>·</span>
                <span>{pct >= 10 ? Math.round(pct) : pct.toFixed(1)}%</span>
              </>
            )}
            {category.hasOrphans && (
              <>
                <span>·</span>
                <span className="flex items-center gap-0.5 text-amber-600/80 dark:text-amber-400/80">
                  <TriangleAlert size={10} />
                  孤儿 {formatBytes(category.orphanBytes)}
                </span>
              </>
            )}
          </div>
          {/* 卡片内占比条 */}
          <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full transition-[width] duration-500 ease-out"
              style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: visual.color }}
            />
          </div>
        </div>
      </div>

      {hasAction && (
        <div className="mt-3 flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={category.key === 'temp-files' ? onCleanTemp : onCleanDiscover}
            disabled={cleaningKey !== null || category.bytes === 0}
            className="h-7 gap-1 text-xs"
            title={category.key === 'discover-cache' ? '仅删除下载的视频缓存，在线播放不受影响' : undefined}
          >
            <Trash2 size={12} />
            {cleaningKey === category.key ? '清理中...' : '清理'}
          </Button>
        </div>
      )}

      {isSessionCategory && (
        <AgentSessionsDetail
          category={category}
          expanded={sessionsExpanded}
          onToggle={onToggleSessions}
          onCleanOrphans={onCleanOrphans}
          cleaningOrphans={cleaningOrphans}
        />
      )}
    </div>
  )
}

// ===== 会话详情：排名条形图 + 孤儿残留 =====

function AgentSessionsDetail({
  category,
  expanded,
  onToggle,
  onCleanOrphans,
  cleaningOrphans,
}: {
  category: StorageCategory
  expanded: boolean
  onToggle: () => void
  onCleanOrphans: () => void
  cleaningOrphans: boolean
}): React.ReactElement {
  const topItems = category.topItems ?? []
  const maxBytes = topItems[0]?.bytes ?? 0
  const showDetail = expanded && (topItems.length > 0 || category.hasOrphans)

  return (
    <div className="mt-3 border-t border-border/25 pt-2.5">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between rounded-md px-1 py-1 text-[12px] text-foreground/50 transition-colors hover:text-foreground/80"
      >
        <span>{expanded ? '收起会话明细' : '查看占用最大的会话'}</span>
        <span className={cn('transition-transform duration-fast', expanded && 'rotate-180')}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>

      {showDetail && (
        <div className="mt-2 space-y-3.5">
          {topItems.length > 0 && (
            <div>
              <div className="mb-2 text-[11px] font-medium text-foreground/40">体积最大的会话</div>
              <div className="flex flex-col gap-1.5">
                {topItems.map((item, index) => {
                  const width = maxBytes > 0 ? Math.max((item.bytes / maxBytes) * 100, 2) : 0
                  return (
                    <div key={item.sessionId} className="flex items-center gap-2.5">
                      <span
                        className={cn(
                          'w-4 shrink-0 text-center text-[11px] tabular-nums',
                          index < 3 ? 'font-semibold text-foreground/60' : 'text-foreground/35',
                        )}
                      >
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-xs text-foreground/75" title={item.title}>
                            {item.title}
                            {item.archived && (
                              <span className="ml-1.5 rounded bg-muted px-1 py-px text-[10px] text-foreground/45">已归档</span>
                            )}
                          </span>
                          <span className="shrink-0 tabular-nums text-xs text-foreground/60">{formatBytes(item.bytes)}</span>
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className={cn('h-full rounded-full', index < 3 ? 'bg-sky-500/80' : 'bg-foreground/15')}
                              style={{ width: `${width}%` }}
                            />
                          </div>
                          <span className="w-16 shrink-0 text-right text-[10px] text-foreground/35">
                            {formatUpdatedAt(item.updatedAt)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="mt-2 text-[11px] text-foreground/35">
                归档不再使用的会话后，可在下方自动清理规则中回收其消息数据。
              </div>
            </div>
          )}

          {category.hasOrphans && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-600/90 dark:text-amber-400/90">
                <TriangleAlert size={12} />
                孤儿数据残留
              </div>
              <p className="mt-1 text-xs text-foreground/55">
                {category.orphanCount} 个消息文件（{formatBytes(category.orphanBytes)}）在会话索引中已不存在，
                删除前请确认不涉及仍在使用的会话数据。
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={onCleanOrphans}
                disabled={cleaningOrphans || category.orphanBytes === 0}
                className="mt-1.5 h-7 gap-1 text-xs text-amber-600/90 hover:text-amber-700 dark:text-amber-400/90 dark:hover:text-amber-300"
              >
                <Trash2 size={12} />
                {cleaningOrphans ? '清理中...' : '清理孤儿消息文件'}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ===== 主组件 =====

export function StorageSettings(): React.ReactElement {
  const [stats, setStats] = React.useState<StorageStats | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [cleaningKey, setCleaningKey] = React.useState<string | null>(null)
  const [lastResult, setLastResult] = React.useState<ActionFeedback | null>(null)
  const [autoCleanupTemp, setAutoCleanupTemp] = React.useState(true)
  const [autoCleanupDays, setAutoCleanupDays] = React.useState(0)
  const [expandedSessions, setExpandedSessions] = React.useState(false)
  const [orphanConfirmOpen, setOrphanConfirmOpen] = React.useState(false)
  const [archivePreview, setArchivePreview] = React.useState<PreviewCleanupResult | null>(null)
  const [archiveConfirmOpen, setArchiveConfirmOpen] = React.useState(false)
  const [archiveCleaning, setArchiveCleaning] = React.useState(false)
  const [stripPreview, setStripPreview] = React.useState<PreviewCleanupResult | null>(null)
  const [stripConfirmOpen, setStripConfirmOpen] = React.useState(false)
  const [stripRunning, setStripRunning] = React.useState(false)

  const loadStats = React.useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.electronAPI.getStorageStats() as StorageStats
      setStats(result)
    } catch (e) {
      console.error('[存储管理] 获取统计失败:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    loadStats()
    window.electronAPI.getSettings().then((settings) => {
      setAutoCleanupTemp(settings.autoCleanupTempOnStart !== false)
      setAutoCleanupDays(settings.autoCleanupArchivedDays ?? 0)
    }).catch(console.error)
  }, [loadStats])

  const showResult = (result: CleanupResult | StripImagesResult): void => {
    const processedCount = 'deletedCount' in result
      ? result.deletedCount
      : result.affectedSessions
    setLastResult({
      freedBytes: result.freedBytes,
      processedCount,
      errors: result.errors,
    })
  }

  const handleCleanTemp = async (): Promise<void> => {
    setCleaningKey('temp-files')
    setLastResult(null)
    try {
      const result = await window.electronAPI.cleanupTempStorage() as CleanupResult
      showResult(result)
      await loadStats()
    } catch (e) {
      console.error('[存储管理] 清理临时文件失败:', e)
    } finally {
      setCleaningKey(null)
    }
  }

  const handleCleanDiscover = async (): Promise<void> => {
    setCleaningKey('discover-cache')
    setLastResult(null)
    try {
      const result = await window.electronAPI.cleanupDiscoverStorage() as CleanupResult
      showResult(result)
      await loadStats()
    } catch (e) {
      console.error('[存储管理] 清理发现内容缓存失败:', e)
    } finally {
      setCleaningKey(null)
    }
  }

  const handleAutoCleanupTempChange = async (enabled: boolean): Promise<void> => {
    setAutoCleanupTemp(enabled)
    try {
      await window.electronAPI.updateSettings({ autoCleanupTempOnStart: enabled })
    } catch (e) {
      console.error('[存储管理] 更新自动清理设置失败:', e)
    }
  }

  const handleAutoCleanupDaysChange = async (value: string): Promise<void> => {
    const days = parseInt(value, 10)
    setAutoCleanupDays(days)
    try {
      await window.electronAPI.updateSettings({ autoCleanupArchivedDays: days })
    } catch (e) {
      console.error('[存储管理] 更新自动清理天数失败:', e)
    }
  }

  /** 孤儿清理：预览量在统计里已展示，弹窗仅做最终确认 */
  const handleCleanOrphans = async (): Promise<void> => {
    setCleaningKey('orphans')
    setLastResult(null)
    try {
      const result = await window.electronAPI.cleanupStorage({
        categories: ['agent-sessions'],
        orphansOnly: true,
        archivedBeforeDays: 0,
        confirmedOrphanCleanup: true,
      }) as CleanupResult
      showResult(result)
      await loadStats()
    } catch (e) {
      console.error('[存储管理] 清理孤儿数据失败:', e)
    } finally {
      setCleaningKey(null)
    }
  }

  /** 归档清理：先预览，确认后执行；无可回收数据时直接提示 */
  const handlePreviewArchive = async (): Promise<void> => {
    setArchivePreview(null)
    try {
      const preview = await window.electronAPI.previewArchivedCleanup(autoCleanupDays) as PreviewCleanupResult
      if (preview.reclaimableBytes <= 0) {
        setLastResult({ freedBytes: 0, processedCount: 0, errors: [] })
        return
      }
      setArchivePreview(preview)
      setArchiveConfirmOpen(true)
    } catch (e) {
      console.error('[存储管理] 预览归档清理失败:', e)
    }
  }

  const handleCleanArchive = async (): Promise<void> => {
    setArchiveCleaning(true)
    try {
      const result = await window.electronAPI.cleanupStorage({
        categories: ['agent-sessions', 'sdk-config'],
        orphansOnly: false,
        archivedBeforeDays: autoCleanupDays,
      }) as CleanupResult
      showResult(result)
      await loadStats()
    } catch (e) {
      console.error('[存储管理] 清理归档数据失败:', e)
    } finally {
      setArchiveCleaning(false)
      setArchiveConfirmOpen(false)
    }
  }

  /** 存量大图剥离：先预览，确认后执行；无可回收数据时直接提示 */
  const handlePreviewStrip = async (): Promise<void> => {
    setStripPreview(null)
    try {
      const preview = await window.electronAPI.previewStripImages() as PreviewCleanupResult
      if (preview.reclaimableBytes <= 0) {
        setLastResult({ freedBytes: 0, processedCount: 0, errors: [] })
        return
      }
      setStripPreview(preview)
      setStripConfirmOpen(true)
    } catch (e) {
      console.error('[存储管理] 预览大图剥离失败:', e)
    }
  }

  const handleStripImages = async (): Promise<void> => {
    setStripRunning(true)
    try {
      const result = await window.electronAPI.stripImages() as StripImagesResult
      showResult(result)
      await loadStats()
    } catch (e) {
      console.error('[存储管理] 大图剥离失败:', e)
    } finally {
      setStripRunning(false)
      setStripConfirmOpen(false)
    }
  }

  const sessionCategory = stats?.categories.find((cat) => cat.key === 'agent-sessions')

  return (
    <div className="space-y-6">
      {/* Hero 总览 */}
      <div className="settings-card overflow-hidden rounded-xl">
        <div className="flex items-center justify-between px-4 pt-3.5">
          <div>
            <h4 className="text-base font-medium text-foreground/90">存储总览</h4>
            <p className="mt-0.5 text-[13px] text-foreground/45">
              {stats ? `共 ${stats.categories.reduce((sum, c) => sum + c.count, 0)} 个文件` : '正在计算...'}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={loadStats}
            disabled={loading}
            className="gap-1.5"
          >
            <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
            刷新
          </Button>
        </div>
        {stats && (
          <div className="flex items-center gap-6 px-5 pb-5 pt-4">
            <StorageDonut categories={stats.categories} totalBytes={stats.totalBytes} />
            <CategoryLegend categories={stats.categories} totalBytes={stats.totalBytes} />
          </div>
        )}
      </div>

      {/* 分类卡片网格 */}
      <SettingsSection
        title="数据分类"
        description="每个分类的体积、文件数与可执行的操作"
      >
        {stats ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {stats.categories.map((cat) => (
              <CategoryCard
                key={cat.key}
                category={cat}
                onCleanTemp={handleCleanTemp}
                onCleanDiscover={handleCleanDiscover}
                cleaningKey={cleaningKey}
                sessionsExpanded={expandedSessions}
                onToggleSessions={() => setExpandedSessions((prev) => !prev)}
                onCleanOrphans={() => setOrphanConfirmOpen(true)}
                cleaningOrphans={cleaningKey === 'orphans'}
                totalBytes={stats.totalBytes}
              />
            ))}
          </div>
        ) : (
          <SettingsCard>
            <SettingsRow label="正在计算存储占用...">
              <RefreshCw size={14} className="animate-spin text-muted-foreground" />
            </SettingsRow>
          </SettingsCard>
        )}
      </SettingsSection>

      {/* 会话存储优化 */}
      {sessionCategory && (
        <SettingsSection
          title="会话存储优化"
          description="剥离历史会话中内嵌的截图数据，缩小会话文件体积（不影响消息与文本内容显示）"
        >
          <SettingsCard>
            <SettingsRow
              icon={
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/10">
                  <Images size={15} className="text-sky-500" />
                </div>
              }
              label="剥离内嵌大图"
              description="早期版本的截图以 base64 内嵌在会话记录中，剥离后可在不改动消息内容的前提下回收空间"
            >
              <Button
                variant="outline"
                size="sm"
                onClick={handlePreviewStrip}
                disabled={stripRunning || sessionCategory.bytes === 0}
                className="h-7 gap-1.5 text-xs"
              >
                <Images size={13} />
                {stripRunning ? '处理中...' : '扫描可回收空间'}
              </Button>
            </SettingsRow>
          </SettingsCard>
        </SettingsSection>
      )}

      {/* 自动清理 */}
      <SettingsSection
        title="自动清理"
        description="配置启动时和定期的自动清理规则"
      >
        <SettingsCard>
          <SettingsToggle
            label="启动时清理临时文件"
            description="每次启动时自动删除预览和安装缓存"
            checked={autoCleanupTemp}
            onCheckedChange={handleAutoCleanupTempChange}
          />
          <SettingsRow
            icon={
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10">
                <Archive size={15} className="text-violet-500" />
              </div>
            }
            label="清理已归档会话数据"
            description="自动清理超过指定天数的已归档会话消息和 SDK 数据"
          >
            <div className="flex items-center gap-2">
              <Select value={String(autoCleanupDays)} onValueChange={handleAutoCleanupDaysChange}>
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">禁用</SelectItem>
                  <SelectItem value="3">3 天</SelectItem>
                  <SelectItem value="7">7 天</SelectItem>
                  <SelectItem value="30">30 天</SelectItem>
                  <SelectItem value="90">90 天</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={handlePreviewArchive}
                disabled={autoCleanupDays <= 0 || archiveCleaning}
                className="h-7 gap-1.5 text-xs"
              >
                <Archive size={13} />
                {archiveCleaning ? '清理中...' : '立即清理'}
              </Button>
            </div>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      {/* 操作结果提示 */}
      {lastResult && (
        <div
          className={cn(
            'rounded-lg border px-4 py-3 text-sm',
            lastResult.freedBytes > 0
              ? 'border-emerald-500/20 bg-emerald-500/[0.04] text-emerald-600 dark:text-emerald-400'
              : 'border-border bg-muted/30 text-muted-foreground',
          )}
        >
          {lastResult.freedBytes > 0 ? (
            <span>
              已释放 {formatBytes(lastResult.freedBytes)}，处理 {lastResult.processedCount} 项
            </span>
          ) : (
            <span>没有需要清理的数据</span>
          )}
          {lastResult.errors.length > 0 && (
            <div className="mt-1 text-xs text-destructive">
              {lastResult.errors.map((err, i) => <div key={i}>{err}</div>)}
            </div>
          )}
        </div>
      )}

      {/* 孤儿清理确认 */}
      <ConfirmDialog
        open={orphanConfirmOpen}
        onOpenChange={setOrphanConfirmOpen}
        title="清理孤儿消息文件"
        description={sessionCategory?.hasOrphans
          ? `将删除 ${sessionCategory.orphanCount} 个已不存在于会话索引的消息文件，释放约 ${formatBytes(sessionCategory.orphanBytes)}。此操作不可恢复。`
          : '当前没有检测到孤儿消息文件。'}
        confirmLabel="确认删除"
        loadingLabel="清理中..."
        onConfirm={async () => {
          setOrphanConfirmOpen(false)
          await handleCleanOrphans()
        }}
      />

      {/* 归档清理确认 */}
      <ConfirmDialog
        open={archiveConfirmOpen}
        onOpenChange={setArchiveConfirmOpen}
        title="清理已归档会话数据"
        description={archivePreview
          ? `将删除 ${archivePreview.affectedCount} 个已归档超过 ${autoCleanupDays} 天的会话数据，释放约 ${formatBytes(archivePreview.reclaimableBytes)}。此操作不可恢复。`
          : '正在计算可释放空间...'}
        confirmLabel="确认清理"
        loadingLabel="清理中..."
        loading={archiveCleaning}
        onConfirm={handleCleanArchive}
      />

      {/* 大图剥离确认 */}
      <ConfirmDialog
        open={stripConfirmOpen}
        onOpenChange={setStripConfirmOpen}
        title="剥离会话内嵌大图"
        description={stripPreview
          ? `扫描到 ${stripPreview.affectedCount} 个会话可剥离内嵌截图，预计回收 ${formatBytes(stripPreview.reclaimableBytes)}。消息文本与内容不受影响。`
          : '正在扫描可回收空间...'}
        confirmLabel="开始剥离"
        loadingLabel="处理中..."
        loading={stripRunning}
        onConfirm={handleStripImages}
      />
    </div>
  )
}
