/**
 * Tasks DAG 编排界面的纯 spec ↔ 编辑表单转换。
 *
 * 从 `TaskEditor.tsx` 提取，使“生成 spec → 可编辑行 → 发送至 `tasks:create` 的 spec”往返过程
 * 无需 React 组件树即可单测。生成器写入节点 ID 后，同级 prompt 中的
 * `${nodes.<id>.output}` 引用必须保持不变，否则 `tasks:create` 会拒绝悬空引用。
 */
import { slugify } from '@myyoda/shared/utils'
import { MAX_REPAIR_ATTEMPTS_CAP, TaskSpecSchema } from '@myyoda/shared/tasks/schema'
import type { PermissionMode, TaskSpec } from '@myyoda/shared/tasks/schema'

let _uid = 0
/** 单调递增的本地行 ID（不是 task node ID），供编辑器和转换函数共用以避免冲突。 */
export const uid = (): string => `st-${++_uid}`

/**
 * 被任务 DAG 接纳的 quick-add 子会话使用确定性的 spec node ID：`qa-<sessionId>`。
 * 接纳关系直接编码在 node ID 中，不依赖 session 标记或标题匹配：编辑器不会重复合并已是 spec
 * node 的 qa 子会话；看板则将该 node 行关联回原 session，直至 Conductor run 产生的
 * `taskNodeId` 匹配结果取代它。session ID 是小写 slug（如 `260703-agile-moor`），因此结果
 * 满足 schema 的 node-id `SLUG_RE`。
 */
export const QUICK_ADD_NODE_PREFIX = 'qa-'
export const quickAddNodeId = (sessionId: string): string => `${QUICK_ADD_NODE_PREFIX}${sessionId}`
/** {@link quickAddNodeId} 的逆操作：返回接纳的 session ID，普通 node ID 返回 undefined。 */
export const quickAddSessionId = (nodeId: string): string | undefined =>
  nodeId.startsWith(QUICK_ADD_NODE_PREFIX) ? nodeId.slice(QUICK_ADD_NODE_PREFIX.length) : undefined

/**
 * 将 quick-add 子会话映射为已接纳的 DAG 子任务行。该函数是纯函数（调用方解析 `title`），因此无需
 * 编辑器即可验证模型与 connection 的保留契约。仅当子会话显式设置时才保留 `model`/`llmConnection`
 * （undefined 表示继承 orchestrator 默认值），避免接纳使用自定义路由的子会话时丢失其后端。
 */
export function quickAddChildToSubtask(child: {
  sessionId: string
  title: string
  model?: string
  llmConnection?: string
}): EditorSubtask {
  return {
    uid: uid(),
    nodeId: quickAddNodeId(child.sessionId),
    title: child.title,
    prompt: child.title,
    dependsOn: [],
    ...(child.model ? { model: child.model } : {}),
    ...(child.llmConnection ? { llmConnection: child.llmConnection } : {}),
  }
}

export interface EditorSubtask {
  uid: string
  // 生成或加载的 spec 原始 node ID；编辑器往返时保留它，确保同级 prompt 中 AI 写入的
  // ${nodes.<id>.output} 仍可解析。手动新增的子任务没有该值，ID 由标题生成。
  nodeId?: string
  title: string
  prompt: string
  // 显式指定的模型。undefined 表示继承 orchestrator 默认值，buildSpec 不会为节点写入
  // `model`/`llmConnection`，从而避免原本继承路由的 spec 被静默固定到某个模型。
  model?: string
  // 服务该 `model` 的显式 connection，从加载的 spec 中保留。undefined 时由显式 `model` 推导
  // （或继续继承），以保留“节点 connection 不等于模型默认 connection”的配置。
  llmConnection?: string
  // 当前节点的所有依赖边，使用本地 uid 而不是 node ID。支持 fan-in，使
  // `depends_on: [A, B]` 的每条边都可见、可编辑；上游删除后无法解析的 uid 由 buildSpec 丢弃，
  // 不会输出悬空引用。
  dependsOn: string[]
}

