import * as React from 'react'
import {
  ArrowLeft,
  ExternalLink,
  LoaderCircle,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import type { TaskGeneratedEventPayload } from '@myyoda/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { TaskEditorGenerationPanel } from './TaskEditorGenerationPanel'
import { TaskModelSelect } from './TaskModelSelect'
import {
  buildTaskEditorSubmission,
  createTaskEditorDraft,
  resolveGeneratedTaskEvent,
  taskSpecToEditorDraft,
  validateTaskDraft,
  type TaskEditorDraft,
} from './task-editor-model'
import {
  getTaskExpertOption,
  type TaskEditorMode,
} from './task-editor-ui-model'
import { canDependOn, uid, type EditorSubtask } from './task-spec-form'
import type { KanbanModelProviderGroup, KanbanProject, TaskEditorTarget } from './types'
import { useExpertOptions } from '@/components/agent-experts/useExpertOptions'

const GENERATE_TIMEOUT_MS = 200_000

type EditorTab = 'definition' | 'results'

type TaskResults = Awaited<ReturnType<typeof window.electronAPI.tasks.getResults>>

export interface TaskEditorProps {
  workspaceRoot: string
  workspaceId: string
  projects: KanbanProject[]
  target?: TaskEditorTarget
  defaultModel?: string
  modelGroups?: KanbanModelProviderGroup[]
  modelToConnection?: Map<string, string>
  onClose: () => void
  onCreated?: (created: {
    sessionId: string
    slug: string
    projectId?: string
    /** 是否已执行 tasks.run */
    ran?: boolean
  }) => void | Promise<void>
  onOpenSession?: (sessionId: string) => void
  onOpenChildSession?: (sessionId: string) => void
}

interface SubtaskCardProps {
  index: number
  subtask: EditorSubtask
  allSubtasks: EditorSubtask[]
  groups: KanbanModelProviderGroup[]
  fallbackModel: string
  onChange: (patch: Partial<EditorSubtask>) => void
  onRemove: () => void
}

function SubtaskCard({
  index,
  subtask,
  allSubtasks,
  groups,
  fallbackModel,
  onChange,
  onRemove,
}: SubtaskCardProps): React.ReactElement {
  const candidates = allSubtasks.filter((candidate) =>
    !subtask.dependsOn.includes(candidate.uid)
    && canDependOn(allSubtasks, subtask.uid, candidate.uid),
  )
  return (
    <article className="rounded-xl bg-muted/45 p-3 shadow-sm ring-1 ring-border/30">
      <div className="flex items-start gap-2">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{index + 1}</span>
        <div className="min-w-0 flex-1 space-y-2">
          <Input
            value={subtask.title}
            onChange={(event) => onChange({ title: event.target.value })}
            placeholder="子任务标题"
            className="bg-background"
          />
          <Textarea
            value={subtask.prompt}
            onChange={(event) => onChange({ prompt: event.target.value })}
            placeholder="告诉 Agent 这个节点需要完成什么"
            rows={3}
            className="bg-background"
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <TaskModelSelect
              value={subtask.model ?? fallbackModel}
              channelId={subtask.llmConnection}
              onChange={(selection) => onChange({
                model: selection.modelId,
                llmConnection: selection.channelId,
              })}
              groups={groups}
              width={148}
              size="sm"
            />
            <select
              aria-label="添加依赖"
              value=""
              onChange={(event) => {
                if (event.target.value) onChange({ dependsOn: [...subtask.dependsOn, event.target.value] })
              }}
              className="h-7 rounded-md border border-border/60 bg-background px-2 text-[11.5px]"
            >
              <option value="">添加依赖…</option>
              {candidates.map((candidate) => <option key={candidate.uid} value={candidate.uid}>{candidate.title || '未命名子任务'}</option>)}
            </select>
          </div>
          {subtask.dependsOn.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {subtask.dependsOn.map((dependencyId) => {
                const dependency = allSubtasks.find((candidate) => candidate.uid === dependencyId)
                return (
                  <button
                    key={dependencyId}
                    type="button"
                    onClick={() => onChange({ dependsOn: subtask.dependsOn.filter((id) => id !== dependencyId) })}
                    className="rounded-full bg-background px-2 py-1 text-[11px] text-muted-foreground shadow-sm hover:text-destructive"
                    title="点击移除依赖"
                  >
                    依赖：{dependency?.title || '未命名'} ×
                  </button>
                )
              })}
            </div>
          )}
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onRemove} aria-label="删除子任务"><Trash2 className="h-4 w-4" /></Button>
      </div>
    </article>
  )
}

