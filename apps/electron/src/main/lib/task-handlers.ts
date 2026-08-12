/**
 * Projects、Tasks 与 Session Kanban IPC handler 注册。
 *
 * 这里是 Electron 主进程与本地文件存储、TaskRunner、Agent 编排器之间的薄桥接层。
 */
import { BrowserWindow, ipcMain } from 'electron'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import {
  LABEL_IPC_CHANNELS,
  PROJECT_IPC_CHANNELS,
  SESSION_COMMAND_CHANNEL,
  SESSION_GROUP_IPC_CHANNELS,
  TASK_IPC_CHANNELS,
  TEAMBITION_IPC_CHANNELS,
} from '@myyoda/shared/channels'
import type {
  CreateProjectInput,
  AgentSessionMeta,
  ProjectsChangedEventPayload,
  SessionKanbanCommand,
  TaskContractIssue,
  TaskGeneratedEventPayload,
  UpdateProjectInput,
  UploadProjectAssetInput,
  ProjectDeleteImpact,
  TaskDeleteImpact,
} from '@myyoda/shared'
import type { TaskSpec } from '@myyoda/shared/tasks/schema'
import type { TaskMetadataPatch, TaskWorkflow } from '@myyoda/shared/tasks/task-record'
import {
  buildGeneratorPrompt,
  buildRepairPrompt,
  extractYaml,
} from '@myyoda/shared/tasks'
import {
  getProjectPath,
} from '@myyoda/shared/projects/storage'
import {
  taskDir,
  getLatestRunId,
  listResumableRuns,
  listTaskSlugs,
  loadTaskSpec,
  parseTaskYaml,
  readRunLog,
  readRunSpecSnapshot,
} from '@myyoda/shared/tasks/storage'
import { createMyYodaConductorSessionHost, type MyYodaConductorSessionHost } from './conductor-session-host'
import { deleteAgentSession, getAgentSessionMeta, listAgentSessions, updateAgentSessionMeta } from './agent-session-manager'
import { createSessionGroup, deleteSessionGroup, listSessionGroups, renameSessionGroup } from './agent-session-group-service'
import { isAgentSessionActive } from './agent-service'
import {
  getAgentWorkspace,
  getWorkspaceDefaultWorkingDirectoryAtRoot,
  listAgentWorkspaces,
} from './agent-workspace-manager'
import { getAgentWorkspacePath, getExpertsDir } from './config-paths'
import {
  getExpert,
  getTeam,
  resolveExpertOrTeamKind,
} from './expert-service'
import { buildLeaderPlanningPrompt, buildTeamExecutionSpec } from './team-run'
import { validateTeamSquad, type TeamMemberResolver } from '@myyoda/shared/experts'
import type { RunSnapshot } from './task-runner'
import { loadExpertWorkspaceBinding } from './expert-binding-service'
import { projectRepository } from './project-repository'
import { quarantineForRecovery } from './recovery-trash-service'
import { resolveRegisteredWorkspaceRoot, type WorkspaceRootRegistration } from './workspace-root-access-policy'
import { analyzeProjectDeleteImpact, analyzeTaskDeleteImpact } from './project-impact-service'
import {
  consumeDestructiveOperationToken,
  issueDestructiveOperationToken,
} from './destructive-operation-token'
import {
  openOrCreateProjectForPath,
  relocateProjectWorkingDirectory,
  restoreProjectWorkingDirectory,
  resolveEffectiveCwd,
} from './project-path-service'
import { TaskRepository } from './task-repository'
import { TaskRunner, type CreateSessionOptions, type RunOptions } from './task-runner'
import {
  materializeTaskTransaction,
  recoverTaskMaterializations,
  type TaskMaterializationDependencies,
} from './task-materialization-service'
import {
  resolveTaskWorkingDirectory as resolveTaskWorkingDirectoryWithPolicy,
  type TaskWorkingDirectoryResult,
} from './task-working-directory'
import { TeambitionService, type ClaimTeambitionTaskInput, type TeambitionRemoteTask } from './teambition-service'
import { WorkspaceLabelService, assertValidWorkspaceLabelIds } from './workspace-label-service'

const GENERATE_TIMEOUT_MS = 180_000

let handlersRegistered = false
let mainWindow: BrowserWindow | null = null
let sessionHostPromise: Promise<MyYodaConductorSessionHost> | undefined

const runners = new Map<string, TaskRunner>()

export interface TaskRunnerController {
  pause(slug: string, runId: string): void
  stop(slug: string, runId: string): Promise<void>
}

type TaskRunnerResolver = (workspaceRoot: string, workspaceId: string) => Promise<TaskRunnerController>

export async function pauseTaskRun(
  resolveRunner: TaskRunnerResolver,
  workspaceRoot: string,
  workspaceId: string,
  slug: string,
  runId: string,
): Promise<void> {
  (await resolveRunner(workspaceRoot, workspaceId)).pause(slug, runId)
}

export async function stopTaskRun(
  resolveRunner: TaskRunnerResolver,
  workspaceRoot: string,
  workspaceId: string,
  slug: string,
  runId: string,
): Promise<void> {
  await (await resolveRunner(workspaceRoot, workspaceId)).stop(slug, runId)
}

function getSessionHost(): Promise<MyYodaConductorSessionHost> {
  sessionHostPromise ??= createMyYodaConductorSessionHost()
  return sessionHostPromise
}

