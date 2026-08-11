/**
 * ExcalidrawGallery - 画板画廊页
 *
 * 列出当前 Workspace 下所有 .excalidraw 文件，以卡片网格展示，
 * 每个卡片包含 SVG 缩略图、标题、元素计数。
 */

import * as React from 'react'
import { PenTool, Plus, AlertCircle, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { activeViewAtom } from '@/atoms/active-view'
import { currentAgentWorkspaceIdAtom, agentWorkspacesAtom } from '@/atoms/agent-atoms'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

interface ExcalidrawFileMeta {
  slug: string
  title: string
  elementCount: number
  background: string
  mtime: number
  error?: boolean
  /** 缩略图用的精简元素快照（来自 LIST 阶段，已服务端截断到前 200 个） */
  elements?: unknown[]
}

/**
 * .excalidraw 文件是普通磁盘文件，颜色字段可能被外部同步/损坏/被诱导写入而带上恶意内容。
 * 缩略图会把这些值直接拼进 SVG 属性字符串并用 dangerouslySetInnerHTML 渲染，
 * 因此在拼接前做严格白名单校验，非法值一律回退默认色，防止属性逃逸注入。
 */
const SAFE_SVG_COLOR = /^(#[0-9a-fA-F]{3,8}|transparent|none|[a-zA-Z]+)$/

function sanitizeSvgColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && SAFE_SVG_COLOR.test(value) ? value : fallback
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins} 分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return new Date(ms).toLocaleDateString('zh-CN')
}

/**
 * SVG 缩略图生成器（前端版）
 *
 * 在渲染进程中实时计算 SVG 缩略图，避免额外 IPC 调用。
 * 只渲染矢量形状（矩形/椭圆/菱形/箭头/文字占位），不渲染嵌入图片。
 */
