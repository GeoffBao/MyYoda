/**
 * Agent cowork —— 会话级拉专家/专家团
 *
 * 在普通 Code 会话（父会话）下创建真实子会话：
 * - 专家：子会话注入专家 preamble（formatExpertPreamble），渠道/模型用专家默认值，否则继承父会话
 * - 专家团：团长子会话（注入团长协议+名册+协调策略）→ 团长输出委派 DAG → 展开为成员子会话
 *   （各自注入成员专家 preamble）→ 汇总子会话（团长验收合并，成员输出拼入 prompt）
 *
 * 子会话复用 collaboration 的 parentSessionId/rootSessionId/delegation* 字段体系，
 * 侧边栏已按父子分组展示；事件流经 headless runner 注册后 Code 界面全局可见。
 */

import { getExpert, getTeam, resolveExpertOrTeamKind } from './expert-service'
import {
  formatExpertPreamble,
  validateTeamSquad,
  type TeamSquad,
} from '@myyoda/shared/experts'
import {
  type AgentMessage,
  type AgentSessionMeta,
  type SpawnExpertCoworkInput,
  type SpawnExpertCoworkResult,
} from '@myyoda/shared'
import type { AgentSendInput, MyYodaPermissionMode } from '@myyoda/shared'
import { extractFinalText } from './agent-cowork-utils'
import {
  createAgentSession,
  getAgentSessionMeta,
  updateAgentSessionMeta,
} from './agent-session-manager'
import { runRegisteredHeadlessAgent, stopRegisteredAgent } from './agent-headless-runner-registry'
import {
  buildLeaderPlanningPrompt,
  buildTeamExecutionSpec,
} from './team-run'
import { getExpertsDir } from './config-paths'
import { extractYaml, buildRepairPrompt } from '@myyoda/shared/tasks'
import type { TaskSpec } from '@myyoda/shared/tasks/schema'
import { parseTaskYaml } from '@myyoda/shared/tasks/storage'

/** cowork 子会话在 AgentSessionMeta 中的委派角色标记 */
export const COWORK_DELEGATION_ROLE = 'expert-cowork' as const

interface CoworkParentContext {
  channelId?: string
  modelId?: string
  workspaceId?: string
  permissionMode?: MyYodaPermissionMode
  agentRuntime?: string
  projectId?: string
  workingDirectory?: string
  rootSessionId?: string
}

function resolveParentContext(parent: AgentSessionMeta): CoworkParentContext {
  return {
    channelId: parent.channelId,
    modelId: parent.modelId,
    workspaceId: parent.workspaceId,
    permissionMode: parent.permissionMode,
    projectId: parent.projectId,
    workingDirectory: parent.workingDirectory,
    rootSessionId: parent.rootSessionId ?? parent.id,
  }
}

/** 专家默认渠道/模型优先，否则继承父会话 */
function resolveChannelAndModel(
  parent: CoworkParentContext,
  defaultProviderChannelId?: string,
  defaultModel?: string,
): { channelId: string; modelId?: string } {
  const channelId = defaultProviderChannelId?.trim() || parent.channelId || ''
  if (!channelId) {
    throw new Error('无法确定渠道：专家未配置默认渠道且父会话没有渠道')
  }
  return {
    channelId,
    modelId: defaultModel?.trim() || parent.modelId || undefined,
  }
}

function spawnChildSession(
  parent: AgentSessionMeta,
  parentCtx: CoworkParentContext,
  input: {
    title: string
    channelId: string
    modelId?: string
    userMessage: string
    delegationRole: 'expert-cowork' | 'team-leader' | 'team-member' | 'team-summary'
    goal: string
  },
): Promise<{ sessionId: string; text: string }> {
  const child = createAgentSession(
    input.title,
    input.channelId,
    parentCtx.workspaceId,
    input.modelId,
  )
  updateAgentSessionMeta(child.id, {
    parentSessionId: parent.id,
    rootSessionId: parentCtx.rootSessionId,
    delegationRole: input.delegationRole,
    delegationStatus: 'running',
    delegationDepth: (parent.delegationDepth ?? 0) + 1,
    delegationGoal: input.goal,
    permissionMode: parent.permissionMode,
    ...(parentCtx.projectId ? { projectId: parentCtx.projectId } : {}),
    ...(parentCtx.workingDirectory ? { workingDirectory: parentCtx.workingDirectory } : {}),
  })

  const sendInput: AgentSendInput = {
    sessionId: child.id,
    userMessage: input.userMessage,
    channelId: input.channelId,
    modelId: input.modelId,
    workspaceId: parentCtx.workspaceId,
    permissionModeOverride: parent.permissionMode,
    triggeredBy: 'work' as const,
  }

  return new Promise<{ sessionId: string; text: string }>((resolve, reject) => {
    runRegisteredHeadlessAgent(sendInput, {
      source: 'work',
      originSessionId: parent.id,
      onError: (error) => {
        updateAgentSessionMeta(child.id, { delegationStatus: 'failed' })
        reject(new Error(error))
      },
      onComplete: (messages) => {
        const text = extractFinalText(messages)
        updateAgentSessionMeta(child.id, { delegationStatus: 'completed' })
        resolve({ sessionId: child.id, text })
      },
      onTitleUpdated: (title) => {
        updateAgentSessionMeta(child.id, { title })
      },
    }).catch((error: unknown) => {
      updateAgentSessionMeta(child.id, { delegationStatus: 'failed' })
      reject(error instanceof Error ? error : new Error(String(error)))
    })
  })
}