async function taskMaterializationDependencies(): Promise<TaskMaterializationDependencies> {
  const host = await getSessionHost()
  return {
    createSession: async (workspaceId: string, options: CreateSessionOptions) => {
      const created = await host.createSession(workspaceId, options)
      return getAgentSessionMeta(created.id) ?? {
        id: created.id,
        title: options.name ?? 'Task',
        workspaceId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
    },
    getSession: getAgentSessionMeta,
    updateSession: updateAgentSessionMeta,
    deleteSession: deleteAgentSession,
  }
}

/** tasks:create 与 create_task 共用可恢复事务，只创建不运行。 */
export async function materializeTaskFromSpec(
  workspaceRoot: string,
  workspaceId: string,
  spec: TaskSpec,
): Promise<{ slug: string; taskId: string; orchestratorSessionId: string }> {
  const seed = buildTaskSessionSeed(spec, workspaceRoot)
  return materializeTaskTransaction({
    workspaceRoot,
    workspaceId,
    spec,
    mode: {
      kind: 'create',
      sessionOptions: {
        sessionStatus: 'todo',
        ...(seed.workingDirectory ? { workingDirectory: seed.workingDirectory } : {}),
        ...(seed.modelId ? { model: seed.modelId } : {}),
        ...(seed.channelId ? { llmConnection: seed.channelId } : {}),
        ...(spec.defaults?.permissionMode ? { permissionMode: spec.defaults.permissionMode } : {}),
      },
    },
  }, await taskMaterializationDependencies())
}

async function getRunnerFor(workspaceRoot: string, workspaceId: string): Promise<TaskRunner> {
  const existing = runners.get(workspaceId)
  if (existing) return existing

  const expertsRoot = getExpertsDir()
  const runner = new TaskRunner({
    host: await getSessionHost(),
    workspaceId,
    workspaceRoot,
    isSessionActive: isAgentSessionActive,
    getExpert: (expertId) => getExpert(expertsRoot, expertId),
    getWorkspaceExpertBinding: (expertId) => {
      const binding = loadExpertWorkspaceBinding(workspaceRoot, expertId)
      return binding.kind === 'valid' ? binding.binding : null
    },
    resolveProjectDefaultExpertId: (projectId) => {
      try {
        return projectRepository.getProjectAtRoot(workspaceRoot, projectId)?.config.defaultExpertId ?? null
      } catch (cause) {
        console.warn(`[TaskRunner] 读取项目默认专家失败: ${projectId}`, cause)
        return null
      }
    },
    resolveTaskWorkingDirectory: (spec) => resolveTaskWorkingDirectoryResult(workspaceRoot, spec),
  })
  runners.set(workspaceId, runner)
  return runner
}

type WorkspaceRootResolver = (workspaceId: string) => string | undefined

function resolveKnownWorkspaceRoot(workspaceId: string): string | undefined {
  const workspace = getAgentWorkspace(workspaceId)
  return workspace ? getAgentWorkspacePath(workspace.slug) : undefined
}

function requireRegisteredProjectWorkspaceRoot(
  requestedRoot: unknown,
  registrations: readonly WorkspaceRootRegistration[] = listAgentWorkspaces().map((workspace) => ({
    id: workspace.id,
    root: getAgentWorkspacePath(workspace.slug),
  })),
): {
  workspaceId: string
  workspaceRoot: string
} {
  const resolved = resolveRegisteredWorkspaceRoot(requestedRoot, registrations)
  if (!resolved) throw new Error('项目 IPC 收到未注册或不可达的 Workspace 根目录')
  return resolved
}

export function validateSessionLabelAssignment(
  workspaceRoot: string,
  session: AgentSessionMeta,
  labelIds: readonly string[],
  resolveWorkspaceRoot: WorkspaceRootResolver = resolveKnownWorkspaceRoot,
): string[] {
  if (session.workspaceId) {
    const associatedRoot = resolveWorkspaceRoot(session.workspaceId)
    if (associatedRoot && resolve(associatedRoot) !== resolve(workspaceRoot)) {
      throw new Error(`Session ${session.id} 不属于当前 Workspace`)
    }
  }
  return assertValidWorkspaceLabelIds(workspaceRoot, labelIds)
}

function sendToMainWindow(channel: string, payload: unknown): void {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
  mainWindow.webContents.send(channel, payload)
}

function deleteImpactFingerprint(impact: ProjectDeleteImpact | TaskDeleteImpact): string {
  const { confirmationToken: _confirmationToken, ...snapshot } = impact
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
}

function issueProjectDeleteConfirmation(
  workspaceRoot: string,
  projectSlug: string,
  impact: ProjectDeleteImpact,
): ProjectDeleteImpact {
  return {
    ...impact,
    confirmationToken: issueDestructiveOperationToken(
      'project-purge',
      `${workspaceRoot}/projects/${projectSlug}`,
      deleteImpactFingerprint(impact),
    ),
  }
}

function issueTaskDeleteConfirmation(
  workspaceRoot: string,
  taskSlug: string,
  impact: TaskDeleteImpact,
): TaskDeleteImpact {
  return {
    ...impact,
    confirmationToken: issueDestructiveOperationToken(
      'task-purge',
      `${workspaceRoot}/tasks/${taskSlug}`,
      deleteImpactFingerprint(impact),
    ),
  }
}

function requireDeleteConfirmation(
  token: unknown,
  kind: 'project-purge' | 'task-purge',
  scope: string,
  impact: ProjectDeleteImpact | TaskDeleteImpact,
): void {
  if (!consumeDestructiveOperationToken(token, kind, scope, deleteImpactFingerprint(impact))) {
    throw new Error('删除确认已过期、已使用或目标状态已变化，请重新打开影响分析')
  }
}

function broadcastProjectsChanged(workspaceRoot: string, workspaceId: string): void {
  const payload: ProjectsChangedEventPayload = {
    kind: 'projects:changed',
    workspaceId,
    projects: projectRepository.listProjectsAtRoot(workspaceRoot),
  }
  sendToMainWindow(PROJECT_IPC_CHANNELS.CHANGED, payload)
}

function toTaskIssues(errors: Array<{ path?: string; message: string }> | undefined): TaskContractIssue[] {
  return (errors ?? []).map((error) => ({
    ...(error.path ? { path: error.path } : {}),
    message: error.message,
  }))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isAgentServiceErrorText(text: string): boolean {
  const looksLikeTaskYaml = /^\s*(?:id|title|goal|nodes)\s*:/m.test(text) && /^\s*nodes\s*:/m.test(text)
  return !looksLikeTaskYaml
    && /(?:Codex error|Claude error|服务繁忙|model is not supported|API error|rate limit)/i.test(text)
}

interface AdoptableTaskSpec {
  id: string
  project?: string
  cwd?: string
  defaults?: {
    model?: string
    llmConnection?: string
    permissionMode?: string
  }
}

/** 解析 Task cwd 的结构化结果；配置失效时保留 blocked 原因，供 Run/UI 使用。 */
export function resolveTaskWorkingDirectoryResult(
  workspaceRoot: string,
  spec: Pick<AdoptableTaskSpec, 'cwd' | 'project'>,
): TaskWorkingDirectoryResult {
  return resolveTaskWorkingDirectoryWithPolicy({
    explicitCwd: spec.cwd,
    projectId: spec.project,
    workspaceDefaultCwd: getWorkspaceDefaultWorkingDirectoryAtRoot(workspaceRoot),
    resolveProjectCwd: (projectId) => {
      const result = projectRepository.resolveEffectiveCwdForProject(workspaceRoot, projectId)
      if (!result) return null
      if (result.status === 'unavailable' || !result.cwd) {
        return {
          status: 'unavailable',
          ...(result.displayPath ? { attemptedPath: result.displayPath } : {}),
        }
      }
      return { status: 'resolved', cwd: result.cwd }
    },
  })
}

/** 创建阶段兼容 helper：Task 可在缺少 cwd 时保存，因此 blocked 映射为 undefined。 */
export function resolveTaskWorkingDirectory(
  workspaceRoot: string,
  spec: Pick<AdoptableTaskSpec, 'cwd' | 'project'>,
): string | undefined {
  const result = resolveTaskWorkingDirectoryResult(workspaceRoot, spec)
  return result.status === 'resolved' ? result.cwd : undefined
}

/**
 * 构造 set_project_id 的会话更新补丁。
 * 绑定项目且解析出有效 cwd（外部主目录或托管 workdir）时写入 workingDirectory；
 * 解绑或 cwd 不可用时省略该字段，保留会话已有工作目录（避免误清手动附加路径）。
 * 绑定项目 = triage 完成：会话还未上板（无列）或滞留在已下线的收件箱时，顺位移到「待办」；
 * 用户已手动拖到其他列的会话不动，尊重整理结果。
 */
export function buildSetProjectIdUpdates(
  projectId: string | undefined,
  resolvedWorkingDirectory: string | undefined,
  currentKanbanColumn?: string,
): Pick<AgentSessionMeta, 'projectId'> & Partial<Pick<AgentSessionMeta, 'workingDirectory' | 'kanbanColumn'>> {
  const shouldAdvanceColumn = Boolean(projectId)
    && (currentKanbanColumn === undefined || currentKanbanColumn === 'inbox')
  return {
    projectId,
    ...(projectId && resolvedWorkingDirectory ? { workingDirectory: resolvedWorkingDirectory } : {}),
    ...(shouldAdvanceColumn ? { kanbanColumn: 'todo' } : {}),
  }
}

function mapTaskPermissionMode(mode: string | undefined): AgentSessionMeta['permissionMode'] | undefined {
  if (mode === undefined) return undefined
  if (mode === 'allow-all' || mode === 'bypassPermissions') return 'bypassPermissions'
  // 历史 SDK auto ≈ 完全自动；safe/ask 不得升权，收敛到计划模式
  if (mode === 'auto') return 'bypassPermissions'
  if (mode === 'safe' || mode === 'ask') return 'plan'
  if (mode === 'plan') return 'plan'
  return undefined
}

/** 从 task spec 提取应写入 orchestrator 会话的字段（cwd / 模型 / 渠道 / 权限）。 */
export function buildTaskSessionSeed(
  spec: AdoptableTaskSpec,
  workspaceRoot?: string,
): Pick<AgentSessionMeta, 'workingDirectory' | 'modelId' | 'channelId' | 'permissionMode'> {
  const workingDirectory = workspaceRoot
    ? resolveTaskWorkingDirectory(workspaceRoot, spec)
    : spec.cwd?.trim() || undefined
  const permissionMode = mapTaskPermissionMode(spec.defaults?.permissionMode)
  return {
    ...(workingDirectory ? { workingDirectory } : {}),
    ...(spec.defaults?.model ? { modelId: spec.defaults.model } : {}),
    ...(spec.defaults?.llmConnection ? { channelId: spec.defaults.llmConnection } : {}),
    ...(permissionMode ? { permissionMode } : {}),
  }
}

/** 生成草稿转正时清除隐藏标记，并把尚未运行的任务放回待办状态。 */
export function buildAdoptedTaskSessionPatch(
  spec: AdoptableTaskSpec,
  workspaceRoot?: string,
): Pick<AgentSessionMeta, 'taskSlug' | 'projectId' | 'taskDraft' | 'sessionStatus' | 'workingDirectory' | 'modelId' | 'channelId' | 'permissionMode'> {
  return {
    taskSlug: spec.id,
    ...(spec.project ? { projectId: spec.project } : {}),
    ...buildTaskSessionSeed(spec, workspaceRoot),
    taskDraft: undefined,
    sessionStatus: 'todo',
  }
}

/**
 * 只有 tasks:generate 创建的隐藏草稿会话允许被「创建」转正。
 * 防止 stale orchestratorSessionId 把普通会话或其他任务静默改造成看板任务。
 */
export function assertAdoptableTaskDraftSession(
  sessionId: string,
  spec: AdoptableTaskSpec,
  getSession: (id: string) => AgentSessionMeta | undefined = getAgentSessionMeta,
): AgentSessionMeta {
  const meta = getSession(sessionId)
  if (!meta) throw new Error(`Agent 会话不存在: ${sessionId}`)
  if (meta.taskSlug) {
    if (meta.taskSlug === spec.id) return meta
    throw new Error(`生成草稿已绑定到其他任务: ${meta.taskSlug}`)
  }
  if (!meta.taskDraft) {
    throw new Error('生成草稿会话已失效，请重新生成任务计划')
  }
  return meta
}

type AgentSessionMetaUpdater = (
  sessionId: string,
  updates: Pick<AgentSessionMeta, 'kanbanColumn' | 'sessionStatus'>,
) => AgentSessionMeta

/** 将看板列持久化；调用方可选传入联动的 sessionStatus 一并写入。 */
export function setSessionKanbanColumn(
  sessionId: string,
  column: string | null,
  updateSession: AgentSessionMetaUpdater = updateAgentSessionMeta,
  options?: { sessionStatus?: string },
): AgentSessionMeta {
  return updateSession(sessionId, {
    kanbanColumn: column ?? undefined,
    ...(options?.sessionStatus ? { sessionStatus: options.sessionStatus } : {}),
  })
}

/**
 * 根据拖入的看板列解析应写入的 sessionStatus（内置默认列固定语义：
 * 待办→todo、已完成→done、进行中→不写，运行态由系统派生）。
 * 护栏：会话正在运行（running/in-progress）时不被拖放降级——人不与机器打架。
 */
export function resolveSessionDropStatus(
  sessionId: string,
  columnId: string | null,
  getSession: typeof getAgentSessionMeta = getAgentSessionMeta,
): string | undefined {
  const meta = getSession(sessionId)
  if (!meta || !columnId) return undefined

  // 运行中的会话 badge 由系统派生，拖列不改写
  if (meta.sessionStatus === 'running' || meta.sessionStatus === 'in-progress') return undefined

  if (columnId === 'todo') return 'todo'
  if (columnId === 'done') return 'done'
  return undefined
}

/** 冷启动：扫描所有工作区未结束的 TaskRun 并 resume */
export async function rehydrateIncompleteTaskRuns(): Promise<number> {
  let restored = 0
  for (const workspace of listAgentWorkspaces()) {
    const workspaceRoot = getAgentWorkspacePath(workspace.slug)
    const resumable = listResumableRuns(workspaceRoot)
    if (resumable.length === 0) continue
    const runner = await getRunnerFor(workspaceRoot, workspace.id)
    for (const { slug, runId } of resumable) {
      try {
        runner.resume(slug, runId)
        restored += 1
        console.log(`[TaskRunner] 冷启动恢复 ${workspace.slug}/${slug}:${runId}`)
      } catch (error) {
        console.warn(`[TaskRunner] 冷启动恢复失败 ${workspace.slug}/${slug}:${runId}: ${errorMessage(error)}`)
      }
    }
    runner.healAllOrphaned()
  }
  return restored
}

/** 收敛内存中卡住的 TaskRun（Agent 已不活跃但仍标 running） */
export async function healOrphanedTaskRuns(): Promise<number> {
  let total = 0
  for (const runner of runners.values()) {
    total += runner.healAllOrphaned()
  }
  return total
}

/** 保持 validate 与 tasks.get 使用相同的完整验证结果形状。 */
export function buildTaskValidationPayload(result: ReturnType<typeof parseTaskYaml>): ReturnType<typeof parseTaskYaml> {
  return {
    valid: result.valid,
    errors: result.errors ?? [],
    warnings: result.warnings ?? [],
    ...(result.spec ? { spec: result.spec } : {}),
  }
}

/** 通过 Host 的完成事件等待一轮生成，避免悬挂监听器和未等待的 Agent 请求。 */
async function sendGenerationPrompt(
  host: MyYodaConductorSessionHost,
  sessionId: string,
  prompt: string,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let settled = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = host.onSessionComplete((event) => {
      if (event.sessionId !== sessionId || settled) return
      settled = true
      if (timeout) clearTimeout(timeout)
      unsubscribe()
      if (event.reason === 'error') {
        reject(new Error('Agent 生成 task.yaml 失败'))
        return
      }
      resolve(event.finalText ?? host.getSessionFinalText(sessionId) ?? '')
    })

    timeout = setTimeout(() => {
      if (settled) return
      settled = true
      unsubscribe()
      void host.cancelProcessing(sessionId, true)
      reject(new Error('Agent 生成 task.yaml 超时'))
    }, GENERATE_TIMEOUT_MS)

    void host.sendMessage(sessionId, prompt, { toolPolicy: 'none' }).catch((error: unknown) => {
      if (settled) return
      settled = true
      if (timeout) clearTimeout(timeout)
      unsubscribe()
      reject(error)
    })
  })
}

