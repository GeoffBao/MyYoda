/**
 * VideoPlayerDialog — 应用内视频播放器（本地缓存文件经 myyoda-file:// 协议加载，支持 seek）
 */
import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Loader2, X } from 'lucide-react'
import type { DiscoverContentItem } from '@myyoda/shared'

export interface VideoPlayerDialogProps {
  item: DiscoverContentItem
  filePath: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function VideoPlayerDialog({
  item,
  filePath,
  open,
  onOpenChange,
}: VideoPlayerDialogProps): React.ReactElement {
  const [videoUrl, setVideoUrl] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) {
      setVideoUrl(null)
      setError(null)
      return
    }
    let cancelled = false
    setError(null)
    window.electronAPI
      .discoverGetVideoUrl(filePath)
      .then((url) => {
        if (!cancelled) setVideoUrl(url)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '视频加载失败')
      })
    return () => {
      cancelled = true
    }
  }, [open, filePath])

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-[#07120e]/70 backdrop-blur-[3px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-[101] w-[92vw] max-w-[960px] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-background p-0 shadow-[0_18px_50px_rgba(15,30,20,0.35)] outline-none">
          <div className="flex items-center justify-between border-b border-border/60 px-5 py-3.5">
            <DialogPrimitive.Title className="text-sm font-semibold">{item.title}</DialogPrimitive.Title>
            <DialogPrimitive.Close className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none">
              <X size={16} />
            </DialogPrimitive.Close>
          </div>
          <div className="flex items-center justify-center bg-black/95 p-4">
            {error ? (
              <div className="px-6 py-16 text-sm text-foreground/60">{error}</div>
            ) : videoUrl ? (
              <video
                key={videoUrl}
                controls
                autoPlay
                src={videoUrl}
                className="max-h-[70vh] w-full rounded-lg"
              />
            ) : (
              <div className="flex items-center gap-2 px-6 py-16 text-sm text-foreground/60">
                <Loader2 size={16} className="animate-spin" />
                正在加载视频...
              </div>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
