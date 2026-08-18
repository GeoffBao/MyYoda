/**
 * 「功能」组二级目录（计划 / 看板 / 画布 / 插件 / 知识库）纯逻辑：激活判定（无 IO，便于单测）
 */
import type { AppMode } from '@/atoms/app-mode'
import type { CodeMainView } from '@/atoms/project-atoms'

export type FeatureItemKind = 'planning' | 'board' | 'canvas' | 'skills' | 'messaging' | 'wiki'

export interface FeatureViewContext {
  activeView: string
  mode: AppMode
  codeMainView: CodeMainView
}

/** 功能二级目录项（顺序即侧边栏展示顺序） */
export const FEATURE_ITEM_KINDS: readonly FeatureItemKind[] = [
  'planning',
  'board',
  'canvas',
  'skills',
  'messaging',
  'wiki',
]

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
    case 'messaging':
      return ctx.activeView === 'messaging'
    case 'wiki':
      return ctx.activeView === 'repo-wiki'
  }
}

/** 任一功能视图激活（替代 LeftSidebar 内联 anyFeatureActive） */
export function anyFeatureActive(ctx: FeatureViewContext): boolean {
  return FEATURE_ITEM_KINDS.some((kind) => isFeatureItemActive(kind, ctx))
}