function ResultsPanel({
  results,
  loading,
  onRefresh,
  onOpenChildSession,
}: {
  results: TaskResults
  loading: boolean
  onRefresh: () => void
  onOpenChildSession?: (sessionId: string) => void
}): React.ReactElement {
  return (
    <section className="min-h-0 flex-1 overflow-y-auto rounded-2xl bg-card p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div><h2 className="font-semibold">运行结果</h2><p className="text-xs text-muted-foreground">{results?.runId ?? '暂无运行记录'}</p></div>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />刷新
        </Button>
      </div>
      {!results || results.log.length === 0 ? (
        <div className="rounded-xl bg-muted/40 p-10 text-center text-sm text-muted-foreground">任务尚未运行，暂无结果。</div>
      ) : (
        <div className="space-y-2">
          {results.log.map((entry, index) => {
            const sessionId = 'sessionId' in entry ? entry.sessionId : undefined
            return (
              <div key={`${entry.t}-${index}`} className="flex items-center gap-3 rounded-xl bg-muted/35 px-3 py-2.5 text-sm">
                <span className="min-w-28 text-xs font-medium">{entry.kind}</span>
                {'nodeId' in entry && <span className="min-w-0 flex-1 truncate text-muted-foreground">{entry.nodeId}</span>}
                {'reason' in entry && entry.reason && <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{entry.reason}</span>}
                {sessionId && onOpenChildSession && (
                  <Button variant="ghost" size="sm" onClick={() => onOpenChildSession(sessionId)}><ExternalLink className="h-3.5 w-3.5" />打开会话</Button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

export function TaskEditor({
  workspaceRoot,
  workspaceId,
  projects,
  target = { mode: 'create' },
  defaultModel = '',
  modelGroups = [],
  modelToConnection = new Map(),
  onClose,
  onCreated,
  onOpenSession,
  onOpenChildSession,
}: TaskEditorProps): React.ReactElement {
  const initialProjectId = target.mode === 'create' ? target.initialProjectId : undefined
  const initialExpertId = initialProjectId
    ? projects.find((project) => project.id === initialProjectId)?.defaultExpertId
    : undefined
  const [draft, setDraft] = React.useState<TaskEditorDraft>(() =>
    createTaskEditorDraft(target, defaultModel, initialExpertId ?? 'general'),
  )
  const [tab, setTab] = React.useState<EditorTab>('definition')
  const [mode, setMode] = React.useState<TaskEditorMode>('manual')
  const [loading, setLoading] = React.useState(target.mode === 'edit' && Boolean(target.taskSlug))
  const [busy, setBusy] = React.useState(false)
  const [generating, setGenerating] = React.useState(false)
  const [results, setResults] = React.useState<TaskResults>(null)
  const generatedDraftRef = React.useRef<string | null>(null)
  const pendingGenerationRef = React.useRef<string | null>(null)
  const earlyGeneratedEventRef = React.useRef<TaskGeneratedEventPayload | null>(null)
  const generationTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const { options: expertOptions } = useExpertOptions()
  const expert = getTaskExpertOption(draft.expertId ?? 'general', expertOptions)

  const patchDraft = (patch: Partial<TaskEditorDraft>): void => {
    setDraft((current) => ({ ...current, ...patch }))
  }


  React.useEffect(() => {
    // 没有 taskSlug（普通会话，尚未升级成任务）：没有既有 spec 可读，初始草稿已经
    // 用 initialTitle/initialModel 起草好了，这里不需要再发请求覆盖它。
    if (target.mode !== 'edit' || !target.taskSlug) return
    const taskSlug = target.taskSlug
    let cancelled = false
    setLoading(true)
    void window.electronAPI.tasks.get(workspaceRoot, taskSlug).then((validation) => {
      if (cancelled) return
      if (!validation?.valid || !validation.spec) throw new Error('无法读取任务定义')
      setDraft(taskSpecToEditorDraft(validation.spec, target, defaultModel))
    }).catch((cause: unknown) => {
      if (!cancelled) toast.error('加载任务失败', { description: cause instanceof Error ? cause.message : String(cause) })
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [defaultModel, target, workspaceRoot])

  const finishGeneration = React.useCallback((): void => {
    pendingGenerationRef.current = null
    earlyGeneratedEventRef.current = null
    if (generationTimerRef.current) clearTimeout(generationTimerRef.current)
    generationTimerRef.current = null
    setGenerating(false)
  }, [])

  const consumeGeneratedEvent = React.useCallback((event: TaskGeneratedEventPayload): void => {
    try {
    const action = resolveGeneratedTaskEvent(event, workspaceId, pendingGenerationRef.current)
    if (action.kind === 'ignore') return
    finishGeneration()
    if (action.kind === 'error') {
      void window.electronAPI.deleteAgentSession(event.orchestratorSessionId).catch(() => undefined)
      toast.error('生成任务失败', { description: action.message })
      return
    }
    generatedDraftRef.current = event.orchestratorSessionId
    const nextDraft = taskSpecToEditorDraft(action.spec, target, defaultModel)
    setDraft((current) => ({
      ...(target.mode === 'create' ? { ...nextDraft, fixedId: action.slug } : nextDraft),
      // Generator prompt 只负责拆 DAG；项目、默认模型/权限来自用户在表单里的显式选择。
      projectId: nextDraft.projectId || current.projectId,
      boundProjectId: nextDraft.boundProjectId ?? current.boundProjectId,
      cwd: nextDraft.cwd ?? current.cwd,
      orchModel: action.spec.defaults?.model ?? current.orchModel,
      orchConnection: action.spec.defaults?.llmConnection ?? current.orchConnection,
      permissionMode: action.spec.defaults?.permissionMode ?? current.permissionMode,
      expertId: action.spec.defaults?.expertId ?? current.expertId,
      teamId: action.spec.defaults?.teamId ?? current.teamId,
    }))
    setMode('manual')
    } catch (err) {
      console.error('[TaskEditor] consumeGeneratedEvent error:', err)
      toast.error('生成任务失败', { description: err instanceof Error ? err.message : String(err) })
    }
  }, [defaultModel, finishGeneration, target, workspaceId])

  React.useEffect(() => window.electronAPI.tasks.onGenerated((event) => {
    if (event.workspaceId !== workspaceId) return
    // ack 尚未写入 pending 时先缓存，避免 GENERATED 早到被丢弃
    if (!pendingGenerationRef.current) {
      earlyGeneratedEventRef.current = event
      return
    }
    consumeGeneratedEvent(event)
  }), [consumeGeneratedEvent, workspaceId])

  // 卸载时只清理已完成生成的草稿 session，不删除仍在生成中的 session。
  // 生成中的 session 由 generateTaskForSession 的超时/完成逻辑自行清理。
  React.useEffect(() => () => {
    if (generationTimerRef.current) clearTimeout(generationTimerRef.current)
    if (generatedDraftRef.current) {
      void window.electronAPI.deleteAgentSession(generatedDraftRef.current).catch(() => undefined)
    }
  }, [])

  const addSubtask = (): void => {
    setDraft((current) => {
      const last = current.subtasks.at(-1)
      return {
        ...current,
        subtasks: [
          ...current.subtasks,
          { uid: uid(), title: '', prompt: '', dependsOn: last ? [last.uid] : [] },
        ],
      }
    })
  }

  const updateSubtask = (rowId: string, patch: Partial<EditorSubtask>): void => {
    setDraft((current) => ({
      ...current,
      subtasks: current.subtasks.map((subtask) => subtask.uid === rowId ? { ...subtask, ...patch } : subtask),
    }))
  }

  const removeSubtask = (rowId: string): void => {
    setDraft((current) => ({
      ...current,
      subtasks: current.subtasks
        .filter((subtask) => subtask.uid !== rowId)
        .map((subtask) => ({ ...subtask, dependsOn: subtask.dependsOn.filter((id) => id !== rowId) })),
    }))
  }

  const generate = async (): Promise<void> => {
    const goal = draft.goal.trim() || draft.title.trim()
    if (!goal) { toast.error('请先输入任务目标'); return }
    if (generatedDraftRef.current) {
      void window.electronAPI.deleteAgentSession(generatedDraftRef.current).catch(() => undefined)
      generatedDraftRef.current = null
    }
    setGenerating(true)
    try {
      earlyGeneratedEventRef.current = null
      const orchModel = draft.orchModel.trim() || defaultModel.trim()
      const orchConnection = draft.orchConnection ?? (orchModel ? modelToConnection.get(orchModel) : undefined)
      const ack = await window.electronAPI.tasks.generate(workspaceRoot, workspaceId, {
        goal,
        ...(draft.title.trim() ? { title: draft.title.trim() } : {}),
        ...(draft.projectId.trim() ? { projectId: draft.projectId.trim() } : {}),
        ...(draft.cwd?.trim() ? { cwd: draft.cwd.trim() } : {}),
        ...(orchModel ? { model: orchModel } : {}),
        ...(orchConnection ? { llmConnection: orchConnection } : {}),
        ...(draft.permissionMode ? { permissionMode: draft.permissionMode } : {}),
      })
      pendingGenerationRef.current = ack.orchestratorSessionId
      // await 之后 ref 可能已被 onGenerated 写入；显式断言避开 TS 对 .current = null 的收窄
      const earlyEvent = earlyGeneratedEventRef.current as TaskGeneratedEventPayload | null
      earlyGeneratedEventRef.current = null
      if (earlyEvent !== null && earlyEvent.orchestratorSessionId === ack.orchestratorSessionId) {
        consumeGeneratedEvent(earlyEvent)
        return
      }
      generationTimerRef.current = setTimeout(() => {
        if (pendingGenerationRef.current !== ack.orchestratorSessionId) return
        finishGeneration()
        void window.electronAPI.deleteAgentSession(ack.orchestratorSessionId).catch(() => undefined)
        toast.error('生成任务超时，请稍后重试')
      }, GENERATE_TIMEOUT_MS)
    } catch (cause) {
      console.error('[TaskEditor] generate failed:', cause)
      finishGeneration()
      toast.error('生成任务失败', { description: cause instanceof Error ? cause.message : String(cause) })
    }
  }

  const submit = async (runAfterCreate: boolean): Promise<void> => {
    const validation = validateTaskDraft(draft)
    if (!validation.ok) { toast.error(validation.error); return }
    setBusy(true)
    try {
      const submission = buildTaskEditorSubmission(draft, target, generatedDraftRef.current, modelToConnection)
      const created = await window.electronAPI.tasks.create(workspaceRoot, workspaceId, submission.request)
      generatedDraftRef.current = null
      if (runAfterCreate) {
        try {
          await window.electronAPI.tasks.run(workspaceRoot, workspaceId, created.slug, {
            orchestratorSessionId: created.orchestratorSessionId,
          })
          toast.success('任务已创建并开始运行')
        } catch (cause) {
          toast.error('任务已保存，但启动失败', { description: cause instanceof Error ? cause.message : String(cause) })
        }
      } else {
        toast.success(target.mode === 'edit' ? '任务定义已保存' : '任务已创建')
      }
      const createdEvent = {
        sessionId: created.orchestratorSessionId,
        slug: created.slug,
        ran: runAfterCreate,
        ...(draft.projectId ? { projectId: draft.projectId } : {}),
      }
      onClose()
      void Promise.resolve(onCreated?.(createdEvent)).catch((cause: unknown) => {
        toast.error('任务已保存，但刷新看板失败', { description: cause instanceof Error ? cause.message : String(cause) })
      })
    } catch (cause) {
      toast.error('保存任务失败', { description: cause instanceof Error ? cause.message : String(cause) })
    } finally {
      setBusy(false)
    }
  }

  const loadResults = React.useCallback(async (): Promise<void> => {
    if (target.mode !== 'edit' || !target.taskSlug) return
    const taskSlug = target.taskSlug
    setLoading(true)
    try {
      setResults(await window.electronAPI.tasks.getResults(workspaceRoot, taskSlug))
    } catch (cause) {
      toast.error('读取运行结果失败', { description: cause instanceof Error ? cause.message : String(cause) })
    } finally {
      setLoading(false)
    }
  }, [target, workspaceRoot])

  React.useEffect(() => {
    if (tab === 'results' && results === null) void loadResults()
  }, [loadResults, results, tab])

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 bg-background p-3">
      <header className="titlebar-drag-region flex flex-wrap items-center gap-2 rounded-xl bg-card px-3 py-2.5 shadow-sm">
        <div className="titlebar-no-drag flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}><ArrowLeft className="h-4 w-4" />返回 Project 看板</Button>
        <span className="text-sm font-semibold">{target.mode === 'edit' ? '编辑任务' : '新增任务'}</span>
        {target.mode === 'edit' && target.taskSlug && (
          <div className="ml-2 inline-flex rounded-lg bg-muted p-1">
            {(['definition', 'results'] as EditorTab[]).map((value) => (
              <button key={value} type="button" onClick={() => setTab(value)} className={cn('rounded-md px-2.5 py-1 text-xs', tab === value && 'bg-card shadow-sm')}>
                {value === 'definition' ? '任务定义' : '运行结果'}
              </button>
            ))}
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          {target.mode === 'edit' && onOpenSession && <Button variant="outline" size="sm" onClick={() => onOpenSession(target.sessionId)}><ExternalLink className="h-4 w-4" />打开会话</Button>}
          {tab === 'definition' && (
            <>
              <Button variant="outline" size="sm" disabled={busy || generating} onClick={() => void submit(false)}>{target.mode === 'edit' ? '保存' : '创建'}</Button>
              <Button size="sm" disabled={busy || generating} onClick={() => void submit(true)}>
                {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {target.mode === 'edit' ? '保存并运行' : '创建并运行'}
              </Button>
            </>
          )}
        </div>
        </div>
      </header>

      {tab === 'results' ? (
        <ResultsPanel results={results} loading={loading} onRefresh={() => void loadResults()} onOpenChildSession={onOpenChildSession} />
      ) : loading ? (
        <div className="grid flex-1 place-items-center text-sm text-muted-foreground"><LoaderCircle className="mr-2 inline h-4 w-4 animate-spin" />加载任务定义…</div>
      ) : (
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(320px,0.9fr)_minmax(420px,1.4fr)]">
          <section className="space-y-4 overflow-y-auto rounded-2xl bg-card p-4 shadow-sm">
            <div className="space-y-3">
              <div><h2 className="font-semibold">任务定义</h2><p className="text-xs text-muted-foreground">描述目标，并选择项目与执行策略。</p></div>
              <div className="inline-flex w-fit rounded-lg bg-muted/70 p-1">
                {(['manual', 'generate'] as TaskEditorMode[]).map((value) => (
                  <button
                    key={value}
                    type="button"
                    disabled={generating}
                    onClick={() => setMode(value)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50',
                      mode === value && 'bg-card text-foreground shadow-sm',
                    )}
                  >
                    {value === 'generate' && <Sparkles className="h-3.5 w-3.5" />}
                    {value === 'manual' ? '手动' : '生成'}
                  </button>
                ))}
              </div>
            </div>
            <label className="block space-y-1.5 text-xs font-medium">标题<Input value={draft.title} onChange={(event) => patchDraft({ title: event.target.value })} placeholder="例如：完成桌面端发布" /></label>
            <label className="block space-y-1.5 text-xs font-medium">目标<Textarea value={draft.goal} onChange={(event) => patchDraft({ goal: event.target.value })} placeholder="说明最终希望达成的结果" rows={4} /></label>
            <label className="block space-y-1.5 text-xs font-medium">验收标准<Textarea value={draft.acceptanceCriteria ?? ''} onChange={(event) => patchDraft({ acceptanceCriteria: event.target.value })} placeholder="可选：如何判断任务完成" rows={3} /></label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5 text-xs font-medium">
                项目
                <select
                  value={draft.projectId}
                  onChange={(event) => patchDraft({ projectId: event.target.value })}
                  className="h-9 w-full rounded-md border border-border/60 bg-background px-2 text-sm"
                >
                  <option value="">不绑定项目（工作区级任务）</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>
                <span className="block text-[11px] font-normal leading-4 text-muted-foreground">绑定后优先使用项目工作目录；不绑定时回退到工作区默认目录</span>
              </label>
              <label className="space-y-1.5 text-xs font-medium">权限<select value={draft.permissionMode ?? 'allow-all'} onChange={(event) => patchDraft({ permissionMode: event.target.value as 'safe' | 'ask' | 'allow-all' })} className="h-9 w-full rounded-md border border-border/60 bg-background px-2 text-sm"><option value="allow-all">自动执行</option><option value="ask">需要确认</option><option value="safe">安全模式</option></select></label>
              <div className="space-y-1.5 text-xs font-medium">
                <span>编排模型</span>
                <TaskModelSelect
                  value={draft.orchModel || defaultModel}
                  channelId={draft.orchConnection}
                  onChange={(selection) => patchDraft({
                    orchModel: selection.modelId,
                    orchConnection: selection.channelId,
                  })}
                  groups={modelGroups}
                  className="w-full"
                />
                <span className="block text-[11px] font-normal leading-4 text-muted-foreground">主任务默认模型；子任务可单独覆盖</span>
              </div>
              <label className="space-y-1.5 text-xs font-medium">
                Agent 专家 / 专家团
                <select
                  value={draft.teamId ?? draft.expertId ?? 'general'}
                  onChange={(event) => {
                    const option = expertOptions.find((item) => item.id === event.target.value)
                    if (option?.kind === 'team') {
                      // 团队指派：写入 defaults.teamId，运行时团长拆解委派
                      patchDraft({ teamId: event.target.value, expertId: undefined })
                    } else {
                      patchDraft({ expertId: event.target.value || undefined, teamId: undefined })
                    }
                  }}
                  className="h-9 w-full rounded-md border border-border/60 bg-background px-2 text-sm"
                >
                  {expertOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}{option.kind === 'team' ? '（团）' : ''}</option>
                  ))}
                </select>
                <span className="block text-[11px] font-normal leading-4 text-muted-foreground">
                  {draft.teamId
                    ? '专家团：运行时团长拆解任务并委派成员执行，团长汇总验收'
                    : (expert.description ?? '对应左侧「Agent 专家」模块中的角色配置')}
                </span>
              </label>
              <label className="space-y-1.5 text-xs font-medium">最大修复次数<Input type="number" min={0} max={10} value={draft.maxRepairs ?? ''} onChange={(event) => patchDraft({ maxRepairs: event.target.value === '' ? undefined : Number(event.target.value) })} placeholder="默认 3" /></label>
            </div>
          </section>

          {mode === 'generate' ? (
            <section className="min-h-0 overflow-y-auto rounded-2xl bg-card shadow-sm">
              <TaskEditorGenerationPanel generating={generating} onGenerate={() => void generate()} />
            </section>
          ) : (
            <section className="flex min-h-0 flex-col rounded-2xl bg-card shadow-sm">
              <header className="flex items-center gap-2 px-4 py-3"><div><h2 className="font-semibold">子任务 DAG</h2><p className="text-xs text-muted-foreground">依赖关系决定执行顺序。</p></div><span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs">{draft.subtasks.length}</span><Button variant="outline" size="sm" className="ml-auto" onClick={addSubtask}><Plus className="h-4 w-4" />添加节点</Button></header>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4">
                {draft.subtasks.map((subtask, index) => (
                  <SubtaskCard
                    key={subtask.uid}
                    index={index}
                    subtask={subtask}
                    allSubtasks={draft.subtasks}
                    groups={modelGroups}
                    fallbackModel={draft.orchModel || defaultModel}
                    onChange={(patch) => updateSubtask(subtask.uid, patch)}
                    onRemove={() => removeSubtask(subtask.uid)}
                  />
                ))}
                {draft.subtasks.length === 0 && <button type="button" onClick={addSubtask} className="w-full rounded-xl border border-dashed border-border/70 py-12 text-sm text-muted-foreground hover:bg-muted/40"><Plus className="mx-auto mb-2 h-5 w-5" />添加第一个子任务</button>}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
