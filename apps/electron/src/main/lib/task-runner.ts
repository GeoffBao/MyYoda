/**
 * Conductor — 进程内 DAG 执行引擎（Tasks）
 *
 * task.yaml 描述了一个节点图；每个节点是一个子 session。
 * Conductor 调度就绪节点、发射子 session、监听完成、驱动看板状态。
 *
 * 参照 OSS: packages/server-core/src/tasks/TaskRunner.ts
 * 适配: @craft-agent/ → @myyoda/；CreateSessionOptions/SessionCompletionEvent 本地类型
 */
import { randomUUID } from 'node:crypto'
import {
  nodeTitle,
  DEFAULT_REPAIR_ATTEMPTS,
  MAX_REPAIR_ATTEMPTS_CAP,
  type TaskSpec,
  type TaskNode,
} from '@myyoda/shared/tasks/schema'
import { interpolateRefs, type NodeOutput } from '@myyoda/shared/tasks/refs'
import { materializeDeps } from '@myyoda/shared/tasks/validate'
import {
  appendRunLog,
  initializeRun,
  listResumableRuns,
  loadTaskRecord,
  saveTaskRecord,
  writeNodeOutput,
  readNodeOutput,
  readRunContextSnapshot,
  readRunLog,
  readRunLogIntegrity,
  readRunSpecSnapshot,
  loadTaskSpec,
  type RunLogEntry,
  type NodeRunState,
} from '@myyoda/shared/tasks/storage'
import type { ExpertPackage } from '@myyoda/shared/experts'
import type { ExpertWorkspaceBinding } from '@myyoda/shared/experts/workspace-binding'
import {
  formatExpertPreamble,
  mergeMcpIds,
  mergeSkillSlugs,
  resolveExpertId,
} from '@myyoda/shared/experts'
import {
  describeTaskWorkingDirectoryBlock,
  type TaskWorkingDirectoryResult,
  type TaskWorkingDirectorySource,
} from './task-working-directory'

// ---------------------------------------------------------------------------
// 本地类型（替代 OSS 的 protocol dto / SessionManager）
// ---------------------------------------------------------------------------

export interface SessionCompletionEvent {
  sessionId: string;
  workspaceId: string;
  reason: 'complete' | 'interrupted' | 'error' | 'timeout';
  finalMessageId?: string;
  finalText?: string;
  tokenUsage?: { inputTokens?: number; outputTokens?: number };
}

export interface CreateSessionOptions {
  name?: string;
  permissionMode?: string;
  workingDirectory?: string;
  model?: string;
  llmConnection?: string;
  sessionStatus?: string;
  labels?: string[];
  enabledSourceSlugs?: string[];
  projectId?: string;
  parentSessionId?: string;
  taskSlug?: string;
  taskRunId?: string;
  taskNodeId?: string;
  taskAttempt?: number;
  taskCorrelationKey?: string;
  taskDraft?: boolean;
  applyTaskLabel?: boolean;
}

// ---------------------------------------------------------------------------
// Host 接口
// ---------------------------------------------------------------------------

export interface ConductorSendMessageOptions {
  mentionedSkills?: string[]
  mentionedMcpServers?: string[]
  /** 仅用于生成 task.yaml 草稿：禁止 Agent 调用任何工具，避免生成阶段产生副作用。 */
  toolPolicy?: 'none'
}

export interface ConductorSessionHost {
  createSession(workspaceId: string, options: CreateSessionOptions): Promise<{ id: string }>;
  sendMessage(sessionId: string, message: string, options?: ConductorSendMessageOptions): Promise<void>;
  setSessionStatus(sessionId: string, status: string): Promise<void>;
  setKanbanColumn(sessionId: string, column: string | null): Promise<void>;
  setTaskNodeCount(sessionId: string, count: number): Promise<void>;
  cancelProcessing(sessionId: string, silent?: boolean): Promise<void>;
  onSessionComplete(listener: (evt: SessionCompletionEvent) => void): () => void;
  getSessionFinalText(sessionId: string): string | undefined;
  getSessionWorkingDirectory(sessionId: string): string | undefined;
  findSessionByTaskCorrelationKey?(workspaceId: string, correlationKey: string): { id: string } | undefined;
}

export interface TaskRunnerDeps {
  host: ConductorSessionHost;
  workspaceId: string;
  workspaceRoot: string;
  /** 可选输出摘要器（call_llm/Haiku） */
  summarize?: (text: string) => Promise<string>;
  defaultMaxParallel?: number;
  now?: () => string;
  genRunId?: () => string;
  /** 冷启动/恢复时判断子会话 Agent 是否仍在跑；缺省视为未在跑 */
  isSessionActive?: (sessionId: string) => boolean;
  /** 按专家 id 读取包；缺失返回 null；未注入则跳过专家 preamble */
  getExpert?: (expertId: string) => ExpertPackage | null;
  /** 读取工作区级 Expert binding（覆盖全局 skillSlugs/mcpIds） */
  getWorkspaceExpertBinding?: (expertId: string) => ExpertWorkspaceBinding | null;
  /** 解析项目 defaultExpertId；失败返回 null */
  resolveProjectDefaultExpertId?: (projectId: string) => string | null;
  /** 生产运行必须注入唯一 cwd resolver；测试/旧恢复路径可缺省。 */
  resolveTaskWorkingDirectory?: (spec: TaskSpec) => TaskWorkingDirectoryResult;
}

export interface RunOptions {
  orchestratorSessionId?: string;
  params?: Record<string, unknown>;
  runId?: string;
  verifyOnComplete?: boolean;
}

export type RunStatus = 'running' | 'paused' | 'verifying' | 'stopped' | 'completed' | 'failed';

export interface NodeRunStatus {
  id: string;
  state: NodeRunState;
  sessionId?: string;
  attempt: number;
}

