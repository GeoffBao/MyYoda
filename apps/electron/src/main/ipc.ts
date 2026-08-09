/**
 * IPC 处理器模块
 *
 * 负责注册主进程和渲染进程之间的通信处理器
 */

import { ipcMain, nativeTheme, shell, dialog, BrowserWindow, app, clipboard, nativeImage } from 'electron'
import { join, resolve, sep, dirname } from 'node:path'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { IPC_CHANNELS, CHANNEL_IPC_CHANNELS, CHAT_IPC_CHANNELS, AGENT_IPC_CHANNELS, ENVIRONMENT_IPC_CHANNELS, INSTALLER_IPC_CHANNELS, PROXY_IPC_CHANNELS, GITHUB_RELEASE_IPC_CHANNELS, SYSTEM_PROMPT_IPC_CHANNELS, CHAT_TOOL_IPC_CHANNELS, FEISHU_IPC_CHANNELS, DINGTALK_IPC_CHANNELS, WECHAT_IPC_CHANNELS, AUTOMATION_IPC_CHANNELS, EXPERT_IPC_CHANNELS, AGENT_THINKING_LEVELS, isMyYodaPermissionMode, normalizePathForCompare, PLANNING_IPC_CHANNELS, RELEASE_NOTES_IPC_CHANNELS, PR_IPC_CHANNELS, type PlanningWorkspaceScope } from '@myyoda/shared'
import { USER_PROFILE_IPC_CHANNELS, SETTINGS_IPC_CHANNELS, SCRATCH_PAD_IPC_CHANNELS, EXCALIDRAW_IPC_CHANNELS, QUICK_TASK_IPC_CHANNELS, VOICE_DICTATION_IPC_CHANNELS, DOCK_BADGE_IPC_CHANNELS, STORAGE_IPC_CHANNELS, USAGE_IPC_CHANNELS } from '../types'
import { registerBrowserIpcHandlers } from './lib/browser/browser-ipc'
import type {
  QuickTaskSubmitInput,
  VoiceDictationAudioChunkInput,
  VoiceDictationCommitInput,
  VoiceDictationCommitResult,
  VoiceDictationPreviewInput,
  VoiceDictationResizeInput,
  VoiceDictationSettings,
  VoiceDictationSettingsUpdate,
  VoiceDictationStartInput,
  VoiceDictationStopInput,
  VoiceDictationTestResult,
  VoiceDictationTextDeliveryInput,
  VoiceDictationToggleInput,
  MicPermissionResult,
} from '../types'
import type {
  RuntimeStatus,
  GitRepoStatus,
  GitBranchInfo,
  ListGitBranchesInput,
  PrepareSessionGitContextInput,
  PrepareSessionGitContextResult,
  Channel,
  ChannelCreateInput,
  ChannelUpdateInput,
  ChannelTestResult,
  ChannelDirectTestInput,
  FetchModelsInput,
  FetchModelsResult,
  ConversationMeta,
  ChatMessage,
  ChatSendInput,
  GenerateTitleInput,
  AttachmentSaveInput,
  AttachmentSaveResult,
  FileDialogResult,
  FileOrFolderDialogResult,
  RecentMessagesResult,
  AgentSessionMeta,
  AgentSendInput,
  AgentRuntime,
  AgentThinkingLevel,
  AgentWorkspace,
  AgentGenerateTitleInput,
  AgentSaveFilesInput,
  AgentSaveWorkspaceFilesInput,
  AgentSavedFile,
  AgentAttachDirectoryInput,
  AgentAttachFileInput,
  WorkspaceAttachDirectoryInput,
  WorkspaceAttachFileInput,
  GetTaskOutputInput,
  GetTaskOutputResult,
  StopTaskInput,
  WorkspaceMcpConfig,
  SkillMeta,
  BulkImportSkillItemResult,
  BulkImportSkillsResult,
  BulkImportWorkspaceSelection,
  SkillFileContent,
  WorkspaceCapabilities,
  WorkspaceMemorySummary,
  OrganizationConnection,
  OrganizationSkill,
  CommunitySkill,
  CommunitySkillInstallResult,
  GhCliStatus,
  SkillSubmissionInput,
  SkillSubmissionResult,
  FileEntry,
  FileSearchResult,
  EnvironmentCheckResult,
  InstallerManifest,
  InstallerDownloadRequest,
  InstallerDownloadResult,
  ProxyConfig,
  SystemProxyDetectResult,
  GitHubRelease,
  GitHubReleaseListOptions,
  PermissionResponse,
  MyYodaPermissionMode,
  AskUserResponse,
  ExitPlanModeResponse,
  SystemPromptConfig,
  SystemPrompt,
  SystemPromptCreateInput,
  SystemPromptUpdateInput,
  ChatToolInfo,
  ChatToolState,
  ChatToolMeta,
  MoveSessionToWorkspaceInput,
  ForkSessionInput,
  RewindSessionInput,
  RewindSessionResult,
  AgentSessionReferenceSearchInput,
  FeishuConfigInput,
  FeishuConfig,
  FeishuBridgeState,
  FeishuTestResult,
  FeishuChatBinding,
  FeishuPresenceReport,
  FeishuUpdateBindingInput,
  FeishuRegisterAppQRCode,
  FeishuRegisterAppStatus,
  FeishuRegisterAppResult,
  DingTalkConfigInput,
  DingTalkConfig,
  DingTalkBridgeState,
  DingTalkTestResult,
  WeChatConfig,
  WeChatBridgeState,
  SDKMessage,
  GetFileDiffInput,
  DetachedPreviewWindowInput,
  RevertFileInput,
  FileAccessOptions,
  ResolvedFileUrl,
  Automation,
  CreateAutomationInput,
  UpdateAutomationInput,
  Todo,
  TodoListQuery,
  CalendarEvent,
  CalendarEventListQuery,
  PlanningGroup,
  PlanningGroupScope,
  PlanningTag,
  PlanningReminder,
  ActivePlanningReminder,
  CreateTodoInput,
  UpdateTodoInput,
  StartTodoAgentInput,
  StartTodoAgentResult,
  TodoAgentSessionActivation,
  CreateCalendarEventInput,
  UpdateCalendarEventInput,
  CreatePlanningGroupInput,
  UpdatePlanningGroupInput,
  SnoozePlanningReminderInput,
  PlanningNativeSyncEntity,
  PlanningNativeSyncStatus,
  PlanningNativeSyncPermissionResult,
  PlanningNativeSyncTarget,
  PlanningNativeConnection,
  PlanningNativeSyncConflict,
  ConnectPlanningNativeConnectionInput,
  ResolvePlanningNativeSyncConflictInput,
  PlanningSyncProfile,
  SavePlanningSyncProfileInput,
} from '@myyoda/shared'
import type { ExpertManifest, ExpertPackage } from '@myyoda/shared/experts'
import type { UserProfile, AppSettings } from '../types'
import { getRuntimeStatus, getGitRepoStatus, reinitializeRuntime } from './lib/runtime-init'
import { getUnstagedChanges, getFileDiff, getUntrackedContent, revertFile, getDiffContents, listWorktrees, getWorktreeChanges, getMainRepoRoot } from './lib/git-diff-service'
import {
  getCurrentBranchPullRequest,
  listPullRequests,
  getPullRequestDetail,
  getPullRequestDiff,
  createPullRequest,
  pullRequestAction,
  addPullRequestComment,
  checkoutPullRequest,
  getBranchWorktreeUsage,
  getPullRequestPanelState,
  getDefaultBranch,
} from './lib/pull-request-service'
import { listGitBranchesForSession, prepareSessionGitContext } from './lib/git-session-context-service'
import { registerPromaFilePath } from './lib/local-file-protocol'
import { registerUpdaterIpc } from './lib/updater/updater-ipc'
import {
  listChannels,
  createChannel,
  updateChannel,
  deleteChannel,
  decryptApiKey,
  testChannel,
  testChannelDirect,
  fetchModels,
  getChannelById,
  getChannelPlanQuota,
} from './lib/channel-manager'
import { loginCodexOAuth, cancelCodexOAuthLogin } from './lib/codex-oauth-service'
import { loginXaiOAuth, cancelXaiOAuthLogin } from './lib/xai-oauth-service'
import { resolvePiReasoningCapability } from './lib/adapters/pi-model-registry'
import { serializeCodexCredentials, serializeClaudeOAuthCredentials, serializeXaiCredentials } from '@myyoda/shared'
import type { CodexOAuthDeviceCode, CodexOAuthLoginMethod, XaiOAuthDeviceCode } from '@myyoda/shared'
import { prepareClaudeOAuthLogin, exchangeClaudeOAuthCode, cancelClaudeOAuthLogin } from './lib/claude-oauth-service'
import {
  listConversations,
  createConversation,
  getConversationMessages,
  getRecentMessages,
  updateConversationMeta,
  deleteConversation,
  deleteMessage,
  truncateMessagesFrom,
  updateContextDividers,
  autoArchiveConversations,
  searchConversationMessages,
} from './lib/conversation-manager'
import { sendMessage, stopGeneration, generateTitle } from './lib/chat-service'
import {
  saveAttachment,
  readAttachmentAsBase64,
  deleteAttachment,
  openFileDialog,
  openFileOrFolderDialog,
} from './lib/attachment-service'
import { extractTextFromAttachment } from './lib/document-parser'
import { getTutorialContent, createWelcomeConversation } from './lib/tutorial-service'
import { getUserProfile, updateUserProfile } from './lib/user-profile-service'
import { getSettings, updateSettings } from './lib/settings-service'
import { refreshCodeClawConfiguration } from './lib/codeclaw-service'
import { setBuiltinMcpUserEnabled } from './lib/builtin-mcp/settings'
import { setDockBadgeCount } from './lib/dock-badge-service'

import { checkEnvironment } from './lib/environment-checker'
import { fetchInstallerManifest, findInstallerSource } from './lib/installer-manifest'
import {
  cancelInstallerDownload,
  downloadInstaller,
  launchInstaller,
} from './lib/installer-downloader'
import { getEffectiveProxyUrl, getProxySettings, saveProxySettings } from './lib/proxy-settings-service'
import { getFetchFn } from './lib/proxy-fetch'
import { detectSystemProxy } from './lib/system-proxy-detector'
import {
  listAutomations,
  getAutomation,
  createAutomation,
  updateAutomation,
  deleteAutomation,
} from './lib/automation-manager'
import { runAutomationNow, broadcastChanged as broadcastAutomationsChanged } from './lib/automation-scheduler'
import {
  listTodos,
  getTodo,
  createTodo,
  updateTodo,
  deleteTodo,
  touchTodoSession,
  listCalendarEvents,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  listPlanningGroups,
  createPlanningGroup,
  updatePlanningGroup,
  deletePlanningGroup,
  listPlanningTags,
  listActivePlanningReminders,
  acknowledgePlanningReminder,
  snoozePlanningReminder,
  listPlanningSyncProfiles,
  listPlanningNativeConnections,
  connectPlanningNativeConnection,
  disconnectPlanningNativeConnection,
  listPlanningNativeSyncConflicts,
  resolvePlanningNativeSyncConflict,
  savePlanningSyncProfile,
} from './lib/planning-manager'
import { broadcastPlanningChanged } from './lib/planning-events'
import {
  getPlanningNativeSyncStatus,
  listPlanningNativeSyncTargets,
  listPlanningNativeConnectionTargets,
  requestPlanningNativeSyncAccess,
} from './lib/planning-native-sync-service'
import { runPlanningNativeSync } from './lib/planning-native-sync-coordinator'
import {
  createExpert,
  createTeam,
  getExpert,
  getTeam,
  listExperts,
  listTeams,
  updateExpertFiles,
  updateExpertManifest,
  updateTeam,
  type CreateTeamInput,
  type UpdateTeamInput,
} from './lib/expert-service'
import type { TeamSquad, ExpertTemplate } from '@myyoda/shared/experts'
import {
  listAgentSessions,
  createAgentSession,
  getAgentSessionMeta,
  getAgentSessionSDKMessages,
  updateAgentSessionMeta,
  deleteAgentSession,
  migrateChatToAgentSession,
  moveSessionToWorkspace,
  forkAgentSession,
  autoArchiveAgentSessions,
  cleanupStaleAttachedPaths,
  searchAgentSessionMessages,
  searchAgentSessionReferences,
} from './lib/agent-session-manager'
import { runAgent, stopAgent, generateAgentTitle, saveFilesToAgentSession, saveFilesToWorkspaceFiles, isAgentSessionActive, queueAgentMessage, updateAgentPermissionMode, rewindAgentSession } from './lib/agent-service'
import { spawnExpertCowork } from './lib/agent-cowork'
import { permissionService } from './lib/agent-permission-service'
import { askUserService } from './lib/agent-ask-user-service'
import { exitPlanService } from './lib/agent-exit-plan-service'
import { getAgentSessionWorkspacePath, getAgentWorkspacesDir, getWorkspaceSkillsDir, getWorkspaceFilesDir, getScratchPadPath, getExcalidrawDir, getExpertsDir, getDefaultExpertTemplatesDir } from './lib/config-paths'
import { resolveAgentSessionFileRoots } from './lib/agent-file-roots'
import { listSessionOutputs } from './lib/agent-output-capture'
import { getAgentWorkspacePath } from './lib/config-paths'
import { getCachedDefaultAppInfo, saveCachedDefaultAppInfo } from './lib/default-app-cache'
import { calculateStorageStats, cleanupStorage, cleanupTempFiles } from './lib/storage-service'
import type { CleanupOptions } from './lib/storage-service'
import { getAgentUsageStats } from './lib/agent-usage'
import type { UsageRange } from './lib/agent-usage'
import {
  listAgentWorkspaces,
  createAgentWorkspace,
  updateAgentWorkspace,
  deleteAgentWorkspace,
  reorderAgentWorkspaces,
  ensureDefaultWorkspace,
  getWorkspaceMcpConfig,
  saveWorkspaceMcpConfig,
  getAllWorkspaceSkills,
  getOtherWorkspaceSkills,
  getDefaultSkillSlugs,
  getWorkspaceCapabilities,
  getAgentWorkspace,
  deleteWorkspaceSkill,
  importSkillFromWorkspace,
  batchImportSkillsFromWorkspaces,
  updateSkillFromSource,
  importSkillFromOrganization,
  updateSkillFromOrganizationSource,
  readWorkspaceSkillContent,
  writeWorkspaceSkillContent,
  toggleWorkspaceSkill,
  listSkillFiles,
  readSkillFile,
  writeSkillFile,
  createSkillEntry,
  deleteSkillEntry,
  renameSkillEntry,
  getWorkspaceMemorySummary,
  readWorkspaceAgentsMd,
  writeWorkspaceAgentsMd,
  listWorkspaceAutoMemoryFiles,
  readWorkspaceAutoMemoryFile,
  writeWorkspaceAutoMemoryFile,
  approveWorkspaceProjectKnowledgeMaintenance,
  getWorkspaceAttachedDirectories,
  getWorkspaceAttachedFiles,
  attachWorkspaceDirectory,
  attachWorkspaceFile,
  detachWorkspaceDirectory,
  detachWorkspaceFile,
  getWorktreeRepos,
  addWorktreeRepo,
  removeWorktreeRepo,
  cleanupStaleWorkspaceAttachedPaths,
  getWorkspaceDefaultWorkingDirectory,
  setWorkspaceDefaultWorkingDirectory,
} from './lib/agent-workspace-manager'
import {
  getOrganizationConnection,
  setOrganizationConnection,
  clearOrganizationConnection,
  orgLogin,
  orgRegister,
  orgConnectWithApiKey,
  orgMe,
  orgCreate,
  orgJoin,
  orgListMembers,
  orgListSkills,
} from './lib/org-skill-service'
import { fetchCommunityManifest, installCommunitySkill } from './lib/community-skill-service'
import { getGhCliStatus } from './lib/gh-cli'
import { submitSkillToCommunity } from './lib/community-skill-submit-service'
import { projectRepository } from './lib/project-repository'
import { subscribeWorkspaceMemoryChanges } from './lib/workspace-memory-change-watcher'
import { confirmWorkspaceMemoryWindowClose, markWorkspaceMemoryWindowReady } from './lib/workspace-memory-window'

/** 按渲染进程隔离的订阅表；在显式 STOP 或 renderer 销毁时释放。 */
const workspaceMemoryWatchSubscriptions = new Map<number, Map<string, () => void>>()
const workspaceMemoryWatchDestroyedListeners = new Set<number>()

function stopWorkspaceMemoryWatch(webContentsId: number, workspaceSlug: string): void {
  const subscriptions = workspaceMemoryWatchSubscriptions.get(webContentsId)
  const unsubscribe = subscriptions?.get(workspaceSlug)
  if (!unsubscribe) return
  unsubscribe()
  subscriptions?.delete(workspaceSlug)
  if (subscriptions?.size === 0) workspaceMemoryWatchSubscriptions.delete(webContentsId)
}

import { getAllToolInfos } from './lib/chat-tool-registry'
import { updateToolState, updateToolCredentials, getToolCredentials, addCustomTool, deleteCustomTool } from './lib/chat-tool-config'
import {
  getSystemPromptConfig,
  createSystemPrompt,
  updateSystemPrompt,
  deleteSystemPrompt,
  updateAppendSetting,
  setDefaultPrompt,
} from './lib/system-prompt-manager'
import {
  getLatestRelease,
  listReleases as listGitHubReleases,
  getReleaseByTag,
} from './lib/github-release-service'
import {
  getReleaseNotesList,
  getLatestReleaseVersion,
  getCombinedReleaseNotes,
} from './lib/release-notes-service'
import { watchAttachedDirectory, unwatchAttachedDirectory } from './lib/workspace-watcher'
import {
  getFeishuConfig,
  saveFeishuConfig,
  getDecryptedAppSecret,
  getFeishuMultiBotConfig,
  saveFeishuBotConfig,
  removeFeishuBot,
  getDecryptedBotAppSecret,
} from './lib/feishu-config'
import { feishuBridgeManager } from './lib/feishu-bridge-manager'
import { syncFeishuSyncSleepBlocker } from './lib/feishu-sleep-blocker'
import { presenceService } from './lib/feishu-presence'
import { getDingTalkConfig, saveDingTalkConfig, getDecryptedClientSecret, getDingTalkMultiBotConfig, saveDingTalkBotConfig, removeDingTalkBot, getDecryptedBotClientSecret } from './lib/dingtalk-config'
import { dingtalkBridgeManager } from './lib/dingtalk-bridge-manager'
import { getWeChatConfig } from './lib/wechat-config'
import { wechatBridge } from './lib/wechat-bridge'

/** 文件浏览器中需要隐藏的系统文件 */
const HIDDEN_FS_ENTRIES = new Set(['.DS_Store', 'Thumbs.db'])

/** 已知编辑器应用名称白名单（macOS） */
const KNOWN_EDITORS = [
  'Visual Studio Code', 'Cursor', 'Sublime Text', 'Windsurf',
  'Zed', 'CotEditor', 'IntelliJ IDEA', 'Xcode', 'TextEdit',
]

/**
 * 检查路径是否在允许的目录范围内（解析 symlink）
 *
 * extraAllowedPaths 来自 renderer 的 basePaths（用户通过 UI 附加的目录），
 * 虽然 renderer 不可信，但附加目录功能本身就允许用户授权 workspaces 外的路径访问。
 * 攻击者需要先控制 renderer 才能伪造 basePaths，此时已有更大的攻击面。
 */
function realpathOrResolve(path: string): string {
  try {
    return realpathSync(resolve(path))
  } catch {
    return resolve(path)
  }
}

function getAuthorizedRoots(options?: FileAccessOptions): string[] {
  const roots: string[] = [
    getAgentWorkspacesDir(),
    join(tmpdir(), 'myyoda-preview'),
  ]

  const workspaceSlugs = new Set<string>()

  if (options?.sessionId) {
    const meta = getAgentSessionMeta(options.sessionId)
    if (meta?.attachedDirectories) {
      roots.push(...meta.attachedDirectories)
    }
    if (meta?.attachedFiles) {
      roots.push(...meta.attachedFiles)
    }
    // 会话已绑定 Git 上下文时，其自身 repo/worktree 路径始终授权——即便下面的 Project
    // 查找因项目被删除/改名等原因失败，已建立的 Git 上下文也不应该突然失去访问权限。
    if (meta?.gitRepoPath) roots.push(meta.gitRepoPath)
    if (meta?.gitWorktreePath) roots.push(meta.gitWorktreePath)
    if (meta?.workspaceId) {
      const workspace = getAgentWorkspace(meta.workspaceId)
      if (workspace?.slug) workspaceSlugs.add(workspace.slug)
      // 会话绑定的 Project（Git 项目）工作目录也要授权，否则新会话选择 Git 分支/创建
      // Worktree 时，ensurePathAllowedWithWorktree 永远无法通过校验——这里之前完全没有
      // 打通 sessionMeta.projectId → project.config.workingDirectory 这条链路，是
      // Git 分支列表/创建 Worktree 从未真正工作过的根因。
      if (workspace?.slug && meta.projectId) {
        try {
          const project = projectRepository.getProjectAtRoot(getAgentWorkspacePath(workspace.slug), meta.projectId)
          if (project?.config.workingDirectory) roots.push(project.config.workingDirectory)
        } catch {
          // 查找失败不应阻断其他授权路径
        }
      }
    }
  }

  if (options?.workspaceSlug) {
    workspaceSlugs.add(options.workspaceSlug)
  }

  for (const slug of workspaceSlugs) {
    roots.push(getWorkspaceFilesDir(slug))
    roots.push(...getWorkspaceAttachedDirectories(slug))
    roots.push(...getWorkspaceAttachedFiles(slug))
  }

  return roots
}

function isUnderRoot(resolvedPath: string, root: string): boolean {
  const resolvedRoot = realpathOrResolve(root)
  return resolvedPath === resolvedRoot || resolvedPath.startsWith(resolvedRoot + sep)
}

function isPathAllowed(filePath: string, options?: FileAccessOptions): boolean {
  let resolved: string
  try {
    resolved = realpathSync(resolve(filePath))
  } catch {
    return false
  }
  return getAuthorizedRoots(options).some((root) => isUnderRoot(resolved, root))
}

function normalizeFileAccessOptions(value?: FileAccessOptions | string[]): FileAccessOptions | undefined {
  if (!value || Array.isArray(value) || typeof value !== 'object') return undefined
  return {
    sessionId: typeof value.sessionId === 'string' ? value.sessionId : undefined,
    workspaceSlug: typeof value.workspaceSlug === 'string' ? value.workspaceSlug : undefined,
    candidateBasePaths: Array.isArray(value.candidateBasePaths)
      ? value.candidateBasePaths.filter((p): p is string => typeof p === 'string' && p.length > 0)
      : undefined,
  }
}

function getWorkspaceSlugsForAccess(options?: FileAccessOptions): string[] {
  const workspaceSlugs = new Set<string>()
  if (options?.sessionId) {
    const meta = getAgentSessionMeta(options.sessionId)
    if (meta?.workspaceId) {
      const workspace = getAgentWorkspace(meta.workspaceId)
      if (workspace?.slug) workspaceSlugs.add(workspace.slug)
    }
  }
  if (options?.workspaceSlug) {
    workspaceSlugs.add(options.workspaceSlug)
  }
  return Array.from(workspaceSlugs)
}

function getAllowedCandidateBasePaths(options?: FileAccessOptions): string[] | undefined {
  const allowed = options?.candidateBasePaths?.filter((p) => isPathAllowed(p, options)) ?? []
  return allowed.length > 0 ? allowed : undefined
}

async function getAccessRootMainRepo(root: string): Promise<string | null> {
  if (!existsSync(root)) return null
  let probePath = root
  try {
    const stats = statSync(probePath)
    if (stats.isFile()) probePath = dirname(probePath)
  } catch {
    return null
  }
  return getMainRepoRoot(probePath)
}

function ensurePathAllowed(filePath: string, options?: FileAccessOptions): boolean {
  if (isPathAllowed(filePath, options)) return true
  console.warn('[IPC] 拒绝越界路径:', filePath)
  return false
}

/**
 * 在 ensurePathAllowed 基础上，额外放行「已授权仓库的 worktree」。
 *
 * worktree 常被放在主仓库之外（如 ~/myyoda-dev/worktrees/xxx），其路径不在任何
 * 授权根下，会被 ensurePathAllowed 拒绝。但只要它回溯到的主仓库已被授权，就应放行。
 * 用 git 自身背书（--git-common-dir），避免粗暴跳过安全检查。
 */
async function ensurePathAllowedWithWorktree(filePath: string, options?: FileAccessOptions): Promise<boolean> {
  if (isPathAllowed(filePath, options)) return true
  const mainRepo = await getMainRepoRoot(filePath)
  if (mainRepo && isPathAllowed(mainRepo, options)) return true
  if (mainRepo) {
    const targetMainRepo = normalizePathForCompare(realpathOrResolve(mainRepo))
    for (const root of getAuthorizedRoots(options)) {
      const authorizedMainRepo = await getAccessRootMainRepo(root)
      if (!authorizedMainRepo) continue
      const authorizedRoot = normalizePathForCompare(realpathOrResolve(authorizedMainRepo))
      if (authorizedRoot === targetMainRepo) return true
    }
    for (const workspaceSlug of getWorkspaceSlugsForAccess(options)) {
      let repos: import('@myyoda/shared').WorkspaceWorktreeRepo[]
      try {
        repos = await getWorktreeRepos(workspaceSlug)
      } catch {
        continue
      }
      for (const repo of repos) {
        const repoMain = await getMainRepoRoot(repo.repoPath)
        const repoRoot = normalizePathForCompare(realpathOrResolve(repoMain ?? repo.repoPath))
        if (repoRoot === targetMainRepo) return true
      }
    }
  }
  console.warn('[IPC] 拒绝越界路径:', filePath)
  return false
}

/**
 * 注册 IPC 处理器
 *
 * 注册的通道：
 * - runtime:get-status: 获取运行时状态
 * - git:get-repo-status: 获取指定目录的 Git 仓库状态
 * - channel:*: 渠道管理相关
 * - chat:*: 对话管理 + 消息发送 + 流式事件
 */
/**
 * 打包内置资源目录
 * dev: __dirname/resources（build:resources 阶段拷贝）
 * prod: process.resourcesPath（electron-builder extraResources 产物）
 */
function getBundledResourcesDir(): string {
  return app.isPackaged ? process.resourcesPath : join(__dirname, 'resources')
}

/**
 * 默认 App 探测结果按文件后缀缓存，避免反复 spawn Swift / 注册表查询。
 * 成功结果会落盘；失败只做短暂内存冷却，避免一次瞬时失败导致整会话都隐藏按钮。
 */
const defaultAppCache = new Map<string, import('@myyoda/shared').DefaultAppInfo>()
const defaultAppFailureCache = new Map<string, number>()
const DEFAULT_APP_FAILURE_RETRY_MS = 60_000

function extOf(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot).toLowerCase() : ''
}

async function getAppIconDataUrl(appPath: string): Promise<string> {
  // macOS: 用 sips 把 App bundle 的 .icns 转成 64×64 PNG 再读。
  // 不要用 nativeImage.createFromPath(.icns) + resize ——某些 Electron 版本对多分辨率 .icns
  // resize 时会 SIGTRAP 直接崩主进程。
  if (process.platform === 'darwin' && appPath.endsWith('.app')) {
    const dataUrl = await getMacAppIconViaSips(appPath)
    if (dataUrl) return dataUrl
  }

  const icon = await app.getFileIcon(appPath, { size: 'large' })
  if (icon.isEmpty()) return ''
  return icon.toDataURL()
}

async function getMacAppIconViaSips(appPath: string): Promise<string> {
  const { existsSync, readFileSync, unlinkSync, mkdtempSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')

  // 找 .icns 文件
  const resourcesDir = join(appPath, 'Contents', 'Resources')
  const plistPath = join(appPath, 'Contents', 'Info.plist')
  let iconName: string | null = null
  if (existsSync(plistPath)) {
    const r = await runCmd('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIconFile', plistPath], { timeoutMs: 2000 })
    if (r.status === 0) iconName = r.stdout.trim()
  }
  const candidates: string[] = []
  if (iconName) candidates.push(join(resourcesDir, iconName.endsWith('.icns') ? iconName : `${iconName}.icns`))
  candidates.push(join(resourcesDir, 'AppIcon.icns'), join(resourcesDir, 'app.icns'), join(resourcesDir, 'icon.icns'))
  const icnsPath = candidates.find((p) => existsSync(p))
  if (!icnsPath) return ''

  const tmp = mkdtempSync(join(tmpdir(), 'myyoda-icon-'))
  const outPath = join(tmp, 'icon.png')
  try {
    const r = await runCmd('sips', ['-s', 'format', 'png', '-Z', '64', icnsPath, '--out', outPath], { timeoutMs: 4000 })
    if (r.status !== 0 || !existsSync(outPath)) return ''
    const buf = readFileSync(outPath)
    return `data:image/png;base64,${buf.toString('base64')}`
  } finally {
    try { if (existsSync(outPath)) unlinkSync(outPath) } catch { /* ignore */ }
  }
}

/** 异步执行外部命令，超时即 kill；不经 shell，避免 shell 元字符注入。 */
async function runCmd(
  bin: string,
  args: string[],
  opts: { timeoutMs?: number; stdin?: string } = {},
): Promise<{ status: number | null; stdout: string }> {
  const { spawn } = await import('node:child_process')
  const { timeoutMs = 4000, stdin } = opts
  return new Promise((resolvePromise) => {
    const child = spawn(bin, args, {
      stdio: [stdin !== undefined ? 'pipe' : 'ignore', 'pipe', 'ignore'],
    })
    let stdout = ''
    let settled = false
    const finish = (status: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolvePromise({ status, stdout })
    }
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* ignore */ }
      finish(null)
    }, timeoutMs)
    child.on('error', () => finish(null))
    child.on('close', (code) => finish(code))
    if (child.stdout) {
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => { stdout += chunk })
    }
    if (stdin !== undefined && child.stdin) {
      child.stdin.end(stdin)
    }
  })
}

function parseWindowsRegistryValue(stdout: string): string {
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/\s+REG_\w+\s+(.+)$/)
    if (match?.[1]) return match[1].trim()
  }
  return ''
}

function expandWindowsEnvPath(filePath: string): string {
  return filePath.replace(/%([^%]+)%/g, (token, name: string) => {
    const foundKey = Object.keys(process.env).find((key) => key.toLowerCase() === name.toLowerCase())
    return foundKey ? process.env[foundKey] ?? token : token
  })
}

