/**
 * MyYoda 内置 MCP 能力目录
 *
 * 这里只维护可展示的元数据和可用性判断，不负责运行时注入。
 * 元数据本身来自 default-mcp.json（经 baseline 加载），本文件只在其上叠加
 * 运行时可用性判断（API Key、工作区、登录态等）。这样前端能力摘要可以安全读取
 * 内置 MCP 列表，而不会引入 Agent 编排层循环依赖。
 */

import type { BuiltinMcpServerSummary } from '@myyoda/shared'
import { spawnSync } from 'node:child_process'
import { getToolCredentials, getToolState } from '../chat-tool-config'
import { getBuiltinMcpDefinitions, type BuiltinMcpDefinition } from './baseline'
import { isBuiltinMcpDefaultDisabled, isBuiltinMcpUserEnabled } from './settings'

interface BuiltinMcpListContext {
  workspaceSlug?: string
}

function resolveAvailability(
  item: BuiltinMcpDefinition,
  ctx: BuiltinMcpListContext,
): Pick<BuiltinMcpServerSummary, 'enabled' | 'available' | 'availabilityReason'> {
  // 基础设施型（如 myyoda-cloud）：登录后始终注入，不受用户开关影响
  if (item.toggleable === false) {
    return { enabled: true, available: true }
  }

  const userEnabled = isBuiltinMcpUserEnabled(item.id)
  if (!userEnabled) {
    return {
      enabled: false,
      available: false,
      availabilityReason: isBuiltinMcpDefaultDisabled(item.id)
        ? '默认关闭，可手动开启'
        : '已手动关闭',
    }
  }

  if (item.id === 'collaboration') {
    const available = !!ctx.workspaceSlug
    return {
      enabled: true,
      available,
      availabilityReason: available ? undefined : '需要先选择工作区',
    }
  }

  if (item.id === 'nano-banana') {
    const state = getToolState('nano-banana')
    const credentials = getToolCredentials('nano-banana')
    const available = state.enabled && !!credentials.apiKey
    return {
      enabled: true,
      available,
      availabilityReason: available
        ? undefined
        : state.enabled ? '需要配置 Gemini API Key' : 'Nano Banana 未启用',
    }
  }

  if (item.id === 'code-review-graph') {
    const available = isCommandAvailable('code-review-graph')
    return {
      enabled: true,
      available,
      availabilityReason: available
        ? undefined
        : '需要安装 code-review-graph：把此提示发给 Agent，让 AI 帮你安装并验证；或手动 pip install code-review-graph。首次使用请在**主仓库根**运行 code-review-graph build（worktree 会话共享同一图谱，避免每个 worktree 重复建图）',
    }
  }

  return { enabled: true, available: true }
}

// ===== 命令可用性检测（供依赖外部命令的内置 MCP 使用） =====

const commandAvailabilityCache = new Map<string, { available: boolean; checkedAt: number }>()
const COMMAND_CHECK_TTL_MS = 30_000

/** 检测命令是否可用（PATH 解析 + 版本探测），结果短时缓存避免频繁 spawn */
function isCommandAvailable(command: string): boolean {
  const now = Date.now()
  const cached = commandAvailabilityCache.get(command)
  if (cached && now - cached.checkedAt < COMMAND_CHECK_TTL_MS) return cached.available

  let available = false
  try {
    const result = spawnSync(command, ['--version'], { stdio: 'ignore', timeout: 5_000, shell: process.platform === 'win32' })
    available = result.error === undefined
  } catch {
    available = false
  }
  commandAvailabilityCache.set(command, { available, checkedAt: now })
  return available
}

export function listBuiltinMcpServers(ctx: BuiltinMcpListContext = {}): BuiltinMcpServerSummary[] {
  return getBuiltinMcpDefinitions().map((item) => ({
    id: item.id,
    name: item.name,
    displayName: item.displayName,
    description: item.description,
    category: item.category,
    tools: item.tools,
    toggleable: item.toggleable,
    ...resolveAvailability(item, ctx),
  }))
}
