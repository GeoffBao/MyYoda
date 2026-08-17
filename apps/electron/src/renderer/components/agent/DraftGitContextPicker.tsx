import * as React from 'react'
import { useAtomValue } from 'jotai'
import type { GitBranchInfo, GitExecutionMode } from '@myyoda/shared'
import { Check, ChevronDown, FolderGit2, GitBranch, Info, Plus, X } from 'lucide-react'
import { serverKanbanProjectsAtom } from '@/atoms/project-atoms'
import { agentWorkspacesAtom } from '@/atoms/agent-atoms'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  canCheckoutBranchInLocal,
  filterGitBranches,
  formatGitBranchSubtitle,
  getGitModeStorageKey,
  isSameBoundRepo,
  resolveInitialGitExecutionMode,
} from './git-context-picker-model'

export interface DraftGitContextSelection {
  repoPath: string
  executionMode: GitExecutionMode
  branch: string
  newBranchName?: string
  slug?: string
  /**
   * 分支是否为用户显式选择（下拉点选 / 新建分支），而非加载时的默认快照。
   * 发送时 Local 模式的默认快照会跟随仓库真实当前分支（见 resolveLocalSendBranch），
   * 避免终端侧切分支后旧快照触发意外切换或误报未提交改动；显式选择保持不变。
   */
  explicit?: boolean
}

/** 会话已绑定的 Git 上下文（重开空会话时回显，避免误建第二个 worktree） */
export interface DraftGitContextBoundState {
  gitRepoPath?: string
  gitBranch?: string
  gitExecutionMode?: GitExecutionMode
  /** 创建时选中的基准分支；与 gitBranch 不同说明上次是「新建分支」创建 */
  gitBaseRef?: string
}

export interface DraftGitContextPickerProps {
  sessionId: string
  /** 会话归属工作区（workspace 化后的主链路：workspace.projectRootPath 即仓库目录） */
  workspaceId?: string
  /** 旧 Project 模型兜底：workspace 未绑定工程目录时按 KanbanProject.workingDirectory 解析 */
  projectId?: string
  /** 会话已持久化的 Git 上下文，重开空会话时优先回显 */
  initialGitContext?: DraftGitContextBoundState
  isDraft: boolean
  onSelectionChange: (selection: DraftGitContextSelection | null) => void
}

/**
 * Draft 会话顶部 Git 上下文选择器：Local/Worktree 分段开关 + 分支选择 + 新建分支。
 *
 * repoPath 解析优先级：
 * 1. 工作区绑定的工程目录（workspace.projectRootPath）——workspace 化后的主链路
 * 2. 旧 KanbanProject.workingDirectory——存量 projectId 会话兜底
 * 两条链路都为空（纯托管工作区）时整个选择器隐藏。
 */
