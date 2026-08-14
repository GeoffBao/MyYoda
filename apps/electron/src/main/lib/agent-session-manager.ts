/**
 * Agent 会话管理器
 *
 * 负责 Agent 会话的 CRUD 操作和消息持久化。
 * - 会话索引：~/.myyoda/agent-sessions.json（轻量元数据）
 * - 消息存储：~/.myyoda/agent-sessions/{id}.jsonl（JSONL 格式，逐行追加）
 *
 * 照搬 conversation-manager.ts 的模式。
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, unlinkSync, readdirSync, createReadStream, createWriteStream, openSync, readSync, closeSync, statSync, type WriteStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { writeJsonFileAtomic, writeTextFileAtomic, readJsonFileSafe } from './safe-file'
import { randomUUID } from 'node:crypto'
import { rmSyncWithRetry, renameWithRetry } from './fs-retry'
import { join, resolve, dirname, isAbsolute, relative, sep } from 'node:path'
import {
  getAgentSessionsIndexPath,
  getAgentSessionsDir,
  getAgentSessionMessagesPath,
  getAgentSessionWorkspacePath,
  getAgentWorkspacePath,
  getWorkspaceFilesDir,
  getSdkConfigDir,
} from './config-paths'
import { getAgentWorkspace, getWorkspaceAutoMemoryDir, listAgentWorkspaces } from './agent-workspace-manager'
import { assertWorktreeClean, removeSessionWorktree } from './git-session-context-service'

import type {
  AgentSessionMeta,
  AgentMessage,
  SDKUserMessage,
  SkillActivation,
  AgentWorkspace,
  SDKMessage,
  ForkSessionInput,
  AgentMessageSearchResult,
  AgentSessionReferenceSearchInput,
  AgentSessionReferenceSearchResult,
  AgentRuntime,
  AgentCwdMode,
  AgentActiveWorktree,
  SessionWorkbenchLayout,
} from '@myyoda/shared'
import {
  getSessionThinkingLevel,
  migratePermissionMode,
  mergeSkillActivations,
  sessionThinkingLevelPatch,
  findBestSearchMatch,
  insertTopSearchResult,
} from '@myyoda/shared'
import { getConversationMessages } from './conversation-manager'
// 旧格式 → SDKMessage 的转换逻辑下沉到 @myyoda/session-core 作为唯一真源，避免主进程与渲染层各存一份。
import { convertLegacyMessage } from '@myyoda/session-core'
import { clearNanoBananaAgentHistory } from './chat-tools/nano-banana-mcp'
import { assertEnabledModelForChannel } from './agent-model-selection'
import { copyForkWorkspaceFiles } from './agent-fork-workspace-copy'
import { isGitAttributionEnabled } from './agent-git-attribution'
import { assertRecoveryRootSafe, quarantineForRecovery, type RecoveryTrashRecord } from './recovery-trash-service'

/**
 * 会话索引文件格式
 */
interface AgentSessionsIndex {
  /** 配置版本号 */
  version: number
  /** 会话元数据列表 */
  sessions: AgentSessionMeta[]
  /** 是否已将旧版默认关闭的 OpenAI 推理会话升级为默认开启。 */
  openAIThinkingDefaultEnabledMigrationCompleted?: boolean
}

/** 当前索引版本 */
const INDEX_VERSION = 1

/**
 * 会话引用最大返回数。
 *
 * 无搜索词时只返回索引中的轻量元数据，200 条可以显著扩大可选范围，
 * 同时避免极端会话数量下向渲染进程传输过大列表。
 */
const MAX_SESSION_REFERENCE_LIMIT = 200

/** 全局 Agent 会话正文搜索的结果预算。 */
const MAX_SEARCH_SESSIONS = 100
const MAX_SEARCH_HITS_PER_SESSION = 2

/**
 * 会话引用的正文搜索是输入框补全路径，必须有独立 I/O 预算。
 * 标题检索仍覆盖全部会话；仅正文 JSONL 检索优先服务最近会话。
 */
const MAX_SESSION_REFERENCE_BODY_SCANS = 50
const MAX_SESSION_REFERENCE_BODY_BYTES_PER_FILE = 256 * 1024

interface JsonlParseError {
  lineNumber: number
  message: string
}

/**
 * 逐行解析 JSONL，调用方按业务场景决定容错或严格失败。
 */
