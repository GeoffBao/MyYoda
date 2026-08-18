/**
 * Agent 会话创建流程纯函数 — 供 useCreateSession / 测试共用
 */

export interface CreateAgentSessionFlowInput {
  /** 未传时默认 true（未发送不进侧栏） */
  draft?: boolean
  projectId?: string
  channelId?: string
  modelId?: string
  workspaceId?: string
  /**
   * 显式开启"回到最近未发送草稿"逻辑。默认 false——只有用户主动点击的
   * 空白新会话入口（侧边栏「新会话」按钮 / Cmd+N）才应传 true；程序化创建会话
   * 并立即注入指定 prompt 的调用方（搜索建会话、Skills 分类等）必须保持 false，
   * 否则会把生成的 prompt 误发进一个不相关的旧草稿会话。
   */
  recallDraft?: boolean
  /** 跳过"回到最近未发送草稿"逻辑，强制新建（草稿回收 toast 的"新建"按钮用） */
  forceNew?: boolean
}

/** Spec：全局/项目新会话默认 Draft，除非显式 draft: false */
export function shouldMarkDraft(input: CreateAgentSessionFlowInput): boolean {
  return input.draft !== false
}

export function resolveCreateAgentWorkspaceId(
  input: CreateAgentSessionFlowInput,
  currentWorkspaceId: string | null,
): string | undefined {
  return input.workspaceId ?? currentWorkspaceId ?? undefined
}

/** 候选会话（供 findRecallableDraftSession 判定用的精简字段） */
export interface DraftSessionCandidate {
  id: string
  title: string
  workspaceId?: string
  projectId?: string
  createdAt: number
}

/**
 * 从候选会话中找出「未绑定项目、已输入内容但未发送」的最近草稿。
 *
 * 用于空白「新会话」入口（侧边栏按钮 / Cmd+N / 空状态按钮）智能回到未发送草稿，
 * 而不是每次都新建一个空会话把上一个草稿"顶没"。只匹配未绑定 projectId 的草稿——
 * 「在项目下新建会话」语义明确（该项目下的新任务），不参与回收，避免误跳到别处。
 *
 * 匹配策略：当前工作区优先（在当前工作区内找最近草稿）；当前工作区没有时跨工作区
 * 兜底（找所有工作区中最近的草稿）。与侧栏「未发送草稿」区块的跨项目找回语义一致。
 */
export function findRecallableDraftSession(params: {
  candidates: DraftSessionCandidate[]
  draftSessionIds: Set<string>
  draftTexts: Map<string, string>
  workspaceId: string | undefined
}): DraftSessionCandidate | null {
  const { candidates, draftSessionIds, draftTexts, workspaceId } = params
  let latest: DraftSessionCandidate | null = null
  let latestOther: DraftSessionCandidate | null = null
  for (const session of candidates) {
    if (!draftSessionIds.has(session.id)) continue
    if (session.projectId) continue
    const text = draftTexts.get(session.id)
    if (!text || text.trim().length === 0) continue
    if (session.workspaceId === workspaceId) {
      if (!latest || session.createdAt > latest.createdAt) latest = session
    } else if (!latestOther || session.createdAt > latestOther.createdAt) {
      latestOther = session
    }
  }
  return latest ?? latestOther
}

/** 供 resolveDefaultProjectId 扫描「最近工作的项目」用的精简会话字段 */
export interface ProjectRecencyCandidate {
  projectId?: string
  workspaceId?: string
  updatedAt: number
}

/**
 * 新会话默认绑定项目：参考 Synara「新会话默认绑定最近工作的项目」的行为。
 *
 * - 显式指定了 projectId（例如项目详情页「新会话」按钮）：原样返回，不覆盖明确意图。
 * - 非 recallDraft（程序化建会话，如搜索建会话/Skills 分类触发）：保持历史行为，返回 undefined。
 * - 空白「新会话」入口（recallDraft）且未显式指定项目：在同一工作区内按 updatedAt 倒序
 *   找第一个绑定了 projectId 的历史会话，返回其 projectId；找不到则 undefined（维持项目无关的通用会话）。
 */
export function resolveDefaultProjectId(input: {
  explicitProjectId?: string
  recallDraft?: boolean
  sessions: ProjectRecencyCandidate[]
  workspaceId: string | undefined
}): string | undefined {
  if (input.explicitProjectId) return input.explicitProjectId
  if (!input.recallDraft) return undefined

  let latest: ProjectRecencyCandidate | null = null
  for (const session of input.sessions) {
    if (!session.projectId) continue
    if (session.workspaceId !== input.workspaceId) continue
    if (!latest || session.updatedAt > latest.updatedAt) latest = session
  }
  return latest?.projectId
}