// ---------------------------------------------------------------------------
// 专家团运行：团长编排 → 展开执行
// ---------------------------------------------------------------------------

/**
 * 团队任务运行入口：
 * 1. 读取并校验团队配置（团长/成员必须存在且是专家）
 * 2. 创建团长编排会话，注入团长协议 + 协调策略 + 名册 + 任务目标（toolPolicy none，无副作用）
 * 3. 团长输出委派 task.yaml → parseTaskYaml（失败自动 repair 一次）
 * 4. buildTeamExecutionSpec 展开（成员节点 + 团长汇总节点）→ runWithSpec 静态执行
 * 团长编排会话即 orchestratorSessionId（看板可见、可暂停恢复）。
 */
async function runTeamTask(
  workspaceRoot: string,
  workspaceId: string,
  slug: string,
  teamId: string,
  baseSpec: TaskSpec,
  options?: RunOptions,
): Promise<RunSnapshot> {
  const expertsRoot = getExpertsDir()
  const team = getTeam(expertsRoot, teamId)
  if (!team) {
    throw new Error(`专家团不存在: ${teamId}`)
  }
  const issues = validateTeamSquad(team, (id) => resolveExpertOrTeamKind(expertsRoot, id))
  if (issues.length > 0) {
    throw new Error(`专家团配置无效: ${issues.map((issue) => issue.message).join('; ')}`)
  }

  const host = await getSessionHost()
  const leaderSession = await host.createSession(workspaceId, {
    name: `团长编排 · ${team.label}`,
    projectId: baseSpec.project,
    model: baseSpec.defaults?.model,
    llmConnection: baseSpec.defaults?.llmConnection,
    permissionMode: baseSpec.defaults?.permissionMode,
    parentSessionId: options?.orchestratorSessionId,
  })

  const resolveMember: TeamMemberResolver = (expertId) => {
    const expert = getExpert(expertsRoot, expertId)
    return expert ? { label: expert.label, skills: expert.skillSlugs } : null
  }

  let prompt = buildLeaderPlanningPrompt(team, baseSpec, resolveMember)
  let leaderSpec: TaskSpec | null = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const text = await sendGenerationPrompt(host, leaderSession.id, prompt)
    const parsed = parseTaskYaml(extractYaml(text))
    if (parsed.valid && parsed.spec) {
      leaderSpec = parsed.spec
      break
    }
    const errors = toTaskIssues(parsed.errors)
    console.warn(`[TaskRunner] 团长委派计划校验失败 attempt=${attempt + 1} team=${teamId}`, errors)
    if (attempt === 0) {
      prompt = buildRepairPrompt(errors.map((issue) => ({ path: issue.path ?? '<root>', message: issue.message })))
      continue
    }
    await host.setSessionStatus(leaderSession.id, 'needs-review').catch(() => undefined)
    throw new Error(`团长未能产出合法委派计划: ${errors.map((issue) => issue.message).join('; ')}`)
  }

  const built = buildTeamExecutionSpec({ team, leaderSpec: leaderSpec!, baseSpec })
  if (!built.ok || !built.spec) {
    await host.setSessionStatus(leaderSession.id, 'needs-review').catch(() => undefined)
    throw new Error(`委派计划校验失败: ${(built.errors ?? []).join('; ')}`)
  }

  const runner = await getRunnerFor(workspaceRoot, workspaceId)
  return runner.runWithSpec(built.spec, slug, {
    ...options,
    orchestratorSessionId: leaderSession.id,
  })
}