export interface SpecForm {
  title: string
  goal: string
  /** orchestrator 评估完成结果的可检查准则，持久化为 `acceptance_criteria`。 */
  acceptanceCriteria?: string
  /** FAIL verdict 后的最大修复次数，持久化为 spec 的 `max_iterations`。 */
  maxRepairs?: number
  projectId: string
  orchModel: string
  /** 服务 orchestrator 模型的 connection；除非用户切换模型，否则从加载的 spec `defaults` 保留，
   *  并输出为 `defaults.llmConnection`。 */
  orchConnection?: string
  /** 整个任务族（orchestrator + children）的权限模式，输出为 `defaults.permissionMode`，
   *  使子任务自主性显式持久化而非隐含默认值。 */
  permissionMode?: PermissionMode
  /** Agent 专家 slug，持久化为 `defaults.expertId`。 */
  expertId?: string
  /** 专家团 id，持久化为 `defaults.teamId`（团队运行时团长拆解委派，与 expertId 互斥）。 */
  teamId?: string
  /** 任务已有的 project 绑定（编辑模式）。作为下限使用，使选择器停在“No Project”时仍保留绑定，
   *  而不是从 spec 静默删除 `project`，导致仍绑定的 orchestrator 与读取 spec.project 的 children 不一致。 */
  boundProjectId?: string
  subtasks: EditorSubtask[]
  /** orchestrator 与 children 的工作目录，持久化为 spec `cwd`。 */
  cwd?: string
  /** 在 orchestrator 与每个子会话启用的 source slug，持久化为 `sources`。 */
  sourceSlugs?: string[]
  /** 每个 child 工作前读取为上下文的 skill slug，持久化为 `skills`。 */
  skillSlugs?: string[]
  // 编辑模式中固定为 spec `id` 的既有任务 slug。buildSpec 默认由标题生成 `id`；没有该值时，
  // 修改既有任务标题会分叉出新的 slug/目录，令已绑定的 orchestrator session 失联。
  // undefined 表示创建模式（ID 从标题生成）。
  fixedId?: string
}

/** 生成器编写或从磁盘加载的 spec node（宽松的 renderer 输入形状）。 */
export interface SpecNode {
  id: string
  title?: string
  prompt?: string
  model?: string
  /** 服务 `model` 的 connection；读回行数据以保留显式 connection 的往返结果。 */
  llmConnection?: string
  depends_on?: string[]
}

export function buildSpec(form: SpecForm, modelToConnection: Map<string, string>): TaskSpec {
  // 生成稳定且唯一的 node ID（uid → nodeId），确保 depends_on 和 prompt 中的
  // ${nodes.<id>.output} 引用都能解析。
  const used = new Set<string>()
  const nodeIdByUid = new Map<string, string>()
  const claim = (base: string): string => {
    let id = base
    let n = 2
    while (used.has(id)) id = `${base}-${n++}`
    used.add(id)
    return id
  }
  // 第一阶段：生成或加载的子任务保留原 ID，使同级 prompt 中 AI 写入的
  // ${nodes.<id>.output} 仍然指向真实节点。
  for (const st of form.subtasks) {
    if (st.nodeId) nodeIdByUid.set(st.uid, claim(st.nodeId))
  }
  // 第二阶段：手动新增的子任务从标题生成 ID。
  form.subtasks.forEach((st, i) => {
    if (nodeIdByUid.has(st.uid)) return
    nodeIdByUid.set(st.uid, claim(slugify(st.title) || `node-${i + 1}`))
  })

  const finalIds = new Set(nodeIdByUid.values())
  const nodes = form.subtasks.map((st) => {
    const selfId = nodeIdByUid.get(st.uid)!
    // 优先保留加载 spec 中的显式 connection；否则从显式 model 推导；再否则继续继承。
    // 继承时不输出 model 或 connection，使节点继续跟随 orchestrator 默认值。
    const conn = st.llmConnection ?? (st.model ? modelToConnection.get(st.model) : undefined)
    // depends_on 将 uid 映射为现存 node ID，过滤自引用。已删除行的 uid 无法映射时会被丢弃，
    // 不产生悬空引用；同时去重。
    const deps = st.dependsOn.map((u) => nodeIdByUid.get(u)).filter((d): d is string => d != null)
    const depends_on = [...new Set(deps)].filter((d) => d !== selfId && finalIds.has(d))
    return {
      id: selfId,
      ...(st.title.trim() ? { title: st.title.trim() } : {}),
      ...(st.model ? { model: st.model } : {}),
      // 固定服务该模型的 connection，保证非默认（如 pi/*）模型能解析到后端。
      ...(conn ? { llmConnection: conn } : {}),
      ...(depends_on.length ? { depends_on } : {}),
      prompt: st.prompt,
    }
  })

  const orchConn = form.orchConnection ?? (form.orchModel ? modelToConnection.get(form.orchModel) : undefined)
  const cwd = form.cwd?.trim()
  const acceptanceCriteria = form.acceptanceCriteria?.trim()
  // 任务族默认值：orchestrator 模型、connection 与显式持久化的权限模式。
  const defaults: Record<string, unknown> = {}
  if (form.orchModel) defaults.model = form.orchModel
  if (orchConn) defaults.llmConnection = orchConn
  if (form.permissionMode) defaults.permissionMode = form.permissionMode
  const expertId = form.expertId?.trim()
  if (expertId) defaults.expertId = expertId
  const teamId = form.teamId?.trim()
  if (teamId) defaults.teamId = teamId
  // 编辑已绑定任务时，选择器停在“No Project”也不能丢失 `project`（子会话读取 spec.project）；
  // 以现有绑定作下限，新的选择覆盖它。
  const project = form.projectId || form.boundProjectId
  return TaskSpecSchema.parse({
    id: form.fixedId || slugify(form.title) || 'untitled-task',
    title: form.title.trim() || 'Untitled task',
    goal: form.goal.trim() || form.title.trim() || 'Untitled task',
    ...(acceptanceCriteria ? { acceptance_criteria: acceptanceCriteria } : {}),
    // 仅在设置 max_iterations 时持久化；省略时由 runner 使用默认值。
    ...(form.maxRepairs !== undefined && Number.isFinite(form.maxRepairs)
      ? { max_iterations: Math.min(MAX_REPAIR_ATTEMPTS_CAP, Math.max(0, Math.floor(form.maxRepairs))) }
      : {}),
    ...(project ? { project } : {}),
    ...(cwd ? { cwd } : {}),
    // 空选择不持久化为 []，使会话继续使用工作区默认值。
    ...(form.sourceSlugs?.length ? { sources: form.sourceSlugs } : {}),
    ...(form.skillSlugs?.length ? { skills: form.skillSlugs } : {}),
    ...(Object.keys(defaults).length ? { defaults } : {}),
    nodes,
  })
}

