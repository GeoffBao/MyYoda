/**
 * PullRequestsView — 左侧栏 Pull Requests 入口的全屏视图
 *
 * 对齐 synara 的 Pull requests 页面形态：
 *  - 参与度筛选 Tabs：All / Reviewing / Authored
 *  - 状态筛选 Tabs：Open / Closed / Merged
 *  - 搜索框（标题/编号/分支/作者/仓库名）
 *  - 列表按「待我 Review / 我创建的 / 其他」分组展示
 *  - 空状态引导
 *
 * 数据：window.electronAPI.listPullRequests({ repoPaths, state })；仓库候选取当前工作区下
 * 各 Project 的 workingDirectory（不是 Agent 工作区根目录本身，那不是 git 仓库）。
 * 点击条目打开 PR 详情 Tab。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import {
  ExternalLink,
  GitPullRequest,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PullRequestListEntry, PullRequestState, PullRequestsListResult } from '@myyoda/shared'
import { serverKanbanProjectsAtom } from '@/atoms/project-atoms'
import { useOpenPullRequestTab } from '@/components/diff/open-pr-tab'
import {
  groupPullRequests,
  formatPrListCount,
  filterByInvolvement,
  filterBySearch,
} from '@/components/diff/pull-request-list-model'

type InvolvementFilter = 'all' | 'reviewing' | 'authored'

const INVOLVEMENT_TABS: Array<{ key: InvolvementFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'reviewing', label: 'Reviewing' },
  { key: 'authored', label: 'Authored' },
]

const STATE_TABS: Array<{ key: PullRequestState; label: string }> = [
  { key: 'open', label: 'Open' },
  { key: 'closed', label: 'Closed' },
  { key: 'merged', label: 'Merged' },
]

export function PullRequestsView(): React.ReactElement {
  const [result, setResult] = React.useState<PullRequestsListResult | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [stateFilter, setStateFilter] = React.useState<PullRequestState>('open')
  const [involvement, setInvolvement] = React.useState<InvolvementFilter>('all')
  const [searchQuery, setSearchQuery] = React.useState('')
  const openPullRequestTab = useOpenPullRequestTab()

  // serverKanbanProjectsAtom 已按当前工作区加载（切工作区时 ProjectsInitializer 会清空重载）
  const projects = useAtomValue(serverKanbanProjectsAtom)

  // 仓库候选取当前工作区下各 Project 绑定的 workingDirectory（真实 git 仓库路径）。
  // 注意：不能用 Agent 工作区根目录（~/.myyoda/agent-workspaces/{slug}）本身，
  // 那是 MyYoda 内部配置目录，不是 git 仓库，findGitRoot 永远找不到，PR 列表会一直是空的。
  const repoPaths = React.useMemo(() => {
    const dirs = projects
      .map((p) => p.workingDirectory)
      .filter((dir): dir is string => !!dir)
    return Array.from(new Set(dirs))
  }, [projects])

  const load = React.useCallback(async (showSpinner = false) => {
    if (repoPaths.length === 0) return
    if (showSpinner) setLoading(true)
    setError(null)
    try {
      const data = await window.electronAPI.listPullRequests({ repoPaths, state: stateFilter })
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载 PR 列表失败')
    } finally {
      setLoading(false)
    }
  }, [repoPaths, stateFilter])

  React.useEffect(() => {
    void load()
  }, [load])

  // 切换状态筛选时重新拉取
  const handleStateChange = React.useCallback((state: PullRequestState) => {
    setStateFilter(state)
    setLoading(true)
  }, [])

  // 前端过滤：参与度 + 搜索词
  const viewer = result?.viewer ?? null
  const involvementFiltered = React.useMemo(
    () => filterByInvolvement(result?.entries ?? [], involvement, viewer),
    [result, involvement, viewer],
  )
  const searched = React.useMemo(
    () => filterBySearch(involvementFiltered, searchQuery),
    [involvementFiltered, searchQuery],
  )
  const groups = React.useMemo(() => groupPullRequests(searched, viewer), [searched, viewer])
  const hasAny = groups.some((g) => g.entries.length > 0)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 头部 */}
      <div className="flex-shrink-0 px-4 pt-3 pb-2 border-b border-border/50">
        <div className="flex items-center gap-2">
          <GitPullRequest className="size-4 text-foreground/70" />
          <h1 className="text-sm font-semibold">Pull requests</h1>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {result ? `${searched.length} ${stateFilter}` : ''}
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

        {/* 状态筛选 Tabs */}
        <div className="flex items-center gap-1 mt-2">
          {STATE_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => handleStateChange(tab.key)}
              className={cn(
                'px-2.5 py-1 rounded-md text-xs transition-colors',
                stateFilter === tab.key
                  ? 'bg-foreground/10 text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
            </button>
          ))}
          <span className="mx-1 w-px h-4 bg-border/60" />
          {INVOLVEMENT_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setInvolvement(tab.key)}
              className={cn(
                'px-2.5 py-1 rounded-md text-xs transition-colors',
                involvement === tab.key
                  ? 'bg-foreground/10 text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 搜索框 */}
        <div className="flex items-center gap-1.5 mt-2 px-2 h-7 rounded-md bg-muted/50 border border-transparent focus-within:border-primary/40 focus-within:bg-muted/70 transition-colors">
          <Search className="size-3 text-muted-foreground flex-shrink-0" />
          <input
            type="text"
            aria-label="搜索 Pull Request"
            className="flex-1 bg-transparent text-[11px] outline-none placeholder:text-muted-foreground/40"
            placeholder="Search pull requests"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              aria-label="清除搜索"
              className="flex-shrink-0 p-0.5 rounded-sm hover:bg-foreground/[0.08] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              onClick={() => setSearchQuery('')}
            >
              <X className="size-3" />
            </button>
          )}
        </div>
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
        ) : !hasAny ? (
          <div className="flex flex-col items-center justify-center h-full p-6 text-center">
            <GitPullRequest className="size-8 text-muted-foreground/30" />
            <p className="mt-3 text-sm font-medium text-foreground/70">No pull requests found</p>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              {result?.viewer
                ? searchQuery
                  ? 'Try another search, involvement, or state filter.'
                  : `当前工作区没有 ${stateFilter} 状态的 Pull Request。`
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
          {entry.state === 'merged' && (
            <span className="shrink-0 rounded bg-purple-500/10 text-purple-500 px-1 py-px text-[10px]">Merged</span>
          )}
          {entry.state === 'closed' && (
            <span className="shrink-0 rounded bg-muted text-muted-foreground px-1 py-px text-[10px]">Closed</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-muted-foreground">
          <span className="tabular-nums">#{entry.number}</span>
          <span>·</span>
          <span className="truncate">{entry.repositoryName}</span>
          <span>·</span>
          <span className="truncate">{entry.author?.login ?? '未知'}</span>
          {entry.headBranch && (
            <>
              <span>·</span>
              <span className="truncate">{entry.headBranch}</span>
            </>
          )}
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
