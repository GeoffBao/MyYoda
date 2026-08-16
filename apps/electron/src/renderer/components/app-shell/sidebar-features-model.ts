/**
 * 「功能」组二级目录（计划 / 看板 / 画布 / 插件 / 知识库）纯逻辑：激活判定 + 显示过滤（无 IO，便于单测）
 */
import type { AppMode } from '@/atoms/app-mode'
import type { CodeMainView } from '@/atoms/project-atoms'

export type FeatureItemKind = 'planning' | 'board' | 'canvas' | 'skills' | 'wiki'

export interface FeatureViewContext {
  activeView: string
  mode: AppMode
  codeMainView: CodeMainView
}

/** 二级目录项元信息：agentOnly 项在 Chat 模式下不显示 */
export const FEATURE_ITEMS: ReadonlyArray<{ kind: FeatureItemKind; agentOnly: boolean }> = [
  { kind: 'planning', agentOnly: false },
  { kind: 'board', agentOnly: true },
  { kind: 'canvas', agentOnly: true },
  { kind: 'skills', agentOnly: true },
  { kind: 'wiki', agentOnly: true },
]

export const FEATURE_ITEM_KINDS: readonly FeatureItemKind[] = FEATURE_ITEMS.map((item) => item.kind)

/** 该项对应的功能视图是否激活（与 LeftSidebar 原 anyFeatureActive 判定完全一致） */
export function isFeatureItemActive(kind: FeatureItemKind, ctx: FeatureViewContext): boolean {
  switch (kind) {
    case 'planning':
      return ctx.activeView === 'planning'
    case 'board':
      return ctx.mode === 'agent' && ctx.codeMainView === 'tasks' && ctx.activeView === 'conversations'
    case 'canvas':
      return ctx.activeView === 'excalidraw-gallery' || ctx.activeView === 'excalidraw-editor'
    case 'skills':
      return ctx.activeView === 'agent-skills'
    case 'wiki':
      return ctx.activeView === 'repo-wiki'
  }
}

/** 任一功能视图激活（替代 LeftSidebar 内联 anyFeatureActive） */
export function anyFeatureActive(ctx: FeatureViewContext): boolean {
  return FEATURE_ITEM_KINDS.some((kind) => isFeatureItemActive(kind, ctx))
}

/**
 * 该项是否渲染：
 * - 菜单模式（showingAll=true）：可见，但 agentOnly 项在 Chat 模式下仍隐藏
 * - 指示模式（showingAll=false）：仅激活项可见
 */
export function shouldShowFeatureItem(
  kind: FeatureItemKind,
  ctx: FeatureViewContext,
  showingAll: boolean,
): boolean {
  const item = FEATURE_ITEMS.find((entry) => entry.kind === kind)
  if (!item || (item.agentOnly && ctx.mode !== 'agent')) return false
  if (showingAll) return true
  return isFeatureItemActive(kind, ctx)
}