const DEFAULT_COWORK_PROMPT = '请按你的专家身份，协助当前会话的任务：先阅读理解目标与上下文，再给出可执行的产出。'

function buildExpertPreambleMessage(expert: { id: string; label: string }, prompt?: string): string {
  // formatExpertPreamble 需要 ExpertPackage 结构；这里用精简身份文本 + 用户 prompt
  const preamble = [
    `<agent_expert id="${expert.id}" label="${expert.label}">`,
    `你是「${expert.label}」（${expert.id}），以该专家身份独立协作。`,
    `</agent_expert>`,
  ].join('\n')
  return `${preamble}\n\n${prompt?.trim() || DEFAULT_COWORK_PROMPT}`
}

function resolveMemberLabels(team: TeamSquad): Record<string, string> {
  const labels: Record<string, string> = {}
  const expertsRoot = getExpertsDir()
  const leader = getExpert(expertsRoot, team.leaderExpertId)
  if (leader) labels[team.leaderExpertId] = leader.label
  for (const member of team.members) {
    const expert = getExpert(expertsRoot, member.expertId)
    if (expert) labels[member.expertId] = expert.label
  }
  return labels
}

/**
 * 会话级拉专家/专家团。
 * 返回创建的子会话 id 列表；团队模式按 团长 → 成员 → 汇总 顺序串行完成。
 */
