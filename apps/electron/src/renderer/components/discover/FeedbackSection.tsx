/**
 * FeedbackSection — 「发现」面板的反馈分区
 *
 * 复用现有 Notion 反馈弹窗：引导卡片 + 打开按钮。
 */
import * as React from 'react'
import { useSetAtom } from 'jotai'
import { Bug, Lightbulb, MessageSquarePlus } from 'lucide-react'
import { feedbackDialogOpenAtom } from '@/atoms/feedback-dialog'

export function FeedbackSection(): React.ReactElement {
  const setFeedbackOpen = useSetAtom(feedbackDialogOpenAtom)

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-border/60 bg-content-area p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.04] text-foreground/60">
            <MessageSquarePlus size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[14.5px] font-medium text-foreground/90">告诉我们你的想法</div>
            <div className="mt-1 text-[12.5px] leading-relaxed text-foreground/50">
              遇到问题或有好主意？反馈会直接进入我们的 Notion 数据库，附上截图和联系方式会帮助我们更快定位。
            </div>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFeedbackOpen(true)}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Bug size={13} />
            提交反馈
          </button>
          <span className="text-[11px] text-foreground/40">支持 Bug 报告与功能建议两种类型</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-border/60 bg-content-area p-4 shadow-sm">
          <div className="flex items-center gap-2 text-[12.5px] font-medium text-foreground/80">
            <Bug size={14} className="text-foreground/45" />
            Bug 报告
          </div>
          <div className="mt-1.5 text-[11.5px] leading-relaxed text-foreground/45">
            描述问题与复现步骤，最多可附 5 张截图（截屏或上传）。
          </div>
        </div>
        <div className="rounded-xl border border-border/60 bg-content-area p-4 shadow-sm">
          <div className="flex items-center gap-2 text-[12.5px] font-medium text-foreground/80">
            <Lightbulb size={14} className="text-foreground/45" />
            功能建议
          </div>
          <div className="mt-1.5 text-[11.5px] leading-relaxed text-foreground/45">
            分享你对「发现」面板或其他功能的任何想法。
          </div>
        </div>
      </div>
    </div>
  )
}
