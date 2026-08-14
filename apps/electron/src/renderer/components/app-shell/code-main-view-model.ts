/**
 * Project 模式主区视图 - 纯逻辑（视图模型）
 *
 * MainArea 的分支判定逻辑，抽成纯函数保证优先级规则单点可测。
 */

import type { ActiveView } from '@/atoms/active-view'
import type { AppMode } from '@/atoms/app-mode'
import type { CodeMainView, ProjectPageTab } from '@/atoms/project-atoms'

export interface CodeMainViewInput {
  appMode: AppMode
  codeMainView: CodeMainView
  activeView: ActiveView
}

export type CodeMainRoute = 'session' | 'task-board' | 'project-page' | 'overlay'

export interface TaskBoardNavigation {
  codeMainView: 'tasks'
  activeView: 'conversations'
  selectedProjectId: string | null
}

export interface ProjectPageNavigation {
  codeMainView: 'project'
  activeView: 'conversations'
  activeProjectPageId: string
  projectPageTab: ProjectPageTab
}

export function resolveCodeMainRoute({
  appMode,
  codeMainView,
  activeView,
}: CodeMainViewInput): CodeMainRoute {
  if (appMode !== 'agent') return 'session'
  if (activeView !== 'conversations') return 'overlay'
  if (codeMainView === 'tasks' || codeMainView === 'work') return 'task-board'
  if (codeMainView === 'project') return 'project-page'
  return 'session'
}

export function buildTaskBoardNavigation(projectId: string | null): TaskBoardNavigation {
  return {
    codeMainView: 'tasks',
    activeView: 'conversations',
    selectedProjectId: projectId,
  }
}

export function buildProjectPageNavigation(
  projectId: string,
  tab: ProjectPageTab = 'overview',
): ProjectPageNavigation {
  return {
    codeMainView: 'project',
    activeView: 'conversations',
    activeProjectPageId: projectId,
    projectPageTab: tab,
  }
}

/** 顶栏可见的主模式（遗留 cowork 已并入 Code 的 Work 主区） */
export type PrimaryUiMode = 'chat' | 'agent' | 'scratch'

/**
 * 将持久化 / 运行时 AppMode 归一到顶栏可见模式。
 * cowork → agent（看板改由 codeMainViewAtom='work' 承载）。
 */
export function normalizeAppModeForUi(mode: AppMode): PrimaryUiMode {
  if (mode === 'cowork') return 'agent'
  if (mode === 'chat' || mode === 'agent' || mode === 'scratch') return mode
  return 'agent'
}

/** 是否仍为遗留顶栏 Work（cowork）模式，需迁移到 Project 主区 */
export function isLegacyCoworkMode(mode: AppMode): boolean {
  return mode === 'cowork'
}

/** activeView 是否为全屏覆盖视图（非 conversations 主内容） */
export function isOverlayActiveView(activeView: ActiveView): boolean {
  return (
    activeView === 'planning' ||
    activeView === 'agent-skills'
  )
}

/**
 * agent 模式主区是否渲染正式 Project 看板。
 *
 * 优先级约束：
 * - 仅 agent 模式（遗留 cowork 由启动迁移落到 agent + codeMainView='work'）
 * - activeView 为 automations / agent-skills 等覆盖视图时让位（显式导航优先）
 */
export function shouldShowWorkViewInCode({
  appMode,
  codeMainView,
  activeView,
}: CodeMainViewInput): boolean {
  return appMode === 'agent'
    && (codeMainView === 'tasks' || codeMainView === 'work')
    && activeView === 'conversations'
}
