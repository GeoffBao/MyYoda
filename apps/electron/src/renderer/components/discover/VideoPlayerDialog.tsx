/**
 * VideoPlayerDialog — 应用内视频播放器
 *
 * 播放策略：优先 discover-video:// 远程流式播放（主进程代理感知转发 + Range seek），
 * 流式失败时提供「下载后播放」兜底（下载到本地缓存后经 myyoda-file:// 播放）。
 */
import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Download, Loader2, RefreshCw, X } from 'lucide-react'
import { useAtomValue } from 'jotai'
import type { DiscoverContentItem } from '@myyoda/shared'
import { videoDownloadStatesAtom } from '@/atoms/discover-atoms'

export interface VideoPlayerDialogProps {
  item: DiscoverContentItem
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 兜底：下载视频到本地缓存并返回文件路径 */
  downloadAndGetPath: (item: DiscoverContentItem) => Promise<string>
}

export function VideoPlayerDialog({
  item,
  open,
  onOpenChange,
  downloadAndGetPath,
}: VideoPlayerDialogProps): React.ReactElement {
  const videoStates = useAtomValue(videoDownloadStatesAtom)
  const [streamUrl, setStreamUrl] = React.useState<string | null>(null)
  const [localUrl, setLocalUrl] = React.useState<string | null>(null)
  const [streamFailed, setStreamFailed] = React.useState(false)
  const [downloading, setDownloading] = React.useState(false)
  const [fallbackError, setFallbackError] = React.useState<string | null>(null)

  const video = item.video

  // 打开时重置并注册远程流 URL
  React.useEffect(() => {
    if (!open) {
      setStreamUrl(null)
      setLocalUrl(null)
      setStreamFailed(false)
      setDownloading(false)
      setFallbackError(null)
      return
    }
    if (!video) return
    let cancelled = false
    window.electronAPI
      .discoverGetVideoStreamUrl(video.url)
      .then((url) => {
        if (!cancelled) setStreamUrl(url)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          console.warn('[VideoPlayerDialog] 流式 URL 注册失败:', err)
          setStreamFailed(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [open, video])

  const handleDownloadFallback = React.useCallback(async (): Promise<void> => {
    if (downloading) return
    setDownloading(true)
    setFallbackError(null)
    try {
      const filePath = await downloadAndGetPath(item)
      const url = await window.electronAPI.discoverGetVideoUrl(filePath)
      setLocalUrl(url)
    } catch (err) {
      setFallbackError(err instanceof Error ? err.message : '下载失败，请稍后重试')
    } finally {
      setDownloading(false)
    }
  }, [downloading, downloadAndGetPath, item])

  const downloadState = videoStates.get(item.id)
  const downloadProgress = downloadState?.status === 'downloading' ? downloadState.progress : 0
  const effectiveSrc = localUrl ?? streamUrl

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
            {effectiveSrc ? (
              <video
                key={effectiveSrc}
                controls
                autoPlay
                src={effectiveSrc}
                onError={() => {
                  if (!localUrl) {
                    // 流式播放失败（本地播放失败时无兜底，直接标记）
                    setStreamFailed(true)
                    setStreamUrl(null)
                  }
                }}
                className="max-h-[70vh] w-full rounded-lg"
              />
            ) : downloading ? (
              <div className="flex flex-col items-center gap-3 px-6 py-16 text-sm text-foreground/60">
                <Loader2 size={16} className="animate-spin" />
                <span>正在下载到本地... {Math.round(downloadProgress * 100)}%</span>
              </div>
            ) : streamFailed ? (
              <div className="flex flex-col items-center gap-4 px-6 py-16">
                <div className="text-sm text-foreground/70">在线播放失败</div>
                {fallbackError && <div className="max-w-sm text-center text-xs text-foreground/45">{fallbackError}</div>}
                <button
                  type="button"
                  onClick={() => void handleDownloadFallback()}
                  disabled={downloading}
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {downloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                  {downloading ? '下载中...' : '下载后播放'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStreamFailed(false)
                    setStreamUrl(null)
                    if (video) {
                      window.electronAPI
                        .discoverGetVideoStreamUrl(video.url)
                        .then(setStreamUrl)
                        .catch(() => setStreamFailed(true))
                    }
                  }}
                  className="flex items-center gap-1.5 text-xs text-foreground/45 transition-colors hover:text-foreground/70"
                >
                  <RefreshCw size={12} />
                  重试在线播放
                </button>
              </div>
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
