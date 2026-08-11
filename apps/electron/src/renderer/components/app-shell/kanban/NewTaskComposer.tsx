import * as React from 'react'
import { useAtomValue } from 'jotai'
import { ArrowRight, LoaderCircle, Play, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { serverKanbanProjectsAtom } from '@/atoms/project-atoms'
import {
  EMPTY_QUICK_TASK_DRAFT,
  submitQuickTask,
  toTaskEditorTarget,
  type QuickTaskDraft,
} from './quick-task-model'
import type { TaskEditorTarget } from './types'

interface NewTaskComposerProps {
  open: boolean
  workspaceRoot: string
  workspaceId: string
  initialProjectId?: string | null
  onOpenChange: (open: boolean) => void
  onMoreSettings: (target: TaskEditorTarget) => void
  onCreated?: (created: {
    sessionId: string
    slug: string
    projectId?: string
    ran?: boolean
  }) => void | Promise<void>
}

/**
 * 任务看板唯一的渐进式创建入口。
 *
 * 轻量层只收集标题和明确可见的归属；“更多设置”把同一份草稿带入 canonical
 * TaskEditor，不再维护第二套目标/子任务表单。
 */
export function NewTaskComposer({
  open,
  workspaceRoot,
  workspaceId,
  initialProjectId,
  onOpenChange,
  onMoreSettings,
  onCreated,
}: NewTaskComposerProps): React.ReactElement | null {
  const projects = useAtomValue(serverKanbanProjectsAtom)
  const [draft, setDraft] = React.useState<QuickTaskDraft>(EMPTY_QUICK_TASK_DRAFT)
  const [submitting, setSubmitting] = React.useState<'create' | 'run' | null>(null)
  const wasOpenRef = React.useRef(false)

  React.useEffect(() => {
    if (open && !wasOpenRef.current) {
      setDraft((current) => current.title.trim()
        ? current
        : { ...EMPTY_QUICK_TASK_DRAFT, projectId: initialProjectId ?? '' })
    }
    wasOpenRef.current = open
  }, [initialProjectId, open])

  const scopeName = draft.projectId
    ? projects.find((project) => project.id === draft.projectId)?.name ?? '所选项目'
    : 'Workspace'

  const closeAndReset = (): void => {
    setDraft(EMPTY_QUICK_TASK_DRAFT)
    onOpenChange(false)
  }

  const submit = async (runAfterCreate: boolean): Promise<void> => {
    if (submitting) return
    const title = draft.title.trim()
    if (!title) {
      toast.error('请输入任务标题')
      return
    }

    setSubmitting(runAfterCreate ? 'run' : 'create')
    const normalizedDraft = { ...draft, title, goal: draft.goal.trim() || title }
    const result = await submitQuickTask({
      draft: normalizedDraft,
      fallbackId: `quick-${Date.now()}`,
      create: (request) => window.electronAPI.tasks.create(workspaceRoot, workspaceId, request),
    })

    if (!result.ok) {
      setSubmitting(null)
      setDraft(result.draft)
      toast.error('创建任务失败', { description: result.error })
      return
    }

    let ran = false
    if (runAfterCreate) {
      try {
        await window.electronAPI.tasks.run(workspaceRoot, workspaceId, result.created.slug, {
          orchestratorSessionId: result.created.orchestratorSessionId,
        })
        ran = true
      } catch (cause) {
        toast.error('任务已创建，但启动失败', {
          description: cause instanceof Error ? cause.message : String(cause),
        })
      }
    }

    setSubmitting(null)
    closeAndReset()
    toast.success(ran ? '任务已创建并开始运行' : `任务已创建 · ${scopeName}`)
    await onCreated?.({
      sessionId: result.created.orchestratorSessionId,
      slug: result.created.slug,
      ...(normalizedDraft.projectId ? { projectId: normalizedDraft.projectId } : {}),
      ran,
    })
  }

  if (!open) return null

  return (
    <section
      aria-label="新建任务"
      aria-busy={submitting !== null}
      className="titlebar-no-drag mb-4 rounded-xl border border-border/50 bg-card/80 p-3 shadow-sm"
    >
      <div className="flex items-center gap-2">
        <select
          aria-label="任务归属"
          value={draft.projectId}
          disabled={submitting !== null}
          onChange={(event) => setDraft((current) => ({ ...current, projectId: event.target.value }))}
          className="h-9 max-w-[200px] rounded-md border border-border/60 bg-background px-2 text-xs font-medium"
        >
          <option value="">不绑定项目（工作区级任务）</option>
          {projects.filter((project) => !project.archivedAt).map((project) => (
            <option key={project.id} value={project.id}>{project.name}</option>
          ))}
        </select>
        <Input
          autoFocus
          value={draft.title}
          disabled={submitting !== null}
          onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              onOpenChange(false)
              return
            }
            if (event.key !== 'Enter') return
            event.preventDefault()
            void submit(event.metaKey || event.ctrlKey)
          }}
          placeholder="输入任务标题"
          aria-label="任务标题"
          className="h-9 min-w-0 flex-1"
        />
        <Button
          variant="ghost"
          size="sm"
          disabled={submitting !== null}
          onClick={() => {
            onMoreSettings(toTaskEditorTarget({
              ...draft,
              goal: draft.goal.trim() || draft.title.trim(),
            }))
            onOpenChange(false)
          }}
        >
          更多设置
          <ArrowRight className="ml-1 h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          disabled={submitting !== null || !draft.title.trim()}
          onClick={() => { void submit(false) }}
        >
          {submitting === 'create' ? <LoaderCircle className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
          创建任务
        </Button>
        <Button
          variant="secondary"
          size="icon-sm"
          disabled={submitting !== null || !draft.title.trim()}
          onClick={() => { void submit(true) }}
          title="创建并运行（⌘/Ctrl + Enter）"
          aria-label="创建并运行"
        >
          {submitting === 'run'
            ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            : <Play className="h-3.5 w-3.5" />}
        </Button>
        <Button variant="ghost" size="icon-sm" disabled={submitting !== null} onClick={closeAndReset} aria-label="取消新建任务">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Enter 创建 · ⌘/Ctrl + Enter 创建并运行 · 当前归属：{scopeName}
      </p>
    </section>
  )
}