export interface RunSnapshot {
  slug: string;
  runId: string;
  taskId: string;
  status: RunStatus;
  orchestratorSessionId?: string;
  effectiveCwd?: string;
  effectiveCwdSource?: TaskWorkingDirectorySource;
  nodes: NodeRunStatus[];
  tokensUsed: number;
}

interface ActiveRunOptions extends RunOptions {
  verifyOnComplete: boolean;
  taskId: string;
  effectiveCwd?: string;
  effectiveCwdSource?: TaskWorkingDirectorySource;
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const DEFAULT_MAX_PARALLEL = 4;
const AUTONOMOUS_DEFAULT_MODE = 'allow-all' as const;
const RUNNING_STATUS = 'in-progress';
const DONE_STATUS = 'done';
const FAILED_STATUS = 'needs-review';
/** 中断/孤儿节点回退到 todo，避免 UI 永久显示「运行中」 */
const IDLE_STATUS = 'todo';
const MAX_UNPARSED_REASKS = 2;
const MAX_RETAINED_SETTLED_RUNS = 50;

/** Run 只推进机器可控的 workflow；用户已设 done/cancelled 时绝不回写覆盖。 */
function transitionTaskWorkflow(
  workspaceRoot: string,
  slug: string,
  phase: 'started' | 'settled',
): void {
  const loaded = loadTaskRecord(workspaceRoot, slug)
  if (loaded.kind !== 'valid') return
  const current = loaded.record.workflow
  const next = phase === 'started'
    ? (current === 'todo' ? 'in-progress' : current)
    : (current === 'done' || current === 'cancelled' ? current : 'needs-review')
  if (next === current) return
  saveTaskRecord(workspaceRoot, {
    ...loaded.record,
    workflow: next,
    revision: loaded.record.revision + 1,
    updatedAt: Date.now(),
  })
}
const INPUTS_REF_RE = /\$\{\s*inputs\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\}/g;

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
type RunLogEntryInput = DistributiveOmit<RunLogEntry, 't' | 'seq'>;
type RunStartedLogEntry = Extract<RunLogEntry, { kind: 'run-started' }>;

interface NodeStateEntry {
  state: NodeRunState;
  sessionId?: string;
  attempt: number;
  lastFailure?: string;
}

// ---------------------------------------------------------------------------
// ActiveRun — 单次运行的状态机
// ---------------------------------------------------------------------------

class ActiveRun {
  private readonly state = new Map<string, NodeStateEntry>();
  private readonly sessionToNode = new Map<string, string>();
  private readonly outputs: Record<string, NodeOutput> = {};
  private readonly edges: Map<string, Set<string>>;
  private readonly maxParallel: number;
  private inFlight = 0;
  private tokensUsed = 0;
  private readonly sessionTokens = new Map<string, number>();
  private runStatus: RunStatus = 'running';
  private unsubscribe?: () => void;
  private verdictOff?: () => void;
  private repairsUsed = 0;
  private unparsedReAsks = 0;
  private readonly maxRepairs: number;
  private dependents?: Map<string, Set<string>>;
  private settled = false;
  private nextLogSequence = 1;
  private settleResolvers: ((s: RunSnapshot) => void)[] = [];

  constructor(
    private readonly spec: TaskSpec,
    private readonly slug: string,
    private readonly runId: string,
    private readonly opts: ActiveRunOptions,
    private readonly deps: TaskRunnerDeps,
    private readonly onSettled: (snapshot: RunSnapshot) => void,
  ) {
    this.edges = materializeDeps(spec);
    this.maxParallel = spec.max_parallel ?? deps.defaultMaxParallel ?? DEFAULT_MAX_PARALLEL;
    this.maxRepairs = Math.min(spec.max_iterations ?? DEFAULT_REPAIR_ATTEMPTS, MAX_REPAIR_ATTEMPTS_CAP);
    for (const node of spec.nodes) this.state.set(node.id, { state: 'pending', attempt: 0 });
  }

  start(): void {
    this.unsubscribe = this.deps.host.onSessionComplete((evt) => this.onSessionComplete(evt));
    this.log({
      kind: 'run-started',
      taskId: this.opts.taskId,
      taskSlug: this.slug,
      runId: this.runId,
      orchestratorSessionId: this.opts.orchestratorSessionId,
      effectiveCwd: this.opts.effectiveCwd,
      effectiveCwdSource: this.opts.effectiveCwdSource,
      params: this.opts.params,
      verifyOnComplete: this.opts.verifyOnComplete,
    });
    this.runStatus = 'running';
    if (this.opts.orchestratorSessionId) {
      void this.deps.host.setKanbanColumn(this.opts.orchestratorSessionId, 'in-progress');
      void this.deps.host.setSessionStatus(this.opts.orchestratorSessionId, RUNNING_STATUS);
      void this.deps.host.setTaskNodeCount(this.opts.orchestratorSessionId, this.spec.nodes.length);
    }
    this.scheduleReady();
  }

  pause(): void {
    if (this.runStatus !== 'running') return;
    this.runStatus = 'paused';
    this.log({ kind: 'run-paused' });
  }

  resume(): void {
    if (this.runStatus !== 'paused') return;
    for (const [, st] of this.state) if (st.state === 'cancelled') st.state = 'pending';
    this.runStatus = 'running';
    this.log({ kind: 'run-resumed' });
    this.scheduleReady();
  }

