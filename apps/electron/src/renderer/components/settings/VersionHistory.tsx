/**
 * VersionHistory - 版本历史组件
 *
 * 展示本地化版本历史（读 resources/release-notes/*.md），完全离线可用，
 * 不再依赖 GitHub 网络。按 semver 降序展示最近 N 条，可点击展开详情。
 */

import * as React from 'react'
import type { ReleaseNote } from '@myyoda/shared'
import { RefreshCw, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { ReleaseNoteMarkdown } from './ReleaseNoteMarkdown'
import { SettingsCard } from './primitives'

/** 默认折叠展示的版本数（展开后显示全部） */
const COLLAPSED_VISIBLE_COUNT = 4

/**
 * VersionHistory 组件
 */
export function VersionHistory(): React.ReactElement {
  const [notes, setNotes] = React.useState<ReleaseNote[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [expandedVersions, setExpandedVersions] = React.useState<Set<string>>(new Set())
  const [showAll, setShowAll] = React.useState(false)

  // 加载本地版本历史
  const loadReleaseNotes = React.useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const data = await window.electronAPI.listReleaseNotes()
      setNotes(data)
    } catch (err) {
      console.error('[版本历史] 加载失败:', err)
      setError('加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  // 初始加载
  React.useEffect(() => {
    loadReleaseNotes()
  }, [loadReleaseNotes])

  // 切换展开/折叠
  const toggleExpand = (version: string): void => {
    setExpandedVersions(prev => {
      const next = new Set(prev)
      if (next.has(version)) {
        next.delete(version)
      } else {
        next.add(version)
      }
      return next
    })
  }

  // 默认只展示前 COLLAPSED_VISIBLE_COUNT 个，展开后显示全部
  const visibleNotes = showAll ? notes : notes.slice(0, COLLAPSED_VISIBLE_COUNT)
  const totalCount = notes.length

  return (
    <SettingsCard>
      {/* 标题栏 */}
      <div className="p-4 border-b">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">版本历史</h3>
          <button
            onClick={loadReleaseNotes}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            刷新
          </button>
        </div>
      </div>

      {/* 版本列表 */}
      <div className="divide-y">
        {loading && notes.length === 0 ? (
          <div className="p-8 text-center">
            <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground mt-2">加载中...</p>
          </div>
        ) : error ? (
          <div className="p-8 text-center">
            <p className="text-sm text-muted-foreground">加载失败</p>
            <p className="text-xs text-muted-foreground mt-1">{error}</p>
          </div>
        ) : notes.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-muted-foreground">暂无版本历史</p>
          </div>
        ) : (
          visibleNotes.map((note, index) => {
            const isExpanded = expandedVersions.has(note.version)
            const isLatest = index === 0

            return (
              <div key={note.version} className="p-4">
                {/* 版本标题（可点击展开） */}
                <button
                  onClick={() => toggleExpand(note.version)}
                  className="w-full flex items-center justify-between text-left hover:bg-accent/50 -m-4 p-4 rounded-lg transition-colors"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <span className="text-sm font-medium font-mono truncate">
                      v{note.version}
                    </span>
                    {isLatest && (
                      <span className="text-xs text-primary font-medium shrink-0">
                        最新
                      </span>
                    )}
                  </div>
                  {isExpanded ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0 ml-2" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 ml-2" />
                  )}
                </button>

                {/* Release Notes（展开时显示） */}
                {isExpanded && (
                  <div className="mt-4 pt-4 border-t">
                    <ReleaseNoteMarkdown content={note.content} compact />
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* 显示全部 / 收起（版本数超过折叠阈值时） */}
      {!loading && !error && notes.length > COLLAPSED_VISIBLE_COUNT && (
        <div className="border-t p-2">
          <button
            onClick={() => setShowAll((v) => !v)}
            className="flex w-full items-center justify-center gap-1 rounded-lg py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {showAll ? '收起版本列表' : `显示全部 ${totalCount} 个版本`}
            {showAll ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      )}
    </SettingsCard>
  )
}