function buildThumbnailSvg(
  elements: unknown[],
  background: string,
): string {
  const W = 260
  const H = 160
  const PAD = 12
  const safeBackground = sanitizeSvgColor(background, '#ffffff')

  if (!elements || elements.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${safeBackground}"/><text x="${W / 2}" y="${H / 2 + 5}" text-anchor="middle" font-size="12" fill="#ccc" font-family="sans-serif">empty</text></svg>`
  }

  // 只取前 200 个元素计算包围盒，避免性能问题
  const sample = elements.slice(0, 200)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const el of sample) {
    const e = el as Record<string, unknown>
    if (e.type === 'arrow' || e.type === 'line') {
      const points = (e.points as Array<[number, number]>) || [[0, 0]]
      for (const [px, py] of points) {
        minX = Math.min(minX, (e.x as number) + px)
        minY = Math.min(minY, (e.y as number) + py)
        maxX = Math.max(maxX, (e.x as number) + px)
        maxY = Math.max(maxY, (e.y as number) + py)
      }
    } else if (e.x !== undefined) {
      minX = Math.min(minX, e.x as number)
      minY = Math.min(minY, e.y as number)
      maxX = Math.max(maxX, (e.x as number) + ((e.width as number) || 0))
      maxY = Math.max(maxY, (e.y as number) + ((e.height as number) || 0))
    }
  }

  if (!isFinite(minX)) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${safeBackground}"/></svg>`
  }

  const bw = maxX - minX || 1
  const bh = maxY - minY || 1
  const scale = Math.min((W - PAD * 2) / bw, (H - PAD * 2) / bh)
  const ox = PAD + ((W - PAD * 2) - bw * scale) / 2 - minX * scale
  const oy = PAD + ((H - PAD * 2) - bh * scale) / 2 - minY * scale

  const shapes: string[] = []
  for (const el of sample.slice(0, 50)) {
    const e = el as Record<string, unknown>
    const x = (e.x as number) * scale + ox
    const y = (e.y as number) * scale + oy
    const w = ((e.width as number) || 40) * scale
    const h = ((e.height as number) || 40) * scale
    const fill =
      e.backgroundColor && e.backgroundColor !== 'transparent'
        ? sanitizeSvgColor(e.backgroundColor, 'none')
        : 'none'
    const stroke = sanitizeSvgColor(e.strokeColor, '#1c1c1c')
    const sw = Math.max(0.5, ((e.strokeWidth as number) || 1) * scale * 0.5).toFixed(1)

    switch (e.type) {
      case 'rectangle':
      case 'frame':
        shapes.push(
          `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" rx="1"/>`,
        )
        break
      case 'ellipse':
        shapes.push(
          `<ellipse cx="${(x + w / 2).toFixed(1)}" cy="${(y + h / 2).toFixed(1)}" rx="${(w / 2).toFixed(1)}" ry="${(h / 2).toFixed(1)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`,
        )
        break
      case 'diamond': {
        const cx = (x + w / 2).toFixed(1)
        const cy = (y + h / 2).toFixed(1)
        shapes.push(
          `<polygon points="${cx},${y.toFixed(1)} ${(x + w).toFixed(1)},${cy} ${cx},${(y + h).toFixed(1)} ${x.toFixed(1)},${cy}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`,
        )
        break
      }
      case 'text':
        if (w > 2) {
          shapes.push(
            `<rect x="${x.toFixed(1)}" y="${(y + h * 0.3).toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(1, h * 0.2).toFixed(1)}" fill="${stroke}" opacity="0.35" rx="1"/>`,
          )
        }
        break
      case 'line':
      case 'arrow': {
        const pts = (e.points as Array<[number, number]>) || [
          [0, 0],
          [(e.width as number) || 40, (e.height as number) || 0],
        ]
        const first = pts[0]
        const last = pts[pts.length - 1]
        if (pts.length >= 2 && first && last) {
          const x1 = ((e.x as number) + first[0]) * scale + ox
          const y1 = ((e.y as number) + first[1]) * scale + oy
          const x2 = ((e.x as number) + last[0]) * scale + ox
          const y2 = ((e.y as number) + last[1]) * scale + oy
          shapes.push(
            `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${stroke}" stroke-width="${sw}"/>`,
          )
        }
        break
      }
      case 'image':
        // 不渲染真实图片（避免解码内嵌 base64 的开销），画一个占位框 + 斜线示意，
        // 避免以贴图为主的画布缩略图变成一大片空白。
        shapes.push(
          `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="#f0f0f0" stroke="#d4d4d4" stroke-width="1" rx="1"/>` +
          `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x + w).toFixed(1)}" y2="${(y + h).toFixed(1)}" stroke="#d4d4d4" stroke-width="1"/>` +
          `<line x1="${(x + w).toFixed(1)}" y1="${y.toFixed(1)}" x2="${x.toFixed(1)}" y2="${(y + h).toFixed(1)}" stroke="#d4d4d4" stroke-width="1"/>`,
        )
        break
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${safeBackground}"/>${shapes.join('')}</svg>`
}

export function ExcalidrawGallery(): React.ReactElement {
  const setActiveView = useSetAtom(activeViewAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const [files, setFiles] = React.useState<ExcalidrawFileMeta[]>([])
  const [loading, setLoading] = React.useState(true)
  // 重命名：卡片标题原地变输入框（对齐 TaskTile.tsx / AgentSessionItem.tsx 的既有约定），
  // 而不是弹一个居中模态框——两者都是从右键菜单「重命名」触发。
  const [renamingSlug, setRenamingSlug] = React.useState<string | null>(null)
  const [renameDraft, setRenameDraft] = React.useState('')
  const renameInputRef = React.useRef<HTMLInputElement>(null)
  const justStartedRenamingRef = React.useRef(false)
  const renameFocusTimestampRef = React.useRef(0)
  const [deleteTarget, setDeleteTarget] = React.useState<ExcalidrawFileMeta | null>(null)

  const workspaceSlug = React.useMemo(() => {
    if (!currentWorkspaceId) return null
    return workspaces.find((w) => w.id === currentWorkspaceId)?.slug ?? null
  }, [currentWorkspaceId, workspaces])

  // 加载文件列表
  React.useEffect(() => {
    if (!workspaceSlug) {
      setFiles([])
      setLoading(false)
      return
    }

    setLoading(true)
    window.electronAPI
      .listExcalidrawFiles(workspaceSlug)
      .then((list) => setFiles(list))
      .catch((err) => console.error('[ExcalidrawGallery] 加载失败:', err))
      .finally(() => setLoading(false))
  }, [workspaceSlug])

  // 生成缩略图：直接复用 LIST 阶段已返回的精简 elements 快照，纯同步计算，
  // 不再对每个文件重复发起一次 READ + JSON.parse（此前的性能隐患，见 buildThumbnailSvg 调用点历史）。
  const thumbnails = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const file of files) {
      map.set(file.slug, buildThumbnailSvg(file.elements ?? [], file.background))
    }
    return map
  }, [files])

  // 新建画布
  const handleCreate = React.useCallback(async () => {
    console.log('[ExcalidrawGallery] handleCreate, workspaceSlug:', workspaceSlug)
    if (!workspaceSlug) {
      toast.warning('请先选择一个工作区')
      return
    }
    try {
      // 自动后缀避免重名
      let title = `画布 ${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}`
      const existingTitles = new Set(files.map((f) => f.title))
      if (existingTitles.has(title)) {
        let i = 1
        while (existingTitles.has(`${title} (${i})`)) i++
        title = `${title} (${i})`
      }
      const { slug } = await window.electronAPI.createExcalidrawFile(
        workspaceSlug,
        title,
      )
      console.log('[ExcalidrawGallery] created file, slug:', slug)
      // 刷新列表
      const list = await window.electronAPI.listExcalidrawFiles(workspaceSlug)
      setFiles(list)
      // 直接跳转编辑器
      sessionStorage.setItem('excalidraw:editingSlug', slug)
      setActiveView('excalidraw-editor')
    } catch (err) {
      console.error('[ExcalidrawGallery] 新建失败:', err)
      toast.error(`新建失败: ${err instanceof Error ? err.message : '未知错误'}`)
    }
  }, [workspaceSlug, setActiveView])

  // 打开已有画布
  const handleOpen = React.useCallback(
    (fileSlug: string) => {
      sessionStorage.setItem('excalidraw:editingSlug', fileSlug)
      setActiveView('excalidraw-editor')
    },
    [setActiveView],
  )

  // 重命名：右键「重命名」触发，卡片标题原地变输入框
  // ContextMenuItem 使用 Radix onSelect，回调触发时菜单已关闭。
  // 但 Radix 内部焦点恢复可能用 rAF 延迟执行，与我们的 focus 形成竞态。
  // 双 rAF 保证：无论 Radix 在 onSelect 前还是后注册自己的 rAF，
  // 我们的 focus 永远在最后一帧执行，不会被覆盖。
  const startRename = React.useCallback((file: ExcalidrawFileMeta) => {
    setRenameDraft(file.title)
    setRenamingSlug(file.slug)
    justStartedRenamingRef.current = true
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        justStartedRenamingRef.current = false
        renameFocusTimestampRef.current = Date.now()
        renameInputRef.current?.focus()
        renameInputRef.current?.select()
      })
    })
  }, [])

  const saveRename = React.useCallback(async () => {
    // 防护 1：startRename 刚触发，justStartedRenamingRef 还是 true
    if (justStartedRenamingRef.current || !renamingSlug) return
    // 防护 2：程序化 focus 后 200ms 内忽略 blur，
    // 防止 Radix 残余焦点事件在双 rAF 之后仍然触发 onBlur
    if (Date.now() - renameFocusTimestampRef.current < 200) return
    const slug = renamingSlug
    const current = files.find((f) => f.slug === slug)
    const trimmed = renameDraft.trim()
    setRenamingSlug(null)
    if (!workspaceSlug || !trimmed || !current || trimmed === current.title) return
    try {
      const result = await window.electronAPI.renameExcalidrawFile(workspaceSlug, slug, trimmed)
      setFiles((prev) =>
        prev.map((f) => (f.slug === slug ? { ...f, title: result.title, slug: result.slug } : f)),
      )
      toast.success('已重命名')
    } catch (err) {
      toast.error(`重命名失败: ${err instanceof Error ? err.message : '未知错误'}`)
    }
  }, [workspaceSlug, renamingSlug, renameDraft, files])

  const handleRenameKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void saveRename()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setRenamingSlug(null)
    }
  }, [saveRename])

  // 删除
  const handleDeleteConfirm = React.useCallback(async () => {
    if (!workspaceSlug || !deleteTarget) return
    try {
      await window.electronAPI.deleteExcalidrawFile(workspaceSlug, deleteTarget.slug)
      setFiles((prev) => prev.filter((f) => f.slug !== deleteTarget.slug))
      toast.success('已删除')
    } catch (err) {
      toast.error(`删除失败: ${err instanceof Error ? err.message : '未知错误'}`)
    } finally {
      setDeleteTarget(null)
    }
  }, [workspaceSlug, deleteTarget])

  if (!workspaceSlug) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-foreground/40 gap-3">
        <PenTool size={40} strokeWidth={1} />
        <p className="text-[14px]">请先选择一个工作区</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* 顶部栏：pt-14 让内容整体让到 AppShell 全局 drag 层（0–50px, z-50）下方，
          同时避免与 Windows 自定义 WindowControls（fixed 右上角）视觉重叠，
          四个模块页面统一此规范。 */}
      <div className="titlebar-no-drag flex items-center justify-between px-5 pb-3 pt-14 border-b border-border/50">
        <div className="flex items-center gap-2.5">
          <PenTool className="size-6 text-foreground/70" />
          <h1 className="text-2xl font-semibold text-foreground">Excalidraw 画布</h1>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          onClick={handleCreate}
        >
          <Plus size={14} />
          新建画布
        </button>
      </div>

      {/* 内容区 */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-foreground/30 text-[14px]">
          加载中…
        </div>
      ) : files.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-foreground/40 gap-4">
          <PenTool size={48} strokeWidth={1} />
          <p className="text-[14px]">暂无画布，点击上方「新建画布」开始创作</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {files.map((file) => (
              <ContextMenu key={file.slug}>
                <ContextMenuTrigger asChild>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={`打开画布：${file.title || '未命名'}`}
                    className="group flex flex-col rounded-lg border border-border/50 bg-card hover:border-primary/40 hover:shadow-sm transition-[border-color,box-shadow,transform] duration-fast text-left overflow-hidden cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => {
                      if (renamingSlug !== file.slug) handleOpen(file.slug)
                    }}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
                      event.preventDefault()
                      handleOpen(file.slug)
                    }}
                  >
                    {/* 缩略图 */}
                    <div className="relative w-full aspect-[13/8] bg-[#f8f8f8] dark:bg-[#1a1a1a] overflow-hidden">
                      {thumbnails.has(file.slug) ? (
                        <div
                          className="w-full h-full"
                          dangerouslySetInnerHTML={{ __html: thumbnails.get(file.slug)! }}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <PenTool size={24} className="text-foreground/15" />
                        </div>
                      )}
                      {file.error && (
                        <div className="absolute top-2 left-2 text-amber-500" title="文件可能损坏">
                          <AlertCircle size={14} />
                        </div>
                      )}
                      {/* 悬浮操作按钮：与右键菜单共享同一份「打开/重命名/删除」，
                          避免删除/重命名只能靠右键发现（对齐 TaskTile.tsx 的双入口约定）。*/}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            title="画布操作"
                            aria-label="画布操作"
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => event.stopPropagation()}
                            className="absolute top-2 right-2 grid size-7 place-items-center rounded-md border border-border/60 bg-background/90 text-foreground/60 opacity-0 shadow-sm backdrop-blur-sm transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
                          >
                            <MoreHorizontal size={14} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40 z-[9999]" onClick={(event) => event.stopPropagation()}>
                          <DropdownMenuItem onSelect={() => handleOpen(file.slug)}>
                            <PenTool size={13} className="mr-2" />
                            打开
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => startRename(file)}>
                            <Pencil size={13} className="mr-2" />
                            重命名
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() => setDeleteTarget(file)}
                          >
                            <Trash2 size={13} className="mr-2" />
                            删除
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    {/* 信息 */}
                    <div className="px-3 py-2.5 flex flex-col gap-0.5">
                      {renamingSlug === file.slug ? (
                        <input
                          ref={renameInputRef}
                          value={renameDraft}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) => setRenameDraft(event.target.value)}
                          onBlur={() => void saveRename()}
                          onKeyDown={handleRenameKeyDown}
                          className="w-full rounded border border-border bg-background px-1 py-0.5 text-[13px] font-medium leading-5 outline-none ring-1 ring-ring"
                        />
                      ) : (
                        <span className="text-[13px] font-medium text-foreground truncate group-hover:text-primary transition-colors">
                          {file.title || '未命名'}
                        </span>
                      )}
                      <span className="text-[11px] text-foreground/40">
                        {file.elementCount} 个元素 · {relativeTime(file.mtime)}
                      </span>
                    </div>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-40 z-[9999]">
                  <ContextMenuItem onSelect={() => handleOpen(file.slug)}>
                    <PenTool size={13} className="mr-2" />
                    打开
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => startRename(file)}>
                    <Pencil size={13} className="mr-2" />
                    重命名
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => setDeleteTarget(file)}
                  >
                    <Trash2 size={13} className="mr-2" />
                    删除
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </div>
        </div>
      )}

      {/* 删除确认对话框 */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除画布</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除「{deleteTarget?.title}」吗？此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