  hydrate(log: RunLogEntry[], loadOutput: (nodeId: string) => NodeOutput | null): void {
    this.nextLogSequence = Math.max(0, ...log.map((entry) => entry.seq ?? 0)) + 1;
    const lastNodeEvent = new Map<string, RunLogEntry['kind']>();
    for (const e of log) {
      if ('nodeId' in e) lastNodeEvent.set(e.nodeId, e.kind);
      if (e.kind === 'node-spawned') {
        const st = this.state.get(e.nodeId);
        if (st) {
          st.sessionId = e.sessionId;
          st.state = 'running';
          this.sessionToNode.set(e.sessionId, e.nodeId);
        }
      } else if (e.kind === 'node-scheduled') {
        const st = this.state.get(e.nodeId);
        if (st) st.attempt += 1;
      } else if (e.kind === 'node-finished') {
        const st = this.state.get(e.nodeId);
        if (st) st.state = e.state;
      } else if (e.kind === 'verdict') {
        if (e.result === 'fail') this.repairsUsed += 1;
        else if (e.result === 'unparsed') this.unparsedReAsks += 1;
        else if (e.result === 'pass') this.unparsedReAsks = 0;
      }
    }
    for (const [nodeId, st] of this.state) {
      const lastEvent = lastNodeEvent.get(nodeId)
      if (st.state === 'pending' && (lastEvent === 'node-scheduled' || lastEvent === 'node-dispatch-intent')) {
        // 崩溃发生在 createSession 后、node-spawned 前时，恢复后复用同一 attempt/correlation key。
        st.attempt = Math.max(0, st.attempt - 1)
      }
      if (st.state === 'done') {
        const out = loadOutput(nodeId);
        if (out) this.outputs[nodeId] = out;
        else st.state = 'pending';
      } else if (st.state === 'running') {
        // 仅在显式提供 isSessionActive 时收敛：测试/无回调路径保持等待 completion
        if (this.deps.isSessionActive && st.sessionId && !this.deps.isSessionActive(st.sessionId)) {
          st.state = 'cancelled';
          this.log({ kind: 'node-finished', nodeId, sessionId: st.sessionId, state: 'cancelled', reason: 'orphaned-on-rehydrate' });
          void this.deps.host.setSessionStatus(st.sessionId, IDLE_STATUS);
          void this.deps.host.setKanbanColumn(st.sessionId, 'todo');
        }
      }
    }
    // resume 语义：cancelled（含孤儿收敛）→ pending，以便继续调度未完成节点
    for (const [, st] of this.state) {
      if (st.state === 'cancelled') st.state = 'pending';
    }
    this.inFlight = [...this.state.values()].filter((st) => st.state === 'running').length;
  }

  resumeFromHydrated(): void {
    if (this.unsubscribe) return;
    this.runStatus = 'running';
    this.unsubscribe = this.deps.host.onSessionComplete((evt) => this.onSessionComplete(evt));
    this.log({ kind: 'run-resumed' });
    this.healOrphanedRunningNodes();
    this.scheduleReady();
  }

  /** 运行中节点若 Agent 已不活跃，降级并解除永久卡死的 inFlight（不自动重派，由 maybeFinish 收尾） */
  healOrphanedRunningNodes(): number {
    if (this.isTerminal() || !this.deps.isSessionActive) return 0;
    let healed = 0;
    for (const [nodeId, st] of this.state) {
      if (st.state !== 'running' || !st.sessionId) continue;
      if (this.deps.isSessionActive(st.sessionId)) continue;
      st.state = 'cancelled';
      this.inFlight = Math.max(0, this.inFlight - 1);
      this.log({ kind: 'node-finished', nodeId, sessionId: st.sessionId, state: 'cancelled', reason: 'orphaned' });
      void this.deps.host.setSessionStatus(st.sessionId, IDLE_STATUS);
      void this.deps.host.setKanbanColumn(st.sessionId, 'todo');
      healed += 1;
    }
    if (healed > 0) {
      console.log(`[TaskRunner] 收敛 ${healed} 个孤儿 running 节点 ${this.slug}:${this.runId}`);
    }
    return healed;
  }

  /** 治愈孤儿节点后继续调度 */
  continueAfterHeal(): void {
    if (this.runStatus === 'running') this.scheduleReady();
  }

  async stop(): Promise<void> {
    if (this.isTerminal()) return;
    this.runStatus = 'stopped';
    this.log({ kind: 'run-stopped' });
    for (const [nodeId, st] of this.state) {
      if (st.state === 'running') {
        st.state = 'cancelled';
        this.log({ kind: 'node-finished', nodeId, sessionId: st.sessionId ?? '', state: 'cancelled', reason: 'stopped' });
        if (st.sessionId) {
          void this.deps.host.cancelProcessing(st.sessionId, true);
          void this.deps.host.setSessionStatus(st.sessionId, IDLE_STATUS);
          void this.deps.host.setKanbanColumn(st.sessionId, 'todo');
        }
      }
    }
    this.inFlight = 0;
    const orchestrator = this.opts.orchestratorSessionId;
    if (orchestrator) void this.deps.host.setSessionStatus(orchestrator, IDLE_STATUS);
    transitionTaskWorkflow(this.deps.workspaceRoot, this.slug, 'settled')
    this.finalize();
  }

  waitUntilSettled(): Promise<RunSnapshot> {
    if (this.settled) return Promise.resolve(this.snapshot());
    return new Promise((resolve) => this.settleResolvers.push(resolve));
  }

  snapshot(): RunSnapshot {
    return {
      slug: this.slug, runId: this.runId, taskId: this.opts.taskId,
      status: this.runStatus, orchestratorSessionId: this.opts.orchestratorSessionId,
      effectiveCwd: this.opts.effectiveCwd,
      effectiveCwdSource: this.opts.effectiveCwdSource,
      tokensUsed: this.tokensUsed,
      nodes: this.spec.nodes.map((n) => {
        const st = this.state.get(n.id)!;
        return { id: n.id, state: st.state, sessionId: st.sessionId, attempt: st.attempt };
      }),
    };
  }

  // --- 调度 ---

