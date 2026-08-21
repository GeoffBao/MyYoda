/**
 * Active View Atom - 主内容区视图状态
 *
 * 控制 MainArea 显示的内容：
 * - conversations: 对话视图（Chat/Agent 模式内容）
 * - planning: Task 日历视图（Todo / 日历 / 定时任务合一）
 * - agent-skills: Yoda 插件中心（总览 / 专家 / 专家团 / 技能 / 连接器 / 记忆）全屏管理视图，左侧栏独立入口，Home / Code 共享
 * - repo-wiki: Project 模式 Yoda 知识库（LLM 知识库）入口
 * - messaging: 消息（IM 集成：飞书 / 微信 + 即将上线渠道占位）全屏视图
 * - projects: 遗留值（项目中心已移除；运行时回退到 conversations）
 * - excalidraw-gallery / excalidraw-editor: 手绘白板视图
 *
 * 注：Yoda 搜索已从 activeView 独立视图迁移为全局弹窗（searchDialogOpenAtom），
 *    不再通过 activeView 切换主内容区。
 */

import { atom } from 'jotai'
import type { PluginCenterTab } from '@/lib/plugin-center-model'

export type ActiveView = 'conversations' | 'planning' | 'agent-skills'
  | 'repo-wiki'
  | 'messaging'
  | 'discover'
  | 'excalidraw-gallery' | 'excalidraw-editor'
/** 插件中心子页：规范 Tab 见 PluginCenterTab；legacy mcp/api 仍可作为 atom 输入，由 normalizePluginCenterTab 归一化。 */
export type AgentSkillsCapabilityTab = PluginCenterTab | 'mcp' | 'api'

/** 当前活跃视图（不持久化，每次启动默认显示对话） */
export const activeViewAtom = atom<ActiveView>('conversations')

/** 插件中心当前子页；默认总览，外部 legacy 入口仍可写入 mcp/api */
export const agentSkillsTabAtom = atom<AgentSkillsCapabilityTab>('overview')
