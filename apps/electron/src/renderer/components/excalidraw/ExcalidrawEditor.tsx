/**
 * ExcalidrawEditor - 全功能画板编辑器
 *
 * 集成 @excalidraw/excalidraw React 组件，支持：
 * - 从 IPC 加载/保存 .excalidraw 文件
 * - 60 秒自动保存
 * - Cmd/Ctrl+S 手动保存
 * - 标题编辑
 */

import * as React from 'react'
import { ArrowLeft, PenTool, Loader2, X } from 'lucide-react'
import { useAtomValue, useSetAtom } from 'jotai'
import { activeViewAtom } from '@/atoms/active-view'
import { currentAgentWorkspaceIdAtom, agentWorkspacesAtom } from '@/atoms/agent-atoms'

/** Excalidraw imperative API 类型（内联定义以避免额外的类型导入） */
interface ExcalidrawImperativeAPI {
  getSceneElements: () => readonly Record<string, unknown>[]
  getAppState: () => Record<string, unknown>
  getFiles: () => Record<string, { dataURL: string; mimeType: string; id: string; created?: number }>
}

// Lazy load the heavy Excalidraw component
const Excalidraw = React.lazy(() =>
  import('@excalidraw/excalidraw').then((m) => ({ default: m.Excalidraw })),
)

export interface ExcalidrawEditorProps {
  /** 受控模式：直接指定要打开的 slug（null = 全新未命名画布）。
   *  不传（undefined）= 非受控，沿用 sessionStorage 'excalidraw:editingSlug' 的老行为。 */
  controlledSlug?: string | null
  /** 受控模式下点击"返回/关闭"按钮时调用；不传则沿用 setActiveView('excalidraw-gallery') 老行为。 */
  onExit?: () => void
  /** 首次创建成功或重命名后，把最新 slug/title 同步给外部（面板模式用于写回 canvasFileMapAtom）。 */
  onSlugChange?: (ref: { slug: string; title: string }) => void
  /** 面板模式下额外展示"浏览全部画布"入口，点击调用。不传则不展示该按钮。 */
  onBrowseAll?: () => void
}

