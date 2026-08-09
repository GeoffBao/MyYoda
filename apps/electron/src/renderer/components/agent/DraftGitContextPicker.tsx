import * as React from 'react'
import { useAtomValue } from 'jotai'
import type { GitBranchInfo, GitExecutionMode } from '@myyoda/shared'
import { Check, ChevronDown, GitBranch, Info, Plus, X } from 'lucide-react'
import { serverKanbanProjectsAtom } from '@/atoms/project-atoms'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  canCheckoutBranchInLocal,
  filterGitBranches,
  formatGitBranchSubtitle,
  getInitialGitExecutionMode,
  getProjectGitModeStorageKey,
} from './git-context-picker-model'

export interface DraftGitContextSelection {
  repoPath: string
  executionMode: GitExecutionMode
  branch: string
  newBranchName?: string
  slug?: string
}

export interface DraftGitContextPickerProps {
  sessionId: string
  projectId?: string
  isDraft: boolean
  onSelectionChange: (selection: DraftGitContextSelection | null) => void
}

export function DraftGitContextPicker({
  sessionId,
  projectId,
  isDraft,
  onSelectionChange,
}: DraftGitContextPickerProps): React.ReactElement | null {
  const projects = useAtomValue(serverKanbanProjectsAtom)
  const project = projectId ? projects.find((candidate) => candidate.id === projectId) : undefined
  const repoPath = project?.workingDirectory
  const [isGitRepo, setIsGitRepo] = React.useState(false)
  const [branches, setBranches] = React.useState<GitBranchInfo[]>([])
  const [mode, setMode] = React.useState<GitExecutionMode>('local')
  const [branch, setBranch] = React.useState('')
  const [query, setQuery] = React.useState('')
  const [newBranchName, setNewBranchName] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [branchPopoverOpen, setBranchPopoverOpen] = React.useState(false)
  const [newBranchPopoverOpen, setNewBranchPopoverOpen] = React.useState(false)
  const [newBranchDraft, setNewBranchDraft] = React.useState('')

  React.useEffect(() => {
    if (!projectId) {
      setMode('local')
      return
    }
    const remembered = window.localStorage.getItem(getProjectGitModeStorageKey(projectId)) ?? undefined
    setMode(getInitialGitExecutionMode(remembered))
  }, [projectId])

  React.useEffect(() => {
    let cancelled = false
    setBranches([])
    setBranch('')
    setIsGitRepo(false)
    setNewBranchName('')
    onSelectionChange(null)
    if (!isDraft || !repoPath) return

    setLoading(true)
    window.electronAPI.getGitRepoStatus(repoPath)
      .then(async (status) => {
        if (cancelled) return
        if (!status?.isRepo) {
          setIsGitRepo(false)
          onSelectionChange(null)
          return
        }
        setIsGitRepo(true)
        const nextBranches = await window.electronAPI.listGitBranches({ repoPath, sessionId })
        if (cancelled) return
        setBranches(nextBranches)
        const initialBranch = nextBranches.find((candidate) => candidate.current)?.name
          ?? status.branch
          ?? nextBranches[0]?.name
          ?? ''
        setBranch(initialBranch)
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn('[DraftGitContextPicker] 读取 Git 上下文失败:', error)
          setIsGitRepo(false)
          onSelectionChange(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [isDraft, onSelectionChange, repoPath, sessionId])

  React.useEffect(() => {
    if (!isDraft || !repoPath || !isGitRepo || !branch) {
      onSelectionChange(null)
      return
    }
    onSelectionChange({
      repoPath,
      executionMode: mode,
      branch,
      newBranchName: newBranchName.trim() || undefined,
      slug: newBranchName.trim() || undefined,
    })
  }, [branch, isDraft, isGitRepo, mode, newBranchName, onSelectionChange, repoPath])

  const updateMode = React.useCallback((nextMode: GitExecutionMode) => {
    setMode(nextMode)
    if (projectId) {
      window.localStorage.setItem(getProjectGitModeStorageKey(projectId), nextMode)
    }
  }, [projectId])

  const confirmNewBranch = React.useCallback(() => {
    setNewBranchName(newBranchDraft.trim())
    setNewBranchPopoverOpen(false)
  }, [newBranchDraft])

  // 切到 Local 模式时，若当前选中分支已被其他 worktree 占用（不可在 Local 下 checkout），
  // 自动回退到第一个可用分支，避免停留在一个禁用选项上、用户以为已生效实际未变更。
  React.useEffect(() => {
    if (mode !== 'local') return
    const current = branches.find((candidate) => candidate.name === branch)
    if (current && !canCheckoutBranchInLocal(current)) {
      const fallback = branches.find((candidate) => canCheckoutBranchInLocal(candidate))
      setBranch(fallback?.name ?? '')
    }
  }, [mode, branch, branches])

  if (!isDraft || !repoPath || (!isGitRepo && !loading)) return null

  const visibleBranches = filterGitBranches(branches, query)
  const selectedBranch = branches.find((candidate) => candidate.name === branch)
  const hintText = mode === 'local'
    ? 'Local 模式与该工作区其他 Local 会话共享同一工作目录，切分支会互相影响'
    : !newBranchName.trim()
      ? '不填新分支名将以 detached HEAD 创建 worktree，未合并的提交在清理该 worktree 时可能丢失'
      : null

  // 不再自带外层 flex 容器/内边距——由调用方（AgentView）和 DraftProjectPicker
  // 放进同一个 flex-wrap 行，对齐 Claude/Codex 那种「项目 | 分支 | worktree」轻量上下文栏。
  // 分支搜索框 + 原生 select 合并成一个 Popover+Command 组合下拉；占用提示、模式警告
  // 原本各占一整行常驻文字，现在收进 hover 才展开的 Tooltip，减少输入框上方的视觉拥挤。
  return (
    <>
      <Popover open={branchPopoverOpen} onOpenChange={setBranchPopoverOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex h-7 max-w-[240px] items-center gap-1.5 rounded-md border border-border/70 bg-background/80 px-2 text-muted-foreground outline-none hover:bg-muted/60 hover:text-foreground transition-colors"
          >
            <GitBranch className="size-3.5 shrink-0" />
            <span className="truncate text-foreground">{branch || (loading ? '加载分支…' : '选择分支')}</span>
            {selectedBranch?.checkedOutPath && (
              <span className="shrink-0 text-[10px] text-amber-600/80 dark:text-amber-400/80">occupied</span>
            )}
            <ChevronDown className="size-3 shrink-0 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} className="w-72 p-0">
          <Command shouldFilter={false}>
            <CommandInput placeholder="搜索分支" value={query} onValueChange={setQuery} />
            <CommandList>
              <CommandEmpty>没有匹配的分支</CommandEmpty>
              <CommandGroup>
                {visibleBranches.map((candidate) => {
                  // Local 模式下被其他 worktree 占用的分支：不再置灰，点击时自动切到 worktree 模式并选中。
                  // 这消除「为什么点不了」的歧义——用户无需理解两种模式的区别，点选被占用的分支本身就是
                  // 在表达「我想用这个分支」，此时它只能以 worktree 隔离目录形式使用，系统替用户做对的事。
                  const localOccupied = mode === 'local' && !canCheckoutBranchInLocal(candidate)
                  return (
                    <CommandItem
                      key={candidate.ref}
                      onSelect={() => {
                        if (localOccupied) updateMode('worktree')
                        setBranch(candidate.name)
                        setBranchPopoverOpen(false)
                      }}
                      className="gap-2"
                    >
                      <Check className={cn('size-3.5 shrink-0', candidate.name === branch ? 'opacity-100' : 'opacity-0')} />
                      <span className="flex-1 truncate">{candidate.name}</span>
                      <span className="shrink-0 truncate max-w-[90px] text-[10px] text-muted-foreground/60">
                        {localOccupied ? '已被占用 · 将切 worktree' : formatGitBranchSubtitle(candidate)}
                      </span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <button
        type="button"
        aria-pressed={mode === 'worktree'}
        className={cn(
          'inline-flex h-7 items-center gap-1.5 rounded-md border border-border/70 bg-background/80 px-2 text-muted-foreground outline-none transition-colors hover:bg-muted/60 hover:text-foreground',
          mode === 'worktree' && 'border-primary/35 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary',
        )}
        onClick={() => updateMode(mode === 'worktree' ? 'local' : 'worktree')}
      >
        <span className={cn(
          'flex size-3.5 items-center justify-center rounded-[3px] border text-[10px] leading-none',
          mode === 'worktree' ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40',
        )}>
          {mode === 'worktree' ? '✓' : ''}
        </span>
        worktree
      </button>

      {/* 新建分支：确认前是一个语义清晰的"+ 新建分支"按钮 + 小弹层表单（说明基于哪个分支创建、
          创建后会发生什么），而不是一个没有标签、含义不明、看起来会永远停留在可编辑状态的裸输入框。
          确认后收成一个只读 chip，点击可重新编辑，点 ✕ 可清空退回不新建分支的状态。 */}
      <Popover
        open={newBranchPopoverOpen}
        onOpenChange={(open) => {
          setNewBranchPopoverOpen(open)
          if (open) setNewBranchDraft(newBranchName)
        }}
      >
        <PopoverTrigger asChild>
          {newBranchName ? (
            <button
              type="button"
              className="inline-flex h-7 max-w-[160px] items-center gap-1 rounded-md border border-primary/40 bg-primary/10 pl-2 pr-1 text-primary transition-colors hover:bg-primary/15"
            >
              <GitBranch className="size-3.5 shrink-0" />
              <span className="truncate">{newBranchName}</span>
              <span
                role="button"
                tabIndex={0}
                aria-label="取消新建分支"
                className="ml-0.5 shrink-0 rounded p-0.5 hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onClick={(event) => {
                  event.stopPropagation()
                  setNewBranchName('')
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  event.stopPropagation()
                  setNewBranchName('')
                }}
              >
                <X className="size-3" />
              </span>
            </button>
          ) : (
            <button
              type="button"
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-dashed border-border/70 px-2 text-muted-foreground transition-colors hover:border-border hover:text-foreground"
            >
              <Plus className="size-3.5 shrink-0" />
              新建分支
            </button>
          )}
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} className="w-72 p-3">
          <p className="text-xs font-medium text-foreground">
            {mode === 'worktree' ? '新建分支，并在独立 Worktree 中检出' : '新建分支，并切换当前工作目录'}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            基于「{branch || '所选分支'}」创建新分支。
            {mode === 'worktree'
              ? '不填分支名会以 detached HEAD 创建 worktree，未合并的提交在清理时可能丢失。'
              : '创建后当前会话会切到这个新分支上执行。'}
          </p>
          <input
            autoFocus
            value={newBranchDraft}
            onChange={(event) => setNewBranchDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                confirmNewBranch()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                setNewBranchPopoverOpen(false)
              }
            }}
            placeholder="例如 feature/my-change"
            className="mt-2 h-8 w-full rounded-md border border-border/70 bg-background px-2 text-xs outline-none focus:border-primary/50"
          />
          <div className="mt-2.5 flex justify-end gap-1.5">
            <button
              type="button"
              className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted/60"
              onClick={() => setNewBranchPopoverOpen(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
              disabled={!newBranchDraft.trim()}
              onClick={confirmNewBranch}
            >
              {newBranchName ? '更新' : '确定'}
            </button>
          </div>
        </PopoverContent>
      </Popover>

      {hintText && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-amber-600/80 hover:bg-amber-500/10 dark:text-amber-400/80 cursor-default">
              <Info className="size-3.5" />
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-64 text-xs">
            {hintText}
          </TooltipContent>
        </Tooltip>
      )}
    </>
  )
}