/** 任务运行入口：defaults.teamId 存在时走专家团展开路径，否则普通运行 */
async function runTaskOrTeam(
  workspaceRoot: string,
  workspaceId: string,
  slug: string,
  options?: RunOptions,
): Promise<RunSnapshot> {
  const loaded = loadTaskSpec(workspaceRoot, slug)
  const teamId = loaded?.spec?.defaults?.teamId
  if (!teamId) {
    return (await getRunnerFor(workspaceRoot, workspaceId)).run(slug, options)
  }
  return runTeamTask(workspaceRoot, workspaceId, slug, teamId, loaded!.spec!, options)
}

/**
 * 注册所有 Projects、Tasks、Session 与 Teambition IPC handlers。
 * 重建窗口时只更新推送目标，不重复调用 ipcMain.handle。
 */
export interface TaskHandlerRegistrationOptions {
  /** 测试/嵌入环境可提供主进程已注册的 Workspace 根；生产默认每次读取 Workspace 索引。 */
  workspaceRegistrations?: () => readonly WorkspaceRootRegistration[]
}

export function registerTaskHandlers(window: BrowserWindow, options: TaskHandlerRegistrationOptions = {}): void {
  mainWindow = window
  const getRegisteredWorkspaceRoots = options.workspaceRegistrations ?? (() => listAgentWorkspaces().map((workspace) => ({
    id: workspace.id,
    root: getAgentWorkspacePath(workspace.slug),
  })))
  const requireProjectWorkspaceRoot = (requestedRoot: unknown, requestedWorkspaceId?: string) => {
    const context = requireRegisteredProjectWorkspaceRoot(requestedRoot, getRegisteredWorkspaceRoots())
    if (requestedWorkspaceId !== undefined && requestedWorkspaceId !== context.workspaceId) {
      throw new Error('Workspace root 与 workspaceId 不匹配')
    }
    return context
  }
  const requireWorkspaceSlug = (requestedSlug: unknown) => {
    if (typeof requestedSlug !== 'string') throw new Error('Workspace slug 无效')
    const workspace = listAgentWorkspaces().find((candidate) => candidate.slug === requestedSlug)
    if (!workspace) throw new Error('Workspace slug 未注册')
    return {
      workspaceId: workspace.id,
      workspaceRoot: getAgentWorkspacePath(workspace.slug),
      workspaceSlug: workspace.slug,
    }
  }
  if (handlersRegistered) return
  handlersRegistered = true

  // 进程启动后先收敛已完成 Session 绑定但尚未 rename 提交的 Task 事务。
  // recovery-required 只报告，不猜测或删除用户数据。
  for (const workspace of listAgentWorkspaces()) {
    const workspaceRoot = getAgentWorkspacePath(workspace.slug)
    for (const result of recoverTaskMaterializations(workspaceRoot, {})) {
      if (result.status === 'recovery-required') {
        console.warn(`[TaskMaterialization] 需要人工恢复 ${workspace.id}/${result.transactionId}: ${result.message ?? result.taskSlug}`)
      } else {
        console.info(`[TaskMaterialization] 启动恢复 ${workspace.id}/${result.taskSlug}: ${result.status}`)
      }
    }
  }

  ipcMain.handle(PROJECT_IPC_CHANNELS.GET, (_event, workspaceRoot: string) => {
    const context = requireProjectWorkspaceRoot(workspaceRoot)
    return projectRepository.listProjectsAtRoot(context.workspaceRoot)
  })

  ipcMain.handle(PROJECT_IPC_CHANNELS.GET_ONE, (_event, workspaceRoot: string, idOrSlug: string) => {
    const context = requireProjectWorkspaceRoot(workspaceRoot)
    return projectRepository.getProjectAtRoot(context.workspaceRoot, idOrSlug)
  })

  ipcMain.handle(PROJECT_IPC_CHANNELS.CREATE, (_event, workspaceRoot: string, input: CreateProjectInput) => {
    const context = requireProjectWorkspaceRoot(workspaceRoot)
    const project = projectRepository.createProjectAtRoot(context.workspaceRoot, input)
    broadcastProjectsChanged(context.workspaceRoot, context.workspaceId)
    return project
  })

  ipcMain.handle(PROJECT_IPC_CHANNELS.UPDATE, (_event, workspaceRoot: string, slug: string, patch: UpdateProjectInput) => {
    const context = requireProjectWorkspaceRoot(workspaceRoot)
    const project = projectRepository.updateProjectAtRoot(context.workspaceRoot, slug, patch)
    broadcastProjectsChanged(context.workspaceRoot, context.workspaceId)
    return project
  })

  ipcMain.handle(PROJECT_IPC_CHANNELS.DELETE, (_event, workspaceRoot: string, slug: string, confirmationToken?: string) => {
    const context = requireProjectWorkspaceRoot(workspaceRoot)
    const project = projectRepository.getProjectAtRoot(context.workspaceRoot, slug)
    if (!project) throw new Error(`项目不存在: ${slug}`)
    if (!project.config.archivedAt) throw new Error('永久删除前必须先归档项目')

    // 在执行删除的同一主进程 command 内重新分析，不能信任 Renderer 中可能过期的预览。
    const impact = analyzeProjectDeleteImpact(context.workspaceRoot, project.config, listAgentSessions())
    if (!impact.canPurge) {
      throw new Error(`项目仍有关联数据，不能永久删除：${impact.blockers.join('；')}`)
    }
    requireDeleteConfirmation(
      confirmationToken,
      'project-purge',
      `${context.workspaceRoot}/projects/${slug}`,
      impact,
    )

    const deletableSlug = projectRepository.assertProjectDeletableAtRoot(context.workspaceRoot, slug)
    quarantineForRecovery(
      context.workspaceRoot,
      getProjectPath(context.workspaceRoot, deletableSlug),
      'project',
      deletableSlug,
    )
    broadcastProjectsChanged(context.workspaceRoot, context.workspaceId)
  })

  ipcMain.handle(PROJECT_IPC_CHANNELS.ANALYZE_DELETE_IMPACT, (_event, workspaceRoot: string, idOrSlug: string) => {
    const context = requireProjectWorkspaceRoot(workspaceRoot)
    const project = projectRepository.getProjectAtRoot(context.workspaceRoot, idOrSlug)
    if (!project) throw new Error(`项目不存在: ${idOrSlug}`)
    const impact = analyzeProjectDeleteImpact(context.workspaceRoot, project.config, listAgentSessions())
    return issueProjectDeleteConfirmation(context.workspaceRoot, project.config.slug, impact)
  })

  ipcMain.handle(PROJECT_IPC_CHANNELS.LIST_ASSETS, (_event, workspaceRoot: string, slug: string) => {
    const context = requireProjectWorkspaceRoot(workspaceRoot)
    return projectRepository.listProjectAssetsAtRoot(context.workspaceRoot, slug)
  })

  ipcMain.handle(PROJECT_IPC_CHANNELS.UPLOAD_ASSET, (_event, workspaceRoot: string, slug: string, input: UploadProjectAssetInput) => {
    const context = requireProjectWorkspaceRoot(workspaceRoot)
    const asset = projectRepository.uploadProjectAssetAtRoot(context.workspaceRoot, slug, input)
    broadcastProjectsChanged(context.workspaceRoot, context.workspaceId)
    return asset
  })

  ipcMain.handle(PROJECT_IPC_CHANNELS.DELETE_ASSET, (_event, workspaceRoot: string, slug: string, filename: string) => {
    const context = requireProjectWorkspaceRoot(workspaceRoot)
    projectRepository.deleteProjectAssetAtRoot(context.workspaceRoot, slug, filename)
    broadcastProjectsChanged(context.workspaceRoot, context.workspaceId)
  })

  ipcMain.handle(PROJECT_IPC_CHANNELS.READ_MEMORY, (_event, workspaceRoot: string, slug: string) => {
    const context = requireProjectWorkspaceRoot(workspaceRoot)
    return projectRepository.readProjectMemoryAtRoot(context.workspaceRoot, slug)
  })

  ipcMain.handle(PROJECT_IPC_CHANNELS.WRITE_MEMORY, (_event, workspaceRoot: string, slug: string, content: string) => {
    const context = requireProjectWorkspaceRoot(workspaceRoot)
    projectRepository.writeProjectMemoryAtRoot(context.workspaceRoot, slug, content)
    broadcastProjectsChanged(context.workspaceRoot, context.workspaceId)
  })

  ipcMain.handle(
    PROJECT_IPC_CHANNELS.OPEN_OR_CREATE_BY_PATH,
    (_event, workspaceRoot: string, folderPath: string) => {
      const context = requireProjectWorkspaceRoot(workspaceRoot)
      const result = openOrCreateProjectForPath(context.workspaceRoot, folderPath)
      if (result.created) {
        broadcastProjectsChanged(context.workspaceRoot, context.workspaceId)
      }
      const loaded = projectRepository.getProjectAtRoot(context.workspaceRoot, result.project.slug)
      if (!loaded) throw new Error(`项目创建或复用后无法加载: ${result.project.slug}`)
      return { project: loaded, created: result.created }
    },
  )

  ipcMain.handle(
    PROJECT_IPC_CHANNELS.RESOLVE_EFFECTIVE_CWD,
    (_event, workspaceRoot: string, projectSlug: string) => {
      const context = requireProjectWorkspaceRoot(workspaceRoot)
      const loaded = projectRepository.getProjectAtRoot(context.workspaceRoot, projectSlug)
      if (!loaded) throw new Error(`项目不存在: ${projectSlug}`)
      return resolveEffectiveCwd(context.workspaceRoot, loaded.config)
    },
  )

  ipcMain.handle(
    PROJECT_IPC_CHANNELS.RELOCATE_WORKING_DIRECTORY,
    (_event, workspaceRoot: string, projectSlug: string, newPath: string) => {
      const context = requireProjectWorkspaceRoot(workspaceRoot)
      relocateProjectWorkingDirectory(context.workspaceRoot, projectSlug, newPath)
      const loaded = projectRepository.getProjectAtRoot(context.workspaceRoot, projectSlug)
      if (!loaded) throw new Error(`重新定位后无法加载项目: ${projectSlug}`)
      broadcastProjectsChanged(context.workspaceRoot, context.workspaceId)
      return loaded
    },
  )

  ipcMain.handle(
    PROJECT_IPC_CHANNELS.RESTORE_WORKING_DIRECTORY,
    (_event, workspaceRoot: string, projectSlug: string) => {
      const context = requireProjectWorkspaceRoot(workspaceRoot)
      restoreProjectWorkingDirectory(context.workspaceRoot, projectSlug)
      const loaded = projectRepository.getProjectAtRoot(context.workspaceRoot, projectSlug)
      if (!loaded) throw new Error(`恢复目录后无法加载项目: ${projectSlug}`)
      broadcastProjectsChanged(context.workspaceRoot, context.workspaceId)
      return loaded
    },
  )

  ipcMain.handle(TASK_IPC_CHANNELS.VALIDATE, (_event, yaml: string) => {
    return buildTaskValidationPayload(parseTaskYaml(yaml))
  })

  ipcMain.handle(TASK_IPC_CHANNELS.CREATE, async (_event, workspaceRoot: string, workspaceId: string, request: {
    yaml: string
    orchestratorSessionId?: string
    attachToExistingSessionId?: string
  }) => {
    const context = requireProjectWorkspaceRoot(workspaceRoot, workspaceId)
    const parsed = parseTaskYaml(request.yaml)
    if (!parsed.valid || !parsed.spec) {
      throw new Error(`task.yaml 验证失败: ${parsed.errors?.map((error) => error.message).join(', ')}`)
    }

    if (request.attachToExistingSessionId) {
      const sessionId = request.attachToExistingSessionId
      const repository = new TaskRepository({ resolveWorkspaceRoot: () => context.workspaceRoot })
      const existingTask = repository.getTaskAggregate(context.workspaceId, parsed.spec.id)
      const existingSession = getAgentSessionMeta(sessionId)
      // TaskEditor 的“编辑”必须原地更新同一 Task，不能经 ensureUniqueTaskSlug 复制出第二个聚合根。
      if (existingTask && existingSession?.taskSlug === parsed.spec.id) {
        repository.updateTaskSpec(context.workspaceId, existingTask.taskId, parsed.spec)
        return {
          slug: existingTask.taskSlug,
          taskId: existingTask.taskId,
          orchestratorSessionId: sessionId,
          valid: true,
        }
      }
      const seed = buildTaskSessionSeed(parsed.spec, context.workspaceRoot)
      const result = await materializeTaskTransaction({
        workspaceRoot: context.workspaceRoot,
        workspaceId: context.workspaceId,
        spec: parsed.spec,
        mode: {
          kind: 'attach',
          sessionId,
          sessionPatch: {
            ...(parsed.spec.project ? { projectId: parsed.spec.project } : {}),
            ...seed,
          },
        },
      }, await taskMaterializationDependencies())
      return { ...result, valid: true }
    }

    if (request.orchestratorSessionId) {
      const sessionId = request.orchestratorSessionId
      assertAdoptableTaskDraftSession(sessionId, parsed.spec)
      const result = await materializeTaskTransaction({
        workspaceRoot: context.workspaceRoot,
        workspaceId: context.workspaceId,
        spec: parsed.spec,
        mode: {
          kind: 'adopt',
          sessionId,
          sessionPatch: buildAdoptedTaskSessionPatch(parsed.spec, context.workspaceRoot),
        },
      }, await taskMaterializationDependencies())
      return { ...result, valid: true }
    }

    const result = await materializeTaskFromSpec(context.workspaceRoot, context.workspaceId, parsed.spec)
    return { ...result, valid: true }
  })

  ipcMain.handle(TASK_IPC_CHANNELS.GENERATE, async (_event, workspaceRoot: string, workspaceId: string, request: {
    goal: string
    title?: string
    projectId?: string
    cwd?: string
    model?: string
    llmConnection?: string
    permissionMode?: string
  }) => {
    const context = requireProjectWorkspaceRoot(workspaceRoot, workspaceId)
    const host = await getSessionHost()
    const workingDirectory = request.cwd?.trim()
      || projectRepository.resolveWorkingDirectory(context.workspaceRoot, request.projectId)
    const session = await host.createSession(context.workspaceId, {
      name: request.title ?? request.goal.slice(0, 60),
      projectId: request.projectId,
      taskDraft: true,
      sessionStatus: 'queued',
      ...(workingDirectory ? { workingDirectory } : {}),
      ...(request.model ? { model: request.model } : {}),
      ...(request.llmConnection ? { llmConnection: request.llmConnection } : {}),
      ...(request.permissionMode ? { permissionMode: request.permissionMode } : {}),
    })
    // 延后启动，确保 IPC ack 先回到 renderer 并设置 pendingSessionId，避免 GENERATED 竞态被忽略
    setImmediate(() => {
      void generateTaskForSession(context.workspaceRoot, context.workspaceId, request, session.id)
    })
    return { orchestratorSessionId: session.id }
  })

  ipcMain.handle(TASK_IPC_CHANNELS.RUN, async (_event, workspaceRoot: string, workspaceId: string, slug: string, options?: RunOptions) => {
    const context = requireProjectWorkspaceRoot(workspaceRoot, workspaceId)
    return runTaskOrTeam(context.workspaceRoot, context.workspaceId, slug, options)
  })

  ipcMain.handle(TASK_IPC_CHANNELS.PAUSE, async (_event, workspaceRoot: string, workspaceId: string, slug: string, runId: string) => {
    const context = requireProjectWorkspaceRoot(workspaceRoot, workspaceId)
    await pauseTaskRun(getRunnerFor, context.workspaceRoot, context.workspaceId, slug, runId)
  })

  ipcMain.handle(TASK_IPC_CHANNELS.RESUME, async (_event, workspaceRoot: string, workspaceId: string, slug: string, runId: string) => {
    const context = requireProjectWorkspaceRoot(workspaceRoot, workspaceId)
    ;(await getRunnerFor(context.workspaceRoot, context.workspaceId)).resume(slug, runId)
  })

  ipcMain.handle(TASK_IPC_CHANNELS.STOP, async (_event, workspaceRoot: string, workspaceId: string, slug: string, runId: string) => {
    const context = requireProjectWorkspaceRoot(workspaceRoot, workspaceId)
    await stopTaskRun(getRunnerFor, context.workspaceRoot, context.workspaceId, slug, runId)
  })

  ipcMain.handle(TASK_IPC_CHANNELS.REHYDRATE, async (_event, workspaceRoot: string, workspaceId: string) => {
    const context = requireProjectWorkspaceRoot(workspaceRoot, workspaceId)
    const runner = await getRunnerFor(context.workspaceRoot, context.workspaceId)
    const resumable = listResumableRuns(context.workspaceRoot)
    for (const { slug, runId } of resumable) {
      runner.resume(slug, runId)
    }
    const healed = runner.healAllOrphaned()
    return { restored: resumable.length, healed, runs: resumable }
  })

  ipcMain.handle(TASK_IPC_CHANNELS.GET, (_event, workspaceRoot: string, slug: string) => {
    const context = requireProjectWorkspaceRoot(workspaceRoot)
    return loadTaskSpec(context.workspaceRoot, slug)
  })

  ipcMain.handle(TASK_IPC_CHANNELS.LIST, (_event, workspaceRoot: string) => {
    const context = requireProjectWorkspaceRoot(workspaceRoot)
    return listTaskSlugs(context.workspaceRoot)
  })

  ipcMain.handle(TASK_IPC_CHANNELS.LIST_SUMMARIES, (_event, workspaceRoot: string, workspaceId: string) => {
    const context = requireProjectWorkspaceRoot(workspaceRoot, workspaceId)
    const repository = new TaskRepository({ resolveWorkspaceRoot: () => context.workspaceRoot })
    return repository.listTaskAggregateSummaries(context.workspaceId)
  })

  ipcMain.handle(TASK_IPC_CHANNELS.UPDATE_WORKFLOW, (
    _event,
    workspaceRoot: string,
    workspaceId: string,
    taskId: string,
    workflow: TaskWorkflow,
    expectedRevision?: number,
  ) => {
    const context = requireProjectWorkspaceRoot(workspaceRoot, workspaceId)
    const repository = new TaskRepository({ resolveWorkspaceRoot: () => context.workspaceRoot })
    return repository.updateTaskWorkflow(context.workspaceId, taskId, workflow, expectedRevision)
  })

  ipcMain.handle(TASK_IPC_CHANNELS.UPDATE_METADATA, (
    _event,
    workspaceRoot: string,
    workspaceId: string,
    taskId: string,
    patch: TaskMetadataPatch,
  ) => {
    const context = requireProjectWorkspaceRoot(workspaceRoot, workspaceId)
    const repository = new TaskRepository({ resolveWorkspaceRoot: () => context.workspaceRoot })
    const validatedPatch = patch.labelIds === undefined
      ? patch
      : { ...patch, labelIds: assertValidWorkspaceLabelIds(context.workspaceRoot, patch.labelIds) }
    return repository.updateTaskMetadata(context.workspaceId, taskId, validatedPatch)
  })

  ipcMain.handle(TASK_IPC_CHANNELS.ANALYZE_DELETE_IMPACT, (_event, workspaceRoot: string, slug: string) => {
    const context = requireProjectWorkspaceRoot(workspaceRoot)
    const loaded = loadTaskSpec(context.workspaceRoot, slug)
    if (!loaded?.spec) throw new Error(`Task 不存在: ${slug}`)
    const impact = analyzeTaskDeleteImpact(context.workspaceRoot, slug, listAgentSessions())
    return issueTaskDeleteConfirmation(context.workspaceRoot, slug, impact)
  })

  ipcMain.handle(TASK_IPC_CHANNELS.DELETE, (_event, workspaceRoot: string, workspaceId: string, slug: string, confirmationToken?: string) => {
    const context = requireProjectWorkspaceRoot(workspaceRoot, workspaceId)
    const loaded = loadTaskSpec(context.workspaceRoot, slug)
    if (!loaded?.spec) throw new Error(`Task 不存在: ${slug}`)
    // 删除前重新验证影响分析
    const impact = analyzeTaskDeleteImpact(context.workspaceRoot, slug, listAgentSessions())
    if (impact.activeRunCount > 0) {
      throw new Error(`仍有 ${impact.activeRunCount} 个活跃 Run，请先停止运行`)
    }
    requireDeleteConfirmation(
      confirmationToken,
      'task-purge',
      `${context.workspaceRoot}/tasks/${slug}`,
      impact,
    )
    quarantineForRecovery(
      context.workspaceRoot,
      taskDir(context.workspaceRoot, slug),
      'task',
      slug,
    )
  })

  ipcMain.handle(TASK_IPC_CHANNELS.GET_RESULTS, (_event, workspaceRoot: string, slug: string, runId?: string) => {
    const context = requireProjectWorkspaceRoot(workspaceRoot)
    const selectedRunId = runId ?? getLatestRunId(context.workspaceRoot, slug)
    if (!selectedRunId) return null
    return {
      spec: readRunSpecSnapshot(context.workspaceRoot, slug, selectedRunId),
      log: readRunLog(context.workspaceRoot, slug, selectedRunId),
      runId: selectedRunId,
    }
  })

  ipcMain.handle(SESSION_GROUP_IPC_CHANNELS.LIST, (_event, workspaceSlug: string) => {
    const context = requireWorkspaceSlug(workspaceSlug)
    return listSessionGroups(context.workspaceSlug)
  })

  ipcMain.handle(SESSION_GROUP_IPC_CHANNELS.CREATE, (_event, workspaceSlug: string, name: string) => {
    const context = requireWorkspaceSlug(workspaceSlug)
    return createSessionGroup(context.workspaceSlug, name)
  })

  ipcMain.handle(SESSION_GROUP_IPC_CHANNELS.RENAME, (_event, workspaceSlug: string, id: string, name: string) => {
    const context = requireWorkspaceSlug(workspaceSlug)
    return renameSessionGroup(context.workspaceSlug, id, name)
  })

  ipcMain.handle(SESSION_GROUP_IPC_CHANNELS.DELETE, (_event, workspaceSlug: string, id: string) => {
    const context = requireWorkspaceSlug(workspaceSlug)
    deleteSessionGroup(context.workspaceSlug, id)
  })

  // === Workspace Labels ===

  ipcMain.handle(LABEL_IPC_CHANNELS.LIST, (_event, workspaceRoot: string) => {
    const context = requireProjectWorkspaceRoot(workspaceRoot)
    return new WorkspaceLabelService(context.workspaceRoot).list()
  })

  ipcMain.handle(LABEL_IPC_CHANNELS.CREATE, (_event, workspaceRoot: string, input: { name: string; color?: string }) => {
    const context = requireProjectWorkspaceRoot(workspaceRoot)
    return new WorkspaceLabelService(context.workspaceRoot).create(input)
  })

  ipcMain.handle(LABEL_IPC_CHANNELS.UPDATE, (_event, workspaceRoot: string, labelId: string, patch: { name?: string; color?: string | null; archived?: boolean }) => {
    const context = requireProjectWorkspaceRoot(workspaceRoot)
    return new WorkspaceLabelService(context.workspaceRoot).update(labelId, patch)
  })

  ipcMain.handle(LABEL_IPC_CHANNELS.ARCHIVE, (_event, workspaceRoot: string, labelId: string) => {
    const context = requireProjectWorkspaceRoot(workspaceRoot)
    return new WorkspaceLabelService(context.workspaceRoot).archive(labelId)
  })

  ipcMain.handle(LABEL_IPC_CHANNELS.SET_SESSION_LABELS, (_event, workspaceRoot: string, sessionId: string, labelIds: string[]) => {
    const context = requireProjectWorkspaceRoot(workspaceRoot)
    const session = getAgentSessionMeta(sessionId)
    if (!session) throw new Error(`Agent 会话不存在: ${sessionId}`)
    const validatedLabelIds = validateSessionLabelAssignment(context.workspaceRoot, session, labelIds)
    return updateAgentSessionMeta(sessionId, { labelIds: validatedLabelIds })
  })

  ipcMain.handle(LABEL_IPC_CHANNELS.SET_TASK_LABELS, (_event, workspaceRoot: string, workspaceId: string, taskId: string, labelIds: string[]) => {
    const context = requireProjectWorkspaceRoot(workspaceRoot, workspaceId)
    const validatedLabelIds = assertValidWorkspaceLabelIds(context.workspaceRoot, labelIds)
    const repository = new TaskRepository({ resolveWorkspaceRoot: () => context.workspaceRoot })
    const aggregate = repository.getTaskAggregateById(context.workspaceId, taskId)
    if (!aggregate?.record) throw new Error(`Task ${taskId} 缺少稳定 TaskRecord，不能设置 labels`)
    return repository.updateTaskMetadata(context.workspaceId, taskId, {
      labelIds: validatedLabelIds,
      expectedRevision: aggregate.record.revision,
    })
  })

  ipcMain.handle(SESSION_COMMAND_CHANNEL, async (_event, sessionId: string, command: SessionKanbanCommand) => {
    const host = await getSessionHost()
    switch (command.kind) {
      case 'move_to_workspace':
        return updateAgentSessionMeta(sessionId, { workspaceId: command.workspaceId })
      case 'set_project_id': {
        const meta = getAgentSessionMeta(sessionId)
        const workspace = meta?.workspaceId ? getAgentWorkspace(meta.workspaceId) : undefined
        const resolvedWorkingDirectory = command.projectId && workspace
          ? projectRepository.resolveWorkingDirectory(
              getAgentWorkspacePath(workspace.slug),
              command.projectId,
            )
          : undefined
        return updateAgentSessionMeta(
          sessionId,
          buildSetProjectIdUpdates(command.projectId, resolvedWorkingDirectory, meta?.kanbanColumn),
        )
      }
      case 'set_custom_group':
        return updateAgentSessionMeta(sessionId, { customGroupId: command.groupId })
      case 'set_kanban_column': {
        const sessionStatus = resolveSessionDropStatus(sessionId, command.kanbanColumn)
        return setSessionKanbanColumn(sessionId, command.kanbanColumn, updateAgentSessionMeta, {
          ...(sessionStatus ? { sessionStatus } : {}),
        })
      }
      case 'set_session_status':
        return host.setSessionStatus(sessionId, command.status)
      case 'set_task_node_count':
        return host.setTaskNodeCount(sessionId, command.taskNodeCount)
      default: {
        const _exhaustive: never = command
        return _exhaustive
      }
    }
  })

  ipcMain.handle(TEAMBITION_IPC_CHANNELS.CAPABILITIES, async (_event, workspaceRoot: string) => {
    const context = requireProjectWorkspaceRoot(workspaceRoot)
    return (await getTeambitionService(context.workspaceRoot)).probeCapabilities()
  })

  ipcMain.handle(TEAMBITION_IPC_CHANNELS.LIST_TASKS, async (_event, workspaceRoot: string, projectId: string) => {
    const context = requireProjectWorkspaceRoot(workspaceRoot)
    return (await getTeambitionService(context.workspaceRoot)).listClaimableTasks(projectId)
  })

  ipcMain.handle(TEAMBITION_IPC_CHANNELS.CLAIM_TASK, async (_event, workspaceRoot: string, input: ClaimTeambitionTaskInput) => {
    const context = requireProjectWorkspaceRoot(workspaceRoot)
    return (await getTeambitionService(context.workspaceRoot)).claimTask(input)
  })

  ipcMain.handle(TEAMBITION_IPC_CHANNELS.BIND_PROJECT, async (_event, workspaceRoot: string, sessionId: string, task: TeambitionRemoteTask) => {
    const context = requireProjectWorkspaceRoot(workspaceRoot)
    return (await getTeambitionService(context.workspaceRoot)).bindTask(sessionId, task)
  })

  ipcMain.handle(TEAMBITION_IPC_CHANNELS.GET_BINDING, async (_event, workspaceRoot: string, sessionId: string) => {
    const context = requireProjectWorkspaceRoot(workspaceRoot)
    return (await getTeambitionService(context.workspaceRoot)).getBinding(sessionId)
  })

  ipcMain.handle(TEAMBITION_IPC_CHANNELS.LIST_BINDINGS, async (_event, workspaceRoot: string) => {
    const context = requireProjectWorkspaceRoot(workspaceRoot)
    return (await getTeambitionService(context.workspaceRoot)).listBindings()
  })

  ipcMain.handle(TEAMBITION_IPC_CHANNELS.UPDATE_STATUS, async (_event, workspaceRoot: string, bindingId: string, status: string) => {
    const context = requireProjectWorkspaceRoot(workspaceRoot)
    return (await getTeambitionService(context.workspaceRoot)).syncStatus(bindingId, status)
  })

  ipcMain.handle(TEAMBITION_IPC_CHANNELS.SYNC_PROGRESS, async (_event, workspaceRoot: string, bindingId: string, progress: number) => {
    const context = requireProjectWorkspaceRoot(workspaceRoot)
    return (await getTeambitionService(context.workspaceRoot)).syncProgress(bindingId, progress)
  })

  ipcMain.handle(TEAMBITION_IPC_CHANNELS.RETRY_SYNC, async (_event, workspaceRoot: string, bindingId: string) => {
    const context = requireProjectWorkspaceRoot(workspaceRoot)
    return (await getTeambitionService(context.workspaceRoot)).retryPendingSync(bindingId)
  })
}

