/**
 * PullRequestsView — 左侧栏 Pull Requests 入口的全屏视图
 *
 * 列出当前工作区所有 Git 仓库的 open PR，按「待我 Review / 我创建的 / 其他」分组。
 * 数据：window.electronAPI.listPullRequests({ repoPaths })；点击条目打开 PR 详情 Tab。
 * 无 gh / 未登录时显示引导。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import {
  ExternalLink,
  GitPullRequest,
  Loader2,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PullRequestListEntry, PullRequestsListResult } from '@myyoda/shared'
import { agentWorkspacesAtom, currentAgentWorkspaceIdAtom } from '@/atoms/agent-atoms'
import { useOpenPullRequestTab } from '@/components/diff/open-pr-tab'
import {
  groupPullRequests,
  formatPrListCount,
} from '@/components/diff/pull-request-list-model'

export function PullRequestsView(): React.ReactElement {
  const [result, setResult] = React.useState<PullRequestsListResult | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [repoPaths, setRepoPaths] = React.useState<string[]>([])
  const openPullRequestTab = useOpenPullRequestTab()

  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const currentWorkspaceSlug = React.useMemo(() => {
    if (!currentWorkspaceId) return null
    return workspaces.find((w) => w.id === currentWorkspaceId)?.slug ?? null
  }, [currentWorkspaceId, workspaces])

  // 加载工作区根目录 + 自动发现子 Git 仓库
  React.useEffect(() => {
    if (!currentWorkspaceSlug) return
    let cancelled = false
    window.electronAPI.getWorkspaceRootPath(currentWorkspaceSlug)
      .then((root) => {
        if (cancelled || !root) return
        // 主进程 findAllGitRoots 会向上/向下发现子仓库；直接以根目录作为候选
        setRepoPaths([root])
      })
      .catch(() => { /* 忽略 */ })
    return () => { cancelled = true }
  }, [currentWorkspaceSlug])

  const load = React.useCallback(async (showSpinner = false) => {
    if (repoPaths.length === 0) return
    if (showSpinner) setLoading(true)
    setError(null)
    try {
      const data = await window.electronAPI.listPullRequests({ repoPaths })
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载 PR 列表失败')
    } finally {
      setLoading(false)
    }
  }, [repoPaths])

  React.useEffect(() => {
    void load()
  }, [load])

  const groups = result ? groupPullRequests(result.entries, result.viewer) : []
  const hasAny = groups.some((g) => g.entries.length > 0)
  const ghReady = result !== null // listPullRequests 在 gh 未就绪时返回空 entries

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 头部 */}
      <div className="flex-shrink-0 px-4 pt-3 pb-2 border-b border-border/50 flex items-center gap-2">
        <GitPullRequest className="size-4 text-foreground/70" />
        <h1 className="text-sm font-semibold">Pull Requests</h1>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {result ? `${result.entries.length} open` : ''}
        </span>
        <button
          type="button"
          onClick={() => void load(true)}
          className="ml-auto p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
          aria-label="刷新 PR 列表"
        >
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
        </button>
      </div>

      {/* 内容 */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading && !result ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
            <span className="mt-2 text-xs">加载 PR 列表…</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full p-6 text-center">
            <ShieldAlert className="size-8 text-red-500/60" />
            <p className="mt-3 text-sm text-red-500">{error}</p>
            <button
              type="button"
              onClick={() => void load(true)}
              className="mt-4 text-xs text-primary underline underline-offset-2"
            >
              重试
            </button>
          </div>
        ) : !ghReady || !hasAny ? (
          <div className="flex flex-col items-center justify-center h-full p-6 text-center">
            <GitPullRequest className="size-8 text-muted-foreground/30" />
            <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
              {result?.viewer
                ? '当前工作区没有 open 的 Pull Request。'
                : '未检测到 gh（GitHub CLI）登录状态。\n请在终端运行 `gh auth login` 后刷新。'}
            </p>
          </div>
        ) : (
          <div className="px-3 py-2 space-y-4">
            {groups.map((group) => {
              if (group.entries.length === 0) return null
              return (
                <div key={group.key}>
                  <div className="flex items-center gap-1.5 px-1 py-1 text-[11px] font-medium text-muted-foreground">
                    <span>{group.title}</span>
                    <span className="text-muted-foreground/40 tabular-nums">
                      {formatPrListCount(group.entries.length)}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {group.entries.map((entry) => (
                      <PrRow
                        key={`${entry.repository}:${entry.number}`}
                        entry={entry}
                        onOpen={() => openPullRequestTab(entry.repository, entry.number, entry.title)}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function PrRow({
  entry,
  onOpen,
}: {
  entry: PullRequestListEntry
  onOpen: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex items-center gap-2 w-full text-left rounded-lg border border-transparent px-2.5 py-2 hover:bg-foreground/[0.04] hover:border-border/50 transition-colors group"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[12px] font-medium text-foreground truncate">{entry.title}</span>
          {entry.isDraft && (
            <span className="shrink-0 rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">Draft</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-muted-foreground">
          <span className="tabular-nums">#{entry.number}</span>
          <span>·</span>
          <span className="truncate">{entry.repositoryName}</span>
          <span>·</span>
          <span className="truncate">{entry.author?.login ?? '未知'}</span>
        </div>
      </div>
      <div className="flex flex-col items-end gap-0.5 shrink-0">
        <span className="text-[11px] text-muted-foreground tabular-nums">
          +{entry.additions} −{entry.deletions}
        </span>
        {entry.viewerReviewRequested && (
          <span className="rounded bg-amber-500/10 text-amber-500 px-1 py-px text-[10px]">需 review</span>
        )}
      </div>
      <ExternalLink className="size-3 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
    </button>
  )
}