export async function spawnExpertCowork(
  parentSessionId: string,
  input: SpawnExpertCoworkInput,
): Promise<SpawnExpertCoworkResult> {
  const parent = getAgentSessionMeta(parentSessionId)
  if (!parent) {
    throw new Error(`父会话不存在: ${parentSessionId}`)
  }
  const parentCtx = resolveParentContext(parent)
  const expertsRoot = getExpertsDir()
  const taskPrompt = input.prompt?.trim() || ''

  // ===== 专家模式 =====
  if (input.expertId) {
    const expert = getExpert(expertsRoot, input.expertId)
    if (!expert) {
      throw new Error(`专家不存在: ${input.expertId}`)
    }
    if (expert.kind === 'team') {
      throw new Error(`「${expert.label}」是专家团，请用 teamId 拉取`)
    }
    const { channelId, modelId } = resolveChannelAndModel(
      parentCtx,
      expert.defaultProviderChannelId,
      expert.defaultModel,
    )
    const child = await spawnChildSession(parent, parentCtx, {
      title: expert.label,
      channelId,
      modelId,
      userMessage: buildExpertPreambleMessage(expert, taskPrompt),
      delegationRole: COWORK_DELEGATION_ROLE,
      goal: taskPrompt || `按专家「${expert.label}」身份协作`,
    })
    return { kind: 'expert', label: expert.label, childSessionIds: [child.sessionId] }
  }

  // ===== 团队模式 =====
  if (input.teamId) {
    const team = getTeam(expertsRoot, input.teamId)
    if (!team) {
      throw new Error(`专家团不存在: ${input.teamId}`)
    }
    const issues = validateTeamSquad(team, (id) => resolveExpertOrTeamKind(expertsRoot, id))
    if (issues.length > 0) {
      throw new Error(`专家团配置无效: ${issues.map((issue) => issue.message).join('; ')}`)
    }

    const labels = resolveMemberLabels(team)
    const leader = getExpert(expertsRoot, team.leaderExpertId)
    if (!leader) {
      throw new Error(`团长专家不存在: ${team.leaderExpertId}`)
    }
    const { channelId: leaderChannel, modelId: leaderModel } = resolveChannelAndModel(
      parentCtx,
      leader.defaultProviderChannelId,
      leader.defaultModel,
    )

    // 阶段 1：团长编排（输出委派 DAG）
    const goal = taskPrompt || `按团队「${team.label}」协作`
    const leaderGoal = `团队「${team.label}」委派计划`
    const leaderChild = await spawnChildSession(parent, parentCtx, {
      title: `团长 · ${team.label}`,
      channelId: leaderChannel,
      modelId: leaderModel,
      userMessage: buildLeaderPlanningPrompt(
        team,
        {
          id: 'cowork-task',
          title: goal,
          goal: goal,
          runner: 'conduct',
          nodes: [],
        },
        (expertId: string) => {
          const expert = getExpert(expertsRoot, expertId)
          return expert ? { label: expert.label, skills: expert.skillSlugs } : null
        },
      ),
      delegationRole: 'team-leader',
      goal: leaderGoal,
    })
    const childSessionIds = [leaderChild.sessionId]

    // 阶段 2：解析委派 DAG → 展开
    let leaderSpec: TaskSpec | null = null
    let parseErrors: Array<{ path: string; message: string }> = []
    let yamlText = extractYaml(leaderChild.text)
    let parsed = parseTaskYaml(yamlText)
    if (!parsed.valid && !parsed.spec) {
      parseErrors = toTaskIssues(parsed.errors)
      const repairPrompt = buildRepairPrompt(parseErrors.map((issue) => ({ path: issue.path ?? '<root>', message: issue.message })))
      const retry = await spawnChildSession(parent, parentCtx, {
        title: `团长 · ${team.label}（重试）`,
        channelId: leaderChannel,
        modelId: leaderModel,
        userMessage: `${repairPrompt}\n\n原目标：${goal}`,
        delegationRole: 'team-leader',
        goal: leaderGoal,
      })
      childSessionIds.push(retry.sessionId)
      yamlText = extractYaml(retry.text)
      parsed = parseTaskYaml(yamlText)
    }
    if (!parsed.valid || !parsed.spec) {
      throw new Error(
        `团长未能产出合法委派计划: ${(parsed.errors ?? []).map((e: { message: string }) => e.message).join('; ')}`,
      )
    }
    leaderSpec = parsed.spec

    const baseSpec = {
      id: 'cowork-task',
      title: goal,
      goal,
      runner: 'conduct' as const,
      nodes: [] as never[],
    }
    const built = buildTeamExecutionSpec({ team, leaderSpec, baseSpec })
    if (!built.ok || !built.spec) {
      throw new Error(`委派计划校验失败: ${(built.errors ?? []).join('; ')}`)
    }
    const expanded = built.spec

    // 阶段 3：成员子会话（并行收集输出）
    const memberOutputs: Array<{ nodeId: string; title: string; text: string }> = []
    const memberNodes = expanded.nodes.filter((node) => node.id !== expanded.nodes[expanded.nodes.length - 1]?.id)
    for (const node of memberNodes) {
      const expert = getExpert(expertsRoot, node.expertId ?? team.leaderExpertId)
      if (!expert) continue
      const { channelId, modelId } = resolveChannelAndModel(
        parentCtx,
        expert.defaultProviderChannelId,
        expert.defaultModel,
      )
      const memberGoal = `团队「${team.label}」成员任务：${node.title ?? node.id}`
      const member = await spawnChildSession(parent, parentCtx, {
        title: `${expert.label}${node.title ? ` · ${node.title}` : ''}`,
        channelId,
        modelId,
        userMessage: buildExpertPreambleMessage(expert, `${goal}\n\n${node.prompt ?? ''}`),
        delegationRole: 'team-member',
        goal: memberGoal,
      })
      childSessionIds.push(member.sessionId)
      memberOutputs.push({ nodeId: node.id, title: node.title ?? node.id, text: member.text })
    }

    // 阶段 4：团长汇总（成员输出拼入 prompt）
    const summaryNode = expanded.nodes[expanded.nodes.length - 1]
    const summarySections = memberOutputs.map(
      (output, index) => `### 成员产出 ${index + 1}（${output.title}）\n${output.text || '(无产出)'}`,
    )
    const summaryPrompt = [
      `你是专家团「${team.label}」的团长（${team.leaderExpertId}），以下是团队成员产出的最终结果。`,
      '请逐份验收质量（对照任务目标），合并为一份完整、可直接交付的最终答复；',
      '对明显缺失、错误或互相矛盾的部分明确标注，不掩盖问题。',
      '',
      ...summarySections,
    ].join('\n\n')
    const summary = await spawnChildSession(parent, parentCtx, {
      title: `汇总 · ${team.label}`,
      channelId: leaderChannel,
      modelId: leaderModel,
      userMessage: buildExpertPreambleMessage(leader, summaryPrompt),
      delegationRole: 'team-summary',
      goal: `团队「${team.label}」汇总交付`,
    })
    childSessionIds.push(summary.sessionId)

    return { kind: 'team', label: team.label, childSessionIds }
  }

  throw new Error('必须指定 expertId 或 teamId')
}

/** 停止 cowork 子会话 */
export function stopCoworkSession(sessionId: string): void {
  stopRegisteredAgent(sessionId)
  const meta = getAgentSessionMeta(sessionId)
  if (meta) {
    updateAgentSessionMeta(sessionId, { delegationStatus: 'cancelled' })
  }
}

/** 解析 parseTaskYaml 错误为 {path,message}（与 task-handlers 的 toTaskIssues 同构） */
function toTaskIssues(errors: Array<{ path?: unknown; message: string }>): Array<{ path: string; message: string }> {
  return errors.map((issue) => ({
    path: typeof issue.path === 'string' ? issue.path : String(issue.path ?? '<root>'),
    message: issue.message,
  }))
}
