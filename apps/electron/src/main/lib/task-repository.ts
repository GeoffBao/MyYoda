import { z } from 'zod'
import type { AgentSessionMeta } from '@myyoda/shared'
import type { NodeOutput } from '../../../../../packages/shared/src/tasks/refs.ts'
import type { TaskSpec } from '../../../../../packages/shared/src/tasks/schema.ts'
import type { ValidationResult } from '../../../../../packages/shared/src/tasks/validate.ts'
import {
  appendRunLog as appendRunLogInStorage,
  getLatestRunId,
  listRunIds,
  listTaskAggregateSlugs,
  listTaskSlugs,
  loadTaskRecord,
  loadTaskSpec,
  readNodeOutput,
  readRunContextSnapshot,
  readRunLog,
  readRunSpecSnapshot,
  rehydrateNodeStates,
  saveTaskRecord,
  saveTaskSpec,
  writeNodeOutput as writeNodeOutputInStorage,
  writeRunSpecSnapshot as writeRunSpecSnapshotInStorage,
  type RehydratedNodeState,
  type RunLogEntry,
} from '../../../../../packages/shared/src/tasks/storage.ts'
import { TaskWorkflowSchema, type TaskAggregateSummary, type TaskMetadataPatch, type TaskRecord, type TaskWorkflow } from '../../../../../packages/shared/src/tasks/task-record.ts'
import { validateTaskInput } from '../../../../../packages/shared/src/tasks/validate.ts'
import { getAgentWorkspace } from './agent-workspace-manager'
import { getAgentWorkspacePath } from './config-paths'
import {
  backfillLegacyTaskRecords,
  type BackfillLegacyTaskRecordsInput,
  type TaskMigrationResult,
} from './task-migration-service'

const WorkspaceIdSchema = z.string().min(1, 'workspaceId 必填')
const TaskSlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'task slug 必须是 URL-safe slug')
const RunIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'runId 必须是安全的路径片段')

export interface TaskDiagnostic {
  code: 'missing-task-record' | 'invalid-task-record' | 'unsupported-task-record' | 'missing-task-spec' | 'invalid-task-spec'
  severity: 'warning' | 'error'
  message: string
}

export interface TaskAggregate {
  taskId: string
  taskSlug: string
  spec: TaskSpec | null
  record: TaskRecord | null
  legacyIdentity: boolean
  diagnostics: TaskDiagnostic[]
  runIds: string[]
}

export interface TaskRunState {
  taskId: string
  taskSlug: string
  runId: string
  spec: TaskSpec | null
  log: RunLogEntry[]
  nodeStates: Record<string, RehydratedNodeState>
  nodeOutputs: Record<string, NodeOutput>
  effectiveCwd?: string
  effectiveCwdSource?: 'task' | 'project' | 'workspace'
}

export interface TaskRepositoryOptions {
  resolveWorkspaceRoot?: (workspaceId: string) => string
}

export interface TaskValidationResult extends ValidationResult {
  spec?: TaskSpec
}

function resolveWorkspaceRootFromManager(workspaceId: string): string {
  const workspace = getAgentWorkspace(workspaceId)
  if (!workspace) {
    throw new Error(`工作区不存在: ${workspaceId}`)
  }
  return getAgentWorkspacePath(workspace.slug)
}

export class TaskRepository {
  constructor(private readonly options: TaskRepositoryOptions = {}) {}

  private resolveWorkspaceRoot(workspaceId: string): string {
    const parsedWorkspaceId = WorkspaceIdSchema.parse(workspaceId)
    return (this.options.resolveWorkspaceRoot ?? resolveWorkspaceRootFromManager)(parsedWorkspaceId)
  }

  private parseTaskSlug(taskSlug: string): string {
    return TaskSlugSchema.parse(taskSlug)
  }

  private parseRunId(runId: string): string {
    return RunIdSchema.parse(runId)
  }

  listTasks(workspaceId: string): string[] {
    return listTaskSlugs(this.resolveWorkspaceRoot(workspaceId))
  }