/** 将已编写的 TaskSpec nodes 映射为编辑器可用的多依赖子任务行。 */
export function specToSubtasks(nodes: SpecNode[] | undefined, _fallbackModel?: string): EditorSubtask[] {
  if (!nodes || nodes.length === 0) return []
  const uidByNodeId = new Map<string, string>()
  for (const n of nodes) uidByNodeId.set(n.id, uid())
  return nodes.map((n) => ({
    uid: uidByNodeId.get(n.id)!,
    nodeId: n.id,
    title: n.title || n.id,
    prompt: n.prompt || '',
    // model/connection 保持可选：继承 orchestrator 默认值的节点往返后不能意外获得显式模型，
    // 否则 buildSpec 会固定并重新路由它。编辑器独立计算展示用的有效模型；`_fallbackModel`
    // 为兼容调用方保留。
    ...(n.model ? { model: n.model } : {}),
    ...(n.llmConnection ? { llmConnection: n.llmConnection } : {}),
    // 每条边映射为本地 uid。指向当前 spec 中不存在 ID 的边属于悬空引用（后端会拒绝），因此丢弃，
    // 不保留为原始 ID。
    dependsOn: (n.depends_on ?? [])
      .map((id) => uidByNodeId.get(id))
      .filter((u): u is string => u != null),
  }))
}

/**
 * 判断 `dependentUid` 是否可依赖 `candidateUid` 而不形成环。
 * 自身依赖返回 false；若 candidate 已经直接或间接依赖 dependent，新增这条边会闭环，也返回 false。
 * 行顺序不影响结果：可达性按真实 dependsOn 边计算，因此能正确处理生成器写入的前向边。
 */
export function canDependOn(
  subtasks: EditorSubtask[],
  dependentUid: string,
  candidateUid: string,
): boolean {
  if (candidateUid === dependentUid) return false
  const byUid = new Map(subtasks.map((s) => [s.uid, s]))
  // 遍历 candidate 的依赖闭包；若到达 dependent，新增该边会形成环。
  const seen = new Set<string>()
  const stack = [candidateUid]
  while (stack.length) {
    const cur = stack.pop()!
    if (cur === dependentUid) return false
    if (seen.has(cur)) continue
    seen.add(cur)
    for (const dep of byUid.get(cur)?.dependsOn ?? []) stack.push(dep)
  }
  return true
}
