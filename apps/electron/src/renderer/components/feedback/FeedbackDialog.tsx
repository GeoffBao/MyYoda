/**
 * FeedbackDialog - 用户反馈弹窗（参考 newmax 设计）
 *
 * - 类型二选一：Bug 报告 / 功能建议
 * - 详细描述 ≤5000 字，实时计数
 * - 截图 ≤5：截屏（截当前窗口，弹窗自身自动隐藏）+ 上传
 * - 可选联系方式（回复用）
 * - 提交到 GitHub Issues（GeoffBao/MyYoda 公开仓库）；未配置时引导去设置
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { toast } from 'sonner'
import { Bug, Camera, FileText, ImagePlus, Lightbulb, Loader2, Mail, Settings2, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  FEEDBACK_DESCRIPTION_MAX_LENGTH,
  FEEDBACK_MAX_SCREENSHOTS,
  type FeedbackDraftItem,
  type FeedbackType,
} from '@myyoda/shared'
import { feedbackDialogOpenAtom } from '@/atoms/feedback-dialog'
import { settingsOpenAtom, settingsTabAtom } from '@/atoms/settings-tab'
import { useReleaseNotes } from '@/hooks/useReleaseNotes'

interface ShotItem {
  filePath: string
  dataUrl: string
}

const TYPE_OPTIONS: Array<{ value: FeedbackType; label: string; hint: string; icon: React.ComponentType<{ size?: number | string; className?: string }> }> = [
  { value: 'bug', label: 'Bug 报告', hint: '报告问题或错误', icon: Bug },
  { value: 'feature', label: '功能建议', hint: '提出新功能想法', icon: Lightbulb },
]

const PLACEHOLDERS: Record<FeedbackType, string> = {
  bug: '请描述您遇到的问题，包括复现步骤...',
  feature: '请描述您希望添加的功能...',
}

export function FeedbackDialog(): React.ReactElement {
  const open = useAtomValue(feedbackDialogOpenAtom)
  const setOpen = useSetAtom(feedbackDialogOpenAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const setSettingsTab = useSetAtom(settingsTabAtom)
  const { version } = useReleaseNotes()

  const [type, setType] = React.useState<FeedbackType>('bug')
  const [description, setDescription] = React.useState('')
  const [contactEmail, setContactEmail] = React.useState('')
  const [showContact, setShowContact] = React.useState(false)
  const [shots, setShots] = React.useState<ShotItem[]>([])
  const [capturing, setCapturing] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [configured, setConfigured] = React.useState<boolean | null>(null)
  const [drafts, setDrafts] = React.useState<FeedbackDraftItem[]>([])

  // 每次打开时重新读取配置状态并重置表单
  React.useEffect(() => {
    if (!open) return
    setConfigured(null)
    window.electronAPI
      .feedbackGetConfig()
      .then((config) => setConfigured(config.configured))
      .catch(() => setConfigured(false))
    void window.electronAPI
      .feedbackListDrafts()
      .then(setDrafts)
      .catch(() => setDrafts([]))
  }, [open])

  const handleClose = (): void => {
    if (submitting) return
    setOpen(false)
  }

  const resetForm = (): void => {
    setType('bug')
    setDescription('')
    setContactEmail('')
    setShowContact(false)
    setShots([])
  }

  const refreshDrafts = React.useCallback(async (): Promise<void> => {
    try {
      setDrafts(await window.electronAPI.feedbackListDrafts())
    } catch {
      setDrafts([])
    }
  }, [])

  /** 载入草稿到表单（截图文件可能已被清理，不恢复；只恢复文字内容） */
  const loadDraft = (draft: FeedbackDraftItem): void => {
    setType(draft.input.type)
    setDescription(draft.input.description)
    if (draft.input.contactEmail?.trim()) {
      setContactEmail(draft.input.contactEmail.trim())
      setShowContact(true)
    }
    setShots([])
  }

  const removeDraft = async (fileName: string): Promise<void> => {
    try {
      const ok = await window.electronAPI.feedbackDeleteDraft(fileName)
      if (ok) await refreshDrafts()
    } catch {
      // 删除失败静默（下次打开会重读）
    }
  }

  const handleOpenChange = (next: boolean): void => {
    if (submitting) return
    setOpen(next)
    if (!next) resetForm()
  }

  /** 截屏：短暂隐藏弹窗自身，截当前窗口，然后恢复 */
  const handleCapture = async (): Promise<void> => {
    if (shots.length >= FEEDBACK_MAX_SCREENSHOTS || capturing || submitting) return
    setCapturing(true)
    try {
      // 等一帧渲染（弹窗已加 invisible），确保截图不包含弹窗
      await new Promise((resolve) => setTimeout(resolve, 200))
      const result = await window.electronAPI.feedbackCaptureWindow()
      if (result) {
        setShots((prev) => [...prev, result].slice(0, FEEDBACK_MAX_SCREENSHOTS))
      } else {
        toast.error('截图失败，请改用「上传」选择图片')
      }
    } finally {
      setCapturing(false)
    }
  }

  const handlePickImages = async (): Promise<void> => {
    if (shots.length >= FEEDBACK_MAX_SCREENSHOTS || submitting) return
    const picked = await window.electronAPI.feedbackPickImages()
    if (picked.length === 0) return
    setShots((prev) => [...prev, ...picked].slice(0, FEEDBACK_MAX_SCREENSHOTS))
  }

  const removeShot = (index: number): void => {
    setShots((prev) => prev.filter((_, i) => i !== index))
  }

  const openFeedbackSettings = (): void => {
    setOpen(false)
    setSettingsTab('feedback')
    setSettingsOpen(true)
  }

  const canSubmit =
    !submitting &&
    description.trim().length > 0 &&
    configured !== false

  const handleSubmit = async (): Promise<void> => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const result = await window.electronAPI.feedbackSubmit(
        {
          type,
          description: description.trim(),
          screenshots: shots.map((s) => s.filePath),
          contactEmail: contactEmail.trim() || undefined,
        },
        version,
        navigator.platform ?? 'unknown',
      )
      if (result.success) {
        toast.success('感谢你的反馈，已提交到 GitHub Issues')
        if (result.duplicate) toast.info('该反馈此前已提交过相同内容')
        if (result.screenshotsSkipped) toast.warning('部分截图上传失败，已按纯文字提交')
        setOpen(false)
        resetForm()
        void refreshDrafts()
      } else if (result.draftSaved) {
        toast.error(result.error ?? '提交失败，已保存草稿', { description: result.draftPath ? `草稿位置：${result.draftPath}` : undefined, duration: 8000 })
      } else {
        toast.error(result.error ?? '提交失败，请稍后重试')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-[#07120e]/55 backdrop-blur-[3px] titlebar-no-drag data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-[101] w-[92vw] max-w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border/60 bg-background p-0 shadow-[0_18px_50px_rgba(15,30,20,0.25)] outline-none',
            capturing && 'invisible',
          )}
        >
          {/* 标题栏 */}
          <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
            <DialogPrimitive.Title className="text-base font-semibold">反馈</DialogPrimitive.Title>
            <DialogPrimitive.Close
              onClick={handleClose}
              className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <X size={16} />
            </DialogPrimitive.Close>
          </div>

          <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
            {/* 类型选择 */}
            <div className="grid grid-cols-2 gap-2.5">
              {TYPE_OPTIONS.map((option) => {
                const Icon = option.icon
                const active = type === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setType(option.value)}
                    aria-pressed={active}
                    className={cn(
                      'flex flex-col items-start gap-1 rounded-xl border px-3.5 py-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                      active
                        ? 'border-primary/60 bg-primary/[0.07] text-primary'
                        : 'border-border/70 hover:bg-accent',
                    )}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      <Icon size={15} className={active ? 'text-primary' : 'text-muted-foreground'} />
                      {option.label}
                    </span>
                    <span className="text-xs text-muted-foreground">{option.hint}</span>
                  </button>
                )
              })}
            </div>

            {/* 详细描述 */}
            <div className="mt-4">
              <label htmlFor="feedback-description" className="mb-1.5 block text-sm font-medium">
                详细描述
              </label>
              <textarea
                id="feedback-description"
                value={description}
                maxLength={FEEDBACK_DESCRIPTION_MAX_LENGTH}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={PLACEHOLDERS[type]}
                rows={5}
                className="w-full resize-none rounded-xl border border-border/70 bg-background px-3 py-2.5 text-sm placeholder:text-muted-foreground/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
              <div className="mt-1 text-right text-xs text-muted-foreground">
                {description.length}/{FEEDBACK_DESCRIPTION_MAX_LENGTH}
              </div>
            </div>

            {/* 联系方式（可选） */}
            <div className="mt-2">
              {showContact ? (
                <div className="rounded-xl border border-border/70 px-3 py-2.5">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <Mail size={14} className="text-muted-foreground" />
                    联系方式（可选）
                  </div>
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    placeholder="便于追问复现细节（如 name@example.com）"
                    className="mt-1.5 w-full rounded-lg border border-border/70 bg-background px-2.5 py-1.5 text-sm placeholder:text-muted-foreground/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowContact(true)}
                  className="flex items-center gap-1.5 rounded-lg px-1 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus:outline-none"
                >
                  <Mail size={13} />
                  留下联系方式，便于回复（可选）
                </button>
              )}
            </div>

            {/* 截图 */}
            <div className="mt-4">
              <div className="mb-1.5 text-sm font-medium">
                截图（{shots.length}/{FEEDBACK_MAX_SCREENSHOTS}）
              </div>
              <div className="flex flex-wrap gap-2">
                {shots.map((shot, index) => (
                  <div key={shot.filePath} className="group relative">
                    <img
                      src={shot.dataUrl}
                      alt={`截图 ${index + 1}`}
                      className="h-16 w-16 rounded-lg border border-border/70 object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeShot(index)}
                      aria-label="删除截图"
                      className="absolute -right-1.5 -top-1.5 hidden size-5 items-center justify-center rounded-full border border-border/70 bg-background text-muted-foreground shadow-sm transition-colors hover:text-foreground group-hover:flex"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
                {shots.length < FEEDBACK_MAX_SCREENSHOTS && (
                  <>
                    <button
                      type="button"
                      onClick={handleCapture}
                      disabled={capturing || submitting}
                      className="flex size-16 flex-col items-center justify-center gap-1 rounded-lg border border-border/70 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                    >
                      {capturing ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
                      <span className="text-[10px]">{capturing ? '截图中' : '截屏'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handlePickImages}
                      disabled={submitting}
                      className="flex size-16 flex-col items-center justify-center gap-1 rounded-lg border border-border/70 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                    >
                      <ImagePlus size={16} />
                      <span className="text-[10px]">上传</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* 本地草稿 */}
            {drafts.length > 0 && (
              <div className="mt-4 rounded-xl border border-border/70 px-3 py-2.5">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <FileText size={14} className="text-muted-foreground" />
                  本地草稿（{drafts.length}）
                </div>
                <div className="mt-2 space-y-1.5">
                  {drafts.map((draft) => (
                    <div
                      key={draft.fileName}
                      className="flex items-center justify-between gap-2 rounded-lg bg-accent/40 px-2.5 py-1.5"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-xs text-foreground/80">
                          {draft.legacy ? '[旧格式] ' : ''}
                          {draft.input.type === 'bug' ? 'Bug' : '建议'}：{draft.input.description.slice(0, 30) || '（无描述）'}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {draft.createdAt.slice(0, 16).replace('T', ' ')}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {!draft.legacy && (
                          <button
                            type="button"
                            onClick={() => loadDraft(draft)}
                            className="rounded-lg border border-border/70 px-2 py-1 text-[11px] text-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
                          >
                            载入
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void removeDraft(draft.fileName)}
                          aria-label="删除草稿"
                          className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 未配置提示 */}
            {configured === false && (
              <div className="mt-4 flex items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2.5">
                <span className="text-xs text-muted-foreground">尚未配置 GitHub 凭证</span>
                <button
                  type="button"
                  onClick={openFeedbackSettings}
                  className="flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/15"
                >
                  <Settings2 size={12} />
                  去配置
                </button>
              </div>
            )}

            {/* 公开可见提示 */}
            <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2.5 text-xs text-foreground/70">
              提交后 issue 与截图将在 GitHub 上公开可见
            </div>
          </div>

          {/* 底部操作 */}
          <div className="flex items-center justify-end gap-2 border-t border-border/60 px-5 py-3.5">
            <button
              type="button"
              onClick={handleClose}
              disabled={submitting}
              className="rounded-lg border border-border/70 px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit || configured === null}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              {submitting ? '提交中...' : '提交反馈'}
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