async function generateTaskForSession(
  _workspaceRoot: string,
  workspaceId: string,
  request: { goal: string; title?: string; projectId?: string; model?: string; llmConnection?: string; permissionMode?: string },
  sessionId: string,
): Promise<void> {
  const host = await getSessionHost()
  let prompt = buildGeneratorPrompt(request.goal, request.title)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const text = await sendGenerationPrompt(host, sessionId, prompt)
      const yaml = extractYaml(text)
      if (isAgentServiceErrorText(yaml)) throw new Error(yaml)
      const parsed = parseTaskYaml(yaml)
      if (parsed.valid && parsed.spec) {
        // Generate 只返回可编辑草稿，不落盘 task.yaml；正式写入必须等用户点击「创建」。
        await host.setSessionStatus(sessionId, 'done')
        sendToMainWindow(TASK_IPC_CHANNELS.GENERATED, {
          kind: 'tasks:generated',
          workspaceId,
          orchestratorSessionId: sessionId,
          status: 'saved',
          slug: parsed.spec.id,
          spec: parsed.spec,
          yaml,
        } satisfies TaskGeneratedEventPayload)
        return
      }
      const errors = toTaskIssues(parsed.errors)
      console.warn(`[TaskGenerate] 校验失败 attempt=${attempt + 1} session=${sessionId}`, errors)
      if (attempt === 0) {
        prompt = buildRepairPrompt(errors.map((issue) => ({ path: issue.path ?? '<root>', message: issue.message })))
        continue
      }
      await host.setSessionStatus(sessionId, 'needs-review')
      sendToMainWindow(TASK_IPC_CHANNELS.GENERATED, {
        kind: 'tasks:generated',
        workspaceId,
        orchestratorSessionId: sessionId,
        status: 'invalid',
        errors,
      } satisfies TaskGeneratedEventPayload)
      return
    } catch (error) {
      console.error(`[TaskGenerate] 失败 session=${sessionId}:`, errorMessage(error))
      await host.setSessionStatus(sessionId, 'needs-review').catch(() => undefined)
      sendToMainWindow(TASK_IPC_CHANNELS.GENERATED, {
        kind: 'tasks:generated',
        workspaceId,
        orchestratorSessionId: sessionId,
        status: 'error',
        errors: [{ message: errorMessage(error) }],
      } satisfies TaskGeneratedEventPayload)
      return
    }
  }
}

let teambitionAdapter: import('./teambition-adapter').TeambitionAdapter | undefined
const teambitionServices = new Map<string, TeambitionService>()

async function getTeambitionService(workspaceRoot: string): Promise<TeambitionService> {
  const existing = teambitionServices.get(workspaceRoot)
  if (existing) return existing
  const service = new TeambitionService({
    storagePath: join(workspaceRoot, 'teambition-bindings.json'),
    gateway: await getTeambitionAdapter(),
  })
  teambitionServices.set(workspaceRoot, service)
  return service
}

async function getTeambitionAdapter(): Promise<import('./teambition-adapter').TeambitionAdapter> {
  if (teambitionAdapter) return teambitionAdapter
  try {
    const { MockTeambitionAdapter } = await import('./teambition-adapter')
    teambitionAdapter = new MockTeambitionAdapter()
    console.warn('[Teambition] 未配置已验证的 adapter factory，使用本地 Mock 适配器')
    return teambitionAdapter
  } catch (error) {
    throw new Error(`Teambition adapter 不可用: ${errorMessage(error)}`)
  }
}
