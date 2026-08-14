/**
 * AgentOrchestrator — Agent 编排层
 *
 * 从 agent-service.ts 提取的核心业务逻辑，负责：
 * - 并发守卫（同一会话不允许并行请求）
 * - 渠道查找 + API Key 解密
 * - 环境变量构建 + SDK 路径解析
 * - 用户/助手消息持久化
 * - 事件流遍历 + 文本累积 + 事件持久化
 * - 错误处理 + 部分内容保存
 * - 自动标题生成
 *
 * 通过 EventBus 分发 AgentEvent，通过 SessionCallbacks 发送控制信号，
 * 完全解耦 Electron IPC，可独立测试（mock Adapter + EventBus）。
 */

import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { AgentSendInput, AgentMessage, AgentGenerateTitleInput, AgentProviderAdapter, AgentSessionMeta, CodexOAuthCredentials, XaiOAuthCredentials, TypedError, RetryAttempt, SDKMessage, SDKAssistantMessage, AgentStreamPayload, RewindSessionResult, ProviderType, AgentThinkingLevel, SkillActivation } from '@myyoda/shared'
import { UPDATER_LINKS } from '@myyoda/shared'
import { MYYODA_DEFAULT_PERMISSION_MODE, MYYODA_PERMISSION_MODE_CONFIG, PROVIDER_DEFAULT_URLS, THINKING_SIGNATURE_ERROR_CODE, THINKING_SIGNATURE_ERROR_MESSAGE, THINKING_SIGNATURE_ERROR_TITLE, isPersistableSDKSystemMessage, normalizeMcpTransportType, inferAgentSdkContextWindow, inferReasoningTransport, resolveReasoningProfile, collectSkillActivations, mergeSkillActivations } from '@myyoda/shared'
import type { MyYodaPermissionMode, AskUserRequest, ExitPlanModeRequest, SDKSystemMessage } from '@myyoda/shared'
import type { PiAgentQueryOptions } from './adapters/pi-agent-adapter'
import { getMainRepoRoot } from './git-diff-service'
import { normalizePathForCompare } from '@myyoda/shared'
import { getPiAssistantErrorDetails, hasPiAssistantTextContent, stripPiAssistantError } from './adapters/pi-message-adapter'
import { isTransientNetworkError, isMalformedResponseError, isSessionNotFoundError } from './error-patterns'
import { friendlyErrorMessage, isPromptTooLongError, isThinkingSignatureError, mapSDKErrorToTypedError, extractErrorDetails, shouldKeepChannelOpen } from './agent-error-utils'
import { getActiveRunRejectionMessage, shouldPersistInitialUserMessage } from './agent-send-message-policy'
import { withAgentMessageChannelIdentity } from './agent-message-channel-identity'
import { AgentEventBus } from './agent-event-bus'
import { decryptApiKey, getChannelById, listChannels, persistCodexOAuthCredentials, persistXaiOAuthCredentials, resolveChannelRuntimeApiKey, resolveClaudeOAuthCredentials, resolveCodexOAuthCredentials, resolveXaiOAuthCredentials } from './channel-manager'
import { getAdapter, fetchTitle, getAppUserAgent } from '@myyoda/core'
import pkg from '../../../package.json' with { type: 'json' }
import { getFetchFn } from './proxy-fetch'
import { resolveTitleChannel, resolveTitleModel } from './title-model-selection'
import { getSettings } from './settings-service'
import { getEffectiveProxyUrl } from './proxy-settings-service'
import { appendSDKMessages, updateAgentSessionMeta, getAgentSessionMeta, getAgentSessionMessages, truncateSDKMessages, removeSDKErrorMessage, updateSDKUserMessageSkillActivations, rewindPiAgentSession, resolveAgentCwd, getActiveWorktreePath, getAgentCwdMode, getSessionWorkbenchLayout } from './agent-session-manager'
import { getAgentWorkspace, getWorkspaceMcpConfig, ensurePluginManifest, getWorkspaceAutoMemoryDir, getWorkspaceAttachedDirectories, getWorkspaceAttachedFiles, getWorkspaceDefaultWorkingDirectory, getWorkspaceMemoryGuidance, isWorkspaceProjectKnowledgeMaintenanceApproved, hasProjectMcpServers, getProjectMcpConfig, hasProjectSkills, getProjectSkillsDir } from './agent-workspace-manager'
import { getAgentWorkspacePath, getAgentSessionWorkspacePath, getWorkspaceFilesDir, getBundledCliPath, getWorkspaceSkillsDir, getSdkConfigDir } from './config-paths'
import { getRegistryPathFromRegistry } from './windows-env'
import { projectRepository } from './project-repository'
import { applyWorktreeProjectContextOverride, resolveSessionCwd, type SessionCwdSource } from './agent-cwd-resolver'
import { appendVisionRelayAllowedRoot } from './vision-relay-roots'
import { resolveAgentSessionFileRoots } from './agent-file-roots'
import { captureAgentTurnOutputs, buildOutputCaptureRoots, snapshotOutputFiles } from './agent-output-capture'
import { getRuntimeStatus } from './runtime-init'
import { buildSystemPrompt, buildDynamicContext } from './agent-prompt-builder'
import { repoMapService } from './repo-map/repo-map-service'
import { graphJsonPath, repoMapToolsService } from './repo-map-tools-service'
import { claimWorkspaceMemoryRefreshOpportunity } from './agent-memory-refresh-service'
import { MAX_CONTEXT_MESSAGES, buildContextPrompt, buildRecoveryPrompt, buildReferencedSessionsPrompt } from './agent-session-context-prompt'
import { buildReferencedPlanningPrompt } from './planning-reference-context'
import { permissionService } from './agent-permission-service'
import type { PermissionResult, CanUseToolOptions } from './agent-permission-service'
import { resolvePlanningDeletionPermission } from './planning-permission-policy'
import { askUserService } from './agent-ask-user-service'
import { exitPlanService, type ExitPlanPermissionResult } from './agent-exit-plan-service'
import { validateToolInput } from './agent-tool-input-validator'
import { estimateTokenCount, WRITE_CONTENT_TOKEN_THRESHOLD } from './agent-tool-token-estimator'
import { injectBashDefaultTimeout } from './agent-bash-timeout'
import { injectChromeDevtoolsMcpServer } from './builtin-mcp/chrome-devtools'
import { isBuiltinMcpUserEnabled } from './builtin-mcp/settings'
import { getBuiltinMcpName } from './builtin-mcp/baseline'
import { buildPiBuiltinTools } from './adapters/pi-builtin-tools'
import { buildPiMcpTools } from './adapters/pi-mcp-tools'
import type { AgentRuntimeEnv } from './agent-runtime-env'
import { selectWindowsShell } from './windows-shell-selection'
import { isVisibleRunMessage } from './agent-run-message-visibility'
import { resolveOptimizedCodingEnabled, resolvePiThinkingLevel } from './agent-thinking-level'
import { resolvePiReasoningCapability } from './adapters/pi-model-registry'
import { generateCodexTitle } from './adapters/pi-codex-title-generator'
import { buildRegenerateTitlePrompt, createFallbackTitle, extractAssistantMessageText, extractGenuineUserMessageText, sanitizeGeneratedTitle, selectSpreadMessages, shouldRegenerateTitleAtUserMessageCount, stripContextWrappersForTitle, TITLE_PROMPT } from './title-generation'
import { browserController } from './browser-controller'

// ===== 类型定义 =====

/**
 * 会话控制信号回调
 *
 * 解耦 Electron webContents，使 Orchestrator 可独立测试。
 * agent-service.ts 负责将这些回调绑定到 webContents.send()。
 */
export interface SessionCallbacks {
  /** 发送流式错误 */
  onError: (error: string) => void
  /** 发送流式完成（携带已持久化的消息列表） */
  onComplete: (opts?: { stoppedByUser?: boolean; startedAt?: number; resultSubtype?: string; resultErrors?: string[]; backgroundTasksPending?: boolean }) => void
  /** 发送标题更新 */
  onTitleUpdated: (title: string) => void
  /** 用户消息已持久化，外部入口可据此通知前端切到实时会话 */
  onRunStarted?: (opts: { startedAt: number }) => void
}

type RecoverableAgentQueryOptions = {
  prompt: string
  resumeSessionId?: string
  resumeSessionAt?: string
}

// ===== 工具函数 =====

// getMainRepoRoot 短缓存（主仓库路径几乎不变，避免每条消息 execSync git）
const mainRepoRootCache = new Map<string, { root: string | null; at: number }>()
const MAIN_REPO_ROOT_CACHE_TTL_MS = 5 * 60_000
async function resolveMainRepoRootCached(cwd: string): Promise<string | null> {
  const hit = mainRepoRootCache.get(cwd)
  if (hit && Date.now() - hit.at < MAIN_REPO_ROOT_CACHE_TTL_MS) return hit.root
  const root = await getMainRepoRoot(cwd)
  mainRepoRootCache.set(cwd, { root, at: Date.now() })
  if (mainRepoRootCache.size > 100) {
    let oldestKey: string | undefined
    let oldestAt = Infinity
    for (const [k, v] of mainRepoRootCache) {
      if (v.at < oldestAt) {
        oldestAt = v.at
        oldestKey = k
      }
    }
    if (oldestKey) mainRepoRootCache.delete(oldestKey)
  }
  return root
}

function sdkPermissionModeForMyYodaMode(mode: MyYodaPermissionMode): MyYodaPermissionMode {
  // Pi runtime 直接使用 MyYoda 权限模式，不需要 Claude SDK 模式映射。
  return mode
}

// Claude SDK 环境函数（buildSdkEnvPath、getCaseInsensitiveEnvValue）已随 Claude runtime 退役。

function buildPiRuntimeEnv(env: Record<string, string | undefined>): AgentRuntimeEnv {
  const cleanEnv: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) cleanEnv[key] = value
  }
  return { env: cleanEnv }
}

const EMPTY_RESPONSE_RESULT_SUBTYPE = 'empty_response'

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isMissingActiveQueueChannelError(error: unknown): boolean {
  return errorMessageOf(error).includes('无活跃消息通道可注入队列消息')
}

function isPartialSDKMessage(message: SDKMessage): boolean {
  return (message as Record<string, unknown>)._partial === true
}

/**
 * 从 stderr 中提取 API 错误信息
 *
 * 解析类似这样的错误：
 * "401 {\"error\":{\"message\":\"...\"}}"
 * "API error: 400 Bad Request ..."
 */
function extractApiError(stderr: string): { statusCode: number; message: string } | null {
  if (!stderr) return null

  // 模式 1：JSON 错误格式 - "401 {...}"
  const jsonMatch = stderr.match(/(\d{3})\s+(\{[^}]*"error"[^}]*\})/s)
  if (jsonMatch) {
    try {
      const statusCode = parseInt(jsonMatch[1]!)
      const errorObj = JSON.parse(jsonMatch[2]!)
      const message = errorObj.error?.message || errorObj.message || '未知错误'
      return { statusCode, message }
    } catch {
      // JSON 解析失败，继续尝试其他模式
    }
  }

  // 模式 2：API error 格式 - "API error (attempt X/Y): 401 401 {...}"
  const apiErrorMatch = stderr.match(/API error[^:]*:\s+(\d{3})\s+\d{3}\s+(\{.*?\})/s)
  if (apiErrorMatch) {
    try {
      const statusCode = parseInt(apiErrorMatch[1]!)
      const errorObj = JSON.parse(apiErrorMatch[2]!)
      const message = errorObj.error?.message || errorObj.message || '未知错误'
      return { statusCode, message }
    } catch {
      // JSON 解析失败
    }
  }

  // 模式 3：直接的状态码 + 消息
  const simpleMatch = stderr.match(/(\d{3})[:\s]+(.+?)(?:\n|$)/i)
  if (simpleMatch) {
    const statusCode = parseInt(simpleMatch[1]!)
    const message = simpleMatch[2]!.trim()
    if (statusCode >= 400 && statusCode < 600) {
      return { statusCode, message }
    }
  }

  return null
}

// ===== 自动重试工具函数 =====

/** 可自动重试的 TypedError 错误码 */
const AUTO_RETRYABLE_ERROR_CODES: ReadonlySet<string> = new Set([
  'rate_limited',
  'provider_error', // overloaded 映射为 provider_error
  'service_error',
  'service_unavailable',
  'network_error'
])

/** 判断 typed_error 事件是否可自动重试 */
function isAutoRetryableTypedError(error: TypedError): boolean {
  return AUTO_RETRYABLE_ERROR_CODES.has(error.code)
}

/** 判断 catch 块中的 API 错误是否可自动重试（HTTP 429 / 5xx / 已知可恢复错误模式 / 瞬时网络错误） */
function isAutoRetryableCatchError(apiError: { statusCode: number; message: string } | null, rawErrorMessage?: string, stderr?: string): boolean {
  if (apiError) {
    // 529 是 Anthropic 的过载状态码，通常很快恢复；与 429 / 5xx 一并重试。
    if (apiError.statusCode === 429 || apiError.statusCode >= 500) return true
  }
  // 已知的可恢复错误模式（无 HTTP 状态码但可重试）
  if (rawErrorMessage) {
    if (rawErrorMessage.includes('context_management')) return true
  }
  // 兜底：extractApiError 未识别但 stderr / 错误文本中包含 502 / 529 或 overloaded 关键字时也视为可重试
  // 502 (Bad Gateway) 通常是上游网关瞬时异常，与 529 一样很快自行恢复
  const text = `${rawErrorMessage ?? ''}\n${stderr ?? ''}`
  if (/\b502\b|\b529\b|overloaded/i.test(text)) return true
  // 瞬时网络错误（terminated / ECONNRESET / socket hang up 等）
  if (isTransientNetworkError(rawErrorMessage, stderr)) return true
  // 上游响应体解析失败（JSON Parse error 等）：网关瞬时异常返回非 JSON 体，重试通常即可恢复
  if (isMalformedResponseError(rawErrorMessage, stderr)) return true
  return false
}

/** 最大自动重试次数 */
const MAX_AUTO_RETRIES = 25

/** 重试可见性阈值：前 N 次重试不通知 UI，避免偶发瞬时波动频繁惊扰用户 */
const RETRY_VISIBILITY_THRESHOLD = 5

/** 自动重试累计等待预算（毫秒） */
const MAX_AUTO_RETRY_WAIT_MS = 5 * 60_000

/** 重试单次延迟上限（毫秒） */
const RETRY_MAX_DELAY_MS = 15_000

/**
 * 计算重试延迟（指数退避 + ±20% jitter）
 *
 * 基础序列：1s, 2s, 4s, 8s, 15s, 15s...（cap = 15s）
 * 叠加 ±20% 随机抖动，避免大量 session 同时重试造成惊群。
 * 累计等待会被限制在 5 分钟以内。
 */
function getRetryDelayMs(attempt: number, elapsedRetryDelayMs: number): number {
  const remainingMs = MAX_AUTO_RETRY_WAIT_MS - elapsedRetryDelayMs
  if (remainingMs <= 0) return 0

  const base = Math.min(1000 * Math.pow(2, attempt - 1), RETRY_MAX_DELAY_MS)
  const jitter = base * (Math.random() * 0.4 - 0.2)
  return Math.min(remainingMs, Math.max(0, Math.round(base + jitter)))
}

/** 默认会话标题（用于判断是否需要自动生成） */
const DEFAULT_SESSION_TITLE = '新 Agent 会话'

/** 默认模型 ID */
const DEFAULT_MODEL_ID = 'claude-sonnet-5'

/**
 * 聚合一次 SDK 调用涉及的所有附加目录（去重，保持插入顺序）。
 *
 * 发消息（sendMessage）和回退恢复文件（rewindSession）必须使用同一份聚合结果，
 * 否则 SDK 写入 file-history-snapshot 时使用的目录范围，与回退时校验路径越界的目录范围不一致，
 * 会导致 attachedDirectories 内的文件在回退时被静默跳过（"会话回退、代码不回退"）。
 *
 * 来源：
 *   1. extraDirs：调用方传入的临时附加目录（例如 sendMessage 时用户当次提交的目录）
 *   2. 会话级 attachedDirectories + attachedFiles 的父目录
 *   3. 工作区级 attachedDirectories + attachedFiles 的父目录
 *   4. 工作区文件目录 workspace-files/
 */
function collectAttachedDirectories(params: { sessionMeta?: AgentSessionMeta; workspaceSlug?: string; extraDirs?: string[] }): string[] {
  const { sessionMeta, workspaceSlug, extraDirs } = params
  const result: string[] = []
  const push = (dir: string | undefined | null) => {
    if (!dir) return
    if (!result.includes(dir)) result.push(dir)
  }

  for (const d of extraDirs ?? []) push(d)
  if (sessionMeta?.activeWorktree?.path) push(sessionMeta.activeWorktree.path)
  if (workspaceSlug && sessionMeta) push(getAgentSessionWorkspacePath(workspaceSlug, sessionMeta.id))
  for (const d of sessionMeta?.attachedDirectories ?? []) push(d)
  for (const file of sessionMeta?.attachedFiles ?? []) push(dirname(file))

  if (workspaceSlug) {
    for (const d of getWorkspaceAttachedDirectories(workspaceSlug)) push(d)
    for (const f of getWorkspaceAttachedFiles(workspaceSlug)) push(dirname(f))
    push(getWorkspaceFilesDir(workspaceSlug))
  }

  return result
}

// 视觉助手授权根（含项目工作目录）的纯函数逻辑在 vision-relay-roots.ts，避免与 orchestrator 的 electron 依赖耦合，便于单测。

function escapePromptXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function buildPiAdditionalDirectoriesPrompt(directories: string[]): string {
  if (directories.length === 0) return ''
  const directoryLines = directories.map((dir, index) => `  <directory index="${index + 1}">${escapePromptXml(dir)}</directory>`).join('\n')
  return `

<attached_directories>
这些目录已由 MyYoda 授权给当前会话，和当前工作目录同属于用户允许访问的范围。
如需读取或修改这些目录中的内容，请直接使用绝对路径，不要先复制到当前工作目录。
${directoryLines}
</attached_directories>`
}

// ===== AgentOrchestrator =====

export class AgentOrchestrator {
  private adapter: AgentProviderAdapter
  private eventBus: AgentEventBus
  private activeSessions = new Map<string, number>()
  private nextRunGeneration = 0

  /** 队列消息本地记录（sessionId → UUID 集合，用于防重） */
  private queuedMessageUuids = new Map<string, Set<string>>()
  /** Skill callback may precede queue-message JSONL persistence by one event loop. */
  private pendingUserSkillActivations = new Map<string, Map<string, SkillActivation[]>>()