  private scheduleReady(): void {
    if (this.runStatus !== 'running') return;
    this.healOrphanedRunningNodes();
    for (const node of this.spec.nodes) {
      if (this.inFlight >= this.maxParallel) break;
      if (!this.isReady(node)) continue;
      if (this.isOverBudget()) { this.pauseForBudget(); return; }
      this.markRunning(node);
      void this.dispatch(node);
    }
    this.maybeFinish();
  }

  private isReady(node: TaskNode): boolean {
    if (this.state.get(node.id)!.state !== 'pending') return false;
    for (const dep of this.edges.get(node.id) ?? []) {
      if (this.state.get(dep)?.state !== 'done') return false;
    }
    return true;
  }

  private markRunning(node: TaskNode): void {
    const st = this.state.get(node.id)!;
    st.state = 'running'; st.attempt += 1;
    this.inFlight += 1;
    this.log({ kind: 'node-scheduled', nodeId: node.id });
  }

  private async dispatch(node: TaskNode): Promise<void> {
    try {
      const projectDefault = this.spec.project && this.deps.resolveProjectDefaultExpertId
        ? this.deps.resolveProjectDefaultExpertId(this.spec.project)
        : null;
      const expertId = resolveExpertId(
        node.expertId ?? this.spec.defaults?.expertId,
        projectDefault ?? undefined,
      );
      let expert: ExpertPackage | null = null;
      if (expertId && this.deps.getExpert) {
        try {
          expert = this.deps.getExpert(expertId);
          if (!expert) {
            console.warn(`[TaskRunner] 专家不存在，跳过注入: ${expertId}`);
          }
        } catch (cause) {
          console.warn(`[TaskRunner] 读取专家失败，跳过注入: ${expertId}`, cause);
          expert = null;
        }
        // Resolve workspace binding: override skillSlugs/mcpIds from workspace if present
        if (expert && this.deps.getWorkspaceExpertBinding) {
          const wsBinding = this.deps.getWorkspaceExpertBinding(expertId);
          if (wsBinding) {
            expert = {
              ...expert,
              skillSlugs: wsBinding.skillSlugs,
              mcpIds: wsBinding.mcpIds,
            }
          }
        }
      }
      const mergedSkills = mergeSkillSlugs(this.spec.skills, expert?.skillSlugs);
      const mergedMcps = mergeMcpIds(undefined, expert?.mcpIds);
      const expertBlock = expert ? formatExpertPreamble(expert) : '';
      const prompt = skillsPreamble(mergedSkills) + expertBlock + (await this.buildPrompt(node));
      const cwd = this.opts.effectiveCwd;
      const st = this.state.get(node.id)!;
      const correlationKey = `${this.opts.taskId}/${this.runId}/${node.id}/${st.attempt}`;
      this.log({
        kind: 'node-dispatch-intent',
        nodeId: node.id,
        attempt: st.attempt,
        correlationKey,
      });

      const recovered = this.deps.host.findSessionByTaskCorrelationKey?.(this.deps.workspaceId, correlationKey)
      if (recovered) {
        st.sessionId = recovered.id
        this.sessionToNode.set(recovered.id, node.id)
        this.log({ kind: 'node-spawned', nodeId: node.id, sessionId: recovered.id })
        const finalText = this.deps.host.getSessionFinalText(recovered.id)
        const active = this.deps.isSessionActive?.(recovered.id) ?? true
        if (!active && finalText !== undefined) {
          const output: NodeOutput = { text: finalText }
          this.outputs[node.id] = output
          writeNodeOutput(this.deps.workspaceRoot, this.slug, this.runId, node.id, output)
          st.state = 'done'
          this.inFlight = Math.max(0, this.inFlight - 1)
          this.log({ kind: 'node-finished', nodeId: node.id, sessionId: recovered.id, state: 'done', reason: 'recovered-by-correlation' })
          this.scheduleReady()
        } else if (!active) {
          st.state = 'failed'
          this.inFlight = Math.max(0, this.inFlight - 1)
          this.log({ kind: 'node-finished', nodeId: node.id, sessionId: recovered.id, state: 'failed', reason: 'recovery-required: inactive dispatch has no output' })
          this.pause()
        }
        return
      }

      const options: CreateSessionOptions = {
        parentSessionId: this.opts.orchestratorSessionId,
        taskSlug: this.slug, taskRunId: this.runId, taskNodeId: node.id,
        taskAttempt: st.attempt,
        taskCorrelationKey: correlationKey,
        name: nodeTitle(node),
        model: node.model ?? this.spec.defaults?.model,
        llmConnection: node.llmConnection ?? this.spec.defaults?.llmConnection,
        permissionMode: node.permissionMode ?? this.spec.defaults?.permissionMode ?? AUTONOMOUS_DEFAULT_MODE,
        labels: node.labels,
        applyTaskLabel: true,
        ...(this.spec.sources?.length ? { enabledSourceSlugs: this.spec.sources } : {}),
        projectId: this.spec.project,
        ...(cwd ? { workingDirectory: cwd } : {}),
        sessionStatus: RUNNING_STATUS,
      };
      const child = await this.deps.host.createSession(this.deps.workspaceId, options);
      st.sessionId = child.id;
      this.sessionToNode.set(child.id, node.id);
      this.log({ kind: 'node-spawned', nodeId: node.id, sessionId: child.id });
      await this.deps.host.setKanbanColumn(child.id, 'in-progress');
      await this.deps.host.sendMessage(child.id, prompt, {
        ...(mergedSkills.length > 0 ? { mentionedSkills: mergedSkills } : {}),
        ...(mergedMcps.length > 0 ? { mentionedMcpServers: mergedMcps } : {}),
      });
    } catch (err) {
      this.failNode(node.id, `dispatch 失败: ${(err as Error).message}`);
    }
  }

