/**
 * draft-recall-model — 侧边栏"未发送草稿"区块的纯函数
 *
 * 草稿会话（未发送过消息）默认从侧边栏所有列表中过滤掉，避免每次点"新会话"
 * 但没发送都留一个空条目。但如果草稿里已经输入了内容，用户需要一个入口找回它，
 * 否则会出现"输入了内容却再也点不回去"的问题（见 draft-session-atoms.ts 注释）。
 *
 * 跨项目展示：与置顶会话 /「自动任务」组一致，草稿找回入口不按当前工作区过滤，
 * 否则切换到其他项目后草稿区块会消失，原项目草稿将失去找回入口。
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
 * 从会话列表中选出「已输入内容但未发送」的草稿会话（跨所有工作区），按 createdAt 倒序。
 *
 * @param excludeSessionId 排除当前正打开的会话（用户已经在这个草稿里，不需要在列表里再列一遍）。
 *   调用方仅在主区处于会话视图时传入；看板 / 计划等非会话视图应传 null，保证找回入口始终存在。
 * @param maxItems 最多展示条数，默认 5——这是找回入口，不是完整草稿箱
 */
export function selectDraftSessionsWithContent(params: {
  sessions: DraftSessionSourceItem[]
  draftSessionIds: Set<string>
  draftTexts: Map<string, string>
  excludeSessionId?: string | null
  maxItems?: number
}): DraftSessionWithContent[] {
  const { sessions, draftSessionIds, draftTexts, excludeSessionId, maxItems = 5 } = params

  return sessions
    .filter((session) => (
      draftSessionIds.has(session.id)
      && session.id !== excludeSessionId
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