  /** 被用户手动中止的运行代际（在 stop 中标记，在对应运行的终态路径消费）。 */
  private stoppedBySessions = new Map<string, number>()

  /** 运行中会话的当前权限模式（支持运行时动态切换） */
  private sessionPermissionModes = new Map<string, MyYodaPermissionMode>()

  /**
   * 会话级 repo map 注入去重（sessionId → 最近注入的 map 内容）。
   * 注入动作按「首次 + map 内容变化」执行，避免每轮重复注入相同地图烧 token；
   * SWR 检查不受影响（每轮仍调纯读方法）。LRU 上限防长进程无界增长。
   */
  private injectedRepoMapBySession = new Map<string, string>()
  private static readonly INJECTED_MAP_MAX = 200

  private recordInjectedRepoMap(sessionId: string, map: string): void {
    this.injectedRepoMapBySession.delete(sessionId)
    this.injectedRepoMapBySession.set(sessionId, map)
    if (this.injectedRepoMapBySession.size > AgentOrchestrator.INJECTED_MAP_MAX) {
      const oldest = this.injectedRepoMapBySession.keys().next().value
      if (oldest) this.injectedRepoMapBySession.delete(oldest)
    }
  }

  /**
   * Graphify 知识图谱引导的会话级去重（2026-08-14）。
   * 修复每轮重复注入 ~300 token 的浪费；LRU 上限与 repo map 共用。
   * 值存储 graph.json 路径或 'hint'（无图提示）。
   */
  private injectedGraphifyBySession = new Map<string, string>()

  private recordInjectedGraphify(sessionId: string, value: string): void {
    this.injectedGraphifyBySession.delete(sessionId)
    this.injectedGraphifyBySession.set(sessionId, value)
    if (this.injectedGraphifyBySession.size > AgentOrchestrator.INJECTED_MAP_MAX) {
      const oldest = this.injectedGraphifyBySession.keys().next().value
      if (oldest) this.injectedGraphifyBySession.delete(oldest)
    }
  }

  /**
   * 注入 Graphify MCP stdio server（P3，2026-08-14）。
   * 条件：主仓库图存在 + graphifyy[mcp] 已装（isGraphifyMcpAvailable 含 10 分钟缓存）。
   * 用户自配同名 'graphify' server 时不覆盖。project_path 参数的安全剥离在 pi-mcp-tools 桥接层。
   * 主仓库解析用 resolveMainRepoRootCached（5 分钟缓存，避免每轮 execSync git）。
   */
  private async injectGraphifyMcpServer(mcpServers: Record<string, Record<string, unknown>>, agentCwd: string): Promise<void> {
    if (mcpServers.graphify) return
    try {
      const mainRepo = await resolveMainRepoRootCached(agentCwd)
      if (!mainRepo) return
      const graphPath = graphJsonPath(mainRepo)
      if (!existsSync(graphPath)) return
      if (!repoMapToolsService.isGraphifyMcpAvailable()) return
      mcpServers.graphify = {
        type: 'stdio',
        command: 'python',
        args: ['-m', 'graphify.serve', graphPath, '--transport', 'stdio']
      }
      console.log(`[Agent 编排] 已注入 Graphify MCP（stdio，图：${graphPath}）`)
    } catch (error) {
      console.warn('[Agent 编排] Graphify MCP 注入失败，已跳过:', error)
    }
  }

  constructor(adapter: AgentProviderAdapter, eventBus: AgentEventBus) {
    this.adapter = adapter
    this.eventBus = eventBus
  }

  /**
   * 消费一次用户手动停止标记。
   *
   * SDK 在 query.close() 后不一定走异常路径：某些版本会先正常 yield result 再结束迭代。
   * 因此停止标记必须在所有终态路径统一消费，而不能只依赖 catch 块。
   */
  private consumeStoppedByUser(sessionId: string, runGeneration: number): boolean {
    if (this.stoppedBySessions.get(sessionId) !== runGeneration) return false
    this.stoppedBySessions.delete(sessionId)
    return true
  }

  /**
   * 构建 SDK 环境变量
   *
   * 注入 API Key、Base URL、代理、Shell 配置等。
   * 对 Kimi Coding Plan / MiniMax Coding Plan：使用 Bearer 认证（ANTHROPIC_AUTH_TOKEN）。
   */
  // buildSdkEnv 已删除（Claude runtime 退役）。Pi runtime 使用 buildPiRuntimeEnv。

  /**
   * 构建 MCP 服务器配置。
   *
   * 若会话绑定了嵌套 Project 且该 Project 已自己配置过 MCP 服务器，用项目级覆盖工作区级；
   * 否则（未绑定项目、项目未自己配置过）100% 沿用工作区级行为，不影响存量会话。
   */
  private buildMcpServers(workspaceSlug: string | undefined, projectId: string | undefined): Record<string, Record<string, unknown>> {
    const mcpServers: Record<string, Record<string, unknown>> = {}
    if (!workspaceSlug) return mcpServers

    const mcpConfig = projectId && hasProjectMcpServers(workspaceSlug, projectId) ? getProjectMcpConfig(workspaceSlug, projectId) : getWorkspaceMcpConfig(workspaceSlug)
    for (const [name, entry] of Object.entries(mcpConfig.servers ?? {})) {
      if (!entry.enabled) continue
      if (name === 'memos-cloud') continue
      const type = normalizeMcpTransportType((entry as { type?: unknown }).type)

      if (type === 'stdio' && entry.command) {
        const mergedEnv: Record<string, string> = {
          ...(process.env.PATH && { PATH: process.env.PATH }),
          ...entry.env
        }
        mcpServers[name] = {
          type: 'stdio',
          command: entry.command,
          ...(entry.args && entry.args.length > 0 && { args: entry.args }),
          ...(Object.keys(mergedEnv).length > 0 && { env: mergedEnv }),
          required: false,
          startup_timeout_sec: entry.timeout ?? 30
        }
      } else if ((type === 'http' || type === 'sse') && entry.url) {
        mcpServers[name] = {
          type,
          url: entry.url,
          ...(entry.headers &&
            Object.keys(entry.headers).length > 0 && {
              headers: entry.headers
            }),
          required: false
        }
      } else {
        console.warn(`[Agent 编排] MCP 服务器 "${name}" 配置不完整，已跳过（type=${entry.type}, command=${entry.command ?? '无'}, url=${entry.url ?? '无'}）`)
      }
    }

    if (Object.keys(mcpServers).length > 0) {
      console.log(`[Agent 编排] 已加载 ${Object.keys(mcpServers).length} 个 MCP 服务器`)
    }

    return mcpServers
  }

  /** 通过独立 Pi Responses 链路调用 ChatGPT OAuth 标题模型。 */
  private async callCodexTitleModel(channelId: string, modelId: string, prompt: string, signal?: AbortSignal): Promise<string | null> {
    const [credentials, proxyUrl] = await Promise.all([resolveCodexOAuthCredentials(channelId), getEffectiveProxyUrl()])
    if (signal?.aborted) return null
    const generatedTitle = await generateCodexTitle({
      modelId,
      prompt,
      credentials,
      proxyUrl,
      signal,
      onCredentialsRefreshed: (refreshed) => persistCodexOAuthCredentials(channelId, refreshed)
    })
    return generatedTitle ? sanitizeGeneratedTitle(generatedTitle) : null
  }

  /**
   * 调用渠道对应的标题模型并返回清理结果。普通渠道走 Provider 适配器，ChatGPT OAuth
   * 走独立 Pi Responses 链路；渠道不存在时返回 null，API 异常交由调用方按场景降级。
   */
  private async callTitleModel(channelId: string, modelId: string, prompt: string, signal?: AbortSignal): Promise<string | null> {
    const channels = listChannels()
    const sessionChannel = channels.find((c) => c.id === channelId)
    if (!sessionChannel) {
      console.warn('[Agent 标题生成] 渠道不存在:', channelId)
      return null
    }
    const channel = resolveTitleChannel(channels, channelId, getSettings().titleProvider)
    if (!channel) return null
    const titleModelId = resolveTitleModel({
      provider: channel.provider,
      defaultModelId: channel.id === channelId ? modelId : (channel.models.find((model) => model.enabled)?.id ?? modelId),
      models: channel.models
    })
    if (channel.provider === 'openai-codex') {
      return this.callCodexTitleModel(channel.id, titleModelId, prompt, signal)
    }
    if (channel.provider === 'anthropic-oauth' || channel.provider === 'xai') return null

    const apiKey = await resolveChannelRuntimeApiKey(channel.id)
    const providerAdapter = getAdapter(channel.provider)
    const request = providerAdapter.buildTitleRequest({
      baseUrl: channel.baseUrl,
      apiKey,
      modelId: titleModelId,
      prompt
    })

    const proxyUrl = await getEffectiveProxyUrl()
    const fetchFn = getFetchFn(proxyUrl)
    const title = await fetchTitle(request, providerAdapter, fetchFn)
    return title ? sanitizeGeneratedTitle(title) : null
  }

  /**
   * 生成 Agent 会话标题
   *
   * 使用 Provider 适配器系统，支持所有渠道。任何错误返回 null。
   */
  async generateTitle(input: AgentGenerateTitleInput, signal?: AbortSignal): Promise<string | null> {
    const { channelId, modelId } = input
    if (signal?.aborted) return null
    // 剥离附件/引用文件/引用上下文的 XML 包装块，避免标题模型把这些样板当成正文
    const userMessage = stripContextWrappersForTitle(input.userMessage)
    console.log('[Agent 标题生成] 开始生成标题:', {
      channelId,
      modelId,
      userMessage: userMessage.slice(0, 50)
    })

    try {
      // 标题渠道由 callTitleModel 按设置解析；Codex 也走同一条轻量请求/回退链路。
      // xAI 订阅当前使用 Pi provider-specific OAuth transport，标题模型暂走本地兜底。
      const result = await this.callTitleModel(channelId, modelId, TITLE_PROMPT + userMessage, signal)
      if (signal?.aborted) return null
      if (!result) {
        console.warn('[Agent 标题生成] API 返回空标题，使用本地兜底')
        return createFallbackTitle(userMessage)
      }
      console.log(`[Agent 标题生成] 生成标题成功: "${result}"`)
      return result
    } catch (error) {
      if (signal?.aborted) return null
      console.warn('[Agent 标题生成] 生成失败，使用本地兜底:', error)
      return createFallbackTitle(userMessage)
    }
  }

  /**
   * 流完成后自动生成标题
   *
   * 如果会话标题仍为默认值，自动调用标题生成并通过回调通知。
   */
  private async autoGenerateTitle(sessionId: string, userMessage: string, channelId: string, modelId: string, callbacks: SessionCallbacks, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return
    try {
      const meta = getAgentSessionMeta(sessionId)
      if (!meta || meta.titleSource === 'manual' || meta.title !== DEFAULT_SESSION_TITLE) return

      const title = await this.generateTitle({ userMessage, channelId, modelId }, signal)
      if (!title || signal?.aborted) return

      // 标题请求是异步的；请求期间用户可能已手动重命名，不能用旧结果覆盖。
      const latestMeta = getAgentSessionMeta(sessionId)
      if (!latestMeta || latestMeta.title !== DEFAULT_SESSION_TITLE) return
      if (signal?.aborted) return

      updateAgentSessionMeta(sessionId, { title, titleSource: 'auto' })
      callbacks.onTitleUpdated(title)
      console.log(`[Agent 编排] 自动标题生成完成: "${title}"`)
    } catch (error) {
      if (signal?.aborted) return
      console.warn('[Agent 编排] 自动标题生成失败:', error)
    }
  }

  /**
   * 会话进行到中段后，用首/中/尾用户消息 + 最新回复重新生成标题（参考 craft-agents-oss）。
   *
   * 首条消息生成的标题只反映最初的引子，用户聊开后主题经常已经偏移。仅在用户消息数命中
   * TITLE_REGENERATION_USER_MESSAGE_COUNTS 这几个固定节点时触发一次，节点值本身随消息数
   * 单调递增只会命中一次，因此不需要额外持久化"是否已重新生成过"的状态。
   */
  private async maybeRegenerateTitle(sessionId: string, channelId: string, modelId: string, callbacks: SessionCallbacks, signal?: AbortSignal): Promise<void> {
    try {
      const meta = getAgentSessionMeta(sessionId)
      if (meta?.titleSource === 'manual' || signal?.aborted) return

      const messages = getAgentSessionMessages(sessionId)
      const userMessageTexts = messages.map((m) => extractGenuineUserMessageText(m)).filter((text): text is string => text !== null)
      if (!shouldRegenerateTitleAtUserMessageCount(userMessageTexts.length)) return

      let lastAssistantText: string | null = null
      for (let i = messages.length - 1; i >= 0; i--) {
        lastAssistantText = extractAssistantMessageText(messages[i])
        if (lastAssistantText) break
      }
      if (!lastAssistantText) return

      const spread = selectSpreadMessages(userMessageTexts.map((text) => stripContextWrappersForTitle(text)))
      if (spread.length === 0) return

      const prompt = buildRegenerateTitlePrompt(spread, lastAssistantText)
      const title = await this.callTitleModel(channelId, modelId, prompt, signal)
      if (!title || signal?.aborted) return

      // 标题请求是异步的；请求期间用户可能已手动重命名，不能用旧结果覆盖。
      const latestMeta = getAgentSessionMeta(sessionId)
      if (!latestMeta || latestMeta.titleSource === 'manual') return
      if (signal?.aborted) return

      updateAgentSessionMeta(sessionId, { title, titleSource: 'auto' })
      callbacks.onTitleUpdated(title)
      console.log(`[Agent 编排] 中段标题重新生成完成: "${title}"（用户消息数=${userMessageTexts.length}）`)
    } catch (error) {
      if (signal?.aborted) return
      console.warn('[Agent 编排] 中段标题重新生成失败:', error)
    }
  }

  /**
   * Session-not-found 恢复：保留磁盘 sdkSessionId，本轮切换到上下文回填模式
   *
   * 当 resume 的目标 session 报 "No conversation found" 时触发。注意该错误可能是
   * listSessions 路径哈希不匹配导致的误检（见步骤 9.6 注释），不代表会话真正失效，
   * 因此不清除磁盘 meta：本轮以非 resume 模式恢复，若失败下一轮仍可尝试 resume（#903）。
   * 调用方负责设置本地 existingSdkSessionId = undefined 和流程控制（break/continue）。
   *
   * @returns lastRetryableError 描述字符串
   */
  private prepareSessionNotFoundRecovery(sessionId: string, queryOptions: RecoverableAgentQueryOptions, contextualMessage: string, agentCwd: string, workspaceSlug: string | undefined, accumulatedMessages: SDKMessage[], queryStartedAt: number): string {
    return this.prepareResumeFallbackRecovery(sessionId, queryOptions, contextualMessage, agentCwd, workspaceSlug, accumulatedMessages, queryStartedAt, '检测到 session-not-found（可能为误检），保留 sdkSessionId 并切换到上下文回填模式', 'Session 暂不可 resume，切换到上下文回填模式')
  }

  /**
   * Resume 失败恢复：本轮切到「非 resume + 历史回填恢复」模式，注入 session 自引用让 Agent
   * 优先通过 session-cleaner 读取干净历史继续工作。使用 <session_recovery> 标签指向当前会话，
   * 比 buildContextPrompt（仅注入 20 条摘要）提供完整得多的上下文连续性。
   *
   * 关于磁盘 meta 的 sdkSessionId（由 clearPersistedSession 控制，默认 false 即保留）：
   * - 默认保留：本轮恢复只改本地 queryOptions，不动磁盘；若本轮成功，SDK 新会话的 ID 会经
   *   onSessionId 回调自动覆盖 meta；若本轮失败到终止，下一轮仍可尝试 resume 旧 ID（#903）。
   *   这是「迷了就别删」的安全默认，适用于 session-not-found（可能为误检）等不确定场景。
   * - 仅 thinking-signature 跨模型不兼容时传 true：旧 ID 指向的 JSONL 焊死了旧模型思考块，
   *   当前模型 resume 必然再次失败，此时主动清除可避免下一轮无谓的失败往返。
   */
  private prepareResumeFallbackRecovery(sessionId: string, queryOptions: RecoverableAgentQueryOptions, contextualMessage: string, agentCwd: string, workspaceSlug: string | undefined, accumulatedMessages: SDKMessage[], queryStartedAt: number, logMessage: string, retryReason: string, clearPersistedSession = false): string {
    console.log(`[Agent 编排] ${logMessage}`)
    // 先持久化当前已累积的消息，确保 JSONL 文件包含最新内容
    this.persistSDKMessages(sessionId, accumulatedMessages, Date.now() - queryStartedAt)
    accumulatedMessages.length = 0
    // 仅在确定旧会话永久无效时（thinking-signature）才清除磁盘 meta；
    // 其余场景保留，新 SDK 会话产生的 sdkSessionId 会通过 onSessionId 回调自动覆盖。
    if (clearPersistedSession) {
      try {
        updateAgentSessionMeta(sessionId, { sdkSessionId: undefined })
      } catch {
        /* 忽略 */
      }
    }
    queryOptions.resumeSessionId = undefined
    queryOptions.resumeSessionAt = undefined
    queryOptions.prompt = buildRecoveryPrompt(sessionId, contextualMessage, {
      agentCwd,
      workspaceSlug
    })
    return retryReason
  }

  /**
   * 持久化累积的 SDKMessage（Phase 4: 直接存储原始 SDKMessage）
   *
   * 只持久化 assistant、user、result 和需要长期可见的 system 消息。
   */
  private persistSDKMessages(sessionId: string, accumulatedMessages: SDKMessage[], durationMs?: number): void {
    if (accumulatedMessages.length === 0) return

    const hasCompactBoundary = accumulatedMessages.some((m) => {
      return m.type === 'system' && (m as SDKSystemMessage).subtype === 'compact_boundary'
    })

    const toPersist = accumulatedMessages
      .filter((m) => m.type === 'assistant' || m.type === 'user' || m.type === 'result' || (m.type === 'system' && isPersistableSDKSystemMessage(m as SDKSystemMessage)))
      .filter((m) => {
        if (isPartialSDKMessage(m)) return false
        if (m.type === 'system') {
          const sysMsg = m as SDKSystemMessage
          if (hasCompactBoundary && sysMsg.subtype === 'status' && sysMsg.compact_result === 'success') {
            return false
          }
        }
        // 过滤 SDK 内部生成的 user 文本消息（如 Skill 展开 prompt），与实时流过滤逻辑一致
        if (m.type === 'user') {
          const content = (m as { message?: { content?: Array<{ type: string }> } }).message?.content
          const hasToolResult = Array.isArray(content) && content.some((b) => b.type === 'tool_result')
          if (!hasToolResult) return false
        }
        return true
      })

    if (toPersist.length === 0) return

    // 为没有 _createdAt 的消息补上时间戳（assistant 消息来自 SDK 原始输出，不含时间）
    const now = Date.now()
    const withTimestamps = toPersist.map((m) => {
      const msg = m as Record<string, unknown>
      if (typeof msg._createdAt === 'number') return m
      // 为 result 消息附加 _durationMs
      if (m.type === 'result' && durationMs != null) {
        return {
          ...m,
          _createdAt: now,
          _durationMs: durationMs
        } as unknown as SDKMessage
      }
      return { ...m, _createdAt: now } as unknown as SDKMessage
    })

    appendSDKMessages(sessionId, withTimestamps)
  }