function parseWindowsExecutablePath(command: string): string {
  const match = command.match(/"([^"]+\.exe)"|([^\s"]+\.exe)/i)
  return expandWindowsEnvPath((match?.[1] || match?.[2] || '').trim())
}

function isSafeWindowsProgId(progId: string): boolean {
  return /^[a-zA-Z0-9_.+-]+$/.test(progId)
}

async function getWindowsDefaultAppCommand(progId: string): Promise<string> {
  if (!isSafeWindowsProgId(progId)) return ''

  const registryResult = await runCmd('reg', [
    'query',
    `HKCR\\${progId}\\shell\\open\\command`,
    '/ve',
  ])
  const registryCommand = parseWindowsRegistryValue(registryResult.stdout)
  if (registryCommand) return registryCommand

  const ftypeResult = await runCmd('cmd', ['/c', `ftype ${progId}`])
  return (ftypeResult.stdout || '').split('=').slice(1).join('=').trim()
}

async function getWindowsDefaultAppInfo(filePath: string): Promise<{ appPath: string; appName: string; isUwp?: boolean } | null> {
  const ext = extOf(filePath)
  // ext 来自渲染进程的 filePath，必须严格校验：cmd /c "assoc ${ext}" 中 & | > < 等会触发命令链
  if (!/^\.[a-zA-Z0-9]+$/.test(ext)) {
    console.log('[DefaultApp] ext 校验失败:', ext)
    return null
  }

  const userChoiceResult = await runCmd('reg', [
    'query',
    `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\${ext}\\UserChoice`,
    '/v',
    'ProgId',
  ])
  let progId = parseWindowsRegistryValue(userChoiceResult.stdout)
  console.log('[DefaultApp] ext=%s UserChoice progId=%s', ext, progId)

  if (!progId) {
    const assoc = await runCmd('cmd', ['/c', `assoc ${ext}`])
    progId = (assoc.stdout || '').split('=').slice(1).join('=').trim()
    console.log('[DefaultApp] assoc fallback progId=%s', progId)
  }
  // 第三 fallback：HKCU OpenWithList MRU（取最近使用的 exe，与 Windows 设置显示一致）
  if (!progId) {
    const mruResult = await runCmd('reg', [
      'query',
      `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\${ext}\\OpenWithList`,
    ])
    const mruLine = mruResult.stdout.split(/\r?\n/).find((l) => /\s+MRUList\s+REG_SZ\s+/.test(l))
    const mruOrder = mruLine?.split(/\s+REG_SZ\s+/)[1]?.trim() ?? ''
    if (mruOrder) {
      const firstKey = mruOrder[0]
      const exeLine = mruResult.stdout.split(/\r?\n/).find((l) => new RegExp(`\\s+${firstKey}\\s+REG_SZ\\s+`).test(l))
      const exeName = exeLine?.split(/\s+REG_SZ\s+/)[1]?.trim() ?? ''
      if (exeName && /^[a-zA-Z0-9 _.+()-]+\.exe$/i.test(exeName)) {
        // 从 App Paths 把 exe 名转成 progId（取 exe 对应的 HKCR 下注册的 ProgId）
        // 直接用 exe 名（去掉 .exe）当 appName，appPath 从 App Paths 查
        const appName = exeName.replace(/\.exe$/i, '')
        const apResult = await runCmd('reg', [
          'query', `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exeName}`, '/ve',
        ])
        let exePath = parseWindowsRegistryValue(apResult.stdout)
        if (!exePath) {
          const apResult2 = await runCmd('reg', [
            'query', `HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exeName}`, '/ve',
          ])
          exePath = parseWindowsRegistryValue(apResult2.stdout)
        }
        console.log('[DefaultApp] OpenWithList MRU fallback: exe=%s path=%s', exeName, exePath)
        if (exePath) return { appPath: exePath, appName }
      }
    }
  }
  // 第四 fallback：HKCU OpenWithProgids（无 UserChoice 但有文件类型关联时）
  if (!progId) {
    const owpResult = await runCmd('reg', [
      'query',
      `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\${ext}\\OpenWithProgids`,
    ])
    // 取第一个非空值名（跳过空行和路径行）
    for (const line of owpResult.stdout.split(/\r?\n/)) {
      const m = line.match(/^\s+(\S+)\s+REG_/)
      if (m && m[1] && isSafeWindowsProgId(m[1])) {
        progId = m[1]
        console.log('[DefaultApp] OpenWithProgids fallback progId=%s', progId)
        break
      }
    }
  }
  if (!progId || !isSafeWindowsProgId(progId)) {
    console.log('[DefaultApp] progId 无效或不安全:', progId)
    return null
  }

  // UWP 应用：shell\open\command 下只有 DelegateExecute，没有传统 exe 路径
  // 从 Application 子键读 ApplicationName 作为 appName
  if (progId.startsWith('AppX')) {
    const nameResult = await runCmd('reg', [
      'query', `HKCR\\${progId}\\Application`, '/v', 'ApplicationName',
    ])
    let appName = parseWindowsRegistryValue(nameResult.stdout)
    // ApplicationName 通常是资源引用 "@{...?ms-resource://...}"，取最后一段
    if (appName.startsWith('@{')) {
      const appIdResult = await runCmd('reg', [
        'query', `HKCR\\${progId}\\Application`, '/v', 'AppUserModelId',
      ])
      const appUserModelId = parseWindowsRegistryValue(appIdResult.stdout)
      // AppUserModelId 形如 "Microsoft.ZuneVideo_8wekyb3d8bbwe!Microsoft.ZuneVideo"
      // 取 ! 之后的部分作为名字，再去掉前缀
      const parts = appUserModelId.split('!')
      appName = (parts[1] ?? parts[0] ?? '').replace(/^Microsoft\./, '').replace(/^Windows\./, '') || 'UWP App'
    }
    console.log('[DefaultApp] UWP app, appName=%s', appName)
    return { appPath: '', appName, isUwp: true }
  }

  const command = await getWindowsDefaultAppCommand(progId)
  console.log('[DefaultApp] open command:', command)
  const appPath = parseWindowsExecutablePath(command)
  console.log('[DefaultApp] parsed appPath:', appPath)
  if (!appPath) {
    // Fallback：从 HKCR\<progId> 默认值取 app 名，从 App Paths 找 exe
    const rootResult = await runCmd('reg', ['query', `HKCR\\${progId}`, '/ve'])
    const rootName = parseWindowsRegistryValue(rootResult.stdout)
    // AppUserModelId 字段（非 UWP 也可能有，如 Quark）
    const appModelResult = await runCmd('reg', ['query', `HKCR\\${progId}`, '/v', 'AppUserModelId'])
    const appModelId = parseWindowsRegistryValue(appModelResult.stdout)
    const candidateAppName = (appModelId || rootName || '').replace(/\s+(HTML?\s+)?(Document|File)$/i, '').trim()
    if (!candidateAppName || !/^[a-zA-Z0-9 _.+-]+$/.test(candidateAppName)) return null
    // 从 App Paths 找 exe（应用注册了 App Paths 就能找到）
    const appPathsResult = await runCmd('reg', [
      'query', `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${candidateAppName}.exe`, '/ve',
    ])
    let exePath = parseWindowsRegistryValue(appPathsResult.stdout)
    if (!exePath) {
      const appPathsResult2 = await runCmd('reg', [
        'query', `HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${candidateAppName}.exe`, '/ve',
      ])
      exePath = parseWindowsRegistryValue(appPathsResult2.stdout)
    }
    console.log('[DefaultApp] App Paths fallback: candidateAppName=%s exePath=%s', candidateAppName, exePath)
    if (!exePath) return null
    const base = exePath.split(/[\\/]/).pop() || ''
    return { appPath: exePath, appName: base.replace(/\.exe$/i, '') }
  }

  const base = appPath.split(/[\\/]/).pop() || ''
  return { appPath, appName: base.replace(/\.exe$/i, '') }
}

async function getDefaultAppInfoForFile(
  filePath: string,
  _options?: FileAccessOptions,
): Promise<import('@myyoda/shared').DefaultAppInfo | null> {
  const { resolve } = await import('node:path')
  const absPath = resolve(filePath)

  const cacheKey = `${process.platform}:${extOf(filePath) || filePath}`
  const cachedInfo = defaultAppCache.get(cacheKey) ?? getCachedDefaultAppInfo(cacheKey)
  if (cachedInfo) {
    defaultAppCache.set(cacheKey, cachedInfo)
    return cachedInfo
  }
  if (isFailureCacheFresh(cacheKey)) return null

  let appPath = ''
  let appName = ''

  if (process.platform === 'darwin') {
    // 通过 swift + AppKit/NSWorkspace.urlForApplication(toOpen:) 调 LaunchServices。
    // 比 AppleScript 的 `default application of (file as alias)` 稳得多——后者在 macOS 14+
    // 经常返回 -1700（无法转 alias），即便文件存在、默认 App 已正确设置。
    // swift 通过 stdin 接收脚本，文件路径作为 argv[1]，杜绝任何字符串拼接注入。
    const swiftSrc = `import Foundation
import AppKit
let path = CommandLine.arguments.dropFirst().first ?? ""
let url = URL(fileURLWithPath: path)
if let appUrl = NSWorkspace.shared.urlForApplication(toOpen: url) {
  print(appUrl.path)
} else {
  exit(1)
}`
    const r = await runCmd('swift', ['-', absPath], { stdin: swiftSrc, timeoutMs: 6000 })
    if (r.status === 0) {
      appPath = r.stdout.trim().replace(/\/$/, '')
    }
    console.log('[DefaultApp] darwin swift 结果: status=%s appPath=%s', r.status, appPath)
    if (appPath.endsWith('.app')) {
      const base = appPath.split('/').pop() || ''
      appName = base.replace(/\.app$/, '')
    }
  } else if (process.platform === 'win32') {
    const info = await getWindowsDefaultAppInfo(filePath)
    console.log('[DefaultApp] win32 getWindowsDefaultAppInfo 结果:', info)
    if (!info) return cacheNull(cacheKey)
    appPath = info.isUwp ? absPath : info.appPath
    appName = info.appName
  } else {
    const mimeRes = await runCmd('xdg-mime', ['query', 'filetype', absPath])
    const mime = mimeRes.stdout.trim()
    if (!mime) return cacheNull(cacheKey)
    const defRes = await runCmd('xdg-mime', ['query', 'default', mime])
    const desktop = defRes.stdout.trim()
    if (!desktop) return cacheNull(cacheKey)
    const { homedir } = await import('node:os')
    const candidates = [
      `${homedir()}/.local/share/applications/${desktop}`,
      `/usr/share/applications/${desktop}`,
      `/usr/local/share/applications/${desktop}`,
    ]
    const { existsSync, readFileSync } = await import('node:fs')
    const desktopPath = candidates.find((p) => existsSync(p))
    if (!desktopPath) return cacheNull(cacheKey)
    const text = readFileSync(desktopPath, 'utf8')
    const execLine = text.split('\n').find((l) => l.startsWith('Exec='))?.slice(5) || ''
    const nameLine = text.split('\n').find((l) => l.startsWith('Name='))?.slice(5) || ''
    appPath = execLine.split(/\s+/)[0] || ''
    appName = nameLine || (appPath.split('/').pop() ?? '')
  }

  if (!appPath || !appName) {
    console.log('[DefaultApp] appPath 或 appName 为空，返回 null. appPath=%s appName=%s', appPath, appName)
    return cacheNull(cacheKey)
  }

  const iconDataUrl = await getAppIconDataUrl(appPath).catch((e) => { console.warn('[DefaultApp] getAppIconDataUrl 失败:', e); return '' })
  console.log('[DefaultApp] iconDataUrl 长度:', iconDataUrl?.length)
  if (!iconDataUrl) return cacheNull(cacheKey)

  const info: import('@myyoda/shared').DefaultAppInfo = { name: appName, appPath, iconDataUrl }
  defaultAppCache.set(cacheKey, info)
  defaultAppFailureCache.delete(cacheKey)
  saveCachedDefaultAppInfo(cacheKey, info)
  return info
}

function isFailureCacheFresh(key: string): boolean {
  const failedAt = defaultAppFailureCache.get(key)
  if (failedAt === undefined) return false
  if (Date.now() - failedAt < DEFAULT_APP_FAILURE_RETRY_MS) return true
  defaultAppFailureCache.delete(key)
  return false
}

function cacheNull(key: string): null {
  defaultAppFailureCache.set(key, Date.now())
  return null
}

function isAgentRuntime(value: unknown): value is AgentRuntime {
  return value === 'claude' || value === 'pi'
}

/**
 * 解析应用图标变体的文件路径
 */
export function resolveAppIconPath(variantId: string): string | null {
  const resourcesDir = getBundledResourcesDir()
  if (!variantId || variantId === 'default') {
    return join(resourcesDir, 'icon.png')
  }
  return join(resourcesDir, 'logos', `${variantId}.png`)
}

function collectSessionDescendantIds(sessions: AgentSessionMeta[], rootId: string): string[] {
  const childrenByParent = new Map<string, AgentSessionMeta[]>()
  for (const session of sessions) {
    if (!session.parentSessionId) continue
    const children = childrenByParent.get(session.parentSessionId) ?? []
    children.push(session)
    childrenByParent.set(session.parentSessionId, children)
  }

  const result: string[] = []
  const queue = [...(childrenByParent.get(rootId) ?? [])]
  const seen = new Set<string>([rootId])
  while (queue.length > 0) {
    const child = queue.shift()!
    if (seen.has(child.id)) continue
    seen.add(child.id)
    result.push(child.id)
    queue.push(...(childrenByParent.get(child.id) ?? []))
  }

  return result.reverse()
}

/** Excalidraw 文件标题 → slug 的唯一归一化实现，避免多个 handler 各自内联同一段正则导致规则漂移 */
function titleToSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w一-鿿぀-ヿ-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * 计算新建 Excalidraw 文件的最终文件名，自动追加 "(n)" 后缀避免重名。
 * CREATE 与 SAVE_SYNC（beforeunload 兜底保存新画布）共用同一份逻辑，避免两处判断标准
 * 分叉——历史上就因为 CREATE 与其他 handler 判断标准不一致导致过大小写覆盖之类的 bug。
 */
