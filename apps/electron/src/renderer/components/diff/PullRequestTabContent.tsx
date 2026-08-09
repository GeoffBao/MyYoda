/**
 * PullRequestTabContent — PR 详情独立 Tab
 *
 * 一个 PR 一个 Tab（可同时开多个），展示：
 *  - Summary：标题 / 状态徽标（open/draft/merged/closed）/ 作者 / diff stat / CI checks /
 *             Merge 按钮（merge/squash/rebase + delete-branch 可选）/ 描述 markdown
 *  - Code：gh pr diff 拉取的 patch，用现有 DiffView 组件渲染
 *  - Timeline：评论列表 + 评论 composer + 「转给 Agent 修」按钮（预填 composer prompt）
 *
 * 数据：window.electronAPI.getPullRequestDetail / getPullRequestDiff / pullRequestAction /
 *       addPullRequestComment / getBranchWorktreeUsage
 */

import * as React from 'react'
import {
  ArrowLeftRight,
  Check,
  Code2,
  GitMerge,
  GitPullRequest,
  Loader2,
  MessageSquare,
  RefreshCw,
  Send,
  Sparkles,
} from 'lucide-react'
import { useAtom, useSetAtom } from 'jotai'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { CodeBlock } from '@myyoda/ui'
import type {
  PullRequestActionInput,
  PullRequestAction,
  PullRequestComment,
  PullRequestDetail,
  PullRequestMergeMethod,
} from '@myyoda/shared'
import { pullRequestTabStateMapAtom } from '@/atoms/pr-tab-atoms'
import { currentAgentSessionDraftAtom } from '@/atoms/agent-atoms'
import { copyTextToClipboard } from '@/lib/clipboard'
import { DiffView } from './DiffView'

export interface PullRequestTabContentProps {
  /** PR Tab ID（__pr__:<repoPath>::<number>） */
  tabId: string
}

/** 状态徽标配色 */
const STATE_STYLES: Record<PullRequestDetail['state'], string> = {
  open: 'bg-emerald-500/10 text-emerald-500',
  merged: 'bg-purple-500/10 text-purple-500',
  closed: 'bg-muted text-muted-foreground',
}

const REVIEW_DECISION_STYLES: Record<string, string> = {
  APPROVED: 'bg-emerald-500/10 text-emerald-500',
  CHANGES_REQUESTED: 'bg-red-500/10 text-red-500',
  REVIEW_REQUIRED: 'bg-amber-500/10 text-amber-500',
}

const CHECK_STATUS_STYLES: Record<string, string> = {
  success: 'bg-emerald-500/10 text-emerald-500',
  failure: 'bg-red-500/10 text-red-500',
  pending: 'bg-amber-500/10 text-amber-500',
  cancelled: 'bg-muted text-muted-foreground',
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const diff = Date.now() - date.getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins} 分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return date.toLocaleDateString('zh-CN')
}