  private buildTaskAggregate(workspaceId: string, workspaceRoot: string, taskSlug: string): TaskAggregate {
    const slug = this.parseTaskSlug(taskSlug)
    const loadedSpec = loadTaskSpec(workspaceRoot, slug)
    const loadedRecord = loadTaskRecord(workspaceRoot, slug)
    const diagnostics: TaskDiagnostic[] = []

    let record: TaskRecord | null = null
    if (loadedRecord.kind === 'valid') {
      record = loadedRecord.record
    } else if (loadedRecord.kind === 'missing') {
      diagnostics.push({
        code: 'missing-task-record',
        severity: 'warning',
        message: '旧版 Task 尚未建立稳定 taskId',
      })
    } else if (loadedRecord.kind === 'unsupported') {
      diagnostics.push({
        code: 'unsupported-task-record',
        severity: 'error',
        message: `task.json 版本 ${loadedRecord.schemaVersion} 高于当前客户端支持范围`,
      })
    } else {
      diagnostics.push({
        code: 'invalid-task-record',
        severity: 'error',
        message: loadedRecord.message,
      })
    }

    let spec: TaskSpec | null = null
    if (loadedSpec?.valid && loadedSpec.spec) {
      spec = loadedSpec.spec
    } else if (loadedSpec === null) {
      diagnostics.push({
        code: 'missing-task-spec',
        severity: 'error',
        message: '缺少 task.yaml；历史 Runs 仍可用于恢复和诊断',
      })
    } else {
      diagnostics.push({
        code: 'invalid-task-spec',
        severity: 'error',
        message: loadedSpec.errors.map((issue) => `${issue.path}: ${issue.message}`).join('; '),
      })
    }

    return {
      taskId: record?.taskId ?? `legacy:${workspaceId}:${slug}`,
      taskSlug: slug,
      spec,
      record,
      legacyIdentity: record === null,
      diagnostics,
      runIds: listRunIds(workspaceRoot, slug),
    }
  }

  listTaskAggregates(workspaceId: string): TaskAggregate[] {
    const parsedWorkspaceId = WorkspaceIdSchema.parse(workspaceId)
    const workspaceRoot = this.resolveWorkspaceRoot(parsedWorkspaceId)
    return listTaskAggregateSlugs(workspaceRoot)
      .map((slug) => this.buildTaskAggregate(parsedWorkspaceId, workspaceRoot, slug))
  }

  listTaskAggregateSummaries(workspaceId: string): TaskAggregateSummary[] {
    const workspaceRoot = this.resolveWorkspaceRoot(workspaceId)
    return this.listTaskAggregates(workspaceId).map((task) => {
      const hasError = task.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
      const hasWarning = task.diagnostics.some((diagnostic) => diagnostic.severity === 'warning')
      const projectId = task.spec?.project
      return {
        taskId: task.taskId,
        taskSlug: task.taskSlug,
        title: task.spec?.title ?? task.taskSlug,
        goal: task.spec?.goal,
        scope: projectId
          ? { kind: 'project' as const, projectId }
          : { kind: 'workspace' as const },
        workflow: task.record?.workflow ?? 'todo',
        kanbanColumn: task.record?.kanbanColumn,
        revision: task.record?.revision,
        labelIds: task.record?.labelIds ?? [],
        orchestratorSessionId: task.record?.orchestratorSessionId,
        archivedAt: task.record?.archivedAt,
        createdAt: task.record?.createdAt,
        updatedAt: task.record?.updatedAt,
        runCount: task.runIds.length,
        latestRunId: getLatestRunId(workspaceRoot, task.taskSlug),
        legacyIdentity: task.legacyIdentity,
        health: hasError ? 'error' as const : hasWarning ? 'warning' as const : 'ready' as const,
        diagnostics: task.diagnostics,
      }
    })
  }

  updateTaskWorkflow(
    workspaceId: string,
    taskId: string,
    workflow: TaskWorkflow,
    expectedRevision?: number,
    now: () => number = Date.now,
  ): TaskAggregateSummary {
    const parsedWorkflow = TaskWorkflowSchema.parse(workflow)
    const aggregate = this.getTaskAggregateById(workspaceId, taskId)
    if (!aggregate) throw new Error(`Task 不存在: ${taskId}`)
    if (!aggregate.record) {
      throw new Error('旧版 Task 尚未迁移稳定身份，缺少稳定 TaskRecord，不能直接更新 Workflow')
    }
    if (expectedRevision !== undefined && aggregate.record.revision !== expectedRevision) {
      throw new Error(`Task revision 冲突: 期望 ${expectedRevision}，实际 ${aggregate.record.revision}`)
    }
    const workspaceRoot = this.resolveWorkspaceRoot(workspaceId)
    saveTaskRecord(workspaceRoot, {
      ...aggregate.record,
      workflow: parsedWorkflow,
      revision: aggregate.record.revision + 1,
      updatedAt: now(),
    })
    const updated = this.listTaskAggregateSummaries(workspaceId)
      .find((task) => task.taskId === taskId)
    if (!updated) throw new Error(`更新后无法读取 Task: ${taskId}`)
    return updated
  }

