/**
 * terminal-context-tracking — 终端随会话归属（工作区/项目）变化重开的判定
 *
 * pty cwd 跟随会话的 workspaceId/projectId。会话改绑会改变 cwd，
 * 但预热/运行中的 pty 不会自动跟随；这里用「锁定首个非空上下文」+「后续变化
 * 才触发重开」的方式，避免面板刚挂载、会话元数据尚未加载时无谓重建终端。
 */

export interface TerminalContextDecision {
  /** 是否应重新打开 pty（清理旧 xterm → 重新 open） */
  reopen: boolean
  /** 更新后的已锁定上下文 key（供调用方写回 ref） */
  nextLastKey: string | null
}

/** 根据上次锁定的上下文与当前上下文，判定是否需要重开终端。 */
export function shouldReopenTerminal(lastKey: string | null, nextKey: string): TerminalContextDecision {
  // 上下文尚未加载（如会话元数据未就绪）：不锁定、不重开。
  if (!nextKey) return { reopen: false, nextLastKey: lastKey }
  // 首次锁定当前上下文：只记录，不重开。
  if (lastKey === null) return { reopen: false, nextLastKey: nextKey }
  // 上下文未变化：保持锁定。
  if (lastKey === nextKey) return { reopen: false, nextLastKey: lastKey }
  // 工作区/项目真正变化：锁定新上下文并触发重开。
  return { reopen: true, nextLastKey: nextKey }
}

/** 由会话元数据构建上下文 key（workspaceId 与 projectId 共同决定 pty cwd）。 */
export function buildTerminalContextKey(session: {
  workspaceId?: string
  projectId?: string
} | undefined): string {
  if (!session) return ''
  return `${session.workspaceId ?? ''}|${session.projectId ?? ''}`
}
