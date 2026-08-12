import { basename } from 'node:path'

interface AgentsFilesResult {
  agentsFiles: Array<{ path: string; content: string }>
}

// MyYoda 用 systemPromptOverride 自己注入完整系统提示词。Pi SDK 默认会把 AGENTS.md
// （及旧 CLAUDE.md）作为 agent context 文件自动读取，为避免双份注入，这里过滤掉两者。
// 过渡期保留旧 CLAUDE.md 过滤以兼容尚未迁移完成的老工作区。
const FILTERED_AGENT_CONTEXT_FILE_NAMES = new Set(['AGENTS.md', 'AGENTS.MD', 'CLAUDE.md', 'CLAUDE.MD'])

export function createMyYodaAgentsFilesOverride(): (base: AgentsFilesResult) => AgentsFilesResult {
  return (base) => ({
    agentsFiles: base.agentsFiles.filter((file) => !FILTERED_AGENT_CONTEXT_FILE_NAMES.has(basename(file.path))),
  })
}