  private async buildPrompt(node: TaskNode): Promise<string> {
    const inputValues: Record<string, unknown> = {};
    for (const [name, ref] of Object.entries(node.inputs ?? {})) {
      const fromExpr = typeof ref === 'string' ? ref : ref.from;
      const summarize = typeof ref === 'string' ? false : !!ref.summarize;
      let resolved = interpolateRefs(fromExpr, { nodeOutputs: this.outputs, params: this.opts.params });
      if (summarize && this.deps.summarize) resolved = await this.deps.summarize(resolved);
      inputValues[name] = resolved;
    }
    let text = interpolateRefs(node.prompt ?? '', { nodeOutputs: this.outputs, params: this.opts.params });
    text = text.replace(INPUTS_REF_RE, (raw, name: string) => (name in inputValues ? String(inputValues[name]) : raw));
    const st = this.state.get(node.id)!;
    if (st.attempt > 1 && st.lastFailure) text = `${st.lastFailure}\n\n${text}`;
    return text;
  }

  // --- 完成处理 ---

  private onSessionComplete(evt: SessionCompletionEvent): void {
    const nodeId = this.sessionToNode.get(evt.sessionId);
    if (!nodeId) return;
    const st = this.state.get(nodeId);
    if (!st || st.state !== 'running') return;

    if (evt.tokenUsage) {
      const cumulative = (evt.tokenUsage.inputTokens ?? 0) + (evt.tokenUsage.outputTokens ?? 0);
      const prev = this.sessionTokens.get(evt.sessionId) ?? 0;
      this.tokensUsed += Math.max(0, cumulative - prev);
      this.sessionTokens.set(evt.sessionId, cumulative);
    }

    if (this.isOverBudget() && this.runStatus === 'running' && this.hasPendingNodes()) this.pauseForBudget();

    if (evt.reason === 'complete') {
      const text = evt.finalText ?? this.deps.host.getSessionFinalText(evt.sessionId) ?? '';
      const node = this.spec.nodes.find((n) => n.id === nodeId);
      if ((node?.outputs?.length ?? 0) > 0 && text.trim() === '') {
        this.failNode(nodeId, 'completed without producing declared output', evt.sessionId);
        return;
      }
      const output: NodeOutput = { text };
      this.outputs[nodeId] = output;
      st.state = 'done';
      this.inFlight = Math.max(0, this.inFlight - 1);
      writeNodeOutput(this.deps.workspaceRoot, this.slug, this.runId, nodeId, output);
      this.log({ kind: 'node-finished', nodeId, sessionId: evt.sessionId, state: 'done' });
      void this.deps.host.setSessionStatus(evt.sessionId, DONE_STATUS);
      void this.deps.host.setKanbanColumn(evt.sessionId, 'done');
      this.scheduleReady();
    } else if (evt.reason === 'interrupted') {
      st.state = 'cancelled';
      this.inFlight = Math.max(0, this.inFlight - 1);
      this.log({ kind: 'node-finished', nodeId, sessionId: evt.sessionId, state: 'cancelled', reason: 'interrupted' });
      void this.deps.host.setSessionStatus(evt.sessionId, IDLE_STATUS);
      void this.deps.host.setKanbanColumn(evt.sessionId, 'todo');
      this.scheduleReady();
    } else {
      this.failNode(nodeId, evt.reason, evt.sessionId);
    }
  }

  private failNode(nodeId: string, reason: string, sessionId?: string): void {
    const st = this.state.get(nodeId)!;
    const wasRunning = st.state === 'running';
    if (wasRunning) this.inFlight = Math.max(0, this.inFlight - 1);
    const node = this.spec.nodes.find((n) => n.id === nodeId);
    const retry = node?.retry;
    if (retry && st.attempt <= retry.limit && retryMatches(retry.when, 'error')) {
      st.lastFailure = `Previous attempt failed: ${reason}. Address the cause before retrying.`;
      st.state = 'pending';
      const sid = sessionId ?? st.sessionId;
      if (sid) void this.deps.host.setKanbanColumn(sid, 'todo');
      this.log({ kind: 'node-retry', nodeId, attempt: st.attempt, reason });
      this.scheduleReady();
      return;
    }
    st.state = 'failed';
    const sid = sessionId ?? st.sessionId;
    this.log({ kind: 'node-finished', nodeId, sessionId: sid ?? '', state: 'failed', reason });
    if (sid) void this.deps.host.setSessionStatus(sid, FAILED_STATUS);
    this.scheduleReady();
  }

  // --- 完成/验证 ---

  private maybeFinish(): void {
    if (this.runStatus !== 'running') return;
    if (this.inFlight > 0) return;
    if (this.spec.nodes.some((n) => this.isReady(n))) return;
    const allGood = this.spec.nodes.every((n) => {
      const s = this.state.get(n.id)!.state;
      return s === 'done' || s === 'skipped';
    });
    if (!allGood) { this.finish('failed'); return; }
    if (this.opts.verifyOnComplete && this.opts.orchestratorSessionId) {
      this.enterVerifying();
    } else {
      this.finish('completed');
    }
  }

  private enterVerifying(): void {
    this.runStatus = 'verifying';
    this.log({ kind: 'run-verifying' });
    void this.sendVerification();
  }

  private finish(status: RunStatus): void {
    this.runStatus = status;
    this.log({ kind: status === 'completed' ? 'run-completed' : 'run-failed' });
    transitionTaskWorkflow(this.deps.workspaceRoot, this.slug, 'settled')
    const orchestrator = this.opts.orchestratorSessionId;
    if (orchestrator) {
      if (status === 'completed') {
        void this.deps.host.setKanbanColumn(orchestrator, 'done');
        void this.deps.host.setSessionStatus(orchestrator, DONE_STATUS);
      } else {
        void this.deps.host.setSessionStatus(orchestrator, FAILED_STATUS);
      }
    }
    this.finalize();
  }

