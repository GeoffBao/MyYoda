/**
 * ReleaseNotesPopover - 「更新日志与帮助」入口（参考 Codex 的 "What's new" 弹层）
 *
 * 独立的「?」图标按钮，比纯文本版本号更显眼；点击弹出：
 * - 最近几条更新日志（标题摘要 + 版本号），点击任意一条打开完整更新日志对话框
 * - 快捷链接：键盘快捷键地图
 *
 * 弹层展开即视为「已读」（对齐 Codex：打开列表就清红点，不需要再点进详情）；
 * 完整更新日志内容仍由 ReleaseNotesDialog 承载，此组件只负责摘要与入口。
 */

import * as React from 'react'
import { useSetAtom } from 'jotai'
import { HelpCircle, Keyboard, ChevronRight, CircleHelp, BookOpen, Sparkles, MessageSquareHeart } from 'lucide-react'
import { cn } from '@/lib/utils'
import { extractReleaseHeadline, type ReleaseNote } from '@myyoda/shared'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { ReleaseNotesDialog } from './ReleaseNotesDialog'
import { shortcutGuideOpenAtom } from '@/atoms/shortcut-guide'
import { faqDialogOpenAtom } from '@/atoms/faq-dialog'
import { feedbackDialogOpenAtom } from '@/atoms/feedback-dialog'

export interface ReleaseNotesPopoverProps {
  version: string
  unseen: boolean
  recentNotes: ReleaseNote[]
  onMarkSeen: () => void
  /** 触发按钮的额外 className（尺寸/圆角由调用方按折叠/展开场景控制） */
  triggerClassName: string
  tooltipSide: 'right' | 'top'
  side: 'right' | 'top'
  align: 'start' | 'center' | 'end'
  onOpenGuide?: () => void
}

export function ReleaseNotesPopover({
  version,
  unseen,
  recentNotes,
  onMarkSeen,
  triggerClassName,
  tooltipSide,
  side,
  align,
  onOpenGuide,
}: ReleaseNotesPopoverProps): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [fullDialogOpen, setFullDialogOpen] = React.useState(false)
  const [dialogInitialVersion, setDialogInitialVersion] = React.useState<string | undefined>(undefined)
  const setShortcutGuideOpen = useSetAtom(shortcutGuideOpenAtom)
  const setFaqDialogOpen = useSetAtom(faqDialogOpenAtom)
  const setFeedbackDialogOpen = useSetAtom(feedbackDialogOpenAtom)

  const handleOpenChange = (next: boolean): void => {
    setOpen(next)
    if (next) onMarkSeen()
  }

  /** 打开完整更新日志；传版本号时滚动定位到该版本，缺省从最新（顶部）开始 */
  const openFullChangelog = (version?: string): void => {
    setOpen(false)
    setDialogInitialVersion(version)
    setFullDialogOpen(true)
  }

  const handleOpenFullChangelog = (): void => {
    openFullChangelog()
  }

  const handleOpenShortcutGuide = (): void => {
    setOpen(false)
    setShortcutGuideOpen(true)
  }

  const handleOpenFaq = (): void => {
    setOpen(false)
    setFaqDialogOpen(true)
  }

  const handleOpenFeedback = (): void => {
    setOpen(false)
    setFeedbackDialogOpen(true)
  }

  return (
    <>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <Tooltip open={open ? false : undefined}>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="更新日志与帮助"
                className={cn('relative', triggerClassName)}
              >
                <HelpCircle size={16} strokeWidth={2} />
                {unseen && (
                  <span className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-primary ring-2 ring-background" />
                )}
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side={tooltipSide}>更新日志与帮助 · 当前 v{version}</TooltipContent>
        </Tooltip>
        <PopoverContent side={side} align={align} className="w-80 overflow-hidden rounded-2xl p-0 shadow-[0_18px_50px_rgba(15,30,20,0.16)]">
          <div className="border-b border-border/60 bg-[radial-gradient(circle_at_100%_0%,rgba(121,170,139,0.2),transparent_42%),hsl(var(--muted)/0.28)] px-4 pb-3 pt-3.5">
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary"><Sparkles size={14} /></span>
              <div className="min-w-0 flex-1"><p className="text-sm font-semibold">更新与帮助</p><p className="mt-0.5 text-[10px] text-muted-foreground">MyYoda v{version}</p></div>
              {unseen && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">有新内容</span>}
            </div>
          </div>
          <div className="px-2 pb-2 pt-2">
            <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">最新动态</div>
            {recentNotes.length === 0 ? (
              <p className="px-2 py-2 text-xs text-muted-foreground">暂无更新日志</p>
            ) : (
              recentNotes.map((note) => {
                const headline = extractReleaseHeadline(note.content) || `v${note.version} 更新`
                return (
                  <button
                    key={note.version}
                    type="button"
                    onClick={() => openFullChangelog(note.version)}
                    className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent focus:bg-accent focus:outline-none"
                  >
                    <span className="flex-1 min-w-0 truncate">{headline}</span>
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                      v{note.version}
                    </span>
                  </button>
                )
              })
            )}
            <button
              type="button"
              onClick={handleOpenFullChangelog}
              className="mt-1 flex w-full items-center justify-between rounded-xl bg-primary/[0.06] px-2.5 py-2 text-left text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus:bg-primary/10 focus:outline-none"
            >
              查看完整更新日志
              <ChevronRight size={14} className="shrink-0" />
            </button>
          </div>
          <div className="border-t border-border/60 bg-muted/15 p-2">
            <button
              type="button"
              onClick={handleOpenFeedback}
              className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent focus:bg-accent focus:outline-none"
            >
              <MessageSquareHeart size={15} className="shrink-0 text-primary" />
              意见反馈
              <span className="ml-auto text-[10px] text-muted-foreground">Bug 报告 / 功能建议</span>
            </button>
            {onOpenGuide && (
              <button
                type="button"
                onClick={() => { setOpen(false); onOpenGuide() }}
                className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent focus:bg-accent focus:outline-none"
              >
                <BookOpen size={15} className="shrink-0 text-primary" />
                使用指南
              </button>
            )}
            <button
              type="button"
              onClick={handleOpenFaq}
              className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent focus:bg-accent focus:outline-none"
            >
              <CircleHelp size={15} className="shrink-0 text-muted-foreground" />
              常见问题 FAQ
            </button>
            <button
              type="button"
              onClick={handleOpenShortcutGuide}
              className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent focus:bg-accent focus:outline-none"
            >
              <Keyboard size={15} className="shrink-0 text-muted-foreground" />
              键盘快捷键
            </button>
          </div>
        </PopoverContent>
      </Popover>
      <ReleaseNotesDialog
        open={fullDialogOpen}
        onOpenChange={setFullDialogOpen}
        initialVersion={dialogInitialVersion}
      />
    </>
  )
}