export function ExcalidrawEditor({
  controlledSlug,
  onExit,
  onSlugChange,
  onBrowseAll,
}: ExcalidrawEditorProps = {}): React.ReactElement {
  const setActiveView = useSetAtom(activeViewAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)

  const workspaceSlug = React.useMemo(() => {
    if (!currentWorkspaceId) return null
    return workspaces.find((w) => w.id === currentWorkspaceId)?.slug ?? null
  }, [currentWorkspaceId, workspaces])

  const [slug, setSlug] = React.useState<string | null>(null)
  const [title, setTitle] = React.useState('未命名画布')
  const [initialData, setInitialData] = React.useState<{
    elements: Record<string, unknown>[]
    appState: Record<string, unknown>
    files: Record<string, unknown>
  } | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [saveStatus, setSaveStatus] = React.useState('')
  const [isNew, setIsNew] = React.useState(true)

  const excalidrawRef = React.useRef<ExcalidrawImperativeAPI | null>(null)
  // onChange 每次都把最新场景快照缓存在这里，作为"取当前画布数据"的唯一来源，
  // 不再临时调用 excalidrawRef.current.getXXX()——组件卸载时 React 通常会先卸载
  // 子组件（<Excalidraw> 本身）再跑父组件的 cleanup，届时它的命令式 API 是否还能正确
  // 返回数据没有保证；退出时的兜底保存如果读到空/过期数据，等于"保存了个寂寞"，
  // 表现出来就是"编辑后不保存退出，数据丢失"。
  const latestSceneRef = React.useRef<{
    elements: unknown[]
    appState: Record<string, unknown>
    files: Record<string, unknown>
  } | null>(null)
  const autoSaveTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null)
  const statusTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  // Store handler ref to avoid stale closures
  const handleSaveRef = React.useRef<(auto: boolean) => Promise<void>>(async () => {})
  const flushSaveSyncRef = React.useRef<() => void>(() => {})
  // 距上次成功保存以来是否有未保存的编辑；驱动"是否需要在离开/自动保存时 flush"
  const dirtyRef = React.useRef(false)
  // Excalidraw 应用 initialData 时也会触发一次 onChange，跳过这一次避免"刚打开就被标记为已编辑"
  const skippedInitialChangeRef = React.useRef(false)
  // 已有画布加载时的真实标题（来自文件名，未经 slug 归一化），用于判断标题输入框是否需要落盘重命名
  const loadedTitleRef = React.useRef<string | null>(null)

  // 加载数据
  React.useEffect(() => {
    if (!workspaceSlug) return

    // 受控模式：controlledSlug !== undefined 时，直接用它，不读 sessionStorage。
    const editingSlug = controlledSlug !== undefined ? controlledSlug : sessionStorage.getItem('excalidraw:editingSlug')
    if (!editingSlug) {
      setLoading(false)
      setIsNew(true)
      return
    }

    setSlug(editingSlug)
    if (controlledSlug === undefined) sessionStorage.removeItem('excalidraw:editingSlug')

    window.electronAPI
      .readExcalidrawFile(workspaceSlug, editingSlug)
      .then((data) => {
        if (data) {
          setIsNew(false)
          const realTitle = data.title || editingSlug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
          setTitle(realTitle)
          loadedTitleRef.current = realTitle
          setInitialData({
            elements: (data.elements || []) as Record<string, unknown>[],
            appState: (data.appState as Record<string, unknown>) || { viewBackgroundColor: '#ffffff' },
            files: (data.files as Record<string, unknown>) || {},
          })
        }
      })
      .catch((err) => console.error('[ExcalidrawEditor] 加载失败:', err))
      .finally(() => setLoading(false))
    // controlledSlug 有意不放进依赖数组：受控模式只在挂载时按初始 slug 加载一次；
    // CanvasPanel 会通过 key 切换会话时重新挂载，保持与现有 ExcalidrawView 约定一致。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceSlug])

  function showStatus(msg: string, autoClear = true): void {
    setSaveStatus(msg)
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
    if (autoClear) {
      statusTimerRef.current = setTimeout(() => setSaveStatus(''), 3000)
    }
  }

  /**
   * 取当前画布数据：优先用 onChange 缓存的最新快照（任何时候都可靠，包括组件正在卸载时）；
   * 只有连一次 onChange 都还没发生过（比如打开已有文件后完全没编辑就点保存）才回退到
   * 命令式 API 现查，此时组件必然还是挂载状态，调用是安全的。
   */
  function getCurrentScene(): { elements: unknown[]; appState: Record<string, unknown>; files: Record<string, unknown> } | null {
    if (latestSceneRef.current) return latestSceneRef.current
    if (excalidrawRef.current) {
      return {
        elements: excalidrawRef.current.getSceneElements() as unknown[],
        appState: excalidrawRef.current.getAppState(),
        files: excalidrawRef.current.getFiles() as unknown as Record<string, unknown>,
      }
    }
    return null
  }

  async function handleSave(auto: boolean): Promise<void> {
    if (!workspaceSlug) return
    const scene = getCurrentScene()
    if (!scene) return
    const { elements, appState, files } = scene

    setSaving(true)

    try {
      let currentSlug = slug
      const trimmedTitle = title.trim() || '未命名画布'

      if (isNew || !currentSlug) {
        const result = await window.electronAPI.createExcalidrawFile(workspaceSlug, trimmedTitle)
        currentSlug = result.slug
        setSlug(result.slug)
        setIsNew(false)
        loadedTitleRef.current = result.title
        // CREATE 可能因重名自动加了 " (n)" 后缀，实际落盘标题会和输入框里的原始文字不同。
        // 必须把这个真实标题同步回 UI，否则下一次保存会拿"输入框里的旧标题"跟
        // loadedTitleRef 比对，永远判定为"标题变了"，进而尝试 rename 到一个已被占用的
        // 文件名而报错——保存直接失败，且此后每次保存都会重复触发（真实复现过的 bug）。
        setTitle(result.title)
        onSlugChange?.({ slug: result.slug, title: result.title })
      } else if (trimmedTitle !== loadedTitleRef.current) {
        // 标题输入框相对已加载的真实标题有改动：落盘重命名，而不是让它只是个从不生效的摆设
        const result = await window.electronAPI.renameExcalidrawFile(workspaceSlug, currentSlug, trimmedTitle)
        currentSlug = result.slug
        setSlug(result.slug)
        loadedTitleRef.current = result.title
        // 同理：RENAME 会清洗非法字符（如 "A/B" → "A-B"），落盘标题可能和输入框原文不同，
        // 不同步会导致下次保存又把这次已经生效的改动误判成"还需要 rename"。
        setTitle(result.title)
        onSlugChange?.({ slug: result.slug, title: result.title })
      }

      await window.electronAPI.writeExcalidrawFile(workspaceSlug, currentSlug, {
        elements,
        appState: { viewBackgroundColor: appState.viewBackgroundColor },
        files,
      })
      dirtyRef.current = false

      showStatus(auto ? '已自动保存' : '已保存 ✓')
    } catch (err) {
      console.error('[ExcalidrawEditor] 保存失败:', err)
      showStatus('保存失败', false)
    } finally {
      setSaving(false)
    }
  }

  // Keep handleSaveRef in sync
  handleSaveRef.current = handleSave

  // 同步 flush（供 beforeunload 用）：应用退出/窗口关闭时，异步 IPC 不保证能在进程
  // 终止前跑完，必须走 sendSync 阻塞等待落盘——对齐 main.tsx 里 ScratchPad/TabState
  // 已有的 beforeunload + *Sync IPC 约定。只在真的有未保存改动时才触发。
  function flushSaveSync(): void {
    if (!dirtyRef.current || !workspaceSlug) return
    const scene = getCurrentScene()
    if (!scene) return
    try {
      const result = window.electronAPI.saveExcalidrawFileSync(
        workspaceSlug,
        isNew ? null : slug,
        title.trim() || '未命名画布',
        {
          elements: scene.elements,
          appState: { viewBackgroundColor: scene.appState.viewBackgroundColor },
          files: scene.files,
        },
      )
      if (result) dirtyRef.current = false
    } catch (err) {
      console.error('[ExcalidrawEditor] 同步保存失败:', err)
    }
  }
  flushSaveSyncRef.current = flushSaveSync

  // 自动保存（每 60 秒，仅在有未保存改动时触发）
  // 不要求 !isNew：全新画布若一直不手动保存，此前完全没有自动保存兜底，
  // 长时间创作后崩溃/强退会整份丢失；这里放宽为只要 workspaceSlug 就绪即可计时，
  // handleSave 内部本就会在 isNew 时自动走 CREATE 分支。
  React.useEffect(() => {
    if (!workspaceSlug) return

    autoSaveTimerRef.current = setInterval(() => {
      if (dirtyRef.current) void handleSaveRef.current(true)
    }, 60_000)

    return () => {
      if (autoSaveTimerRef.current) clearInterval(autoSaveTimerRef.current)
    }
  }, [workspaceSlug])

  // 离开编辑器时兜底 flush 一次未保存的改动（返回按钮/切侧栏视图/workspace 切换导致的卸载均适用，
  // 因为这些路径最终都会卸载本组件）。handleSaveRef 始终指向最新一次渲染的 handleSave 闭包，
  // 因此即便本 effect 只在挂载时注册一次，卸载时读到的仍是最新 slug/title/isNew。
  React.useEffect(() => {
    return () => {
      if (dirtyRef.current) void handleSaveRef.current(true)
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
    }
  }, [])

  // 整个应用退出/窗口关闭时的兜底：上面的卸载 flush 只覆盖"应用内切换视图"场景
  // （JS 事件循环还在跑，异步保存能跑完）；真正关窗口/退出应用时进程随时可能终止，
  // 必须在 beforeunload 里同步 flush，而不是指望上面那个 async 调用能跑完。
  React.useEffect(() => {
    const handler = (): void => flushSaveSyncRef.current()
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  // 键盘快捷键
  React.useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        void handleSaveRef.current(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const handleTitleChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement>): void => {
    setTitle(event.target.value)
    dirtyRef.current = true
  }, [])

  const handleBack = React.useCallback(async () => {
    // 返回画廊前如果还有未保存的编辑，先落盘再切视图。
    // 否则画廊 listExcalidrawFiles 可能在异步保存完成前就读盘，
    // 导致缩略图和内容都还是旧的——用户看到的是「编辑丢了」。
    if (dirtyRef.current) {
      setSaving(true)
      try {
        await handleSaveRef.current(true)
      } catch {
        // handleSave 内部已有错误提示，这里只需确保视图切换
      } finally {
        setSaving(false)
      }
    }
    if (onExit) {
      onExit()
      return
    }
    sessionStorage.removeItem('excalidraw:editingSlug')
    setActiveView('excalidraw-gallery')
  }, [onExit, setActiveView])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-foreground/30">
        <Loader2 size={24} className="animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* 顶部栏 */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/50 titlebar-no-drag shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            className="text-foreground/50 hover:text-foreground transition-colors shrink-0 disabled:opacity-40"
            onClick={handleBack}
            disabled={saving}
            aria-label={onExit ? '关闭画布' : '返回画廊'}
          >
            {saving ? <Loader2 size={18} className="animate-spin" /> : onExit ? <X size={18} /> : <ArrowLeft size={18} />}
          </button>
          <PenTool size={16} className="text-foreground/60 shrink-0" />
          <input
            type="text"
            value={title}
            onChange={handleTitleChange}
            className="bg-transparent border-b border-transparent focus:border-primary outline-none text-[14px] font-medium text-foreground px-1 py-0.5 min-w-[120px] max-w-[300px] placeholder:text-foreground/30"
            placeholder="未命名画布…"
            spellCheck={false}
          />
          {onBrowseAll && (
            <button
              type="button"
              className="text-[11px] text-foreground/50 hover:text-primary transition-colors shrink-0 whitespace-nowrap"
              onClick={onBrowseAll}
            >
              浏览全部画布
            </button>
          )}
          {isNew && (
            <span className="text-[11px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full shrink-0">
              新建
            </span>
          )}
        </div>
        {saveStatus && (
          <span
            className={`shrink-0 text-[12px] ${
              saveStatus.includes('失败') ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400'
            }`}
          >
            {saveStatus}
          </span>
        )}
      </div>

      {/* Excalidraw 编辑器 */}
      <div className="flex-1 min-h-0">
        <React.Suspense
          fallback={
            <div className="flex items-center justify-center h-full text-foreground/30">
              <Loader2 size={24} className="animate-spin" />
            </div>
          }
        >
          <Excalidraw
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            excalidrawAPI={(api: any) => {
              excalidrawRef.current = api as ExcalidrawImperativeAPI
            }}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onChange={(elements: any, appState: any, files: any) => {
              // 持续缓存最新快照——见 latestSceneRef 声明处注释，这是保存路径读数据的唯一来源。
              latestSceneRef.current = {
                elements: elements as unknown[],
                appState: appState as Record<string, unknown>,
                files: files as Record<string, unknown>,
              }
              if (!skippedInitialChangeRef.current) {
                skippedInitialChangeRef.current = true
                return
              }
              dirtyRef.current = true
            }}
            initialData={
              initialData
                ? {
                    elements: initialData.elements as never[],
                    appState: initialData.appState as never,
                    files: initialData.files as never,
                  }
                : undefined
            }
            UIOptions={{
              canvasActions: {
                saveToActiveFile: false,
                saveAsImage: true,
                loadScene: false,
                export: false,
              },
            }}
          />
        </React.Suspense>
      </div>
    </div>
  )
}