  updateTaskSpec(
    workspaceId: string,
    taskId: string,
    spec: TaskSpec,
    now: () => number = Date.now,
  ): TaskAggregateSummary {
    const aggregate = this.getTaskAggregateById(workspaceId, taskId)
    if (!aggregate) throw new Error(`Task 不存在: ${taskId}`)
    if (!aggregate.spec) throw new Error(`Task 缺少可更新的 task.yaml: ${taskId}`)
    if (spec.id !== aggregate.taskSlug) {
      throw new Error(`Task slug 不可在编辑时变更: ${aggregate.taskSlug} → ${spec.id}`)
    }
    const workspaceRoot = this.resolveWorkspaceRoot(workspaceId)
    const previousSpec = aggregate.spec
    saveTaskSpec(workspaceRoot, spec)
    try {
      if (aggregate.record) {
        saveTaskRecord(workspaceRoot, {
          ...aggregate.record,
          revision: aggregate.record.revision + 1,
          updatedAt: now(),
        })
      }
    } catch (cause) {
      saveTaskSpec(workspaceRoot, previousSpec)
      throw cause
    }
    const updated = this.listTaskAggregateSummaries(workspaceId)
      .find((task) => task.taskId === taskId)
    if (!updated) throw new Error(`更新后无法读取 Task: ${taskId}`)
    return updated
  }

  updateTaskMetadata(
    workspaceId: string,
    taskId: string,
    patch: TaskMetadataPatch,
    now: () => number = Date.now,
  ): TaskAggregateSummary {
    if (patch.title === undefined && patch.archived === undefined && patch.labelIds === undefined && patch.kanbanColumn === undefined) {
      throw new Error('Task metadata patch 不能为空')
    }
    const aggregate = this.getTaskAggregateById(workspaceId, taskId)
    if (!aggregate) throw new Error(`Task 不存在: ${taskId}`)
    if (patch.expectedRevision !== undefined) {
      if (!aggregate.record || aggregate.record.revision !== patch.expectedRevision) {
        throw new Error(`Task revision 冲突: 期望 ${patch.expectedRevision}，实际 ${aggregate.record?.revision ?? 'legacy'}`)
      }
    }
    if (patch.archived !== undefined && !aggregate.record) {
      throw new Error('旧版 Task 尚未迁移稳定身份，缺少稳定 TaskRecord，不能归档')
    }
    const workspaceRoot = this.resolveWorkspaceRoot(workspaceId)
    const previousSpec = aggregate.spec
    if (patch.title !== undefined) {
      const title = patch.title.trim()
      if (!title) throw new Error('Task 标题不能为空')
      if (!previousSpec) throw new Error(`Task ${aggregate.taskSlug} 缺少有效 task.yaml，不能重命名`)
      saveTaskSpec(workspaceRoot, { ...previousSpec, title })
    }
    try {
      if (aggregate.record) {
        const updatedAt = now()
        saveTaskRecord(workspaceRoot, {
          ...aggregate.record,
          ...(patch.labelIds !== undefined ? { labelIds: patch.labelIds } : {}),
          ...(patch.kanbanColumn !== undefined ? { kanbanColumn: patch.kanbanColumn } : {}),
          ...(patch.archived === undefined
            ? {}
            : patch.archived
              ? { archivedAt: updatedAt }
              : { archivedAt: undefined }),
          revision: aggregate.record.revision + 1,
          updatedAt,
        })
      }
    } catch (cause) {
      if (patch.title !== undefined && previousSpec) saveTaskSpec(workspaceRoot, previousSpec)
      throw cause
    }
    const updated = this.listTaskAggregateSummaries(workspaceId)
      .find((task) => task.taskId === taskId)
    if (!updated) throw new Error(`更新后无法读取 Task: ${taskId}`)
    return updated
  }

  getTaskAggregate(workspaceId: string, taskSlug: string): TaskAggregate | null {
    const parsedWorkspaceId = WorkspaceIdSchema.parse(workspaceId)
    const workspaceRoot = this.resolveWorkspaceRoot(parsedWorkspaceId)
    const slug = this.parseTaskSlug(taskSlug)
    if (!listTaskAggregateSlugs(workspaceRoot).includes(slug)) return null
    return this.buildTaskAggregate(parsedWorkspaceId, workspaceRoot, slug)
  }

  getTaskAggregateById(workspaceId: string, taskId: string): TaskAggregate | null {
    const parsedTaskId = z.string().min(1, 'taskId 必填').parse(taskId)
    return this.listTaskAggregates(workspaceId).find((task) => task.taskId === parsedTaskId) ?? null
  }

