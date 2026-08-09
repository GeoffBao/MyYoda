/**
 * ReleaseNotesDialog - 通用「更新日志」对话框
 *
 * 展示本地化版本历史的合并 Markdown（完全离线）。空态页、左侧边栏版本号入口
 * 共用。打开时自动将最新版本标记为已读（清除未读红点）。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { ReleaseNoteMarkdown } from './ReleaseNoteMarkdown'
import { lastSeenReleaseVersionAtom } from '@/atoms/release-notes-atoms'

export interface ReleaseNotesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 打开后滚动定位到指定版本（如 "0.7.2"）；缺省时停留在最新版本（顶部） */
  initialVersion?: string
}

export function ReleaseNotesDialog({
  open,
  onOpenChange,
  initialVersion,
}: ReleaseNotesDialogProps): React.ReactElement {
  const [content, setContent] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const setLastSeen = useSetAtom(lastSeenReleaseVersionAtom)

  // 打开时加载合并版本历史，并标记最新版本为已读
  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    setContent(null)
    setError(null)
    window.electronAPI.getCombinedReleaseNotes().then((text) => {
      if (cancelled) return
      setContent(text)
    }).catch((err) => {
      console.error('[更新日志] 加载失败:', err)
      if (!cancelled) setError('加载失败，请稍后重试')
    })
    // 标记已读最新版本
    window.electronAPI.getLatestReleaseVersion().then((latest) => {
      if (latest) setLastSeen(latest)
    }).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open, setLastSeen])

  // 合并内容渲染完成后，滚动定位到指定版本标题（# MyYoda vX.Y.Z 更新 / # vX.Y.Z）
  React.useEffect(() => {
    if (!open || !content || !initialVersion || !contentRef.current) return
    const versionPattern = new RegExp(`v${escapeRegExp(initialVersion)}(?![\d.])`)
    const headings = Array.from(contentRef.current.querySelectorAll('h1, h2'))
    const target = headings.find((h) => versionPattern.test(h.textContent ?? ''))
    if (target) {
      requestAnimationFrame(() => {
        ;(target as HTMLElement).scrollIntoView({ block: 'start' })
      })
    }
  }, [open, content, initialVersion])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[70vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>更新日志</DialogTitle>
          <DialogDescription>MyYoda 各版本更新内容</DialogDescription>
        </DialogHeader>
        {content === null && !error ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在加载更新日志...
          </p>
        ) : error ? (
          <p className="text-sm text-muted-foreground">{error}</p>
        ) : content ? (
          <div ref={contentRef}>
            <ReleaseNoteMarkdown content={content} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">暂无更新日志</p>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** 转义正则特殊字符 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
