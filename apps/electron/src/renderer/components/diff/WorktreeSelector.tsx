import * as React from 'react'
import { GitBranch, ChevronDown, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { WorktreeInfo, WorkspaceWorktreeRepo } from '@myyoda/shared'
import { normalizePathForCompare } from '@myyoda/shared'
import { isDetached, shouldCollapseDetached, sortWorktreesForSelector, worktreeDisplayName } from './worktree-selector-model'

interface WorktreeSelectorProps {
  sessionId: string
  workspaceSlug?: string
  repoPaths?: string[]
  selectedPath: string | null
  onSelect: (worktree: WorktreeInfo | null) => void
}

interface RepoWorktrees {
  repo: WorkspaceWorktreeRepo
  worktrees: WorktreeInfo[]
}

function normalizePathKey(filePath: string): string {
  return normalizePathForCompare(filePath)
}

function getPathBasename(filePath: string): string {
  return normalizePathKey(filePath).split('/').filter(Boolean).pop() || filePath
}

/** 相对主仓库的短路径，如 .worktrees/agent-experts-teams */
function worktreeShortPath(wt: WorktreeInfo): string {
  return wt.path.replace(/\/$/, '')
}

function WorktreeTooltip({ wt }: { wt: WorktreeInfo }): React.ReactElement {
  return (
    <div className="space-y-0.5">
      <div className="font-medium break-all">{worktreeShortPath(wt)}</div>
      {isDetached(wt) ? (
        <>
          <div className="text-muted-foreground">detached HEAD · {wt.head}</div>
          {wt.commitSubject && <div className="text-muted-foreground break-all">{wt.commitSubject}</div>}
        </>
      ) : (
        <div className="text-muted-foreground">分支 {wt.branch} · {wt.head}</div>
      )}
    </div>
  )
}

export function WorktreeSelector({
  sessionId,
  workspaceSlug,
  repoPaths,
  selectedPath,
  onSelect,
}: WorktreeSelectorProps): React.ReactElement {
  const [repoWorktrees, setRepoWorktrees] = React.useState<RepoWorktrees[]>([])
  const [isOpen, setIsOpen] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(false)
  const [collapsedDetachedRepos, setCollapsedDetachedRepos] = React.useState<Set<string>>(new Set())
  const dropdownRef = React.useRef<HTMLDivElement>(null)

  const fetchWorktrees = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const repoMap = new Map<string, WorkspaceWorktreeRepo>()

      if (workspaceSlug) {
        const repos = await window.electronAPI.getWorktreeRepos(workspaceSlug)
        for (const repo of repos) {
          repoMap.set(normalizePathKey(repo.repoPath), repo)
        }
      }

      for (const repoPath of repoPaths ?? []) {
        if (!repoPath) continue
        const key = normalizePathKey(repoPath)
        if (repoMap.has(key)) continue
        repoMap.set(key, {
          name: getPathBasename(repoPath),
          repoPath,
          worktreesPath: '',
          priority: 0,
        })
      }

      const repos = Array.from(repoMap.values())
      if (repos.length === 0) {
        setRepoWorktrees([])
        return
      }

      const results: RepoWorktrees[] = []
      for (const repo of repos) {
        try {
          const list = await window.electronAPI.listWorktrees(repo.repoPath, sessionId)
          const nonMain = list.filter((wt) => !wt.isMain)
          if (nonMain.length > 0) {
            results.push({ repo, worktrees: sortWorktreesForSelector(nonMain) })
          }
        } catch {
          // skip repos that fail
        }
      }
      setRepoWorktrees(results)
    } catch {
      setRepoWorktrees([])
    } finally {
      setIsLoading(false)
    }
  }, [workspaceSlug, repoPaths, sessionId])

  React.useEffect(() => {
    fetchWorktrees()
  }, [fetchWorktrees])

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const allWorktrees = repoWorktrees.flatMap((rw) => rw.worktrees)
  const selectedWorktree = allWorktrees.find((wt) => wt.path === selectedPath)
  // 选中 detached worktree 时用目录名（如 sleepy-bell-0e1168），而不是干巴巴的 "(detached)"
  const displayLabel = selectedWorktree
    ? worktreeDisplayName(selectedWorktree)
    : 'Worktrees'
  const hasMultipleRepos = repoWorktrees.length > 1

  const toggleDetachedCollapse = (repoPath: string) => {
    setCollapsedDetachedRepos(prev => {
      const next = new Set(prev)
      if (next.has(repoPath)) {
        next.delete(repoPath)
      } else {
        next.add(repoPath)
      }
      return next
    })
  }

  if (allWorktrees.length === 0) return <></>

  return (
    <div ref={dropdownRef} className="relative px-3 py-1.5 border-b border-border/50">
      <div className="flex items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setIsOpen(!isOpen)}
              className={cn(
                'flex items-center gap-1.5 px-2 py-1 rounded-md text-xs',
                'hover:bg-accent/50 transition-colors',
                'text-muted-foreground hover:text-foreground',
                selectedWorktree && 'text-foreground font-medium',
              )}
            >
              <GitBranch className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate max-w-[160px]">{displayLabel}</span>
              <ChevronDown className={cn('w-3 h-3 shrink-0 transition-transform', isOpen && 'rotate-180')} />
            </button>
          </TooltipTrigger>
          {selectedWorktree && (
            <TooltipContent side="bottom" className="max-w-[320px]">
              <WorktreeTooltip wt={selectedWorktree} />
            </TooltipContent>
          )}
        </Tooltip>
        <button
          onClick={(e) => {
            e.stopPropagation()
            fetchWorktrees()
          }}
          className="p-1 rounded hover:bg-accent/50 text-muted-foreground hover:text-foreground transition-colors"
          title="刷新 worktree 列表"
        >
          <RefreshCw className={cn('w-3 h-3', isLoading && 'animate-spin')} />
        </button>
      </div>

      {isOpen && (
        <div className="absolute left-2 right-2 top-full mt-0.5 z-50 bg-popover border border-border rounded-md shadow-md py-1 max-h-[300px] overflow-y-auto">
          <button
            onClick={() => {
              onSelect(null)
              setIsOpen(false)
            }}
            className={cn(
              'w-full text-left px-3 py-1.5 text-xs hover:bg-accent/50 transition-colors',
              !selectedPath && 'bg-accent/30 font-medium',
            )}
          >
            会话改动
          </button>
          {repoWorktrees.map((rw) => {
            const collapse = shouldCollapseDetached(rw.worktrees)
            const isCollapsed = collapse && collapsedDetachedRepos.has(rw.repo.repoPath)
            const named = rw.worktrees.filter((wt) => !isDetached(wt))
            const detached = rw.worktrees.filter(isDetached)
            const visible = isCollapsed ? named : rw.worktrees
            return (
              <React.Fragment key={rw.repo.repoPath}>
                {hasMultipleRepos && (
                  <div className="px-3 pt-2 pb-0.5 text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider">
                    {rw.repo.name}
                  </div>
                )}

                {visible.map((wt) => (
                  <WorktreeOption
                    key={wt.path}
                    wt={wt}
                    selected={selectedPath === wt.path}
                    onSelect={() => {
                      onSelect(wt)
                      setIsOpen(false)
                    }}
                  />
                ))}

                {collapse && detached.length > 0 && (
                  <button
                    onClick={() => toggleDetachedCollapse(rw.repo.repoPath)}
                    className="w-full text-left px-3 py-1.5 text-[11px] text-muted-foreground/70 hover:bg-accent/50 hover:text-foreground transition-colors flex items-center gap-1.5"
                  >
                    <ChevronDown className={cn('w-3 h-3 shrink-0 transition-transform', isCollapsed && '-rotate-90')} />
                    <span>其他 {detached.length} 个 detached worktree</span>
                  </button>
                )}
              </React.Fragment>
            )
          })}
        </div>
      )}
    </div>
  )
}

function WorktreeOption({
  wt,
  selected,
  onSelect,
}: {
  wt: WorktreeInfo
  selected: boolean
  onSelect: () => void
}): React.ReactElement {
  const name = worktreeDisplayName(wt)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onSelect}
          className={cn(
            'w-full text-left px-3 py-1.5 text-xs hover:bg-accent/50 transition-colors flex items-center gap-2',
            selected && 'bg-accent/30 font-medium',
          )}
        >
          <GitBranch className={cn('w-3 h-3 shrink-0', isDetached(wt) ? 'text-muted-foreground/60' : 'text-primary')} />
          <span className="min-w-0 flex-1 flex flex-col">
            <span className="truncate leading-tight">{name}</span>
            {isDetached(wt) ? (
              <span className="truncate leading-tight text-[10px] text-muted-foreground/70">
                {wt.commitSubject || `detached · ${wt.head}`}
              </span>
            ) : (
              <span className="truncate leading-tight text-[10px] text-muted-foreground/70">
                {wt.name}
              </span>
            )}
          </span>
          <span className="text-muted-foreground ml-auto shrink-0">{wt.head}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-[320px]">
        <WorktreeTooltip wt={wt} />
      </TooltipContent>
    </Tooltip>
  )
}
