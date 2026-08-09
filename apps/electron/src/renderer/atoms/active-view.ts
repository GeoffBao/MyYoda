/**
 * Active View Atom - 主内容区视图状态
 *
 * 控制 MainArea 显示的内容：
 * - conversations: 对话视图（Chat/Agent 模式内容）
 * - planning: Task 日历视图（Todo / 日历 / 定时任务合一）
 * - agent-skills: Yoda 插件（专家 / 专家团 / Skills / MCP / API）全屏管理视图，左侧栏独立入口，Home / Code 共享
 * - workspace-context: Yoda 记忆（AGENTS.md + memory/）全屏管理视图，左侧栏独立入口
 * - repo-wiki: Project 模式 Yoda 知识库（LLM 知识库）入口
 * - projects: 遗留值（项目中心已移除；运行时回退到 conversations）
 * - excalidraw-gallery / excalidraw-editor: 手绘白板视图
 * - browser: 内嵌浏览器面板（Agent 浏览器，synara 移植）
 */

import { atom } from 'jotai'

export type ActiveView = 'conversations' | 'planning' | 'agent-skills'
  | 'workspace-context'
  | 'repo-wiki'
  | 'excalidraw-gallery'
  | 'excalidraw-editor'
  | 'browser'
  | 'pull-requests'
/** Yoda 插件视图的子页：专家/专家团平级置顶，随后是 Skills / MCP / API（增强工具）。Context 已独立为 Yoda 记忆视图。 */
export type AgentSkillsCapabilityTab = 'experts' | 'teams' | 'skills' | 'mcp' | 'api'

/** 当前活跃视图（不持久化，每次启动默认显示对话） */
export const activeViewAtom = atom<ActiveView>('conversations')

/** Agent 技能视图当前子页，用于外部入口直达 MCP 管理 */
export const agentSkillsTabAtom = atom<AgentSkillsCapabilityTab>('experts')