function resolveExcalidrawCreateName(dir: string, rawTitle: string): { finalName: string; filePath: string } {
  const safeName = rawTitle.trim().replace(/[\\/:*?"<>|]/g, '-') || '未命名画布'
  const existingSlugs = new Set(
    readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.excalidraw'))
      .map((e) => titleToSlug(e.name.slice(0, -'.excalidraw'.length))),
  )
  // existsSync 是 OS 级判断（正确处理 macOS/Windows 默认大小写不敏感文件系统），
  // existingSlugs 判断则防止不同标题归一化后产生同一份"逻辑文件"。
  const nameCollides = (candidate: string): boolean =>
    existsSync(join(dir, `${candidate}.excalidraw`)) || existingSlugs.has(titleToSlug(candidate))
  let finalName = safeName
  if (nameCollides(finalName)) {
    let i = 1
    while (nameCollides(`${safeName} (${i})`)) i++
    finalName = `${safeName} (${i})`
  }
  return { finalName, filePath: join(dir, `${finalName}.excalidraw`) }
}

async function withOAuthDeviceCodeQr<T extends CodexOAuthDeviceCode | XaiOAuthDeviceCode>(deviceCode: T): Promise<T> {
  try {
    const QRCode = (await import('qrcode')).default
    return { ...deviceCode, qrCodeData: await QRCode.toDataURL(deviceCode.verificationUri, { width: 240, margin: 1 }) }
  } catch (error) {
    console.warn('[OAuth] 生成设备码二维码失败:', error)
    return deviceCode
  }
}

export function registerIpcHandlers(): void {
  console.log('[IPC] 正在注册 IPC 处理器...')

  // ===== 运行时相关 =====

  // 获取运行时状态
  ipcMain.handle(
    IPC_CHANNELS.GET_RUNTIME_STATUS,
    async (): Promise<RuntimeStatus | null> => {
      return getRuntimeStatus()
    }
  )

  // 重新初始化运行时（用户安装完 Git/Node 后触发，Windows 场景常用）
  ipcMain.handle(
    IPC_CHANNELS.REINIT_RUNTIME,
    async (): Promise<RuntimeStatus> => {
      return reinitializeRuntime()
    }
  )

  // 获取指定目录的 Git 仓库状态
  ipcMain.handle(
    IPC_CHANNELS.GET_GIT_REPO_STATUS,
    async (_, dirPath: string): Promise<GitRepoStatus | null> => {
      if (!dirPath || typeof dirPath !== 'string') {
        console.warn('[IPC] git:get-repo-status 收到无效的目录路径')
        return null
      }

      return getGitRepoStatus(dirPath)
    }
  )

  // 获取未暂存的变更文件列表
  ipcMain.handle(
    IPC_CHANNELS.GET_UNSTAGED_CHANGES,
    async (_, dirPath: string, sessionPath?: string, workspaceFilesPath?: string, extraPaths?: string[], sessionId?: string) => {
      if (!dirPath || typeof dirPath !== 'string') {
        console.warn('[IPC] git:get-unstaged-changes 收到无效的目录路径')
        return { isGitRepo: false, files: [], untrackedFiles: [], gitRootNames: [] }
      }
      const access = normalizeFileAccessOptions({ sessionId })
      if (!ensurePathAllowed(dirPath, access)) {
        return { isGitRepo: false, files: [], untrackedFiles: [], gitRootNames: [] }
      }
      const allowedSessionPath = sessionPath && isPathAllowed(sessionPath, access) ? sessionPath : undefined
      const allowedWorkspaceFilesPath = workspaceFilesPath && isPathAllowed(workspaceFilesPath, access) ? workspaceFilesPath : undefined
      const allowedExtraPaths = extraPaths?.filter((p) => isPathAllowed(p, access))
      return getUnstagedChanges(dirPath, allowedSessionPath, allowedWorkspaceFilesPath, allowedExtraPaths)
    }
  )

  // 获取单个文件的 diff
  ipcMain.handle(
    IPC_CHANNELS.GET_FILE_DIFF,
    async (_, input: GetFileDiffInput) => {
      const { dirPath, filePath, gitRoot, sessionId } = input
      if (!dirPath || !filePath || typeof dirPath !== 'string' || typeof filePath !== 'string') {
        console.warn('[IPC] git:get-file-diff 收到无效参数')
        return ''
      }
      const access = normalizeFileAccessOptions({ sessionId })
      if (!(await ensurePathAllowedWithWorktree(dirPath, access)) || (gitRoot && !(await ensurePathAllowedWithWorktree(gitRoot, access)))) return ''
      return getFileDiff(dirPath, filePath, gitRoot)
    }
  )

  // 获取未追踪文件内容
  ipcMain.handle(
    IPC_CHANNELS.GET_UNTRACKED_CONTENT,
    async (_, input: GetFileDiffInput) => {
      const { dirPath, filePath, gitRoot, sessionId } = input
      if (!dirPath || !filePath || typeof dirPath !== 'string' || typeof filePath !== 'string') {
        console.warn('[IPC] git:get-untracked-content 收到无效参数')
        return ''
      }
      const access = normalizeFileAccessOptions({ sessionId })
      if (!(await ensurePathAllowedWithWorktree(dirPath, access)) || (gitRoot && !(await ensurePathAllowedWithWorktree(gitRoot, access)))) return ''
      return getUntrackedContent(dirPath, filePath, gitRoot)
    }
  )

  // 还原文件变更
  ipcMain.handle(
    IPC_CHANNELS.REVERT_FILE,
    async (_, input: RevertFileInput) => {
      const { dirPath, filePath, gitRoot, sessionId } = input
      if (!dirPath || !filePath || typeof dirPath !== 'string' || typeof filePath !== 'string') {
        console.warn('[IPC] git:revert-file 收到无效参数')
        return
      }
      const access = normalizeFileAccessOptions({ sessionId })
      if (!(await ensurePathAllowedWithWorktree(dirPath, access)) || (gitRoot && !(await ensurePathAllowedWithWorktree(gitRoot, access)))) return
      await revertFile(dirPath, filePath, gitRoot)
    }
  )

  // 获取文件新旧版本内容
  ipcMain.handle(
    IPC_CHANNELS.GET_DIFF_CONTENTS,
    async (_, input: GetFileDiffInput) => {
      const { dirPath, filePath, gitRoot, sessionId } = input
      if (!dirPath || !filePath || typeof dirPath !== 'string' || typeof filePath !== 'string') {
        console.warn('[IPC] git:get-diff-contents 收到无效参数')
        return null
      }
      const access = normalizeFileAccessOptions({ sessionId })
      if (!(await ensurePathAllowedWithWorktree(dirPath, access)) || (gitRoot && !(await ensurePathAllowedWithWorktree(gitRoot, access)))) return null
      return getDiffContents(dirPath, filePath, gitRoot, input.baseRef)
    }
  )

  // 列出 Git Worktree（只读取 worktree 元信息，不涉及文件内容，跳过路径安全检查）
  ipcMain.handle(
    IPC_CHANNELS.LIST_WORKTREES,
    async (_, repoPath: string, _sessionId: string) => {
      if (!repoPath || typeof repoPath !== 'string') return []
      return await listWorktrees(repoPath)
    }
  )

  // 列出新 Agent 会话可选择的 Git 分支
  ipcMain.handle(
    IPC_CHANNELS.LIST_GIT_BRANCHES,
    async (_, input: ListGitBranchesInput): Promise<GitBranchInfo[]> => {
      if (!input || typeof input.repoPath !== 'string' || !input.repoPath) return []
      const access = normalizeFileAccessOptions({ sessionId: input.sessionId })
      if (!(await ensurePathAllowedWithWorktree(input.repoPath, access))) return []
      return listGitBranchesForSession(input)
    }
  )

  // 准备新 Agent 会话 Git 上下文（Local checkout 或 Worktree 创建）
  ipcMain.handle(
    IPC_CHANNELS.PREPARE_SESSION_GIT_CONTEXT,
    async (_, input: PrepareSessionGitContextInput): Promise<PrepareSessionGitContextResult | null> => {
      if (!input || typeof input.sessionId !== 'string' || typeof input.repoPath !== 'string' || !input.repoPath) return null
      const access = normalizeFileAccessOptions({ sessionId: input.sessionId })
      if (!(await ensurePathAllowedWithWorktree(input.repoPath, access))) {
        throw new Error('当前会话无权访问该 Git 仓库')
      }
      return prepareSessionGitContext(input, { updateSessionMeta: updateAgentSessionMeta })
    }
  )

  // 获取 Worktree 相对于基准分支的全量变更
  ipcMain.handle(
    IPC_CHANNELS.GET_WORKTREE_CHANGES,
    async (_, worktreePath: string, baseBranch: string, sessionId: string) => {
      if (!worktreePath || typeof worktreePath !== 'string') {
        return { isGitRepo: false, files: [], untrackedFiles: [], gitRootNames: [] }
      }
      const access = normalizeFileAccessOptions({ sessionId })
      if (!(await ensurePathAllowedWithWorktree(worktreePath, access))) {
        return { isGitRepo: false, files: [], untrackedFiles: [], gitRootNames: [] }
      }
      return getWorktreeChanges(worktreePath, baseBranch)
    }
  )

  // 打开独立预览窗口
  ipcMain.handle(
    IPC_CHANNELS.OPEN_DETACHED_PREVIEW,
    async (event, input: DetachedPreviewWindowInput): Promise<string | null> => {
      if (!input || typeof input.sessionId !== 'string' || typeof input.filePath !== 'string' || typeof input.dirPath !== 'string') {
        console.warn('[IPC] preview:open-detached 收到无效参数')
        return null
      }
      const { openDetachedPreviewWindow } = await import('./lib/detached-preview-window')
      const sourceWindow = BrowserWindow.fromWebContents(event.sender)
      return openDetachedPreviewWindow(input, sourceWindow)
    }
  )

  // 获取独立预览窗口数据
  ipcMain.handle(
    IPC_CHANNELS.GET_DETACHED_PREVIEW_DATA,
    async (_, previewId: string) => {
      if (!previewId || typeof previewId !== 'string') return null
      const { getDetachedPreviewWindowData } = await import('./lib/detached-preview-window')
      return getDetachedPreviewWindowData(previewId)
    }
  )

  // 截图导出
  ipcMain.handle(
    IPC_CHANNELS.SCREENSHOT_CAPTURE,
    async (_, input: { html: string; isDark: boolean; width?: number; mode: 'clipboard' | 'file'; css?: string; themeClass?: string }) => {
      const { captureScreenshot } = await import('./lib/screenshot-service')
      return captureScreenshot(input)
    }
  )

  // 在系统默认浏览器中打开外部链接
  ipcMain.handle(
    IPC_CHANNELS.OPEN_EXTERNAL,
    async (_, url: string): Promise<void> => {
      if (!url || typeof url !== 'string') {
        console.warn('[IPC] shell:open-external 收到无效的 URL')
        return
      }
      // 仅允许 http/https 协议，防止安全风险
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        console.warn('[IPC] shell:open-external 仅支持 http/https 协议:', url)
        return
      }
      await shell.openExternal(url)
    }
  )

  // 在系统剪贴板中写入纯文本
  ipcMain.handle(
    IPC_CHANNELS.WRITE_CLIPBOARD_TEXT,
    async (_, text: string): Promise<void> => {
      if (typeof text !== 'string') {
        throw new TypeError('剪贴板文本必须是字符串')
      }
      clipboard.writeText(text)
    }
  )

  // 用系统默认应用打开任意文件（appName 需在 KNOWN_EDITORS 白名单内）
  ipcMain.handle(
    IPC_CHANNELS.SYSTEM_OPEN_FILE,
    async (_, filePath: string, appName?: string, access?: FileAccessOptions | string[]): Promise<void> => {
      const { resolve } = await import('node:path')
      const absPath = resolve(filePath)
      const options = normalizeFileAccessOptions(access)
      if (!isPathAllowed(absPath, options)) {
        console.warn('[IPC] shell:system-open-file 拒绝越界路径:', absPath)
        return
      }
      if (process.platform === 'darwin') {
        const { spawnSync } = await import('node:child_process')
        if (appName) {
          if (!KNOWN_EDITORS.includes(appName)) {
            console.warn('[IPC] shell:system-open-file 拒绝未知应用:', appName)
            return
          }
          spawnSync('open', ['-a', appName, absPath], { timeout: 5000 })
        } else {
          spawnSync('open', [absPath], { timeout: 5000 })
        }
      } else {
        await shell.openPath(absPath)
      }
    }
  )

  // 扫描系统中的编辑器应用（仅 macOS）
  ipcMain.handle(
    IPC_CHANNELS.SCAN_EDITORS,
    async (): Promise<import('@myyoda/shared').EditorApp[]> => {
      if (process.platform !== 'darwin') return []
      const { existsSync } = await import('node:fs')
      const { homedir } = await import('node:os')
      const home = homedir()

      const editors = KNOWN_EDITORS.map((name) => {
        const searchPaths = name === 'Xcode' || name === 'TextEdit'
          ? [`/Applications/${name}.app`]
          : [`/Applications/${name}.app`, `${home}/Applications/${name}.app`]
        return { name, paths: searchPaths }
      })

      return editors
        .filter((e) => e.paths.some((p) => existsSync(p)))
        .map((e) => ({ name: e.name, path: e.paths.find((p) => existsSync(p))! }))
    }
  )

  // 查询某个文件在本机的默认打开应用信息（带图标）
  ipcMain.handle(
    IPC_CHANNELS.GET_DEFAULT_APP_FOR_FILE,
    async (_, filePath: string, access?: FileAccessOptions | string[]): Promise<import('@myyoda/shared').DefaultAppInfo | null> => {
      if (!filePath || typeof filePath !== 'string') return null
      try {
        const options = normalizeFileAccessOptions(access)
        if (options && !isPathAllowed(filePath, options)) {
          console.warn('[IPC] shell:get-default-app-for-file 拒绝越界路径:', filePath)
          return null
        }
        console.log('[IPC] get-default-app-for-file 收到请求:', filePath)
        const result = await getDefaultAppInfoForFile(filePath, options)
        console.log('[IPC] get-default-app-for-file 返回:', result ? `name=${result.name} appPath=${result.appPath} iconLen=${result.iconDataUrl?.length}` : 'null')
        return result
      } catch (err) {
        console.warn('[IPC] shell:get-default-app-for-file 失败:', err)
        return null
      }
    }
  )

  // ===== 渠道管理相关 =====

  // 获取所有渠道（apiKey 保持加密态）
  ipcMain.handle(
    CHANNEL_IPC_CHANNELS.LIST,
    async (): Promise<Channel[]> => {
      return listChannels()
    }
  )

  // 创建渠道
  ipcMain.handle(
    CHANNEL_IPC_CHANNELS.CREATE,
    async (_, input: ChannelCreateInput): Promise<Channel> => {
      return createChannel(input)
    }
  )

  // 更新渠道
  ipcMain.handle(
    CHANNEL_IPC_CHANNELS.UPDATE,
    async (_, id: string, input: ChannelUpdateInput): Promise<Channel> => {
      return updateChannel(id, input)
    }
  )

  // 删除渠道
  ipcMain.handle(
    CHANNEL_IPC_CHANNELS.DELETE,
    async (_, id: string): Promise<void> => {
      return deleteChannel(id)
    }
  )

  // 解密 API Key（仅在用户查看时调用）
  ipcMain.handle(
    CHANNEL_IPC_CHANNELS.DECRYPT_KEY,
    async (_, channelId: string): Promise<string> => {
      return decryptApiKey(channelId)
    }
  )

  // 测试渠道连接
  ipcMain.handle(
    CHANNEL_IPC_CHANNELS.TEST,
    async (_, channelId: string): Promise<ChannelTestResult> => {
      return testChannel(channelId)
    }
  )

  // 直接测试连接（无需已保存渠道，传入明文凭证）
  ipcMain.handle(
    CHANNEL_IPC_CHANNELS.TEST_DIRECT,
    async (_, input: ChannelDirectTestInput): Promise<ChannelTestResult> => {
      return testChannelDirect(input)
    }
  )

  // 从供应商拉取可用模型列表（直接传入凭证，无需已保存渠道）
  ipcMain.handle(
    CHANNEL_IPC_CHANNELS.FETCH_MODELS,
    async (_, input: FetchModelsInput): Promise<FetchModelsResult> => {
      return fetchModels(input)
    }
  )

  // 查询订阅 Plan 额度（用于 Agent Context 圆环 hover 信息）
  ipcMain.handle(
    CHANNEL_IPC_CHANNELS.GET_PLAN_QUOTA,
    async (_, channelId: string): Promise<import('@myyoda/shared').ChannelPlanQuotaResult> => {
      return getChannelPlanQuota(channelId)
    }
  )

  // 发起 ChatGPT (Codex) OAuth 登录。登录在主进程执行（Pi SDK 用 Node crypto +
  // 本地 :1455 回调服务）；成功后返回序列化的凭据 JSON（明文），由渲染层作为
  // apiKey 传给 create/update，channel-manager 加密后存储——与现有 apiKey 明文回传模式一致。
  ipcMain.handle(
    CHANNEL_IPC_CHANNELS.CODEX_OAUTH_LOGIN,
    async (event, requestedMethod?: CodexOAuthLoginMethod): Promise<import('@myyoda/shared').CodexOAuthLoginResult> => {
      const method: CodexOAuthLoginMethod = requestedMethod === 'device_code' ? 'device_code' : 'browser'
      try {
        const credentials = await loginCodexOAuth({
          method,
          onDeviceCode: (deviceCode) => {
            void withOAuthDeviceCodeQr(deviceCode).then((payload) => {
              if (!event.sender.isDestroyed()) {
                event.sender.send(CHANNEL_IPC_CHANNELS.CODEX_OAUTH_DEVICE_CODE, payload)
              }
            }).catch((error) => console.warn('[OAuth] 发送 Codex device code 失败:', error))
          },
        })
        return {
          success: true,
          credentials: serializeCodexCredentials(credentials),
          ...(credentials.accountId ? { accountId: credentials.accountId } : {}),
        }
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : String(error),
        }
      }
    }
  )

  // 取消进行中的 ChatGPT OAuth 登录流程
  ipcMain.handle(
    CHANNEL_IPC_CHANNELS.CODEX_OAUTH_CANCEL,
    async (): Promise<void> => {
      cancelCodexOAuthLogin()
    }
  )

  // 生成 Claude Pro/Max 订阅登录授权 URL 并打开浏览器（主进程原生 PKCE 流程，
  // 不再 spawn claude 二进制——该二进制的 setup-token 是纯交互式 TUI，正式打包
  // 环境下没有 controlling terminal 会静默挂起，详见 claude-oauth-service.ts）。
  ipcMain.handle(
    CHANNEL_IPC_CHANNELS.CLAUDE_OAUTH_PREPARE,
    async (): Promise<import('@myyoda/shared').ClaudeOAuthPrepareResult> => {
      try {
        const authUrl = prepareClaudeOAuthLogin()
        return { success: true, authUrl }
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : String(error),
        }
      }
    }
  )

  // 用用户从浏览器回调页粘贴的授权码换取凭据；成功后返回序列化的凭据 JSON（明文），
  // 由渲染层作为 apiKey 传给 create/update，channel-manager 加密后存储——与 Codex
  // OAuth、以及现有 apiKey 明文回传模式一致。
  ipcMain.handle(
    CHANNEL_IPC_CHANNELS.CLAUDE_OAUTH_EXCHANGE,
    async (_event, code: string): Promise<import('@myyoda/shared').ClaudeOAuthLoginResult> => {
      try {
        const credentials = await exchangeClaudeOAuthCode(code)
        return {
          success: true,
          credentials: serializeClaudeOAuthCredentials(credentials),
        }
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : String(error),
        }
      }
    }
  )

  // 取消进行中的 Claude 订阅 OAuth 登录流程
  ipcMain.handle(
    CHANNEL_IPC_CHANNELS.CLAUDE_OAUTH_CANCEL,
    async (): Promise<void> => {
      cancelClaudeOAuthLogin()
    }
  )

  // 发起 xAI（Grok/X 订阅）OAuth device-code 登录。Pi 会通过 device-code 事件给出
  // 预填的浏览器授权链接；成功后的凭据沿用 Channel.apiKey 加密存储。
  ipcMain.handle(
    CHANNEL_IPC_CHANNELS.XAI_OAUTH_LOGIN,
    async (event): Promise<import('@myyoda/shared').XaiOAuthLoginResult> => {
      try {
        const credentials = await loginXaiOAuth({
          onDeviceCode: (deviceCode) => {
            void withOAuthDeviceCodeQr(deviceCode).then((payload) => {
              if (!event.sender.isDestroyed()) {
                event.sender.send(CHANNEL_IPC_CHANNELS.XAI_OAUTH_DEVICE_CODE, payload)
              }
            }).catch((error) => console.warn('[OAuth] 发送 xAI device code 失败:', error))
          },
        })
        return { success: true, credentials: serializeXaiCredentials(credentials) }
      } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : String(error) }
      }
    }
  )

  ipcMain.handle(
    CHANNEL_IPC_CHANNELS.XAI_OAUTH_CANCEL,
    async (): Promise<void> => {
      cancelXaiOAuthLogin()
    }
  )

  // ===== 对话管理相关 =====

  // 获取对话列表
  ipcMain.handle(
    CHAT_IPC_CHANNELS.LIST_CONVERSATIONS,
    async (): Promise<ConversationMeta[]> => {
      return listConversations()
    }
  )

  // 创建对话
  ipcMain.handle(
    CHAT_IPC_CHANNELS.CREATE_CONVERSATION,
    async (_, title?: string, modelId?: string, channelId?: string): Promise<ConversationMeta> => {
      return createConversation(title, modelId, channelId)
    }
  )

  // 获取对话消息
  ipcMain.handle(
    CHAT_IPC_CHANNELS.GET_MESSAGES,
    async (_, id: string): Promise<ChatMessage[]> => {
      return getConversationMessages(id)
    }
  )

  // 获取对话最近 N 条消息（分页加载）
  ipcMain.handle(
    CHAT_IPC_CHANNELS.GET_RECENT_MESSAGES,
    async (_, id: string, limit: number): Promise<RecentMessagesResult> => {
      return getRecentMessages(id, limit)
    }
  )

  // 更新对话标题
  ipcMain.handle(
    CHAT_IPC_CHANNELS.UPDATE_TITLE,
    async (_, id: string, title: string): Promise<ConversationMeta> => {
      return updateConversationMeta(id, { title })
    }
  )

  // 更新对话使用的模型/渠道
  ipcMain.handle(
    CHAT_IPC_CHANNELS.UPDATE_MODEL,
    async (_, id: string, modelId: string, channelId: string): Promise<ConversationMeta> => {
      return updateConversationMeta(id, { modelId, channelId })
    }
  )

  // 删除对话
  ipcMain.handle(
    CHAT_IPC_CHANNELS.DELETE_CONVERSATION,
    async (_, id: string): Promise<void> => {
      return deleteConversation(id)
    }
  )

  // 切换对话置顶状态
  ipcMain.handle(
    CHAT_IPC_CHANNELS.TOGGLE_PIN,
    async (_, id: string): Promise<ConversationMeta> => {
      const conversations = listConversations()
      const current = conversations.find((c) => c.id === id)
      if (!current) throw new Error(`对话不存在: ${id}`)
      const newPinned = !current.pinned
      // 置顶时自动取消归档
      const updates: Partial<ConversationMeta> = { pinned: newPinned }
      if (newPinned && current.archived) {
        updates.archived = false
      }
      return updateConversationMeta(id, updates)
    }
  )

  // 切换对话归档状态
  ipcMain.handle(
    CHAT_IPC_CHANNELS.TOGGLE_ARCHIVE,
    async (_, id: string): Promise<ConversationMeta> => {
      const conversations = listConversations()
      const current = conversations.find((c) => c.id === id)
      if (!current) throw new Error(`对话不存在: ${id}`)
      const newArchived = !current.archived
      // 归档时自动取消置顶
      const updates: Partial<ConversationMeta> = { archived: newArchived }
      if (newArchived && current.pinned) {
        updates.pinned = false
      }
      return updateConversationMeta(id, updates)
    }
  )

  // 搜索对话消息内容
  ipcMain.handle(
    CHAT_IPC_CHANNELS.SEARCH_MESSAGES,
    async (_, query: string) => {
      return searchConversationMessages(query)
    }
  )

  // 获取教程内容
  ipcMain.handle(
    CHAT_IPC_CHANNELS.GET_TUTORIAL_CONTENT,
    async (): Promise<string | null> => {
      return getTutorialContent()
    }
  )

  // 创建欢迎对话（含教程附件）
  ipcMain.handle(
    CHAT_IPC_CHANNELS.CREATE_WELCOME_CONVERSATION,
    async (): Promise<ConversationMeta | null> => {
      return createWelcomeConversation()
    }
  )

  // 发送消息（触发 AI 流式响应）
  // 注意：通过 event.sender 获取 webContents 用于推送流式事件
  ipcMain.handle(
    CHAT_IPC_CHANNELS.SEND_MESSAGE,
    async (event, input: ChatSendInput): Promise<void> => {
      await sendMessage(input, event.sender)
    }
  )

  // 中止生成
  ipcMain.handle(
    CHAT_IPC_CHANNELS.STOP_GENERATION,
    async (_, conversationId: string): Promise<void> => {
      stopGeneration(conversationId)
    }
  )

  // 删除消息
  ipcMain.handle(
    CHAT_IPC_CHANNELS.DELETE_MESSAGE,
    async (_, conversationId: string, messageId: string): Promise<ChatMessage[]> => {
      return deleteMessage(conversationId, messageId)
    }
  )

  // 从指定消息开始截断（包含该消息）
  ipcMain.handle(
    CHAT_IPC_CHANNELS.TRUNCATE_MESSAGES_FROM,
    async (
      _,
      conversationId: string,
      messageId: string,
      preserveFirstMessageAttachments?: boolean,
    ): Promise<ChatMessage[]> => {
      return truncateMessagesFrom(
        conversationId,
        messageId,
        preserveFirstMessageAttachments ?? false,
      )
    }
  )

  // 更新上下文分隔线
  ipcMain.handle(
    CHAT_IPC_CHANNELS.UPDATE_CONTEXT_DIVIDERS,
    async (_, conversationId: string, dividers: string[]): Promise<ConversationMeta> => {
      return updateContextDividers(conversationId, dividers)
    }
  )

  // 生成对话标题
  ipcMain.handle(
    CHAT_IPC_CHANNELS.GENERATE_TITLE,
    async (_, input: GenerateTitleInput): Promise<string | null> => {
      return generateTitle(input)
    }
  )

  // ===== 附件管理相关 =====

  // 保存附件到本地
  ipcMain.handle(
    CHAT_IPC_CHANNELS.SAVE_ATTACHMENT,
    async (_, input: AttachmentSaveInput): Promise<AttachmentSaveResult> => {
      return saveAttachment(input)
    }
  )

  // 读取附件（返回 base64）
  ipcMain.handle(
    CHAT_IPC_CHANNELS.READ_ATTACHMENT,
    async (_, localPath: string): Promise<string> => {
      return readAttachmentAsBase64(localPath)
    }
  )

  // 另存图片到用户选择的位置（原生 Save As 对话框）
  ipcMain.handle(
    CHAT_IPC_CHANNELS.SAVE_IMAGE_AS,
    async (event, localPath: string, defaultFilename: string): Promise<boolean> => {
      const { dialog, BrowserWindow } = await import('electron')
      const { writeFileSync } = await import('node:fs')
      const { extname: pathExtname } = await import('node:path')

      const win = BrowserWindow.fromWebContents(event.sender)
      const ext = pathExtname(defaultFilename).replace('.', '').toLowerCase()
      const filterMap: Record<string, string> = { jpg: 'JPEG', jpeg: 'JPEG', png: 'PNG', gif: 'GIF', webp: 'WebP', bmp: 'BMP' }
      const filterName = filterMap[ext] ?? 'Image'

      const result = await dialog.showSaveDialog(win ?? BrowserWindow.getFocusedWindow()!, {
        defaultPath: defaultFilename,
        filters: [
          { name: `${filterName} 图片`, extensions: [ext || 'png'] },
          { name: '所有文件', extensions: ['*'] },
        ],
      })

      if (result.canceled || !result.filePath) return false

      const base64 = readAttachmentAsBase64(localPath)
      writeFileSync(result.filePath, Buffer.from(base64, 'base64'))
      return true
    }
  )

  // 保存应用内置资源文件到用户选择的位置（原生 Save As 对话框）
  ipcMain.handle(
    CHAT_IPC_CHANNELS.SAVE_RESOURCE_FILE_AS,
    async (event, resourceRelativePath: string, defaultFilename: string): Promise<boolean> => {
      const { dialog, BrowserWindow } = await import('electron')
      const { writeFileSync, readFileSync, existsSync } = await import('node:fs')
      const { join, normalize, sep, extname: pathExtname } = await import('node:path')

      // 解析到应用内置 resources 目录（dev 用 __dirname/resources，prod 用 process.resourcesPath）
      const resourcesDir = normalize(getBundledResourcesDir())
      const fullPath = normalize(join(resourcesDir, resourceRelativePath))

      // 安全校验：防止路径穿越（追加 sep 防止 resources-evil 绕过）
      if (!fullPath.startsWith(resourcesDir + sep)) {
        throw new Error('Path traversal not allowed')
      }
      if (!existsSync(fullPath)) {
        throw new Error(`Resource not found: ${resourceRelativePath}`)
      }

      const win = BrowserWindow.fromWebContents(event.sender)
      const ext = pathExtname(defaultFilename).replace('.', '').toLowerCase()
      const filterMap: Record<string, string> = { jpg: 'JPEG', jpeg: 'JPEG', png: 'PNG', gif: 'GIF', webp: 'WebP' }
      const filterName = filterMap[ext] ?? 'Image'

      const result = await dialog.showSaveDialog(win ?? BrowserWindow.getFocusedWindow()!, {
        defaultPath: defaultFilename,
        filters: [
          { name: `${filterName} 图片`, extensions: [ext || 'png'] },
          { name: '所有文件', extensions: ['*'] },
        ],
      })

      if (result.canceled || !result.filePath) return false

      writeFileSync(result.filePath, readFileSync(fullPath))
      return true
    }
  )

  // 删除附件
  ipcMain.handle(
    CHAT_IPC_CHANNELS.DELETE_ATTACHMENT,
    async (_, localPath: string): Promise<void> => {
      deleteAttachment(localPath)
    }
  )

  // 打开文件选择对话框
  ipcMain.handle(
    CHAT_IPC_CHANNELS.OPEN_FILE_DIALOG,
    async (): Promise<FileDialogResult> => {
      return openFileDialog()
    }
  )

  // 提取附件文档的文本内容
  ipcMain.handle(
    CHAT_IPC_CHANNELS.EXTRACT_ATTACHMENT_TEXT,
    async (_, localPath: string): Promise<string> => {
      return extractTextFromAttachment(localPath)
    }
  )

  // ===== 用户档案相关 =====

  // 获取用户档案
  ipcMain.handle(
    USER_PROFILE_IPC_CHANNELS.GET,
    async (): Promise<UserProfile> => {
      return getUserProfile()
    }
  )

  // 更新用户档案
  ipcMain.handle(
    USER_PROFILE_IPC_CHANNELS.UPDATE,
    async (_, updates: Partial<UserProfile>): Promise<UserProfile> => {
      return updateUserProfile(updates)
    }
  )

  // ===== 应用设置相关 =====

  // 获取应用设置
  ipcMain.handle(
    SETTINGS_IPC_CHANNELS.GET,
    async (): Promise<AppSettings> => {
      return getSettings()
    }
  )

  // 更新应用设置
  ipcMain.handle(
    SETTINGS_IPC_CHANNELS.UPDATE,
    async (event, updates: Partial<AppSettings>): Promise<AppSettings> => {
      const result = await updateSettings(updates)

      if (updates.feishuSessionMirror !== undefined) {
        syncFeishuSyncSleepBlocker(result)
      }
      if (updates.codeClaw !== undefined) {
        refreshCodeClawConfiguration()
      }

      // 主题相关设置变化时，广播给所有窗口（跨窗口同步，如 Quick Task 面板）
      if (updates.themeMode !== undefined || updates.themeStyle !== undefined || updates.themePacks !== undefined || updates.themeActiveVariant !== undefined || updates.interfaceVariant !== undefined) {
        const payload = {
          themeMode: result.themeMode,
          themeStyle: result.themeStyle,
          themePacks: result.themePacks,
          themeActiveVariant: result.themeActiveVariant,
          interfaceVariant: result.interfaceVariant,
        }
        BrowserWindow.getAllWindows().forEach((win) => {
          // 跳过发起者窗口，避免重复应用
          if (win.webContents.id !== event.sender.id) {
            win.webContents.send(SETTINGS_IPC_CHANNELS.ON_THEME_SETTINGS_CHANGED, payload)
          }
        })
      }

      return result
    }
  )

  // 同步更新应用设置（用于 beforeunload 场景）
  ipcMain.on(
    SETTINGS_IPC_CHANNELS.UPDATE_SYNC,
    (event, updates: Partial<AppSettings>) => {
      try {
        const result = updateSettings(updates)
        if (updates.feishuSessionMirror !== undefined) {
          syncFeishuSyncSleepBlocker(result)
        }
        if (updates.codeClaw !== undefined) {
          refreshCodeClawConfiguration()
        }
        event.returnValue = true
      } catch {
        event.returnValue = false
      }
    }
  )

  // 获取系统主题（是否深色模式）
  ipcMain.handle(
    SETTINGS_IPC_CHANNELS.GET_SYSTEM_THEME,
    async (): Promise<boolean> => {
      return nativeTheme.shouldUseDarkColors
    }
  )

  // 监听系统主题变化，推送给所有渲染进程窗口
  nativeTheme.on('updated', () => {
    const isDark = nativeTheme.shouldUseDarkColors
    console.log(`[设置] 系统主题变化: ${isDark ? '深色' : '浅色'}`)
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send(SETTINGS_IPC_CHANNELS.ON_SYSTEM_THEME_CHANGED, isDark)
    })
  })

  // ===== Scratch Pad 持久化 =====

  // 从磁盘加载 scratch-pad.md
  ipcMain.handle(
    SCRATCH_PAD_IPC_CHANNELS.LOAD,
    async (): Promise<string> => {
      const path = getScratchPadPath()
      try {
        if (!existsSync(path)) return ''
        return readFileSync(path, 'utf-8')
      } catch (err) {
        console.error('[ScratchPad] 加载失败:', err)
        return ''
      }
    }
  )

  // 异步保存 scratch-pad.md
  ipcMain.handle(
    SCRATCH_PAD_IPC_CHANNELS.SAVE,
    async (_, content: string): Promise<boolean> => {
      const path = getScratchPadPath()
      try {
        await writeFile(path, content, 'utf-8')
        return true
      } catch (err) {
        console.error('[ScratchPad] 保存失败:', err)
        return false
      }
    }
  )

  // 同步保存 scratch-pad.md（beforeunload 场景）
  ipcMain.on(
    SCRATCH_PAD_IPC_CHANNELS.SAVE_SYNC,
    (event, content: string) => {
      try {
        writeFileSync(getScratchPadPath(), content, 'utf-8')
        event.returnValue = true
      } catch (err) {
        console.error('[ScratchPad] 同步保存失败:', err)
        event.returnValue = false
      }
    }
  )

  // 导出为 Markdown 到指定目录
  ipcMain.handle(
    SCRATCH_PAD_IPC_CHANNELS.EXPORT,
    async (_, markdown: string, dirPath: string, filename: string): Promise<string> => {
      let filePath: string
      if (!filename) {
        // 完整文件路径模式（来自保存对话框）
        filePath = dirPath
        const dir = dirname(filePath)
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true })
        }
      } else {
        if (!existsSync(dirPath)) {
          mkdirSync(dirPath, { recursive: true })
        }
        filePath = join(dirPath, filename)
      }
      writeFileSync(filePath, markdown, 'utf-8')
      console.log('[ScratchPad] 已导出:', filePath)
      return filePath
    }
  )

  // 打开保存对话框，返回用户选择的路径
  ipcMain.handle(
    SCRATCH_PAD_IPC_CHANNELS.CHOOSE_EXPORT_PATH,
    async (_, defaultName: string): Promise<string | null> => {
      const win = BrowserWindow.getFocusedWindow()
      if (!win) return null
      const result = await dialog.showSaveDialog(win, {
        title: '导出 Scratch Pad 为 Markdown',
        defaultPath: defaultName,
        filters: [
          { name: 'Markdown', extensions: ['md'] },
          { name: '所有文件', extensions: ['*'] },
        ],
      })
      return result.canceled ? null : result.filePath
    }
  )

  // 将图片 data URL 写入系统剪贴板
  ipcMain.handle(
    SCRATCH_PAD_IPC_CHANNELS.COPY_IMAGE,
    async (_, dataUrl: string): Promise<{ success: boolean; message?: string }> => {
      try {
        if (!dataUrl || typeof dataUrl !== 'string') {
          return { success: false, message: '无效的图片数据' }
        }
        const img = nativeImage.createFromDataURL(dataUrl)
        if (img.isEmpty()) {
          return { success: false, message: '该格式图片暂不支持复制' }
        }
        clipboard.writeImage(img)
        return { success: true }
      } catch (err) {
        console.error('[ScratchPad] 复制图片到剪贴板失败:', err)
        return { success: false, message: '复制失败' }
      }
    }
  )

  // ===== Excalidraw 画布 =====

  // 列出 Workspace 下所有画板文件
  ipcMain.handle(
    EXCALIDRAW_IPC_CHANNELS.LIST,
    async (_, workspaceSlug: string) => {
      if (!workspaceSlug || typeof workspaceSlug !== 'string') return []
      const dir = getExcalidrawDir(workspaceSlug)
      try {
        const entries = readdirSync(dir, { withFileTypes: true })
        const files: Array<{
          slug: string
          title: string
          elementCount: number
          background: string
          mtime: number
          error?: boolean
          // 缩略图渲染用的精简元素快照（不含 files 内嵌图片大字段），
          // 供画廊直接绘制缩略图，避免再对每个文件发起一次 READ + JSON.parse。
          elements?: unknown[]
        }> = []

        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith('.excalidraw')) continue
          const filePath = join(dir, entry.name)
          const title = entry.name.slice(0, -'.excalidraw'.length)
          const slug = titleToSlug(title)
          try {
            const raw = readFileSync(filePath, 'utf-8')
            const data = JSON.parse(raw)
            const elements = (data.elements || []).filter((e: { isDeleted?: boolean }) => !e.isDeleted)
            files.push({
              slug,
              title,
              elementCount: elements.length,
              background: data.appState?.viewBackgroundColor || '#ffffff',
              mtime: statSync(filePath).mtimeMs,
              elements: elements.slice(0, 200),
            })
          } catch {
            files.push({ slug, title, elementCount: 0, background: '#ffffff', mtime: 0, error: true })
          }
        }

        return files.sort((a, b) => b.mtime - a.mtime)
      } catch (err) {
        console.error('[Excalidraw] 列出文件失败:', err)
        return []
      }
    }
  )

  // 读取单个画板文件
  ipcMain.handle(
    EXCALIDRAW_IPC_CHANNELS.READ,
    async (_, workspaceSlug: string, slug: string) => {
      if (!workspaceSlug || !slug) return null
      const dir = getExcalidrawDir(workspaceSlug)
      // 从文件系统找到匹配 slug 的文件
      try {
        const entries = readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith('.excalidraw')) continue
          const title = entry.name.slice(0, -'.excalidraw'.length)
          const entrySlug = titleToSlug(title)
          if (entrySlug !== slug) continue
          const raw = readFileSync(join(dir, entry.name), 'utf-8')
          const data = JSON.parse(raw)
          // 附带文件名派生的真实标题（未经 slug 归一化），供编辑器展示/持久化真实标题用
          return { ...data, title }
        }
        return null
      } catch (err) {
        console.error('[Excalidraw] 读取文件失败:', err)
        return null
      }
    }
  )

  // 新建空白画板文件
  ipcMain.handle(
    EXCALIDRAW_IPC_CHANNELS.CREATE,
    async (_, workspaceSlug: string, title: string) => {
      if (!workspaceSlug || !title?.trim()) throw new Error('参数无效')
      const dir = getExcalidrawDir(workspaceSlug)
      const { finalName, filePath } = resolveExcalidrawCreateName(dir, title)

      const data = {
        type: 'excalidraw',
        version: 2,
        source: 'myyoda',
        elements: [],
        appState: { viewBackgroundColor: '#ffffff' },
        files: {},
      }
      writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')

      const slug = titleToSlug(finalName)
      return { slug, title: finalName }
    }
  )

  // 保存画板文件
  ipcMain.handle(
    EXCALIDRAW_IPC_CHANNELS.WRITE,
    async (_, workspaceSlug: string, slug: string, payload: { elements?: unknown[]; appState?: Record<string, unknown>; files?: Record<string, unknown> }) => {
      if (!workspaceSlug || !slug) throw new Error('参数无效')
      const dir = getExcalidrawDir(workspaceSlug)

      // 找到匹配 slug 的文件
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.excalidraw')) continue
        const title = entry.name.slice(0, -'.excalidraw'.length)
        const entrySlug = titleToSlug(title)
        if (entrySlug !== slug) continue

        const filePath = join(dir, entry.name)
        // 读取现有文件（保留 files 数据中的嵌入图片）
        let existing: Record<string, unknown> = {}
        try {
          existing = JSON.parse(readFileSync(filePath, 'utf-8'))
        } catch { /* 现有文件损坏则覆盖 */ }

        const data = {
          type: 'excalidraw',
          version: 2,
          source: 'myyoda',
          elements: payload.elements || [],
          appState: payload.appState || (existing.appState as Record<string, unknown>) || {},
          // 以本次 payload.files 为准整体替换而非与历史 files 取并集：
          // 调用方（编辑器 getFiles()）返回的始终是场景当前引用到的完整文件集合，
          // 并集合并会导致已从画布删除的内嵌图片永久残留、文件体积单调增长。
          // 仅当调用方压根没传 files 字段时才回退保留旧值，避免误清空。
          files: payload.files !== undefined ? payload.files : ((existing.files as Record<string, unknown>) || {}),
        }
        await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')
        return { ok: true }
      }

      throw new Error(`未找到文件: ${slug}`)
    }
  )

  // 导出到指定路径
  ipcMain.handle(
    EXCALIDRAW_IPC_CHANNELS.EXPORT,
    async (_, workspaceSlug: string, slug: string): Promise<string> => {
      if (!workspaceSlug || !slug) throw new Error('参数无效')
      const dir = getExcalidrawDir(workspaceSlug)

      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.excalidraw')) continue
        const title = entry.name.slice(0, -'.excalidraw'.length)
        const entrySlug = titleToSlug(title)
        if (entrySlug !== slug) continue

        const srcPath = join(dir, entry.name)
        const win = BrowserWindow.getFocusedWindow()
        if (!win) throw new Error('无活跃窗口')

        const result = await dialog.showSaveDialog(win, {
          title: '导出 Excalidraw 画布',
          defaultPath: `${title}.excalidraw`,
          filters: [
            { name: 'Excalidraw', extensions: ['excalidraw'] },
            { name: '所有文件', extensions: ['*'] },
          ],
        })

        if (result.canceled || !result.filePath) return ''
        copyFileSync(srcPath, result.filePath)
        return result.filePath
      }

      throw new Error(`未找到文件: ${slug}`)
    }
  )

  // 打开保存对话框选择导出路径
  ipcMain.handle(
    EXCALIDRAW_IPC_CHANNELS.CHOOSE_EXPORT_PATH,
    async (_, defaultName: string): Promise<string | null> => {
      const win = BrowserWindow.getFocusedWindow()
      if (!win) return null
      const result = await dialog.showSaveDialog(win, {
        title: '保存 Excalidraw 画布',
        defaultPath: defaultName || 'drawing.excalidraw',
        filters: [
          { name: 'Excalidraw', extensions: ['excalidraw'] },
          { name: '所有文件', extensions: ['*'] },
        ],
      })
      return result.canceled ? null : result.filePath
    }
  )

  // 删除画板文件
  ipcMain.handle(
    EXCALIDRAW_IPC_CHANNELS.DELETE,
    async (_, workspaceSlug: string, slug: string) => {
      if (!workspaceSlug || !slug) throw new Error('参数无效')
      const dir = getExcalidrawDir(workspaceSlug)
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.excalidraw')) continue
        const title = entry.name.slice(0, -'.excalidraw'.length)
        const entrySlug = titleToSlug(title)
        if (entrySlug !== slug) continue
        rmSync(join(dir, entry.name))
        return { ok: true }
      }
      throw new Error(`未找到文件: ${slug}`)
    }
  )

  // 重命名画板文件
  ipcMain.handle(
    EXCALIDRAW_IPC_CHANNELS.RENAME,
    async (_, workspaceSlug: string, slug: string, newTitle: string) => {
      if (!workspaceSlug || !slug || !newTitle?.trim()) throw new Error('参数无效')
      const dir = getExcalidrawDir(workspaceSlug)
      const entries = readdirSync(dir, { withFileTypes: true })
      const safeTitle = newTitle.trim().replace(/[\\/:*?"<>|]/g, '-')
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.excalidraw')) continue
        const title = entry.name.slice(0, -'.excalidraw'.length)
        const entrySlug = titleToSlug(title)
        if (entrySlug !== slug) continue
        const oldPath = join(dir, entry.name)
        const newPath = join(dir, `${safeTitle}.excalidraw`)
        const newSlug = titleToSlug(safeTitle)
        if (oldPath !== newPath && existsSync(newPath)) {
          // existsSync 在 macOS/Windows 默认大小写不敏感文件系统上对纯大小写差异也会命中，
          // 用 inode 比较排除"改名后仍是同一份物理文件"（如 Plan → plan）的合法场景。
          const sameFile = (() => {
            try {
              const a = statSync(oldPath)
              const b = statSync(newPath)
              return a.dev === b.dev && a.ino === b.ino
            } catch {
              return false
            }
          })()
          if (!sameFile) throw new Error(`文件 "${safeTitle}" 已存在`)
        }
        if (oldPath !== newPath) {
          const collidesWithOther = entries.some((other) => {
            if (other.name === entry.name || !other.isFile() || !other.name.endsWith('.excalidraw')) return false
            return titleToSlug(other.name.slice(0, -'.excalidraw'.length)) === newSlug
          })
          if (collidesWithOther) throw new Error(`文件 "${safeTitle}" 与已有画布重名（归一化后冲突），请换一个名称`)
        }
        renameSync(oldPath, newPath)
        return { ok: true, slug: newSlug, title: safeTitle }
      }
      throw new Error(`未找到文件: ${slug}`)
    }
  )

  // 同步保存（beforeunload / 应用退出场景）：新画布走同步 CREATE，已有画布走同步 WRITE。
  // 对齐 SETTINGS_IPC_CHANNELS.UPDATE_SYNC / SCRATCH_PAD_IPC_CHANNELS.SAVE_SYNC 的既有约定——
  // beforeunload 里发起的异步 IPC 不保证等到窗口关闭前完成，必须用 sendSync 阻塞等待落盘。
  ipcMain.on(
    EXCALIDRAW_IPC_CHANNELS.SAVE_SYNC,
    (
      event,
      workspaceSlug: string,
      slug: string | null,
      title: string,
      payload: { elements?: unknown[]; appState?: Record<string, unknown>; files?: Record<string, unknown> },
    ) => {
      try {
        if (!workspaceSlug) {
          event.returnValue = null
          return
        }
        const dir = getExcalidrawDir(workspaceSlug)
        let filePath: string | null = null
        let finalSlug = slug
        let finalTitle = title

        if (slug) {
          const entries = readdirSync(dir, { withFileTypes: true })
          for (const entry of entries) {
            if (!entry.isFile() || !entry.name.endsWith('.excalidraw')) continue
            if (titleToSlug(entry.name.slice(0, -'.excalidraw'.length)) !== slug) continue
            filePath = join(dir, entry.name)
            break
          }
        }

        if (!filePath) {
          const created = resolveExcalidrawCreateName(dir, title || '未命名画布')
          filePath = created.filePath
          finalSlug = titleToSlug(created.finalName)
          finalTitle = created.finalName
        }

        let existing: Record<string, unknown> = {}
        try {
          existing = JSON.parse(readFileSync(filePath, 'utf-8'))
        } catch { /* 新文件或已损坏，直接覆盖 */ }

        const data = {
          type: 'excalidraw',
          version: 2,
          source: 'myyoda',
          elements: payload.elements || [],
          appState: payload.appState || (existing.appState as Record<string, unknown>) || {},
          files: payload.files !== undefined ? payload.files : ((existing.files as Record<string, unknown>) || {}),
        }
        writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
        event.returnValue = { ok: true, slug: finalSlug, title: finalTitle }
      } catch (err) {
        console.error('[Excalidraw] 同步保存失败:', err)
        event.returnValue = null
      }
    }
  )

  // ===== Dock/Launcher 角标 =====

  ipcMain.handle(
    DOCK_BADGE_IPC_CHANNELS.SET_COUNT,
    async (_, count: number): Promise<boolean> => {
      return setDockBadgeCount(count)
    }
  )

  // ===== 环境检测相关 =====

  // 执行环境检测
  ipcMain.handle(
    ENVIRONMENT_IPC_CHANNELS.CHECK,
    async (): Promise<EnvironmentCheckResult> => {
      const result = await checkEnvironment()
      // 自动保存检测结果到设置
      await updateSettings({
        lastEnvironmentCheck: result,
      })
      return result
    }
  )

  // ===== 第三方安装包（Git / Node.js）相关 =====

  ipcMain.handle(
    INSTALLER_IPC_CHANNELS.MANIFEST,
    async (): Promise<InstallerManifest> => {
      return fetchInstallerManifest()
    }
  )

  ipcMain.handle(
    INSTALLER_IPC_CHANNELS.DOWNLOAD,
    async (event, req: InstallerDownloadRequest): Promise<InstallerDownloadResult> => {
      const manifest = await fetchInstallerManifest()
      const source = findInstallerSource(manifest, req.id, req.arch)
      if (!source) {
        throw new Error(`未找到安装包：id=${req.id}, arch=${req.arch}`)
      }
      const window = BrowserWindow.fromWebContents(event.sender)
      if (!window) {
        throw new Error('发起下载的窗口已关闭')
      }
      const key = `${req.id}:${req.arch}`
      return downloadInstaller(source, key, window)
    }
  )

  ipcMain.handle(
    INSTALLER_IPC_CHANNELS.CANCEL,
    async (_event, key: string): Promise<boolean> => {
      return cancelInstallerDownload(key)
    }
  )

  ipcMain.handle(
    INSTALLER_IPC_CHANNELS.LAUNCH,
    async (_event, filePath: string): Promise<void> => {
      await launchInstaller(filePath)
    }
  )

  // ===== 代理配置相关 =====

  // 获取代理配置
  ipcMain.handle(
    PROXY_IPC_CHANNELS.GET_SETTINGS,
    async (): Promise<ProxyConfig> => {
      return getProxySettings()
    }
  )

  // 更新代理配置
  ipcMain.handle(
    PROXY_IPC_CHANNELS.UPDATE_SETTINGS,
    async (_, config: ProxyConfig): Promise<void> => {
      await saveProxySettings(config)
    }
  )

  // 检测系统代理
  ipcMain.handle(
    PROXY_IPC_CHANNELS.DETECT_SYSTEM,
    async (): Promise<SystemProxyDetectResult> => {
      return detectSystemProxy()
    }
  )

  // ===== Agent 会话管理相关 =====

  // 获取 Agent 会话列表
  ipcMain.handle(
    AGENT_IPC_CHANNELS.LIST_SESSIONS,
    async (): Promise<AgentSessionMeta[]> => listAgentSessions()
  )

  // 创建 Agent 会话
  ipcMain.handle(
    AGENT_IPC_CHANNELS.CREATE_SESSION,
    async (_, title?: string, channelId?: string, workspaceId?: string, modelId?: string): Promise<AgentSessionMeta> => {
      const session = createAgentSession(title, channelId, workspaceId, modelId, getSettings().agentRuntime ?? 'pi')
      feishuBridgeManager.ensureSessionMirror(session).catch((error) => {
        console.error('[飞书 Session 镜像] 新会话建群失败:', error)
      })
      return session
    }
  )

  // 获取 Agent 会话 SDKMessage（Phase 4 新格式）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_SDK_MESSAGES,
    async (_, id: string): Promise<SDKMessage[]> => {
      return getAgentSessionSDKMessages(id)
    }
  )

  // 更新 Agent 会话标题
  ipcMain.handle(
    AGENT_IPC_CHANNELS.UPDATE_TITLE,
    async (_, id: string, title: string): Promise<AgentSessionMeta> => {
      return updateAgentSessionMeta(id, { title, titleSource: 'manual' })
    }
  )

  // 更新 Agent 会话模型选择
  ipcMain.handle(
    AGENT_IPC_CHANNELS.UPDATE_SESSION_MODEL,
    async (_, id: string, channelId?: string, modelId?: string): Promise<AgentSessionMeta> => {
      // 模型切换允许在运行中提交；当前 query 继续使用启动时的模型，下一轮读取新配置。
      return updateAgentSessionMeta(id, { channelId, modelId })
    }
  )

  // 生成 Agent 会话标题
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GENERATE_TITLE,
    async (_, input: AgentGenerateTitleInput): Promise<string | null> => {
      return generateAgentTitle(input)
    }
  )

  // 删除 Agent 会话
  ipcMain.handle(
    AGENT_IPC_CHANNELS.DELETE_SESSION,
    async (_, id: string): Promise<void> => {
      const sessions = listAgentSessions()
      const target = sessions.find((session) => session.id === id)
      const idsToDelete = target?.taskDraft
        ? collectSessionDescendantIds(sessions, id).concat(id)
        : [id]

      for (const sessionId of idsToDelete) {
        if (isAgentSessionActive(sessionId)) stopAgent(sessionId)
        // 清理权限服务中该会话的白名单
        permissionService.clearSessionWhitelist(sessionId)
        permissionService.clearSessionPending(sessionId)
        // 清理 AskUser 服务中的待处理请求
        askUserService.clearSessionPending(sessionId)
        // 清理 ExitPlanMode 服务中的待处理请求
        exitPlanService.clearSessionPending(sessionId)
        deleteAgentSession(sessionId)
      }
    }
  )

  // 迁移 Chat 对话记录到 Agent 会话
  ipcMain.handle(
    AGENT_IPC_CHANNELS.MIGRATE_CHAT_TO_AGENT,
    async (_, conversationId: string, agentSessionId: string): Promise<void> => {
      migrateChatToAgentSession(conversationId, agentSessionId)
    }
  )

  // 切换 Agent 会话置顶状态
  ipcMain.handle(
    AGENT_IPC_CHANNELS.TOGGLE_PIN,
    async (_, id: string): Promise<AgentSessionMeta> => {
      const sessions = listAgentSessions()
      const current = sessions.find((s) => s.id === id)
      if (!current) throw new Error(`Agent session not found: ${id}`)
      const newPinned = !current.pinned
      // 置顶时自动取消归档
      const updates: Partial<AgentSessionMeta> = { pinned: newPinned }
      if (newPinned && current.archived) {
        updates.archived = false
      }
      return updateAgentSessionMeta(id, updates)
    }
  )

  // 切换 Agent 会话星标状态
  ipcMain.handle(
    AGENT_IPC_CHANNELS.TOGGLE_STAR,
    async (_, id: string): Promise<AgentSessionMeta> => {
      const sessions = listAgentSessions()
      const current = sessions.find((s) => s.id === id)
      if (!current) throw new Error(`Agent session not found: ${id}`)
      return updateAgentSessionMeta(id, { starred: !current.starred })
    }
  )

  // 清除 Agent 会话完成状态（兼容清除旧版 manualWorking）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.CLEAR_COMPLETION_STATE,
    async (_, id: string): Promise<AgentSessionMeta> => {
      const sessions = listAgentSessions()
      const current = sessions.find((s) => s.id === id)
      if (!current) throw new Error(`Agent session not found: ${id}`)
      const updates: Partial<AgentSessionMeta> = {}
      if (current.manualWorking) updates.manualWorking = false
      if (current.completedButUnconfirmed) updates.completedButUnconfirmed = false
      if (Object.keys(updates).length === 0) return current
      return updateAgentSessionMeta(id, updates)
    }
  )

  // 切换 Agent 会话归档状态
  ipcMain.handle(
    AGENT_IPC_CHANNELS.TOGGLE_ARCHIVE,
    async (_, id: string): Promise<AgentSessionMeta> => {
      const sessions = listAgentSessions()
      const current = sessions.find((s) => s.id === id)
      if (!current) throw new Error(`Agent session not found: ${id}`)
      const newArchived = !current.archived
      // 归档时自动取消置顶
      const updates: Partial<AgentSessionMeta> = { archived: newArchived }
      if (newArchived && current.pinned) {
        updates.pinned = false
      }
      return updateAgentSessionMeta(id, updates)
    }
  )

  // 搜索 Agent 会话消息内容
  ipcMain.handle(
    AGENT_IPC_CHANNELS.SEARCH_MESSAGES,
    async (_, query: string) => {
      return searchAgentSessionMessages(query)
    }
  )

  // 搜索可引用的 Agent 会话；省略 workspaceId 时跨工作区搜索。
  ipcMain.handle(
    AGENT_IPC_CHANNELS.SEARCH_SESSION_REFERENCES,
    async (_, input: AgentSessionReferenceSearchInput) => {
      return searchAgentSessionReferences(input)
    }
  )

  // 迁移 Agent 会话到另一个工作区
  ipcMain.handle(
    AGENT_IPC_CHANNELS.MOVE_SESSION_TO_WORKSPACE,
    async (_, input: MoveSessionToWorkspaceInput): Promise<AgentSessionMeta> => {
      // 渲染进程的 running 状态可能比主进程 activeSessions 清理更早变为 false
      // （STREAM_COMPLETE 在 finally 之前发送），短暂等待后重试一次
      if (isAgentSessionActive(input.sessionId)) {
        await new Promise((r) => setTimeout(r, 500))
        if (isAgentSessionActive(input.sessionId)) {
          throw new Error('会话正在运行中，请停止后再迁移')
        }
      }
      return moveSessionToWorkspace(input.sessionId, input.targetWorkspaceId)
    }
  )

  // 分叉 Agent 会话
  ipcMain.handle(
    AGENT_IPC_CHANNELS.FORK_SESSION,
    async (_, input: ForkSessionInput): Promise<AgentSessionMeta> => {
      const session = await forkAgentSession(input)
      // Fork 直接在 session manager 内创建元数据，绕过 CREATE_SESSION 的镜像生命周期。
      // 将它作为新的桌面会话处理，确保 Pi fork 也会立即获得可双向续聊的飞书群。
      feishuBridgeManager.ensureSessionMirror(session).catch((error) => {
        console.error('[飞书 Session 镜像] 分叉会话建群失败:', error)
      })
      return session
    }
  )

  // 快照回退（同一会话内回退到指定点）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.REWIND_SESSION,
    async (_, input: RewindSessionInput): Promise<RewindSessionResult> => {
      return rewindAgentSession(
        input.sessionId,
        input.assistantMessageUuid,
      )
    }
  )

  // ===== Agent 工作区管理相关 =====

  // 确保默认工作区存在
  ensureDefaultWorkspace()

  // 获取 Agent 工作区列表
  ipcMain.handle(
    AGENT_IPC_CHANNELS.LIST_WORKSPACES,
    async (): Promise<AgentWorkspace[]> => {
      return listAgentWorkspaces()
    }
  )

  // 创建 Agent 工作区
  ipcMain.handle(
    AGENT_IPC_CHANNELS.CREATE_WORKSPACE,
    async (_, name: string): Promise<AgentWorkspace> => {
      return createAgentWorkspace(name)
    }
  )

  // 更新 Agent 工作区
  ipcMain.handle(
    AGENT_IPC_CHANNELS.UPDATE_WORKSPACE,
    async (_, id: string, updates: { name: string }): Promise<AgentWorkspace> => {
      return updateAgentWorkspace(id, updates)
    }
  )

  // 删除 Agent 工作区
  ipcMain.handle(
    AGENT_IPC_CHANNELS.DELETE_WORKSPACE,
    async (_, id: string): Promise<void> => {
      const deletingWorkspace = getAgentWorkspace(id)
      if (!deletingWorkspace) {
        return deleteAgentWorkspace(id)
      }

      // 守卫前置：在删除任何会话/自动任务前就拦截不可删除的工作区，
      // 否则会先把绑定数据删光、再由 deleteAgentWorkspace 抛错，造成数据丢失与状态不一致
      if (deletingWorkspace.slug === 'default') {
        throw new Error('默认空间不能删除')
      }
      if (listAgentWorkspaces().length <= 1) {
        throw new Error('至少需要保留一个空间')
      }

      const affectedSessionIds = listAgentSessions()
        .filter((session) => session.workspaceId === id)
        .map((session) => session.id)
      const affectedAutomationIds = listAutomations()
        .filter((automation) => automation.workspaceId === id)
        .map((automation) => automation.id)

      for (const sessionId of affectedSessionIds) {
        if (isAgentSessionActive(sessionId)) {
          stopAgent(sessionId)
        }
        deleteAgentSession(sessionId)
      }
      for (const automationId of affectedAutomationIds) {
        deleteAutomation(automationId)
      }
      if (affectedAutomationIds.length > 0) {
        broadcastAutomationsChanged()
      }
      deleteAgentWorkspace(id)
    }
  )

  // 重排工作区顺序
  ipcMain.handle(
    AGENT_IPC_CHANNELS.REORDER_WORKSPACES,
    async (_, orderedIds: string[]): Promise<AgentWorkspace[]> => {
      return reorderAgentWorkspaces(orderedIds)
    }
  )

  // ===== 工作区能力（MCP + Skill） =====

  // 获取工作区能力摘要
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_CAPABILITIES,
    async (_, workspaceSlug: string): Promise<WorkspaceCapabilities> => {
      return getWorkspaceCapabilities(workspaceSlug)
    }
  )

  // 获取工作区 MCP 配置
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_MCP_CONFIG,
    async (_, workspaceSlug: string): Promise<WorkspaceMcpConfig> => {
      return getWorkspaceMcpConfig(workspaceSlug)
    }
  )

  // 保存工作区 MCP 配置
  ipcMain.handle(
    AGENT_IPC_CHANNELS.SAVE_MCP_CONFIG,
    async (_, workspaceSlug: string, config: WorkspaceMcpConfig): Promise<void> => {
      return saveWorkspaceMcpConfig(workspaceSlug, config)
    }
  )

  // 测试 MCP 服务器连接
  ipcMain.handle(
    AGENT_IPC_CHANNELS.TEST_MCP_SERVER,
    async (_, name: string, entry: import('@myyoda/shared').McpServerEntry): Promise<{ success: boolean; message: string }> => {
      const { validateMcpServer } = await import('./lib/mcp-validator')
      const result = await validateMcpServer(name, entry)
      return {
        success: result.valid,
        message: result.valid ? '连接成功' : (result.reason || '连接失败'),
      }
    }
  )

  // 启用或关闭 MyYoda 内置 MCP
  ipcMain.handle(
    AGENT_IPC_CHANNELS.SET_BUILTIN_MCP_ENABLED,
    async (_, workspaceSlug: string, id: string, enabled: boolean): Promise<WorkspaceCapabilities> => {
      setBuiltinMcpUserEnabled(id, enabled)
      return getWorkspaceCapabilities(workspaceSlug)
    }
  )

  // 获取工作区 Skill 列表（含活跃和不活跃，设置页 UI 用）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_SKILLS,
    async (_, workspaceSlug: string): Promise<SkillMeta[]> => {
      return getAllWorkspaceSkills(workspaceSlug)
    }
  )

  // 获取工作区 Skills 目录绝对路径
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_SKILLS_DIR,
    async (_, workspaceSlug: string): Promise<string> => {
      return getWorkspaceSkillsDir(workspaceSlug)
    }
  )

  // 删除工作区 Skill
  ipcMain.handle(
    AGENT_IPC_CHANNELS.DELETE_SKILL,
    async (_, workspaceSlug: string, skillSlug: string): Promise<void> => {
      return deleteWorkspaceSkill(workspaceSlug, skillSlug)
    }
  )

  // 切换工作区 Skill 启用/禁用
  ipcMain.handle(
    AGENT_IPC_CHANNELS.TOGGLE_SKILL,
    async (_, workspaceSlug: string, skillSlug: string, enabled: boolean): Promise<void> => {
      return toggleWorkspaceSkill(workspaceSlug, skillSlug, enabled)
    }
  )

  // 获取其他工作区的 Skill 列表
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_OTHER_WORKSPACE_SKILLS,
    async (_, currentSlug: string) => {
      return getOtherWorkspaceSkills(currentSlug)
    }
  )

  // 获取默认 Skills 的 slug 列表（来自 ~/.myyoda/default-skills/）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_DEFAULT_SKILL_SLUGS,
    async () => {
      return getDefaultSkillSlugs()
    }
  )

  // 从其他工作区导入 Skill
  ipcMain.handle(
    AGENT_IPC_CHANNELS.IMPORT_SKILL_FROM_WORKSPACE,
    async (_, targetSlug: string, sourceSlug: string, skillSlug: string): Promise<SkillMeta> => {
      return importSkillFromWorkspace(targetSlug, sourceSlug, skillSlug)
    }
  )

  // 从其他工作区批量导入多个 Skill
  ipcMain.handle(
    AGENT_IPC_CHANNELS.BATCH_IMPORT_SKILLS_FROM_WORKSPACES,
    async (_, targetSlug: string, selections: BulkImportWorkspaceSelection[]): Promise<BulkImportSkillsResult> => {
      return batchImportSkillsFromWorkspaces(targetSlug, selections)
    }
  )

  // 从源工作区同步更新已导入的 Skill
  ipcMain.handle(
    AGENT_IPC_CHANNELS.UPDATE_SKILL_FROM_SOURCE,
    async (_, targetSlug: string, skillSlug: string): Promise<SkillMeta> => {
      return updateSkillFromSource(targetSlug, skillSlug)
    }
  )

  // ── 企业版组织 Skills 分发 ───────────────────────────────

  // 获取组织连接配置
  ipcMain.handle(
    AGENT_IPC_CHANNELS.ORG_GET_CONNECTION,
    async (): Promise<ReturnType<typeof getOrganizationConnection>> => {
      return getOrganizationConnection()
    }
  )

  // 登出（清除连接配置）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.ORG_SET_CONNECTION,
    async (_, mode: 'logout' | 'set', conn?: Parameters<typeof setOrganizationConnection>[0]): Promise<ReturnType<typeof getOrganizationConnection>> => {
      if (mode === 'logout') {
        clearOrganizationConnection()
      } else if (conn) {
        setOrganizationConnection(conn)
      }
      return getOrganizationConnection()
    }
  )

  // 登录/注册/API Key 连接（写连接配置）
  ipcMain.handle(
    'org:authenticate',
    async (
      _,
      action: 'login' | 'register' | 'apikey',
      serverUrl: string,
      email: string,
      password: string,
      displayName?: string,
      apiKey?: string,
    ) => {
      if (action === 'apikey') {
        return orgConnectWithApiKey(serverUrl, apiKey ?? '')
      }
      return action === 'register'
        ? orgRegister(serverUrl, email, password, displayName)
        : orgLogin(serverUrl, email, password)
    }
  )

  // 我的组织与角色
  ipcMain.handle(
    AGENT_IPC_CHANNELS.ORG_ME,
    async (): Promise<Awaited<ReturnType<typeof orgMe>>> => {
      const conn = getOrganizationConnection()
      if (!conn) throw new Error('未连接组织服务，请先登录')
      return orgMe(conn)
    }
  )

  // 创建组织
  ipcMain.handle(
    AGENT_IPC_CHANNELS.ORG_CREATE,
    async (_, name: string): Promise<Awaited<ReturnType<typeof orgCreate>>> => {
      const conn = getOrganizationConnection()
      if (!conn) throw new Error('未连接组织服务，请先登录')
      return orgCreate(conn, name)
    }
  )

  // 凭邀请码加入组织
  ipcMain.handle(
    AGENT_IPC_CHANNELS.ORG_JOIN,
    async (_, inviteCode: string): Promise<Awaited<ReturnType<typeof orgJoin>>> => {
      const conn = getOrganizationConnection()
      if (!conn) throw new Error('未连接组织服务，请先登录')
      return orgJoin(conn, inviteCode)
    }
  )

  // 列出组织成员
  ipcMain.handle(
    AGENT_IPC_CHANNELS.ORG_LIST_MEMBERS,
    async (_, orgId: string): Promise<Awaited<ReturnType<typeof orgListMembers>>> => {
      const conn = getOrganizationConnection()
      if (!conn) throw new Error('未连接组织服务，请先登录')
      return orgListMembers(conn, orgId)
    }
  )

  // 列出组织 Skills
  ipcMain.handle(
    AGENT_IPC_CHANNELS.ORG_LIST_SKILLS,
    async (_, orgId: string): Promise<Awaited<ReturnType<typeof orgListSkills>>> => {
      const conn = getOrganizationConnection()
      if (!conn) throw new Error('未连接组织服务，请先登录')
      return orgListSkills(conn, orgId)
    }
  )

  // 导入组织 Skill 到工作区
  ipcMain.handle(
    AGENT_IPC_CHANNELS.ORG_IMPORT_SKILL,
    async (
      _,
      targetSlug: string,
      orgId: string,
      orgName: string,
      skill: Parameters<typeof importSkillFromOrganization>[4],
    ): Promise<SkillMeta> => {
      const conn = getOrganizationConnection()
      if (!conn) throw new Error('未连接组织服务，请先登录')
      return importSkillFromOrganization(targetSlug, conn, orgId, orgName, skill)
    }
  )

  // 从组织源更新已导入 Skill
  ipcMain.handle(
    AGENT_IPC_CHANNELS.ORG_UPDATE_SKILL,
    async (_, targetSlug: string, skillSlug: string): Promise<SkillMeta> => {
      const conn = getOrganizationConnection()
      if (!conn) throw new Error('未连接组织服务，请先登录')
      return updateSkillFromOrganizationSource(targetSlug, skillSlug, conn)
    }
  )

  // ── 社区市场 ─────────────────────────────────

  // 拉取社区市场清单
  ipcMain.handle(
    AGENT_IPC_CHANNELS.COMMUNITY_FETCH_MANIFEST,
    async (): Promise<CommunitySkill[]> => {
      return fetchCommunityManifest()
    }
  )

  // 安装社区市场 Skill 到工作区
  ipcMain.handle(
    AGENT_IPC_CHANNELS.COMMUNITY_INSTALL_SKILL,
    async (_, workspaceSlug: string, skill: CommunitySkill): Promise<CommunitySkillInstallResult> => {
      const { getWorkspaceSkillsDir } = await import('./lib/config-paths')
      const dir = getWorkspaceSkillsDir(workspaceSlug)
      return installCommunitySkill(dir, skill)
    }
  )

  // 检测本机 gh CLI 安装 / 登录状态
  ipcMain.handle(
    AGENT_IPC_CHANNELS.COMMUNITY_CHECK_GH_CLI,
    async (): Promise<GhCliStatus> => {
      return getGhCliStatus()
    }
  )

  // 提交本地 Skill 到社区市场（gh CLI 自动建 PR）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.COMMUNITY_SUBMIT_SKILL,
    async (_, input: SkillSubmissionInput): Promise<SkillSubmissionResult> => {
      return submitSkillToCommunity(input)
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.READ_SKILL_CONTENT,
    async (_, workspaceSlug: string, skillSlug: string): Promise<string> => {
      return readWorkspaceSkillContent(workspaceSlug, skillSlug)
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.WRITE_SKILL_CONTENT,
    async (_, workspaceSlug: string, skillSlug: string, content: string): Promise<void> => {
      writeWorkspaceSkillContent(workspaceSlug, skillSlug, content)
    }
  )

  // ===== Skill 子文件管理 =====

  ipcMain.handle(
    AGENT_IPC_CHANNELS.LIST_SKILL_FILES,
    async (_, workspaceSlug: string, skillSlug: string) => {
      return listSkillFiles(workspaceSlug, skillSlug)
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.READ_SKILL_FILE,
    async (_, workspaceSlug: string, skillSlug: string, relativePath: string) => {
      return readSkillFile(workspaceSlug, skillSlug, relativePath)
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.WRITE_SKILL_FILE,
    async (_, workspaceSlug: string, skillSlug: string, relativePath: string, content: string): Promise<void> => {
      writeSkillFile(workspaceSlug, skillSlug, relativePath, content)
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.CREATE_SKILL_ENTRY,
    async (_, workspaceSlug: string, skillSlug: string, relativePath: string, type: 'file' | 'directory'): Promise<void> => {
      createSkillEntry(workspaceSlug, skillSlug, relativePath, type)
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.DELETE_SKILL_ENTRY,
    async (_, workspaceSlug: string, skillSlug: string, relativePath: string): Promise<void> => {
      deleteSkillEntry(workspaceSlug, skillSlug, relativePath)
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.RENAME_SKILL_ENTRY,
    async (_, workspaceSlug: string, skillSlug: string, fromRelative: string, toRelative: string): Promise<void> => {
      renameSkillEntry(workspaceSlug, skillSlug, fromRelative, toRelative)
    }
  )

  // ===== 工作区记忆文件管理 =====

  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_WORKSPACE_MEMORY_SUMMARY,
    async (_, workspaceSlug: string): Promise<WorkspaceMemorySummary> => {
      return getWorkspaceMemorySummary(workspaceSlug)
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.READ_WORKSPACE_AGENTS_MD,
    async (_, workspaceSlug: string): Promise<SkillFileContent> => {
      return readWorkspaceAgentsMd(workspaceSlug)
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.WRITE_WORKSPACE_AGENTS_MD,
    async (_, workspaceSlug: string, content: string): Promise<void> => {
      writeWorkspaceAgentsMd(workspaceSlug, content)
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.LIST_WORKSPACE_AUTO_MEMORY_FILES,
    async (_, workspaceSlug: string) => {
      return listWorkspaceAutoMemoryFiles(workspaceSlug)
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.READ_WORKSPACE_AUTO_MEMORY_FILE,
    async (_, workspaceSlug: string, relativePath: string): Promise<SkillFileContent> => {
      return readWorkspaceAutoMemoryFile(workspaceSlug, relativePath)
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.WRITE_WORKSPACE_AUTO_MEMORY_FILE,
    async (_, workspaceSlug: string, relativePath: string, content: string): Promise<void> => {
      writeWorkspaceAutoMemoryFile(workspaceSlug, relativePath, content)
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.APPROVE_WORKSPACE_PROJECT_KNOWLEDGE_MAINTENANCE,
    async (_, workspaceSlug: string): Promise<void> => {
      approveWorkspaceProjectKnowledgeMaintenance(workspaceSlug)
    }
  )

  ipcMain.handle(AGENT_IPC_CHANNELS.OPEN_WORKSPACE_MEMORY_WINDOW, async (_, workspaceSlug: string, relativePath?: string): Promise<void> => {
    // 先经既有受限访问层核验 slug；若指定文件，也用受限路径解析器验证。
    getWorkspaceMemorySummary(workspaceSlug)
    if (relativePath !== undefined) {
      if (typeof relativePath !== 'string' || !relativePath) throw new Error('记忆文件路径非法')
      readWorkspaceAutoMemoryFile(workspaceSlug, relativePath)
    }
    const { showWorkspaceMemoryWindow } = await import('./lib/workspace-memory-window')
    showWorkspaceMemoryWindow(workspaceSlug, relativePath)
  })

  ipcMain.handle(
    AGENT_IPC_CHANNELS.WORKSPACE_MEMORY_WINDOW_READY,
    async (event, workspaceSlug: string): Promise<void> => {
      if (!markWorkspaceMemoryWindowReady(workspaceSlug, event.sender.id)) {
        throw new Error('记忆窗口不存在或不属于当前渲染进程')
      }
    },
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.CONFIRM_WORKSPACE_MEMORY_WINDOW_CLOSE,
    async (event, workspaceSlug: string): Promise<void> => {
      if (!confirmWorkspaceMemoryWindowClose(workspaceSlug, event.sender.id)) {
        throw new Error('记忆窗口不存在或不属于当前渲染进程')
      }
    },
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.START_WORKSPACE_MEMORY_WATCH,
    async (event, workspaceSlug: string): Promise<void> => {
      const webContents = event.sender
      stopWorkspaceMemoryWatch(webContents.id, workspaceSlug)
      const unsubscribe = subscribeWorkspaceMemoryChanges(workspaceSlug, (change) => {
        if (!webContents.isDestroyed()) {
          webContents.send(AGENT_IPC_CHANNELS.WORKSPACE_MEMORY_FILE_CHANGED, { workspaceSlug, change })
        }
      })
      const subscriptions = workspaceMemoryWatchSubscriptions.get(webContents.id) ?? new Map<string, () => void>()
      subscriptions.set(workspaceSlug, unsubscribe)
      workspaceMemoryWatchSubscriptions.set(webContents.id, subscriptions)
      if (!workspaceMemoryWatchDestroyedListeners.has(webContents.id)) {
        workspaceMemoryWatchDestroyedListeners.add(webContents.id)
        webContents.once('destroyed', () => {
          const active = workspaceMemoryWatchSubscriptions.get(webContents.id)
          if (active) {
            for (const stop of active.values()) stop()
            workspaceMemoryWatchSubscriptions.delete(webContents.id)
          }
          workspaceMemoryWatchDestroyedListeners.delete(webContents.id)
        })
      }
    },
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.STOP_WORKSPACE_MEMORY_WATCH,
    async (event, workspaceSlug: string): Promise<void> => {
      stopWorkspaceMemoryWatch(event.sender.id, workspaceSlug)
    },
  )

  // 发送 Agent 消息（触发 Agent SDK 流式响应）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.SEND_MESSAGE,
    async (event, input: AgentSendInput): Promise<void> => {
      const session = getAgentSessionMeta(input.sessionId)
      if (session) {
        await feishuBridgeManager.startSessionMirrorRun(session).catch((error) => {
          console.error('[飞书 Session 镜像] 流式卡片初始化失败:', error)
        })
      }
      await runAgent(input, event.sender)
    }
  )

  // 中止 Agent 执行
  ipcMain.handle(
    AGENT_IPC_CHANNELS.STOP_AGENT,
    async (_, sessionId: string): Promise<void> => {
      feishuBridgeManager.stopSessionMirrorRun(sessionId)
      stopAgent(sessionId)
    }
  )

  // 会话级拉专家/专家团 cowork（创建注入专家人设的子会话）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.SPAWN_EXPERT_COWORK,
    async (
      _,
      input: import('@myyoda/shared').SpawnExpertCoworkInput,
    ): Promise<import('@myyoda/shared').SpawnExpertCoworkResult> => {
      if (!input || typeof input !== 'object') throw new Error('input 必须是对象')
      if (typeof input.parentSessionId !== 'string' || input.parentSessionId.length === 0) {
        throw new Error('parentSessionId 必填')
      }
      if (typeof input.expertId === 'string' && typeof input.teamId === 'string') {
        throw new Error('expertId 与 teamId 不能同时指定')
      }
      return spawnExpertCowork(input.parentSessionId, input)
    }
  )

  // ===== Agent 队列消息 =====

  // 排队发送消息
  ipcMain.handle(
    AGENT_IPC_CHANNELS.QUEUE_MESSAGE,
    async (event, input: import('@myyoda/shared').AgentQueueMessageInput): Promise<string> => {
      return queueAgentMessage(input, event.sender)
    }
  )

  // ===== Agent 后台任务管理 =====

  // 获取任务输出（保留接口，供未来扩展）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_TASK_OUTPUT,
    async (_, input: GetTaskOutputInput): Promise<GetTaskOutputResult> => {
      try {
        // TODO: 实现通过 SDK 的 TaskOutput 获取任务输出
        console.warn('[IPC] GET_TASK_OUTPUT: 当前版本暂未实现，返回空输出')
        return {
          output: '',
          isComplete: false,
        }
      } catch (error) {
        console.error('[IPC] 获取任务输出失败:', error)
        throw error
      }
    }
  )

  // ===== Agent 权限系统 =====

  // 响应权限请求
  ipcMain.handle(
    AGENT_IPC_CHANNELS.PERMISSION_RESPOND,
    async (event, response: PermissionResponse): Promise<void> => {
      const { requestId, behavior, alwaysAllow } = response
      const sessionId = permissionService.respondToPermission(requestId, behavior, alwaysAllow)

      // 发送 permission_resolved 事件给渲染进程
      if (sessionId) {
        event.sender.send(AGENT_IPC_CHANNELS.STREAM_EVENT, {
          sessionId,
          payload: { kind: 'myyoda_event', event: { type: 'permission_resolved', requestId, behavior } },
        })
      }
    }
  )

  // 停止任务
  ipcMain.handle(
    AGENT_IPC_CHANNELS.STOP_TASK,
    async (_, input: StopTaskInput): Promise<void> => {
      try {
        if (input.type === 'shell') {
          console.warn('[IPC] STOP_TASK: Shell 任务停止功能待实现')
        } else {
          console.warn('[IPC] STOP_TASK: Agent 任务暂不支持单独停止')
        }
      } catch (error) {
        console.error('[IPC] 停止任务失败:', error)
        throw error
      }
    }
  )

  // 热切换指定会话的权限模式（运行中生效，不广播）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.UPDATE_SESSION_PERMISSION_MODE,
    async (_, sessionId: string, mode: MyYodaPermissionMode): Promise<void> => {
      if (!isMyYodaPermissionMode(mode)) {
        throw new Error(`无效的权限模式: ${mode}`)
      }
      // 会话不存在时直接抛错（避免 updateAgentSessionMeta 的通用异常被降级为 warn）
      if (!getAgentSessionMeta(sessionId)) {
        throw new Error(`Agent 会话不存在: ${sessionId}`)
      }
      // 持久化到 session meta（重启后可恢复，即使 session 未运行也要写）。
      // 这里的 catch 仅用于兜底磁盘 I/O 类异常，不影响后续热切换。
      try {
        updateAgentSessionMeta(sessionId, { permissionMode: mode })
      } catch (err) {
        console.warn(`[IPC] 持久化 session 权限模式失败: sessionId=${sessionId}`, err)
      }
      // 若 session 正在跑，同步热切换运行时模式
      if (isAgentSessionActive(sessionId)) {
        await updateAgentPermissionMode(sessionId, mode).catch((err) => {
          console.warn(`[IPC] 运行中权限模式切换失败: sessionId=${sessionId}`, err)
          throw err
        })
      }
    }
  )

  // 切换指定会话的 Agent runtime（空闲后下一轮生效）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.UPDATE_SESSION_CODEX_FAST_MODE,
    async (_, sessionId: string, enabled: boolean): Promise<AgentSessionMeta> => {
      if (typeof enabled !== 'boolean') {
        throw new Error(`无效的 Codex Fast Mode 状态: ${String(enabled)}`)
      }
      if (!getAgentSessionMeta(sessionId)) {
        throw new Error(`Agent 会话不存在: ${sessionId}`)
      }
      if (isAgentSessionActive(sessionId)) {
        throw new Error('Agent 正在运行，完成后再切换快速模式')
      }
      return updateAgentSessionMeta(sessionId, { codexFastMode: enabled })
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_PI_REASONING_CAPABILITY,
    async (_, channelId: string, modelId: string) => {
      if (!channelId || !modelId) return undefined
      const channel = getChannelById(channelId)
      if (!channel) return undefined
      return resolvePiReasoningCapability(channel.provider, modelId)
    },
  )

  const handleSessionReasoningLevelUpdate = async (_: Electron.IpcMainInvokeEvent, sessionId: string, thinkingLevel: AgentThinkingLevel): Promise<AgentSessionMeta> => {
      if (!AGENT_THINKING_LEVELS.includes(thinkingLevel)) {
        throw new Error(`无效的思考深度: ${String(thinkingLevel)}`)
      }
      if (!getAgentSessionMeta(sessionId)) {
        throw new Error(`Agent 会话不存在: ${sessionId}`)
      }
      if (isAgentSessionActive(sessionId)) {
        throw new Error('Agent 正在运行，完成后再切换思考深度')
      }
      return updateAgentSessionMeta(sessionId, { reasoningLevel: thinkingLevel })
    }
  ipcMain.handle(AGENT_IPC_CHANNELS.UPDATE_SESSION_THINKING_LEVEL, handleSessionReasoningLevelUpdate)
  ipcMain.handle(AGENT_IPC_CHANNELS.UPDATE_SESSION_REASONING_LEVEL, handleSessionReasoningLevelUpdate)

  ipcMain.handle(
    AGENT_IPC_CHANNELS.UPDATE_SESSION_AGENT_RUNTIME,
    async (_, sessionId: string, runtime: AgentRuntime): Promise<AgentSessionMeta> => {
      if (!isAgentRuntime(runtime)) {
        throw new Error(`无效的 Agent runtime: ${String(runtime)}`)
      }
      const current = getAgentSessionMeta(sessionId)
      if (!current) {
        throw new Error(`Agent 会话不存在: ${sessionId}`)
      }

      if (isAgentSessionActive(sessionId)) {
        throw new Error('Agent 正在运行，完成后再切换内核')
      }

      // 历史会话缺失 runtime 时按 Claude 处理，避免将 Claude SDK 会话 ID 交给 Pi 恢复。
      const previousRuntime: AgentRuntime = isAgentRuntime(current.agentRuntime) ? current.agentRuntime : 'claude'
      const updates: Partial<Pick<AgentSessionMeta, 'agentRuntime' | 'sdkSessionId'>> = {
        agentRuntime: runtime,
      }
      if (previousRuntime !== runtime) {
        updates.sdkSessionId = undefined
      }

      return updateAgentSessionMeta(sessionId, updates)
    }
  )

  // ===== Chat 工具管理 =====

  // 获取所有工具信息
  ipcMain.handle(
    CHAT_TOOL_IPC_CHANNELS.GET_ALL_TOOLS,
    async (): Promise<ChatToolInfo[]> => {
      return getAllToolInfos()
    }
  )

  // 获取工具凭据
  ipcMain.handle(
    CHAT_TOOL_IPC_CHANNELS.GET_TOOL_CREDENTIALS,
    async (_, toolId: string): Promise<Record<string, string>> => {
      return getToolCredentials(toolId)
    }
  )

  // 更新工具开关状态
  ipcMain.handle(
    CHAT_TOOL_IPC_CHANNELS.UPDATE_TOOL_STATE,
    async (_, toolId: string, state: ChatToolState): Promise<void> => {
      updateToolState(toolId, state)
    }
  )

  // 更新工具凭据
  ipcMain.handle(
    CHAT_TOOL_IPC_CHANNELS.UPDATE_TOOL_CREDENTIALS,
    async (_, toolId: string, credentials: Record<string, string>): Promise<void> => {
      updateToolCredentials(toolId, credentials)
    }
  )

  // 创建自定义工具
  ipcMain.handle(
    CHAT_TOOL_IPC_CHANNELS.CREATE_CUSTOM_TOOL,
    async (_, meta: ChatToolMeta): Promise<void> => {
      addCustomTool(meta)
    }
  )

  // 删除自定义工具
  ipcMain.handle(
    CHAT_TOOL_IPC_CHANNELS.DELETE_CUSTOM_TOOL,
    async (_, toolId: string): Promise<void> => {
      deleteCustomTool(toolId)
    }
  )

  // 测试工具连接
  ipcMain.handle(
    CHAT_TOOL_IPC_CHANNELS.TEST_TOOL,
    async (_, toolId: string): Promise<{ success: boolean; message: string }> => {
      // 联网搜索工具测试
      if (toolId === 'web-search') {
        const { getToolCredentials: getCredentials } = await import('./lib/chat-tool-config')
        const credentials = getCredentials('web-search')
        if (!credentials.apiKey) {
          return { success: false, message: '请先填写 Tavily API Key' }
        }
        try {
          const response = await getFetchFn(await getEffectiveProxyUrl())('https://api.tavily.com/search', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${credentials.apiKey}`,
            },
            body: JSON.stringify({
              query: 'test connection',
              search_depth: 'basic',
              max_results: 1,
            }),
          })
          if (!response.ok) {
            const errorText = await response.text()
            return { success: false, message: `API 请求失败 (${response.status}): ${errorText}` }
          }
          return { success: true, message: '连接成功，Tavily 搜索 API 可用' }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          return { success: false, message: `连接失败: ${msg}` }
        }
      }
      // Nano Banana 生图工具测试
      if (toolId === 'nano-banana') {
        const { getToolCredentials: getCredentials } = await import('./lib/chat-tool-config')
        const credentials = getCredentials('nano-banana')
        if (!credentials.apiKey) {
          return { success: false, message: '请先填写 Gemini API Key' }
        }
        try {
          const baseUrl = credentials.baseUrl?.trim() || 'https://generativelanguage.googleapis.com'
          const model = credentials.model?.trim() || 'gemini-3.1-flash-image-preview'
          const url = `${baseUrl}/v1beta/models/${model}:generateContent?key=${credentials.apiKey}`
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
              generationConfig: { maxOutputTokens: 10 },
            }),
          })
          if (!response.ok) {
            const errorText = await response.text()
            return { success: false, message: `API 请求失败 (${response.status}): ${errorText.slice(0, 200)}` }
          }
          return { success: true, message: `连接成功，模型 ${model} 可用` }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          return { success: false, message: `连接失败: ${msg}` }
        }
      }
      return { success: false, message: `工具 ${toolId} 不支持测试` }
    }
  )

  // ===== AskUserQuestion 交互式问答 =====

  // 响应 AskUser 请求
  ipcMain.handle(
    AGENT_IPC_CHANNELS.ASK_USER_RESPOND,
    async (event, response: AskUserResponse): Promise<void> => {
      const { requestId, answers } = response
      const sessionId = askUserService.respondToAskUser(requestId, answers)

      if (sessionId) {
        event.sender.send(AGENT_IPC_CHANNELS.STREAM_EVENT, {
          sessionId,
          payload: { kind: 'myyoda_event', event: { type: 'ask_user_resolved', requestId } },
        })
      }
    }
  )

  // ===== ExitPlanMode 计划审批 =====

  // 响应 ExitPlanMode 请求
  ipcMain.handle(
    AGENT_IPC_CHANNELS.EXIT_PLAN_MODE_RESPOND,
    async (event, response: ExitPlanModeResponse): Promise<void> => {
      const result = exitPlanService.respondToExitPlanMode(response)

      if (result) {
        const { sessionId, targetMode } = result

        // 通知渲染进程请求已处理
        event.sender.send(AGENT_IPC_CHANNELS.STREAM_EVENT, {
          sessionId,
          payload: { kind: 'myyoda_event', event: { type: 'exit_plan_mode_resolved', requestId: response.requestId } },
        })

        // 如果用户选择了新的权限模式，通知渲染进程更新 UI
        if (targetMode) {
          const meta = getAgentSessionMeta(sessionId)
          // 持久化到 session meta，和 cycleMode 路径保持一致（重启后该 session 能恢复）
          if (meta) {
            try {
              updateAgentSessionMeta(sessionId, { permissionMode: targetMode })
            } catch (err) {
              console.warn(`[IPC] ExitPlanMode 持久化 session 权限模式失败: sessionId=${sessionId}`, err)
            }
          }
          event.sender.send(AGENT_IPC_CHANNELS.STREAM_EVENT, {
            sessionId,
            payload: { kind: 'myyoda_event', event: { type: 'permission_mode_changed', mode: targetMode } },
          })
          console.log(`[IPC] ExitPlanMode 权限模式切换: ${targetMode}`)
        }
      }
    }
  )

  // ===== 待处理请求恢复 =====

  // 获取所有待处理的交互请求快照（渲染进程重载后恢复状态）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_PENDING_REQUESTS,
    async (): Promise<import('@myyoda/shared').PendingRequestsSnapshot> => {
      return {
        permissions: permissionService.getPendingRequests(),
        askUsers: askUserService.getPendingRequests(),
        exitPlans: exitPlanService.getPendingRequests(),
      }
    }
  )

  // ===== Agent 附件 =====

  // 保存文件到 Agent session 工作目录
  ipcMain.handle(
    AGENT_IPC_CHANNELS.SAVE_FILES_TO_SESSION,
    async (_, input: AgentSaveFilesInput): Promise<AgentSavedFile[]> => {
      return saveFilesToAgentSession(input)
    }
  )

  // 保存文件到工作区文件目录
  ipcMain.handle(
    AGENT_IPC_CHANNELS.SAVE_FILES_TO_WORKSPACE,
    async (_, input: AgentSaveWorkspaceFilesInput): Promise<AgentSavedFile[]> => {
      return saveFilesToWorkspaceFiles(input)
    }
  )

  // 获取工作区文件目录路径
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_WORKSPACE_FILES_PATH,
    async (_, workspaceSlug: string): Promise<string> => {
      return getWorkspaceFilesDir(workspaceSlug)
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_WORKSPACE_ROOT_PATH,
    async (_, workspaceSlug: string): Promise<string> => {
      return getAgentWorkspacePath(workspaceSlug)
    }
  )

  // 打开文件夹选择对话框
  ipcMain.handle(
    AGENT_IPC_CHANNELS.OPEN_FOLDER_DIALOG,
    async (): Promise<{ path: string; name: string } | null> => {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      if (!win) return null

      const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory'],
        title: '选择文件夹',
      })

      if (result.canceled || result.filePaths.length === 0) return null

      const folderPath = result.filePaths[0]!
      const name = folderPath.split('/').filter(Boolean).pop() || 'folder'
      return { path: folderPath, name }
    }
  )

  // 打开支持文件与文件夹混合选择的 Composer 对话框
  ipcMain.handle(
    AGENT_IPC_CHANNELS.OPEN_FILE_OR_FOLDER_DIALOG,
    async (): Promise<FileOrFolderDialogResult> => {
      return openFileOrFolderDialog()
    }
  )

  // 附加外部目录到 Agent 会话
  ipcMain.handle(
    AGENT_IPC_CHANNELS.ATTACH_DIRECTORY,
    async (_, input: AgentAttachDirectoryInput): Promise<string[]> => {
      const meta = getAgentSessionMeta(input.sessionId)
      if (!meta) throw new Error(`会话不存在: ${input.sessionId}`)

      const existing = meta.attachedDirectories ?? []
      if (existing.includes(input.directoryPath)) return existing

      const updated = [...existing, input.directoryPath]
      updateAgentSessionMeta(input.sessionId, { attachedDirectories: updated })
      // 启动附加目录文件监听
      watchAttachedDirectory(input.directoryPath)
      return updated
    }
  )

  // 移除会话的附加目录
  ipcMain.handle(
    AGENT_IPC_CHANNELS.DETACH_DIRECTORY,
    async (_, input: AgentAttachDirectoryInput): Promise<string[]> => {
      const meta = getAgentSessionMeta(input.sessionId)
      if (!meta) throw new Error(`会话不存在: ${input.sessionId}`)

      const existing = meta.attachedDirectories ?? []
      const updated = existing.filter((d) => d !== input.directoryPath)
      updateAgentSessionMeta(input.sessionId, { attachedDirectories: updated })
      // 停止附加目录文件监听
      unwatchAttachedDirectory(input.directoryPath)
      return updated
    }
  )

  // 附加外部文件到 Agent 会话
  ipcMain.handle(
    AGENT_IPC_CHANNELS.ATTACH_FILE,
    async (_, input: AgentAttachFileInput): Promise<string[]> => {
      const meta = getAgentSessionMeta(input.sessionId)
      if (!meta) throw new Error(`会话不存在: ${input.sessionId}`)

      const { realpathSync, statSync } = await import('node:fs')
      const { resolve } = await import('node:path')
      const safePath = realpathSync(resolve(input.filePath))
      const stats = statSync(safePath)
      if (!stats.isFile()) throw new Error('只能附加文件')

      const existing = meta.attachedFiles ?? []
      if (existing.includes(safePath)) return existing

      const updated = [...existing, safePath]
      updateAgentSessionMeta(input.sessionId, { attachedFiles: updated })
      return updated
    }
  )

  // 移除会话的附加文件
  ipcMain.handle(
    AGENT_IPC_CHANNELS.DETACH_FILE,
    async (_, input: AgentAttachFileInput): Promise<string[]> => {
      const meta = getAgentSessionMeta(input.sessionId)
      if (!meta) throw new Error(`会话不存在: ${input.sessionId}`)

      const existing = meta.attachedFiles ?? []
      const updated = existing.filter((f) => f !== input.filePath)
      updateAgentSessionMeta(input.sessionId, { attachedFiles: updated })
      return updated
    }
  )

  // 附加外部目录到工作区（所有会话可访问）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.ATTACH_WORKSPACE_DIRECTORY,
    async (_, input: WorkspaceAttachDirectoryInput): Promise<string[]> => {
      const updated = attachWorkspaceDirectory(input.workspaceSlug, input.directoryPath)
      watchAttachedDirectory(input.directoryPath)
      return updated
    }
  )

  // 移除工作区的附加目录
  ipcMain.handle(
    AGENT_IPC_CHANNELS.DETACH_WORKSPACE_DIRECTORY,
    async (_, input: WorkspaceAttachDirectoryInput): Promise<string[]> => {
      const updated = detachWorkspaceDirectory(input.workspaceSlug, input.directoryPath)
      unwatchAttachedDirectory(input.directoryPath)
      return updated
    }
  )

  // 附加外部文件到工作区（所有会话可访问）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.ATTACH_WORKSPACE_FILE,
    async (_, input: WorkspaceAttachFileInput): Promise<string[]> => {
      const { realpathSync, statSync } = await import('node:fs')
      const { resolve } = await import('node:path')
      const safePath = realpathSync(resolve(input.filePath))
      const stats = statSync(safePath)
      if (!stats.isFile()) throw new Error('只能附加文件')

      return attachWorkspaceFile(input.workspaceSlug, safePath)
    }
  )

  // 移除工作区的附加文件
  ipcMain.handle(
    AGENT_IPC_CHANNELS.DETACH_WORKSPACE_FILE,
    async (_, input: WorkspaceAttachFileInput): Promise<string[]> => {
      return detachWorkspaceFile(input.workspaceSlug, input.filePath)
    }
  )

  // 获取工作区附加目录列表
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_WORKSPACE_DIRECTORIES,
    async (_, workspaceSlug: string): Promise<string[]> => {
      return getWorkspaceAttachedDirectories(workspaceSlug)
    }
  )

  // 获取工作区附加文件列表
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_WORKSPACE_ATTACHED_FILES,
    async (_, workspaceSlug: string): Promise<string[]> => {
      return getWorkspaceAttachedFiles(workspaceSlug)
    }
  )

  // ===== Worktree 仓库配置管理 =====

  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_WORKTREE_REPOS,
    async (_, workspaceSlug: string) => {
      return await getWorktreeRepos(workspaceSlug)
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.ADD_WORKTREE_REPO,
    async (_, workspaceSlug: string, repo: import('@myyoda/shared').WorkspaceWorktreeRepo) => {
      return addWorktreeRepo(workspaceSlug, repo)
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.REMOVE_WORKTREE_REPO,
    async (_, workspaceSlug: string, repoPath: string) => {
      return removeWorktreeRepo(workspaceSlug, repoPath)
    }
  )

  // ===== 工作区默认工作目录 =====

  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_WORKSPACE_DEFAULT_WORKING_DIRECTORY,
    async (_, workspaceSlug: string): Promise<string | undefined> => {
      return getWorkspaceDefaultWorkingDirectory(workspaceSlug)
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.SET_WORKSPACE_DEFAULT_WORKING_DIRECTORY,
    async (_, workspaceSlug: string, path: string | undefined): Promise<string | undefined> => {
      return setWorkspaceDefaultWorkingDirectory(workspaceSlug, path)
    }
  )

  // ===== Agent 文件系统操作 =====

  // 获取 session 工作路径
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_SESSION_PATH,
    async (_, workspaceId: string, sessionId: string): Promise<string | null> => {
      const ws = getAgentWorkspace(workspaceId)
      if (!ws) return null
      return getAgentSessionWorkspacePath(ws.slug, sessionId)
    }
  )

  // 获取当前会话统一文件根。Project effective cwd 必须由主进程解析，renderer 不自行拼接托管路径。
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_SESSION_FILE_ROOTS,
    async (_, workspaceId: string, sessionId: string) => {
      const ws = getAgentWorkspace(workspaceId)
      const sessionMeta = getAgentSessionMeta(sessionId)
      if (!ws || !sessionMeta || (sessionMeta.workspaceId && sessionMeta.workspaceId !== workspaceId)) return null
      return resolveAgentSessionFileRoots(sessionMeta, ws.slug)
    },
  )

  // 获取当前会话本轮捕获的文件产出；Outbox 不参与 @ Workspace Files 搜索。
  ipcMain.handle(
    AGENT_IPC_CHANNELS.LIST_SESSION_OUTPUTS,
    async (_, workspaceId: string, sessionId: string) => {
      const ws = getAgentWorkspace(workspaceId)
      const sessionMeta = getAgentSessionMeta(sessionId)
      if (!ws || !sessionMeta || (sessionMeta.workspaceId && sessionMeta.workspaceId !== workspaceId)) return []
      return listSessionOutputs(getWorkspaceFilesDir(ws.slug), sessionId)
    },
  )

  // 列出目录内容（浅层，安全校验）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.LIST_DIRECTORY,
    async (_, dirPath: string, access?: FileAccessOptions): Promise<FileEntry[]> => {
      const { existsSync, readdirSync, statSync } = await import('node:fs')
      const { resolve } = await import('node:path')

      const safePath = resolve(dirPath)
      // 目录可能已被删除（如删除 Agent 会话后面板仍持有旧路径），优雅返回空列表
      if (!existsSync(safePath)) {
        return []
      }
      if (!isPathAllowed(safePath, normalizeFileAccessOptions(access))) {
        throw new Error('访问路径超出当前会话的授权范围')
      }

      const entries: FileEntry[] = []
      const items = readdirSync(safePath, { withFileTypes: true })

      for (const item of items) {
        if (HIDDEN_FS_ENTRIES.has(item.name)) continue
        const fullPath = resolve(safePath, item.name)
        const isDirectory = item.isDirectory()
        const size = isDirectory ? undefined : statSync(fullPath).size
        entries.push({
          name: item.name,
          path: fullPath,
          isDirectory,
          size,
        })
      }

      // 目录在前，文件在后；隐藏文件（.开头）排在同类末尾，各自按名称排序
      entries.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
        const aHidden = a.name.startsWith('.')
        const bHidden = b.name.startsWith('.')
        if (aHidden !== bHidden) return aHidden ? 1 : -1
        return a.name.localeCompare(b.name)
      })

      return entries
    }
  )

  // 删除文件或目录
  ipcMain.handle(
    AGENT_IPC_CHANNELS.DELETE_FILE,
    async (_, filePath: string, access?: FileAccessOptions): Promise<void> => {
      const { rmSync } = await import('node:fs')
      const { resolve } = await import('node:path')

      const safePath = resolve(filePath)
      if (!isPathAllowed(safePath, normalizeFileAccessOptions(access))) {
        throw new Error('访问路径超出当前会话的授权范围')
      }

      rmSync(safePath, { recursive: true, force: true })
      console.log(`[Agent 文件] 已删除: ${safePath}`)
    }
  )

  // 用系统默认应用打开文件
  ipcMain.handle(
    AGENT_IPC_CHANNELS.OPEN_FILE,
    async (_, filePath: string, access?: FileAccessOptions): Promise<void> => {
      const { resolve } = await import('node:path')

      const safePath = resolve(filePath)
      if (!isPathAllowed(safePath, normalizeFileAccessOptions(access))) {
        throw new Error('访问路径超出当前会话的授权范围')
      }

      await shell.openPath(safePath)
    }
  )

  // 将剪贴板文本写入临时预览文件
  ipcMain.handle(
    AGENT_IPC_CHANNELS.WRITE_CLIPBOARD_PREVIEW,
    async (_, filename: string, content: string): Promise<string> => {
      if (typeof filename !== 'string' || !filename) {
        throw new Error('filename 必须是非空字符串')
      }
      if (typeof content !== 'string') {
        throw new Error('content 必须是字符串')
      }

      const { isAbsolute, join, relative, resolve } = await import('node:path')
      const { tmpdir } = await import('node:os')
      const { existsSync, mkdirSync } = await import('node:fs')
      const { writeFile } = await import('node:fs/promises')

      const tmpDir = join(tmpdir(), 'myyoda-preview')
      if (!existsSync(tmpDir)) {
        mkdirSync(tmpDir, { recursive: true })
      }

      // 安全文件名：替换路径分隔符和特殊字符，防止目录穿越
      const safeFilename = filename.replace(/[<>:"/\\|?*]/g, '_').replace(/^\.+/, '_')
      const tmpPath = resolve(tmpDir, safeFilename)

      // 确保 resolve 后的路径仍在 tmpDir 内，兼容 Windows 路径分隔符
      const relativePath = relative(tmpDir, tmpPath)
      if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
        throw new Error('文件名越界')
      }

      await writeFile(tmpPath, content, 'utf-8')
      console.log(`[IPC] clipboard 预览文件已写入: ${tmpPath}`)
      return tmpPath
    }
  )

  // 在系统文件管理器中显示文件
  ipcMain.handle(
    AGENT_IPC_CHANNELS.SHOW_IN_FOLDER,
    async (_, filePath: string, access?: FileAccessOptions): Promise<void> => {
      const { resolve } = await import('node:path')

      const safePath = resolve(filePath)
      if (!isPathAllowed(safePath, normalizeFileAccessOptions(access))) {
        throw new Error('访问路径超出当前会话的授权范围')
      }

      shell.showItemInFolder(safePath)
    }
  )

  // 使用 macOS 系统 Terminal 在指定文件夹打开
  ipcMain.handle(
    AGENT_IPC_CHANNELS.OPEN_FOLDER_IN_TERMINAL,
    async (_, folderPath: string): Promise<void> => {
      if (process.platform !== 'darwin') {
        throw new Error('当前仅支持在 macOS 终端中打开文件夹')
      }

      const { resolve } = await import('node:path')

      const safePath = resolve(folderPath)
      const workspacesRoot = resolve(getAgentWorkspacesDir())
      if (!safePath.startsWith(workspacesRoot)) {
        throw new Error('访问路径超出 Agent 工作区范围')
      }
      if (!statSync(safePath).isDirectory()) {
        throw new Error('只能在终端中打开文件夹')
      }

      const { spawn } = await import('node:child_process')
      await new Promise<void>((resolvePromise, reject) => {
        const child = spawn('open', ['-a', 'Terminal', safePath], { detached: true, stdio: 'ignore' })
        child.once('error', reject)
        child.once('spawn', () => {
          child.unref()
          resolvePromise()
        })
      })
    }
  )

  // 在系统文件管理器中显示任意路径（无工作区限制，用户主动点击触发）
  ipcMain.handle(
    IPC_CHANNELS.SHOW_ITEM_IN_FOLDER,
    async (_, filePath: string, candidateBasePaths?: string[]): Promise<boolean> => {
      const { resolve } = await import('node:path')
      const { existsSync } = await import('node:fs')
      const { resolveTargetPath } = await import('./lib/file-preview-service')

      const resolvedPath = resolveTargetPath(filePath, candidateBasePaths?.length ? candidateBasePaths : undefined)
      if (!existsSync(resolvedPath)) {
        console.warn('[IPC] shell:show-item-in-folder 路径不存在:', resolvedPath)
        return false
      }
      shell.showItemInFolder(resolve(resolvedPath))
      return true
    }
  )

  // 解析文件路径并读取内容（供内联预览使用）
  ipcMain.handle(
    'file:resolve-and-read',
    async (_, filePath: string, access?: FileAccessOptions | string[]): Promise<{ resolvedPath: string; content: string } | null> => {
      const { resolveAndReadFile, resolveFilePath } = await import('./lib/file-preview-service')
      const options = normalizeFileAccessOptions(access)
      const allowedBasePaths = getAllowedCandidateBasePaths(options)
      const resolved = resolveFilePath(filePath, allowedBasePaths)
      if (!resolved || !isPathAllowed(resolved, options)) {
        console.warn('[IPC] file:resolve-and-read 拒绝越界路径:', resolved ?? filePath)
        return null
      }
      const result = resolveAndReadFile(resolved)
      return result
    }
  )

  // 写入文本文件（供 Markdown 内联编辑使用）
  ipcMain.handle(
    'file:write-text',
    async (_, filePath: string, content: string, access?: FileAccessOptions | string[]): Promise<boolean> => {
      if (typeof content !== 'string') return false
      const { writeFileSync } = await import('node:fs')
      const { resolveFilePath } = await import('./lib/file-preview-service')
      const options = normalizeFileAccessOptions(access)
      const allowedBasePaths = getAllowedCandidateBasePaths(options)
      const resolved = resolveFilePath(filePath, allowedBasePaths)
      if (!resolved || !isPathAllowed(resolved, options)) {
        console.warn('[IPC] file:write-text 拒绝越界路径:', resolved ?? filePath)
        return false
      }
      writeFileSync(resolved, content, 'utf-8')
      return true
    }
  )

  // 仅解析文件路径（供 PDF/图片等用 file:// 加载）
  ipcMain.handle(
    'file:resolve-path',
    async (_, filePath: string, access?: FileAccessOptions | string[]): Promise<ResolvedFileUrl | null> => {
      const { resolveFilePath } = await import('./lib/file-preview-service')
      const options = normalizeFileAccessOptions(access)
      const result = resolveFilePath(filePath, getAllowedCandidateBasePaths(options))
      if (result && !isPathAllowed(result, options)) {
        console.warn('[IPC] file:resolve-path 拒绝越界路径:', result)
        return null
      }
      if (!result) return null
      // registerPromaFilePath 对目录路径会抛「不是文件」。渲染端（如悬浮预览解析 markdown
      // 链接）可能传入目录路径，此处优雅降级为 null，而不是让异常冒泡成未捕获的 handler 错误。
      try {
        return { url: registerPromaFilePath(result) }
      } catch (err) {
        console.warn('[IPC] file:resolve-path 无法注册为文件，跳过:', result, err instanceof Error ? err.message : err)
        return null
      }
    }
  )

  // 为内联 PDF 预览生成临时 HTML 文件，返回文件路径
  ipcMain.handle(
    'file:prepare-pdf-preview',
    async (_, filePath: string, access?: FileAccessOptions | string[]): Promise<{ tmpHtmlUrl: string } | null> => {
      const { preparePdfPreview, resolveFilePath } = await import('./lib/file-preview-service')
      const options = normalizeFileAccessOptions(access)
      const allowedBasePaths = getAllowedCandidateBasePaths(options)
      const resolved = resolveFilePath(filePath, allowedBasePaths)
      if (!resolved || !isPathAllowed(resolved, options)) {
        console.warn('[IPC] file:prepare-pdf-preview 拒绝越界路径:', resolved ?? filePath)
        return null
      }
      const result = await preparePdfPreview(resolved)
      return result ? { tmpHtmlUrl: result.tmpHtmlUrl } : null
    }
  )

  // 为内联 HTML 预览注册文件所在目录 URL（相对路径资源自动解析）
  ipcMain.handle(
    'file:prepare-html-preview',
    async (_, filePath: string, access?: FileAccessOptions | string[]): Promise<{ tmpUrl: string } | null> => {
      const { prepareHtmlPreview, resolveFilePath } = await import('./lib/file-preview-service')
      const options = normalizeFileAccessOptions(access)
      const allowedBasePaths = getAllowedCandidateBasePaths(options)
      const resolved = resolveFilePath(filePath, allowedBasePaths)
      if (!resolved || !isPathAllowed(resolved, options)) {
        console.warn('[IPC] file:prepare-html-preview 拒绝越界路径:', resolved ?? filePath)
        return null
      }
      const result = await prepareHtmlPreview(resolved)
      return result ? { tmpUrl: result.tmpUrl } : null
    }
  )

  // DOCX 转 HTML（内联预览使用 mammoth）
  ipcMain.handle(
    'file:docx-to-html',
    async (_, filePath: string, access?: FileAccessOptions | string[]): Promise<{ resolvedPath: string; html: string } | null> => {
      const { convertDocxToHtml, resolveFilePath } = await import('./lib/file-preview-service')
      const options = normalizeFileAccessOptions(access)
      const allowedBasePaths = getAllowedCandidateBasePaths(options)
      const resolved = resolveFilePath(filePath, allowedBasePaths)
      if (!resolved || !isPathAllowed(resolved, options)) {
        console.warn('[IPC] file:docx-to-html 拒绝越界路径:', resolved ?? filePath)
        return null
      }
      const result = await convertDocxToHtml(resolved)
      return result
    }
  )

  // XLSX/PPTX 转 HTML（内联预览使用 OOXML 解析）
  ipcMain.handle(
    'file:office-to-html',
    async (_, filePath: string, access?: FileAccessOptions | string[]): Promise<import('@myyoda/shared').OfficePreviewResult | null> => {
      const { convertOfficeToHtml, resolveFilePath } = await import('./lib/file-preview-service')
      const options = normalizeFileAccessOptions(access)
      const allowedBasePaths = getAllowedCandidateBasePaths(options)
      const resolved = resolveFilePath(filePath, allowedBasePaths)
      if (!resolved || !isPathAllowed(resolved, options)) {
        console.warn('[IPC] file:office-to-html 拒绝越界路径:', resolved ?? filePath)
        return null
      }
      return convertOfficeToHtml(resolved)
    }
  )

  // 读取文件为 base64（带路径校验，供内联图片预览等使用）
  ipcMain.handle(
    'file:read-binary-base64',
    async (_, filePath: string, access?: FileAccessOptions | string[], maxSize?: number): Promise<string | null> => {
      const { readFileSync, statSync } = await import('node:fs')
      const { resolveFilePath } = await import('./lib/file-preview-service')
      const options = normalizeFileAccessOptions(access)
      const resolved = resolveFilePath(filePath, getAllowedCandidateBasePaths(options))
      if (!resolved || !isPathAllowed(resolved, options)) return null
      const st = statSync(resolved)
      if (maxSize && st.size > maxSize) return null
      return readFileSync(resolved).toString('base64')
    }
  )

  // 重命名文件/目录
  ipcMain.handle(
    AGENT_IPC_CHANNELS.RENAME_FILE,
    async (_, filePath: string, newName: string, access?: FileAccessOptions): Promise<void> => {
      const { renameSync } = await import('node:fs')
      const { resolve, dirname, join, sep } = await import('node:path')

      if (newName.includes('/') || newName.includes('\\') || newName.includes('..') || newName.includes(sep)) {
        throw new Error('文件名不能包含路径分隔符或 ".."')
      }

      const safePath = resolve(filePath)
      if (!isPathAllowed(safePath, normalizeFileAccessOptions(access))) {
        throw new Error('访问路径超出当前会话的授权范围')
      }

      const newPath = join(dirname(safePath), newName)
      renameSync(safePath, newPath)
      console.log(`[Agent 文件] 已重命名: ${safePath} → ${newPath}`)
    }
  )

  // 移动文件/目录到目标目录
  ipcMain.handle(
    AGENT_IPC_CHANNELS.MOVE_FILE,
    async (_, filePath: string, targetDir: string, access?: FileAccessOptions): Promise<void> => {
      const { renameSync } = await import('node:fs')
      const { resolve, basename, join } = await import('node:path')

      const safePath = resolve(filePath)
      const safeTarget = resolve(targetDir)
      const options = normalizeFileAccessOptions(access)
      if (!isPathAllowed(safePath, options) || !isPathAllowed(safeTarget, options)) {
        throw new Error('访问路径超出当前会话的授权范围')
      }

      const newPath = join(safeTarget, basename(safePath))
      renameSync(safePath, newPath)
      console.log(`[Agent 文件] 已移动: ${safePath} → ${newPath}`)
    }
  )

  // 列出附加目录内容
  ipcMain.handle(
    AGENT_IPC_CHANNELS.LIST_ATTACHED_DIRECTORY,
    async (_, dirPath: string, access?: FileAccessOptions | string[]): Promise<FileEntry[]> => {
      const { readdirSync, statSync } = await import('node:fs')
      const { resolve } = await import('node:path')

      const safePath = resolve(dirPath)
      const options = normalizeFileAccessOptions(access)
      if (!isPathAllowed(safePath, options)) {
        throw new Error('访问路径不在允许范围内')
      }
      const entries: FileEntry[] = []
      const items = readdirSync(safePath, { withFileTypes: true })

      for (const item of items) {
        if (HIDDEN_FS_ENTRIES.has(item.name)) continue
        const fullPath = resolve(safePath, item.name)
        const isDirectory = item.isDirectory()
        const size = isDirectory ? undefined : statSync(fullPath).size
        entries.push({
          name: item.name,
          path: fullPath,
          isDirectory,
          size,
        })
      }

      // 目录在前，文件在后；隐藏文件（.开头）排在同类末尾
      entries.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
        const aHidden = a.name.startsWith('.')
        const bHidden = b.name.startsWith('.')
        if (aHidden !== bHidden) return aHidden ? 1 : -1
        return a.name.localeCompare(b.name)
      })

      return entries
    }
  )

  // 读取附加目录文件内容为 base64（限制在已附加目录范围内，用于侧面板添加到聊天）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.READ_ATTACHED_FILE,
    async (_, filePath: string, sessionId?: string, workspaceSlug?: string): Promise<string> => {
      if (!filePath || typeof filePath !== 'string') {
        throw new Error('无效的文件路径')
      }

      const { resolve, sep } = await import('node:path')
      const { readFile, stat, realpath } = await import('node:fs/promises')

      // 使用 realpath 解析符号链接，防止 symlink 绕过路径检查
      const safePath = await realpath(resolve(filePath)).catch(() => {
        throw new Error(`文件不存在: ${filePath}`)
      })

      // 收集所有允许的路径：会话/工作区附加目录、附加文件 + 工作区文件目录
      const allowedDirs: string[] = []
      const allowedFiles: string[] = []

      if (sessionId) {
        const meta = getAgentSessionMeta(sessionId)
        if (meta?.attachedDirectories) {
          allowedDirs.push(...meta.attachedDirectories)
        }
        if (meta?.attachedFiles) {
          allowedFiles.push(...meta.attachedFiles)
        }
      }
      if (workspaceSlug) {
        allowedDirs.push(...getWorkspaceAttachedDirectories(workspaceSlug))
        allowedFiles.push(...getWorkspaceAttachedFiles(workspaceSlug))
        allowedDirs.push(getWorkspaceFilesDir(workspaceSlug))
      }

      // 还允许访问 agent-workspaces 根目录下的文件（session 文件等）
      allowedDirs.push(getAgentWorkspacesDir())

      const resolvedAllowedDirs = await Promise.all(
        allowedDirs.map((dir) => realpath(resolve(dir)).catch(() => resolve(dir)))
      )
      const resolvedAllowedFiles = await Promise.all(
        allowedFiles.map((file) => realpath(resolve(file)).catch(() => resolve(file)))
      )
      const isAllowed = resolvedAllowedDirs.some((dir) => safePath.startsWith(dir + sep) || safePath === dir)
        || resolvedAllowedFiles.some((file) => safePath === file)
      if (!isAllowed) {
        throw new Error('访问路径不在允许范围内')
      }

      const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20 MB
      const fileStat = await stat(safePath).catch(() => null)
      if (!fileStat) {
        throw new Error(`文件不存在: ${filePath}`)
      }
      if (fileStat.size > MAX_FILE_SIZE) {
        throw new Error(`文件过大（${Math.round(fileStat.size / 1024 / 1024)}MB），最大支持 20MB`)
      }

      const buffer = await readFile(safePath)
      return buffer.toString('base64')
    }
  )

  // 在文件管理器中显示附加目录文件
  ipcMain.handle(
    AGENT_IPC_CHANNELS.SHOW_ATTACHED_IN_FOLDER,
    async (_, filePath: string, access?: FileAccessOptions | string[]): Promise<void> => {
      const { resolve } = await import('node:path')
      const safePath = resolve(filePath)
      const options = normalizeFileAccessOptions(access)
      if (!isPathAllowed(safePath, options)) {
        console.warn('[IPC] show-attached-in-folder 拒绝越界路径:', safePath)
        return
      }
      shell.showItemInFolder(safePath)
    }
  )

  // 重命名附加目录文件/目录
  ipcMain.handle(
    AGENT_IPC_CHANNELS.RENAME_ATTACHED_FILE,
    async (_, filePath: string, newName: string, access?: FileAccessOptions | string[]): Promise<void> => {
      const { renameSync } = await import('node:fs')
      const { resolve, dirname, join, sep } = await import('node:path')

      if (newName.includes('/') || newName.includes('\\') || newName.includes('..') || newName.includes(sep)) {
        throw new Error('文件名不能包含路径分隔符或 ".."')
      }
      const safePath = resolve(filePath)
      const options = normalizeFileAccessOptions(access)
      if (!isPathAllowed(safePath, options)) {
        throw new Error('访问路径不在允许范围内')
      }
      const newPath = join(dirname(safePath), newName)
      renameSync(safePath, newPath)
      console.log(`[附加目录] 已重命名: ${safePath} → ${newPath}`)
    }
  )

  // 移动附加目录文件/目录
  ipcMain.handle(
    AGENT_IPC_CHANNELS.MOVE_ATTACHED_FILE,
    async (_, filePath: string, targetDir: string, access?: FileAccessOptions | string[]): Promise<void> => {
      const { renameSync } = await import('node:fs')
      const { resolve, basename, join } = await import('node:path')

      const safePath = resolve(filePath)
      const safeTarget = resolve(targetDir)
      const options = normalizeFileAccessOptions(access)
      if (!isPathAllowed(safePath, options) || !isPathAllowed(safeTarget, options)) {
        throw new Error('访问路径不在允许范围内')
      }
      const newPath = join(safeTarget, basename(safePath))
      renameSync(safePath, newPath)
      console.log(`[附加目录] 已移动: ${safePath} → ${newPath}`)
    }
  )

  // 检查路径类型（文件 or 目录），用于拖拽检测
  ipcMain.handle(
    AGENT_IPC_CHANNELS.CHECK_PATHS_TYPE,
    async (_, paths: string[]): Promise<{ directories: string[]; files: string[] }> => {
      const { statSync } = await import('node:fs')
      const directories: string[] = []
      const files: string[] = []
      for (const p of paths) {
        try {
          const stat = statSync(p)
          if (stat.isDirectory()) {
            directories.push(p)
          } else {
            files.push(p)
          }
        } catch {
          // 无法访问的路径忽略
        }
      }
      return { directories, files }
    }
  )

  // 搜索工作区文件（用于 @ 引用，递归扫描，支持附加目录）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.SEARCH_WORKSPACE_FILES,
    async (_, rootPath: string, query: string, limit = 20, additionalPaths?: string[], sessionPaths?: string[]): Promise<FileSearchResult> => {
      const { readdirSync, statSync } = await import('node:fs')
      const { resolve, relative, basename } = await import('node:path')

      const safeRoot = resolve(rootPath)
      const ignoreDirs = new Set(['node_modules', '.git', 'dist', '.next', '__pycache__', '.venv', 'build', '.cache'])
      const ignoreFiles = new Set(['.DS_Store', '.Spotlight-V100', '.Trashes', 'Thumbs.db', 'desktop.ini'])
      const BROWSE_LIMIT_PER_GROUP = 2000
      const BROWSE_TOTAL_CAP = 3000

      // 按来源分组收集文件
      type Entry = { name: string; path: string; type: 'file' | 'dir'; source: 'session' | 'workspace' }
      const rootEntries: Entry[] = []
      const workspaceEntries: Entry[] = []

      function scan(
        dir: string,
        depth: number,
        baseRoot: string,
        target: Entry[],
        useAbsPath: boolean,
        source: 'session' | 'workspace',
      ): void {
        if (depth > 10) return
        try {
          const items = readdirSync(dir, { withFileTypes: true })
          for (const item of items) {
            if (ignoreFiles.has(item.name)) continue
            if (item.isDirectory() && ignoreDirs.has(item.name)) continue

            const fullPath = resolve(dir, item.name)
            const entryPath = useAbsPath ? fullPath : relative(baseRoot, fullPath)
            target.push({
              name: item.name,
              path: entryPath,
              type: item.isDirectory() ? 'dir' : 'file',
              source,
            })

            if (item.isDirectory()) {
              scan(fullPath, depth + 1, baseRoot, target, useAbsPath, source)
            }
          }
        } catch {
          // 忽略无权限的目录
        }
      }

      function addAttachedPath(pathValue: string, target: Entry[], source: 'session' | 'workspace'): void {
        try {
          const attachedPath = resolve(pathValue)
          const name = basename(attachedPath)
          if (ignoreFiles.has(name)) return

          const stats = statSync(attachedPath)
          if (stats.isFile()) {
            target.push({
              name,
              path: attachedPath,
              type: 'file',
              source,
            })
            return
          }

          if (!stats.isDirectory()) return
          if (ignoreDirs.has(name)) return

          target.push({
            name: name === 'workspace-files' ? '工作文件' : name,
            path: attachedPath,
            type: 'dir',
            source,
          })
          scan(attachedPath, 0, attachedPath, target, true, source)
        } catch {
          // 忽略不存在或无权限的附加路径
        }
      }

      // session 目录：相对路径
      scan(safeRoot, 0, safeRoot, rootEntries, false, 'session')

      // 会话级附加路径：绝对路径，标记为 session（归入会话文件分组）
      if (sessionPaths && sessionPaths.length > 0) {
        for (const sp of sessionPaths) {
          addAttachedPath(sp, rootEntries, 'session')
        }
      }

      // 工作区文件 + 工作区级附加路径：绝对路径，标记为 workspace
      if (additionalPaths && additionalPaths.length > 0) {
        for (const addPath of additionalPaths) {
          addAttachedPath(addPath, workspaceEntries, 'workspace')
        }
      }

      // 组内排序：目录优先，前缀匹配优先，路径短优先
      function sortGroup(entries: Entry[], q: string): void {
        entries.sort((a, b) => {
          const aStartsWith = a.name.toLowerCase().startsWith(q) ? 0 : 1
          const bStartsWith = b.name.toLowerCase().startsWith(q) ? 0 : 1
          if (aStartsWith !== bStartsWith) return aStartsWith - bStartsWith
          if (a.type === 'dir' && b.type !== 'dir') return -1
          if (a.type !== 'dir' && b.type === 'dir') return 1
          return a.path.length - b.path.length
        })
      }

      function matchEntries(entries: Entry[], q: string): Entry[] {
        return entries.filter((entry) => {
          const nameLower = entry.name.toLowerCase()
          const pathLower = entry.path.toLowerCase()
          if (nameLower.startsWith(q)) return true
          if (nameLower.includes(q) || pathLower.includes(q)) return true
          let qi = 0
          for (let i = 0; i < nameLower.length && qi < q.length; i++) {
            if (nameLower[i] === q[qi]) qi++
          }
          return qi === q.length
        })
      }

      // 目录优先排序：确保截断前所有目录（特别是顶层目录）排在前面
      function sortDirsFirst(entries: Entry[]): void {
        entries.sort((a, b) => {
          if (a.type === 'dir' && b.type !== 'dir') return -1
          if (a.type !== 'dir' && b.type === 'dir') return 1
          return a.path.length - b.path.length || a.name.localeCompare(b.name)
        })
      }

      const q = query.toLowerCase()

      if (!q) {
        // 空 query：目录优先排序后再截断，保证文件夹结构完整可见
        sortDirsFirst(rootEntries)
        sortDirsFirst(workspaceEntries)
        const maxPerGroup = Math.max(limit, BROWSE_LIMIT_PER_GROUP)
        const sessionSlice = rootEntries.slice(0, maxPerGroup)
        const workspaceSlice = workspaceEntries.slice(0, maxPerGroup)
        const combined = [...sessionSlice, ...workspaceSlice]
        const capped = combined.length > BROWSE_TOTAL_CAP ? combined.slice(0, BROWSE_TOTAL_CAP) : combined
        return {
          entries: capped,
          total: rootEntries.length + workspaceEntries.length,
          sessionEntries: sessionSlice,
          workspaceEntries: workspaceSlice,
        }
      }

      const sessionMatched = matchEntries(rootEntries, q)
      const workspaceMatched = matchEntries(workspaceEntries, q)
      sortGroup(sessionMatched, q)
      sortGroup(workspaceMatched, q)

      const totalMatched = sessionMatched.length + workspaceMatched.length
      let sessionSlice: Entry[]
      let workspaceSlice: Entry[]
      if (totalMatched <= limit) {
        sessionSlice = sessionMatched
        workspaceSlice = workspaceMatched
      } else {
        const sessionQuota = Math.max(
          sessionMatched.length > 0 ? 1 : 0,
          Math.round(limit * sessionMatched.length / totalMatched),
        )
        const workspaceQuota = Math.max(
          workspaceMatched.length > 0 ? 1 : 0,
          limit - sessionQuota,
        )
        sessionSlice = sessionMatched.slice(0, sessionQuota)
        workspaceSlice = workspaceMatched.slice(0, workspaceQuota)
      }

      return {
        entries: [...sessionSlice, ...workspaceSlice],
        total: sessionMatched.length + workspaceMatched.length,
        sessionEntries: sessionSlice,
        workspaceEntries: workspaceSlice,
      }
    }
  )

  // ===== 系统提示词管理 =====

  // 获取系统提示词配置
  ipcMain.handle(
    SYSTEM_PROMPT_IPC_CHANNELS.GET_CONFIG,
    async (): Promise<SystemPromptConfig> => {
      return getSystemPromptConfig()
    }
  )

  // 创建提示词
  ipcMain.handle(
    SYSTEM_PROMPT_IPC_CHANNELS.CREATE,
    async (_, input: SystemPromptCreateInput): Promise<SystemPrompt> => {
      return createSystemPrompt(input)
    }
  )

  // 更新提示词
  ipcMain.handle(
    SYSTEM_PROMPT_IPC_CHANNELS.UPDATE,
    async (_, id: string, input: SystemPromptUpdateInput): Promise<SystemPrompt> => {
      return updateSystemPrompt(id, input)
    }
  )

  // 删除提示词
  ipcMain.handle(
    SYSTEM_PROMPT_IPC_CHANNELS.DELETE,
    async (_, id: string): Promise<void> => {
      return deleteSystemPrompt(id)
    }
  )

  // 更新追加日期时间和用户名开关
  ipcMain.handle(
    SYSTEM_PROMPT_IPC_CHANNELS.UPDATE_APPEND_SETTING,
    async (_, enabled: boolean): Promise<void> => {
      return updateAppendSetting(enabled)
    }
  )

  // 设置默认提示词
  ipcMain.handle(
    SYSTEM_PROMPT_IPC_CHANNELS.SET_DEFAULT,
    async (_, id: string | null): Promise<void> => {
      return setDefaultPrompt(id)
    }
  )

  // ===== GitHub Release =====

  // 获取最新 Release
  ipcMain.handle(
    GITHUB_RELEASE_IPC_CHANNELS.GET_LATEST_RELEASE,
    async (): Promise<GitHubRelease | null> => {
      return getLatestRelease()
    }
  )

  // 获取 Release 列表
  ipcMain.handle(
    GITHUB_RELEASE_IPC_CHANNELS.LIST_RELEASES,
    async (_, options?: GitHubReleaseListOptions): Promise<GitHubRelease[]> => {
      return listGitHubReleases(options)
    }
  )

  // 获取指定版本的 Release
  ipcMain.handle(
    GITHUB_RELEASE_IPC_CHANNELS.GET_RELEASE_BY_TAG,
    async (_, tag: string): Promise<GitHubRelease | null> => {
      return getReleaseByTag(tag)
    }
  )

  // ===== 本地化版本历史（Release Notes）=====
  // 版本历史读本地 resources/release-notes/*.md，完全离线可用，不依赖 GitHub 网络

  // 获取版本历史列表（semver 降序，最近 N 条）
  ipcMain.handle(
    RELEASE_NOTES_IPC_CHANNELS.LIST,
    async (): Promise<ReturnType<typeof getReleaseNotesList>> => {
      return getReleaseNotesList()
    }
  )

  // 获取最新版本号
  ipcMain.handle(
    RELEASE_NOTES_IPC_CHANNELS.LATEST,
    async (): Promise<string | undefined> => {
      return getLatestReleaseVersion()
    }
  )

  // 获取合并后的完整版本历史 Markdown
  ipcMain.handle(
    RELEASE_NOTES_IPC_CHANNELS.COMBINED,
    async (): Promise<string> => {
      return getCombinedReleaseNotes()
    }
  )

  // ===== 飞书集成 =====

  // --- 旧 API（向后兼容，操作 bots[0]）---

  // 获取飞书配置
  ipcMain.handle(
    FEISHU_IPC_CHANNELS.GET_CONFIG,
    async (): Promise<FeishuConfig> => {
      return getFeishuConfig()
    }
  )

  // 获取解密后的 App Secret
  ipcMain.handle(
    FEISHU_IPC_CHANNELS.GET_DECRYPTED_SECRET,
    async (): Promise<string> => {
      return getDecryptedAppSecret()
    }
  )

  // 保存飞书配置（旧格式，操作 bots[0]）
  ipcMain.handle(
    FEISHU_IPC_CHANNELS.SAVE_CONFIG,
    async (_, input: FeishuConfigInput): Promise<FeishuConfig> => {
      const config = saveFeishuConfig(input)
      // 配置变更后，重启对应的 Bot
      const multi = getFeishuMultiBotConfig()
      const firstBot = multi.bots[0]
      if (firstBot) {
        if (input.enabled && input.appId && input.appSecret) {
          await feishuBridgeManager.restartBot(firstBot.id)
        } else if (!input.enabled) {
          feishuBridgeManager.stopBot(firstBot.id)
        }
      }
      return config
    }
  )

  // 启动飞书 Bridge（旧格式，启动所有 Bot）
  ipcMain.handle(
    FEISHU_IPC_CHANNELS.START_BRIDGE,
    async (): Promise<void> => {
      await feishuBridgeManager.startAll()
    }
  )

  // 停止飞书 Bridge（旧格式，停止所有 Bot）
  ipcMain.handle(
    FEISHU_IPC_CHANNELS.STOP_BRIDGE,
    async (): Promise<void> => {
      feishuBridgeManager.stopAll()
    }
  )

  // 获取飞书 Bridge 状态（旧格式，返回第一个 Bot 状态）
  ipcMain.handle(
    FEISHU_IPC_CHANNELS.GET_STATUS,
    async (): Promise<FeishuBridgeState> => {
      const states = feishuBridgeManager.getStates()
      const first = Object.values(states.bots)[0]
      return first ?? { status: 'disconnected', activeBindings: 0 }
    }
  )

  // --- 新 API（多 Bot v2）---

  // 获取多 Bot 配置
  ipcMain.handle(
    FEISHU_IPC_CHANNELS.GET_MULTI_CONFIG,
    async () => {
      return getFeishuMultiBotConfig()
    }
  )

  // 保存单个 Bot 配置
  ipcMain.handle(
    FEISHU_IPC_CHANNELS.SAVE_BOT_CONFIG,
    async (_, input: import('@myyoda/shared').FeishuBotConfigInput) => {
      const saved = saveFeishuBotConfig(input)
      feishuBridgeManager.setSessionMirrorOperator(saved.id, input.operatorOpenId)
      // 配置变更后自动重启或停止（不阻塞保存结果）
      if (saved.enabled && saved.appId && saved.appSecret) {
        feishuBridgeManager.restartBot(saved.id).catch((err) => {
          console.error(`[飞书 IPC] Bot "${saved.name}" 重启失败:`, err)
        })
      } else {
        feishuBridgeManager.stopBot(saved.id)
      }
      return saved
    }
  )

  // 删除 Bot
  ipcMain.handle(
    FEISHU_IPC_CHANNELS.REMOVE_BOT,
    async (_, botId: string) => {
      feishuBridgeManager.stopBot(botId)
      return removeFeishuBot(botId)
    }
  )

  // 获取单个 Bot 解密 Secret
  ipcMain.handle(
    FEISHU_IPC_CHANNELS.GET_BOT_DECRYPTED_SECRET,
    async (_, botId: string) => {
      return getDecryptedBotAppSecret(botId)
    }
  )

  // 启动单个 Bot
  ipcMain.handle(
    FEISHU_IPC_CHANNELS.START_BOT,
    async (_, botId: string) => {
      await feishuBridgeManager.startBot(botId)
    }
  )

  // 停止单个 Bot
  ipcMain.handle(
    FEISHU_IPC_CHANNELS.STOP_BOT,
    async (_, botId: string) => {
      feishuBridgeManager.stopBot(botId)
    }
  )

  // 获取多 Bot 状态
  ipcMain.handle(
    FEISHU_IPC_CHANNELS.GET_MULTI_STATUS,
    async () => {
      return feishuBridgeManager.getStates()
    }
  )

  // 测试飞书连接
  ipcMain.handle(
    FEISHU_IPC_CHANNELS.TEST_CONNECTION,
    async (_, appId: string, appSecret: string): Promise<FeishuTestResult> => {
      return feishuBridgeManager.testConnection(appId, appSecret)
    }
  )

  // 获取绑定列表（包含已归档，前端按视图过滤）
  ipcMain.handle(
    FEISHU_IPC_CHANNELS.LIST_BINDINGS,
    async (): Promise<FeishuChatBinding[]> => {
      return feishuBridgeManager.listAllBindings()
    }
  )

  // 更新绑定（工作区/会话）
  ipcMain.handle(
    FEISHU_IPC_CHANNELS.UPDATE_BINDING,
    async (_, input: FeishuUpdateBindingInput): Promise<FeishuChatBinding | null> => {
      const bridge = feishuBridgeManager.findBridgeByChatId(input.chatId)
      return bridge?.updateBinding(input) ?? null
    }
  )

  // 移除绑定
  ipcMain.handle(
    FEISHU_IPC_CHANNELS.REMOVE_BINDING,
    async (_, chatId: string): Promise<boolean> => {
      const bridge = feishuBridgeManager.findBridgeByChatId(chatId)
      return bridge?.removeBinding(chatId) ?? false
    }
  )

  // 上报用户在场状态
  ipcMain.handle(
    FEISHU_IPC_CHANNELS.REPORT_PRESENCE,
    async (_, report: FeishuPresenceReport): Promise<void> => {
      presenceService.updatePresence(report)
    }
  )

  // ===== 飞书扫码注册 =====

  /** 当前进行中的注册流程的 AbortController（同一时间只允许一个） */
  let activeRegisterAbort: AbortController | null = null

  ipcMain.handle(
    FEISHU_IPC_CHANNELS.REGISTER_APP_START,
    async (event): Promise<FeishuRegisterAppResult> => {
      // 同一时间只允许一个注册流程
      if (activeRegisterAbort) {
        activeRegisterAbort.abort()
      }
      const abort = new AbortController()
      activeRegisterAbort = abort

      try {
        const lark = await import('@larksuiteoapi/node-sdk')
        const QRCode = (await import('qrcode')).default
        const result = await lark.registerApp({
          source: 'myyoda',
          signal: abort.signal,
          onQRCodeReady: async (info) => {
            if (event.sender.isDestroyed()) return
            try {
              const dataUrl = await QRCode.toDataURL(info.url, { width: 280, margin: 2, errorCorrectionLevel: 'M' })
              if (event.sender.isDestroyed()) return
              const payload: FeishuRegisterAppQRCode = {
                url: info.url,
                dataUrl,
                expireIn: info.expireIn,
              }
              event.sender.send(FEISHU_IPC_CHANNELS.REGISTER_APP_QRCODE, payload)
            } catch (err) {
              console.error('[飞书扫码注册] QRCode 生成失败:', err)
              if (event.sender.isDestroyed()) return
              // 兜底：仍把 url 发过去，渲染层可用浏览器打开
              event.sender.send(FEISHU_IPC_CHANNELS.REGISTER_APP_QRCODE, {
                url: info.url,
                dataUrl: '',
                expireIn: info.expireIn,
              })
            }
          },
          onStatusChange: (info) => {
            if (event.sender.isDestroyed()) return
            const payload: FeishuRegisterAppStatus = {
              status: info.status,
              interval: info.interval,
            }
            event.sender.send(FEISHU_IPC_CHANNELS.REGISTER_APP_STATUS, payload)
          },
        })
        return {
          appId: result.client_id,
          appSecret: result.client_secret,
          tenantBrand: result.user_info?.tenant_brand,
          operatorOpenId: result.user_info?.open_id,
        }
      } finally {
        if (activeRegisterAbort === abort) {
          activeRegisterAbort = null
        }
      }
    }
  )

  ipcMain.handle(
    FEISHU_IPC_CHANNELS.REGISTER_APP_CANCEL,
    async (): Promise<void> => {
      activeRegisterAbort?.abort()
      activeRegisterAbort = null
    }
  )

  // ===== 钉钉集成 =====

  // 获取钉钉配置（旧 API，向后兼容）
  ipcMain.handle(
    DINGTALK_IPC_CHANNELS.GET_CONFIG,
    async (): Promise<DingTalkConfig> => {
      return getDingTalkConfig()
    }
  )

  // 获取解密后的 Client Secret（旧 API，向后兼容）
  ipcMain.handle(
    DINGTALK_IPC_CHANNELS.GET_DECRYPTED_SECRET,
    async (): Promise<string> => {
      return getDecryptedClientSecret()
    }
  )

  // 保存钉钉配置（旧 API，向后兼容）
  ipcMain.handle(
    DINGTALK_IPC_CHANNELS.SAVE_CONFIG,
    async (_, input: DingTalkConfigInput): Promise<DingTalkConfig> => {
      return saveDingTalkConfig(input)
    }
  )

  // 测试钉钉连接
  ipcMain.handle(
    DINGTALK_IPC_CHANNELS.TEST_CONNECTION,
    async (_, clientId: string, clientSecret: string): Promise<DingTalkTestResult> => {
      return dingtalkBridgeManager.testConnection(clientId, clientSecret)
    }
  )

  // 启动钉钉 Bridge（旧 API，启动第一个 Bot）
  ipcMain.handle(
    DINGTALK_IPC_CHANNELS.START_BRIDGE,
    async (): Promise<void> => {
      await dingtalkBridgeManager.startAll()
    }
  )

  // 停止钉钉 Bridge（旧 API，停止所有 Bot）
  ipcMain.handle(
    DINGTALK_IPC_CHANNELS.STOP_BRIDGE,
    async (): Promise<void> => {
      dingtalkBridgeManager.stopAll()
    }
  )

  // 获取钉钉 Bridge 状态（旧 API，返回第一个 Bot 状态）
  ipcMain.handle(
    DINGTALK_IPC_CHANNELS.GET_STATUS,
    async (): Promise<DingTalkBridgeState> => {
      const states = dingtalkBridgeManager.getStates()
      const first = Object.values(states.bots)[0]
      return first ?? { status: 'disconnected' }
    }
  )

  // --- 钉钉多 Bot v2 API ---

  // 获取多 Bot 配置
  ipcMain.handle(
    DINGTALK_IPC_CHANNELS.GET_MULTI_CONFIG,
    async () => {
      return getDingTalkMultiBotConfig()
    }
  )

  // 保存单个 Bot 配置
  ipcMain.handle(
    DINGTALK_IPC_CHANNELS.SAVE_BOT_CONFIG,
    async (_, input: import('@myyoda/shared').DingTalkBotConfigInput) => {
      const saved = saveDingTalkBotConfig(input)
      // 配置变更后自动重启或停止（不阻塞保存结果）
      if (saved.enabled && saved.clientId && saved.clientSecret) {
        dingtalkBridgeManager.restartBot(saved.id).catch((err) => {
          console.error(`[钉钉 IPC] Bot "${saved.name}" 重启失败:`, err)
        })
      } else {
        dingtalkBridgeManager.stopBot(saved.id)
      }
      return saved
    }
  )

  // 删除 Bot
  ipcMain.handle(
    DINGTALK_IPC_CHANNELS.REMOVE_BOT,
    async (_, botId: string) => {
      dingtalkBridgeManager.stopBot(botId)
      return removeDingTalkBot(botId)
    }
  )

  // 获取单个 Bot 解密 Secret
  ipcMain.handle(
    DINGTALK_IPC_CHANNELS.GET_BOT_DECRYPTED_SECRET,
    async (_, botId: string) => {
      return getDecryptedBotClientSecret(botId)
    }
  )

  // 启动单个 Bot
  ipcMain.handle(
    DINGTALK_IPC_CHANNELS.START_BOT,
    async (_, botId: string) => {
      await dingtalkBridgeManager.startBot(botId)
    }
  )

  // 停止单个 Bot
  ipcMain.handle(
    DINGTALK_IPC_CHANNELS.STOP_BOT,
    async (_, botId: string) => {
      dingtalkBridgeManager.stopBot(botId)
    }
  )

  // 获取多 Bot 状态
  ipcMain.handle(
    DINGTALK_IPC_CHANNELS.GET_MULTI_STATUS,
    async () => {
      return dingtalkBridgeManager.getStates()
    }
  )

  // ===== 微信集成 =====

  // 获取微信配置
  ipcMain.handle(
    WECHAT_IPC_CHANNELS.GET_CONFIG,
    async (): Promise<WeChatConfig> => {
      return getWeChatConfig()
    }
  )

  // 开始扫码登录
  ipcMain.handle(
    WECHAT_IPC_CHANNELS.START_LOGIN,
    async (): Promise<void> => {
      await wechatBridge.startLogin()
    }
  )

  // 登出
  ipcMain.handle(
    WECHAT_IPC_CHANNELS.LOGOUT,
    async (): Promise<void> => {
      wechatBridge.logout()
    }
  )

  // 启动 Bridge（用已有凭证）
  ipcMain.handle(
    WECHAT_IPC_CHANNELS.START_BRIDGE,
    async (): Promise<void> => {
      await wechatBridge.start()
    }
  )

  // 停止 Bridge
  ipcMain.handle(
    WECHAT_IPC_CHANNELS.STOP_BRIDGE,
    async (): Promise<void> => {
      wechatBridge.stop()
    }
  )

  // 获取 Bridge 状态
  ipcMain.handle(
    WECHAT_IPC_CHANNELS.GET_STATUS,
    async (): Promise<WeChatBridgeState> => {
      return wechatBridge.getStatus()
    }
  )

  console.log('[IPC] IPC 处理器注册完成')

  // 注册更新 IPC 处理器
  registerUpdaterIpc()

  // 启动时自动归档 + 每 24 小时定期检查
  const runAutoArchive = (): void => {
    try {
      const settings = getSettings()
      const days = settings.archiveAfterDays ?? 7
      if (days > 0) {
        const archivedChats = autoArchiveConversations(days)
        const archivedSessions = autoArchiveAgentSessions(days)
        if (archivedChats + archivedSessions > 0) {
          console.log(`[自动归档] 已归档 ${archivedChats} 个对话, ${archivedSessions} 个 Agent 会话`)
        }
      }
    } catch (error) {
      console.error('[自动归档] 自动归档失败:', error)
    }
  }

  runAutoArchive()
  setInterval(runAutoArchive, 24 * 60 * 60 * 1000)

  // 启动时清理不存在的附加目录/文件（如已删除的 worktree）
  try {
    cleanupStaleAttachedPaths()
    cleanupStaleWorkspaceAttachedPaths()
  } catch (error) {
    console.error('[启动清理] 清理失效附加路径失败:', error)
  }

  // ===== 存储管理 =====

  ipcMain.handle(STORAGE_IPC_CHANNELS.GET_STATS, async () => {
    return calculateStorageStats()
  })

  ipcMain.handle(STORAGE_IPC_CHANNELS.CLEANUP, async (_, options: CleanupOptions) => {
    return cleanupStorage(options)
  })

  ipcMain.handle(STORAGE_IPC_CHANNELS.CLEANUP_TEMP, async () => {
    return cleanupTempFiles()
  })

  // ===== 用量统计 =====

  ipcMain.handle(USAGE_IPC_CHANNELS.GET_STATS, async (_event, range: UsageRange) => {
    return getAgentUsageStats(range ?? 'all')
  })

  // 迁移取消时清理临时解压目录
  ipcMain.handle('migration:cancelImport', async (_, tempDir: string) => {
    if (tempDir && existsSync(tempDir) && tempDir.includes('myyoda-import-')) {
      rmSync(tempDir, { recursive: true, force: true })
      console.log(`[迁移] 已清理临时目录: ${tempDir}`)
    }
  })

  // 启动时自动清理临时文件
  const runStartupCleanup = async (): Promise<void> => {
    try {
      const settings = getSettings()
      if (settings.autoCleanupTempOnStart !== false) {
        const result = await cleanupTempFiles()
        if (result.freedBytes > 0) {
          console.log(`[存储清理] 启动时清理了 ${(result.freedBytes / 1024 / 1024).toFixed(1)} MB 临时文件`)
        }
      }
      const archiveDays = settings.autoCleanupArchivedDays ?? 0
      if (archiveDays > 0) {
        const result = await cleanupStorage({
          categories: ['agent-sessions', 'sdk-config'],
          orphansOnly: false,
          archivedBeforeDays: archiveDays,
        })
        if (result.freedBytes > 0) {
          console.log(`[存储清理] 启动时清理了 ${(result.freedBytes / 1024 / 1024).toFixed(1)} MB 归档数据`)
        }
      }
    } catch (e) {
      console.error('[存储清理] 启动时清理失败:', e)
    }
  }
  runStartupCleanup()

  // ===== 快速任务窗口 =====

  // 提交快速任务 → 隐藏窗口 + 转发到主窗口（由渲染进程创建会话并发送消息）
  ipcMain.handle(
    QUICK_TASK_IPC_CHANNELS.SUBMIT,
    async (_, input: QuickTaskSubmitInput): Promise<void> => {
      const { hideQuickTaskWindow } = await import('./lib/quick-task-window')
      const { getMainWindow } = await import('./index')
      hideQuickTaskWindow()

      const mainWin = getMainWindow()
      if (mainWin && !mainWin.isDestroyed()) {
        // 转发到主窗口渲染进程，由 GlobalShortcuts 创建会话并触发发送
        mainWin.webContents.send('quick-task:open-session', {
          mode: input.mode,
          text: input.text,
          files: input.files,
        })
        mainWin.show()
        mainWin.focus()
      }
    }
  )

  // 隐藏快速任务窗口
  ipcMain.handle(
    QUICK_TASK_IPC_CHANNELS.HIDE,
    async (): Promise<void> => {
      const { hideQuickTaskWindow } = await import('./lib/quick-task-window')
      hideQuickTaskWindow()
    }
  )

  // 重新注册全局快捷键（设置中修改快捷键后调用）
  ipcMain.handle(
    QUICK_TASK_IPC_CHANNELS.REREGISTER_GLOBAL_SHORTCUTS,
    async (): Promise<Record<string, boolean>> => {
      const { reregisterAllGlobalShortcuts } = await import('./lib/global-shortcut-service')
      return reregisterAllGlobalShortcuts()
    }
  )

  // 查询系统实际接受的全局快捷键，供快捷键地图标示未注册项。
  ipcMain.handle(
    QUICK_TASK_IPC_CHANNELS.GET_GLOBAL_SHORTCUT_REGISTRATION_STATUS,
    async (): Promise<Record<string, boolean>> => {
      const { getGlobalShortcutRegistrationStatus } = await import('./lib/global-shortcut-service')
      return getGlobalShortcutRegistrationStatus()
    }
  )

  // ===== 语音输入 =====

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.GET_SETTINGS,
    async (): Promise<VoiceDictationSettings> => {
      const { getVoiceDictationSettings } = await import('./lib/voice-dictation-settings-service')
      return getVoiceDictationSettings()
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.UPDATE_SETTINGS,
    async (_, updates: VoiceDictationSettingsUpdate): Promise<VoiceDictationSettings> => {
      const { updateVoiceDictationSettings } = await import('./lib/voice-dictation-settings-service')
      return updateVoiceDictationSettings(updates)
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.TEST_CONNECTION,
    async (_, updates?: VoiceDictationSettingsUpdate): Promise<VoiceDictationTestResult> => {
      const { getVoiceDictationSettings } = await import('./lib/voice-dictation-settings-service')
      const { testDoubaoAsrConnection } = await import('./lib/doubao-asr-service')
      const settings = { ...getVoiceDictationSettings(), ...(updates ?? {}) }
      return testDoubaoAsrConnection(settings)
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.TOGGLE,
    async (event, input?: VoiceDictationToggleInput): Promise<void> => {
      const { toggleVoiceDictationWindow } = await import('./lib/voice-dictation-window')
      const sourceWindow = BrowserWindow.fromWebContents(event.sender)
      const sourceInputId = typeof input?.sourceInputId === 'string' && input.sourceInputId.length > 0 && input.sourceInputId.length <= 512
        ? input.sourceInputId
        : undefined
      toggleVoiceDictationWindow({ targetIsMyYoda: !!sourceWindow, sourceInputId })
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.START,
    async (event, input: VoiceDictationStartInput): Promise<void> => {
      const { getVoiceDictationSettings } = await import('./lib/voice-dictation-settings-service')
      const { startDoubaoAsrSession } = await import('./lib/doubao-asr-service')
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) throw new Error('语音输入窗口不存在')
      await startDoubaoAsrSession(input.sessionId, getVoiceDictationSettings(), win)
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.SEND_AUDIO,
    async (_, input: VoiceDictationAudioChunkInput): Promise<void> => {
      const { sendDoubaoAsrAudio } = await import('./lib/doubao-asr-service')
      sendDoubaoAsrAudio(input.sessionId, input.data)
    }
  )

  ipcMain.on(VOICE_DICTATION_IPC_CHANNELS.REPORT_VOLUME, (event, volume: unknown) => {
    void Promise.all([
      import('./index'),
      import('./lib/voice-dictation-window'),
    ]).then(([{ getMainWindow }, { updateVoiceDictationIndicatorVolume }]) => {
      const mainWindow = getMainWindow()
      if (!mainWindow || mainWindow.isDestroyed() || event.sender.id !== mainWindow.webContents.id) return
      updateVoiceDictationIndicatorVolume(typeof volume === 'number' ? volume : 0)
    }).catch(console.error)
  })

  ipcMain.on(VOICE_DICTATION_IPC_CHANNELS.REPORT_TRANSCRIPT, (event, text: unknown) => {
    void Promise.all([
      import('./index'),
      import('./lib/voice-dictation-window'),
    ]).then(([{ getMainWindow }, { updateVoiceDictationIndicatorTranscript }]) => {
      const mainWindow = getMainWindow()
      if (!mainWindow || mainWindow.isDestroyed() || event.sender.id !== mainWindow.webContents.id) return
      updateVoiceDictationIndicatorTranscript(typeof text === 'string' ? text.slice(-4_000) : '')
    }).catch(console.error)
  })

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.STOP,
    async (_, input: VoiceDictationStopInput): Promise<void> => {
      const { stopDoubaoAsrSession } = await import('./lib/doubao-asr-service')
      await stopDoubaoAsrSession(input.sessionId)
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.CANCEL,
    async (_, input: VoiceDictationStopInput): Promise<void> => {
      const { cancelDoubaoAsrSession } = await import('./lib/doubao-asr-service')
      const { clearVoiceDictationPreview } = await import('./lib/text-output-service')
      clearVoiceDictationPreview(
        input.previewSessionId ?? input.sessionId,
        input.targetInputId,
        input.outputContextId,
      )
      cancelDoubaoAsrSession(input.sessionId)
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.PREVIEW,
    async (_, input: VoiceDictationPreviewInput): Promise<void> => {
      const { getVoiceDictationSettings } = await import('./lib/voice-dictation-settings-service')
      const { previewVoiceDictationText } = await import('./lib/text-output-service')
      previewVoiceDictationText(input, getVoiceDictationSettings())
    }
  )

  ipcMain.on(VOICE_DICTATION_IPC_CHANNELS.ACK_INSERT_TEXT, (event, input: VoiceDictationTextDeliveryInput) => {
    void Promise.all([
      import('./index'),
      import('./lib/text-output-service'),
    ]).then(([{ getMainWindow }, { acknowledgeVoiceDictationTextDelivery }]) => {
      const mainWindow = getMainWindow()
      if (!mainWindow || mainWindow.isDestroyed() || event.sender.id !== mainWindow.webContents.id) return
      if (!input || typeof input.sessionId !== 'string' || typeof input.delivered !== 'boolean') return
      acknowledgeVoiceDictationTextDelivery(input.sessionId, input.delivered)
    }).catch(console.error)
  })

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.COMMIT,
    async (_, input: VoiceDictationCommitInput): Promise<VoiceDictationCommitResult> => {
      const { getVoiceDictationSettings } = await import('./lib/voice-dictation-settings-service')
      const { commitVoiceDictationText } = await import('./lib/text-output-service')
      return commitVoiceDictationText(input, getVoiceDictationSettings())
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.HIDE,
    async (): Promise<void> => {
      const { hideVoiceDictationWindow } = await import('./lib/voice-dictation-window')
      hideVoiceDictationWindow()
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.RESIZE,
    async (_, input: VoiceDictationResizeInput): Promise<void> => {
      const { resizeVoiceDictationWindow } = await import('./lib/voice-dictation-window')
      resizeVoiceDictationWindow(input.height)
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.CHECK_MIC_PERMISSION,
    async (): Promise<MicPermissionResult> => {
      const { checkMicrophonePermission } = await import('./lib/microphone-permission-service')
      return checkMicrophonePermission()
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.REQUEST_MIC_PERMISSION,
    async (): Promise<MicPermissionResult> => {
      const { requestMicrophonePermission } = await import('./lib/microphone-permission-service')
      return requestMicrophonePermission()
    }
  )

  // ===== 数据迁移 =====

  ipcMain.handle('migration:getExportPreview', async (_, workspaceId: string) => {
    const { getExportPreview } = await import('./lib/migration-service')
    return getExportPreview(workspaceId)
  })

  ipcMain.handle('migration:getShareExportPreview', async () => {
    const { getShareExportPreview } = await import('./lib/migration-service')
    return getShareExportPreview()
  })

  ipcMain.handle('migration:export', async (_, options) => {
    const { exportData } = await import('./lib/migration-service')
    return exportData(options)
  })

  ipcMain.handle('migration:exportV2', async (_, options) => {
    const { exportDataV2 } = await import('./lib/migration-service')
    return exportDataV2(options)
  })

  ipcMain.handle('migration:parseImportFile', async (_, filePath: string) => {
    const { parseImportFile } = await import('./lib/migration-service')
    return parseImportFile(filePath)
  })

  ipcMain.handle('migration:confirmImport', async (_, options) => {
    const { confirmImport } = await import('./lib/migration-service')
    return confirmImport(options)
  })

  ipcMain.handle('migration:openFileDialog', async () => {
    const { dialog } = await import('electron')
    const result = await dialog.showOpenDialog({
      title: '选择迁移文件',
      filters: [
        { name: 'MyYoda 迁移文件', extensions: ['myyoda-backup', 'myyoda-share'] },
        { name: '所有文件', extensions: ['*'] },
      ],
      properties: ['openFile'],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('migration:saveFileDialog', async (_, mode: string) => {
    const { dialog } = await import('electron')
    const ext = mode === 'personal' ? 'myyoda-backup' : 'myyoda-share'
    const defaultName = `myyoda-migration-${new Date().toISOString().slice(0, 10)}.${ext}`
    const result = await dialog.showSaveDialog({
      title: '保存迁移文件',
      defaultPath: defaultName,
      filters: [
        { name: mode === 'personal' ? 'MyYoda 个人备份' : 'MyYoda 分享包', extensions: [ext] },
      ],
    })
    return result.canceled ? null : result.filePath
  })

  // ===== 窗口控制（Windows 自定义标题栏按钮）=====

  ipcMain.handle(
    IPC_CHANNELS.WINDOW_MINIMIZE,
    async (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win && !win.isDestroyed()) win.minimize()
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.WINDOW_MAXIMIZE,
    async (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win && !win.isDestroyed()) {
        win.isMaximized() ? win.unmaximize() : win.maximize()
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.WINDOW_CLOSE,
    async (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win && !win.isDestroyed()) win.close()
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.WINDOW_IS_MAXIMIZED,
    async (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      return win && !win.isDestroyed() ? win.isMaximized() : false
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.WINDOW_IS_FULLSCREEN,
    async (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      return win && !win.isDestroyed() ? win.isFullScreen() : false
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.WINDOW_GET_ZOOM_FACTOR,
    async (event) => event.sender.getZoomFactor(),
  )

  // ===== 任务 / 日程（Planning）=====

  const isPlanningTitle = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 500
  const isPlanningTimestamp = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0
  const isTodoPriority = (value: unknown): value is 'low' | 'medium' | 'high' =>
    value === 'low' || value === 'medium' || value === 'high'
  const isTodoStatus = (value: unknown): value is 'open' | 'completed' =>
    value === 'open' || value === 'completed'
  const parseTodoListQuery = (input: unknown): TodoListQuery => {
    if (input === undefined) return {}
    if (!input || typeof input !== 'object') throw new Error('Todo 查询参数非法')
    const query = input as TodoListQuery
    if (query.status !== undefined && !isTodoStatus(query.status)) throw new Error('Todo status 非法')
    if (query.dueBefore !== undefined && !isPlanningTimestamp(query.dueBefore)) throw new Error('Todo dueBefore 非法')
    if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 1)) throw new Error('Todo limit 非法')
    return query
  }
  const parseCalendarEventListQuery = (input: unknown): CalendarEventListQuery => {
    if (input === undefined) return {}
    if (!input || typeof input !== 'object') throw new Error('日程查询参数非法')
    const query = input as CalendarEventListQuery
    if (query.from !== undefined && !isPlanningTimestamp(query.from)) throw new Error('日程 from 非法')
    if (query.to !== undefined && !isPlanningTimestamp(query.to)) throw new Error('日程 to 非法')
    if (query.from !== undefined && query.to !== undefined && query.from > query.to) throw new Error('日程范围非法')
    if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 1)) throw new Error('日程 limit 非法')
    return query
  }

  ipcMain.handle(PLANNING_IPC_CHANNELS.OPEN_WINDOW, async (): Promise<void> => {
    const { showPlanningWindow } = await import('./lib/planning-window')
    showPlanningWindow()
  })

  ipcMain.handle(PLANNING_IPC_CHANNELS.LIST_TODOS, async (_, scope?: PlanningWorkspaceScope, workspaceId?: string): Promise<Todo[]> =>
    listTodos(scope === 'all' ? {} : { workspaceId: workspaceId ?? getSettings().agentWorkspaceId ?? '' }))
  ipcMain.handle(PLANNING_IPC_CHANNELS.CREATE_TODO, async (_, input: CreateTodoInput): Promise<Todo> => {
    if (!input || !isPlanningTitle(input.title)) throw new Error('Todo 标题不能为空且不能超过 500 字')
    if (input.priority !== undefined && !isTodoPriority(input.priority)) throw new Error('Todo priority 非法')
    if (input.dueAt !== undefined && !isPlanningTimestamp(input.dueAt)) throw new Error('Todo dueAt 非法')
    if (input.sessionId !== undefined && (typeof input.sessionId !== 'string' || !input.sessionId.trim())) throw new Error('Todo sessionId 非法')
    const todo = createTodo(input)
    broadcastPlanningChanged(['todos', 'reminders'])
    return todo
  })
  ipcMain.handle(PLANNING_IPC_CHANNELS.START_TODO_AGENT, async (event, input: StartTodoAgentInput): Promise<StartTodoAgentResult> => {
    if (!input || typeof input.todoId !== 'string' || !input.todoId) throw new Error('Todo id 必填')
    if (typeof input.workspaceId !== 'string' || !input.workspaceId) throw new Error('workspaceId 必填')
    if (typeof input.channelId !== 'string' || !input.channelId) throw new Error('channelId 必填')
    if (!isPlanningTimestamp(input.expectedUpdatedAt)) throw new Error('Todo expectedUpdatedAt 非法')
    const todo = getTodo(input.todoId)
    if (!todo) throw new Error('Todo 不存在')
    if (todo.updatedAt !== input.expectedUpdatedAt) throw new Error('Todo 已被修改，请刷新后重试')
    const session = createAgentSession(
      `处理：${todo.title}`,
      input.channelId,
      input.workspaceId,
      input.modelId,
      getSettings().agentRuntime ?? 'pi',
    )
    touchTodoSession(todo.id, session.id)
    broadcastPlanningChanged(['todos'])

    // 独立规划窗口没有 AgentView，需由主窗口接手打开会话并消费自动启动提示。
    try {
      const sourceWindowKind = new URL(event.sender.getURL()).searchParams.get('window')
      if (sourceWindowKind === 'planning') {
        const mainWindow = BrowserWindow.getAllWindows().find((win) => {
          if (win.isDestroyed() || win.webContents.id === event.sender.id) return false
          return new URL(win.webContents.getURL()).searchParams.get('window') === null
        })
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore()
          mainWindow.show()
          mainWindow.focus()
          const activation: TodoAgentSessionActivation = { todo: getTodo(todo.id) ?? todo, session }
          mainWindow.webContents.send(PLANNING_IPC_CHANNELS.TODO_AGENT_SESSION_READY, activation)
        }
      }
    } catch (error) {
      console.error('[任务/日程] 转交 Todo Agent 会话到主窗口失败:', error)
    }

    return { todo: getTodo(todo.id) ?? todo, session }
  })
  ipcMain.handle(PLANNING_IPC_CHANNELS.UPDATE_TODO, async (_, input: UpdateTodoInput): Promise<Todo | undefined> => {
    if (!input || typeof input.id !== 'string' || !input.id) throw new Error('Todo id 必填')
    if (input.title !== undefined && !isPlanningTitle(input.title)) throw new Error('Todo 标题不能为空且不能超过 500 字')
    if (input.priority !== undefined && !isTodoPriority(input.priority)) throw new Error('Todo priority 非法')
    if (input.status !== undefined && !isTodoStatus(input.status)) throw new Error('Todo status 非法')
    if (input.dueAt !== undefined && input.dueAt !== null && !isPlanningTimestamp(input.dueAt)) throw new Error('Todo dueAt 非法')
    if (input.expectedUpdatedAt !== undefined && !isPlanningTimestamp(input.expectedUpdatedAt)) throw new Error('Todo expectedUpdatedAt 非法')
    const todo = updateTodo(input)
    if (todo) broadcastPlanningChanged(['todos', 'reminders'])
    return todo
  })
  ipcMain.handle(PLANNING_IPC_CHANNELS.DELETE_TODO, async (_, id: string): Promise<boolean> => {
    if (!id || typeof id !== 'string') throw new Error('Todo id 必填')
    const deleted = deleteTodo(id)
    if (deleted) broadcastPlanningChanged(['todos', 'calendar_events', 'reminders'])
    return deleted
  })

  ipcMain.handle(PLANNING_IPC_CHANNELS.LIST_CALENDAR_EVENTS, async (_, scope?: PlanningWorkspaceScope, workspaceId?: string): Promise<CalendarEvent[]> =>
    listCalendarEvents(scope === 'all' ? {} : { workspaceId: workspaceId ?? getSettings().agentWorkspaceId ?? '' }))
  ipcMain.handle(PLANNING_IPC_CHANNELS.CREATE_CALENDAR_EVENT, async (_, input: CreateCalendarEventInput): Promise<CalendarEvent> => {
    if (!input || !isPlanningTitle(input.title) || !isPlanningTimestamp(input.startAt)) throw new Error('日程标题和 startAt 必填')
    if (input.endAt !== undefined && (!isPlanningTimestamp(input.endAt) || input.endAt < input.startAt)) throw new Error('日程 endAt 非法')
    const event = createCalendarEvent(input)
    broadcastPlanningChanged(['calendar_events', 'reminders'])
    return event
  })
  ipcMain.handle(PLANNING_IPC_CHANNELS.UPDATE_CALENDAR_EVENT, async (_, input: UpdateCalendarEventInput): Promise<CalendarEvent | undefined> => {
    if (!input || typeof input.id !== 'string' || !input.id) throw new Error('日程 id 必填')
    if (input.title !== undefined && !isPlanningTitle(input.title)) throw new Error('日程标题不能为空且不能超过 500 字')
    if (input.startAt !== undefined && !isPlanningTimestamp(input.startAt)) throw new Error('日程 startAt 非法')
    if (input.endAt !== undefined && input.endAt !== null && !isPlanningTimestamp(input.endAt)) throw new Error('日程 endAt 非法')
    if (input.expectedUpdatedAt !== undefined && !isPlanningTimestamp(input.expectedUpdatedAt)) throw new Error('日程 expectedUpdatedAt 非法')
    const event = updateCalendarEvent(input)
    if (event) broadcastPlanningChanged(['calendar_events', 'reminders'])
    return event
  })
  ipcMain.handle(PLANNING_IPC_CHANNELS.DELETE_CALENDAR_EVENT, async (_, id: string): Promise<boolean> => {
    if (!id || typeof id !== 'string') throw new Error('日程 id 必填')
    const deleted = deleteCalendarEvent(id)
    if (deleted) broadcastPlanningChanged(['calendar_events', 'reminders'])
    return deleted
  })

  const isPlanningShortName = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 100
  const isPlanningGroupScope = (value: unknown): value is PlanningGroupScope => value === 'todo' || value === 'calendar'
  const isOptionalColor = (value: unknown): boolean => value === undefined || value === null || typeof value === 'string'

  ipcMain.handle(PLANNING_IPC_CHANNELS.LIST_GROUPS, async (_, scope: PlanningGroupScope): Promise<PlanningGroup[]> => {
    if (!isPlanningGroupScope(scope)) throw new Error('分组范围非法')
    return listPlanningGroups(scope)
  })
  ipcMain.handle(PLANNING_IPC_CHANNELS.CREATE_GROUP, async (_, input: CreatePlanningGroupInput): Promise<PlanningGroup> => {
    if (!input || !isPlanningGroupScope(input.scope) || !isPlanningShortName(input.name) || !isOptionalColor(input.color)) throw new Error('分组参数非法')
    const group = createPlanningGroup(input); broadcastPlanningChanged(input.scope === 'todo' ? ['todo_groups', 'todos', 'reminders'] : ['calendar_groups', 'calendar_events', 'reminders']); return group
  })
  ipcMain.handle(PLANNING_IPC_CHANNELS.UPDATE_GROUP, async (_, input: UpdatePlanningGroupInput): Promise<PlanningGroup | undefined> => {
    if (!input || !isPlanningGroupScope(input.scope) || typeof input.id !== 'string' || (input.name !== undefined && !isPlanningShortName(input.name)) || !isOptionalColor(input.color)) throw new Error('分组参数非法')
    const group = updatePlanningGroup(input); if (group) broadcastPlanningChanged(input.scope === 'todo' ? ['todo_groups', 'todos', 'reminders'] : ['calendar_groups', 'calendar_events', 'reminders']); return group
  })
  ipcMain.handle(PLANNING_IPC_CHANNELS.DELETE_GROUP, async (_, scope: PlanningGroupScope, id: string): Promise<boolean> => {
    if (!isPlanningGroupScope(scope) || !id || typeof id !== 'string') throw new Error('分组参数非法')
    const deleted = deletePlanningGroup(scope, id); if (deleted) broadcastPlanningChanged(scope === 'todo' ? ['todo_groups', 'todos', 'reminders'] : ['calendar_groups', 'calendar_events', 'reminders']); return deleted
  })

  ipcMain.handle(PLANNING_IPC_CHANNELS.LIST_TAGS, async (): Promise<PlanningTag[]> => listPlanningTags())

  ipcMain.handle(PLANNING_IPC_CHANNELS.LIST_ACTIVE_REMINDERS, async (): Promise<ActivePlanningReminder[]> => listActivePlanningReminders())
  ipcMain.handle(PLANNING_IPC_CHANNELS.ACKNOWLEDGE_REMINDER, async (_, id: string): Promise<PlanningReminder | undefined> => {
    if (!id || typeof id !== 'string') throw new Error('提醒 id 必填')
    const reminder = acknowledgePlanningReminder(id); if (reminder) broadcastPlanningChanged(['todos', 'calendar_events', 'reminders']); return reminder
  })
  ipcMain.handle(PLANNING_IPC_CHANNELS.SNOOZE_REMINDER, async (_, input: SnoozePlanningReminderInput): Promise<PlanningReminder | undefined> => {
    if (!input || typeof input.id !== 'string' || !Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > 10080) throw new Error('推迟分钟数非法')
    const reminder = snoozePlanningReminder(input.id, input.minutes); if (reminder) broadcastPlanningChanged(['todos', 'calendar_events', 'reminders']); return reminder
  })

  // ===== macOS Calendar / Reminders 同步（授权、受管目标与单向发布） =====
  const isPlanningNativeSyncEntity = (value: unknown): value is PlanningNativeSyncEntity => value === 'calendar' || value === 'reminder'
  ipcMain.handle(PLANNING_IPC_CHANNELS.GET_NATIVE_SYNC_STATUS, async (): Promise<PlanningNativeSyncStatus> => getPlanningNativeSyncStatus())
  ipcMain.handle(PLANNING_IPC_CHANNELS.REQUEST_NATIVE_SYNC_ACCESS, async (_, entity: unknown): Promise<PlanningNativeSyncPermissionResult> => {
    if (!isPlanningNativeSyncEntity(entity)) throw new Error('同步实体类型非法')
    return requestPlanningNativeSyncAccess(entity)
  })
  ipcMain.handle(PLANNING_IPC_CHANNELS.OPEN_NATIVE_SYNC_PRIVACY_SETTINGS, async (_, entity: unknown): Promise<void> => {
    if (!isPlanningNativeSyncEntity(entity)) throw new Error('同步实体类型非法')
    if (process.platform !== 'darwin') return
    await shell.openExternal(entity === 'calendar'
      ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars'
      : 'x-apple.systempreferences:com.apple.preference.security?Privacy_Reminders')
  })
  ipcMain.handle(PLANNING_IPC_CHANNELS.LIST_NATIVE_SYNC_TARGETS, async (_, entity: unknown): Promise<PlanningNativeSyncTarget[]> => {
    if (!isPlanningNativeSyncEntity(entity)) throw new Error('同步实体类型非法')
    return listPlanningNativeSyncTargets(entity)
  })
  ipcMain.handle(PLANNING_IPC_CHANNELS.LIST_NATIVE_CONNECTION_TARGETS, async (_, entity: unknown): Promise<PlanningNativeSyncTarget[]> => {
    if (!isPlanningNativeSyncEntity(entity)) throw new Error('同步实体类型非法')
    return listPlanningNativeConnectionTargets(entity)
  })
  ipcMain.handle(PLANNING_IPC_CHANNELS.LIST_NATIVE_CONNECTIONS, async (_, entity?: unknown): Promise<PlanningNativeConnection[]> => {
    if (entity !== undefined && !isPlanningNativeSyncEntity(entity)) throw new Error('同步实体类型非法')
    return listPlanningNativeConnections(entity)
  })
  ipcMain.handle(PLANNING_IPC_CHANNELS.CONNECT_NATIVE_CONNECTION, async (_, input: ConnectPlanningNativeConnectionInput): Promise<PlanningNativeConnection> => {
    if (!input || !isPlanningNativeSyncEntity(input.entity) || !input.target || typeof input.target.id !== 'string') throw new Error('连接参数非法')
    // renderer 不可信：用 EventKit 当前返回的完整目标覆盖传入元数据。
    const target = (await listPlanningNativeConnectionTargets(input.entity)).find((item) => item.id === input.target.id)
    if (!target) throw new Error('系统集合不存在或尚未授权')
    const connection = connectPlanningNativeConnection({ entity: input.entity, target })
    // 用户刚确认连接时必须立刻回流，不能被全局定期同步 cooldown 延后。
    void runPlanningNativeSync(true)
    return connection
  })
  ipcMain.handle(PLANNING_IPC_CHANNELS.DISCONNECT_NATIVE_CONNECTION, async (_, id: unknown): Promise<boolean> => {
    if (typeof id !== 'string' || !id) throw new Error('连接 id 非法')
    const disconnected = disconnectPlanningNativeConnection(id)
    if (disconnected) broadcastPlanningChanged(['todos', 'calendar_events'])
    return disconnected
  })
  ipcMain.handle(PLANNING_IPC_CHANNELS.LIST_NATIVE_SYNC_CONFLICTS, async (): Promise<PlanningNativeSyncConflict[]> => listPlanningNativeSyncConflicts())
  ipcMain.handle(PLANNING_IPC_CHANNELS.RESOLVE_NATIVE_SYNC_CONFLICT, async (_, input: ResolvePlanningNativeSyncConflictInput): Promise<boolean> => {
    if (!input || typeof input.id !== 'string' || !['keep_proma', 'keep_system'].includes(input.resolution)) throw new Error('冲突解决参数非法')
    const resolved = resolvePlanningNativeSyncConflict(input)
    if (resolved) { broadcastPlanningChanged(['todos', 'calendar_events']); void runPlanningNativeSync(true) }
    return resolved
  })
  ipcMain.handle(PLANNING_IPC_CHANNELS.LIST_SYNC_PROFILES, async (): Promise<PlanningSyncProfile[]> => listPlanningSyncProfiles())
  ipcMain.handle(PLANNING_IPC_CHANNELS.SAVE_SYNC_PROFILE, async (_, input: SavePlanningSyncProfileInput): Promise<PlanningSyncProfile> => {
    if (!input || !isPlanningNativeSyncEntity(input.entity) || !input.target || typeof input.target.id !== 'string' || typeof input.target.title !== 'string' || typeof input.target.sourceTitle !== 'string' || (input.enabled !== undefined && typeof input.enabled !== 'boolean')) throw new Error('同步目标参数非法')
    // renderer 不可信：必须由主进程重新确认目标仍存在且可写，不能接受伪造的 Calendar/List 标识。
    const target = (await listPlanningNativeSyncTargets(input.entity)).find((item) => item.id === input.target.id)
    if (!target) throw new Error('同步目标不存在、不可写或尚未授权')
    const profile = savePlanningSyncProfile({ ...input, target })
    // 受管 Calendar 的系统存量也必须立即回流；不能被 30 秒 reconcile 冷却窗口延后。
    void runPlanningNativeSync(true)
    return profile
  })

  // ===== 定时任务（Automation）=====

  // 渲染进程可能被注入内容污染（XSS via markdown / MCP tool output），主进程必须自己校验入参，
  // 否则 NaN / -Infinity / 越界值会污染 ~/.myyoda/automations.json，无法回滚。
  const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0
  const isNonBlankString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
  const isFiniteInt = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v)
  const validScheduleType = (v: unknown): v is 'interval' | 'daily' | 'weekly' | 'monthly' | 'once' =>
    v === 'interval' || v === 'daily' || v === 'weekly' || v === 'monthly' || v === 'once'
  const validPermissionMode = (v: unknown): v is 'bypassPermissions' =>
    v === 'bypassPermissions'
  const validAutomationNotificationTrigger = (v: unknown): v is 'always' | 'success' | 'error' =>
    v === 'always' || v === 'success' || v === 'error'
  const validTimeOfDay = (v: unknown): boolean => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)

  const validateAutomationNotificationTargets = (targets: unknown): void => {
    if (targets === undefined) return
    if (!Array.isArray(targets)) throw new Error('notificationTargets 必须是数组')
    if (targets.length > 5) throw new Error('notificationTargets 最多 5 个')

    for (const target of targets) {
      if (!target || typeof target !== 'object') throw new Error('notificationTargets 包含非法目标')
      const t = target as Record<string, unknown>
      if (t.type !== 'feishu') throw new Error(`不支持的通知目标: ${String(t.type)}`)
      if (typeof t.enabled !== 'boolean') throw new Error('notificationTargets.enabled 必须是 boolean')
      if (!validAutomationNotificationTrigger(t.trigger)) {
        throw new Error(`非法的 notificationTargets.trigger: ${String(t.trigger)}`)
      }
      if (!isNonEmptyString(t.botId)) throw new Error('notificationTargets.botId 必填')
      if (!isNonEmptyString(t.chatId)) throw new Error('notificationTargets.chatId 必填')
    }
  }

  const validateAutomationFields = (i: Partial<CreateAutomationInput | UpdateAutomationInput>): void => {
    if (i.scheduleType !== undefined && !validScheduleType(i.scheduleType)) {
      throw new Error(`非法的 scheduleType: ${String(i.scheduleType)}`)
    }
    if (i.intervalMinutes !== undefined && (!isFiniteInt(i.intervalMinutes) || i.intervalMinutes < 1)) {
      throw new Error(`非法的 intervalMinutes: ${String(i.intervalMinutes)}`)
    }
    if (i.timeOfDay !== undefined && !validTimeOfDay(i.timeOfDay)) {
      throw new Error(`非法的 timeOfDay: ${String(i.timeOfDay)}`)
    }
    if (i.dayOfWeek !== undefined && (!isFiniteInt(i.dayOfWeek) || i.dayOfWeek < 0 || i.dayOfWeek > 6)) {
      throw new Error(`非法的 dayOfWeek: ${String(i.dayOfWeek)}`)
    }
    if (i.dayOfMonth !== undefined && (!isFiniteInt(i.dayOfMonth) || i.dayOfMonth < 1 || i.dayOfMonth > 31)) {
      throw new Error(`非法的 dayOfMonth: ${String(i.dayOfMonth)}`)
    }
    if (i.scheduledAt !== undefined && (typeof i.scheduledAt !== 'number' || !Number.isFinite(i.scheduledAt) || i.scheduledAt <= 0)) {
      throw new Error(`非法的 scheduledAt: ${String(i.scheduledAt)}`)
    }
    if (i.maxRuns !== undefined && (!isFiniteInt(i.maxRuns) || i.maxRuns < 1)) {
      throw new Error(`非法的 maxRuns: ${String(i.maxRuns)}`)
    }
    if (i.agentRuntime !== undefined && !isAgentRuntime(i.agentRuntime)) {
      throw new Error(`非法的 agentRuntime: ${String(i.agentRuntime)}`)
    }
    if (i.permissionMode !== undefined && !validPermissionMode(i.permissionMode)) {
      throw new Error(`非法的 permissionMode: ${String(i.permissionMode)}`)
    }
    if (i.sessionMode !== undefined && i.sessionMode !== 'daily' && i.sessionMode !== 'reuse') {
      throw new Error(`非法的 sessionMode: ${String(i.sessionMode)}`)
    }
    validateAutomationNotificationTargets(i.notificationTargets)
  }

  const validateAutomationRuntimePolicy = (
    input: Partial<CreateAutomationInput | UpdateAutomationInput>,
    existing?: Automation,
  ): void => {
    // 更新历史任务时，缺失的持久化 runtime 仍按 Claude 解释；仅新建任务使用 Pi 默认值。
    const finalRuntime: AgentRuntime = input.agentRuntime ?? existing?.agentRuntime ?? (existing ? 'claude' : 'pi')
    const finalChannelId = input.channelId !== undefined ? input.channelId : existing?.channelId
    if (finalRuntime === 'claude' && finalChannelId) {
      const agentChannelIds = getSettings().agentChannelIds ?? []
      if (!agentChannelIds.includes(finalChannelId)) {
        throw new Error('Claude Agent 内核只能使用已启用的 Agent 兼容渠道')
      }
    }
  }

  const validateAutomationScheduleComplete = (
    input: Partial<CreateAutomationInput | UpdateAutomationInput>,
    existing?: Automation,
  ): void => {
    const scheduleType = input.scheduleType ?? existing?.scheduleType
    if (scheduleType === 'interval') {
      const intervalMinutes = input.intervalMinutes ?? existing?.intervalMinutes
      if (!isFiniteInt(intervalMinutes) || intervalMinutes < 1) throw new Error('scheduleType=interval 时 intervalMinutes 必填')
    }
    if (scheduleType === 'daily' || scheduleType === 'weekly' || scheduleType === 'monthly') {
      const timeOfDay = input.timeOfDay ?? existing?.timeOfDay
      if (!validTimeOfDay(timeOfDay)) throw new Error('scheduleType=daily/weekly/monthly 时 timeOfDay 必填')
    }
    if (scheduleType === 'weekly') {
      const dayOfWeek = input.dayOfWeek ?? existing?.dayOfWeek
      if (!isFiniteInt(dayOfWeek)) throw new Error('scheduleType=weekly 时 dayOfWeek 必填')
    }
    if (scheduleType === 'monthly') {
      const dayOfMonth = input.dayOfMonth ?? existing?.dayOfMonth
      if (!isFiniteInt(dayOfMonth)) throw new Error('scheduleType=monthly 时 dayOfMonth 必填')
    }
    if (scheduleType === 'once') {
      const scheduledAt = input.scheduledAt ?? existing?.scheduledAt
      if (typeof scheduledAt !== 'number' || !Number.isFinite(scheduledAt) || scheduledAt <= 0) {
        throw new Error('scheduleType=once 时 scheduledAt 必填')
      }
    }
  }

  ipcMain.handle(
    AUTOMATION_IPC_CHANNELS.LIST,
    async (_, scope?: PlanningWorkspaceScope, workspaceId?: string): Promise<Automation[]> =>
      listAutomations(scope === 'all' ? undefined : (workspaceId ?? getSettings().agentWorkspaceId ?? ''))
  )

  ipcMain.handle(
    AUTOMATION_IPC_CHANNELS.CREATE,
    async (_, input: CreateAutomationInput): Promise<Automation> => {
      if (!input || typeof input !== 'object') throw new Error('input 必须是对象')
      if (!isNonEmptyString(input.name)) throw new Error('name 必填')
      if (!isNonEmptyString(input.prompt)) throw new Error('prompt 必填')
      // channelId / workspaceId 允许为空（草稿态），但此时任务不能被启用
      validateAutomationFields(input)
      validateAutomationRuntimePolicy(input)
      validateAutomationScheduleComplete(input)
      const a = createAutomation(input)
      broadcastAutomationsChanged()
      return a
    }
  )

  ipcMain.handle(
    AUTOMATION_IPC_CHANNELS.UPDATE,
    async (_, input: UpdateAutomationInput): Promise<Automation | undefined> => {
      if (!input || typeof input !== 'object') throw new Error('input 必须是对象')
      if (!isNonEmptyString(input.id)) throw new Error('id 必填')
      if (input.name !== undefined && !isNonBlankString(input.name)) throw new Error('name 不能为空')
      if (input.prompt !== undefined && !isNonBlankString(input.prompt)) throw new Error('prompt 不能为空')
      const existing = getAutomation(input.id)
      if (!existing) return undefined
      validateAutomationFields(input)
      validateAutomationRuntimePolicy(input, existing)
      validateAutomationScheduleComplete(input, existing)
      const a = updateAutomation(input)
      broadcastAutomationsChanged()
      return a
    }
  )

  ipcMain.handle(
    AUTOMATION_IPC_CHANNELS.DELETE,
    async (_, id: string): Promise<boolean> => {
      if (!isNonEmptyString(id)) throw new Error('id 必填')
      const ok = deleteAutomation(id)
      broadcastAutomationsChanged()
      return ok
    }
  )

  ipcMain.handle(
    AUTOMATION_IPC_CHANNELS.TOGGLE,
    async (_, id: string, active: boolean): Promise<Automation | undefined> => {
      if (!isNonEmptyString(id)) throw new Error('id 必填')
      if (typeof active !== 'boolean') throw new Error('active 必须是 boolean')
      const a = updateAutomation({ id, active })
      broadcastAutomationsChanged()
      return a
    }
  )

  ipcMain.handle(
    AUTOMATION_IPC_CHANNELS.RUN_NOW,
    async (_, id: string): Promise<void> => {
      if (!isNonEmptyString(id)) throw new Error('id 必填')
      await runAutomationNow(id)
    }
  )

  // ===== Agent 专家包 =====

  ipcMain.handle(
    EXPERT_IPC_CHANNELS.LIST,
    async (): Promise<ExpertPackage[]> => listExperts(getExpertsDir()),
  )

  ipcMain.handle(
    EXPERT_IPC_CHANNELS.GET,
    async (_, id: string): Promise<ExpertPackage | null> => {
      if (!isNonEmptyString(id)) throw new Error('id 必填')
      return getExpert(getExpertsDir(), id)
    },
  )

  ipcMain.handle(
    EXPERT_IPC_CHANNELS.CREATE,
    async (
      _,
      input: { id: string; label: string; identitySummary?: string; description?: string; avatar?: { icon?: string; accent?: string }; defaultProviderChannelId?: string; defaultModel?: string; skillSlugs?: string[] },
    ): Promise<ExpertPackage> => {
      if (!input || typeof input !== 'object') throw new Error('input 必须是对象')
      if (!isNonEmptyString(input.id)) throw new Error('id 必填')
      if (!isNonEmptyString(input.label)) throw new Error('label 必填')
      return createExpert(getExpertsDir(), {
        id: input.id,
        label: input.label,
        identitySummary: typeof input.identitySummary === 'string' ? input.identitySummary : undefined,
        description: typeof input.description === 'string' && input.description.length > 0 ? input.description : undefined,
        avatar: input.avatar && typeof input.avatar === 'object' ? input.avatar : undefined,
        defaultProviderChannelId: typeof input.defaultProviderChannelId === 'string' && input.defaultProviderChannelId.length > 0 ? input.defaultProviderChannelId : undefined,
        defaultModel: typeof input.defaultModel === 'string' && input.defaultModel.length > 0 ? input.defaultModel : undefined,
        skillSlugs: Array.isArray(input.skillSlugs) ? input.skillSlugs : undefined,
      })
    },
  )

  ipcMain.handle(
    EXPERT_IPC_CHANNELS.UPDATE_MANIFEST,
    async (
      _,
      id: string,
      patch: Partial<Pick<ExpertManifest, 'skillSlugs' | 'mcpIds' | 'label'>>,
    ): Promise<ExpertPackage> => {
      if (!isNonEmptyString(id)) throw new Error('id 必填')
      if (!patch || typeof patch !== 'object') throw new Error('patch 必须是对象')
      return updateExpertManifest(getExpertsDir(), id, patch)
    },
  )

  ipcMain.handle(
    EXPERT_IPC_CHANNELS.UPDATE_FILES,
    async (
      _,
      id: string,
      files: Partial<{ identityMd: string; soulMd: string; rulesMd: string }>,
    ): Promise<ExpertPackage> => {
      if (!isNonEmptyString(id)) throw new Error('id 必填')
      if (!files || typeof files !== 'object') throw new Error('files 必须是对象')
      return updateExpertFiles(getExpertsDir(), id, files)
    },
  )

  // ===== Agent 专家团（team.json 新结构） =====

  ipcMain.handle(
    EXPERT_IPC_CHANNELS.TEAMS_LIST,
    async (): Promise<TeamSquad[]> => listTeams(getExpertsDir()),
  )

  ipcMain.handle(
    EXPERT_IPC_CHANNELS.TEAMS_GET,
    async (_, id: string): Promise<TeamSquad | null> => {
      if (!isNonEmptyString(id)) throw new Error('id 必填')
      return getTeam(getExpertsDir(), id)
    },
  )

  ipcMain.handle(
    EXPERT_IPC_CHANNELS.TEAMS_CREATE,
    async (_, input: CreateTeamInput): Promise<TeamSquad> => {
      if (!input || typeof input !== 'object') throw new Error('input 必须是对象')
      if (!isNonEmptyString(input.id)) throw new Error('id 必填')
      if (!isNonEmptyString(input.label)) throw new Error('label 必填')
      if (!isNonEmptyString(input.leaderExpertId)) throw new Error('leaderExpertId 必填')
      return createTeam(getExpertsDir(), input)
    },
  )

  ipcMain.handle(
    EXPERT_IPC_CHANNELS.TEAMS_UPDATE,
    async (_, id: string, patch: UpdateTeamInput): Promise<TeamSquad> => {
      if (!isNonEmptyString(id)) throw new Error('id 必填')
      if (!patch || typeof patch !== 'object') throw new Error('patch 必须是对象')
      return updateTeam(getExpertsDir(), id, patch)
    },
  )

  ipcMain.handle(
    EXPERT_IPC_CHANNELS.TEMPLATES_LIST,
    async (): Promise<ExpertTemplate[]> => {
      const templatesDir = getDefaultExpertTemplatesDir()
      if (!existsSync(templatesDir)) return []
      const templates: ExpertTemplate[] = []
      for (const entry of readdirSync(templatesDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue
        try {
          const parsed = JSON.parse(readFileSync(join(templatesDir, entry.name), 'utf-8'))
          if (typeof parsed?.slug !== 'string') continue
          templates.push({
            slug: parsed.slug,
            name: typeof parsed.name === 'string' ? parsed.name : parsed.slug,
            description: typeof parsed.description === 'string' ? parsed.description : '',
            category: typeof parsed.category === 'string' ? parsed.category : '',
            icon: typeof parsed.icon === 'string' ? parsed.icon : '',
            accent: typeof parsed.accent === 'string' ? parsed.accent : '',
            instructions: typeof parsed.instructions === 'string' ? parsed.instructions : '',
            skills: Array.isArray(parsed.skills) ? parsed.skills.filter((s: unknown): s is string => typeof s === 'string') : [],
          })
        } catch (error) {
          console.warn(`[专家] 跳过损坏的专家模板 ${entry.name}:`, error)
        }
      }
      return templates.sort((a, b) => a.slug.localeCompare(b.slug))
    },
  )

  // ===== Pull Request（本地 gh CLI） =====

  // 获取 gh CLI 状态（安装/登录）
  ipcMain.handle(
    PR_IPC_CHANNELS.GH_STATUS,
    async (): Promise<import('@myyoda/shared').GhCliStatus> => {
      return getGhCliStatus()
    }
  )

  // 获取 PR 状态行面板的一次性数据（gh + git + 当前分支 PR）
  ipcMain.handle(
    PR_IPC_CHANNELS.PANEL_STATE,
    async (_, repoPath: string): Promise<import('@myyoda/shared').PullRequestPanelState> => {
      if (!repoPath || typeof repoPath !== 'string') {
        return {
          gh: { installed: false, authenticated: false },
          git: { branch: null, isDefaultBranch: false, hasUpstream: false, aheadCount: 0, behindCount: 0, hasOriginRemote: false, hasChanges: false, repoPath: null },
          currentBranchPr: null,
        }
      }
      return getPullRequestPanelState(repoPath)
    }
  )

  // 获取当前分支关联的 open PR
  ipcMain.handle(
    PR_IPC_CHANNELS.GET_CURRENT_BRANCH_PR,
    async (_, repoPath: string): Promise<import('@myyoda/shared').CurrentBranchPullRequest | null> => {
      if (!repoPath || typeof repoPath !== 'string') return null
      return getCurrentBranchPullRequest(repoPath)
    }
  )

  // 获取仓库默认分支名（main/master）
  ipcMain.handle(
    PR_IPC_CHANNELS.GET_DEFAULT_BRANCH,
    async (_, repoPath: string): Promise<string> => {
      if (!repoPath || typeof repoPath !== 'string') return 'main'
      return getDefaultBranch(repoPath)
    }
  )

  // 列出 open PR
  ipcMain.handle(
    PR_IPC_CHANNELS.LIST,
    async (_, input: import('@myyoda/shared').PullRequestsListInput): Promise<import('@myyoda/shared').PullRequestsListResult> => {
      return listPullRequests(input ?? {})
    }
  )

  // 获取 PR 详情
  ipcMain.handle(
    PR_IPC_CHANNELS.DETAIL,
    async (_, input: import('@myyoda/shared').PullRequestDetailInput): Promise<import('@myyoda/shared').PullRequestDetail> => {
      if (!input?.repoPath || typeof input.repoPath !== 'string') throw new Error('repoPath 必填')
      return getPullRequestDetail(input)
    }
  )

  // 获取 PR diff
  ipcMain.handle(
    PR_IPC_CHANNELS.DIFF,
    async (_, input: import('@myyoda/shared').PullRequestDetailInput): Promise<import('@myyoda/shared').PullRequestDiffResult> => {
      if (!input?.repoPath || typeof input.repoPath !== 'string') throw new Error('repoPath 必填')
      return getPullRequestDiff(input)
    }
  )

  // 创建 PR（duplicate 防护 + push）
  ipcMain.handle(
    PR_IPC_CHANNELS.CREATE,
    async (_, input: import('@myyoda/shared').CreatePullRequestInput): Promise<import('@myyoda/shared').CreatePullRequestResult> => {
      if (!input?.repoPath || !input?.headBranch || !input?.baseBranch) {
        throw new Error('创建 PR 参数不完整：需要 repoPath / headBranch / baseBranch')
      }
      return createPullRequest(input)
    }
  )

  // PR 操作（merge/ready/draft/close/reopen）
  ipcMain.handle(
    PR_IPC_CHANNELS.ACTION,
    async (_, input: import('@myyoda/shared').PullRequestActionInput): Promise<import('@myyoda/shared').PullRequestActionResult> => {
      if (!input?.repoPath || !input?.number) throw new Error('PR 操作参数不完整')
      return pullRequestAction(input)
    }
  )

  // 发表评论
  ipcMain.handle(
    PR_IPC_CHANNELS.COMMENT,
    async (_, input: import('@myyoda/shared').PullRequestCommentInput): Promise<import('@myyoda/shared').PullRequestCommentResult> => {
      if (!input?.repoPath || !input?.number || !input?.body) throw new Error('评论参数不完整')
      return addPullRequestComment(input)
    }
  )

  // 检出 PR 到本地
  ipcMain.handle(
    PR_IPC_CHANNELS.CHECKOUT,
    async (_, input: { repoPath: string; number: number }): Promise<{ branch: string }> => {
      if (!input?.repoPath || !input?.number) throw new Error('检出参数不完整')
      return checkoutPullRequest(input.repoPath, input.number)
    }
  )

  // 查询分支是否被其他 worktree 占用（merge --delete-branch 安全）
  ipcMain.handle(
    PR_IPC_CHANNELS.BRANCH_WORKTREE_USAGE,
    async (_, input: { repoPath: string; branch: string }): Promise<import('@myyoda/shared').BranchWorktreeUsage> => {
      if (!input?.repoPath || !input?.branch) return { branch: input?.branch ?? '', worktrees: [], mainRepoOnBranch: false }
      return getBranchWorktreeUsage(input.repoPath, input.branch)
    }
  )

  // ===== 内嵌浏览器（synara 移植） =====
  registerBrowserIpcHandlers()
}
