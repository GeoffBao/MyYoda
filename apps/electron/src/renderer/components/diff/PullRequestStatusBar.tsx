/**
 * PullRequestStatusBar — 文件改动面板顶部的 PR 状态行 + 主操作按钮
 *
 * 显示：
 *  - 当前分支关联的 open PR（#编号 + 标题 + CI 徽标 + draft 徽标）→ 点击打开详情 Tab
 *  - 主操作按钮（Push & create PR / 查看 PR / 默认分支引导 / gh 引导）
 *  - 刷新时机：面板挂载 + 手动刷新按钮 + 窗口重新聚焦（由父组件 refreshVersion 触发）
 *    —— 不做轮询，避免频繁打 GitHub API（rate limit 风险）。
 *
 * 数据来自 window.electronAPI.getPullRequestPanelState（一次 IPC 拿 gh + git + PR 三份状态）。
 */

import * as React from 'react'
import { ExternalLink, GitPullRequest, RefreshCw, Rocket, ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import type { PullRequestPanelState } from '@myyoda/shared'
import {
  checksSummaryLabel,
  resolvePullRequestPrimaryAction,
} from './pull-request-model'

interface PullRequestStatusBarProps {
  /** Git 仓库根目录（绝对路径） */
  repoPath: string
  /** 刷新信号（窗口聚焦 / 父组件触发时递增，重拉面板状态） */
  refreshVersion?: number
  /** 打开 PR 详情 Tab */
  onOpenPullRequest?: (repoPath: string, number: number) => void
  /** 创建 PR 成功后的回调（用于刷新文件列表 / toast） */
  onPrCreated?: (result: { number: number; url: string; reusedExisting: boolean }) => void
  /** 是否处于只读/会话文件模式（非 Git 仓库时隐藏） */
  enabled?: boolean
}

export function PullRequestStatusBar({
  repoPath,
  refreshVersion,
  onOpenPullRequest,
  onPrCreated,
  enabled = true,
}: PullRequestStatusBarProps): React.ReactElement | null {
  const [panelState, setPanelState] = React.useState<PullRequestPanelState | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)
  const [isCreating, setIsCreating] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [draft, setDraft] = React.useState(false)

  const load = React.useCallback(async (showSpinner = false) => {
    if (!enabled || !repoPath) return
    if (showSpinner) setIsLoading(true)
    setError(null)
    try {
      const state = await window.electronAPI.getPullRequestPanelState(repoPath)
      setPanelState(state)
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取 PR 状态失败')
    } finally {
      setIsLoading(false)
    }
  }, [repoPath, enabled])

  React.useEffect(() => {
    void load()
  }, [load, refreshVersion])

  if (!enabled || !repoPath) return null

  const action = resolvePullRequestPrimaryAction({
    gh: panelState?.gh ?? null,
    git: panelState?.git ?? null,
    currentBranchPr: panelState?.currentBranchPr ?? null,
  })
  const pr = panelState?.currentBranchPr ?? null
  const branch = panelState?.git?.branch ?? null

  const handlePrimaryClick = React.useCallback(async () => {
    if (!panelState?.git?.repoPath) return
    const git = panelState.git

    // 已有 PR → 打开详情
    if (pr) {
      onOpenPullRequest?.(pr.repoPath, pr.number)
      return
    }

    // 默认分支 → 先引导创建 feature 分支（确认框）
    if (git.isDefaultBranch) {
      setConfirmOpen(true)
      return
    }

    // 默认分支引导确认 / 常规创建：直接走创建流程
    await runCreateFlow()
  }, [panelState, pr, onOpenPullRequest])

  const runCreateFlow = React.useCallback(async () => {
    const git = panelState?.git
    if (!git?.repoPath || !git.branch) return
    setConfirmOpen(false)
    setIsCreating(true)
    setError(null)
    try {
      const repoPath = git.repoPath
      const headBranch: string = git.branch

      const baseBranch = git.isDefaultBranch
        ? headBranch // 默认分支引导会自动切到 feat/ 分支，base 用默认分支名
        : await window.electronAPI.getDefaultBranch(repoPath)

      const result = await window.electronAPI.createPullRequest({
        repoPath,
        headBranch,
        baseBranch,
        title: '', // 主进程从分支名自动生成
        body: '', // 主进程按模板自动生成
        draft,
        autoCreateFeatureBranch: git.isDefaultBranch,
        autoGenerateTitleAndBody: true,
      })
      onPrCreated?.(result)
      // 刷新状态行（push 成功后重新拉一次）
      await load(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建 PR 失败')
    } finally {
      setIsCreating(false)
    }
  }, [panelState, draft, onPrCreated, load])

  // 合并确认框（PR 详情 Tab 内使用，此处不在状态行展示）
  return (
    <div className="flex-shrink-0 px-2 pt-1.5 pb-1">
      <div className={cn(
        'rounded-lg border bg-card/40 px-2.5 py-2',
        error ? 'border-red-500/30' : 'border-transparent',
      )}>
        {error && (
          <div className="flex items-center gap-1.5 text-[11px] text-red-500 mb-1.5">
            <ShieldAlert className="size-3 flex-shrink-0" />
            <span className="truncate">{error}</span>
          </div>
        )}

        {/* PR 状态行 */}
        {pr ? (
          <button
            type="button"
            onClick={() => onOpenPullRequest?.(pr.repoPath, pr.number)}
            className="flex items-center gap-1.5 w-full text-left rounded-md px-1 py-1 hover:bg-foreground/[0.05] transition-colors group"
          >
            <GitPullRequest className="size-3.5 text-emerald-500 flex-shrink-0" />
            <span className="text-[12px] font-medium text-foreground truncate">
              #{pr.number} {pr.title}
            </span>
            {pr.isDraft && (
              <span className="shrink-0 rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">Draft</span>
            )}
            {checksSummaryLabel(pr.checksSummary) && (
              <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                {checksSummaryLabel(pr.checksSummary)}
              </span>
            )}
            <ExternalLink className="size-3 text-muted-foreground/40 ml-auto shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        ) : (
          <div className="flex items-center gap-1.5 px-1 py-1">
            <GitPullRequest className="size-3.5 text-muted-foreground/40 flex-shrink-0" />
            {isLoading ? (
              <span className="text-[11px] text-muted-foreground/50">加载 PR 状态…</span>
            ) : (
              <span className="text-[11px] text-muted-foreground/60 truncate">
                {branch ? `分支 ${branch}` : '未检出分支'}
                {action.hint ? ` · ${action.hint}` : ''}
              </span>
            )}
          </div>
        )}

        {/* 主操作按钮 */}
        {action.kind !== 'disabled' && action.kind !== 'gh_setup' && (
          <div className="mt-1">
            <button
              type="button"
              disabled={action.disabled || isCreating || isLoading}
              onClick={() => void handlePrimaryClick()}
              className={cn(
                'flex items-center justify-center gap-1.5 w-full h-7 rounded-md text-[12px] font-medium transition-colors',
                action.kind === 'view_pr'
                  ? 'bg-foreground/5 text-foreground hover:bg-foreground/10'
                  : 'bg-primary text-primary-foreground hover:bg-primary/90',
                (action.disabled || isCreating || isLoading) && 'opacity-50 cursor-not-allowed',
              )}
            >
              {isCreating ? (
                <RefreshCw className="size-3.5 animate-spin" />
              ) : (
                <Rocket className="size-3.5" />
              )}
              {isCreating ? '创建中…' : action.label}
            </button>
          </div>
        )}
      </div>

      {/* 默认分支引导确认框 */}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="创建 feature 分支?"
        description={`当前在默认分支 ${panelState?.git?.branch ?? ''} 上。PR 不能从默认分支指向自身，将自动创建 feature 分支并继续创建 PR。`}
        confirmLabel="创建 feature 分支并继续"
        loading={isCreating}
        loadingLabel="创建中…"
        onConfirm={() => void runCreateFlow()}
      >
        <div className="space-y-2">
          <div className="text-[12px] text-muted-foreground">
            将执行：
            <ol className="list-decimal pl-4 mt-1 space-y-0.5">
              <li>git checkout -b feat/&lt;branch&gt;-&lt;date&gt;</li>
              <li>git push -u origin &lt;branch&gt;</li>
              <li>gh pr create --base &lt;base&gt; --head &lt;branch&gt;</li>
            </ol>
          </div>
          <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <input
              type="checkbox"
              checked={draft}
              onChange={(e) => setDraft(e.target.checked)}
            />
            创建为 Draft PR
          </label>
        </div>
      </ConfirmDialog>
    </div>
  )
}
