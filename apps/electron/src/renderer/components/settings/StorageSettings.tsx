/**
 * StorageSettings — 磁盘管理设置面板
 *
 * 展示各数据类别的磁盘占用、体积最大的会话文件（可行动清单）、
 * 孤儿数据残留，以及可安全自动/手动清理的临时与归档数据。
 */

import * as React from 'react'
import { Trash2, RefreshCw, ChevronDown, ChevronRight, Images, Archive } from 'lucide-react'
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

const BAR_COLORS = [
  'bg-blue-500',
  'bg-purple-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-rose-500',
  'bg-cyan-500',
]

function StorageBar({ categories, totalBytes }: { categories: StorageCategory[]; totalBytes: number }): React.ReactElement {
  if (totalBytes === 0) {
    return <div className="h-3 w-full rounded-full bg-muted" />
  }
  return (
    <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
      {categories.map((cat, i) => {
        const pct = (cat.bytes / totalBytes) * 100
        if (pct < 0.5) return null
        return (
          <div
            key={cat.key}
            className={cn('h-full transition-[width] duration-base ease-out', BAR_COLORS[i % BAR_COLORS.length])}
            style={{ width: `${pct}%` }}
            title={`${cat.label}: ${formatBytes(cat.bytes)}`}
          />
        )
      })}
    </div>
  )
}

/** 会话记录分类的展开详情：体积最大会话 + 孤儿残留 */
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
  const showDetail = expanded && (topItems.length > 0 || category.hasOrphans)

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1 text-xs text-foreground/45 transition-colors hover:text-foreground/70"
      >
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {expanded ? '收起详情' : '查看详情'}
        {category.hasOrphans && (
          <span className="ml-1 text-amber-600/80 dark:text-amber-400/80">
            （含 {formatBytes(category.orphanBytes)} 孤儿残留）
          </span>
        )}
      </button>

      {showDetail && (
        <div className="mt-2 space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3">
          {topItems.length > 0 && (
            <div>
              <div className="mb-1.5 text-[11px] font-medium text-foreground/40">体积最大的会话</div>
              <div className="flex flex-col gap-1">
                {topItems.map((item) => (
                  <div key={item.sessionId} className="flex items-center gap-2 text-xs">
                    <span className="min-w-0 flex-1 truncate text-foreground/70" title={item.title}>
                      {item.title}
                    </span>
                    {item.archived && (
                      <span className="shrink-0 rounded bg-muted px-1 py-px text-[10px] text-foreground/45">已归档</span>
                    )}
                    <span className="shrink-0 text-foreground/45">{formatUpdatedAt(item.updatedAt)}</span>
                    <span className="shrink-0 tabular-nums text-foreground/70">{formatBytes(item.bytes)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-1.5 text-[11px] text-foreground/35">
                归档不再使用的会话后，可在下方自动清理规则中回收其消息数据。
              </div>
            </div>
          )}

          {category.hasOrphans && (
            <div className="border-t border-border/50 pt-2.5">
              <div className="text-[11px] font-medium text-foreground/40">孤儿数据残留</div>
              <p className="mt-1 text-xs text-foreground/55">
                {category.orphanCount} 个消息文件（{formatBytes(category.orphanBytes)}）在会话索引中已不存在，
                删除前请确认不涉及仍在使用的会话数据。
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={onCleanOrphans}
                disabled={cleaningOrphans || category.orphanBytes === 0}
                className="mt-1.5 h-7 gap-1 text-xs"
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

export function StorageSettings(): React.ReactElement {
  const [stats, setStats] = React.useState<StorageStats | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [cleaningKey, setCleaningKey] = React.useState<string | null>(null)
  const [lastResult, setLastResult] = React.useState<CleanupResult | null>(null)
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
    setLastResult(result as CleanupResult)
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

  /** 归档清理：先预览，确认后执行 */
  const handlePreviewArchive = async (): Promise<void> => {
    setArchivePreview(null)
    try {
      const preview = await window.electronAPI.previewArchivedCleanup(autoCleanupDays) as PreviewCleanupResult
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

  /** 存量大图剥离：先预览，确认后执行 */
  const handlePreviewStrip = async (): Promise<void> => {
    setStripPreview(null)
    try {
      const preview = await window.electronAPI.previewStripImages() as PreviewCleanupResult
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
      {/* 存储用量 */}
      <SettingsSection
        title="存储用量"
        description={stats ? `总计 ${formatBytes(stats.totalBytes)}` : '正在计算...'}
        action={
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
        }
      >
        {stats && (
          <div className="mb-4">
            <StorageBar categories={stats.categories} totalBytes={stats.totalBytes} />
          </div>
        )}
        <SettingsCard>
          {stats?.categories.map((cat, i) => (
            <div key={cat.key}>
              <SettingsRow label={cat.label}>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn('inline-block h-2.5 w-2.5 rounded-full', BAR_COLORS[i % BAR_COLORS.length])}
                    />
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {formatBytes(cat.bytes)}
                    </span>
                  </div>
                  {cat.key === 'temp-files' ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCleanTemp}
                      disabled={cleaningKey !== null || cat.bytes === 0}
                      className="h-7 gap-1 text-xs"
                    >
                      <Trash2 size={12} />
                      {cleaningKey === 'temp-files' ? '清理中...' : '清理'}
                    </Button>
                  ) : cat.key === 'discover-cache' ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCleanDiscover}
                      disabled={cleaningKey !== null || cat.bytes === 0}
                      className="h-7 gap-1 text-xs"
                      title="仅删除下载的视频缓存，在线播放不受影响"
                    >
                      <Trash2 size={12} />
                      {cleaningKey === 'discover-cache' ? '清理中...' : '清理'}
                    </Button>
                  ) : null}
                </div>
              </SettingsRow>
              {cat.key === 'agent-sessions' && (
                <div className="px-4 pb-3">
                  <AgentSessionsDetail
                    category={cat}
                    expanded={expandedSessions}
                    onToggle={() => setExpandedSessions((prev) => !prev)}
                    onCleanOrphans={() => setOrphanConfirmOpen(true)}
                    cleaningOrphans={cleaningKey === 'orphans'}
                  />
                </div>
              )}
            </div>
          ))}
        </SettingsCard>
      </SettingsSection>

      {/* 会话存储优化 */}
      {sessionCategory && (
        <SettingsSection
          title="会话存储优化"
          description="剥离历史会话中内嵌的截图数据，缩小会话文件体积（不影响消息与文本内容显示）"
        >
          <SettingsCard>
            <SettingsRow label="剥离内嵌大图" description="早期版本的截图以 base64 内嵌在会话记录中，剥离后可在不改动消息内容的前提下回收空间">
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
          <SettingsRow label="清理已归档会话数据" description="自动清理超过指定天数的已归档会话消息和 SDK 数据">
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
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm">
          {lastResult.freedBytes > 0 ? (
            <span className="text-emerald-600 dark:text-emerald-400">
              已释放 {formatBytes(lastResult.freedBytes)}，删除 {lastResult.deletedCount} 个文件
            </span>
          ) : (
            <span className="text-muted-foreground">没有需要清理的数据</span>
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
