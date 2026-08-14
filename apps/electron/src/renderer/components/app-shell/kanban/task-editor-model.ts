import type { TaskGeneratedEventPayload } from '@myyoda/shared'
import type { TaskSpec } from '@myyoda/shared/tasks/schema'
import { buildSpec, specToSubtasks, type SpecForm } from './task-spec-form'
import type { KanbanItem, TaskEditorTarget } from './types'

export interface TaskEditorDraft extends SpecForm {
  /** 任务归属工作区（新模型：项目=工作区）；空串 = 当前工作区 */
  targetWorkspaceId: string
}

export interface TaskEditorCreateRequest {
  yaml: string
  orchestratorSessionId?: string
  attachToExistingSessionId?: string
}

export interface TaskEditorSubmission {
  spec: TaskSpec
  request: TaskEditorCreateRequest
}

export type GeneratedTaskEventAction =
  | { kind: 'ignore' }
  | { kind: 'apply'; slug: string; spec: TaskSpec }
  | { kind: 'error'; message: string }

/**
 * 卡片右上角铅笔 / 右键菜单「编辑任务」的目标。对齐 craft：不要求卡片已绑定 task
 * spec——taskSlug 缺失时编辑器直接用卡片当前标题/模型起草一份新表单，保存即把
 * 这个普通会话「升级」成正式任务。
 */
export function resolveTaskEditorTarget(item: KanbanItem): TaskEditorTarget {
  return {
    mode: 'edit',
    sessionId: item.session.id,
    ...(item.session.taskSlug ? { taskSlug: item.session.taskSlug } : {}),
    initialTitle: item.title,
    ...(item.session.modelId ? { initialModel: item.session.modelId } : {}),
  }
}

export function createTaskEditorDraft(
  target: TaskEditorTarget,
  defaultModel: string,
  initialExpertId?: string,
  initialTeamId?: string,
): TaskEditorDraft {
  // edit 模式且没有 taskSlug：没有既有 spec 可读（不会有异步 effect 覆盖这份初始值），
  // 直接用卡片当前标题/模型起草——即"升级"这个普通会话的起点。
  const promoting = target.mode === 'edit' && !target.taskSlug
  return {
    title: target.mode === 'create' ? target.initialTitle ?? '' : promoting ? target.initialTitle ?? '' : '',
    goal: target.mode === 'create' ? target.initialGoal ?? '' : '',
    projectId: target.mode === 'create' ? target.initialProjectId ?? '' : '',
    targetWorkspaceId: '',
    orchModel: (promoting && target.initialModel) ? target.initialModel : defaultModel,
    permissionMode: 'allow-all',
    ...(initialExpertId ? { expertId: initialExpertId } : {}),
    ...(initialTeamId ? { teamId: initialTeamId } : {}),
    subtasks: [],
  }
}

export function taskSpecToEditorDraft(
  spec: TaskSpec,
  target: TaskEditorTarget,
  defaultModel: string,
): TaskEditorDraft {
  return {
    title: spec.title,
    goal: spec.goal,
    acceptanceCriteria: spec.acceptance_criteria,
    maxRepairs: spec.max_iterations,
    projectId: spec.project ?? (target.mode === 'create' ? target.initialProjectId ?? '' : ''),
    targetWorkspaceId: '',
    boundProjectId: spec.project,
    orchModel: spec.defaults?.model ?? defaultModel,
    orchConnection: spec.defaults?.llmConnection,
    permissionMode: spec.defaults?.permissionMode ?? 'allow-all',
    expertId: spec.defaults?.expertId,
    teamId: spec.defaults?.teamId,
    subtasks: specToSubtasks(spec.nodes),
    cwd: spec.cwd,
    sourceSlugs: spec.sources,
    skillSlugs: spec.skills,
    fixedId: target.mode === 'edit' ? target.taskSlug : undefined,
  }
}

export function buildTaskEditorSubmission(
  draft: TaskEditorDraft,
  target: TaskEditorTarget,
  generatedDraftSessionId: string | null,
  modelToConnection: Map<string, string>,
): TaskEditorSubmission {
  const spec = buildSpec(
    { ...draft, fixedId: target.mode === 'edit' ? target.taskSlug : draft.fixedId },
    modelToConnection,
  )
  return {
    spec,
    request: {
      yaml: JSON.stringify(spec, null, 2),
      ...(target.mode === 'edit'
        ? { attachToExistingSessionId: target.sessionId }
        : generatedDraftSessionId
          ? { orchestratorSessionId: generatedDraftSessionId }
          : {}),
    },
  }
}

/** Task 创建前校验：Project 可选；空值表示 Workspace Task。 */
export function validateTaskDraft(draft: Pick<TaskEditorDraft, 'projectId' | 'title'> & {
  subtasks?: Array<{ prompt: string }>
}): { ok: true } | { ok: false; error: string } {
  if (!draft.title?.trim()) return { ok: false, error: '请输入任务标题' }
  if (draft.subtasks && draft.subtasks.length === 0) return { ok: false, error: '至少需要一个子任务' }
  if (draft.subtasks?.some((subtask) => !subtask.prompt.trim())) {
    return { ok: false, error: '每个子任务都需要执行提示' }
  }
  return { ok: true }
}

export function resolveGeneratedTaskEvent(
  event: TaskGeneratedEventPayload,
  workspaceId: string,
  pendingSessionId: string | null,
): GeneratedTaskEventAction {
  if (event.workspaceId !== workspaceId || event.orchestratorSessionId !== pendingSessionId) {
    return { kind: 'ignore' }
  }
  if (event.status === 'saved') {
    if (event.slug && event.spec) return { kind: 'apply', slug: event.slug, spec: event.spec }
    return { kind: 'error', message: '生成结果缺少任务定义，请重试' }
  }
  const issue = event.errors?.[0]
  const message = issue
    ? `${issue.path ? `${issue.path}: ` : ''}${issue.message}`
    : event.status === 'invalid'
      ? '生成的任务定义无效'
      : '生成任务失败'
  return { kind: 'error', message }
}
