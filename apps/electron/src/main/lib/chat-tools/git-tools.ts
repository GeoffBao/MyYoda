/**
 * Git 本地仓库工具模块（Agent 模式，MyYoda 自研桥接）
 *
 * 提供只读 Git 检查工具：status / diff / log / show / branch，作用于当前
 * Agent 工作目录（agentCwd）下的 Git 仓库。npm 上的 unscoped `mcp-server-git`
 * 是供应链攻击研究 canary 包（2026-08-19 已确认），官方 reference server
 * 目前只有 Python（uvx）版，因此这里用 Pi defineTool 自研桥接。
 *
 * 安全边界：全部只读（不提供 add/commit/push，写操作请让 Agent 用 Bash 完成
 * 并由用户确认）；输出截断保护；超时 15s。
 */

import { execFile } from 'node:child_process'
import { Type } from 'typebox'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { AgentToolResult } from '@earendil-works/pi-agent-core'

const GIT_TIMEOUT_MS = 15_000
const MAX_OUTPUT_CHARS = 80_000

function textResult(text: string): AgentToolResult<unknown> {
  return {
    content: [{ type: 'text', text }],
    details: text,
  } as AgentToolResult<unknown>
}

/** 执行 git 命令（限制 cwd 与超时，输出截断） */
function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const message = stderr?.trim() || error.message
          reject(new Error(`git ${args.join(' ')} 失败：${message.slice(0, 500)}`))
          return
        }
        const output = (stdout || '').trim()
        resolve(output.length > MAX_OUTPUT_CHARS ? output.slice(0, MAX_OUTPUT_CHARS) + '\n…（输出过长已截断）' : output || '（无输出）')
      },
    )
  })
}

export function buildGitTools(
  sdk: {
    defineTool: (def: Parameters<typeof import('@earendil-works/pi-coding-agent')['defineTool']>[0]) => ToolDefinition
  },
  getCwd: () => string,
): ToolDefinition[] {
  const git = (args: string[]): Promise<string> => {
    const cwd = getCwd().trim()
    if (!cwd) throw new Error('当前会话没有工作目录，无法执行 Git 操作')
    return runGit(cwd, args)
  }

  return [
    sdk.defineTool({
      name: 'mcp__git__git_status',
      label: 'Git 状态',
      description: '查看当前仓库的工作区状态（已修改/已暂存/未跟踪文件）。',
      parameters: Type.Object({}),
      async execute() {
        return textResult(await git(['status', '--short', '--branch']))
      },
    }),
    sdk.defineTool({
      name: 'mcp__git__git_diff',
      label: 'Git 差异',
      description: '查看工作区未暂存差异（--staged 可看已暂存差异）。',
      parameters: Type.Object({
        staged: Type.Optional(Type.Boolean({ description: 'true 时查看已暂存差异（git diff --staged）' })),
        path: Type.Optional(Type.String({ description: '限定某个文件路径' })),
      }),
      async execute(_toolCallId: string, params: unknown) {
        const args = params as { staged?: boolean; path?: string }
        const diffArgs = ['diff', ...(args.staged ? ['--staged'] : [])]
        if (args.path) diffArgs.push('--', args.path)
        return textResult(await git(diffArgs))
      },
    }),
    sdk.defineTool({
      name: 'mcp__git__git_log',
      label: 'Git 提交历史',
      description: '查看提交历史（单行摘要，最多 limit 条）。',
      parameters: Type.Object({
        limit: Type.Optional(Type.Number({ description: '最多返回条数，默认 20，最大 100' })),
        path: Type.Optional(Type.String({ description: '限定某个文件路径' })),
      }),
      async execute(_toolCallId: string, params: unknown) {
        const args = params as { limit?: number; path?: string }
        const logArgs = ['log', '--oneline', '--decorate', '-n', String(Math.min(args.limit ?? 20, 100))]
        if (args.path) logArgs.push('--', args.path)
        return textResult(await git(logArgs))
      },
    }),
    sdk.defineTool({
      name: 'mcp__git__git_show',
      label: 'Git 提交详情',
      description: '查看某次提交的完整信息（作者、时间、消息与改动）。',
      parameters: Type.Object({
        ref: Type.String({ description: '提交哈希或引用（如 HEAD、HEAD~1）' }),
      }),
      async execute(_toolCallId: string, params: unknown) {
        const args = params as { ref?: string }
        const ref = (args.ref ?? '').trim()
        if (!ref) throw new Error('ref 必填')
        return textResult(await git(['show', '--stat', '--patch', ref]))
      },
    }),
    sdk.defineTool({
      name: 'mcp__git__git_branch',
      label: 'Git 分支列表',
      description: '列出本地与远程分支（含当前分支标记）。',
      parameters: Type.Object({
        all: Type.Optional(Type.Boolean({ description: 'true 时同时列出远程分支（git branch -a）' })),
      }),
      async execute(_toolCallId: string, params: unknown) {
        const args = params as { all?: boolean }
        return textResult(await git(['branch', ...(args.all ? ['-avv'] : ['-vv'])]))
      },
    }),
  ] as ToolDefinition[]
}