export function PullRequestTabContent({ tabId }: PullRequestTabContentProps): React.ReactElement {
  const [tabStates, setTabStates] = useAtom(pullRequestTabStateMapAtom)
  const tabState = tabStates.get(tabId)
  const setAgentDraft = useSetAtom(currentAgentSessionDraftAtom)

  const [detail, setDetail] = React.useState<PullRequestDetail | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [refreshKey, setRefreshKey] = React.useState(0)

  const [section, setSection] = React.useState<'summary' | 'code' | 'timeline'>('summary')
  const [patch, setPatch] = React.useState<string | null>(null)
  const [patchLoading, setPatchLoading] = React.useState(false)
  const [diffViewMode, setDiffViewMode] = React.useState<'split' | 'unified'>('split')

  // Merge 对话框状态
  const [mergeDialogOpen, setMergeDialogOpen] = React.useState(false)
  const [mergeMethod, setMergeMethod] = React.useState<PullRequestMergeMethod>('squash')
  const [mergeDeleteBranch, setMergeDeleteBranch] = React.useState(false)
  const [mergeLoading, setMergeLoading] = React.useState(false)
  const [worktreeOccupied, setWorktreeOccupied] = React.useState(false)
  const [worktreePaths, setWorktreePaths] = React.useState<string[]>([])

  // 评论状态
  const [commentBody, setCommentBody] = React.useState('')
  const [commentLoading, setCommentLoading] = React.useState(false)

  // 解析 tabId → repoPath + number
  const parsed = React.useMemo(() => {
    const sepIndex = tabId.indexOf('::')
    const repoPath = sepIndex > 0 ? tabId.slice(tabId.indexOf(':') + 1, sepIndex) : ''
    const number = sepIndex > 0 ? Number(tabId.slice(sepIndex + 2)) : NaN
    return { repoPath, number }
  }, [tabId])

  const loadDetail = React.useCallback(async () => {
    if (!parsed.repoPath || !Number.isFinite(parsed.number)) return
    setLoading(true)
    setError(null)
    try {
      const data = await window.electronAPI.getPullRequestDetail({
        repoPath: parsed.repoPath,
        number: parsed.number,
      })
      setDetail(data)
      setTabStates((prev) => {
        const next = new Map(prev)
        const existing = next.get(tabId)
        next.set(tabId, existing
          ? { ...existing, loading: false, error: null, title: data.title, needsRefresh: false }
          : {
              repoPath: parsed.repoPath,
              number: parsed.number,
              title: data.title,
              loading: false,
              error: null,
              activeSection: 'summary',
              needsRefresh: false,
            })
        return next
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载 PR 详情失败')
      setTabStates((prev) => {
        const next = new Map(prev)
        next.set(tabId, {
          repoPath: parsed.repoPath,
          number: parsed.number,
          title: `PR #${parsed.number}`,
          loading: false,
          error: err instanceof Error ? err.message : '加载失败',
          activeSection: 'summary',
          needsRefresh: false,
        })
        return next
      })
    } finally {
      setLoading(false)
    }
  }, [parsed.repoPath, parsed.number, tabId, setTabStates])

  React.useEffect(() => {
    void loadDetail()
  }, [loadDetail, refreshKey])

  // 打开 merge 对话框时预查 worktree 占用（--delete-branch 安全）
  React.useEffect(() => {
    if (!mergeDialogOpen || !detail) return
    let cancelled = false
    window.electronAPI.getBranchWorktreeUsage(detail.repository, detail.headBranch)
      .then((usage) => {
        if (cancelled) return
        setWorktreeOccupied(usage.worktrees.length > 0)
        setWorktreePaths(usage.worktrees)
      })
      .catch(() => {
        if (!cancelled) setWorktreeOccupied(false)
      })
    return () => { cancelled = true }
  }, [mergeDialogOpen, detail])

  const loadPatch = React.useCallback(async () => {
    if (!parsed.repoPath || !Number.isFinite(parsed.number)) return
    setPatchLoading(true)
    try {
      const result = await window.electronAPI.getPullRequestDiff({
        repoPath: parsed.repoPath,
        number: parsed.number,
      })
      setPatch(result.patch)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载 PR diff 失败')
    } finally {
      setPatchLoading(false)
    }
  }, [parsed.repoPath, parsed.number])

  const handleMerge = React.useCallback(async () => {
    if (!detail) return
    setMergeLoading(true)
    try {
      const input: PullRequestActionInput = {
        repoPath: detail.repository,
        number: detail.number,
        action: 'merge' as PullRequestAction,
        mergeMethod,
        deleteBranch: mergeDeleteBranch,
      }
      const result = await window.electronAPI.pullRequestAction(input)
      setMergeDialogOpen(false)
      toast.success(`PR #${detail.number} 已合并`)
      if (result.url) window.electronAPI.openExternal(result.url)
      // 合并后刷新详情
      setRefreshKey((k) => k + 1)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '合并失败')
    } finally {
      setMergeLoading(false)
    }
  }, [detail, mergeMethod, mergeDeleteBranch])

  const handleComment = React.useCallback(async () => {
    if (!detail || !commentBody.trim()) return
    setCommentLoading(true)
    try {
      await window.electronAPI.addPullRequestComment({
        repoPath: detail.repository,
        number: detail.number,
        body: commentBody.trim(),
      })
      setCommentBody('')
      toast.success('评论已发布')
      setRefreshKey((k) => k + 1)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '评论失败')
    } finally {
      setCommentLoading(false)
    }
  }, [detail, commentBody])

  // 组装「转给 Agent 修」的 prompt（预填到 composer）
  const handleFixWithAgent = React.useCallback(async () => {
    if (!detail) return
    const comments = detail.comments
      .filter((c) => c.body)
      .map((c) => `${c.author?.login ?? '匿名'}：${c.body.slice(0, 500)}`)
      .join('\n\n')
    const prompt = [
      `请修复 PR #${detail.number} 的 review 意见：`,
      `- PR: ${detail.url}`,
      `- 标题: ${detail.title}`,
      `- head 分支: ${detail.headBranch}`,
      `- base 分支: ${detail.baseBranch}`,
      comments ? `\nReview 意见：\n${comments}` : '\n（没有正文 review 意见，请打开 PR 查看具体行内评论）',
      `\n修复完成后 push 到 ${detail.headBranch} 即可。`,
    ].join('\n')
    try {
      // 预填当前活跃 Agent 会话的 composer（用户审阅后手动发送）
      setAgentDraft(prompt)
      toast.success('已把修复任务填入 Agent 输入框，请审阅后发送')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '预填失败，请手动复制 prompt')
      try {
        await copyTextToClipboard(prompt)
      } catch { /* 忽略 */ }
    }
  }, [detail, setAgentDraft])

  // 渲染 loading / error
  if (loading && !detail) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
        <span className="mt-2 text-xs">加载 PR 详情…</span>
      </div>
    )
  }

  if (error && !detail) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center">
        <GitPullRequest className="size-8 text-muted-foreground/40" />
        <p className="mt-3 text-sm text-red-500">{error}</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => setRefreshKey((k) => k + 1)}>
          <RefreshCw className="size-3.5 mr-1.5" /> 重试
        </Button>
      </div>
    )
  }

  if (!detail) return <></>

  const checksLabel = detail.checks.length > 0
    ? `${detail.checks.filter((c) => c.status === 'success').length} ✓ / ${detail.checks.filter((c) => c.status === 'failure').length} ✗ / ${detail.checks.filter((c) => c.status === 'pending').length} …`
    : '无 CI 检查'

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 头部 */}
      <div className="flex-shrink-0 px-4 pt-3 pb-2 border-b border-border/50">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold truncate">{detail.title}</h2>
          <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium', STATE_STYLES[detail.state])}>
            {detail.isDraft ? 'Draft' : detail.state}
          </span>
          {detail.reviewDecision && (
            <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium', REVIEW_DECISION_STYLES[detail.reviewDecision] ?? 'bg-muted text-muted-foreground')}>
              {detail.reviewDecision}
            </span>
          )}
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground tabular-nums">
            +{detail.additions} −{detail.deletions} · {detail.changedFiles} files · {checksLabel}
          </span>
        </div>
        <div className="flex items-center gap-1.5 mt-1 text-[11px] text-muted-foreground">
          <span className="truncate">{detail.author?.login ?? '未知作者'}</span>
          <span>·</span>
          <span className="truncate">
            {detail.headBranch} <ArrowLeftRight className="size-2.5 inline" /> {detail.baseBranch}
          </span>
          {detail.updatedAt && <span className="ml-auto shrink-0">更新于 {formatRelative(detail.updatedAt)}</span>}
        </div>

        {/* 操作区 */}
        <div className="flex items-center gap-1.5 mt-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => window.electronAPI.openExternal(detail.url)}
          >
            <GitPullRequest className="size-3.5 mr-1" /> GitHub
          </Button>
          {detail.state === 'open' && (
            <Button
              variant="default"
              size="sm"
              className="h-7 text-xs"
              disabled={detail.mergeStateStatus === 'DIRTY' || detail.mergeable === 'CONFLICTING'}
              onClick={() => setMergeDialogOpen(true)}
            >
              <GitMerge className="size-3.5 mr-1" /> Merge
            </Button>
          )}
          {detail.state === 'open' && detail.isDraft && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={async () => {
                try {
                  await window.electronAPI.pullRequestAction({
                    repoPath: detail.repository,
                    number: detail.number,
                    action: 'ready',
                  })
                  toast.success('已转为 Ready for review')
                  setRefreshKey((k) => k + 1)
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : '操作失败')
                }
              }}
            >
              <Check className="size-3.5 mr-1" /> Ready
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={async () => {
              try {
                await window.electronAPI.checkoutPullRequest(detail.repository, detail.number)
                toast.success(`已检出 PR 到本地（分支 ${detail.headBranch}）`)
              } catch (err) {
                toast.error(err instanceof Error ? err.message : '检出失败')
              }
            }}
          >
            <Code2 className="size-3.5 mr-1" /> Checkout
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setRefreshKey((k) => k + 1)}
          >
            <RefreshCw className="size-3.5" />
          </Button>
        </div>

        {/* 子 Tab 切换 */}
        <div className="flex items-center gap-1 mt-2">
          {([
            ['summary', 'Summary'],
            ['code', 'Code'],
            ['timeline', `Timeline${detail.comments.length > 0 ? ` (${detail.comments.length})` : ''}`],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setSection(key)
                if (key === 'code' && patch === null) void loadPatch()
              }}
              className={cn(
                'px-2.5 py-1 text-xs rounded-md transition-colors',
                section === key
                  ? 'bg-foreground/10 text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 内容区 */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {section === 'summary' && (
          <div className="px-4 py-3">
            <div className="prose dark:prose-invert max-w-none text-sm prose-p:my-1.5 prose-p:leading-[1.6] prose-li:leading-[1.6]">
              <Markdown
                remarkPlugins={[remarkGfm]}
                components={{
                  pre: ({ children: preChildren }) => (
                    <CodeBlock onCopy={copyTextToClipboard}>{preChildren}</CodeBlock>
                  ),
                  a: ({ href, children: linkChildren }) => (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => {
                        e.preventDefault()
                        if (href) window.electronAPI.openExternal(href)
                      }}
                      className="text-primary underline underline-offset-2"
                    >
                      {linkChildren}
                    </a>
                  ),
                }}
              >
                {detail.body || '*该 PR 没有描述*'}
              </Markdown>
            </div>
          </div>
        )}

        {section === 'code' && (
          <div className="p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">
                {patch ? 'gh pr diff' : patchLoading ? '加载 diff…' : '点击 Code 已自动加载'}
              </span>
              <div className="flex gap-1">
                {(['split', 'unified'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setDiffViewMode(mode)}
                    className={cn(
                      'px-2 py-0.5 text-[11px] rounded border',
                      diffViewMode === mode
                        ? 'bg-foreground/10 border-foreground/20'
                        : 'border-transparent text-muted-foreground',
                    )}
                  >
                    {mode === 'split' ? '分栏' : '合并'}
                  </button>
                ))}
              </div>
            </div>
            {patchLoading ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
              </div>
            ) : patch ? (
              <div className="rounded-lg border border-border/50 bg-background p-2">
                <DiffView
                  oldContent={patchToOld(patch)}
                  newContent={patchToNew(patch)}
                  filePath="PR.diff"
                  viewMode={diffViewMode}
                />
              </div>
            ) : (
              <div className="text-xs text-muted-foreground py-6 text-center">暂无 diff</div>
            )}
          </div>
        )}

        {section === 'timeline' && (
          <div className="px-4 py-3 space-y-3">
            {/* 转给 Agent 修 */}
            {detail.comments.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="w-full h-8 text-xs"
                onClick={() => void handleFixWithAgent()}
              >
                <Sparkles className="size-3.5 mr-1.5" /> 把 review 意见转给 Agent 修
              </Button>
            )}

            {/* 评论列表 */}
            <div className="space-y-2.5">
              {detail.comments.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">暂无评论</p>
              )}
              {detail.comments.map((comment, idx) => (
                <CommentCard key={comment.id || idx} comment={comment} />
              ))}
            </div>

            {/* 评论 composer */}
            <div className="rounded-lg border border-border/50 p-2.5">
              <Textarea
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                placeholder="发表评论…（支持 Markdown）"
                rows={3}
                className="text-xs min-h-[64px]"
              />
              <div className="flex justify-end mt-2">
                <Button
                  variant="default"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={!commentBody.trim() || commentLoading}
                  onClick={() => void handleComment()}
                >
                  {commentLoading ? (
                    <Loader2 className="size-3.5 animate-spin mr-1" />
                  ) : (
                    <Send className="size-3.5 mr-1" />
                  )}
                  发表评论
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Merge 确认对话框 */}
      <ConfirmDialog
        open={mergeDialogOpen}
        onOpenChange={setMergeDialogOpen}
        title={`合并 PR #${detail.number}`}
        confirmLabel="确认合并"
        loading={mergeLoading}
        loadingLabel="合并中…"
        variant="default"
        onConfirm={() => void handleMerge()}
      >
        <div className="space-y-2.5">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground shrink-0">合并方式</span>
            {(['squash', 'merge', 'rebase'] as PullRequestMergeMethod[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMergeMethod(m)}
                className={cn(
                  'px-2.5 py-1 rounded-md border text-xs transition-colors',
                  mergeMethod === m
                    ? 'bg-foreground/10 border-foreground/30'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {m === 'squash' ? 'Squash' : m === 'merge' ? 'Merge' : 'Rebase'}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={mergeDeleteBranch}
              onChange={(e) => setMergeDeleteBranch(e.target.checked)}
              disabled={worktreeOccupied}
            />
            合并后删除 {detail.headBranch} 分支
            {worktreeOccupied && (
              <span className="text-red-500 ml-1" title={`分支被以下 worktree 占用：${worktreePaths.join(', ')}`}>
                （被其他 worktree 占用，已禁用）
              </span>
            )}
          </label>
          <p className="text-[11px] text-muted-foreground">
            将执行：gh pr merge {detail.number} --{mergeMethod}{mergeDeleteBranch ? ' --delete-branch' : ''}
          </p>
        </div>
      </ConfirmDialog>
    </div>
  )
}

/** 把 git patch 转换成 DiffView 需要的 old/new 内容（粗略拆分行，供统一 diff 渲染） */
function patchToOld(patch: string): string {
  // DiffView 需要 oldContent/newContent；对 PR 整包 patch 简化为按 +/- 行拆分的两栏
  const added: string[] = []
  const removed: string[] = []
  for (const line of patch.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added.push(line.slice(1))
    else if (line.startsWith('-') && !line.startsWith('---')) removed.push(line.slice(1))
  }
  return removed.join('\n')
}

function patchToNew(patch: string): string {
  const added: string[] = []
  const removed: string[] = []
  for (const line of patch.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added.push(line.slice(1))
    else if (line.startsWith('-') && !line.startsWith('---')) removed.push(line.slice(1))
  }
  return added.join('\n')
}

function CommentCard({ comment }: { comment: PullRequestComment }): React.ReactElement {
  return (
    <div className="rounded-lg border border-border/50 p-2.5">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground">{comment.author?.login ?? '匿名'}</span>
        {comment.kind === 'review' && comment.reviewState && (
          <span className={cn(
            'rounded px-1 py-px text-[10px]',
            REVIEW_DECISION_STYLES[comment.reviewState] ?? 'bg-muted text-muted-foreground',
          )}>
            {comment.reviewState}
          </span>
        )}
        <span>·</span>
        <span>{formatRelative(comment.createdAt)}</span>
      </div>
      {comment.body ? (
        <div className="mt-1 text-xs prose prose-sm dark:prose-invert max-w-none prose-p:my-1">
          {comment.body.slice(0, 2000)}
        </div>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground italic">（无正文）</p>
      )}
    </div>
  )
}