function parseJsonlLines<T>(lines: string[]): { records: T[]; errors: JsonlParseError[] } {
  const records: T[] = []
  const errors: JsonlParseError[] = []
  for (let i = 0; i < lines.length; i++) {
    try {
      records.push(JSON.parse(lines[i]!) as T)
    } catch (err) {
      errors.push({
        lineNumber: i + 1,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return { records, errors }
}

/**
 * 展示/检索类读取：跳过损坏行，保留其它可读消息。
 */
function parseJsonlLenient<T>(lines: string[], context: string): T[] {
  const { records, errors } = parseJsonlLines<T>(lines)
  for (const error of errors) {
    console.warn(`[Agent 会话] ${context} — JSONL 第 ${error.lineNumber} 行解析失败，已跳过:`, error.message)
  }
  return records
}

/**
 * 回退/文件恢复类读取：任何损坏行都可能破坏消息顺序或快照完整性，必须停止。
 */
function parseJsonlStrict<T>(lines: string[], context: string): T[] {
  const { records, errors } = parseJsonlLines<T>(lines)
  if (errors.length > 0) {
    const first = errors[0]!
    throw new Error(`${context} 失败：JSONL 第 ${first.lineNumber} 行解析失败: ${first.message}`)
  }
  return records
}

function normalizePersistedSDKMessage(parsed: unknown): SDKMessage {
  // 旧格式检测：AgentMessage 有 `role` 字段，SDKMessage 有 `type` 字段
  if (parsed && typeof parsed === 'object' && 'role' in parsed && !('type' in parsed)) {
    return convertLegacyMessage(parsed as AgentMessage)
  }
  return parsed as SDKMessage
}

function migrateLegacyPermissionMode(index: AgentSessionsIndex): boolean {
  let changed = false
  for (const session of index.sessions) {
    const rawMode = session.permissionMode as string | undefined
    if (!rawMode) continue
    const nextMode = migratePermissionMode(rawMode)
    if (nextMode !== rawMode) {
      session.permissionMode = nextMode
      changed = true
    }
  }
  return changed
}

/**
 * 在此版本前，所有新建 OpenAI Agent 会话都会写入 off，无法与用户主动关闭区分。
 * 因此仅执行一次历史升级；之后用户手动关闭会保留 off。
 */
function migrateLegacyOpenAIThinkingDefault(index: AgentSessionsIndex): boolean {
  if (index.openAIThinkingDefaultEnabledMigrationCompleted) return false

  for (const session of index.sessions) {
    if (session.openAIThinkingLevel === 'off' || session.thinkingLevel === 'off') {
      Object.assign(session, sessionThinkingLevelPatch('high'))
    }
  }
  index.openAIThinkingDefaultEnabledMigrationCompleted = true
  return true
}

/** 将旧字段 openAIThinkingLevel 同步到 thinkingLevel，保证新读路径一致 */
function migrateThinkingLevelField(index: AgentSessionsIndex): boolean {
  let changed = false
  for (const session of index.sessions) {
    const level = getSessionThinkingLevel(session)
    if (!level) continue
    if (session.thinkingLevel !== level || session.openAIThinkingLevel !== level) {
      Object.assign(session, sessionThinkingLevelPatch(level))
      changed = true
    }
  }
  return changed
}

/** 统计会话 JSONL 的消息行数；文件缺失或读取失败按 0 处理（不留 undefined，避免重复触发迁移）。 */
function countSessionMessages(id: string): number {
  const filePath = getAgentSessionMessagesPath(id)
  if (!existsSync(filePath)) return 0
  try {
    const raw = readFileSync(filePath, 'utf-8')
    return raw.split('\n').filter((line) => line.trim()).length
  } catch (error) {
    console.error(`[Agent 会话] 统计消息计数失败 (${id}):`, error)
    return 0
  }
}

/**
 * 看板卡片右下角消息数徽标（对齐 craft）在 appendSDKMessages 里做增量维护，但历史会话
 * （字段引入之前创建的）从未被计数过。这里补一次基于 JSONL 行数的一次性回填——只处理
 * 绑定了 task spec 的会话（唯一会出现在看板上的子集），避免为全量会话历史都做文件 I/O。
 * 回填后 messageCount 不再是 undefined，之后的 readIndex 不会重复触发。
 */
function migrateMessageCountBackfill(index: AgentSessionsIndex): boolean {
  let changed = false
  for (const session of index.sessions) {
    if (!session.taskSlug || session.messageCount !== undefined) continue
    session.messageCount = countSessionMessages(session.id)
    changed = true
  }
  return changed
}

/**
 * Claude runtime 已退役。历史 transcript 仍由 MyYoda JSONL 展示，但 Claude session
 * artifact 不能交给 Pi SessionManager 恢复，否则会被误识别为 Pi JSONL。
 */
function migrateRetiredClaudeRuntime(index: AgentSessionsIndex): boolean {
  let changed = false
  const treatMissingRuntimeAsLegacy = index.version < INDEX_VERSION
  for (const session of index.sessions) {
    const raw = session as AgentSessionMeta & { agentRuntime?: unknown }
    const runtime = raw.agentRuntime

    // Pi records written by the previous dual-runtime version keep their artifact.
    if (runtime === 'pi') {
      delete raw.agentRuntime
      changed = true
      continue
    }
    if (session.legacyTranscript?.sourceRuntime === 'claude') continue
    // New Pi-only records intentionally have no runtime field. Only pre-v2 absence means
    // legacy Claude, whose artifacts are not interoperable with Pi.
    if (runtime === undefined && !treatMissingRuntimeAsLegacy) continue

    session.legacyTranscript = { sourceRuntime: 'claude', continuationRequired: true }
    delete raw.agentRuntime
    session.sdkSessionId = undefined
    session.piSessionFile = undefined
    session.piEntryBindings = undefined
    delete (raw as { forkSourceSdkSessionId?: unknown }).forkSourceSdkSessionId
    delete (raw as { resumeAtMessageUuid?: unknown }).resumeAtMessageUuid
    changed = true
  }
  return changed
}

/**
 * 读取会话索引文件
 */
function readIndex(): AgentSessionsIndex {
  const indexPath = getAgentSessionsIndexPath()
  const data = readJsonFileSafe<AgentSessionsIndex>(indexPath)
  if (data) {
    const permissionModeMigrated = migrateLegacyPermissionMode(data)
    const thinkingDefaultMigrated = migrateLegacyOpenAIThinkingDefault(data)
    const thinkingFieldMigrated = migrateThinkingLevelField(data)
    const messageCountMigrated = migrateMessageCountBackfill(data)
    const claudeRuntimeMigrated = migrateRetiredClaudeRuntime(data)
    if (permissionModeMigrated || thinkingDefaultMigrated || thinkingFieldMigrated || messageCountMigrated || claudeRuntimeMigrated) {
      writeIndex(data)
      if (permissionModeMigrated) {
        console.log('[Agent 会话] 已迁移历史权限模式 auto → bypassPermissions')
      }
      if (thinkingDefaultMigrated) {
        console.log('[Agent 会话] 已将历史会话的思考深度默认值升级为高')
      }
      if (messageCountMigrated) {
        console.log('[Agent 会话] 已为历史任务会话补齐消息计数')
      }
      if (claudeRuntimeMigrated) {
        console.log('[Agent 会话] 已迁移退役 Claude runtime 会话为只读（Pi-only）')
      }
    }
    return data
  }
  return {
    version: INDEX_VERSION,
    sessions: [],
    // 新索引不包含需要升级的历史会话，避免将用户主动选择的 off 误判为旧版默认值。
    openAIThinkingDefaultEnabledMigrationCompleted: true,
  }
}

/**
 * 写入会话索引文件
 */
function writeIndex(index: AgentSessionsIndex): void {
  const indexPath = getAgentSessionsIndexPath()

  try {
    writeJsonFileAtomic(indexPath, index)
  } catch (error) {
    console.error('[Agent 会话] 写入索引文件失败:', error)
    throw new Error('写入 Agent 会话索引失败')
  }
}

export type AgentSessionListScope = 'active' | 'archived' | 'all'

/**
 * 获取会话（按 updatedAt 降序）。主进程内部默认 all；renderer 应显式请求 active，
 * 归档列表仅在用户打开归档视图时按需读取。
 */
export function listAgentSessions(scope: AgentSessionListScope = 'all'): AgentSessionMeta[] {
  const index = readIndex()
  return index.sessions
    .filter((session) => scope === 'all' || (scope === 'archived' ? !!session.archived : !session.archived))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/** 仅返回列表标识数量，避免为归档入口 IPC 传输完整历史元数据。 */
export function getAgentSessionCounts(): { active: number; archived: number } {
  return readIndex().sessions.reduce(
    (counts, session) => {
      if (session.archived) counts.archived++
      else counts.active++
      return counts
    },
    { active: 0, archived: 0 },
  )
}

/**
 * 获取单个会话的元数据
 */
export function getAgentSessionMeta(id: string): AgentSessionMeta | undefined {
  const index = readIndex()
  return index.sessions.find((s) => s.id === id)
}

/** 缺少标记的存量会话必须保持升级前的私有 workbench cwd。 */
export function getAgentCwdMode(meta?: Pick<AgentSessionMeta, 'agentCwdMode'>): AgentCwdMode {
  return meta?.agentCwdMode ?? 'session'
}

/** 只接受仍存在的绝对目录；Git 归属校验由调用主进程在启动 Agent 前完成。 */
export function getActiveWorktreePath(
  meta?: Pick<AgentSessionMeta, 'activeWorktree'>,
): string | undefined {
  const activeWorktree = meta?.activeWorktree
  if (!activeWorktree?.path || !isAbsolute(activeWorktree.path)) return undefined
  try {
    return statSync(activeWorktree.path).isDirectory() ? activeWorktree.path : undefined
  } catch {
    return undefined
  }
}

/** 缺少标记的历史会话继续使用 `.context/`，避免失效的计划和工具历史路径。 */
export function getSessionWorkbenchLayout(
  meta?: Pick<AgentSessionMeta, 'sessionWorkbenchLayout'>,
): SessionWorkbenchLayout {
  return meta?.sessionWorkbenchLayout ?? 'legacy-context'
}

/** 会话私有资料目录；新布局直接使用 workbench 根，旧布局保留 `.context/`。 */
export function resolveSessionWorkbenchContextDir(
  workspace: Pick<AgentWorkspace, 'slug'> | undefined,
  sessionId: string,
  layout?: SessionWorkbenchLayout,
): string | undefined {
  if (!workspace) return undefined
  const sessionDir = getAgentSessionWorkspacePath(workspace.slug, sessionId)
  return layout === 'root' ? sessionDir : join(sessionDir, '.context')
}

/** Agent 运行 cwd 与 MyYoda 会话 sidecar 工作台目录解析。 */
export function resolveAgentCwd(
  workspace: Pick<AgentWorkspace, 'slug'> | undefined,
  sessionId: string,
  agentCwdMode?: AgentCwdMode,
  activeWorktree?: AgentActiveWorktree,
): string | undefined {
  if (!workspace) return undefined
  const activeWorktreePath = getActiveWorktreePath({ activeWorktree })
  if (activeWorktreePath) return activeWorktreePath
  return getAgentCwdMode({ agentCwdMode }) === 'project'
    ? getWorkspaceFilesDir(workspace.slug)
    : getAgentSessionWorkspacePath(workspace.slug, sessionId)
}

export function resolveAgentWorkbenchDir(
  workspace: Pick<AgentWorkspace, 'slug'> | undefined,
  sessionId: string,
): string | undefined {
  if (!workspace) return undefined
  return getAgentSessionWorkspacePath(workspace.slug, sessionId)
}
/**
 * 创建新会话
 */
export function createAgentSession(
  title?: string,
  channelId?: string,
  workspaceId?: string,
  modelId?: string,
  agentCwdMode?: 'session' | 'project',
): AgentSessionMeta {
  const index = readIndex()
  const now = Date.now()

  const meta: AgentSessionMeta = {
    id: randomUUID(),
    title: title || '新 Agent 会话',
    channelId,
    modelId,
    workspaceId,
    // 新会话遵循「优先使用绑定 Project 工作目录」语义；历史会话字段缺失按 'session' 解释。
    agentCwdMode: workspaceId ? agentCwdMode ?? 'project' : undefined,
    // 思考深度留空 = 未设置：由运行期解析链决定生效值（编码优化开关 → max，否则 defaultThinkingLevel）。
    // 注意：历史实现曾在此写入默认档（high），导致所有会话都有 sticky 值、开关永远无法覆盖。
    // 用户显式调整后仍会写入（updateAgentSessionMeta → sessionThinkingLevelPatch），会话级优先语义不变。
    createdAt: now,
    updatedAt: now,
  }

  index.sessions.push(meta)
  writeIndex(index)

  // 确保消息目录存在
  getAgentSessionsDir()

  // 若有工作区，创建 session 级别子文件夹并初始化 .claude / .context
  if (workspaceId) {
    const ws = getAgentWorkspace(workspaceId)
    if (ws) {
      const sessionDir = getAgentSessionWorkspacePath(ws.slug, meta.id)

      // 初始化 .claude/settings.json（plansDirectory → .context）
      const claudeDir = join(sessionDir, '.claude')
      if (!existsSync(claudeDir)) mkdirSync(claudeDir, { recursive: true })
      const settingsPath = join(claudeDir, 'settings.json')
      let sdkSettings: Record<string, unknown> = {}
      try {
        sdkSettings = JSON.parse(readFileSync(settingsPath, 'utf-8'))
      } catch { /* 文件不存在或解析失败 */ }
      let needsWrite = false
      if (sdkSettings.plansDirectory !== '.context') {
        sdkSettings.plansDirectory = '.context'
        needsWrite = true
      }
      if (sdkSettings.skipWebFetchPreflight !== true) {
        sdkSettings.skipWebFetchPreflight = true
        needsWrite = true
      }
      const autoMemoryDirectory = getWorkspaceAutoMemoryDir(ws.slug)
      if (sdkSettings.autoMemoryDirectory !== autoMemoryDirectory) {
        sdkSettings.autoMemoryDirectory = autoMemoryDirectory
        needsWrite = true
      }
      if (needsWrite) {
        writeFileSync(settingsPath, JSON.stringify(sdkSettings, null, 2))
      }

      // 初始化 .context/ 目录
      const contextDir = join(sessionDir, '.context')
      if (!existsSync(contextDir)) mkdirSync(contextDir, { recursive: true })
    }
  }

  console.log(`[Agent 会话] 已创建会话: ${meta.title} (${meta.id})`)
  return meta
}

/**
 * 读取会话的所有消息
 */
export function getAgentSessionMessages(id: string): AgentMessage[] {
  const filePath = getAgentSessionMessagesPath(id)

  if (!existsSync(filePath)) {
    return []
  }

  try {
    const raw = readFileSync(filePath, 'utf-8')
    const lines = raw.split('\n').filter((line) => line.trim())
    return parseJsonlLenient<AgentMessage>(lines, `读取会话消息 (${id})`)
  } catch (error) {
    console.error(`[Agent 会话] 读取消息失败 (${id}):`, error)
    return []
  }
}

/**
 * 追加一条消息到会话的 JSONL 文件
 */
export function appendAgentMessage(id: string, message: AgentMessage): void {
  const filePath = getAgentSessionMessagesPath(id)

  try {
    const line = JSON.stringify(message) + '\n'
    appendFileSync(filePath, line, 'utf-8')

    // 追加消息时更新 updatedAt，若已归档则自动恢复活跃
    const index = readIndex()
    const idx = index.sessions.findIndex((s) => s.id === id)
    if (idx !== -1) {
      const session = index.sessions[idx]!
      session.updatedAt = Date.now()
      if (session.archived) session.archived = false
      writeIndex(index)
    }
  } catch (error) {
    console.error(`[Agent 会话] 追加消息失败 (${id}):`, error)
    throw new Error('追加 Agent 消息失败')
  }
}

/** 单条 SDKMessage 序列化后最大长度（UTF-16 code units，超出则截断内容） */
const MAX_SDK_MESSAGE_LENGTH = 256 * 1024 // ~256K chars
/** 截断后保留的预览文本长度 */
const TRUNCATED_PREVIEW_LENGTH = 2000

/**
 * 追加 SDKMessage 到会话的 JSONL 文件（Phase 4 新持久化格式）
 *
 * 每条 SDKMessage 单独一行 JSON。读取时通过 `type` 字段区分新旧格式。
 * 超过 256K chars 的消息会被自动截断以防止存储膨胀。
 */
export function appendSDKMessages(id: string, messages: SDKMessage[]): void {
  if (messages.length === 0) return

  // 删除/级联删除后的迟到流事件不得重新创建孤儿 JSONL；先确认会话仍在索引中。
  const sessionExists = readIndex().sessions.some((session) => session.id === id)
  if (!sessionExists) {
    throw new Error(`Agent 会话不存在，禁止追加消息: ${id}`)
  }

  const filePath = getAgentSessionMessagesPath(id)

  try {
    for (const message of messages) {
      appendFileSync(filePath, serializeSDKMessageForStorage(message) + '\n', 'utf-8')
    }
  } catch (error) {
    console.error(`[Agent 会话] 追加 SDKMessage 失败 (${id}):`, error)
    throw new Error('追加 SDKMessage 失败')
  }

  // 看板卡片右下角消息数徽标（对齐 craft）走增量计数，避免渲染时重新读整份 JSONL。
  // 独立 try/catch：计数更新失败不影响消息本身已经落盘成功。
  try {
    const index = readIndex()
    const idx = index.sessions.findIndex((s) => s.id === id)
    if (idx !== -1) {
      const session = index.sessions[idx]!
      session.messageCount = (session.messageCount ?? 0) + messages.length
      writeIndex(index)
    }
  } catch (error) {
    console.error(`[Agent 会话] 更新消息计数失败 (${id}):`, error)
  }
}

/**
 * 截断超大 SDKMessage 的内容，保留元数据结构。
 * 处理三类膨胀源：超长 text block、超大 tool_result、内嵌 base64 图片。
 */
function sanitizeOversizedMessage(msg: SDKMessage, originalLength: number): SDKMessage {
  const truncationNote = `\n[内容已截断: 原始 ${(originalLength / 1024).toFixed(0)}K chars 超出存储限制]`
  const truncationThreshold = MAX_SDK_MESSAGE_LENGTH / 2

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clone: any = JSON.parse(JSON.stringify(msg))
  const content = clone.message?.content
  if (Array.isArray(content)) {
    for (let i = 0; i < content.length; i++) {
      const block = content[i]
      if (!block || typeof block !== 'object') continue

      // 截断超长 text block
      if (block.type === 'text' && typeof block.text === 'string' && block.text.length > truncationThreshold) {
        block.text = block.text.slice(0, TRUNCATED_PREVIEW_LENGTH) + truncationNote
      }

      // 截断超大 tool_result
      if (block.type === 'tool_result') {
        if (typeof block.content === 'string' && block.content.length > truncationThreshold) {
          block.content = block.content.slice(0, TRUNCATED_PREVIEW_LENGTH) + truncationNote
        }
        // 剥离 base64 图片数据
        if (Array.isArray(block.content)) {
          block.content = block.content.map((item: Record<string, unknown>) => {
            if (item?.type === 'image' && (item.source as Record<string, unknown>)?.data) {
              const dataLen = String((item.source as Record<string, unknown>).data).length
              return { type: 'image', _truncated: true, _originalLength: dataLen }
            }
            return item
          })
        }
      }
    }
  }

  // 截断 error.message
  if (clone.error && typeof clone.error === 'object' && typeof clone.error.message === 'string' && clone.error.message.length > truncationThreshold) {
    clone.error.message = clone.error.message.slice(0, TRUNCATED_PREVIEW_LENGTH) + truncationNote
  }

  return clone as SDKMessage
}

/**
 * 读取会话的所有 SDKMessage（兼容旧 AgentMessage 格式）
 *
 * 旧格式（有 `role` 字段）会被转换为近似的 SDKMessage。
 * 新格式（有 `type` 字段）直接返回。
 *
 * 注意：整文件读取。上下文回填请用 getRecentAgentSessionSDKMessages，避免大会话 OOM。
 */
export function getAgentSessionSDKMessages(id: string): SDKMessage[] {
  const filePath = getAgentSessionMessagesPath(id)

  if (!existsSync(filePath)) {
    return []
  }

  try {
    const raw = readFileSync(filePath, 'utf-8')
    const lines = raw.split('\n').filter((line) => line.trim())
    return parseJsonlLenient<unknown>(lines, `读取 SDKMessage (${id})`).map(normalizePersistedSDKMessage)
  } catch (error) {
    console.error(`[Agent 会话] 读取 SDKMessage 失败 (${id}):`, error)
    return []
  }
}

/** 上下文回填默认最多从文件尾部读取的字节数（约覆盖最近数十条消息） */
export const CONTEXT_BACKFILL_MAX_BYTES = 2 * 1024 * 1024

/** 渲染器首次展示的历史消息上限；更早历史由用户按需向前加载。 */
const AGENT_SESSION_MESSAGE_PAGE_SIZE = 400
const AGENT_SESSION_MESSAGE_PAGE_MAX_SIZE = 500
const AGENT_SESSION_MESSAGE_READ_CHUNK_SIZE = 64 * 1024

export interface AgentSessionSDKMessagesPage {
  messages: SDKMessage[]
  /** 下一页的文件字节上界；缺失表示已经到达文件开头。 */
  nextBefore?: number
}

interface JsonlTailLine {
  line: string
  start: number
}

/**
 * 从 JSONL 尾部按行读取，避免打开长会话时把整份 transcript 读入主进程和 IPC。
 *
 * 返回的行按文件原始顺序排列；`nextBefore` 可直接作为下一次请求的 before。
 */
function readJsonlTailLines(filePath: string, before: number | undefined, limit: number): {
  lines: JsonlTailLine[]
  hasMore: boolean
} {
  const fileSize = statSync(filePath).size
  let position = Math.min(Math.max(before ?? fileSize, 0), fileSize)
  let trailing = Buffer.alloc(0)
  const newestFirst: JsonlTailLine[] = []
  const fileDescriptor = openSync(filePath, 'r')

  try {
    while (position > 0 && newestFirst.length <= limit) {
      const chunkSize = Math.min(AGENT_SESSION_MESSAGE_READ_CHUNK_SIZE, position)
      position -= chunkSize
      const chunk = Buffer.allocUnsafe(chunkSize)
      readSync(fileDescriptor, chunk, 0, chunkSize, position)

      const combined = Buffer.concat([chunk, trailing])
      let lineEnd = combined.length
      for (let index = combined.length - 1; index >= 0 && newestFirst.length <= limit; index--) {
        if (combined[index] !== 0x0a) continue
        const lineBuffer = combined.subarray(index + 1, lineEnd)
        if (lineBuffer.toString('utf-8').trim()) {
          newestFirst.push({
            line: lineBuffer.toString('utf-8'),
            start: position + index + 1,
          })
        }
        lineEnd = index
      }
      trailing = combined.subarray(0, lineEnd)
    }

    if (newestFirst.length <= limit && position === 0 && trailing.toString('utf-8').trim()) {
      newestFirst.push({ line: trailing.toString('utf-8'), start: 0 })
    }
  } finally {
    closeSync(fileDescriptor)
  }

  const pageNewestFirst = newestFirst.slice(0, limit)
  return {
    lines: pageNewestFirst.reverse(),
    hasMore: newestFirst.length > limit,
  }
}

/**
 * 分页读取会话历史。默认只读取最后 400 条 JSONL 记录，避免长会话阻塞主进程与 renderer。
 */
export function getAgentSessionSDKMessagesPage(
  id: string,
  input: { before?: number; limit?: number } = {},
): AgentSessionSDKMessagesPage {
  const filePath = getAgentSessionMessagesPath(id)
  if (!existsSync(filePath)) return { messages: [] }

  const limit = Math.min(
    Math.max(Math.floor(input.limit ?? AGENT_SESSION_MESSAGE_PAGE_SIZE), 1),
    AGENT_SESSION_MESSAGE_PAGE_MAX_SIZE,
  )

  try {
    const { lines, hasMore } = readJsonlTailLines(filePath, input.before, limit)
    const messages = parseJsonlLenient<unknown>(
      lines.map((item) => item.line),
      `分页读取 SDKMessage (${id})`,
    ).map(normalizePersistedSDKMessage)
    const earliestLine = lines[0]
    return {
      messages,
      nextBefore: hasMore && earliestLine ? earliestLine.start : undefined,
    }
  } catch (error) {
    console.error(`[Agent 会话] 分页读取 SDKMessage 失败 (${id}):`, error)
    return { messages: [] }
  }
}

/**
 * 仅读取会话 JSONL 尾部并解析，供 buildContextPrompt 等「只要最近 N 条」的场景。
 * 超过 maxBytes 时丢掉可能被截断的首行，避免整文件进内存。
 */
export function getRecentAgentSessionSDKMessages(
  id: string,
  maxBytes: number = CONTEXT_BACKFILL_MAX_BYTES,
): SDKMessage[] {
  const filePath = getAgentSessionMessagesPath(id)
  if (!existsSync(filePath)) {
    return []
  }

  try {
    const size = statSync(filePath).size
    let raw: string
    if (size <= maxBytes) {
      raw = readFileSync(filePath, 'utf-8')
    } else {
      const fd = openSync(filePath, 'r')
      try {
        const buf = Buffer.alloc(maxBytes)
        readSync(fd, buf, 0, maxBytes, size - maxBytes)
        const text = buf.toString('utf-8')
        const nl = text.indexOf('\n')
        raw = nl >= 0 ? text.slice(nl + 1) : text
      } finally {
        closeSync(fd)
      }
    }
    const lines = raw.split('\n').filter((line) => line.trim())
    return parseJsonlLenient<unknown>(lines, `尾部读取 SDKMessage (${id})`).map(normalizePersistedSDKMessage)
  } catch (error) {
    console.error(`[Agent 会话] 尾部读取 SDKMessage 失败 (${id}):`, error)
    return []
  }
}

/**
 * convertLegacyMessage 已迁移至 @myyoda/session-core（本文件从该包 import 使用）。
 */

/**
 * 更新会话元数据
 */
export type AgentSessionMetaUpdates = Partial<Pick<AgentSessionMeta, 'title' | 'titleSource' | 'channelId' | 'modelId' | 'sdkSessionId' | 'piSessionFile' | 'piEntryBindings' | 'codexFastMode' | 'reasoningLevel' | 'thinkingLevel' | 'openAIThinkingLevel' | 'workspaceId' | 'activeWorktree' | 'pinned' | 'starred' | 'archived' | 'attachedDirectories' | 'attachedFiles' | 'forkSourceDir' | 'forkSourceSdkSessionId' | 'resumeAtMessageUuid' | 'stoppedByUser' | 'sessionStatus' | 'permissionMode' | 'completedButUnconfirmed' | 'sourceAutomationId' | 'automationGraduated' | 'parentSessionId' | 'rootSessionId' | 'sourceDelegationId' | 'delegationRole' | 'delegationStatus' | 'delegationDepth' | 'delegationGoal' | 'projectId' | 'agentCwdMode' | 'activeWorktree' | 'customGroupId' | 'workingDirectory' | 'gitRepoPath' | 'gitBranch' | 'gitExecutionMode' | 'gitWorktreePath' | 'gitBaseRef' | 'kanbanColumn' | 'taskSlug' | 'taskRunId' | 'taskNodeId' | 'taskAttempt' | 'taskCorrelationKey' | 'taskNodeCount' | 'taskDraft' | 'labelIds'>>

export function updateAgentSessionMeta(
  id: string,
  updates: AgentSessionMetaUpdates,
): AgentSessionMeta {
  const index = readIndex()
  const idx = index.sessions.findIndex((s) => s.id === id)

  if (idx === -1) {
    throw new Error(`Agent 会话不存在: ${id}`)
  }

  const existing = index.sessions[idx]!
  const updateKeys = Object.keys(updates)
  // 星标只是侧栏的视觉标记，不应改变会话的新鲜度或归档状态。
  const isStarredOnly = updateKeys.every((key) => key === 'starred')
  const isLabelsOnly = updateKeys.every((key) => key === 'labelIds')
  // 非手动归档操作时，若会话已归档则自动恢复为活跃（labelIds 和 stoppedByUser 和 starred 不触发解归档）
  const isStoppedByUserOnly = updateKeys.every((key) => key === 'stoppedByUser')
  const autoUnarchive = existing.archived && !('archived' in updates) && !isStoppedByUserOnly && !isStarredOnly && !isLabelsOnly

  // 思考等级双写：任一字段更新时同步 thinkingLevel ↔ openAIThinkingLevel
  const thinkingPatch = (() => {
    const nextLevel = updates.reasoningLevel ?? updates.thinkingLevel ?? updates.openAIThinkingLevel
    if (nextLevel === undefined) return undefined
    return sessionThinkingLevelPatch(nextLevel)
  })()

  const updated: AgentSessionMeta = {
    ...existing,
    ...updates,
    ...thinkingPatch,
    ...(autoUnarchive ? { archived: false } : {}),
    updatedAt: (isStarredOnly || isLabelsOnly) ? existing.updatedAt : Date.now(),
  }

  index.sessions[idx] = updated
  writeIndex(index)

  console.log(`[Agent 会话] 已更新会话: ${updated.title} (${updated.id})`)
  return updated
}

/** 更新 Conductor 运行状态，不修改会话标题。 */
export function setSessionStatus(id: string, status: string): AgentSessionMeta {
  return updateAgentSessionMeta(id, { sessionStatus: status })
}

/** 更新会话看板列；传入 null 时清除列值。 */
export function setKanbanColumn(id: string, column: string | null): AgentSessionMeta {
  return updateAgentSessionMeta(id, { kanbanColumn: column ?? undefined })
}

/** 更新 Conductor 节点总数。 */
export function setTaskNodeCount(id: string, count: number): AgentSessionMeta {
  return updateAgentSessionMeta(id, { taskNodeCount: count })
}

/** 更新会话所属项目 ID。 */
export function setSessionProjectId(id: string, projectId: string): AgentSessionMeta {
  return updateAgentSessionMeta(id, { projectId })
}

/**
 * 在任何工作区级级联副作用前，确认会话关联的 Worktree 可以安全删除。
 */
export function assertAgentSessionDeletionSafe(id: string, requireWorktreeClean = false): void {
  const index = readIndex()
  const candidate = index.sessions.find((session) => session.id === id)
  if (!candidate) return

  // 先检查所有会话级 recovery roots，Workspace cascade 才能在任何 Session 副作用前 fail closed。
  assertRecoveryRootSafe(getAgentSessionsDir())
  if (candidate.workspaceId) {
    const workspace = getAgentWorkspace(candidate.workspaceId)
    if (workspace) assertRecoveryRootSafe(getAgentWorkspacePath(workspace.slug))
  }
  const sdkSessionIds = [candidate.sdkSessionId, candidate.forkSourceSdkSessionId].filter(Boolean)
  if (sdkSessionIds.length > 0) assertRecoveryRootSafe(getSdkConfigDir())

  if (!candidate.gitWorktreePath || !candidate.gitRepoPath) return
  const stillReferenced = index.sessions.some((session) => session.id !== id && session.gitWorktreePath === candidate.gitWorktreePath)
  if (requireWorktreeClean || !stillReferenced) assertWorktreeClean(candidate.gitWorktreePath)
}

/**
 * 删除会话
 */
function restoreQuarantinedSessionArtifacts(records: RecoveryTrashRecord[]): Error[] {
  const errors: Error[] = []
  for (const record of records.slice().reverse()) {
    if (existsSync(record.sourcePath) || !existsSync(record.quarantinePath)) continue
    try {
      renameWithRetry(record.quarantinePath, record.sourcePath)
    } catch (error) {
      const restoreError = error instanceof Error ? error : new Error(String(error))
      errors.push(restoreError)
      console.error(`[Agent 会话] 恢复隔离文件失败 (${record.sourcePath}):`, restoreError)
    }
  }
  return errors
}

function restoreDeletedSessionIndex(originalSessions: AgentSessionMeta[]): void {
  const current = readIndex()
  current.sessions = originalSessions
  writeIndex(current)
}

export function deleteAgentSession(id: string): void {
  const index = readIndex()
  const idx = index.sessions.findIndex((s) => s.id === id)

  if (idx === -1) {
    console.warn(`[Agent 会话] 会话不存在，跳过删除: ${id}`)
    return
  }

  assertAgentSessionDeletionSafe(id)

  const originalSessions = [...index.sessions]
  const removed = index.sessions.splice(idx, 1)[0]!
  writeIndex(index)

  // Session 的消息、工作目录和 SDK 关联数据都进入同卷 recovery journal；任何一步失败都
  // 保留源文件并恢复索引，避免 Renderer 把部分删除误报为成功。
  const recoveryRecords: RecoveryTrashRecord[] = []
  const rollbackSessionDeletion = (error: unknown): never => {
    const restoreErrors = restoreQuarantinedSessionArtifacts(recoveryRecords)
    if (restoreErrors.length > 0) {
      // 恢复不完整时不要恢复索引，否则会制造“索引存在但源文件缺失”的假成功状态；
      // 隔离目录和 operation journal 仍保留，后续可人工恢复。
      throw new Error(`会话删除失败且恢复未完成，已保留 recovery 隔离记录: ${id}`, {
        cause: restoreErrors[0] ?? error,
      })
    }
    try {
      restoreDeletedSessionIndex(originalSessions)
    } catch (restoreError) {
      console.error(`[Agent 会话] 删除失败后恢复会话索引失败 (${id}):`, restoreError)
    }
    throw error
  }

  try {
    const filePath = getAgentSessionMessagesPath(id)
    if (existsSync(filePath)) {
      recoveryRecords.push(quarantineForRecovery(getAgentSessionsDir(), filePath, 'session', id))
    }

    if (removed.workspaceId) {
      const ws = getAgentWorkspace(removed.workspaceId)
      if (ws) {
        // 不调用 getAgentSessionWorkspacePath：该 helper 会为缺失目录创建目录，删除流程不应
        // 因读取而产生新的用户文件。
        const sessionDir = join(getAgentWorkspacePath(ws.slug), id)
        if (existsSync(sessionDir)) {
          recoveryRecords.push(quarantineForRecovery(getAgentWorkspacePath(ws.slug), sessionDir, 'session', id))
        }
      }
    }

    const sdkSessionIds = [removed.sdkSessionId, removed.forkSourceSdkSessionId].filter(Boolean) as string[]
    if (sdkSessionIds.length > 0) {
      const sdkConfigDir = getSdkConfigDir()
      const fileHistoryDir = join(sdkConfigDir, 'file-history')
      for (const sid of sdkSessionIds) {
        const histDir = join(fileHistoryDir, sid)
        if (existsSync(histDir)) {
          recoveryRecords.push(quarantineForRecovery(sdkConfigDir, histDir, 'session', id))
        }
      }

      const projectsDir = join(sdkConfigDir, 'projects')
      if (existsSync(projectsDir)) {
        for (const hashDir of readdirSync(projectsDir)) {
          const projPath = join(projectsDir, hashDir)
          for (const sid of sdkSessionIds) {
            const sessionFile = join(projPath, `${sid}.jsonl`)
            if (existsSync(sessionFile)) {
              recoveryRecords.push(quarantineForRecovery(sdkConfigDir, sessionFile, 'session', id))
            }
          }
        }
      }
    }
  } catch (error) {
    rollbackSessionDeletion(error)
  }

  // Worktree 是最后一个破坏性步骤：只有所有可恢复文件都已成功 quarantine 后才调用 Git
  // 删除。若 Git 删除失败，rollback 会把已隔离文件移回原位并恢复 Session 索引。
  if (removed.gitWorktreePath && removed.gitRepoPath && existsSync(removed.gitWorktreePath)) {
    const stillReferenced = originalSessions.some((session) => session.id !== id && session.gitWorktreePath === removed.gitWorktreePath)
    if (!stillReferenced) {
      try {
        removeSessionWorktree(removed.gitRepoPath, removed.gitWorktreePath)
        console.log(`[Agent 会话] 已清理 Git Worktree: ${removed.gitWorktreePath}`)
      } catch (error) {
        rollbackSessionDeletion(error)
      }
    }
  }

  console.log(`[Agent 会话] 已删除会话: ${removed.title} (${removed.id})`)

  // 清理 Nano Banana 生图历史（仅内存缓存，不是用户源文件）。
  clearNanoBananaAgentHistory(id)
}

/**
 * 收集会话及其全部委派子会话。
 */
function collectSessionTreeIds(sessions: AgentSessionMeta[], sessionId: string): Set<string> {
  const ids = new Set<string>([sessionId])
  let changed = true

  while (changed) {
    changed = false
    for (const session of sessions) {
      if (ids.has(session.id)) continue
      // 仅收集协作委派子会话。parent/root 负责维护树结构，sourceDelegationId 负责限定来源。
      if (!session.sourceDelegationId) continue
      if (session.parentSessionId && ids.has(session.parentSessionId)) {
        ids.add(session.id)
        changed = true
        continue
      }
      if (session.rootSessionId === sessionId) {
        ids.add(session.id)
        changed = true
      }
    }
  }

  return ids
}

function moveSessionWorkspaceDir(session: AgentSessionMeta, targetWorkspaceSlug: string): void {
  if (!session.workspaceId) return

  const sourceWs = getAgentWorkspace(session.workspaceId)
  if (!sourceWs || sourceWs.slug === targetWorkspaceSlug) return

  const srcDir = join(getAgentWorkspacePath(sourceWs.slug), session.id)
  if (!existsSync(srcDir)) return

  const destDir = join(getAgentWorkspacePath(targetWorkspaceSlug), session.id)
  // 清理已存在的目标目录，防止 renameSync 抛出 ENOTEMPTY/EEXIST。
  if (existsSync(destDir)) {
    try {
      const contents = readdirSync(destDir)
      rmSyncWithRetry(destDir, { recursive: true, force: true })
      const reason = contents.length === 0 ? '空目标目录' : '非空目标目录（以源目录为准）'
      console.log(`[Agent 会话] 已清理${reason}: ${destDir}`)
    } catch (cleanupError) {
      console.warn('[Agent 会话] 清理目标目录失败，跳过目录迁移:', cleanupError)
      throw cleanupError
    }
  }

  // renameWithRetry：优先 renameSync（原子），跨设备或句柄占用时自动降级 cpSync + rmSyncWithRetry。
  renameWithRetry(srcDir, destDir)
  console.log(`[Agent 会话] 已移动工作目录: ${srcDir} → ${destDir}`)
}

/**
 * 迁移 Agent 会话到另一个工作区
 *
 * 操作步骤：
 * 1. 验证会话和目标工作区存在
 * 2. 收集目标会话及其委派子会话
 * 3. 移动会话工作目录到目标工作区
 * 4. 更新元数据（workspaceId + 清空 sdkSessionId）
 * 5. JSONL 消息文件保持原位（全局目录）
 */
export function moveSessionToWorkspace(sessionId: string, targetWorkspaceId: string): AgentSessionMeta {
  const index = readIndex()
  const idx = index.sessions.findIndex((s) => s.id === sessionId)
  if (idx === -1) {
    throw new Error(`Agent 会话不存在: ${sessionId}`)
  }

  const session = index.sessions[idx]!

  const targetWs = getAgentWorkspace(targetWorkspaceId)
  if (!targetWs) {
    throw new Error(`目标空间不存在: ${targetWorkspaceId}`)
  }

  const sessionTreeIds = collectSessionTreeIds(index.sessions, sessionId)
  const sessionsToMove = index.sessions.filter((item) => sessionTreeIds.has(item.id) && item.workspaceId !== targetWorkspaceId)
  if (sessionsToMove.length === 0) return session

  const now = Date.now()
  let updatedRoot = session
  let movedCount = 0

  for (let i = 0; i < index.sessions.length; i++) {
    const current = index.sessions[i]!
    if (!sessionTreeIds.has(current.id) || current.workspaceId === targetWorkspaceId) continue

    moveSessionWorkspaceDir(current, targetWs.slug)
    // 确保目标工作区下有 session 目录。
    getAgentSessionWorkspacePath(targetWs.slug, current.id)

    const updated: AgentSessionMeta = {
      ...current,
      workspaceId: targetWorkspaceId,
      // Pi artifact 与 entry bindings 都以原 cwd 为根；跨工作区复用会造成错误 resume/fork/rewind。
      sdkSessionId: undefined,
      piSessionFile: undefined,
      piEntryBindings: undefined,
      // 已切换到另一项目，不能沿用旧项目授权下选择的 worktree。
      activeWorktree: undefined,
      updatedAt: now,
    }
    index.sessions[i] = updated
    writeIndex(index)
    movedCount++
    if (current.id === sessionId) {
      updatedRoot = updated
    }
  }

  console.log(`[Agent 会话] 已迁移会话及子会话到工作区: ${updatedRoot.title}（${movedCount} 个）→ ${targetWs.name}`)
  return updatedRoot
}

/**
 * 迁移 Chat 对话记录到 Agent 会话
 *
 * 读取 Chat 对话的消息，转换为 AgentMessage 格式，
 * 追加到目标 Agent 会话的 JSONL 文件中。
 *
 * 仅迁移 user 和 assistant 角色的消息文本内容，
 * 工具活动、推理、附件等 Chat 特有字段不迁移。
 */
export function migrateChatToAgentSession(conversationId: string, agentSessionId: string): void {
  const chatMessages = getConversationMessages(conversationId)

  if (chatMessages.length === 0) {
    console.log(`[Agent 会话] Chat 对话无消息，跳过迁移 (${conversationId})`)
    return
  }

  let count = 0
  for (const cm of chatMessages) {
    // 仅迁移 user 和 assistant 消息
    if (cm.role !== 'user' && cm.role !== 'assistant') continue
    if (!cm.content.trim()) continue

    const agentMsg: AgentMessage = {
      id: randomUUID(),
      role: cm.role,
      content: cm.content,
      createdAt: cm.createdAt,
      model: cm.role === 'assistant' ? cm.model : undefined,
    }

    appendAgentMessage(agentSessionId, agentMsg)
    count++
  }

  console.log(`[Agent 会话] 已迁移 ${count} 条消息到 Agent 会话 (${conversationId} → ${agentSessionId})`)
}

/**
 * 分叉 Agent 会话（SDK 原生 fork）
 *
 * 直接调用 SDK 的 forkSession() 独立函数完成 JSONL 复制和 UUID 重映射，
 * 新会话立即获得 sdkSessionId，无需延迟到首次发消息。
 *
 * forkSourceDir 记录源会话的工作目录，仅作为元数据参考保留。
 * SDK session JSONL 已在 fork 创建时复制到新会话的 project-hash 目录下，
 * orchestrator 无需在运行时切换 cwd。
 *
 * process.env.CLAUDE_CONFIG_DIR 已在模块加载时设置，无需在此处临时修改。
 *
 * @returns 新创建的会话元数据
 */
export async function forkAgentSession(input: ForkSessionInput): Promise<AgentSessionMeta> {
  const { sessionId, upToMessageUuid } = input

  // 1. 获取源会话元数据
  const sourceMeta = getAgentSessionMeta(sessionId)
  if (!sourceMeta) {
    throw new Error(`源 Agent 会话不存在: ${sessionId}`)
  }

  if (sourceMeta.legacyTranscript?.continuationRequired) {
    throw new Error('历史 Claude transcript 为只读，不能分叉；请新建 Pi 会话继续')
  }

  if (!sourceMeta.sdkSessionId) {
    throw new Error('该会话没有 SDK session，无法分叉')
  }

  // Claude runtime 已于 2026-08 退役，Pi-only：所有 fork 一律走 Pi SessionManager。
  return forkPiAgentSession(sourceMeta, input)
}

async function forkPiAgentSession(sourceMeta: AgentSessionMeta, input: ForkSessionInput): Promise<AgentSessionMeta> {
  const targetUuid = input.upToMessageUuid
  if (!targetUuid) throw new Error('Pi 分叉需要指定一条已完成的 assistant 消息')
  const entryId = sourceMeta.piEntryBindings?.[targetUuid]
  if (!entryId) throw new Error('该 Pi 历史消息尚无 entry ID 映射，无法安全分叉；请在新版 MyYoda 中继续一次对话后再试')
  if (!sourceMeta.piSessionFile || !existsSync(sourceMeta.piSessionFile)) {
    throw new Error('未找到 Pi session artifact，无法安全分叉')
  }

  const forkModelId = input.modelId !== undefined
    ? assertEnabledModelForChannel({ channelId: sourceMeta.channelId, modelId: input.modelId, purpose: '分叉 Pi Agent 会话' })
    : sourceMeta.modelId
  const workspace = sourceMeta.workspaceId ? getAgentWorkspace(sourceMeta.workspaceId) : undefined
  const sourceCwdMode = getAgentCwdMode(sourceMeta)
  const sourceActiveWorktree = getActiveWorktreePath(sourceMeta) ? sourceMeta.activeWorktree : undefined
  const sourceDir = resolveAgentCwd(workspace, sourceMeta.id, sourceCwdMode, sourceActiveWorktree)
  const sourceWorkbenchDir = resolveAgentWorkbenchDir(workspace, sourceMeta.id)
  const newMeta = createAgentSession(
    `${sourceMeta.title} (fork)`,
    sourceMeta.channelId,
    sourceMeta.workspaceId,
    forkModelId,
    sourceCwdMode,
  )
  const sourceThinking = getSessionThinkingLevel(sourceMeta)
  if (sourceThinking) {
    updateAgentSessionMeta(newMeta.id, sessionThinkingLevelPatch(sourceThinking))
  }
  const destDir = resolveAgentCwd(workspace, newMeta.id, newMeta.agentCwdMode, sourceActiveWorktree)
  const destWorkbenchDir = resolveAgentWorkbenchDir(workspace, newMeta.id)

  try {
    const sdk = await import('@earendil-works/pi-coding-agent')
    const sessionDir = join(getSdkConfigDir(), 'sessions')
    const sourceManager = sdk.SessionManager.open(sourceMeta.piSessionFile, sessionDir, sourceDir)
    const branchFile = sourceManager.createBranchedSession(entryId)
    if (!branchFile || !existsSync(branchFile)) {
      throw new Error('Pi 未能生成分叉 session artifact')
    }
    const forkedManager = sdk.SessionManager.forkFrom(branchFile, destDir ?? sourceDir ?? process.cwd(), sessionDir)
    const piSessionFile = forkedManager.getSessionFile()
    if (!piSessionFile || !existsSync(piSessionFile)) throw new Error('Pi 分叉 artifact 校验失败')

    updateAgentSessionMeta(newMeta.id, {
      sdkSessionId: forkedManager.getSessionId(),
      piSessionFile,
      piEntryBindings: { ...(sourceMeta.piEntryBindings ?? {}) },
      activeWorktree: sourceActiveWorktree,
      forkSourceDir: sourceDir,
      // fork 继承源会话的 projectId，让新会话出现在左侧「项目」分组；
      // 同时固定 agentCwdMode='session'，保持 fork 独立沙箱目录语义。
      ...(sourceMeta.projectId ? { projectId: sourceMeta.projectId } : {}),
      agentCwdMode: 'session',
    })
    newMeta.sdkSessionId = forkedManager.getSessionId()
    newMeta.piSessionFile = piSessionFile
    newMeta.piEntryBindings = { ...(sourceMeta.piEntryBindings ?? {}) }
    newMeta.activeWorktree = sourceActiveWorktree
    if (sourceMeta.projectId) newMeta.projectId = sourceMeta.projectId
    newMeta.agentCwdMode = 'session'

    if (sourceDir && destDir) copyForkWorkspaceFiles(sourceDir, destDir)
    await copyForkStoredSDKMessages({
      sourceSessionId: sourceMeta.id,
      destSessionId: newMeta.id,
      upToMessageUuid: targetUuid,
      sourceDir,
      destDir,
    })
    return newMeta
  } catch (error) {
    // 尚未对外返回的新 session 可安全清理，避免留下会被侧栏打开的半成品。
    try { deleteAgentSession(newMeta.id) } catch { /* 保留原始错误 */ }
    throw error
  }
}

/** 将当前 Pi 会话切换到指定 assistant turn 的新 branch artifact（持久化回退）。 */
export async function rewindPiAgentSession(sessionId: string, assistantMessageUuid: string): Promise<void> {
  const meta = getAgentSessionMeta(sessionId)
  if (!meta) throw new Error('会话不存在')
  const entryId = meta.piEntryBindings?.[assistantMessageUuid]
  if (!entryId) throw new Error('该 Pi 历史消息尚无 entry ID 映射，无法安全回退')
  if (!meta.piSessionFile || !existsSync(meta.piSessionFile)) throw new Error('未找到 Pi session artifact，无法安全回退')
  const workspace = meta.workspaceId ? getAgentWorkspace(meta.workspaceId) : undefined
  const cwd = resolveAgentCwd(workspace, meta.id, meta.agentCwdMode, meta.activeWorktree) ?? process.cwd()
  const sdk = await import('@earendil-works/pi-coding-agent')
  const manager = sdk.SessionManager.open(meta.piSessionFile, join(getSdkConfigDir(), 'sessions'), cwd)
  const branchFile = manager.createBranchedSession(entryId)
  if (!branchFile || !existsSync(branchFile)) throw new Error('Pi 未能生成回退 session artifact')
  const rewindManager = sdk.SessionManager.open(branchFile, join(getSdkConfigDir(), 'sessions'), cwd)
  const retainedBindings = Object.fromEntries(
    Object.entries(meta.piEntryBindings ?? {}).filter(([, mappedEntryId]) => Boolean(rewindManager.getEntry(mappedEntryId))),
  )
  updateAgentSessionMeta(sessionId, {
    sdkSessionId: rewindManager.getSessionId(),
    piSessionFile: branchFile,
    piEntryBindings: retainedBindings,
  })
}

interface ForkStoredMessageRef {
  uuid: string
  sessionId?: string
}

interface ForkTargetResolution {
  effectiveUpToMessageUuid: string
  effectiveSdkSessionId?: string
  usedSidechainFallback: boolean
}

async function resolveForkTargetFromStoredMessages(
  sessionId: string,
  upToMessageUuid: string,
): Promise<ForkTargetResolution> {
  const filePath = getAgentSessionMessagesPath(sessionId)
  if (!existsSync(filePath)) {
    throw new Error('未在会话历史中找到指定的消息，可能消息已被清理或截断')
  }

  let lastMainlineAssistant: ForkStoredMessageRef | undefined
  let target: (ForkStoredMessageRef & {
    isSidechain: boolean
    fallbackMainline?: ForkStoredMessageRef
  }) | undefined

  for await (const msg of readStoredSDKMessages(filePath)) {
    const uuid = getStoredMessageUuid(msg)
    const isMainlineAssistant = msg.type === 'assistant'
      && !!uuid
      && !((msg as { parent_tool_use_id?: string | null }).parent_tool_use_id)

    if (uuid === upToMessageUuid) {
      target = {
        uuid,
        sessionId: (msg as { session_id?: string }).session_id,
        isSidechain: msg.type === 'assistant'
          && Boolean((msg as { parent_tool_use_id?: string | null }).parent_tool_use_id),
        fallbackMainline: lastMainlineAssistant,
      }
    }

    if (isMainlineAssistant) {
      lastMainlineAssistant = {
        uuid,
        sessionId: (msg as { session_id?: string }).session_id,
      }
    }
  }

  if (!target) {
    throw new Error('未在会话历史中找到指定的消息，可能消息已被清理或截断')
  }

  if (target.isSidechain) {
    if (!target.fallbackMainline) {
      throw new Error('选中的是子代理执行过程中的消息，且向前找不到可分叉的主对话消息')
    }
    return {
      effectiveUpToMessageUuid: target.fallbackMainline.uuid,
      effectiveSdkSessionId: target.fallbackMainline.sessionId,
      usedSidechainFallback: true,
    }
  }

  return {
    effectiveUpToMessageUuid: target.uuid,
    effectiveSdkSessionId: target.sessionId,
    usedSidechainFallback: false,
  }
}

interface CopyForkStoredSDKMessagesInput {
  sourceSessionId: string
  destSessionId: string
  upToMessageUuid?: string
  sourceDir?: string
  destDir?: string
}

async function copyForkStoredSDKMessages({
  sourceSessionId,
  destSessionId,
  upToMessageUuid,
  sourceDir,
  destDir,
}: CopyForkStoredSDKMessagesInput): Promise<number> {
  const sourcePath = getAgentSessionMessagesPath(sourceSessionId)
  if (!existsSync(sourcePath)) return 0

  const destPath = getAgentSessionMessagesPath(destSessionId)
  const out = createWriteStream(destPath, { flags: 'a', encoding: 'utf-8' })
  let copiedCount = 0

  try {
    for await (const msg of readStoredSDKMessages(sourcePath)) {
      await writeJsonlLine(out, serializeSDKMessageForStorage(msg, sourceDir, destDir))
      copiedCount += 1

      if (upToMessageUuid && getStoredMessageUuid(msg) === upToMessageUuid) {
        break
      }
    }
    await endWriteStream(out)
  } catch (err) {
    out.destroy()
    throw err
  }

  return copiedCount
}

async function* readStoredSDKMessages(filePath: string): AsyncGenerator<SDKMessage> {
  const rl = createInterface({
    input: createReadStream(filePath),
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line)
      if ('role' in parsed && !('type' in parsed)) {
        yield convertLegacyMessage(parsed as AgentMessage)
      } else {
        yield parsed as SDKMessage
      }
    } catch (err) {
      console.warn(`[Agent 会话] 跳过无法解析的 SDKMessage 行 (${filePath}):`, err)
    }
  }
}

function getStoredMessageUuid(msg: SDKMessage): string | undefined {
  return 'uuid' in msg ? (msg as { uuid?: string }).uuid : undefined
}

function serializeSDKMessageForStorage(
  msg: SDKMessage,
  sourceDir?: string,
  destDir?: string,
): string {
  let serialized = JSON.stringify(msg)
  if (sourceDir && destDir) {
    serialized = rewriteSourceToDest(serialized, sourceDir, destDir)
  }
  if (serialized.length <= MAX_SDK_MESSAGE_LENGTH) return serialized

  let sanitized = JSON.stringify(sanitizeOversizedMessage(msg, serialized.length))
  if (sourceDir && destDir) {
    sanitized = rewriteSourceToDest(sanitized, sourceDir, destDir)
  }
  if (sanitized.length > MAX_SDK_MESSAGE_LENGTH) {
    console.warn(`[Agent 会话] 消息截断后仍超限 (${(sanitized.length / 1024).toFixed(0)}K chars)`)
  }
  return sanitized
}

async function copyTextFileWithPathRewrite(
  sourcePath: string,
  destPath: string,
  sourceDir: string,
  destDir: string,
): Promise<number> {
  const rl = createInterface({
    input: createReadStream(sourcePath),
    crlfDelay: Infinity,
  })
  const out = createWriteStream(destPath, { flags: 'w', encoding: 'utf-8' })
  let lineCount = 0

  try {
    for await (const line of rl) {
      await writeJsonlLine(out, rewriteSourceToDest(line, sourceDir, destDir))
      lineCount += 1
    }
    await endWriteStream(out)
  } catch (err) {
    out.destroy()
    throw err
  }

  return lineCount
}

async function writeJsonlLine(stream: WriteStream, line: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.write(line + '\n', (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

async function endWriteStream(stream: WriteStream): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.once('error', reject)
    stream.end(resolve)
  })
}

/**
 * 将一段字符串中所有出现的 sourceDir 替换为 destDir。
 *
 * 用于 fork 会话时把历史中嵌入的源会话绝对路径迁移到新会话目录。
 * 处理 JSON 字符串中可能出现的两种编码形式：
 * 1. 原始路径（如 /Users/a/b）
 * 2. JSON 字符串编码后的形式（路径中的 `/` JSON 标准下不会转义，所以通常与 1 一致；
 *    但保留对反斜杠的处理以兼容 Windows 路径）
 *
 * sourceDir 和 destDir 都会规范化去除末尾斜杠，避免不同形式导致漏替换。
 */
function rewriteSourceToDest(content: string, sourceDir: string, destDir: string): string {
  const normalizedSource = sourceDir.replace(/[\\/]+$/, '')
  const normalizedDest = destDir.replace(/[\\/]+$/, '')
  if (!normalizedSource || normalizedSource === normalizedDest) return content
  let rewritten = content.split(normalizedSource).join(normalizedDest)
  // Windows 路径在 JSON 中会被转义为双反斜杠，单独处理一次
  if (normalizedSource.includes('\\')) {
    const sourceEscaped = normalizedSource.replace(/\\/g, '\\\\')
    const destEscaped = normalizedDest.replace(/\\/g, '\\\\')
    rewritten = rewritten.split(sourceEscaped).join(destEscaped)
  }
  return rewritten
}

/**
 * 截断 Agent 会话的 SDK 消息到指定 UUID（inclusive）
 *
 * 保留 uuid 匹配消息及之前的所有消息，删除之后的消息。
 * 通过原子替换全量重写 JSONL 文件。
 *
 * @returns 截断后保留的消息列表
 */
export function truncateSDKMessages(id: string, upToUuidInclusive: string): SDKMessage[] {
  const filePath = getAgentSessionMessagesPath(id)
  if (!existsSync(filePath)) {
    throw new Error(`[Agent 会话] 截断失败: 会话消息文件不存在, sessionId=${id}`)
  }

  const raw = readFileSync(filePath, 'utf-8')
  const lines = raw.split('\n').filter((line) => line.trim())
  const messages = parseJsonlStrict<unknown>(lines, `截断读取 SDKMessage (${id})`).map(normalizePersistedSDKMessage)
  const cutIndex = messages.findIndex(
    (m) => 'uuid' in m && (m as { uuid?: string }).uuid === upToUuidInclusive,
  )
  if (cutIndex < 0) {
    throw new Error(`[Agent 会话] 截断失败: 未找到 uuid=${upToUuidInclusive}, sessionId=${id}`)
  }
  const kept = messages.slice(0, cutIndex + 1)

  const content = kept.map((m) => JSON.stringify(m)).join('\n') + (kept.length > 0 ? '\n' : '')
  writeTextFileAtomic(filePath, content)

  console.log(`[Agent 会话] 消息已截断: sessionId=${id}, 保留 ${kept.length}/${messages.length} 条`)
  return kept
}

/**
 * 删除指定 UUID 的持久化错误消息。
 *
 * 仅删除 assistant error，避免调用方误删普通回复；找不到时保持幂等。
 */
export function removeSDKErrorMessage(id: string, errorUuid: string): boolean {
  const filePath = getAgentSessionMessagesPath(id)
  if (!existsSync(filePath)) return false

  const raw = readFileSync(filePath, 'utf-8')
  const lines = raw.split('\n').filter((line) => line.trim())
  const messages = parseJsonlStrict<unknown>(lines, `删除错误消息 (${id})`).map(normalizePersistedSDKMessage)
  const targetIndex = messages.findIndex((message) =>
    message.type === 'assistant'
      && (message as { uuid?: string }).uuid === errorUuid
      && Boolean((message as { error?: unknown }).error),
  )
  if (targetIndex < 0) return false

  const kept = messages.filter((_, index) => index !== targetIndex)
  const content = kept.map((message) => JSON.stringify(message)).join('\n') + (kept.length > 0 ? '\n' : '')
  writeTextFileAtomic(filePath, content)
  console.log(`[Agent 会话] 已删除重试前错误: sessionId=${id}, uuid=${errorUuid}`)
  return true
}

/**
 * 从 SDK session JSONL 中查找指定 assistant message 之后最近的 user message UUID
 *
 * SDK session JSONL（~/.myyoda/sdk-config/projects/...）中的消息都带有 uuid，
 * 但 MyYoda 自己构造的 user message 没有 uuid。此函数直接读取 SDK 的 JSONL
 * 来解析 rewindFiles 所需的 user message UUID。
 *
 * 对于 fork 会话：MyYoda JSONL 中的 UUID 来自**源会话**（fork 时直接复制），
 * 而 forked SDK JSONL 中的 UUID 已被重映射。因此 fork 会话需要搜索**源**
 * SDK JSONL 来匹配 assistant UUID。通过 forkSourceSdkSessionId 参数指定。
 *
 * @param sdkSessionId SDK session UUID
 * @param assistantMessageUuid 要回退到的 assistant message UUID
 * @param projectDir SDK 项目目录路径（session 运行时的 cwd）
 * @param forkSourceSdkSessionId 源会话 SDK session ID（fork 会话时传入）
 * @returns user message UUID，找不到时返回 undefined
 */
export function resolveUserUuidFromSDK(
  sdkSessionId: string,
  assistantMessageUuid: string,
  projectDir?: string,
  forkSourceSdkSessionId?: string,
): string | undefined {
  // 优先搜索当前 session JSONL
  let sessionFilePath = findSdkSessionJsonl(sdkSessionId, projectDir)

  // 当前 session JSONL 中未找到 assistant UUID（作为消息 .uuid 字段）时，尝试源会话（fork 场景）
  let usingSourceSession = false
  if (sessionFilePath && forkSourceSdkSessionId) {
    try {
      const lines = readFileSync(sessionFilePath, 'utf-8').split('\n').filter(Boolean)
      const hasUuidAsField = lines.some((line) => {
        try {
          const m = JSON.parse(line)
          return m.uuid === assistantMessageUuid
        } catch { return false }
      })
      if (!hasUuidAsField) {
        // MyYoda JSONL 中的 UUID 来自源会话，forked JSONL 中已重映射
        const sourceFilePath = findSdkSessionJsonl(forkSourceSdkSessionId, projectDir)
        if (sourceFilePath) {
          console.log(`[Agent 会话] resolveUserUuid: fork 会话 UUID 不匹配（非 .uuid 字段），切换到源会话 ${forkSourceSdkSessionId}`)
          sessionFilePath = sourceFilePath
          usingSourceSession = true
        }
      }
    } catch { /* fall through to main logic */ }
  } else if (!sessionFilePath && forkSourceSdkSessionId) {
    // 当前 session JSONL 完全找不到，直接尝试源会话
    sessionFilePath = findSdkSessionJsonl(forkSourceSdkSessionId, projectDir)
    if (sessionFilePath) {
      usingSourceSession = true
      console.log(`[Agent 会话] resolveUserUuid: 当前 JSONL 未找到，使用源会话 ${forkSourceSdkSessionId}`)
    }
  }

  if (!sessionFilePath) {
    console.warn(`[Agent 会话] 未找到 SDK session JSONL: sdkSessionId=${sdkSessionId}`)
    return undefined
  }

  // 读取并解析 SDK JSONL
  try {
    const lines = readFileSync(sessionFilePath, 'utf-8').split('\n').filter(Boolean)
    const messages = parseJsonlStrict<Record<string, unknown>>(lines, `rewind 解析 SDK JSONL (${usingSourceSession ? '源会话' : '当前会话'})`)

    // 找到 assistant message 的位置
    const assistantIdx = messages.findIndex((m) => m.uuid === assistantMessageUuid)
    if (assistantIdx < 0) {
      console.warn(`[Agent 会话] SDK JSONL 中未找到 assistant uuid=${assistantMessageUuid}${usingSourceSession ? ' (源会话)' : ''}`)
      return undefined
    }

    // rewindFiles(userMessageId) 恢复文件到该 user message 发送时的快照状态。
    // 回退到某个 assistant turn = 恢复到"该 turn 完成后"的文件状态
    // = 下一轮用户消息发送时的快照（因为快照记录的是 user 消息发出时的文件状态，
    //   而 assistant turn 完成后到下一条 user 消息之间没有其他文件变化）。
    //
    // 策略：向后找第一条非 tool_result 的 user message。
    // 如果找不到（最后一个 turn），返回 '__LAST_TURN__' 特殊标记 —— 因为当前文件系统
    // 已经是最后一个 turn 完成后的状态，不需要文件回退。

    const isRealUserMessage = (m: Record<string, unknown>): boolean => {
      if (m.type !== 'user' || !m.uuid) return false
      const content = (m.message as { content?: Array<{ type: string }> } | undefined)?.content
      const hasToolResult = Array.isArray(content) && content.some((b) => b.type === 'tool_result')
      return !hasToolResult
    }

    // 向后找下一条真实 user message
    for (let i = assistantIdx + 1; i < messages.length; i++) {
      const m = messages[i]!
      if (isRealUserMessage(m)) {
        console.log(`[Agent 会话] 解析到下一轮 user uuid=${m.uuid} (assistant uuid=${assistantMessageUuid}${usingSourceSession ? ', 源会话' : ''})`)
        return m.uuid as string
      }
    }

    // 最后一个 turn — 当前文件系统已是该 turn 完成后的状态，无需文件回退
    console.log(`[Agent 会话] 最后一个 turn，无需文件回退 (assistant uuid=${assistantMessageUuid})`)
    return '__LAST_TURN__'
  } catch (err) {
    console.warn(`[Agent 会话] 读取 SDK session JSONL 失败:`, err)
    return undefined
  }
}

/**
 * 在 SDK 项目目录中查找指定 session 的 JSONL 文件。
 *
 * @param sdkSessionId SDK session ID
 * @param projectDir 项目目录（可选，优先在此目录的哈希下查找）
 * @returns JSONL 文件路径，找不到返回 undefined
 */
function findSdkSessionJsonl(sdkSessionId: string, _projectDir?: string): string | undefined {
  const sdkConfigDir = getSdkConfigDir()

  // 遍历所有项目目录查找匹配的 session JSONL
  // （SDK 的目录命名规则与 MyYoda 不完全一致，直接遍历最可靠）
  const projectsDir = join(sdkConfigDir, 'projects')
  if (existsSync(projectsDir)) {
    for (const dir of readdirSync(projectsDir)) {
      const candidate = join(projectsDir, dir, `${sdkSessionId}.jsonl`)
      if (existsSync(candidate)) return candidate
    }
  }

  return undefined
}

/** Node 20–25 均兼容的最小 path API；测试可注入 Windows 路径语义。 */
type RewindPathApi = {
  isAbsolute(path: string): boolean
  resolve(...pathSegments: string[]): string
  relative(from: string, to: string): string
  sep: string
}

const nativeRewindPathApi: RewindPathApi = { isAbsolute, resolve, relative, sep }

/**
 * 将快照中的路径解析为允许目录内的绝对路径。
 * pathApi 参数让 Windows 路径语义可以在非 Windows 平台上独立测试。
 */
export function resolveSafeRewindPath(
  filePath: string,
  cwd: string,
  attachedDirectories: string[] = [],
  pathApi: RewindPathApi = nativeRewindPathApi,
): string | undefined {
  const resolvedCwd = pathApi.resolve(cwd)
  const resolvedPath = pathApi.isAbsolute(filePath)
    ? pathApi.resolve(filePath)
    : pathApi.resolve(resolvedCwd, filePath)
  const allowedDirs = [resolvedCwd, ...attachedDirectories.map((dir) => pathApi.resolve(dir))]

  const isAllowed = allowedDirs.some((dir) => {
    const relativePath = pathApi.relative(dir, resolvedPath)
    return relativePath === '' || (
      relativePath !== '..'
      && !relativePath.startsWith(`..${pathApi.sep}`)
      && !pathApi.isAbsolute(relativePath)
    )
  })

  return isAllowed ? resolvedPath : undefined
}

/**
 * 直接从 SDK JSONL 的 file-history-snapshot 恢复文件到指定 user message 时的状态。
 *
 * 绕过 SDK 的 rewindFiles API（避免分支加载问题），直接：
 * 1. 读取 SDK JSONL 中的所有 file-history-snapshot
 * 2. 构建目标 user message 时的文件状态表
 * 3. 从 file-history 备份目录恢复文件
 *
 * 对于 fork 出的会话：resolveUserUuidFromSDK 已从源 SDK JSONL 解析出源空间的 user UUID，
 * 因此 userMessageUuid 可能在源 JSONL 中而非 forked JSONL 中。当在当前 JSONL 中找不到
 * 目标 UUID 时，自动 fallback 到源会话的 JSONL 和 file-history 备份。
 *
 * @param sdkSessionId  SDK session ID
 * @param userMessageUuid  目标 user message UUID（恢复到此时的文件状态）
 * @param cwd  会话工作目录（文件的基准路径）
 * @param projectDir  项目目录（可选，用于定位 SDK JSONL）
 * @param forkSourceSdkSessionId  源会话 SDK session ID（可选，fork 会话回退时使用）
 * @param attachedDirectories  附加的外部目录列表（绝对路径，SDK 会将这些目录下的文件以绝对路径记录在 snapshot 中）
 */
export function rewindFilesFromSnapshot(
  sdkSessionId: string,
  userMessageUuid: string,
  cwd: string,
  projectDir?: string,
  forkSourceSdkSessionId?: string,
  attachedDirectories?: string[],
): { canRewind: boolean; error?: string; filesChanged?: string[]; insertions?: number; deletions?: number } {
  const sdkConfigDir = getSdkConfigDir()

  // 1. 查找 SDK session JSONL（优先当前 session，找不到目标 UUID 时 fallback 到源会话）
  let sessionFilePath = findSdkSessionJsonl(sdkSessionId, projectDir)
  let effectiveSdkSessionId = sdkSessionId
  let isForkFallback = false

  // 2. 读取所有消息，构建到目标 user message 为止的文件状态
  try {
    let messages: Record<string, unknown>[] = []
    if (sessionFilePath) {
      const lines = readFileSync(sessionFilePath, 'utf-8').split('\n').filter(Boolean)
      messages = parseJsonlStrict<Record<string, unknown>>(lines, 'rewindFilesFromSnapshot 解析当前 JSONL')
    }

    // 找到目标 user message 的位置
    let targetIdx = messages.findIndex((m) => m.uuid === userMessageUuid)

    // Fork 场景：userMessageUuid 来自源会话（resolveUserUuidFromSDK 已做过 fallback），
    // 在 forked JSONL 中找不到 → 直接切换到源会话 JSONL
    if (targetIdx < 0 && forkSourceSdkSessionId) {
      console.log(`[Agent 会话] rewindFilesFromSnapshot: 目标 UUID 在当前 JSONL 中未找到，切换到源会话 ${forkSourceSdkSessionId}`)
      const sourceFilePath = findSdkSessionJsonl(forkSourceSdkSessionId, projectDir)
      if (!sourceFilePath) {
        return { canRewind: false, error: '未找到源会话 SDK session JSONL（fork 回退需要源会话数据）' }
      }
      const sourceLines = readFileSync(sourceFilePath, 'utf-8').split('\n').filter(Boolean)
      messages = parseJsonlStrict<Record<string, unknown>>(sourceLines, 'rewindFilesFromSnapshot 解析源会话 JSONL')
      targetIdx = messages.findIndex((m) => m.uuid === userMessageUuid)
      effectiveSdkSessionId = forkSourceSdkSessionId
      isForkFallback = true

      if (targetIdx < 0) {
        return { canRewind: false, error: `源会话 SDK JSONL 中也未找到 user message uuid=${userMessageUuid}` }
      }
      console.log(`[Agent 会话] rewindFilesFromSnapshot: 在源会话中找到目标 UUID (idx=${targetIdx})`)
    } else if (targetIdx < 0) {
      return { canRewind: false, error: `SDK JSONL 中未找到 user message uuid=${userMessageUuid}` }
    }

    // 查找目标 user message 对应的 snapshot（isSnapshotUpdate: false 且 messageId 匹配）
    // SDK 的 file-history-snapshot 有两种：
    // - isSnapshotUpdate: false — user message 发出时的完整文件追踪状态
    // - isSnapshotUpdate: true — assistant 工具修改文件前的增量备份
    // 只使用 user message snapshot 来构建目标时刻的文件状态。
    const fileState = new Map<string, string | null>()
    let targetSnapshotFound = false

    for (const m of messages) {
      if (m.type !== 'file-history-snapshot') continue
      if (m.isSnapshotUpdate) continue
      const snapshot = m.snapshot as {
        messageId?: string
        trackedFileBackups?: Record<string, { backupFileName: string | null }>
      } | undefined
      if (snapshot?.messageId === userMessageUuid && snapshot.trackedFileBackups) {
        for (const [filePath, info] of Object.entries(snapshot.trackedFileBackups)) {
          fileState.set(filePath, info.backupFileName)
        }
        targetSnapshotFound = true
      }
    }

    // 同时收集 target snapshot 对应的增量更新（isSnapshotUpdate: true 且 snapshot.messageId 匹配）
    // 这些记录了 target user message 那轮 assistant 操作前的文件备份
    if (targetSnapshotFound) {
      for (const m of messages) {
        if (m.type !== 'file-history-snapshot' || !m.isSnapshotUpdate) continue
        const snapshot = m.snapshot as {
          messageId?: string
          trackedFileBackups?: Record<string, { backupFileName: string | null }>
        } | undefined
        if (snapshot?.messageId === userMessageUuid && snapshot.trackedFileBackups) {
          // 增量更新可能记录了更多被追踪的文件，但不覆盖已有状态
          for (const [filePath, info] of Object.entries(snapshot.trackedFileBackups)) {
            if (!fileState.has(filePath)) {
              fileState.set(filePath, info.backupFileName)
            }
          }
        }
      }
    }

    // 处理 target 之后新创建的文件（它们在 target 时不存在，需要删除）
    for (let i = targetIdx + 1; i < messages.length; i++) {
      const m = messages[i]!
      if (m.type !== 'file-history-snapshot') continue

      const snapshot = m.snapshot as {
        trackedFileBackups?: Record<string, { backupFileName: string | null }>
      } | undefined
      if (!snapshot?.trackedFileBackups) continue

      for (const [filePath, info] of Object.entries(snapshot.trackedFileBackups)) {
        // 如果这个文件在 target 时不存在（没被追踪），且 backupFileName 为 null（新创建的），标记删除
        if (!fileState.has(filePath) && info.backupFileName === null) {
          fileState.set(filePath, null) // null = 文件应该不存在
        }
      }
    }

    if (fileState.size === 0) {
      if (!targetSnapshotFound) {
        console.log(`[Agent 会话] rewindFilesFromSnapshot: 目标消息无文件快照记录`)
        return { canRewind: false, error: '目标消息无文件快照记录（会话可能在启用文件检查点前创建）' }
      }
      console.log(`[Agent 会话] rewindFilesFromSnapshot: 快照存在但无文件变化`)
      return { canRewind: true, filesChanged: [] }
    }

    // 3. 恢复文件（fork 会话使用源会话的 file-history 备份）
    const fileHistoryDir = join(sdkConfigDir, 'file-history', effectiveSdkSessionId)
    const filesChanged: string[] = []

    for (const [filePath, backupFileName] of fileState) {
      // SDK 对 cwd 内文件使用相对路径，对 additionalDirectories 内文件使用绝对路径。
      // 路径安全检查：文件必须位于 cwd 或 attachedDirectories 之内，否则拒绝写入。
      const fullPath = resolveSafeRewindPath(filePath, cwd, attachedDirectories)
      if (!fullPath) {
        console.warn(`[Agent 会话] rewindFiles: 拒绝路径越界 ${filePath}`)
        continue
      }

      if (backupFileName === null) {
        // 文件在 target 时不存在 → 删除
        if (existsSync(fullPath)) {
          try {
            unlinkSync(fullPath)
            filesChanged.push(filePath)
            console.log(`[Agent 会话] rewindFiles: 删除 ${filePath}`)
          } catch (err) {
            console.warn(`[Agent 会话] rewindFiles: 删除失败 ${filePath}:`, err)
          }
        }
      } else {
        // 文件在 target 时存在 → 用备份恢复
        const backupPath = resolve(fileHistoryDir, backupFileName)
        // backupPath 越界检查
        if (!backupPath.startsWith(resolve(fileHistoryDir) + '/') && backupPath !== resolve(fileHistoryDir)) {
          console.warn(`[Agent 会话] rewindFiles: 拒绝备份路径越界 ${backupFileName}`)
          continue
        }
        if (!existsSync(backupPath)) {
          console.warn(`[Agent 会话] rewindFiles: 备份文件不存在 ${backupPath}`)
          continue
        }
        try {
          const backupContent = readFileSync(backupPath)
          // 确保目录存在
          const dir = dirname(fullPath)
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
          writeFileSync(fullPath, backupContent)
          filesChanged.push(filePath)
          console.log(`[Agent 会话] rewindFiles: 恢复 ${filePath} ← ${backupFileName}${isForkFallback ? ' (from source session)' : ''}`)
        } catch (err) {
          console.warn(`[Agent 会话] rewindFiles: 恢复失败 ${filePath}:`, err)
        }
      }
    }

    console.log(`[Agent 会话] rewindFilesFromSnapshot 完成: ${filesChanged.length} 个文件已恢复${isForkFallback ? ' (fork fallback)' : ''}`)
    return { canRewind: true, filesChanged }
  } catch (err) {
    return { canRewind: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Persist successful Skill loading on the human input that Pi actually consumed.
 * This is intentionally a targeted JSONL rewrite: native Pi queues can produce
 * several logical user turns before a single terminal result arrives.
 */
export function updateSDKUserMessageSkillActivations(
  id: string,
  userMessageUuid: string,
  activations: SkillActivation[],
): boolean {
  if (activations.length === 0) return false
  const filePath = getAgentSessionMessagesPath(id)
  if (!existsSync(filePath)) return false

  const raw = readFileSync(filePath, 'utf-8')
  const lines = raw.split('\n').filter((line) => line.trim())
  const messages = parseJsonlStrict<unknown>(lines, `更新用户 Skill metadata (${id})`)
    .map(normalizePersistedSDKMessage)
  const targetIndex = messages.findIndex((message) => (
    message.type === 'user'
    && (message as SDKUserMessage).uuid === userMessageUuid
  ))
  if (targetIndex < 0) return false

  const target = messages[targetIndex] as SDKUserMessage
  const merged = mergeSkillActivations(target.skill_activations ?? [], activations)
  if (JSON.stringify(merged) === JSON.stringify(target.skill_activations ?? [])) return true

  messages[targetIndex] = { ...target, skill_activations: merged }
  const content = messages.map((message) => JSON.stringify(message)).join('\n') + '\n'
  writeTextFileAtomic(filePath, content)
  return true
}

/**
 * 自动归档超过指定天数未更新的 Agent 会话
 *
 * 置顶会话不会被归档。
 *
 * @param daysThreshold 天数阈值
 * @returns 本次归档的会话数量
 */
export function autoArchiveAgentSessions(daysThreshold: number): number {
  const index = readIndex()
  const threshold = Date.now() - daysThreshold * 86_400_000
  let count = 0

  for (const session of index.sessions) {
    if (!session.pinned && !session.archived && session.updatedAt < threshold) {
      session.archived = true
      count++
    }
  }

  if (count > 0) {
    writeIndex(index)
    console.log(`[Agent 会话] 自动归档 ${count} 个会话（阈值: ${daysThreshold} 天）`)
  }

  return count
}

/**
 * 启动时收敛遗留的委派子会话状态
 *
 * 委派子会话的运行态只在主进程内存中维护，应用退出后无法续跑。
 * 若上次退出时仍有 delegationStatus 为 'running' 的子会话，本次启动需要
 * 把它们标记为 'interrupted'，避免状态永久卡在 running、父会话也无法收敛。
 *
 * @returns 被标记为中断的子会话数量
 */
export function markRunningDelegationsAsInterrupted(): number {
  const index = readIndex()
  let count = 0

  for (const session of index.sessions) {
    if (session.sourceDelegationId && session.delegationStatus === 'running') {
      session.delegationStatus = 'interrupted'
      session.updatedAt = Date.now()
      count++
    }
  }

  if (count > 0) {
    writeIndex(index)
    console.log(`[Agent 会话] 启动收敛 ${count} 个遗留的运行中委派子会话为 interrupted`)
  }

  return count
}

/**
 * 启动时收敛卡住的 Task/Kanban 会话
 *
 * TaskRunner 子会话会把 sessionStatus 写成 in-progress；若进程退出或用户中断后
 * 未收到 completion，状态会永久显示「运行中」。启动时将无活跃 Agent 的
 * in-progress 任务会话降为 todo。
 */
export function markStaleTaskSessionsIdle(
  isSessionActive: (sessionId: string) => boolean = () => false,
): number {
  const index = readIndex()
  let count = 0
  const staleStatuses = new Set(['in-progress', 'running', 'queued'])

  for (const session of index.sessions) {
    const isTaskSession = Boolean(session.taskSlug || session.taskNodeId || session.parentSessionId)
    if (!isTaskSession) continue
    if (!session.sessionStatus || !staleStatuses.has(session.sessionStatus)) continue
    if (isSessionActive(session.id)) continue
    session.sessionStatus = 'todo'
    session.updatedAt = Date.now()
    count++
  }

  if (count > 0) {
    writeIndex(index)
    console.log(`[Agent 会话] 启动收敛 ${count} 个卡住的 Task 会话为 todo`)
  }

  return count
}

/**
 * 清理所有会话中不存在的附加目录和附加文件
 * @returns 清理的条目总数
 */
export function cleanupStaleAttachedPaths(): number {
  const index = readIndex()
  let count = 0

  for (const session of index.sessions) {
    let changed = false

    if (session.attachedDirectories?.length) {
      const valid = session.attachedDirectories.filter((d) => existsSync(d))
      if (valid.length < session.attachedDirectories.length) {
        count += session.attachedDirectories.length - valid.length
        session.attachedDirectories = valid.length > 0 ? valid : undefined
        changed = true
      }
    }

    if (session.attachedFiles?.length) {
      const valid = session.attachedFiles.filter((f) => existsSync(f))
      if (valid.length < session.attachedFiles.length) {
        count += session.attachedFiles.length - valid.length
        session.attachedFiles = valid.length > 0 ? valid : undefined
        changed = true
      }
    }

    if (changed) {
      session.updatedAt = Date.now()
    }
  }

  if (count > 0) {
    writeIndex(index)
    console.log(`[Agent 会话] 清理了 ${count} 个不存在的附加路径`)
  }

  return count
}

/**
 * 搜索 Agent 会话正文。
 * 每个会话最多返回 2 个用户/助手正文命中，最多返回 100 个命中会话。
 */
export async function searchAgentSessionMessages(query: string): Promise<AgentMessageSearchResult[]> {
  if (!query || query.length < 2) return []

  const index = readIndex()
  const results: AgentMessageSearchResult[] = []
  let matchedSessionCount = 0

  const sortedSessions = [...index.sessions].sort((a, b) => b.updatedAt - a.updatedAt)
  for (const session of sortedSessions) {
    if (matchedSessionCount >= MAX_SEARCH_SESSIONS) break

    const filePath = getAgentSessionMessagesPath(session.id)
    if (!existsSync(filePath)) continue

    const hits = await findMatchesInAgentJsonl(filePath, query)
    if (hits.length === 0) continue
    matchedSessionCount++

    for (const hit of hits.slice(0, MAX_SEARCH_HITS_PER_SESSION)) {
      results.push({
        sessionId: session.id,
        sessionTitle: session.title,
        messageId: hit.messageId,
        role: hit.role,
        snippet: hit.snippet,
        matchStart: hit.matchStart,
        matchLength: hit.matchLength,
        archived: session.archived,
      })
    }
  }

  return results
}

interface AgentSearchHit {
  messageId: string
  role: Extract<AgentMessageSearchResult['role'], 'user' | 'assistant'>
  snippet: string
  matchStart: number
  matchLength: number
  score: number
}

/** 在单个 Agent JSONL 中收集用户文本和助手 text block 的命中。 */
async function findMatchesInAgentJsonl(
  filePath: string,
  query: string,
): Promise<AgentSearchHit[]> {
  const stream = createReadStream(filePath, { encoding: 'utf-8' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  const hitsByMessageId = new Map<string, AgentSearchHit>()
  const anonymousHits: AgentSearchHit[] = []

  try {
    for await (const line of rl) {
      if (!line.trim()) continue
      let parsed: {
        role?: string
        id?: string
        uuid?: string
        content?: unknown
        type?: string
        message?: {
          role?: string
          id?: string
          content?: Array<{ type: string; text?: string }>
        }
      }
      try {
        parsed = JSON.parse(line)
      } catch {
        continue
      }

      let role: AgentSearchHit['role'] | null = null
      let messageId = parsed.id ?? parsed.uuid ?? parsed.message?.id ?? ''
      let textContent = ''

      // 兼容旧 AgentMessage：只接受 user/assistant 的顶层 content。
      if (!parsed.type && typeof parsed.content === 'string') {
        if (parsed.role !== 'user' && parsed.role !== 'assistant') continue
        role = parsed.role
        textContent = parsed.content
      } else if (parsed.type === 'user' || parsed.type === 'assistant') {
        role = parsed.type
        if (Array.isArray(parsed.message?.content)) {
          textContent = parsed.message.content
            .filter((block) => block.type === 'text' && typeof block.text === 'string')
            .map((block) => block.text!)
            .join('\n')
        }
      }

      if (!role || !textContent) continue
      const match = findBestSearchMatch(textContent, query)
      if (!match) continue

      const snippetStart = Math.max(0, match.matchStart - 40)
      const snippetEnd = Math.min(textContent.length, match.matchStart + match.matchLength + 40)
      const snippet = (snippetStart > 0 ? '...' : '') +
        textContent.slice(snippetStart, snippetEnd) +
        (snippetEnd < textContent.length ? '...' : '')
      const matchStart = match.matchStart - snippetStart + (snippetStart > 0 ? 3 : 0)
      const hit = { messageId, role, snippet, matchStart, matchLength: match.matchLength, score: match.score }
      if (messageId) {
        const existingHit = hitsByMessageId.get(messageId)
        if (!existingHit) {
          hitsByMessageId.set(messageId, hit)
        } else {
          const bestHit = [existingHit]
          insertTopSearchResult(bestHit, hit, 1)
          hitsByMessageId.set(messageId, bestHit[0]!)
        }
      } else {
        insertTopSearchResult(anonymousHits, hit, MAX_SEARCH_HITS_PER_SESSION)
      }
    }
  } finally {
    rl.close()
    stream.destroy()
  }

  const hits: AgentSearchHit[] = []
  for (const hit of hitsByMessageId.values()) {
    insertTopSearchResult(hits, hit, MAX_SEARCH_HITS_PER_SESSION)
  }
  for (const hit of anonymousHits) {
    insertTopSearchResult(hits, hit, MAX_SEARCH_HITS_PER_SESSION)
  }
  return hits
}

/**
 * 在单个 Agent 会话 JSONL 中按行流式查找第一条匹配。
 *
 * Agent 消息存在两种历史格式（旧 AgentMessage 与新 SDKMessage），都要兼容。
 */
async function findFirstMatchInAgentJsonl(
  filePath: string,
  queryLower: string,
  queryLength: number,
  maxBytes?: number,
): Promise<{ messageId: string; role: AgentMessageSearchResult['role']; snippet: string; matchStart: number } | null> {
  const stream = createReadStream(filePath, {
    encoding: 'utf-8',
    ...(maxBytes ? { end: maxBytes - 1 } : {}),
  })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })

  try {
    for await (const line of rl) {
      if (!line.trim()) continue
      let parsed: {
        role?: string
        id?: string
        uuid?: string
        content?: unknown
        message?: { role?: string; id?: string; content?: Array<{ type: string; text?: string }> }
      }
      try {
        parsed = JSON.parse(line)
      } catch {
        continue
      }

      const rawRole = parsed.role ?? parsed.message?.role ?? 'assistant'
      // 收窄到 AgentMessageSearchResult.role 允许的联合类型；不在白名单的退化为 assistant
      const role: AgentMessageSearchResult['role'] =
        rawRole === 'user' || rawRole === 'assistant' || rawRole === 'tool' || rawRole === 'status'
          ? rawRole
          : 'assistant'
      const messageId = parsed.id ?? parsed.uuid ?? parsed.message?.id ?? ''

      let textContent = ''
      if (typeof parsed.content === 'string') {
        textContent = parsed.content
      } else if (Array.isArray(parsed.message?.content)) {
        textContent = parsed.message.content
          .filter((b) => b.type === 'text' && b.text)
          .map((b) => b.text!)
          .join('\n')
      }
      if (!textContent) continue

      const contentLower = textContent.toLowerCase()
      const matchIndex = contentLower.indexOf(queryLower)
      if (matchIndex === -1) continue

      const snippetStart = Math.max(0, matchIndex - 40)
      const snippetEnd = Math.min(textContent.length, matchIndex + queryLength + 40)
      const snippet = (snippetStart > 0 ? '...' : '') +
        textContent.slice(snippetStart, snippetEnd) +
        (snippetEnd < textContent.length ? '...' : '')
      const matchStart = matchIndex - snippetStart + (snippetStart > 0 ? 3 : 0)

      return { messageId, role, snippet, matchStart }
    }
    return null
  } finally {
    rl.close()
    stream.destroy()
  }
}

async function findSessionMessageSnippet(
  sessionId: string,
  query: string,
  maxBytes?: number,
): Promise<string | undefined> {
  if (!query || query.length < 2) return undefined

  const filePath = getAgentSessionMessagesPath(sessionId)
  if (!existsSync(filePath)) return undefined

  try {
    const hit = await findFirstMatchInAgentJsonl(filePath, query.toLowerCase(), query.length, maxBytes)
    return hit?.snippet
  } catch {
    return undefined
  }
}

function createSessionReferenceSearchResult(
  session: AgentSessionMeta,
  workspacesById: ReadonlyMap<string, { name: string; slug: string }>,
  fields: Pick<AgentSessionReferenceSearchResult, 'matchSource' | 'snippet'>,
): AgentSessionReferenceSearchResult {
  const workspace = session.workspaceId ? workspacesById.get(session.workspaceId) : undefined

  return {
    sessionId: session.id,
    title: session.title,
    ...(workspace ? {
      workspaceName: workspace.name,
      workspaceSlug: workspace.slug,
    } : {}),
    updatedAt: session.updatedAt,
    ...fields,
  }
}

/**
 * 搜索可引用的 Agent 会话。
 *
 * 指定工作区时仅返回该工作区；省略工作区时跨工作区搜索。两种模式都排除已归档和当前会话；无关键词时返回最近更新的会话。
 */
export async function searchAgentSessionReferences(input: AgentSessionReferenceSearchInput): Promise<AgentSessionReferenceSearchResult[]> {
  const workspaceId = input?.workspaceId?.trim()

  const query = (input?.query ?? '').trim()
  const queryLower = query.toLowerCase()
  const requestedLimit = Number.isFinite(input?.limit) ? input.limit! : 20
  const limit = Math.min(Math.max(requestedLimit, 1), MAX_SESSION_REFERENCE_LIMIT)
  const workspacesById = new Map(
    listAgentWorkspaces().map((workspace) => [workspace.id, workspace]),
  )

  const candidates = listAgentSessions()
    .filter((session) => !workspaceId || session.workspaceId === workspaceId)
    .filter((session) => !session.archived)
    .filter((session) => session.id !== input?.excludeSessionId)

  const results: AgentSessionReferenceSearchResult[] = []
  let bodyScanCount = 0

  for (const session of candidates) {
    if (results.length >= limit) break

    if (!queryLower) {
      results.push(createSessionReferenceSearchResult(session, workspacesById, {
        matchSource: 'recent',
      }))
      continue
    }

    if (session.title.toLowerCase().includes(queryLower)) {
      results.push(createSessionReferenceSearchResult(session, workspacesById, {
        matchSource: 'title',
      }))
      continue
    }

    // 即使正文预算耗尽，仍继续遍历，确保较旧但标题命中的会话不会漏掉。
    if (bodyScanCount >= MAX_SESSION_REFERENCE_BODY_SCANS) continue
    bodyScanCount += 1

    const snippet = await findSessionMessageSnippet(
      session.id,
      query,
      MAX_SESSION_REFERENCE_BODY_BYTES_PER_FILE,
    )
    if (snippet) {
      results.push(createSessionReferenceSearchResult(session, workspacesById, {
        snippet,
        matchSource: 'message',
      }))
    }
  }

  return results
}