  private finalize(): void {
    this.unsubscribe?.(); this.unsubscribe = undefined;
    this.verdictOff?.(); this.verdictOff = undefined;
    if (this.settled) return;
    this.settled = true;
    const snap = this.snapshot();
    for (const resolve of this.settleResolvers) resolve(snap);
    this.settleResolvers = [];
    this.onSettled(snap);
  }

  private async sendVerification(): Promise<void> {
    const orchestrator = this.opts.orchestratorSessionId;
    if (!orchestrator) { this.finish('completed'); return; }
    this.attachVerdictListener(orchestrator);
    const sections = this.spec.nodes.map((n) => {
      const out = this.outputs[n.id];
      return `### ${nodeTitle(n)} (${n.id})\n${out ? out.text : '(no output)'}`;
    });
    const rubric = this.spec.acceptance_criteria ? `Acceptance criteria:\n${this.spec.acceptance_criteria}` : `Goal: ${this.spec.goal}`;
    const message = [
      `The task "${this.spec.title}" has finished running.`, '', rubric, '',
      'Node outputs:', ...sections, '',
      'Verify the final result against the criteria above and summarize the outcome.',
      'End your reply with a verdict line, on its own line, in exactly one of these forms:',
      'VERDICT: PASS',
      'VERDICT: FAIL — <one-line reason>',
      'If only some subtasks need redoing, name them so only those (and their dependents) re-run:',
      'VERDICT: FAIL — nodes=<id>,<id> — <one-line reason>',
    ].join('\n');
    await this.sendToOrchestrator(orchestrator, message);
  }

  private attachVerdictListener(orchestrator: string): void {
    this.verdictOff?.();
    this.verdictOff = this.deps.host.onSessionComplete((evt) => {
      if (evt.sessionId !== orchestrator) return;
      this.verdictOff?.(); this.verdictOff = undefined;
      const text = evt.finalText ?? this.deps.host.getSessionFinalText(orchestrator) ?? '';
      this.handleVerdict(text);
    });
  }

  private async sendToOrchestrator(orchestrator: string, message: string): Promise<void> {
    try { await this.deps.host.sendMessage(orchestrator, message); }
    catch { this.verdictOff?.(); this.verdictOff = undefined; this.finish('failed'); }
  }

  private handleVerdict(text: string): void {
    if (this.runStatus !== 'verifying') return;
    writeNodeOutput(this.deps.workspaceRoot, this.slug, this.runId, '__verdict__', { text });
    const verdict = parseVerdict(text);
    this.log({ kind: 'verdict', result: verdict.result, reason: verdict.reason, nodes: verdict.nodes });

    if (verdict.result === 'pass') { this.unparsedReAsks = 0; this.finish('completed'); return; }

    if (verdict.result === 'unparsed') {
      if (this.unparsedReAsks < MAX_UNPARSED_REASKS) { this.unparsedReAsks += 1; void this.reAskVerdict(); return; }
      this.finish('failed'); return;
    }

    if (this.repairsUsed >= this.maxRepairs) {
      this.log({ kind: 'budget-breach', metric: 'iterations', value: this.repairsUsed, limit: this.maxRepairs });
      this.finish('failed'); return;
    }
    if (this.isOverBudget()) {
      this.log({ kind: 'budget-breach', metric: 'tokens', value: this.tokensUsed, limit: this.spec.token_budget! });
      this.finish('failed'); return;
    }
    this.repairsUsed += 1;
    this.repairForVerdict(verdict.reason, verdict.nodes);
  }

  private async reAskVerdict(): Promise<void> {
    const orchestrator = this.opts.orchestratorSessionId;
    if (!orchestrator) { this.finish('completed'); return; }
    this.attachVerdictListener(orchestrator);
    await this.sendToOrchestrator(orchestrator, [
      'Your previous reply did not include a parseable verdict line.',
      'Reply with the verdict line only, on its own line, in exactly one of these forms:',
      'VERDICT: PASS', 'VERDICT: FAIL — <one-line reason>', 'VERDICT: FAIL — nodes=<id>,<id> — <one-line reason>',
    ].join('\n'));
  }

  private repairForVerdict(reason: string | undefined, named?: string[]): void {
    const detail = reason ?? 'the result did not meet the acceptance criteria';
    let reset = 0;
    for (const id of this.computeFrontier(named)) {
      const st = this.state.get(id);
      if (!st || st.state !== 'done') continue;
      st.state = 'pending';
      st.lastFailure = `The previous result was rejected on verification: ${detail}. Revise your output to meet the acceptance criteria.`;
      this.log({ kind: 'node-retry', nodeId: id, attempt: st.attempt, reason: `verdict-fail: ${detail}` });
      reset += 1;
    }
    if (reset === 0) { this.finish('failed'); return; }
    this.runStatus = 'running';
    this.scheduleReady();
  }

  private computeFrontier(named?: string[]): Set<string> {
    const valid = (named ?? []).filter((id) => this.state.has(id));
    if (valid.length === 0) return new Set(this.spec.nodes.map((n) => n.id));
    const dependents = this.dependentsMap();
    const frontier = new Set<string>();
    const queue = [...valid];
    while (queue.length) {
      const id = queue.shift()!;
      if (frontier.has(id)) continue;
      frontier.add(id);
      for (const d of dependents.get(id) ?? []) if (!frontier.has(d)) queue.push(d);
    }
    return frontier;
  }

  private dependentsMap(): Map<string, Set<string>> {
    if (this.dependents) return this.dependents;
    const map = new Map<string, Set<string>>();
    for (const n of this.spec.nodes) map.set(n.id, new Set());
    for (const [node, upstreams] of this.edges) {
      for (const u of upstreams) map.get(u)?.add(node);
    }
    this.dependents = map;
    return map;
  }