  private persistUserMessage(sessionId: string, userMessage: string, createdAt = Date.now()): string {
    const uuid = randomUUID()
    const userSDKMsg: SDKMessage = {
      type: 'user',
      uuid,
      message: {
        content: [{ type: 'text', text: userMessage }]
      },
      parent_tool_use_id: null,
      _createdAt: createdAt
    } as unknown as SDKMessage
    appendSDKMessages(sessionId, [userSDKMsg])
    return uuid
  }

  private recordUserSkillActivations(sessionId: string, userMessageUuid: string, activations: SkillActivation[]): void {
    try {
      if (updateSDKUserMessageSkillActivations(sessionId, userMessageUuid, activations)) return
    } catch (error) {
      console.warn(`[Agent 编排] 写入用户 Skill metadata 失败，将等待消息落盘后重试:`, error)
    }

    const byMessage = this.pendingUserSkillActivations.get(sessionId) ?? new Map<string, SkillActivation[]>()
    byMessage.set(userMessageUuid, mergeSkillActivations(byMessage.get(userMessageUuid) ?? [], activations))
    this.pendingUserSkillActivations.set(sessionId, byMessage)
  }

  private flushPendingUserSkillActivations(sessionId: string, userMessageUuid: string): void {
    const byMessage = this.pendingUserSkillActivations.get(sessionId)
    const activations = byMessage?.get(userMessageUuid)
    if (!activations?.length) return
    try {
      if (!updateSDKUserMessageSkillActivations(sessionId, userMessageUuid, activations)) return
      byMessage?.delete(userMessageUuid)
      if (byMessage?.size === 0) this.pendingUserSkillActivations.delete(sessionId)
    } catch (error) {
      console.warn(`[Agent 编排] 补写用户 Skill metadata 失败:`, error)
    }
  }

  private clearPendingUserSkillActivations(sessionId: string, userMessageUuid?: string): void {
    if (!userMessageUuid) {
      this.pendingUserSkillActivations.delete(sessionId)
      return
    }
    const byMessage = this.pendingUserSkillActivations.get(sessionId)
    if (!byMessage) return
    byMessage.delete(userMessageUuid)
    if (byMessage.size === 0) this.pendingUserSkillActivations.delete(sessionId)
  }

