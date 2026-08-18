/**
 * draft-recall-model — 侧边栏"未发送草稿"区块的纯函数
 *
 * 区块是"未发送内容找回入口"，覆盖两类会话：
 * 1. draft 会话（从未发送过消息，默认从侧边栏所有列表过滤掉）——不显示就永远找不到；
 * 2. 历史会话有未发送内容但当前视图不可见（其他项目 / 归档）——行标记不可见时靠区块找回。
 *
 * 跨项目展示：与置顶会话 /「自动任务」组一致，不按当前工作区过滤。
 * 当前视图可见的会话（有行标记）通过 visibleSessionIds 排除，避免与列表重复展示。
 */

export interface DraftSessionSourceItem {
  id: string
  title: string
  workspaceId?: string
  createdAt: number
}

export interface DraftSessionWithContent {
  id: string
  title: string
  /** 草稿输入框的纯文本内容（已 trim），用于列表展示预览 */
  text: string
  /** 草稿所属工作区（用于跨项目标签判断） */
  workspaceId?: string
  createdAt: number
}

/**
 * 从会话列表中选出「有未发送内容」的会话（跨所有工作区，含 draft 与历史会话），按 createdAt 倒序。
 *
 * @param excludeSessionId 排除当前正打开的会话（用户已经在这个草稿里，不需要在列表里再列一遍）。
 *   调用方仅在主区处于会话视图时传入；看板 / 计划等非会话视图应传 null，保证找回入口始终存在。
 * @param visibleSessionIds 当前侧栏视图可见的会话 id 集合（有行标记），区块跳过它们避免重复。
 *   不传则不过滤（向后兼容）。
 * @param maxItems 最多展示条数，默认 5——这是找回入口，不是完整草稿箱
 */
export function selectDraftSessionsWithContent(params: {
  sessions: DraftSessionSourceItem[]
  draftTexts: Map<string, string>
  excludeSessionId?: string | null
  visibleSessionIds?: Set<string>
  maxItems?: number
}): DraftSessionWithContent[] {
  const { sessions, draftTexts, excludeSessionId, visibleSessionIds, maxItems = 5 } = params

  return sessions
    .filter((session) => (
      session.id !== excludeSessionId
      && !(visibleSessionIds?.has(session.id) ?? false)
    ))
    .map((session) => ({
      id: session.id,
      title: session.title,
      text: (draftTexts.get(session.id) ?? '').trim(),
      workspaceId: session.workspaceId,
      createdAt: session.createdAt,
    }))
    .filter((session) => session.text.length > 0)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, maxItems)
}