  private isOverBudget(): boolean { return this.spec.token_budget !== undefined && this.tokensUsed >= this.spec.token_budget; }
  private pauseForBudget(): void { this.log({ kind: 'budget-breach', metric: 'tokens', value: this.tokensUsed, limit: this.spec.token_budget! }); this.pause(); }
  private hasPendingNodes(): boolean { for (const st of this.state.values()) if (st.state === 'pending') return true; return false; }
  private isTerminal(): boolean { return this.runStatus === 'completed' || this.runStatus === 'failed' || this.runStatus === 'stopped'; }

  private log(entry: RunLogEntryInput): void {
    const t = this.deps.now ? this.deps.now() : new Date().toISOString();
    appendRunLog(this.deps.workspaceRoot, this.slug, this.runId, {
      ...entry,
      t,
      seq: this.nextLogSequence++,
    } as RunLogEntry);
  }
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function skillsPreamble(skills: string[] | undefined): string {
  if (!skills?.length) return '';
  return `Apply these skills: ${skills.map((s) => `[skill:${s}]`).join(' ')}\n\n`;
}

function retryMatches(when: 'error' | 'empty' | 'invalid' | undefined, failure: 'error'): boolean {
  return (when ?? 'error') === failure;
}

function parseVerdict(text: string): { result: 'pass' | 'fail' | 'unparsed'; reason?: string; nodes?: string[] } {
  const matches = [...text.matchAll(/VERDICT:\s*(PASS|FAIL)\b[ \t]*(?:[—:-]+[ \t]*([^\n]*))?/gi)];
  const last = matches.at(-1);
  if (!last) return { result: 'unparsed' };
  const result = last[1]!.toUpperCase() === 'PASS' ? 'pass' : 'fail';
  let rest = last[2]?.trim() || undefined;
  let nodes: string[] | undefined;
  if (rest) {
    const m = rest.match(/^nodes=([a-z0-9,\- ]+?)\s*(?:[—:]+\s*(.*))?$/i);
    if (m) { nodes = m[1]!.split(',').map((s) => s.trim()).filter(Boolean); rest = m[2]?.trim() || undefined; }
  }
  const out: { result: 'pass' | 'fail' | 'unparsed'; reason?: string; nodes?: string[] } = { result };
  if (rest) out.reason = rest;
  if (nodes && nodes.length) out.nodes = nodes;
  return out;
}

function resolveParams(spec: TaskSpec, provided?: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of spec.params ?? []) if (p.default !== undefined) out[p.name] = p.default;
  return { ...out, ...(provided ?? {}) };
}

// ---------------------------------------------------------------------------
// TaskRunner — 注册表/服务
// ---------------------------------------------------------------------------

export class TaskRunner {
  private readonly runs = new Map<string, ActiveRun>();
  private readonly settledRuns = new Map<string, RunSnapshot>();

  constructor(private readonly deps: TaskRunnerDeps) {}

  private key(slug: string, runId: string): string { return `${slug}:${runId}`; }

  private handleRunSettled(key: string, run: ActiveRun, snapshot: RunSnapshot): void {
    if (this.runs.get(key) !== run) return
    this.runs.delete(key)
    this.settledRuns.delete(key)
    this.settledRuns.set(key, snapshot)
    while (this.settledRuns.size > MAX_RETAINED_SETTLED_RUNS) {
      const oldestKey = this.settledRuns.keys().next().value
      if (oldestKey === undefined) break
      this.settledRuns.delete(oldestKey)
    }
  }

  private resolveTaskId(slug: string): string {
    const record = loadTaskRecord(this.deps.workspaceRoot, slug)
    return record.kind === 'valid' ? record.record.taskId : slug
  }

  private resolveEffectiveCwd(spec: TaskSpec, orchestratorSessionId?: string): {
    cwd?: string
    source?: TaskWorkingDirectorySource
  } {
    if (this.deps.resolveTaskWorkingDirectory) {
      const result = this.deps.resolveTaskWorkingDirectory(spec)
      if (result.status === 'blocked') throw new Error(describeTaskWorkingDirectoryBlock(result))
      return { cwd: result.cwd, source: result.source }
    }

    // 旧单元测试/历史兼容路径；生产 getRunnerFor 必须注入统一 resolver。
    const orchestratorCwd = orchestratorSessionId
      ? this.deps.host.getSessionWorkingDirectory(orchestratorSessionId)
      : undefined
    const cwd = orchestratorCwd ?? spec.cwd
    if (!cwd) return {}
    return {
      cwd,
      source: spec.cwd ? 'task' : spec.project ? 'project' : 'workspace',
    }
  }

  run(slug: string, opts: RunOptions = {}): RunSnapshot {
    const loaded = loadTaskSpec(this.deps.workspaceRoot, slug);
    if (!loaded?.spec) throw new Error(`任务 "${slug}" 不存在或没有有效的 task.yaml`);
    if (!loaded.valid) throw new Error(`拒绝运行无效任务 "${slug}": ${loaded.errors.map((e) => e.message).join('; ')}`);
    return this.runWithSpec(loaded.spec, slug, opts);
  }