  private persistEmptyResponseError(
    sessionId: string,
    channelId: string,
    resultSubtype: string | undefined,
    resultErrors: string[] | undefined,
  ): string {
    const detail = resultErrors?.find((error) => error.trim().length > 0)?.trim()
    const subtype = resultSubtype ?? 'unknown'
    const errorContent = detail ? `Agent 本轮结束了，但没有返回任何可展示内容。错误详情：${detail}` : resultSubtype === 'success' ? 'Agent 本轮结束了，但没有返回任何可展示内容。你的消息已保留，可以直接重试或切换模型。' : `Agent 本轮异常结束（${subtype}），但没有返回任何可展示内容。你的消息已保留，可以直接重试或切换模型。`
    const errorSDKMsg: SDKMessage = {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: errorContent }]
      },
      parent_tool_use_id: null,
      uuid: randomUUID(),
      error: {
        message: errorContent,
        errorType: EMPTY_RESPONSE_RESULT_SUBTYPE
      },
      _createdAt: Date.now(),
      _errorCode: 'unknown_error',
      _errorTitle: '没有收到模型回复',
      _errorCanRetry: true,
      _errorActions: [
        { key: 'r', label: '重试', action: 'retry' },
        { key: 'm', label: '重新选择模型', action: 'select_model' }
      ]
    } as unknown as SDKMessage
    appendSDKMessages(sessionId, [withAgentMessageChannelIdentity(errorSDKMsg, channelId)])
    console.warn(`[Agent 编排] 本轮没有收到可展示内容: sessionId=${sessionId}, resultSubtype=${subtype}`)
    return errorContent
  }

  /**
   * 发送消息并流式推送事件
   *
   * 核心编排方法，从 agent-service.ts 的 runAgent 提取。
   * 通过 EventBus 分发 AgentEvent，通过 callbacks 发送控制信号。
   */
  async sendMessage(
    input: AgentSendInput,
    callbacks: SessionCallbacks,
    extensions: {
      piCustomTools?: import('@earendil-works/pi-coding-agent').ToolDefinition[]
    } = {}
  ): Promise<void> {
    const { sessionId, userMessage, rawUserMessage, channelId, modelId, workspaceId, additionalDirectories, customMcpServers, permissionModeOverride, mentionedSkills, mentionedMcpServers, mentionedSessionIds, mentionedTodoIds, mentionedCalendarEventIds, automationContext, workContext, retryOfErrorUuid, toolPolicy } = input
    // Claude runtime 已于 2026-08 退役，所有会话统一走 Pi。
    const agentRuntime: import('@myyoda/shared').AgentRuntime = 'pi'
    const toolsDisabled = toolPolicy === 'none'
    const stderrChunks: string[] = []
    const streamStartedAt = input.startedAt ?? Date.now()
    let userMessagePersisted = false
    let initialUserMessageUuid: string | undefined
    let sessionMeta = getAgentSessionMeta(sessionId)

    const persistInitialUserMessage = (): void => {
      if (userMessagePersisted) return
      // rawUserMessage 保留展示/持久化用的原始文本（@file 编码原文，remarkMentions 解码显示）；
      // userMessage 是传给 Agent 的 SDK 文本（@file 路径已解码为真实路径）。
      initialUserMessageUuid = this.persistUserMessage(sessionId, rawUserMessage ?? userMessage)
      userMessagePersisted = true
    }

    // 0. 并发保护
    const hasActiveRun = this.activeSessions.has(sessionId)
    const shouldPersistUserMessage = shouldPersistInitialUserMessage({
      hasActiveRun,
      retryOfErrorUuid
    })
    if (hasActiveRun) {
      // 并发请求没有真正启动新的 Agent run，绝不能把它当作新用户输入写入 JSONL。
      // 尤其在用户点击停止后、底层 query 尚未完全退出的短暂窗口内，否则同一条
      // 后续消息会随每次点击重复落盘。
      console.warn(`[Agent 编排] 会话 ${sessionId} 正在处理中，拒绝新请求且不保存用户消息`)
      callbacks.onError(getActiveRunRejectionMessage())
      callbacks.onComplete({ startedAt: streamStartedAt })
      return
    }

    // 手动重试直接删除原错误，避免它在下一轮完成后仍被历史回放。
    // 删除失败不阻断重试（例如旧版本遗留的无 UUID 错误）。
    if (retryOfErrorUuid) {
      try {
        removeSDKErrorMessage(sessionId, retryOfErrorUuid)
      } catch (error) {
        console.warn(`[Agent 编排] 删除重试前错误失败: ${retryOfErrorUuid}`, error)
      }
    }

    if (shouldPersistUserMessage) {
      try {
        persistInitialUserMessage()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error('[Agent 编排] 持久化用户消息失败:', error)
        callbacks.onError(`消息保存失败：${message}`)
        callbacks.onComplete({ startedAt: streamStartedAt })
        return
      }
    }

    // 0.5 清除上一轮中断标记
    try {
      updateAgentSessionMeta(sessionId, { stoppedByUser: false })
    } catch {
      /* 会话可能已删除 */
    }

    // 环境 / 配置类错误的统一上报：持久化为 TypedError 消息，由 SDKMessageRenderer 渲染
    const reportPreflightError = (typedError: TypedError) => {
      const errorContent = typedError.title ? `${typedError.title}: ${typedError.message}` : typedError.message
      const errorSDKMsg: SDKMessage = {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: errorContent }]
        },
        parent_tool_use_id: null,
        uuid: randomUUID(),
        error: { message: typedError.message, errorType: typedError.code },
        _createdAt: Date.now(),
        _errorCode: typedError.code,
        _errorTitle: typedError.title,
        _errorDetails: typedError.details,
        _errorCanRetry: typedError.canRetry,
        _errorActions: typedError.actions
      } as unknown as SDKMessage
      try { appendSDKMessages(sessionId, [withAgentMessageChannelIdentity(errorSDKMsg, channelId)]) } catch (e) {
        console.error('[Agent 编排] 持久化 preflight error 失败:', e)
      }
      callbacks.onError(errorContent)
      callbacks.onComplete({ startedAt: streamStartedAt })
    }

    // 1. Windows 平台：检查 Shell 环境可用性
    if (process.platform === 'win32') {
      const runtimeStatus = getRuntimeStatus()
      const shellStatus = runtimeStatus?.shell

      if (shellStatus && !shellStatus.gitBash?.available && !shellStatus.wsl?.available) {
        reportPreflightError({
          code: 'windows_shell_missing',
          title: 'Windows 环境未就绪',
          message: '需要 Git Bash 或 WSL 才能运行 Agent。建议安装 Git for Windows（自带 Git Bash），安装完成后点「打开环境检测」刷新状态。',
          details: [`Git Bash: ${shellStatus.gitBash?.error || '未检测到'}`, `WSL: ${shellStatus.wsl?.error || '未检测到'}`],
          actions: [
            {
              key: 'e',
              label: '打开环境检测',
              action: 'open_environment_check'
            },
            {
              key: 'g',
              label: '去官方下载 Git',
              action: 'open_external',
              payload: 'https://git-scm.com/download/win'
            }
          ],
          canRetry: false
        })
        return
      }
    }

    // 2. 获取渠道信息并解密 API Key
    const channel = getChannelById(channelId)
    if (!channel) {
      reportPreflightError({
        code: 'channel_not_found',
        title: '渠道不存在',
        message: '当前会话引用的渠道已被删除或不可用，请在设置中重新选择。',
        actions: [{ key: 's', label: '打开渠道设置', action: 'open_channel_settings' }],
        canRetry: false
      })
      return
    }

    let apiKey: string
    let codexOAuthCredentials: CodexOAuthCredentials | undefined
    let xaiOAuthCredentials: XaiOAuthCredentials | undefined
    try {
      // 订阅 OAuth 渠道必须保留完整凭据给 Pi runtime，才能在执行中按真实 expires
      // 自动刷新；Claude OAuth 需取出真正 access token，不能直接把凭据 JSON 传给 SDK；
      // 其余渠道只需解密 API Key。
      if (channel.provider === 'openai-codex') {
        codexOAuthCredentials = await resolveCodexOAuthCredentials(channelId)
        apiKey = codexOAuthCredentials.access
      } else if (channel.provider === 'anthropic-oauth') {
        apiKey = (await resolveClaudeOAuthCredentials(channelId)).token
      } else if (channel.provider === 'xai') {
        xaiOAuthCredentials = await resolveXaiOAuthCredentials(channelId)
        apiKey = xaiOAuthCredentials.access
      } else {
        apiKey = decryptApiKey(channelId)
      }
    } catch (err) {
      if (channel.provider === 'openai-codex' || channel.provider === 'xai') {
        const isXai = channel.provider === 'xai'
        reportPreflightError({
          code: 'expired_oauth_token',
          title: isXai ? 'xAI 登录已失效' : 'ChatGPT 登录已失效',
          message: isXai ? '无法刷新 xAI 登录凭据，登录可能已过期或被撤销。请在设置中重新登录 xAI。' : '无法刷新 ChatGPT 登录凭据，登录可能已过期或被撤销。请在设置中重新登录 ChatGPT。',
          actions: [
            {
              key: 's',
              label: '打开渠道设置',
              action: 'open_channel_settings'
            }
          ],
          canRetry: false
        })
        return
      }
      if (channel.provider === 'anthropic-oauth') {
        reportPreflightError({
          code: 'expired_oauth_token',
          title: 'Claude 订阅登录已失效',
          message: '无法刷新 Claude 订阅登录凭据，登录可能已过期或被撤销。请在设置中重新登录 Claude 账号。',
          actions: [
            {
              key: 's',
              label: '打开渠道设置',
              action: 'open_channel_settings'
            }
          ],
          canRetry: false
        })
        return
      }
      reportPreflightError({
        code: 'api_key_decrypt_failed',
        title: 'API Key 解密失败',
        message: '无法解密此渠道的 API Key，可能是系统密钥环异常。请到设置中重新填写 API Key。',
        actions: [{ key: 's', label: '打开渠道设置', action: 'open_channel_settings' }],
        canRetry: false
      })
      return
    }

    const appSettings = getSettings()
    sessionMeta = getAgentSessionMeta(sessionId)
    // Claude runtime 已于 2026-08 退役，所有会话统一走 Pi。
    // 历史回退点（resumeAtMessageUuid）与新 session 统一由 Pi 处理。
    console.log(`[Agent 编排] Agent runtime: pi`)

    if (sessionMeta?.legacyTranscript?.continuationRequired) {
      reportPreflightError({
        code: 'agent_runtime_not_found',
        title: '历史会话需要迁移',
        message: '这是已退役 Claude runtime 的只读历史会话。请新建 Pi Agent 会话，并通过会话引用带入此历史。',
        actions: [],
        canRetry: false
      })
      return
    }

    if (!channel.enabled) {
      reportPreflightError({
        code: 'channel_disabled',
        title: '渠道已禁用',
        message: '当前会话引用的渠道已被禁用，请在设置中启用渠道或重新选择模型。',
        actions: [{ key: 's', label: '打开渠道设置', action: 'open_channel_settings' }],
        canRetry: false
      })
      return
    }

    // 2.1 立即抢占会话槽位（在所有同步检查通过后、第一个 await 之前）
    // 防止 buildSdkEnv 等 await 期间并发调用绕过上方的检查，导致多条重复消息写入 JSONL
    // finally 块会通过 generation 匹配来安全清理，不影响正常流程
    const runGeneration = ++this.nextRunGeneration
    this.activeSessions.set(sessionId, runGeneration)
    callbacks.onRunStarted?.({ startedAt: streamStartedAt })

    const releaseActiveRun = (): void => {
      // 在发送 STREAM_COMPLETE 前释放 active slot，避免渲染进程已进入空闲态、
      // 主进程仍在 finally 前短暂拒绝下一条消息。
      const ownsActiveRun = this.activeSessions.get(sessionId) === runGeneration
      if (ownsActiveRun) {
        this.activeSessions.delete(sessionId)
        this.sessionPermissionModes.delete(sessionId)
        this.queuedMessageUuids.delete(sessionId)
      }
    }
    const completeRun = (
      opts?: {
        stoppedByUser?: boolean
        startedAt?: number
        resultSubtype?: string
        resultErrors?: string[]
      }
    ): void => {
      releaseActiveRun()
      callbacks.onComplete(opts)
      // 用户中途打断的 turn 可能没有完整的最新回复，不适合作为标题重新生成的素材
      if (!opts?.stoppedByUser) {
        this.maybeRegenerateTitle(sessionId, channelId, resolvedModel, callbacks).catch((err) => console.warn('[Agent 编排] 中段标题重新生成未捕获异常:', err))
      }
    }
    // 轻量完成：turn 主体结束但仍有后台任务在飞行。
    // 关键区别——不调用 releaseActiveRun，保留 activeSessions/activeChannels/sessionPermissionModes，
    // 以便 ① adapter 保持的通道在任务完成时自动续轮 ② 用户在等待期手动注入消息能复用通道。
    // UI 侧通过 backgroundTasksPending 进入"空闲可输入"态（spinner 停、输入框启用）。
    const idleComplete = (
      opts?: {
        startedAt?: number
        resultSubtype?: string
        resultErrors?: string[]
      }
    ): void => {
      callbacks.onComplete({ ...opts, backgroundTasksPending: true })
    }
    const failRun = (
      error: string,
      opts?: { stoppedByUser?: boolean; startedAt?: number; resultSubtype?: string; resultErrors?: string[] },
    ): void => {
      releaseActiveRun()
      callbacks.onError(error)
      callbacks.onComplete(opts)
    }

    // 3. 构建环境变量
    // Claude runtime 已退役：不再向 process.env 注入 CLAUDE_CODE_OAUTH_TOKEN / ANTHROPIC_* 认证变量。
    // Pi runtime 通过 registerProvider({ apiKey, baseUrl }) 传递认证，无需污染全局环境。
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_AUTH_TOKEN
    delete process.env.ANTHROPIC_BASE_URL
    delete process.env.ANTHROPIC_CUSTOM_HEADERS

    // 4. 读取已有的 SDK session ID（用于 resume）
    let existingSdkSessionId = sessionMeta?.sdkSessionId

    // 4.1 检测回退后的 resume 截断点（快照回退功能）
    let rewindResumeAt: string | undefined
    if (sessionMeta?.resumeAtMessageUuid) {
      rewindResumeAt = sessionMeta.resumeAtMessageUuid
      // 消费一次后清除
      updateAgentSessionMeta(sessionId, { resumeAtMessageUuid: undefined })
      console.log(`[Agent 编排] 检测到回退 resume: resumeSessionAt=${rewindResumeAt}`)
    }

    console.log(`[Agent 编排] Resume 状态: sdkSessionId=${existingSdkSessionId || '无'}, myyoda sessionId=${sessionId}`)

    // 5. 状态初始化
    const accumulatedMessages: SDKMessage[] = []
    let pendingSkillActivations: SkillActivation[] = []
    const recordSkillActivation = (activations: SkillActivation[], userMessageUuid: string): void => {
      pendingSkillActivations = mergeSkillActivations(pendingSkillActivations, activations)
      this.recordUserSkillActivations(sessionId, userMessageUuid, activations)
    }
    // 委派子会话与内置工具都必须继承当前实际运行的模型。
    const selectedModelId = modelId || DEFAULT_MODEL_ID
    let resolvedModel = selectedModelId
    let titleGenerationStarted = false
    /** 捕获到的 SDK session ID（用于 resume / recovery） */
    let capturedSdkSessionId = existingSdkSessionId
    let agentCwd: string | undefined
    let agentCwdSource: SessionCwdSource | undefined
    let workspaceSlug: string | undefined
    let workspace: import('@myyoda/shared').AgentWorkspace | undefined
    let sessionFileRoots: import('@myyoda/shared').AgentSessionFileRoots | undefined
    let turnOutputSnapshot: ReturnType<typeof snapshotOutputFiles> | undefined

    try {
      // Claude runtime 已于 2026-08 退役；Pi 无需额外二进制。
      const sdk = undefined
      const cliPath = undefined

      console.log(`[Agent 编排] 启动 Pi runtime — 模型: ${modelId || DEFAULT_MODEL_ID}, resume: ${existingSdkSessionId ?? '无'}`)

      // 确定 Agent 工作目录
      agentCwd = homedir()
      workspaceSlug = undefined
      workspace = undefined
      // 会话专属 sandbox 目录：用户上传/拖拽的文件会被复制到这里，无论最终 cwd 决策
      // 结果如何（project 模式 cwd=项目目录），它都必须是 VisionRelay 的授权根之一。
      let agentSandboxDir: string | undefined
      if (workspaceId) {
        const ws = getAgentWorkspace(workspaceId)
        if (!ws) {
          throw new Error(`指定的 Agent 项目不存在或已删除: ${workspaceId}`)
        }
        let activeWorktree = sessionMeta?.activeWorktree
        if (activeWorktree) {
          const activeWorktreePath = getActiveWorktreePath(sessionMeta)
          const currentMainRepoRoot = activeWorktreePath ? await getMainRepoRoot(activeWorktreePath) : null
          if (!activeWorktreePath || !currentMainRepoRoot || normalizePathForCompare(currentMainRepoRoot) !== normalizePathForCompare(activeWorktree.mainRepoRoot)) {
            console.warn(`[Agent 编排] 活动 worktree 已失效，回退默认 cwd: ${activeWorktree.path}`)
            sessionMeta = updateAgentSessionMeta(sessionId, {
              activeWorktree: undefined
            })
            activeWorktree = undefined
          }
        }
        if (ws) {
          workspaceSlug = ws.slug
          workspace = ws
          // 会话专属沙箱：无论最终 cwd 决策结果如何，都要确保它存在
          // （放置 .claude/settings.json、.context/ 等会话级辅助文件，与实际
          // 工作目录解耦，避免 project 模式下污染用户真实项目目录）。
          const sandboxCwd = getAgentSessionWorkspacePath(ws.slug, sessionId)
          agentSandboxDir = sandboxCwd
          const cwdResolution = resolveSessionCwd({
            gitWorktreePath: sessionMeta?.gitWorktreePath ?? activeWorktree?.path,
            workspaceProjectRootPath: ws.projectRootPath,
            agentCwdMode: sessionMeta?.agentCwdMode,
            projectId: sessionMeta?.projectId,
            resolveProjectCwd: (projectId) => projectRepository.resolveEffectiveCwdForProject(getAgentWorkspacePath(ws.slug), projectId),
            sandboxCwd
          })

          if ('unavailable' in cwdResolution) {
            reportPreflightError({
              code: 'project_directory_unavailable',
              title: '项目工作目录不可用',
              message: `该会话绑定的项目工作目录「${cwdResolution.displayPath ?? '未知路径'}」已不可访问，可能已被移动或删除。请在项目设置里重新关联或恢复该目录后再继续。`,
              canRetry: false,
              actions: []
            })
            return
          }

          agentCwd = cwdResolution.cwd
          agentCwdSource = cwdResolution.source
          console.log(`[Agent 编排] 使用 ${cwdResolution.source} 级别 cwd: ${agentCwd} (${ws.name}/${sessionId})`)

          // 在真实 Agent cwd 确定后建立统一文件根快照。捕获失败不得阻断主流程。
          try {
            sessionFileRoots = resolveAgentSessionFileRoots(
              sessionMeta ?? {
                id: sessionId,
                title: '未命名会话',
                workspaceId,
                agentCwdMode: 'session',
                createdAt: Date.now(),
                updatedAt: Date.now()
              },
              ws.slug
            )
            turnOutputSnapshot = snapshotOutputFiles(buildOutputCaptureRoots(sessionFileRoots))
          } catch (error) {
            console.warn('[Agent 产出] turn 前快照失败，不影响 Agent 执行:', error)
          }

          if (existingSdkSessionId) {
            console.log(`[Agent 编排] 将尝试 resume: ${existingSdkSessionId}`)
          } else {
            console.log(`[Agent 编排] 无 sdkSessionId，将作为新会话启动（回填历史上下文）`)
          }
        }
      }

      // 9.4.1 Fork session JSONL 迁移已在 forkAgentSession 中完成，
      // fork 后的会话直接使用自己的 cwd，无需回退到源目录。
      // forkSourceDir 仅作为备用参考字段保留，不再影响 agentCwd。

      // 必须与 runtime 接收的附加目录保持一致；视觉助手据此限制允许外发的图片路径。
      const allAdditionalDirectories = collectAttachedDirectories({
        extraDirs: additionalDirectories,
        sessionMeta,
        workspaceSlug
      })

      // 视觉助手授权根：在附加目录基础上，把当前会话的实际工作目录（项目 workingDirectory）
      // 与会话专属 sandbox（用户上传附件所在）也纳入，但不动 allAdditionalDirectories
      // （它仍用于 additionalDirectories / prompt）。
      const visionRelayAllowedRoots = appendVisionRelayAllowedRoot(allAdditionalDirectories, agentCwd, undefined, agentSandboxDir)

      // 受管浏览器授权根：Agent 工作目录、项目文件目录与附加目录。
      const browserAllowedRoots = [...new Set([workspaceId ? agentCwd : undefined, workspaceSlug ? getWorkspaceFilesDir(workspaceSlug) : undefined, ...allAdditionalDirectories].filter((root): root is string => typeof root === 'string' && root.length > 0))]
      const builtinToolAllowedRoots = [...new Set([...visionRelayAllowedRoots, ...browserAllowedRoots])]

      // 9.5 Pi runtime 不需要 .claude/settings.json（Claude runtime 已退役）。

      // 9.6 直接信任已保存的 sdkSessionId，跳过 listSessions 预验证
      // （如 ~/.myyoda/agent-workspaces/workspace-xxx/sessionId）与 SDK 内部存储的路径哈希可能不匹配，
      // 导致 listSessions 始终返回 0 个会话，误杀有效的 resume。
      // SDK 本身会优雅处理无效的 resume ID（回退为新会话），无需预验证。
      if (existingSdkSessionId) {
        console.log(`[Agent 编排] 将直接使用已保存的 sdkSessionId 进行 resume: ${existingSdkSessionId}`)
      }

      // 10. 构建 MCP 服务器配置 + 记忆工具 + 生图工具 + 自定义工具
      // toolPolicy=none 用于 task.yaml 生成草稿：只允许模型产出文本，不暴露任何会产生副作用的工具。
      const mcpServers = toolsDisabled ? {} : this.buildMcpServers(workspaceSlug, sessionMeta?.projectId)
      // 与 buildMcpServers 同样的 fallback 规则：项目自己配置过 Skills 才用项目级目录，否则沿用工作区级目录（不影响存量会话）
      const effectiveSkillsDir = workspaceSlug ? (sessionMeta?.projectId && hasProjectSkills(workspaceSlug, sessionMeta.projectId) ? getProjectSkillsDir(workspaceSlug, sessionMeta.projectId) : getWorkspaceSkillsDir(workspaceSlug)) : undefined
      if (!toolsDisabled && isBuiltinMcpUserEnabled('chrome-devtools')) {
        injectChromeDevtoolsMcpServer(mcpServers)
      }
      // Graphify 知识图谱 MCP serve（2026-08-14，P3）：repoMapTools 开启 + 主仓库图存在 +
      // graphifyy[mcp] 已装时，注入 stdio server（python -m graphify.serve <主仓库 graph.json>），
      // 经 pi-mcp-tools 桥接为 mcp__graphify__* 工具（query_graph/get_neighbors/shortest_path 等）。
      // 图被删/开关关闭/未装 mcp extra 时工具自动消失（注入条件不满足）。
      // 注：必须在 buildPiMcpTools 之前注入；此处直接读 appSettings（repoMapToolsEnabled 声明在后方）。
      if (!toolsDisabled && appSettings.repoMapTools === true && agentCwd) {
        await this.injectGraphifyMcpServer(mcpServers, agentCwd)
      }
      let piBuiltinTools: unknown[] = []
      let piMcpTools: unknown[] = []
      const builtinMcpResult = toolsDisabled
        ? { collaborationAvailable: false }
        : await (async () => {
            const piSdk = await import('@earendil-works/pi-coding-agent')
            const result = await buildPiBuiltinTools(piSdk, {
              sessionId,
              channelId,
              modelId: selectedModelId,
              agentRuntime: 'pi',
              workspaceId,
              workspaceSlug,
              projectId: sessionMeta?.projectId,
              agentCwd,
              allowedRoots: builtinToolAllowedRoots,
              permissionMode: permissionModeOverride ?? sessionMeta?.permissionMode ?? MYYODA_DEFAULT_PERMISSION_MODE,
              triggeredBy: input.triggeredBy
            })
            piBuiltinTools = result.tools
            return { collaborationAvailable: result.collaborationAvailable }
          })()
      const collaborationAvailable = builtinMcpResult.collaborationAvailable

      // 合并外部注入的自定义 MCP 服务器（如飞书群聊工具）
      if (!toolsDisabled && customMcpServers) {
        Object.assign(mcpServers, customMcpServers)
        console.log(`[Agent 编排] 已合并 ${Object.keys(customMcpServers).length} 个自定义 MCP 服务器`)
      }

      // Pi SDK 没有 Claude Agent SDK 的 mcpServers 参数；Claude 路径保持原生 MCP 不变，
      // Pi 路径由 MyYoda 主进程连接用户 MCP server，并转换为 Pi customTools。
      if (!toolsDisabled && Object.keys(mcpServers).length > 0) {
        try {
          piMcpTools = await buildPiMcpTools(mcpServers)
        } catch (error) {
          console.warn('[Agent 编排] Pi MCP 工具桥接失败，已跳过用户 MCP:', error)
        }
      }

      // 11. 构建动态上下文和最终 prompt
      let projectContext = sessionMeta?.projectId && workspaceSlug ? projectRepository.buildPromptContext(getAgentWorkspacePath(workspaceSlug), sessionMeta.projectId) : null
      // worktree 绑定会话：project 静态 workingDirectory 与实际 cwd 不一致，覆写为 worktree 路径，
      // 避免 <project_working_directory> 与 <working_directory> 互相矛盾，误导 Agent 去主仓库目录操作
      projectContext = applyWorktreeProjectContextOverride(projectContext, agentCwdSource, agentCwd)
      // 未绑定项目时，回退到工作区默认工作目录（若已配置）
      const workspaceDefaultWorkingDirectory = !projectContext && workspaceSlug ? getWorkspaceDefaultWorkingDirectory(workspaceSlug) : undefined
      const dynamicCtx = buildDynamicContext({
        workspaceName: workspace?.name,
        workspaceSlug,
        agentCwd,
        ...(projectContext ? { projectContext } : {}),
        ...(workspaceDefaultWorkingDirectory ? { workspaceDefaultWorkingDirectory } : {}),
        userBrowserContext: browserController.getUserContext(sessionId)
      })

      // 11.4 注入仓库代码地图（repo map）：仅绑定 Project 的会话，且图谱工具开关
      // （repoMapTools，独立于 optimizedCoding）开启时注入。
      // 设计决策 2026-08-13「首次创建仅主动」：此处**纯读**（有 map 才注入，无 map
      // 不生成不提示）；创建入口只有对话栏按钮（repoMapToolsService.ensureMapTools）。
      // 会话级去重：注入动作按「首次 + map 内容变化」执行（SWR 检查仍由纯读每轮触发）。
      const optimizedCodingEnabled = resolveOptimizedCodingEnabled(appSettings)
      const repoMapToolsEnabled = appSettings.repoMapTools === true
      let repoMapBlock: string | undefined
      if (projectContext && agentCwd && repoMapToolsEnabled) {
        repoMapBlock = repoMapService.getRepoMapForPromptReadOnly(agentCwd)
      }
      // 会话级去重：map 内容与上次注入相同 → 跳过拼接（省 token）
      if (repoMapBlock !== undefined) {
        const prev = this.injectedRepoMapBySession.get(sessionId)
        if (prev === repoMapBlock) {
          repoMapBlock = undefined
        } else {
          this.recordInjectedRepoMap(sessionId, repoMapBlock)
        }
      }
      const finalDynamicCtx = repoMapBlock ? `${dynamicCtx}\n\n<repo_map>\n当前仓库代码地图（按符号重要度排序，用于快速定位；地图可能不完整，动手前仍需 Read/Grep 确认）：\n${repoMapBlock}\n\n（查依赖/影响面请用 Bash 调 graphify，命令见 graphify skill）\n</repo_map>` : dynamicCtx

      // 11.5 注入 mention 引用指令（Skill/MCP/会话）— 仅影响 prompt，不影响持久化
      let enrichedMessage = userMessage
      const referencedSessionsBlock = buildReferencedSessionsPrompt(sessionId, mentionedSessionIds, workspaceSlug)
      if (referencedSessionsBlock) {
        enrichedMessage = `${referencedSessionsBlock}\n\n${enrichedMessage}`
        console.log(`[Agent 编排] 注入 referenced_sessions: ${mentionedSessionIds?.length ?? 0} sessions`)
      }
      if (mentionedSkills?.length || mentionedMcpServers?.length) {
        const toolLines: string[] = ['用户在消息中明确引用了以下工具，请在本次回复中主动调用：']
        for (const slug of mentionedSkills ?? []) {
          const qualifiedName = workspaceSlug ? `myyoda-workspace-${workspaceSlug}:${slug}` : slug
          toolLines.push(`- Skill: ${qualifiedName}（请立即调用此 Skill）`)
        }
        for (const name of mentionedMcpServers ?? []) {
          toolLines.push(`- MCP 服务器: ${name}（请使用此 MCP 服务器的工具来完成任务）`)
        }
        enrichedMessage = `<mentioned_tools>\n${toolLines.join('\n')}\n</mentioned_tools>\n\n${enrichedMessage}`
        console.log(`[Agent 编排] 注入 mentioned_tools: ${mentionedSkills?.length ?? 0} skills, ${mentionedMcpServers?.length ?? 0} MCP`)
      }
      const referencedPlanningBlock = buildReferencedPlanningPrompt(mentionedTodoIds, mentionedCalendarEventIds, { requireToolRead: true })
      if (referencedPlanningBlock) {
        enrichedMessage = `${referencedPlanningBlock}\n\n${enrichedMessage}`
        console.log(`[Agent 编排] 注入 referenced_planning: ${mentionedTodoIds?.length ?? 0} todos, ${mentionedCalendarEventIds?.length ?? 0} calendar events`)
      }

      const contextualMessage = `${finalDynamicCtx}\n\n${enrichedMessage}`

      const isCompactCommand = userMessage.trim() === '/compact'
      const finalPrompt = isCompactCommand
        ? '/compact'
        : existingSdkSessionId
          ? contextualMessage
          : buildContextPrompt(sessionId, contextualMessage, {
              agentCwd,
              workspaceSlug
            })

      if (existingSdkSessionId) {
        console.log(`[Agent 编排] 使用 resume 模式，SDK session ID: ${existingSdkSessionId}`)
      } else if (finalPrompt !== contextualMessage) {
        console.log(`[Agent 编排] 无 resume，已回填历史上下文（最近 ${MAX_CONTEXT_MESSAGES} 条消息）`)
      }

      // 12. 读取应用设置并确定权限模式
      // 权限模式只属于当前 session；新会话默认完全自动模式。
      const initialPermissionMode: MyYodaPermissionMode = permissionModeOverride ?? MYYODA_DEFAULT_PERMISSION_MODE
      // 注册到 Map，支持运行中动态切换
      this.sessionPermissionModes.set(sessionId, initialPermissionMode)
      console.log(`[Agent 编排] 权限模式: ${initialPermissionMode}${permissionModeOverride ? '（外部覆盖）' : ''}`)

      const emitPlanModeChanged = (active: boolean, source: 'initial' | 'tool' | 'permission'): void => {
        this.eventBus.emit(sessionId, {
          kind: 'myyoda_event',
          event: { type: 'plan_mode_changed', sessionId, active, source }
        })
      }

      // 当初始模式为 plan 时，通知渲染进程展示计划模式 UI（如「Agent 正在规划」横幅）
      if (initialPermissionMode === 'plan') {
        this.eventBus.emit(sessionId, {
          kind: 'myyoda_event',
          event: { type: 'enter_plan_mode', sessionId }
        })
        emitPlanModeChanged(true, 'initial')
      }

      /** 读取当前会话的实时权限模式（支持运行中切换） */
      const getPermissionMode = (): MyYodaPermissionMode => this.sessionPermissionModes.get(sessionId) ?? initialPermissionMode

      // ExitPlanMode 拦截器：plan 模式下走 UI 审批流程
      const handleExitPlanMode = (toolInput: Record<string, unknown>, signal: AbortSignal): Promise<ExitPlanPermissionResult> => {
        return exitPlanService.handleExitPlanMode(sessionId, toolInput, signal, (request: ExitPlanModeRequest) => {
          this.eventBus.emit(sessionId, {
            kind: 'myyoda_event',
            event: { type: 'exit_plan_mode_request', request }
          })
        })
      }

      /**
       * 判断 Bash 命令是否是只读的（计划模式下安全可执行）
       * 检测写操作特征：文件重定向、破坏性命令、包管理写操作、git 写操作等
       */
      const isBashCommandReadOnly = (command: string): boolean => {
        // 输出重定向：匹配未被数字或 & 前置的 > 符号（排除 2>/dev/null、&> 等 fd 重定向）
        if (/(?<![0-9&])>/.test(command)) return false
        // 破坏性文件操作
        if (/\b(rm|rmdir)\s/.test(command)) return false
        if (/\bsed\s+[^|&;]*-i/.test(command)) return false // sed -i 原地编辑
        if (/\b(chmod|chown|chattr|truncate)\s/.test(command)) return false
        if (/\b(mv|cp)\s/.test(command)) return false
        if (/\b(mkdir|touch|mktemp)\s/.test(command)) return false
        // 包管理器写操作
        if (/\b(npm|pnpm|yarn|bun)\s+(install|i\b|add|remove|uninstall|update|upgrade|link|unlink)\b/.test(command)) return false
        if (/\bpip[23]?\s+(install|uninstall|upgrade)\b/.test(command)) return false
        if (/\b(apt|apt-get|brew|yum|dnf)\s+(install|remove|purge|uninstall|upgrade)\b/.test(command)) return false
        // Git 写操作
        if (/\bgit\s+(commit|push|checkout\s+-[bB]|branch\s+-[mMdD]|merge\b|rebase\b|reset\b|stash\s+(drop|pop)\b|add\b|apply\b|cherry-pick\b)/.test(command)) return false
        // 进程控制
        if (/\b(kill|killall|pkill)\s/.test(command)) return false
        // 脚本执行（具有潜在副作用，如 node script.js / python main.py）
        if (/\b(node|python[23]?|ruby|perl|php)\s+[^-]/.test(command)) return false
        return true
      }

      // Plan 模式下允许的只读工具（不包含 Write/Edit/Bash 等写操作）
      const PLAN_MODE_ALLOWED_TOOLS = new Set(['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'TodoRead', 'TodoWrite', 'TaskOutput', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'ListMcpResourcesTool', 'ReadMcpResourceTool'])
      const DEFERRED_OR_PROACTIVE_TOOLS = new Set(['REPL', 'Workflow', 'ScheduleWakeup', 'Monitor', 'PushNotification', 'CronCreate', 'CronDelete', 'RemoteTrigger'])
      const PLAN_MODE_READ_ONLY_CHROME_DEVTOOLS = new Set(['mcp__chrome_devtools__list_pages', 'mcp__chrome_devtools__take_snapshot', 'mcp__chrome_devtools__take_screenshot', 'mcp__chrome_devtools__list_network_requests', 'mcp__chrome_devtools__performance_stop_trace'])
      // Planning 是本地用户数据：计划模式只允许查询，严禁创建、更新、删除或确认/推迟提醒。
      const PLAN_MODE_READ_ONLY_PLANNING_TOOLS = new Set(['mcp__planning__list_todos', 'mcp__planning__get_todo', 'mcp__planning__list_calendar_events', 'mcp__planning__get_calendar_event', 'mcp__planning__list_groups', 'mcp__planning__list_tags', 'mcp__planning__list_active_reminders'])
      // Pi-native 浏览器工具不是 MCP：必须显式分类，避免被通用 mcp__ 调研放行规则遗漏。
      const PLAN_MODE_READ_ONLY_BROWSER_TOOLS = new Set(['BrowserObserve', 'BrowserScreenshot', 'BrowserListTabs', 'BrowserPreviewOpen'])
      const runTriggeredBy = input.triggeredBy

      /** Plan 模式是否已被 Agent 进入（初始 plan 模式时天然为 true，其他模式需 EnterPlanMode 触发） */
      let planModeEntered = initialPermissionMode === 'plan'

      const syncPlanModeFromToolUse = (toolName: string): void => {
        if (toolName === 'EnterPlanMode') {
          planModeEntered = true
          emitPlanModeChanged(true, 'tool')
          return
        }
        if (toolName === 'ExitPlanMode' && getPermissionMode() === 'bypassPermissions') {
          planModeEntered = false
          emitPlanModeChanged(false, 'tool')
          return
        }
        // auto/plan 下 ExitPlanMode 只是发起退出计划的审批请求。
        // 真正退出由用户审批结果触发，不能在工具开始时提前清掉计划态。
      }

      // 动态 canUseTool：每次调用读取当前权限模式，支持运行中切换
      const canUseTool = async (toolName: string, input: Record<string, unknown>, options: CanUseToolOptions): Promise<PermissionResult> => {
        const currentMode = getPermissionMode()

        if (toolsDisabled) {
          return {
            behavior: 'deny' as const,
            message: '当前会话仅用于生成可编辑的任务计划草稿，禁止调用工具；请直接输出 task.yaml 内容。'
          }
        }

        // ── 参数校验守卫（所有模式、所有工具，优先于权限检查） ──
        const validationFailure = validateToolInput(toolName, input)
        if (validationFailure) {
          console.warn(`[Agent 工具验证] 参数缺失: tool=${toolName}, mode=${currentMode}`)
          return validationFailure
        }

        // ── Write 大文件 token 截断防护 ──
        if (toolName === 'Write' && typeof input.content === 'string') {
          const estimatedTokens = estimateTokenCount(input.content)
          if (estimatedTokens > WRITE_CONTENT_TOKEN_THRESHOLD) {
            console.warn(`[Agent 工具验证] Write 内容过大: tokens≈${estimatedTokens}, chars=${input.content.length}, file=${String(input.file_path)}`)
            return {
              behavior: 'deny' as const,
              message: `The content for Write tool (~${estimatedTokens} estimated tokens, ${input.content.length} chars) is too large and may be truncated. ` + `Please split the write into smaller sequential steps: write the first portion of the file now, then use Edit tool to append remaining sections incrementally.`
            }
          }
        }

        // ── Bash 默认超时注入（工具卡死防护） ──
        // 模型发起 Bash 命令时往往不传 timeout，遇到死循环（如 awk 读到 EOF 后 while 永真）
        // 会无限空转、SDK 子进程永不返回，导致整个会话永久卡在运行中。
        // 这里在 canUseTool 阶段给「未指定 timeout」的 Bash 注入默认超时，
        // 模型已显式指定 timeout 时尊重原值。注意 runtime 单位与默认值都不同：
        //   - Claude runtime：120s / 毫秒，对齐官方 CLI 本来就有的默认值，非新增限制
        //   - Pi runtime：600s / 秒（resolveTimeoutMs 按秒×1000）。Pi 原生未传 timeout
        //     时无限等待，600s 是刻意放宽的新增兜底，避免误杀 Android/iOS 等长编译命令；
        //     真正的死循环由会话级看门狗（15min 零 SDK 消息）兜底，两者独立不冲突。
        // 两者经各自的 canUseTool updatedInput 改写机制注入，共用此统一入口。
        if (toolName === 'Bash') {
          const updatedInput = injectBashDefaultTimeout(input, agentRuntime)
          if (updatedInput !== input) {
            return {
              behavior: 'allow' as const,
              updatedInput
            }
          }
        }

        // ── EnterPlanMode / ExitPlanMode 处理 ──

        // 完全自动模式：计划进入和退出都透明化，保持 bypassPermissions 的无人值守语义。
        if (currentMode === 'bypassPermissions' && (toolName === 'EnterPlanMode' || toolName === 'ExitPlanMode')) {
          const active = toolName === 'EnterPlanMode'
          planModeEntered = active
          emitPlanModeChanged(active, 'tool')
          return { behavior: 'allow' as const, updatedInput: input }
        }

        // ExitPlanMode：plan 模式下必须让用户确认计划。
        if (toolName === 'ExitPlanMode') {
          console.log(`[canUseTool] ExitPlanMode: signal.aborted=${options.signal.aborted}, planModeEntered=${planModeEntered}, mode=${currentMode}`)
          const result = await handleExitPlanMode(input, options.signal)
          if (result.behavior === 'allow' && 'targetMode' in result && result.targetMode) {
            // 更新 Map，后续 canUseTool 调用使用新模式
            this.sessionPermissionModes.set(sessionId, result.targetMode)
            planModeEntered = false
            emitPlanModeChanged(false, 'permission')
            // 同步通知 SDK 侧切换权限模式
            if (this.adapter.setPermissionMode) {
              this.adapter.setPermissionMode(sessionId, sdkPermissionModeForMyYodaMode(result.targetMode)).catch((err: unknown) => {
                console.warn(`[Agent 编排] SDK 权限模式切换失败:`, err)
              })
            }
          }
          return result
        }

        // EnterPlanMode：标记进入状态，通知渲染进程
        if (toolName === 'EnterPlanMode') {
          planModeEntered = true
          emitPlanModeChanged(true, 'tool')
          this.eventBus.emit(sessionId, {
            kind: 'myyoda_event',
            event: { type: 'enter_plan_mode', sessionId }
          })
          return { behavior: 'allow' as const, updatedInput: input }
        }

        // AskUserQuestion：始终走交互式问答流程，不受权限模式影响
        if (toolName === 'AskUserQuestion') {
          return askUserService.handleAskUserQuestion(sessionId, input, options.signal, (request: AskUserRequest) => {
            this.eventBus.emit(sessionId, {
              kind: 'myyoda_event',
              event: { type: 'ask_user_request', request }
            })
          })
        }

        // 视觉助手由用户在全局设置中显式启用并选择外发渠道；在正常会话中直接放行，
        // 仍由工具服务限制为当前会话/附加目录内的图片。计划模式不执行任何外发操作。
        if (toolName === 'VisionRelay') {
          if (currentMode === 'plan') {
            return {
              behavior: 'deny' as const,
              message: '计划模式下不能将本地图片发送给视觉模型，请在计划获批后执行。'
            }
          }
          return { behavior: 'allow' as const }
        }

        // 所有 Pi 会话均可使用受管浏览器。主进程仍隔离网页并拒绝私网与网页权限；
        // 下载与 popup 仅在受管边界内放行。页面内容始终视为不可信输入。计划模式仅允许只读浏览器操作。
        if (toolName.startsWith('Browser')) {
          if (currentMode === 'plan') {
            return PLAN_MODE_READ_ONLY_BROWSER_TOOLS.has(toolName)
              ? { behavior: 'allow' as const, updatedInput: input }
              : {
                  behavior: 'deny' as const,
                  message: '计划模式下只能观察受管浏览器，请在计划获批后再进行网页交互。'
                }
          }
          return { behavior: 'allow' as const, updatedInput: input }
        }

        // 自动任务/协作子 Agent 没有可靠的本地确认界面，不能发起删除。
        const planningDeletionPermission = resolvePlanningDeletionPermission(toolName, currentMode, runTriggeredBy)
        if (planningDeletionPermission === 'deny-unattended') {
          return {
            behavior: 'deny' as const,
            message: '定时任务和协作子 Agent 不能删除本地规划数据，请由用户主会话发起并确认。'
          }
        }
        // 用户明确指定目标的 Todo/日程删除在完全自动模式下直接放行；
        // 分组/标签/提醒等批量删除仍需要单次确认。
        if (planningDeletionPermission === 'allow') {
          return { behavior: 'allow' as const, updatedInput: input }
        }
        if (planningDeletionPermission === 'require-single-approval') {
          return permissionService.requestSingleApproval(sessionId, toolName, input, options, (request) => {
            this.eventBus.emit(sessionId, {
              kind: 'myyoda_event',
              event: { type: 'permission_request', request }
            })
          })
        }

        // ── 普通工具的权限分派 ──

        switch (currentMode) {
          case 'bypassPermissions':
            return { behavior: 'allow' as const, updatedInput: input }

          case 'plan': {
            // Plan 模式：只允许只读工具 + Write/Edit 任意 .md 文件（计划文档）
            if (PLAN_MODE_ALLOWED_TOOLS.has(toolName)) {
              return { behavior: 'allow' as const, updatedInput: input }
            }
            // 允许 Write/Edit 到任意 .md 文件（计划文档一定是 markdown；非 .md 仍被拒）
            if (toolName === 'Write' || toolName === 'Edit') {
              const filePath = typeof input.file_path === 'string' ? input.file_path : ''
              if (filePath.toLowerCase().endsWith('.md')) {
                return { behavior: 'allow' as const, updatedInput: input }
              }
            }
            // Bash 工具：只读命令（find、grep、cat 等）允许执行，写操作拒绝
            if (toolName === 'Bash') {
              const command = typeof input.command === 'string' ? input.command : ''
              if (isBashCommandReadOnly(command)) {
                return { behavior: 'allow' as const, updatedInput: input }
              }
              return {
                behavior: 'deny' as const,
                message: '计划模式下不允许执行写操作，请在计划审批通过后再执行'
              }
            }
            // Chrome DevTools MCP 同时包含只读观察和会改变页面状态的操作。
            // 计划模式只允许快照、截图、网络列表等调研工具；点击、输入、脚本执行等需等计划通过。
            if (toolName.startsWith('mcp__chrome_devtools__')) {
              return PLAN_MODE_READ_ONLY_CHROME_DEVTOOLS.has(toolName)
                ? { behavior: 'allow' as const, updatedInput: input }
                : {
                    behavior: 'deny' as const,
                    message: '计划模式下不允许执行会改变浏览器页面状态的 Chrome DevTools 操作，请在计划审批通过后再执行'
                  }
            }
            if (toolName.startsWith('mcp__planning__')) {
              return PLAN_MODE_READ_ONLY_PLANNING_TOOLS.has(toolName)
                ? { behavior: 'allow' as const, updatedInput: input }
                : {
                    behavior: 'deny' as const,
                    message: '计划模式下只能查询任务/日程，不能修改本地规划数据，请在计划审批通过后再执行'
                  }
            }
            // 其他 MCP 工具维持既有策略：计划模式下允许调研用 MCP。
            if (toolName.startsWith('mcp__')) {
              return { behavior: 'allow' as const, updatedInput: input }
            }
            if (DEFERRED_OR_PROACTIVE_TOOLS.has(toolName)) {
              return {
                behavior: 'deny' as const,
                message: '计划模式下不允许启动后台、定时、通知或脚本执行能力，请在计划审批通过后再执行'
              }
            }
            // 其余工具拒绝
            return {
              behavior: 'deny' as const,
              message: '计划模式下不允许执行写操作，请在计划审批通过后再执行'
            }
          }
          default:
            return { behavior: 'allow' as const, updatedInput: input }
        }
      }

      // 13. 构建 Adapter 查询选项
      const maxTurns = appSettings.agentMaxTurns && appSettings.agentMaxTurns > 0 ? appSettings.agentMaxTurns : undefined
      const piReasoningCapability = await resolvePiReasoningCapability(channel.provider, selectedModelId)
      const piThinkingLevel = resolvePiThinkingLevel(appSettings, sessionMeta, channel.provider, selectedModelId, piReasoningCapability)
      // 图谱工具就绪（2026-08-14 B 方案）：repoMapTools 开 + 主仓库图存在 + graphifyy[mcp] 已装
      // → 编码规范追加「代码理解优先图谱」强约束。条件与 injectGraphifyMcpServer 对齐，
      // 避免“条款注入但 MCP 工具不存在”的错位（isGraphifyMcpAvailable 10min 缓存，无额外 spawn 开销）。
      // resolveMainRepoRootCached 有 5min 缓存，与下方 Graphify 引导块共用同一解析，无额外 git 开销。
      let graphifyToolsReady = false
      if (projectContext && agentCwd && repoMapToolsEnabled) {
        const graphifyMainRepo = await resolveMainRepoRootCached(agentCwd)
        if (graphifyMainRepo && existsSync(graphJsonPath(graphifyMainRepo)) && repoMapToolsService.isGraphifyMcpAvailable()) {
          graphifyToolsReady = true
        }
      }
      let systemPromptAppend =
        buildSystemPrompt({
          agentRuntime,
          workspaceName: workspace?.name,
          workspaceSlug,
          sessionId,
          permissionMode: initialPermissionMode,
          collaborationAvailable,
          currentModelId: selectedModelId,
          optimizedCoding: optimizedCodingEnabled,
          graphifyToolsReady: graphifyToolsReady,
          projectKnowledgeMaintenanceApproved: workspaceSlug ? isWorkspaceProjectKnowledgeMaintenanceApproved(workspaceSlug) : false,
          memoryGuidance: workspaceSlug && !automationContext && !input.triggeredBy ? getWorkspaceMemoryGuidance(workspaceSlug) : undefined,
          memoryRefreshOpportunity: workspaceSlug && !automationContext && !input.triggeredBy ? claimWorkspaceMemoryRefreshOpportunity(workspaceSlug) : undefined
        }) +
        (automationContext ? `\n\n## 定时任务执行上下文\n\n${automationContext}` : '') +
        (workContext
          ? `

## Work 模式任务上下文

${workContext}`
          : '')

      // Graphify 知识图谱引导（repoMapTools 开启时注入，2026-08-14 重写）：
      // - 会话级一次注入（修复每轮重复注入的 token 浪费）
      // - 有图：注入查询命令模板（explain/query/path/update；已删不存在的 prs 命令、
      //   删与 DeepSeek 编码规范重复的"改代码前先查影响面"独立条目，合并入首句）
      // - 无图：注入建图轻提示（指引对话栏按钮，不自动建图——"仅主动"原则）；
      //   会话中建图后自动升级为命令模板（prev === 'hint' 时重新注入）
      if (projectContext && agentCwd && repoMapToolsEnabled) {
        const prevGraphify = this.injectedGraphifyBySession.get(sessionId)
        if (!prevGraphify || prevGraphify === 'hint') {
          const mainRepo = await resolveMainRepoRootCached(agentCwd)
          if (mainRepo) {
            const graphPath = graphJsonPath(mainRepo)
            if (existsSync(graphPath)) {
              const mcpReady = repoMapToolsService.isGraphifyMcpAvailable()
              const graphifyGuidance = `\n\n## 代码知识图谱（graphify）\n\n当前项目已构建代码知识图谱（主仓库 ${mainRepo}/graphify-out/graph.json，worktree 会话共享）。改代码前先查影响面，理解代码结构与依赖时优先查图谱而不是反复 grep：${mcpReady ? '\n- 优先直接调用图谱工具：mcp__graphify__query_graph（找相关代码）/ mcp__graphify__get_neighbors + mcp__graphify__get_node（影响面分析）/ mcp__graphify__shortest_path（依赖路径）' : ''}\n- 影响面：graphify explain "<符号或文件名>" --graph "${graphPath}"（边带行号+EXTRACTED/INFERRED 置信）\n- 找相关代码：graphify query "<自然语言问题>" --graph "${graphPath}"\n- 查依赖路径：graphify path "<A>" "<B>" --graph "${graphPath}"\n- 图谱过期时增量刷新：cd ${mainRepo} && graphify update .`
              systemPromptAppend += graphifyGuidance
              this.recordInjectedGraphify(sessionId, graphPath)
            } else if (!prevGraphify) {
              // 无图且从未提示过：轻提示（只提示不自动建，遵循"首次创建仅主动"）
              const graphifyHint = `\n\n## 代码知识图谱\n\n本项目已开启代码图谱（Coding 加强）但尚未构建。点击对话栏输入区的图谱按钮可一键创建（约 40 秒，纯本地 AST 分析），完成后 AI 可用 graphify 查询依赖关系与改动影响面。`
              systemPromptAppend += graphifyHint
              this.recordInjectedGraphify(sessionId, 'hint')
            }
          }
        }
      }
      const handleSessionId = (sdkSessionId: string, piSessionFile?: string): void => {
        // 仅在 session_id 真正变化时才持久化。SDK v2 几乎每条消息都会回调 onSessionId，
        // capturedSdkSessionId 已初始化为 existingSdkSessionId，并在 recovery 时同步重置。
        const isNewSessionId = sdkSessionId !== capturedSdkSessionId
        const needsPiSessionFile = !!piSessionFile && sessionMeta?.piSessionFile !== piSessionFile
        capturedSdkSessionId = sdkSessionId
        if (isNewSessionId || needsPiSessionFile) {
          try {
            // 运行中切到其他内核后，保留旧 turn 展示但不再写入 Pi 专用恢复 artifact。
            const latestSessionMeta = getAgentSessionMeta(sessionId)
            if (latestSessionMeta?.legacyTranscript?.continuationRequired) {
              console.log(`[Agent 编排] 忽略只读历史会话的 session artifact: ${sdkSessionId}`)
            } else {
              updateAgentSessionMeta(sessionId, {
                sdkSessionId,
                ...(piSessionFile ? { piSessionFile } : {})
              })
            }
            console.log(`[Agent 编排] 已保存 SDK session_id: ${sdkSessionId}`)
          } catch (err) {
            console.error(`[Agent 编排] 保存 SDK session_id 失败:`, err)
          }
        }

        if (!titleGenerationStarted) {
          titleGenerationStarted = true
          // 标题请求与前台 Agent run 使用独立的 Codex Responses 请求，可并发执行。
          // 自动标题只会写入仍为默认名称的会话，因此不会覆盖用户的手动重命名。
          this.autoGenerateTitle(sessionId, userMessage, channelId, resolvedModel, callbacks).catch((err) => console.error('[Agent 编排] 标题生成未捕获异常:', err))
        }
      }
      const handleModelResolved = (model: string): void => {
        // `[1m]` 是 SDK 内部上下文变体，不应泄漏到标题生成或用户可见的模型名。
        resolvedModel = model.replace(/\[1m\]$/i, '')
        console.log(`[Agent 编排] SDK 确认模型: ${resolvedModel}`)
        this.eventBus.emit(sessionId, {
          kind: 'myyoda_event',
          event: { type: 'model_resolved', model: resolvedModel }
        })
      }
      const handleContextWindow = (cw: number): void => {
        const inferredWindow = inferAgentSdkContextWindow(modelId, channel.provider)
        const contextWindow = Math.max(cw, inferredWindow ?? 0) || cw
        console.log(`[Agent 编排] 缓存 contextWindow: ${contextWindow}`)
        // result 消息里的真实 contextWindow 透传到 renderer，
        // 覆盖流式过程中按模型名推断的 fallback 值（智谱等端点会把 [1m] 等后缀剥掉，导致 fallback 不准）
        this.eventBus.emit(sessionId, {
          kind: 'myyoda_event',
          event: { type: 'context_window', contextWindow }
        })
      }
      const piCustomTools = [...piBuiltinTools, ...piMcpTools, ...(extensions.piCustomTools ?? [])]
      const proxyUrl = await getEffectiveProxyUrl()
      // 存量 anthropic-oauth 渠道（迁移前创建）的 baseUrl 可能是空串，Pi runtime
      // 需要真实 endpoint；缺失时兜底到官方 Anthropic API。
      const effectiveBaseUrl = channel.baseUrl || (channel.provider === 'anthropic-oauth' ? PROVIDER_DEFAULT_URLS['anthropic-oauth'] : channel.baseUrl)
      const queryOptions: PiAgentQueryOptions = {
        sessionId,
        prompt: finalPrompt,
        model: selectedModelId,
        cwd: agentCwd,
        apiKey,
        baseUrl: effectiveBaseUrl,
        provider: channel.provider,
        channelId,
        channelName: channel.name,
        proxyUrl,
        runtimeEnv: buildPiRuntimeEnv({}), // Claude sdkEnv 不再需要
        ...(maxTurns != null && { maxTurns }),
        permissionMode: initialPermissionMode,
        canUseTool,
        ...(toolsDisabled ? { toolPolicy: 'none' as const } : {}),
        systemPrompt: systemPromptAppend + buildPiAdditionalDirectoriesPrompt(allAdditionalDirectories),
        resumeSessionId: existingSdkSessionId,
        initialUserMessageUuid,
        piAgentDir: getSdkConfigDir(),
        piSessionDir: join(getSdkConfigDir(), 'sessions'),
        ...(allAdditionalDirectories.length > 0 && {
          additionalDirectories: allAdditionalDirectories
        }),
        ...(workspaceSlug && effectiveSkillsDir
          ? {
              additionalSkillPaths: [effectiveSkillsDir],
              skillWorkspaceSlug: workspaceSlug
            }
          : {}),
        ...(optimizedCodingEnabled ? { optimizedCoding: true } : {}),
        ...(mentionedSkills?.length ? { skillMentions: mentionedSkills } : {}),
        onSkillActivated: recordSkillActivation,
        ...(isCompactCommand ? { compactRequest: true } : {}),
        ...(sessionMeta?.codexFastMode && channel.provider === 'openai-codex' ? { codexFastMode: true } : {}),
        ...(codexOAuthCredentials && {
          codexOAuthCredentials,
          onCodexOAuthCredentialsRefreshed: (credentials: CodexOAuthCredentials) => {
            persistCodexOAuthCredentials(channelId, credentials)
          }
        }),
        ...(xaiOAuthCredentials && {
          xaiOAuthCredentials,
          onXaiOAuthCredentialsRefreshed: (credentials: XaiOAuthCredentials) => {
            persistXaiOAuthCredentials(channelId, credentials)
          }
        }),
        ...((channel.provider === 'openai-codex' || channel.provider === 'xai' || channel.provider === 'openai-responses' || channel.provider === 'openai' || channel.provider === 'custom') &&
          resolveReasoningProfile({
            modelId: selectedModelId,
            transport: inferReasoningTransport(channel.provider)
          })?.id.startsWith('openai-reasoning-') && {
            openAIThinkingLevel: piThinkingLevel!
          }),
        thinkingLevel: piThinkingLevel!,
        ...(appSettings.agentMaxBudgetUsd != null &&
          appSettings.agentMaxBudgetUsd > 0 && {
            maxBudgetUsd: appSettings.agentMaxBudgetUsd
          }),
        ...(piCustomTools.length > 0 && {
          customTools: piCustomTools as PiAgentQueryOptions['customTools']
        }),
        onSessionId: handleSessionId,
        onPiEntryBindings: (bindings) => {
          const latest = getAgentSessionMeta(sessionId)
          // 运行中切到其他内核后，保留旧 turn 展示但不再写入 Pi 专用恢复 artifact。
          if (latest?.legacyTranscript?.continuationRequired) return
          updateAgentSessionMeta(sessionId, {
            piEntryBindings: {
              ...(latest?.piEntryBindings ?? {}),
              ...bindings
            }
          })
        },
        onModelResolved: handleModelResolved,
        onContextWindow: handleContextWindow,
        retryRunStartedAt: streamStartedAt,
        onRetry: (retry) => {
          this.eventBus.emit(sessionId, {
            kind: 'myyoda_event',
            event: { type: 'retry', ...retry }
          })
        }
      }

      console.log(`[Agent 编排] 开始通过 Adapter 遍历事件流...`)

      // 14. 遍历 Adapter 产出的 AgentEvent 流（含自动重试）
      let lastRetryableError: string | undefined
      let retryDelayElapsedMs = 0
      let retryAttemptsScheduled = 0
      let retrySucceeded = false
      let skipNextRetryDelay = false
      let thinkingSignatureRecoveryAttempted = false
      let promptTooLongRecoveryAttempted = false
      let invisibleRecoveryAttempts = 0
      const canAutoRetry = (attempt: number): boolean => attempt <= MAX_AUTO_RETRIES && retryDelayElapsedMs < MAX_AUTO_RETRY_WAIT_MS
      // Pi runtime 使用其 session 内的 native retry（agent.continue），能保留已完成的
      // tool_result；禁止外层以原 prompt 重开 query，但保留 session-not-found 等显式恢复。
      const canReplayPromptForRetry = (attempt: number): boolean => false && canAutoRetry(attempt)

      const canTryThinkingSignatureRecovery = (attempt: number): boolean => !thinkingSignatureRecoveryAttempted && canAutoRetry(attempt) && !!(existingSdkSessionId || capturedSdkSessionId || queryOptions.resumeSessionId)
      const canTryPromptTooLongRecovery = (attempt: number): boolean => !promptTooLongRecoveryAttempted && canAutoRetry(attempt) && !!(existingSdkSessionId || capturedSdkSessionId || queryOptions.resumeSessionId)

      const queryStartedAt = Date.now()

      for (let attempt = 1; attempt <= MAX_AUTO_RETRIES + 1; attempt++) {
        pendingSkillActivations = []
        // 非首次尝试：等待 + 发送重试事件到 UI
        if (attempt > 1) {
          if (skipNextRetryDelay) {
            skipNextRetryDelay = false
            console.log(`[Agent 编排] 已切换到上下文回填模式，立即重试`)
          } else {
            const retryAttempt = Math.max(1, attempt - 1 - invisibleRecoveryAttempts)
            const delayMs = getRetryDelayMs(retryAttempt, retryDelayElapsedMs)
            if (delayMs <= 0) {
              console.log(`[Agent 编排] 自动重试等待预算已耗尽 (${MAX_AUTO_RETRY_WAIT_MS}ms)，停止重试`)
              break
            }
            retryDelayElapsedMs += delayMs
            retryAttemptsScheduled = retryAttempt
            const delaySec = delayMs / 1000
            const attemptData: RetryAttempt = {
              attempt: retryAttempt,
              timestamp: Date.now(),
              reason: lastRetryableError ?? '未知错误',
              errorMessage: lastRetryableError ?? '',
              delaySeconds: delaySec
            }

            // 前 RETRY_VISIBILITY_THRESHOLD 次重试静默进行，避免偶发瞬时波动频繁惊扰用户
            if (retryAttempt > RETRY_VISIBILITY_THRESHOLD) {
              this.eventBus.emit(sessionId, {
                kind: 'myyoda_event',
                event: {
                  type: 'retry',
                  status: 'starting',
                  attempt: retryAttempt,
                  maxAttempts: MAX_AUTO_RETRIES,
                  delaySeconds: delaySec,
                  reason: lastRetryableError ?? '未知错误'
                }
              })
              this.eventBus.emit(sessionId, {
                kind: 'myyoda_event',
                event: { type: 'retry', status: 'attempt', attemptData }
              })
            }

            console.log(`[Agent 编排] 第 ${retryAttempt} 次重试${retryAttempt <= RETRY_VISIBILITY_THRESHOLD ? '(静默)' : ''}，等待 ${delaySec}s...`)
            await new Promise((r) => setTimeout(r, delayMs))

            // 等待期间如果会话被中止，退出
            if (!this.activeSessions.has(sessionId)) {
              const wasStoppedByUser = this.consumeStoppedByUser(sessionId, runGeneration)
              this.persistSDKMessages(sessionId, accumulatedMessages, Date.now() - queryStartedAt)
              try {
                updateAgentSessionMeta(sessionId, {
                  stoppedByUser: wasStoppedByUser
                })
              } catch {
                /* 会话可能已删除 */
              }
              completeRun({
                stoppedByUser: wasStoppedByUser,
                startedAt: streamStartedAt
              })
              return
            }
          }
        }

        let shouldRetryFromError = false

        try {
          // 获取异步迭代器（手动 .next() 以支持 Promise.race 中断）
          const queryIterable = this.adapter.query(queryOptions)
          const queryIterator = queryIterable[Symbol.asyncIterator]()

          // 手动事件循环：Promise.race（SDKMessage vs result drain timeout）
          let pendingNext: Promise<IteratorResult<SDKMessage>> | null = null
          // 捕获 result.subtype 以传递给前端（用于区分 success/error_max_turns/error_max_budget_usd）
          let capturedResultSubtype: string | undefined
          // 捕获 result.errors[] 错误详情：SDK 在 error_during_execution 等场景下会把真实错误原因
          // 放进 errors[]，透传到前端用于展示具体错误（而非泛泛的"任务执行过程中发生错误"）。
          let capturedResultErrors: string[] | undefined
          // result 收到后的安全超时：正常情况下 adapter 收到 terminal result 后会主动 break 自己的
          // for-await 循环（触发 SDK iterator.return → cleanup），让此处的 next() 立即拿到 done。
          // 此 timeout 仅作真正的兜底安全网，防止极端情况（SDK 行为再次变化等）下 iterator 不关闭、
          // 事件循环无限挂起。正常运行下不应触发——若日志频繁出现 drain timeout，说明 adapter 主动
          // 终止路径失效，需排查。
          let drainTimeoutPromise: Promise<'drain_timeout'> | null = null
          const RESULT_DRAIN_TIMEOUT_MS = 2_000
          // 后台任务等待态：result 走轻量完成后置 true，下一轮真正开始（收到 assistant/user/task 消息）时
          // 置回 false 并发 run_resumed，让 UI 从空闲态恢复运行态。
          let awaitingBackgroundWake = false
          let visibleRunMessageCount = 0

          while (true) {
            if (!pendingNext) {
              pendingNext = queryIterator.next()
            }

            const racePromises: Array<
              Promise<{
                kind: string
                result: IteratorResult<SDKMessage> | null
              }>
            > = [pendingNext.then((r) => ({ kind: 'event' as const, result: r }))]
            if (drainTimeoutPromise) {
              racePromises.push(
                drainTimeoutPromise.then(() => ({
                  kind: 'drain_timeout' as const,
                  result: null
                }))
              )
            }

            const raceResult = await Promise.race(racePromises)

            if (raceResult.kind === 'drain_timeout') {
              // 安全网：channel.close() 后 SDK 仍未在超时内关闭 iterator，强制退出
              console.warn(`[Agent 编排] drain timeout: SDK iterator 在 result 后 ${RESULT_DRAIN_TIMEOUT_MS}ms 内未关闭，强制退出`)
              pendingNext?.catch(() => {})
              pendingNext = null
              queryIterator.return?.(undefined as never).catch(() => {})
              break
            }

            const iterResult = raceResult.result
            if (!iterResult || iterResult.done) break

            pendingNext = null
            let msg = iterResult.value
            const isPartialMessage = isPartialSDKMessage(msg)
            if (msg.type === 'result') {
              const skillActivations = mergeSkillActivations(
                pendingSkillActivations,
                collectSkillActivations(
                  [...accumulatedMessages, msg],
                  workspaceSlug
                    ? {
                        workspaceSlug,
                        workspaceSkillsRoot: effectiveSkillsDir ?? getWorkspaceSkillsDir(workspaceSlug)
                      }
                    : undefined
                )
              )
              if (skillActivations.length > 0) {
                msg = {
                  ...(msg as Record<string, unknown>),
                  skill_activations: skillActivations
                } as unknown as SDKMessage
              }
              pendingSkillActivations = []
            }
            // assistant partial 帧也需要渠道身份：它们会立即进入实时 UI，但不会被持久化。
            msg = withAgentMessageChannelIdentity(msg, channelId)
            // isVisibleRunMessage 已抽到独立模块，不含 partial 判断；
            // pi runtime 的流式 partial 消息不应计入可见消息数，故在此显式排除。
            if (!isPartialMessage && isVisibleRunMessage(msg)) {
              visibleRunMessageCount += 1
            }

            // 后台任务唤醒：轻量完成后处于等待态，收到新一轮的首条实质消息时
            // 发 run_resumed，让 UI 从"空闲可输入"恢复到"运行中"。
            // applyAgentEvent 的流式分支不会重置 running，故必须显式通知。
            if (awaitingBackgroundWake) {
              const sub = msg.type === 'system' ? (msg as { subtype?: string }).subtype : undefined
              if (msg.type === 'assistant' || msg.type === 'user' || sub === 'task_started' || sub === 'task_progress') {
                awaitingBackgroundWake = false
                this.eventBus.emit(sessionId, {
                  kind: 'myyoda_event',
                  event: { type: 'run_resumed', sessionId }
                })
              }
            }

            // SDK 权限模式可能在 canUseTool 前直接批准工具（如 bypassPermissions）。
            // 因此计划阶段状态要从实际 tool_use 流里同步，不能只依赖权限回调。
            if (msg.type === 'assistant') {
              const assistantMsg = msg as SDKAssistantMessage
              if (!assistantMsg.isReplay) {
                for (const block of assistantMsg.message.content) {
                  if (block.type === 'tool_use' && 'name' in block && typeof block.name === 'string') {
                    syncPlanModeFromToolUse(block.name)
                  }
                }
              }
            }

            // 检测 assistant 消息中的 SDK 错误
            if (msg.type === 'assistant' && !isPartialMessage) {
              const assistantMsg = msg as SDKAssistantMessage
              if (assistantMsg.error) {
                // Pi 把已生成文本和终态传输错误分开存放，直接取 Pi 专用错误详情。
                const { detailedMessage, originalError } = getPiAssistantErrorDetails(assistantMsg)
                let errorCode = assistantMsg.error.errorType || 'unknown_error'
                if (isPromptTooLongError(detailedMessage, originalError)) {
                  errorCode = 'prompt_too_long'
                }
                const typedError = mapSDKErrorToTypedError(errorCode, friendlyErrorMessage(detailedMessage), originalError)

                // Session 不存在错误：清除 sdkSessionId，切换到上下文回填模式重试
                if (isSessionNotFoundError(detailedMessage, originalError) && existingSdkSessionId && canAutoRetry(attempt)) {
                  invisibleRecoveryAttempts += 1
                  skipNextRetryDelay = true
                  existingSdkSessionId = undefined
                  capturedSdkSessionId = undefined
                  lastRetryableError = this.prepareSessionNotFoundRecovery(sessionId, queryOptions, contextualMessage, agentCwd, workspaceSlug, accumulatedMessages, queryStartedAt)
                  stderrChunks.length = 0
                  shouldRetryFromError = true
                  break
                }

                // Thinking signature 不兼容：通常由跨模型 resume 触发。
                // 先自动清除 SDK resume 关系，改用 MyYoda 已持久化上下文重跑一次；再失败才展示用户提示。
                if (typedError.code === THINKING_SIGNATURE_ERROR_CODE && canTryThinkingSignatureRecovery(attempt)) {
                  thinkingSignatureRecoveryAttempted = true
                  invisibleRecoveryAttempts += 1
                  existingSdkSessionId = undefined
                  capturedSdkSessionId = undefined
                  skipNextRetryDelay = true
                  lastRetryableError = this.prepareResumeFallbackRecovery(
                    sessionId,
                    queryOptions,
                    contextualMessage,
                    agentCwd,
                    workspaceSlug,
                    accumulatedMessages,
                    queryStartedAt,
                    '检测到 thinking signature 不兼容，清除 sdkSessionId 并切换到上下文回填模式',
                    '思考签名不兼容，切换到上下文回填模式',
                    true // 跨模型签名不兼容是唯一确定永久无效的场景，清除磁盘 sdkSessionId
                  )
                  stderrChunks.length = 0
                  shouldRetryFromError = true
                  break
                }

                // 上下文过长：旧 SDK session 已经处于不可继续的超限状态。
                // 自动清除 resume 指针，改用 MyYoda 最近历史回填重跑一次；用于飞书/自动任务等无人值守入口自恢复。
                if (typedError.code === 'prompt_too_long' && canTryPromptTooLongRecovery(attempt)) {
                  promptTooLongRecoveryAttempted = true
                  invisibleRecoveryAttempts += 1
                  existingSdkSessionId = undefined
                  capturedSdkSessionId = undefined
                  skipNextRetryDelay = true
                  lastRetryableError = this.prepareResumeFallbackRecovery(sessionId, queryOptions, contextualMessage, agentCwd, workspaceSlug, accumulatedMessages, queryStartedAt, '检测到上下文过长，清除 sdkSessionId 并切换到上下文回填模式', '上下文过长，切换到上下文回填模式', true)
                  stderrChunks.length = 0
                  shouldRetryFromError = true
                  break
                }

                // 判断是否可自动重试
                if (isAutoRetryableTypedError(typedError) && canReplayPromptForRetry(attempt)) {
                  lastRetryableError = typedError.title ? `${typedError.title}: ${typedError.message}` : typedError.message
                  console.log(`[Agent 编排] 可重试错误 (assistant error): ${typedError.code} - ${lastRetryableError}`)
                  this.persistSDKMessages(sessionId, accumulatedMessages, Date.now() - queryStartedAt)
                  accumulatedMessages.length = 0
                  // 与 catch 路径（isAutoRetryableCatchError）和思考签名回填路径保持一致：
                  // 重试前清空已累积的 stderr，避免 25 次重试上限内字符串无限增长
                  stderrChunks.length = 0
                  shouldRetryFromError = true
                  break
                }

                // 不可重试 → 终止
                // Pi 可能在流失败前已生成一段正文：把它从错误字段里剥离，
                // 当作普通 assistant 消息保留下来，不能因为终态错误就整体丢弃。
                const hasPiPartialOutput = hasPiAssistantTextContent(assistantMsg)
                if (hasPiPartialOutput) {
                  const partialOutput = withAgentMessageChannelIdentity(stripPiAssistantError(assistantMsg), channelId)
                  if (modelId) partialOutput._channelModelId = modelId
                  partialOutput._channelProvider = channel.provider
                  accumulatedMessages.push(partialOutput)
                  // 复用 Pi 的 uuid，让这条正常 markdown 输出替换掉最后一帧局部消息。
                  this.eventBus.emit(sessionId, {
                    kind: 'sdk_message',
                    message: partialOutput
                  })
                }
                this.persistSDKMessages(sessionId, accumulatedMessages, Date.now() - queryStartedAt)
                accumulatedMessages.length = 0
                if (typedError.code === 'prompt_too_long') {
                  try {
                    updateAgentSessionMeta(sessionId, {
                      sdkSessionId: undefined
                    })
                  } catch {
                    /* 忽略 */
                  }
                }

                const errorContent = typedError.title ? `${typedError.title}: ${typedError.message}` : typedError.message
                const errorSDKMsg: SDKMessage = {
                  type: 'assistant',
                  message: {
                    content: [{ type: 'text', text: errorContent }]
                  },
                  parent_tool_use_id: null,
                  uuid: randomUUID(),
                  _channelModelId: modelId,
                  _channelProvider: channel.provider,
                  error: {
                    message: typedError.message,
                    errorType: typedError.code
                  },
                  _createdAt: Date.now(),
                  _errorCode: typedError.code,
                  _errorTitle: typedError.title,
                  _errorDetails: typedError.details,
                  _errorCanRetry: typedError.canRetry,
                  _errorActions: typedError.actions
                } as unknown as SDKMessage
                const persistedErrorSDKMsg = withAgentMessageChannelIdentity(errorSDKMsg, channelId)
                appendSDKMessages(sessionId, [persistedErrorSDKMsg])
                console.log(`[Agent 编排] 已保存 TypedError 消息: ${typedError.code} - ${typedError.title}`)

                // 如果之前有可见重试记录，发送 retry_failed
                if (retryAttemptsScheduled > RETRY_VISIBILITY_THRESHOLD && lastRetryableError) {
                  this.eventBus.emit(sessionId, {
                    kind: 'myyoda_event',
                    event: {
                      type: 'retry',
                      status: 'failed',
                      attemptData: {
                        attempt: retryAttemptsScheduled,
                        timestamp: Date.now(),
                        reason: lastRetryableError,
                        errorMessage: typedError.message,
                        delaySeconds: 0
                      }
                    }
                  })
                }

                // 透传归一化后的错误消息到前端；实时帧与持久化帧共用同一渠道身份，
                // 避免运行中切换下一轮模型时显示错渠道（upstream #1625）。
                this.eventBus.emit(sessionId, {
                  kind: 'sdk_message',
                  message: persistedErrorSDKMsg
                })
                try {
                  updateAgentSessionMeta(sessionId, {})
                } catch {
                  /* 忽略 */
                }
                completeRun({
                  startedAt: streamStartedAt
                })
                return
              }
            }

            // 累积 assistant 和 user 消息用于持久化
            // - 跳过 replay 消息，避免 resume 时重复写入
            // - 对 user 消息，仅累积含 tool_result 的（初始用户消息已在步骤 5 手动持久化）
            // - 对 system 消息，仅累积需要长期可见的状态（压缩 / 权限拒绝）
            if (msg.type === 'assistant' || msg.type === 'user' || msg.type === 'result') {
              const msgRecord = msg as Record<string, unknown>
              if (!msgRecord.isReplay && !isPartialMessage) {
                if (msg.type === 'user') {
                  // 仅累积包含 tool_result 的 user 消息（跳过 SDK 重新发出的初始用户消息）
                  const content = (msg as { message?: { content?: Array<{ type: string }> } }).message?.content
                  const hasToolResult = Array.isArray(content) && content.some((b) => b.type === 'tool_result')
                  if (hasToolResult) {
                    accumulatedMessages.push(msg)
                  }
                } else {
                  // 为结果消息注入渠道信息，确保持久化后能按 Agent SDK 运行窗口计算压缩阈值
                  if (msg.type === 'result') {
                    if (modelId) {
                      ;(msg as Record<string, unknown>)._channelModelId = modelId
                    }
                    ;(msg as Record<string, unknown>)._channelProvider = channel.provider
                  }
                  // 为 assistant 消息注入渠道信息，确保持久化后能正确匹配模型显示名与 Agent SDK 窗口
                  if (msg.type === 'assistant') {
                    if (modelId) {
                      ;(msg as Record<string, unknown>)._channelModelId = modelId
                    }
                    ;(msg as Record<string, unknown>)._channelProvider = channel.provider
                  }
                  accumulatedMessages.push(msg)
                }
              }
            } else if (msg.type === 'system') {
              const sysMsg = msg as SDKSystemMessage
              if (isPersistableSDKSystemMessage(sysMsg)) {
                accumulatedMessages.push(msg)
              }
            }

            // Turn 结束时：持久化累积消息
            if (msg.type === 'result') {
              capturedResultSubtype = (msg as { subtype?: string }).subtype
              // SDK 的 SDKResultError 在 errors[] 中携带真实错误原因（error_during_execution 等场景），
              // 捕获后既用于重试判定，也透传到前端展示具体错误。
              const rawResultErrors = (msg as { errors?: unknown }).errors
              capturedResultErrors = Array.isArray(rawResultErrors) ? rawResultErrors.filter((e): e is string => typeof e === 'string' && e.trim().length > 0) : undefined
              this.persistSDKMessages(sessionId, accumulatedMessages, Date.now() - queryStartedAt)
              accumulatedMessages.length = 0
              // 软中断 / 延迟工具 / hook 暂停等场景下，adapter 保留 channel
              // 等待队列或后续消息继续 drive Query，此处跳过 drain 超时以免误关闭事件循环。
              // 完整白名单见 adapters/claude-agent-adapter.ts 的 CONTINUABLE_TERMINAL_REASONS。
              const resultTerminalReason = (msg as { terminal_reason?: string }).terminal_reason
              // adapter 在"本轮结束但仍有后台任务/定时任务在飞行"时打的注解：
              // 走轻量完成（UI 空闲可输入、host 保留会话），等待 task_notification 自动续轮。
              const keptOpenForTasks = (msg as Record<string, unknown>)._keepChannelOpenForTasks === true
              const keepChannelOpen = shouldKeepChannelOpen(resultTerminalReason) || keptOpenForTasks
              // 分类打点：跟踪线上哪种 terminal_reason 最常见，配合 deferred_tool_use 回填决策
              const hasDeferredTool = (msg as { deferred_tool_use?: unknown }).deferred_tool_use != null
              console.log(`[Agent 编排] result 到达: sessionId=${sessionId}, subtype=${capturedResultSubtype ?? 'unknown'}, ` + `terminal_reason=${resultTerminalReason ?? 'undefined'}, keepChannelOpen=${keepChannelOpen}` + (keptOpenForTasks ? ', keptOpenForTasks=true' : '') + (hasDeferredTool ? ', hasDeferredTool=true' : '') + (capturedResultErrors?.length ? `, errors=${JSON.stringify(capturedResultErrors)}` : ''))
              // error_during_execution 是 SDK 的兜底错误码，以 result（而非 assistant.error / 抛异常）形式到达，
              // 默认不会触发上面两条重试路径。这里用 errors[] 文本喂给现有的可重试判定（502/529/overloaded/
              // 网络瞬断 / 响应体解析失败等），命中则进入重试循环，复用统一的退避逻辑。
              if (capturedResultSubtype === 'error_during_execution' && capturedResultErrors?.length && isSessionNotFoundError(capturedResultErrors.join('\n'), stderrChunks.join('\n')) && existingSdkSessionId && canAutoRetry(attempt)) {
                invisibleRecoveryAttempts += 1
                skipNextRetryDelay = true
                existingSdkSessionId = undefined
                capturedSdkSessionId = undefined
                lastRetryableError = this.prepareSessionNotFoundRecovery(sessionId, queryOptions, contextualMessage, agentCwd, workspaceSlug, accumulatedMessages, queryStartedAt)
                stderrChunks.length = 0
                shouldRetryFromError = true
                break
              }
              if (capturedResultSubtype === 'error_during_execution' && capturedResultErrors?.length && isAutoRetryableCatchError(null, capturedResultErrors.join('\n')) && canReplayPromptForRetry(attempt)) {
                lastRetryableError = capturedResultErrors[0]
                console.log(`[Agent 编排] 可重试错误 (result error_during_execution, attempt ${attempt}/${MAX_AUTO_RETRIES}): ${lastRetryableError}`)
                // 与 assistant.error / catch 重试路径保持一致：清空已累积 stderr，避免重试上限内无限增长
                stderrChunks.length = 0
                shouldRetryFromError = true
                break
              }
              if (keptOpenForTasks) {
                // 轻量完成：UI 置空闲可输入，但 host 保持运行态（不 releaseActiveRun、不 break、不启动 drain 超时），
                // while 循环继续 park 在 queryIterator.next()，等待后台任务完成时 SDK 自动 yield 的新一轮消息。
                awaitingBackgroundWake = true
                idleComplete({
                  startedAt: streamStartedAt,
                  resultSubtype: capturedResultSubtype,
                  resultErrors: capturedResultErrors
                })
              } else if (!keepChannelOpen && !drainTimeoutPromise) {
                // 启动 drain 超时安全网：正常情况下 adapter 收到 terminal result 会主动 break
                // 触发 iterator.return → 下一次 next() 立即返回 done，此 timeout 不会触发。
                // 仅在极端情况下（adapter 主动终止失效、SDK 行为再次变化）保护事件循环不无限挂起。
                drainTimeoutPromise = new Promise((resolve) => setTimeout(() => resolve('drain_timeout'), RESULT_DRAIN_TIMEOUT_MS))
              }
            }

            // 过滤 SDK 内部生成的 user 消息（如 Skill 展开文本），避免在前端渲染为用户消息
            // 仅允许含 tool_result 的 user 消息通过（这些是工具调用的响应，需要展示）
            // 初始用户消息已通过前端乐观注入显示，无需 SDK 重复推送
            let shouldEmit = true
            if (msg.type === 'user') {
              const content = (msg as { message?: { content?: Array<{ type: string }> } }).message?.content
              const hasToolResult = Array.isArray(content) && content.some((b) => b.type === 'tool_result')
              if (!hasToolResult) {
                shouldEmit = false
              }
            }

            if (!shouldEmit) {
              // 跳过 SDK 内部 user 消息的前端推送
            } else {
              this.eventBus.emit(sessionId, {
                kind: 'sdk_message',
                message: msg
              })
            }
          }

          // 错误 break 触发了 → 继续循环
          if (shouldRetryFromError) {
            continue
          }

          const wasStoppedByUser = this.consumeStoppedByUser(sessionId, runGeneration)

          // 正常完成 — 如果之前有可见重试，发送 retry_cleared
          if (!wasStoppedByUser && retryAttemptsScheduled > RETRY_VISIBILITY_THRESHOLD) {
            this.eventBus.emit(sessionId, {
              kind: 'myyoda_event',
              event: { type: 'retry', status: 'cleared' }
            })
            console.log(`[Agent 编排] 重试成功，已在第 ${attempt} 次尝试后恢复`)
          }
          retrySucceeded = true

          // 15. 持久化 assistant 消息
          this.persistSDKMessages(sessionId, accumulatedMessages, Date.now() - queryStartedAt)

          try {
            updateAgentSessionMeta(sessionId, wasStoppedByUser ? { stoppedByUser: true } : {})
          } catch {
            /* 忽略 */
          }

          if (!wasStoppedByUser && visibleRunMessageCount === 0) {
            const errorContent = this.persistEmptyResponseError(sessionId, channelId, capturedResultSubtype, capturedResultErrors)
            failRun(errorContent, {
              startedAt: streamStartedAt,
              resultSubtype: EMPTY_RESPONSE_RESULT_SUBTYPE,
              resultErrors: [errorContent]
            })
            return
          }

          // Plan 模式：Agent 完成规划后注入"接受计划"建议
          if (initialPermissionMode === 'plan' && planModeEntered && this.activeSessions.has(sessionId)) {
            this.eventBus.emit(sessionId, {
              kind: 'sdk_message',
              message: {
                type: 'prompt_suggestion',
                suggestion: '请执行该计划'
              } as unknown as SDKMessage
            })
            console.log(`[Agent 编排] Plan 模式：已注入计划确认建议`)
          }

          // 发送完成信号
          completeRun({
            stoppedByUser: wasStoppedByUser,
            startedAt: streamStartedAt,
            resultSubtype: capturedResultSubtype,
            resultErrors: capturedResultErrors
          })

          break // 成功完成，退出重试循环
        } catch (error) {
          // 打印 stderr
          const fullStderr = stderrChunks.join('').trim()
          if (fullStderr) {
            console.error(`[Agent 编排] 完整 stderr 输出 (${fullStderr.length} 字符):`)
            console.error(fullStderr)
          } else {
            console.error(`[Agent 编排] stderr 为空`)
          }

          // 用户主动中止
          if (!this.activeSessions.has(sessionId)) {
            const wasStoppedByUser = this.consumeStoppedByUser(sessionId, runGeneration)
            console.log(`[Agent 编排] 会话 ${sessionId} 已被用户中止`)
            this.persistSDKMessages(sessionId, accumulatedMessages, Date.now() - queryStartedAt)
            // 持久化中断状态到会话 meta
            try {
              updateAgentSessionMeta(sessionId, {
                stoppedByUser: wasStoppedByUser
              })
            } catch {
              /* 会话可能已删除 */
            }
            completeRun({
              stoppedByUser: wasStoppedByUser,
              startedAt: streamStartedAt
            })
            return
          }

          // 从 stderr 提取 API 错误
          const stderrOutput = stderrChunks.join('').trim()
          const apiError = extractApiError(stderrOutput)
          const rawErrorMessage = error instanceof Error ? error.message : ''
          const catchLooksPromptTooLong = isPromptTooLongError(apiError?.message ?? '', rawErrorMessage, stderrOutput)

          // Session 不存在错误：清除 sdkSessionId，切换到上下文回填模式重试
          if (isSessionNotFoundError(rawErrorMessage, stderrOutput) && existingSdkSessionId && canAutoRetry(attempt)) {
            invisibleRecoveryAttempts += 1
            skipNextRetryDelay = true
            existingSdkSessionId = undefined
            capturedSdkSessionId = undefined
            lastRetryableError = this.prepareSessionNotFoundRecovery(sessionId, queryOptions, contextualMessage, agentCwd, workspaceSlug, accumulatedMessages, queryStartedAt)
            stderrChunks.length = 0
            continue // 进入下一次 retry 循环
          }

          // 上下文过长：清除超限 resume 指针，用 MyYoda 历史回填自动恢复一次。
          if (catchLooksPromptTooLong && canTryPromptTooLongRecovery(attempt)) {
            promptTooLongRecoveryAttempted = true
            invisibleRecoveryAttempts += 1
            existingSdkSessionId = undefined
            capturedSdkSessionId = undefined
            skipNextRetryDelay = true
            lastRetryableError = this.prepareResumeFallbackRecovery(sessionId, queryOptions, contextualMessage, agentCwd, workspaceSlug, accumulatedMessages, queryStartedAt, '检测到上下文过长，清除 sdkSessionId 并切换到上下文回填模式', '上下文过长，切换到上下文回填模式', true)
            stderrChunks.length = 0
            continue // 进入下一次 retry 循环
          }

          // Thinking signature 不兼容：先自动清除 SDK resume 关系并用上下文回填重跑一次。
          if (isThinkingSignatureError(apiError?.message ?? '', rawErrorMessage, stderrOutput) && canTryThinkingSignatureRecovery(attempt)) {
            thinkingSignatureRecoveryAttempted = true
            invisibleRecoveryAttempts += 1
            existingSdkSessionId = undefined
            capturedSdkSessionId = undefined
            skipNextRetryDelay = true
            lastRetryableError = this.prepareResumeFallbackRecovery(
              sessionId,
              queryOptions,
              contextualMessage,
              agentCwd,
              workspaceSlug,
              accumulatedMessages,
              queryStartedAt,
              '检测到 thinking signature 不兼容，清除 sdkSessionId 并切换到上下文回填模式',
              '思考签名不兼容，切换到上下文回填模式',
              true // 跨模型签名不兼容是唯一确定永久无效的场景，清除磁盘 sdkSessionId
            )
            stderrChunks.length = 0
            continue // 进入下一次 retry 循环
          }

          // 判断是否可重试
          if (isAutoRetryableCatchError(apiError, rawErrorMessage, stderrOutput) && canReplayPromptForRetry(attempt)) {
            lastRetryableError = apiError ? `API Error ${apiError.statusCode}: ${apiError.message}` : error instanceof Error ? error.message : '未知错误'
            console.log(`[Agent 编排] 可重试错误 (catch, attempt ${attempt}/${MAX_AUTO_RETRIES}): ${lastRetryableError}`)
            // 保存部分内容
            this.persistSDKMessages(sessionId, accumulatedMessages, Date.now() - queryStartedAt)
            accumulatedMessages.length = 0
            stderrChunks.length = 0
            continue // 进入下一次 retry 循环
          }

          // 不可重试 — 走原有终止逻辑
          const errorMessage = error instanceof Error ? error.message : '未知错误'
          console.error(`[Agent 编排] 执行失败:`, error)

          // 保存已累积的部分内容
          if (accumulatedMessages.length > 0) {
            try {
              this.persistSDKMessages(sessionId, accumulatedMessages, Date.now() - queryStartedAt)
              console.log(`[Agent 编排] 已保存部分执行结果 (${accumulatedMessages.length} 条消息)`)
            } catch (saveError) {
              console.error('[Agent 编排] 保存部分内容失败:', saveError)
            }
          }

          let userFacingError: string
          if (apiError) {
            userFacingError = friendlyErrorMessage(`API 错误 (${apiError.statusCode}):\n${apiError.message}`)
          } else {
            userFacingError = friendlyErrorMessage(errorMessage)
          }

          // 保存错误消息到 JSONL
          try {
            // 检测是否为 prompt too long 错误
            const isPromptTooLong = isPromptTooLongError(userFacingError, error instanceof Error ? (error.stack ?? error.message) : String(error), stderrOutput)
            const isThinkingSignature = isThinkingSignatureError(apiError?.message ?? '', userFacingError, rawErrorMessage, error instanceof Error ? (error.stack ?? error.message) : String(error), stderrOutput)
            const errorCode = isPromptTooLong ? 'prompt_too_long' : isThinkingSignature ? THINKING_SIGNATURE_ERROR_CODE : 'unknown_error'
            const errorTitle = isPromptTooLong ? '上下文过长' : isThinkingSignature ? THINKING_SIGNATURE_ERROR_TITLE : '执行错误'
            const errorContent = isPromptTooLong ? '上下文过长：当前对话的上下文已超出模型限制，请压缩上下文或开启新会话' : isThinkingSignature ? `${THINKING_SIGNATURE_ERROR_TITLE}：${THINKING_SIGNATURE_ERROR_MESSAGE}` : userFacingError
            const errorActions = isThinkingSignature
              ? [
                  {
                    key: 'n',
                    label: '在新对话继续',
                    action: 'retry_in_new_session'
                  },
                  { key: 'r', label: '重试', action: 'retry' }
                ]
              : undefined
            userFacingError = errorContent
            if (isPromptTooLong) {
              try {
                updateAgentSessionMeta(sessionId, { sdkSessionId: undefined })
              } catch {
                /* 忽略 */
              }
            }

            const errMsg: SDKMessage = {
              type: 'assistant',
              message: {
                content: [{ type: 'text', text: errorContent }]
              },
              parent_tool_use_id: null,
              uuid: randomUUID(),
              error: { message: errorContent, errorType: errorCode },
              _createdAt: Date.now(),
              _errorCode: errorCode,
              _errorTitle: errorTitle,
              _errorActions: errorActions
            } as unknown as SDKMessage
            appendSDKMessages(sessionId, [withAgentMessageChannelIdentity(errMsg, channelId)])
            console.log(`[Agent 编排] 已保存错误消息到 JSONL`)
          } catch (saveError) {
            console.error('[Agent 编排] 保存错误消息失败:', saveError)
          }

          // 如果之前有可见重试记录，发送 retry_failed
          if (retryAttemptsScheduled > RETRY_VISIBILITY_THRESHOLD && lastRetryableError) {
            this.eventBus.emit(sessionId, {
              kind: 'myyoda_event',
              event: {
                type: 'retry',
                status: 'failed',
                attemptData: {
                  attempt: retryAttemptsScheduled,
                  timestamp: Date.now(),
                  reason: lastRetryableError,
                  errorMessage: userFacingError,
                  delaySeconds: 0
                }
              }
            })
          }

          failRun(userFacingError, { startedAt: streamStartedAt })

          // 保留 sdkSessionId，确保下一轮能继续 resume（修复 #903）。
          // 此终止分支只会被「非 session-not-found」的错误命中（session 失效已在上文
          // isSessionNotFoundError 分支单独处理并切到恢复模式）。网络断连、服务端 5xx、
          // 未知错误都不代表 SDK 会话本身失效——其完整历史 JSONL 仍保存在
          // ~/.myyoda/sdk-config/projects/.../{sdkSessionId}.jsonl 中，依旧可 resume。
          // 此前这里对 `!apiError`（如普通断连解析不出状态码）一律清除指针，导致下一轮
          // 退化为「仅回填最近 N 条」的冷启动，上下文从满载骤降（#903）。
          if (existingSdkSessionId) {
            console.log(`[Agent 编排] 保留 sdkSessionId 以便下一轮 resume（错误未表明会话失效）`)
          }

          return
        }
      }

      // 重试循环结束（达到最大次数仍失败）
      if (!retrySucceeded && lastRetryableError) {
        const retryFailureMessage = retryDelayElapsedMs >= MAX_AUTO_RETRY_WAIT_MS ? '重试等待已达到 5 分钟后仍然失败' : `重试 ${retryAttemptsScheduled || MAX_AUTO_RETRIES} 次后仍然失败`

        // 仅当重试曾经对用户可见时才发送 retry_failed 事件
        if (retryAttemptsScheduled > RETRY_VISIBILITY_THRESHOLD) {
          this.eventBus.emit(sessionId, {
            kind: 'myyoda_event',
            event: {
              type: 'retry',
              status: 'failed',
              attemptData: {
                attempt: retryAttemptsScheduled || MAX_AUTO_RETRIES,
                timestamp: Date.now(),
                reason: lastRetryableError,
                errorMessage: retryFailureMessage,
                delaySeconds: 0
              }
            }
          })
        }

        // 保存错误消息
        const retryErrorContent = `${retryFailureMessage}: ${lastRetryableError}`
        const retryErrorSDKMsg: SDKMessage = {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: retryErrorContent }]
          },
          parent_tool_use_id: null,
          uuid: randomUUID(),
          error: { message: retryErrorContent, errorType: 'unknown_error' },
          _createdAt: Date.now(),
          _errorCode: 'unknown_error',
          _errorTitle: '重试失败'
        } as unknown as SDKMessage
        appendSDKMessages(sessionId, [retryErrorSDKMsg])

        failRun(`${retryFailureMessage}: ${lastRetryableError}`, { startedAt: streamStartedAt })
      }
    } finally {
      // 每轮终态统一捕获新增/修改文件；索引写入失败不得覆盖原有清理逻辑。
      if (sessionFileRoots && turnOutputSnapshot && workspaceSlug) {
        try {
          const captured = captureAgentTurnOutputs(sessionFileRoots, turnOutputSnapshot, {
            sessionId,
            workspaceSlug,
            projectId: getAgentSessionMeta(sessionId)?.projectId ?? sessionMeta?.projectId,
            turnStartedAt: streamStartedAt
          })
          if (captured.length > 0) {
            console.log(`[Agent 产出] 已捕获 ${captured.length} 个文件变化: sessionId=${sessionId}`)
          }
        } catch (error) {
          console.warn('[Agent 产出] turn 后捕获失败，不影响 Agent 终态:', error)
        }
      }

      // 只在 generation 匹配时才清理，防止旧流的 finally 误删新流的注册
      releaseActiveRun()
      permissionService.clearSessionPending(sessionId)
      // askUserService 不在 turn 结束时清理——AskUserQuestion 的生命周期由用户交互决定，
      // 仅在会话真正删除时（DELETE_SESSION IPC）才清理。
      exitPlanService.clearSessionPending(sessionId)
    }
  }

  /**
   * 中止指定会话的 Agent 执行
   *
   * 先从 activeSessions 移除（供 sendMessage catch 块检测用户中止），
   * 再调用 adapter.abort() 中止底层 SDK 进程。
   */
  stop(sessionId: string): void {
    const runGeneration = this.activeSessions.get(sessionId)
    this.activeSessions.delete(sessionId)
    this.sessionPermissionModes.delete(sessionId)
    browserController.cancelSession(sessionId)
    if (runGeneration != null) this.stoppedBySessions.set(sessionId, runGeneration)
    this.queuedMessageUuids.delete(sessionId)
    this.adapter.abort(sessionId)
    console.log(`[Agent 编排] 已中止会话: ${sessionId}`)
  }

  /** 检查指定会话是否正在处理中 */
  isActive(sessionId: string): boolean {
    return this.activeSessions.has(sessionId)
  }

  /** 是否存在任意运行中 Agent（含后台运行与外部触发的会话）。 */
  hasActiveSessions(): boolean {
    return this.activeSessions.size > 0
  }

  /**
   * 运行中动态切换会话的权限模式
   *
   * 同时更新 MyYoda 侧（canUseTool 闭包读取的 Map）和 SDK 侧（query.setPermissionMode）。
   * 典型场景：用户在 Agent 运行中通过 PermissionModeSelector 切换模式。
   */
  async updateSessionPermissionMode(sessionId: string, mode: MyYodaPermissionMode): Promise<void> {
    if (!this.activeSessions.has(sessionId)) return
    this.sessionPermissionModes.set(sessionId, mode)
    this.eventBus.emit(sessionId, {
      kind: 'myyoda_event',
      event: {
        type: 'plan_mode_changed',
        sessionId,
        active: mode === 'plan',
        source: 'permission'
      }
    })
    // 同步通知 SDK 侧
    if (this.adapter.setPermissionMode) {
      await this.adapter.setPermissionMode(sessionId, sdkPermissionModeForMyYodaMode(mode))
    }
    console.log(`[Agent 编排] 运行中权限模式已切换: sessionId=${sessionId}, mode=${mode}`)
  }

  // ===== 快照回退 =====

  /**
   * 回退会话到指定消息点
   *
   * 1. 直接从 SDK JSONL 的 file-history-snapshot 恢复文件到目标时刻的状态
   * 2. 截断 MyYoda JSONL 到 assistantMessageUuid（inclusive）
   * 3. 记录 resumeAtMessageUuid，下次发消息时 SDK 从该点分支继续
   *
   * 文件恢复通过解析 SDK JSONL 中的快照完成，无需运行中的 Query。
   * 文件恢复失败时仍然截断对话（优雅降级）。
   */
  async rewindSession(sessionId: string, assistantMessageUuid: string): Promise<RewindSessionResult> {
    // 0. 阻止运行中会话回退（JSONL 并发写入会损坏文件）
    if (this.activeSessions.has(sessionId)) {
      throw new Error('会话正在运行中，请停止后再回退')
    }

    const sessionMeta = getAgentSessionMeta(sessionId)
    if (sessionMeta?.legacyTranscript?.continuationRequired) {
      throw new Error('这是已退役 Claude runtime 的只读历史会话，不能回退；请以 Pi 新会话继续。')
    }
    if (!sessionMeta?.sdkSessionId) {
      throw new Error('会话没有 SDK session ID，无法回退')
    }

    // Pi 使用原生树状 session 导出一个持久 artifact；不能复用 Claude snapshot
    // 或仅截断 renderer JSONL，否则下一轮 resume 会重新加载被舍弃的上下文。
    // Claude runtime 已退役，历史 Claude 会话在迁移时已清除 sdkSessionId，不会走到这里。
    await rewindPiAgentSession(sessionId, assistantMessageUuid)
    const kept = truncateSDKMessages(sessionId, assistantMessageUuid)
    return {
      remainingMessages: kept.length,
      fileRewind: {
        canRewind: false,
        error: '已回退 Pi 对话；Pi 文件回退尚未启用，当前未修改任何文件。'
      }
    }
  }

  /** 中止所有活跃的 Agent 会话（应用退出时调用） */
  stopAll(): void {
    if (this.activeSessions.size > 0) {
      console.log(`[Agent 编排] 正在中止所有活跃会话 (${this.activeSessions.size} 个)...`)
    }
    // 即便 activeSessions 为空，也要调 dispose 清理可能残留的 pidMap / 子进程
    this.adapter.dispose()
    this.activeSessions.clear()
    this.sessionPermissionModes.clear()
    this.queuedMessageUuids.clear()
    this.pendingUserSkillActivations.clear()
  }

  // ===== 队列消息管理 =====

  /**
   * 流式追加消息
   *
   * 在 Agent 运行中注入用户消息到 SDK，使用 'now' 优先级立即处理。
   * 消息立即持久化到 JSONL。
   *
   * @returns 消息 UUID
   */
  async queueMessage(sessionId: string, text: string, rawText?: string, _priority?: string, presetUuid?: string, opts?: { interrupt?: boolean }, mentionedSkills?: string[], mentionedMcpServers?: string[], mentionedSessionIds?: string[], mentionedTodoIds?: string[], mentionedCalendarEventIds?: string[]): Promise<string> {
    if (!this.activeSessions.has(sessionId)) {
      throw new Error(`[Agent 编排] 会话未运行，无法追加消息: ${sessionId}`)
    }

    if (!this.adapter.sendQueuedMessage) {
      throw new Error('[Agent 编排] 当前适配器不支持流式追加消息')
    }

    // 注入 mention 引用指令（Skill/MCP/会话）— 与 sendMessage 路径保持一致的 prompt 加工
    const meta = getAgentSessionMeta(sessionId)
    const workspaceSlug = meta?.workspaceId ? getAgentWorkspace(meta.workspaceId)?.slug : undefined

    const userBrowserContext = browserController.getUserContext(sessionId)
    // 运行中的 Agent 收到队列消息时也必须看到用户刚刚主动打开的页面。
    // 未打开浏览器时保持既有消息形态，避免给每条插队消息重复注入无关环境块。
    let enrichedText = userBrowserContext ? `${buildDynamicContext({ userBrowserContext })}\n\n${text}` : text
    const referencedSessionsBlock = buildReferencedSessionsPrompt(sessionId, mentionedSessionIds, workspaceSlug)
    if (referencedSessionsBlock) {
      enrichedText = `${referencedSessionsBlock}\n\n${enrichedText}`
    }
    if (mentionedSkills?.length || mentionedMcpServers?.length) {
      const toolLines: string[] = ['用户在消息中明确引用了以下工具，请在本次回复中主动调用：']
      for (const slug of mentionedSkills ?? []) {
        const qualifiedName = workspaceSlug ? `myyoda-workspace-${workspaceSlug}:${slug}` : slug
        toolLines.push(`- Skill: ${qualifiedName}（请立即调用此 Skill）`)
      }
      for (const name of mentionedMcpServers ?? []) {
        toolLines.push(`- MCP 服务器: ${name}（请使用此 MCP 服务器的工具来完成任务）`)
      }
      enrichedText = `<mentioned_tools>\n${toolLines.join('\n')}\n</mentioned_tools>\n\n${enrichedText}`
    }
    // Planning read tools are Pi-native.
    const referencedPlanningBlock = buildReferencedPlanningPrompt(mentionedTodoIds, mentionedCalendarEventIds, { requireToolRead: true })
    if (referencedPlanningBlock) {
      enrichedText = `${referencedPlanningBlock}\n\n${enrichedText}`
    }

    const uuid = presetUuid || randomUUID()

    // 防重记录
    const uuids = this.queuedMessageUuids.get(sessionId) ?? new Set<string>()
    uuids.add(uuid)
    this.queuedMessageUuids.set(sessionId, uuids)

    // 构造 SDKUserMessage 并注入（强制 'now' 优先级）
    const sdkMessage = {
      type: 'user' as const,
      message: { role: 'user' as const, content: enrichedText },
      parent_tool_use_id: null,
      priority: 'now' as const,
      uuid,
      session_id: sessionId
    }

    try {
      await this.adapter.sendQueuedMessage(sessionId, sdkMessage, {
        ...(opts?.interrupt ? { interrupt: true } : {}),
        ...(mentionedSkills?.length ? { skillMentions: mentionedSkills } : {})
      })
      console.log(`[Agent 编排] 追加消息已注入: sessionId=${sessionId}, uuid=${uuid}, interrupt=${!!opts?.interrupt}`)

      // 立即持久化到 JSONL — 仅存原始文本，不含 prompt 工程块（与 sendMessage 路径一致）
      const persistMsg: SDKMessage = {
        type: 'user',
        uuid,
        message: {
          content: [{ type: 'text', text: rawText ?? text }]
        },
        parent_tool_use_id: null,
        _createdAt: Date.now()
      } as unknown as SDKMessage
      appendSDKMessages(sessionId, [persistMsg])
      this.flushPendingUserSkillActivations(sessionId, uuid)
    } catch (error) {
      uuids.delete(uuid)
      this.clearPendingUserSkillActivations(sessionId, uuid)
      if (isMissingActiveQueueChannelError(error)) {
        console.warn(`[Agent 编排] 队列注入失败且消息通道已失效，释放陈旧运行状态: sessionId=${sessionId}`)
        this.activeSessions.delete(sessionId)
        this.sessionPermissionModes.delete(sessionId)
        this.queuedMessageUuids.delete(sessionId)
      }
      throw error
    }

    return uuid
  }
}