  migrateLegacyTaskRecords(
    workspaceId: string,
    sessions: readonly AgentSessionMeta[],
    options: Pick<BackfillLegacyTaskRecordsInput, 'now' | 'generateTaskId' | 'includeLegacyUnscopedSessions'> = {},
  ): TaskMigrationResult {
    const parsedWorkspaceId = WorkspaceIdSchema.parse(workspaceId)
    return backfillLegacyTaskRecords({
      workspaceId: parsedWorkspaceId,
      workspaceRoot: this.resolveWorkspaceRoot(parsedWorkspaceId),
      sessions,
      ...options,
    })
  }

  getTask(workspaceId: string, taskSlug: string): TaskValidationResult | null {
    return loadTaskSpec(this.resolveWorkspaceRoot(workspaceId), this.parseTaskSlug(taskSlug))
  }

  validateTask(input: unknown): TaskValidationResult {
    return validateTaskInput(input)
  }

  saveTask(workspaceId: string, spec: TaskSpec): TaskSpec {
    saveTaskSpec(this.resolveWorkspaceRoot(workspaceId), spec)
    const loaded = this.getTask(workspaceId, spec.id)
    if (!loaded?.spec || !loaded.valid) {
      throw new Error(`任务保存后重读失败: ${spec.id}`)
    }
    return loaded.spec
  }

  listRuns(workspaceId: string, taskSlug: string): string[] {
    return listRunIds(this.resolveWorkspaceRoot(workspaceId), this.parseTaskSlug(taskSlug))
  }

  appendRunLog(workspaceId: string, taskSlug: string, runId: string, entry: RunLogEntry): void {
    appendRunLogInStorage(
      this.resolveWorkspaceRoot(workspaceId),
      this.parseTaskSlug(taskSlug),
      this.parseRunId(runId),
      entry,
    )
  }

  writeRunSpecSnapshot(workspaceId: string, taskSlug: string, runId: string, spec: TaskSpec): void {
    writeRunSpecSnapshotInStorage(
      this.resolveWorkspaceRoot(workspaceId),
      this.parseTaskSlug(taskSlug),
      this.parseRunId(runId),
      spec,
    )
  }

  writeNodeOutput(workspaceId: string, taskSlug: string, runId: string, nodeId: string, output: NodeOutput): void {
    writeNodeOutputInStorage(
      this.resolveWorkspaceRoot(workspaceId),
      this.parseTaskSlug(taskSlug),
      this.parseRunId(runId),
      nodeId,
      output,
    )
  }

  getRunState(workspaceId: string, taskSlug: string, runId: string): TaskRunState | null {
    const workspaceRoot = this.resolveWorkspaceRoot(workspaceId)
    const slug = this.parseTaskSlug(taskSlug)
    const parsedRunId = this.parseRunId(runId)
    const spec = readRunSpecSnapshot(workspaceRoot, slug, parsedRunId)
      ?? loadTaskSpec(workspaceRoot, slug)?.spec
      ?? null
    const log = readRunLog(workspaceRoot, slug, parsedRunId)
    const context = readRunContextSnapshot(workspaceRoot, slug, parsedRunId)

    if (spec === null && log.length === 0 && context === null) {
      return null
    }

    const nodeIds = new Set(spec?.nodes.map((node) => node.id) ?? [])
    for (const entry of log) {
      if (
        entry.kind === 'node-scheduled' ||
        entry.kind === 'node-spawned' ||
        entry.kind === 'node-finished' ||
        entry.kind === 'node-retry'
      ) {
        nodeIds.add(entry.nodeId)
      }
    }
    const nodeOutputs: Record<string, NodeOutput> = {}
    const nodeStates = rehydrateNodeStates(Array.from(nodeIds), log, (nodeId) => {
      const output = readNodeOutput(workspaceRoot, slug, parsedRunId, nodeId)
      if (output) {
        nodeOutputs[nodeId] = output
      }
      return output
    })

    const started = log.find((entry) => entry.kind === 'run-started')
    const liveRecord = loadTaskRecord(workspaceRoot, slug)
    return {
      taskId: context?.taskId
        ?? started?.taskId
        ?? (liveRecord.kind === 'valid' ? liveRecord.record.taskId : slug),
      taskSlug: slug,
      runId: parsedRunId,
      spec,
      log,
      nodeStates,
      nodeOutputs,
      effectiveCwd: context?.effectiveCwd ?? started?.effectiveCwd,
      effectiveCwdSource: context?.effectiveCwdSource ?? started?.effectiveCwdSource,
    }
  }
}