  /**
   * 用给定 spec 启动运行（团队任务展开后复用静态执行路径）。
   * 仍会校验任务是否已有活跃 Run，并持久化展开后的 spec 供 rehydrate 恢复。
   */
  runWithSpec(spec: TaskSpec, slug: string, opts: RunOptions = {}): RunSnapshot {
    const loaded = loadTaskSpec(this.deps.workspaceRoot, slug);
    if (!loaded?.spec) throw new Error(`任务 "${slug}" 不存在或没有有效的 task.yaml`);
    if (!loaded.valid) throw new Error(`拒绝运行无效任务 "${slug}": ${loaded.errors.map((e) => e.message).join('; ')}`);

    const activeRun = listResumableRuns(this.deps.workspaceRoot).find((candidate) => candidate.slug === slug)
    if (activeRun) {
      throw new Error(`任务 "${slug}" 已有活跃 Run (${activeRun.runId})，请恢复或停止后再运行`)
    }

    const runId = opts.runId ?? (this.deps.genRunId ? this.deps.genRunId() : randomUUID());
    const taskId = this.resolveTaskId(slug)
    const effectiveCwd = this.resolveEffectiveCwd(spec, opts.orchestratorSessionId)
    const verifyOnComplete = opts.verifyOnComplete ?? true
    const createdAt = this.deps.now?.() ?? new Date().toISOString()

    initializeRun(this.deps.workspaceRoot, slug, runId, spec, {
      schemaVersion: 1,
      taskId,
      taskSlug: slug,
      runId,
      scope: spec.project
        ? { kind: 'project', projectId: spec.project }
        : { kind: 'workspace' },
      ...(effectiveCwd.cwd && effectiveCwd.source
        ? { effectiveCwd: effectiveCwd.cwd, effectiveCwdSource: effectiveCwd.source }
        : {}),
      ...(opts.orchestratorSessionId ? { orchestratorSessionId: opts.orchestratorSessionId } : {}),
      createdAt,
      verifyOnComplete,
    })

    transitionTaskWorkflow(this.deps.workspaceRoot, slug, 'started')

    const runKey = this.key(slug, runId)
    let run: ActiveRun
    run = new ActiveRun(
      spec, slug, runId,
      {
        ...opts,
        taskId,
        effectiveCwd: effectiveCwd.cwd,
        effectiveCwdSource: effectiveCwd.source,
        params: resolveParams(spec, opts.params),
        verifyOnComplete,
      },
      this.deps,
      (snapshot) => this.handleRunSettled(runKey, run, snapshot),
    );
    this.settledRuns.delete(runKey)
    this.runs.set(runKey, run);
    try {
      run.start();
    } catch (error) {
      this.runs.delete(runKey)
      transitionTaskWorkflow(this.deps.workspaceRoot, slug, 'settled')
      throw error
    }
    return run.snapshot();
  }

  pause(slug: string, runId: string): void { this.runs.get(this.key(slug, runId))?.pause(); }

  resume(slug: string, runId: string): void {
    const existing = this.runs.get(this.key(slug, runId));
    if (existing) { existing.resume(); return; }
    this.rehydrate(slug, runId);
  }

  private rehydrate(slug: string, runId: string): RunSnapshot {
    const snapshotSpec = readRunSpecSnapshot(this.deps.workspaceRoot, slug, runId);
    const spec = snapshotSpec ?? (() => {
      const loaded = loadTaskSpec(this.deps.workspaceRoot, slug);
      if (!loaded?.spec || !loaded.valid) throw new Error(`无法恢复 "${slug}:${runId}"：task.yaml 无效或缺失`);
      return loaded.spec;
    })();
    const integrity = readRunLogIntegrity(this.deps.workspaceRoot, slug, runId);
    if (integrity.recoveryRequired) {
      throw new Error(`无法自动恢复 "${slug}:${runId}"：运行日志损坏，需要人工诊断`)
    }
    const log = integrity.entries;
    if (log.length === 0) throw new Error(`无法恢复 "${slug}:${runId}"：没有运行日志`);
    const started = log.find((entry): entry is RunStartedLogEntry => entry.kind === 'run-started');
    const context = readRunContextSnapshot(this.deps.workspaceRoot, slug, runId)
    const orchestratorSessionId = context?.orchestratorSessionId ?? started?.orchestratorSessionId;
    const legacyCwd = context?.effectiveCwd || started?.effectiveCwd
      ? {}
      : this.resolveEffectiveCwd(spec, orchestratorSessionId)
    const runKey = this.key(slug, runId)
    let run: ActiveRun
    run = new ActiveRun(
      spec, slug, runId,
      {
        orchestratorSessionId,
        taskId: context?.taskId ?? started?.taskId ?? this.resolveTaskId(slug),
        effectiveCwd: context?.effectiveCwd ?? started?.effectiveCwd ?? legacyCwd.cwd,
        effectiveCwdSource: context?.effectiveCwdSource ?? started?.effectiveCwdSource ?? legacyCwd.source,
        params: started?.params ?? resolveParams(spec),
        verifyOnComplete: context?.verifyOnComplete ?? started?.verifyOnComplete ?? true,
      },
      this.deps,
      (snapshot) => this.handleRunSettled(runKey, run, snapshot),
    );
    run.hydrate(log, (nodeId) => readNodeOutput(this.deps.workspaceRoot, slug, runId, nodeId));
    this.settledRuns.delete(runKey)
    this.runs.set(runKey, run);
    run.resumeFromHydrated();
    return run.snapshot();
  }

  async stop(slug: string, runId: string): Promise<void> { await this.runs.get(this.key(slug, runId))?.stop(); }
  getRunState(slug: string, runId: string): RunSnapshot | null {
    const key = this.key(slug, runId)
    return this.runs.get(key)?.snapshot() ?? this.settledRuns.get(key) ?? null
  }

  /** 扫描活跃运行并收敛孤儿节点；返回治愈数量 */
  healAllOrphaned(): number {
    let total = 0;
    for (const run of this.runs.values()) {
      const healed = run.healOrphanedRunningNodes();
      if (healed > 0) {
        total += healed;
        run.continueAfterHeal();
      }
    }
    return total;
  }

  waitUntilSettled(slug: string, runId: string): Promise<RunSnapshot> {
    const key = this.key(slug, runId)
    const run = this.runs.get(key);
    if (!run) {
      const snapshot = this.settledRuns.get(key)
      return snapshot
        ? Promise.resolve(snapshot)
        : Promise.reject(new Error(`没有活跃的运行 ${slug}:${runId}`))
    }
    return run.waitUntilSettled();
  }
}

function isTerminalRunStatus(status: RunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'stopped';
}
