import * as React from 'react'
import { Upload, Trash2, FileText } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { KanbanProject } from '@/components/app-shell/kanban/types'

interface ProjectAssetsTabProps {
  workspaceRoot: string
  project: KanbanProject
  onError: (message: string | null) => void
}

interface AssetInfo {
  filename: string
  size: number
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ProjectAssetsTab({ workspaceRoot, project, onError }: ProjectAssetsTabProps): React.ReactElement {
  const slug = project.slug
  const [assets, setAssets] = React.useState<AssetInfo[]>([])
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!slug) return
    window.electronAPI.projects.listAssets(workspaceRoot, slug)
      .then((list) => setAssets(list.map((a) => ({ filename: a.filename, size: a.sizeBytes }))))
      .catch(() => setAssets([]))
  }, [workspaceRoot, slug])

  const handleUpload = async (): Promise<void> => {
    if (!slug) return
    const file = await new Promise<File | null>((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.onchange = () => resolve(input.files?.[0] ?? null)
      input.click()
    })
    if (!file) return
    setBusy(true)
    try {
      const reader = new FileReader()
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve((reader.result as string).split(',')[1]!)
        reader.onerror = () => reject(new Error('读取文件失败'))
        reader.readAsDataURL(file)
      })
      const result = await window.electronAPI.projects.uploadAsset(workspaceRoot, slug, {
        filename: file.name,
        base64,
      })
      setAssets((prev) => [...prev, { filename: result.filename, size: file.size }])
      onError(null)
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause)
      onError(msg)
      toast.error('上传失败', { description: msg })
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (filename: string): Promise<void> => {
    if (!slug) return
    setBusy(true)
    try {
      await window.electronAPI.projects.deleteAsset(workspaceRoot, slug, filename)
      setAssets((prev) => prev.filter((a) => a.filename !== filename))
      onError(null)
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause)
      onError(msg)
      toast.error('删除失败', { description: msg })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 p-4">
      <div className="rounded-xl border border-border/40 bg-muted/20 p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Project Assets</h2>
            <p className="text-xs text-muted-foreground">项目文档、图片、设计稿等附件。</p>
          </div>
          <Button size="sm" disabled={busy} onClick={() => void handleUpload()}>
            <Upload className="mr-1 h-3.5 w-3.5" />
            上传
          </Button>
        </div>
        {assets.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">暂无附件</p>
        ) : (
          <div className="space-y-1">
            {assets.map((asset) => (
              <div key={asset.filename} className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-muted/50">
                <span className="flex items-center gap-2 text-sm">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  {asset.filename}
                  <span className="text-xs text-muted-foreground">{formatSize(asset.size)}</span>
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleDelete(asset.filename)}
                  className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