export function DraftGitContextPicker({
  sessionId,
  workspaceId,
  projectId,
  initialGitContext,
  isDraft,
  onSelectionChange,
}: DraftGitContextPickerProps): React.ReactElement | null {
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const projects = useAtomValue(serverKanbanProjectsAtom)
  const workspace = workspaceId ? workspaces.find((candidate) => candidate.id === workspaceId) : undefined
  const legacyProject = projectId ? projects.find((candidate) => candidate.id === projectId) : undefined
  const repoPath = workspace?.projectRootPath || legacyProject?.workingDirectory

  const [isGitRepo, setIsGitRepo] = React.useState(false)
  const [branches, setBranches] = React.useState<GitBranchInfo[]>([])
  const [mode, setMode] = React.useState<GitExecutionMode>('local')
  const [branch, setBranch] = React.useState('')
  const [query, setQuery] = React.useState('')
  const [newBranchName, setNewBranchName] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [branchExplicit, setBranchExplicit] = React.useState(false)
  const [branchPopoverOpen, setBranchPopoverOpen] = React.useState(false)
  const [newBranchPopoverOpen, setNewBranchPopoverOpen] = React.useState(false)
  const [newBranchDraft, setNewBranchDraft] = React.useState('')

  // 保持回调最新引用而不触发 effect 重跑：分支列表/模式状态不应随父级每次重渲重置
  const onSelectionChangeRef = React.useRef(onSelectionChange)
  React.useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange
  }, [onSelectionChange])

  const emitSelection = React.useCallback((selection: DraftGitContextSelection | null) => {
    onSelectionChangeRef.current(selection)
  }, [])

  // 会话绑定上下文与当前目标仓库是否同源（决定回显 branch/mode 还是按仓库默认初始化）
  const boundContextMatchesRepo = isSameBoundRepo(initialGitContext?.gitRepoPath, repoPath ?? '')

  // 模式初始化：会话已绑定上下文 > 该仓库上次使用模式 > 默认 Local。
  // 工作区/项目切换导致 repoPath 变化时重新解析，保证不会串用另一个仓库的记忆。
  React.useEffect(() => {
    if (!repoPath) {
      setMode('local')
      return
    }
    const remembered = window.localStorage.getItem(getGitModeStorageKey(repoPath)) ?? undefined
    setMode(resolveInitialGitExecutionMode({
      initialMode: boundContextMatchesRepo ? initialGitContext?.gitExecutionMode : undefined,
      rememberedMode: remembered,
    }))
  }, [repoPath, boundContextMatchesRepo, initialGitContext?.gitExecutionMode])

  // 分支列表加载 + 会话绑定分支回显
  React.useEffect(() => {
    let cancelled = false
    setBranches([])
    setBranch('')
    setBranchExplicit(false)
    setIsGitRepo(false)
    setNewBranchName('')
    setQuery('')
    emitSelection(null)
    if (!isDraft || !repoPath) return

    setLoading(true)
    window.electronAPI.getGitRepoStatus(repoPath)
      .then(async (status) => {
        if (cancelled) return
        if (!status?.isRepo) {
          setIsGitRepo(false)
          emitSelection(null)
          return
        }
        setIsGitRepo(true)
        const nextBranches = await window.electronAPI.listGitBranches({ repoPath, sessionId })
        if (cancelled) return
        setBranches(nextBranches)
        // 重开空会话：优先回显会话已绑定分支（与 worktree 复用校验一致），否则默认当前分支
        const boundBranch = boundContextMatchesRepo ? initialGitContext?.gitBranch : undefined
        const initialBranch = (boundBranch && nextBranches.some((candidate) => candidate.name === boundBranch))
          ? boundBranch
          : nextBranches.find((candidate) => candidate.current)?.name
            ?? status.branch
            ?? nextBranches[0]?.name
            ?? ''
        setBranch(initialBranch)
        // 恢复「新建分支」状态：仅 worktree 模式下、绑定分支 ≠ 基准分支（即上次由新建分支创建）时回填。
        // 回填后首次发送会用相同的新分支名推导出原 worktree 路径并复用，而不是误建第二个 worktree；
        // Local 模式不回填（分支已存在，重跑 switch -c 会失败，且 Local 无需重建路径）。
        if (
          boundContextMatchesRepo
          && initialGitContext?.gitExecutionMode === 'worktree'
          && initialGitContext.gitBaseRef
          && boundBranch
          && initialGitContext.gitBaseRef !== boundBranch
        ) {
          setNewBranchName(boundBranch)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn('[DraftGitContextPicker] 读取 Git 上下文失败:', error)
          setIsGitRepo(false)
          emitSelection(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [
    isDraft,
    repoPath,
    sessionId,
    emitSelection,
    boundContextMatchesRepo,
    initialGitContext?.gitRepoPath,
    initialGitContext?.gitBranch,
    initialGitContext?.gitExecutionMode,
    initialGitContext?.gitBaseRef,
  ])

  React.useEffect(() => {
    if (!isDraft || !repoPath || !isGitRepo || !branch) {
      emitSelection(null)
      return
    }
    emitSelection({
      repoPath,
      executionMode: mode,
      branch,
      newBranchName: newBranchName.trim() || undefined,
      slug: newBranchName.trim() || undefined,
      explicit: branchExplicit,
    })
  }, [branch, isDraft, isGitRepo, mode, newBranchName, emitSelection, repoPath, branchExplicit])

  const updateMode = React.useCallback((nextMode: GitExecutionMode) => {
    setMode(nextMode)
    if (repoPath) {
      window.localStorage.setItem(getGitModeStorageKey(repoPath), nextMode)
    }
  }, [repoPath])

  const confirmNewBranch = React.useCallback(() => {
    setNewBranchName(newBranchDraft.trim())
    setBranchExplicit(true)
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
  const hasNewBranchName = newBranchName.trim().length > 0
  const repoName = repoPath.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).pop() ?? repoPath

  const hint = ((): { text: string; tone: 'warn' | 'info' } | null => {
    if (mode === 'local') {
      return {
        text: 'Local 模式与该仓库的其他 Local 会话共享同一工作目录，切换分支会互相影响',
        tone: 'warn',
      }
    }
    if (!hasNewBranchName) {
      return {
        text: '将以 detached HEAD 创建 worktree，未合并的提交在清理该 worktree 时可能丢失；建议点「新建分支」',
        tone: 'warn',
      }
    }
    return {
      text: `将在新分支 ${newBranchName.trim()} 的独立 worktree 中执行，不影响主工作区`,
      tone: 'info',
    }
  })()

  return (
    <>
      {/* Local | Worktree 分段开关（对齐 synara 的 Environment mode 控件） */}
      <div
        role="group"
        aria-label="执行环境"
        className="inline-flex h-7 shrink-0 items-center gap-0.5 rounded-md border border-border/70 bg-background/80 p-0.5"
      >
        {(['local', 'worktree'] as const).map((candidate) => {
          const active = mode === candidate
          return (
            <button
              key={candidate}
              type="button"
              aria-pressed={active}
              disabled={loading}
              onClick={() => updateMode(candidate)}
              title={
                candidate === 'local'
                  ? '在当前工作目录直接执行（与其他 Local 会话共享，切分支会互相影响）'
                  : '在独立的 .worktrees 目录中执行（隔离改动，不影响主工作区）'
              }
              className={cn(
                'h-6 rounded px-2 text-[11px] font-medium leading-none transition-colors disabled:opacity-50',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )}
            >
              {candidate === 'local' ? 'Local' : 'Worktree'}
            </button>
          )
        })}
      </div>

      {/* 分支选择：Popover + Command 组合下拉；顶部展示目标仓库，避免多工作区/多仓库时选错 */}
      <Popover open={branchPopoverOpen} onOpenChange={setBranchPopoverOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={loading}
            className="inline-flex h-7 max-w-[220px] items-center gap-1.5 rounded-md border border-border/70 bg-background/80 px-2 text-muted-foreground outline-none transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
            title={`仓库：${repoPath}`}
          >
            <GitBranch className="size-3.5 shrink-0" />
            <span className="truncate text-foreground">{branch || (loading ? '检测仓库…' : '选择分支')}</span>
            {/* current 分支的 checkedOutPath 指向主仓库本身，不是真正的占用，不显示徽标 */}
            {selectedBranch?.checkedOutPath && !selectedBranch.current && (
              <span
                className="shrink-0 rounded-full bg-amber-500/15 px-1 text-[10px] leading-4 text-amber-600 dark:text-amber-400"
                title={`已被其他 worktree 检出：${selectedBranch.checkedOutPath}`}
              >
                已检出
              </span>
            )}
            <ChevronDown className="size-3 shrink-0 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} className="w-80 p-0">
          <div className="flex items-center gap-1.5 border-b border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
            <FolderGit2 className="size-3.5 shrink-0 opacity-70" />
            <span className="truncate" title={repoPath}>{repoName}</span>
          </div>
          <Command shouldFilter={false}>
            <CommandInput placeholder="搜索分支" value={query} onValueChange={setQuery} />
            <CommandList>
              <CommandEmpty>没有匹配的分支</CommandEmpty>
              <CommandGroup>
                {visibleBranches.map((candidate) => {
                  // Local 模式下被其他 worktree 占用的分支：不置灰，点击时自动切到 worktree 模式并选中。
                  // 后端以 --detach 创建 worktree（不占用分支本身），因此「选中被占用分支 → worktree」是可行的，
                  // 用户无需理解两种模式的区别，点选被占用的分支本身就是「我想用这个分支」，系统替用户做对的事。
                  const localOccupied = mode === 'local' && !canCheckoutBranchInLocal(candidate)
                  return (
                    <CommandItem
                      key={candidate.ref}
                      onSelect={() => {
                        if (localOccupied) updateMode('worktree')
                        setBranchExplicit(true)
                        setBranch(candidate.name)
                        setBranchPopoverOpen(false)
                      }}
                      className="gap-2"
                    >
                      <Check className={cn('size-3.5 shrink-0', candidate.name === branch ? 'opacity-100' : 'opacity-0')} />
                      <span className="flex-1 truncate">{candidate.name}</span>
                      <span
                        className={cn(
                          'shrink-0 max-w-[110px] truncate text-[10px]',
                          localOccupied
                            ? 'text-amber-600 dark:text-amber-400'
                            : candidate.checkedOutPath
                              ? 'text-muted-foreground'
                              : 'text-muted-foreground/60',
                        )}
                      >
                        {localOccupied ? '已被占用 · 将切 Worktree' : formatGitBranchSubtitle(candidate)}
                      </span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* 新建分支：确认前是「+ 新建分支」按钮 + 小弹层表单；确认后收成只读 chip，可重新编辑或 ✕ 清空 */}
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
              className="inline-flex h-7 max-w-[180px] items-center gap-1 rounded-md border border-primary/40 bg-primary/10 pl-2 pr-1 text-primary transition-colors hover:bg-primary/15"
              title={`基于 ${branch || '所选分支'} 新建分支 ${newBranchName}`}
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
              disabled={loading}
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-dashed border-border/70 px-2 text-muted-foreground transition-colors hover:border-border hover:text-foreground disabled:opacity-50"
            >
              <Plus className="size-3.5 shrink-0" />
              新建分支
            </button>
          )}
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} className="w-80 p-3">
          <p className="text-xs font-medium text-foreground">
            {mode === 'worktree' ? '新建分支，并检出到独立 Worktree' : '新建分支，并切换当前工作目录'}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            基于「{branch || '所选分支'}」创建新分支。
            {mode === 'worktree'
              ? '新分支与你的改动都会被隔离在该会话的 worktree 中，不影响主工作区。'
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

      {hint && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={cn(
                'inline-flex size-6 shrink-0 cursor-default items-center justify-center rounded-full',
                hint.tone === 'warn'
                  ? 'text-amber-600/80 hover:bg-amber-500/10 dark:text-amber-400/80'
                  : 'text-muted-foreground hover:bg-muted/60',
              )}
            >
              <Info className="size-3.5" />
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-72 text-xs">
            {hint.text}
          </TooltipContent>
        </Tooltip>
      )}
    </>
  )
}
