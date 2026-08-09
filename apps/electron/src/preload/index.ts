/**
 * Preload 脚本
 *
 * 通过 contextBridge 安全地将 API 暴露给渲染进程
 * 使用上下文隔离确保安全性
 */

import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { PROJECT_IPC_CHANNELS, TASK_IPC_CHANNELS, SESSION_COMMAND_CHANNEL, SESSION_GROUP_IPC_CHANNELS, TEAMBITION_IPC_CHANNELS, EXPERT_IPC_CHANNELS } from '@myyoda/shared/channels'
import { IPC_CHANNELS, CHANNEL_IPC_CHANNELS, CHAT_IPC_CHANNELS, AGENT_IPC_CHANNELS, ENVIRONMENT_IPC_CHANNELS, INSTALLER_IPC_CHANNELS, PROXY_IPC_CHANNELS, GITHUB_RELEASE_IPC_CHANNELS, RELEASE_NOTES_IPC_CHANNELS, SYSTEM_PROMPT_IPC_CHANNELS, CHAT_TOOL_IPC_CHANNELS, FEISHU_IPC_CHANNELS, DINGTALK_IPC_CHANNELS, WECHAT_IPC_CHANNELS, AUTOMATION_IPC_CHANNELS, PLANNING_IPC_CHANNELS, CODECLAW_IPC_CHANNELS, BROWSER_IPC_CHANNELS, PR_IPC_CHANNELS, type ThreadBrowserState, type BrowserPanelBounds } from '@myyoda/shared'
import type { TaskAggregateSummary, TaskMetadataPatch, TaskWorkflow } from '@myyoda/shared/tasks'
import type { StartTodoAgentInput, StartTodoAgentResult, TodoAgentSessionActivation, PlanningWorkspaceScope } from '@myyoda/shared'
import { LABEL_IPC_CHANNELS } from '@myyoda/shared/channels'
import type { WorkspaceLabel } from '@myyoda/shared/labels'
import { USER_PROFILE_IPC_CHANNELS, SETTINGS_IPC_CHANNELS, SCRATCH_PAD_IPC_CHANNELS, EXCALIDRAW_IPC_CHANNELS, DOCK_BADGE_IPC_CHANNELS, STORAGE_IPC_CHANNELS, USAGE_IPC_CHANNELS } from '../types'
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
  ChannelPlanQuotaResult,
  CodexOAuthLoginResult,
  CodexOAuthDeviceCode,
  CodexOAuthLoginMethod,
  ClaudeOAuthLoginResult,
  ClaudeOAuthPrepareResult,
  XaiOAuthLoginResult,
  XaiOAuthDeviceCode,
  ConversationMeta,
  ChatMessage,
  ChatSendInput,
  GenerateTitleInput,
  StreamChunkEvent,
  StreamReasoningEvent,
  StreamCompleteEvent,
  StreamErrorEvent,
  StreamToolActivityEvent,
  AttachmentSaveInput,
  AttachmentSaveResult,
  FileDialogResult,
  FileOrFolderDialogResult,
  RecentMessagesResult,
  MessageSearchResult,
  AgentSessionMeta,
  SDKMessage,
  AgentSendInput,
  AgentRuntime,
  AgentThinkingLevel,
  AgentStreamEvent,
  AgentStreamCompletePayload,
  AgentSessionFileRoots,
  AgentOutputRecord,
  AgentWorkspace,
  SessionGroup,
  AgentGenerateTitleInput,
  AgentSaveFilesInput,
  AgentSaveWorkspaceFilesInput,
  AgentSavedFile,
  AgentAttachDirectoryInput,
  AgentAttachFileInput,
  WorkspaceAttachDirectoryInput,
  SpawnExpertCoworkInput,
  SpawnExpertCoworkResult,
  WorkspaceAttachFileInput,
  GetTaskOutputInput,
  GetTaskOutputResult,
  StopTaskInput,
  WorkspaceMcpConfig,
  SkillMeta,
  OtherWorkspaceSkillsGroup,
  OrganizationConnection,
  OrganizationInfo,
  OrganizationMembership,
  OrganizationMember,
  OrganizationSkill,
  OrganizationSkillDetail,
  OrganizationSkillSyncResult,
  CommunitySkill,
  CommunitySkillInstallResult,
  GhCliStatus,
  SkillSubmissionInput,
  SkillSubmissionResult,
  WorkspaceCapabilities,
  WorkspaceMemorySummary,
  FileEntry,
  FileSearchResult,
  EnvironmentCheckResult,
  InstallerManifest,
  InstallerDownloadRequest,
  InstallerDownloadResult,
  InstallerProgressPayload,
  ProxyConfig,
  SystemProxyDetectResult,
  GitHubRelease,
  GitHubReleaseListOptions,
  ReleaseNote,
  PermissionRequest,
  PermissionResponse,
  ProjectDeleteImpact,
  TaskDeleteImpact,
  MyYodaPermissionMode,
  AskUserRequest,
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
  AgentMessageSearchResult,
  AgentSessionReferenceSearchInput,
  AgentSessionReferenceSearchResult,
  DetachedPreviewWindowData,
  DetachedPreviewWindowInput,
  FeishuConfig,
  FeishuConfigInput,
  FeishuBridgeState,
  FeishuTestResult,
  FeishuChatBinding,
  FeishuPresenceReport,
  FeishuUpdateBindingInput,
  DingTalkConfig,
  DingTalkConfigInput,
  DingTalkBridgeState,
  DingTalkTestResult,
  WeChatConfig,
  WeChatBridgeState,
  AgentQueueMessageInput,
  PendingRequestsSnapshot,
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
  PlanningAgentOperation,
  PlanningChange,
  CreateTodoInput,
  UpdateTodoInput,
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
  CreateProjectInput,
  LoadedProject,
  ProjectAsset,
  UpdateProjectInput,
  UploadProjectAssetInput,
  SessionKanbanCommand,
  TaskSpec,
  RunLogEntry,
  ProjectsChangedEventPayload,
  TaskGeneratedEventPayload,
  CodeClawState,
  CodeClawThemeId,
  CodeClawInteraction,
  CodeClawMiniRequest,
  CodeClawPeekRequest,
  CodeClawSize,
} from '@myyoda/shared'
import type { ProjectConfig } from '@myyoda/shared/projects'
import type { ExpertManifest, ExpertPackage, ExpertTemplate, TeamSquad } from '@myyoda/shared/experts'
import type { CreateTeamInput, UpdateTeamInput } from '../main/lib/expert-service'
import type { ValidationResult } from '../../../../packages/shared/src/tasks/validate.ts'
import type {
  UserProfile,
  AppSettings,
  QuickTaskSubmitInput,
  QuickTaskOpenSessionData,
  VoiceDictationAudioChunkInput,
  VoiceDictationCommitInput,
  VoiceDictationCommitResult,
  VoiceDictationPreviewInput,
  VoiceDictationResizeInput,
  VoiceDictationSettings,
  VoiceDictationSettingsUpdate,
  VoiceDictationShownEvent,
  VoiceDictationStartInput,
  VoiceDictationIndicatorEvent,
  VoiceDictationStateEvent,
  VoiceDictationStopInput,
  VoiceDictationTestResult,
  VoiceDictationToggleInput,
  VoiceDictationTranscriptEvent,
  VoiceDictationTextDeliveryInput,
  VoiceDictationTextEvent,
  MicPermissionResult,
  TrayCreateSessionData,
  TrayOpenAgentSessionData,
} from '../types'

/** 快速任务窗口事件 */
export type QuickTaskWindowEvent =
  | { type: 'submit'; input: QuickTaskSubmitInput }
  | { type: 'hide' }
  | { type: 'open-session'; data: QuickTaskOpenSessionData }

interface TaskCreateRequest {
  yaml: string
  orchestratorSessionId?: string
  attachToExistingSessionId?: string
}

interface TaskGenerateRequest {
  goal: string
  title?: string
  projectId?: string
  cwd?: string
  model?: string
  llmConnection?: string
  permissionMode?: string
}

interface TaskRunOptions {
  runId?: string
  orchestratorSessionId?: string
  params?: Record<string, unknown>
  verifyOnComplete?: boolean
}

interface TaskResults {
  spec: TaskSpec | null
  log: RunLogEntry[]
  runId: string
}

/** 渲染进程项目 DTO：透传 ProjectConfig（含 workingDirectory）；不泄露 LoadedProject 运行时路径（folderPath 等）。 */
export type BrowserProject = ProjectConfig & { workspaceId: string }
export type BrowserProjectCreateInput = CreateProjectInput
export type BrowserProjectUpdateInput = UpdateProjectInput
export type BrowserProjectAsset = Omit<ProjectAsset, 'absolutePath'>
export interface BrowserProjectAssetUploadInput {
  filename: string
  base64?: string
  text?: string
}

export interface BrowserProjectChangedEvent {
  kind: 'projects:changed'
  workspaceId: string
  projects: BrowserProject[]
}

export type BrowserEffectiveCwdStatus = 'managed' | 'external' | 'unavailable'

export interface BrowserEffectiveCwdResult {
  status: BrowserEffectiveCwdStatus
  cwd?: string
  displayPath?: string
}

export interface BrowserOpenOrCreateProjectResult {
  project: BrowserProject
  created: boolean
}

export interface TaskValidationResult extends ValidationResult {
  spec?: TaskSpec
}

export interface TaskCreateResult {
  taskId: string
  slug: string
  orchestratorSessionId: string
  valid: true
}

/** TaskRunner 的跨进程运行快照。 */
export interface BrowserTaskRunSnapshot {
  slug: string
  runId: string
  taskId: string
  status: 'running' | 'paused' | 'verifying' | 'stopped' | 'completed' | 'failed'
  orchestratorSessionId?: string
  tokensUsed: number
  nodes: Array<{
    id: string
    state: 'pending' | 'running' | 'done' | 'failed' | 'cancelled' | 'skipped'
    sessionId?: string
    attempt: number
  }>
}

export type BrowserTeambitionSyncState = 'synced' | 'pending' | 'conflict' | 'stale' | 'needs-reauth'
export interface BrowserTeambitionCapabilities {
  listTasks: boolean
  claimTask: boolean
  updateStatus: boolean
  syncProgress: boolean
  needsReauth: boolean
}
export interface BrowserTeambitionTask {
  id: string
  title: string
  projectId: string
  status?: string
  updatedAt?: number
  syncState?: 'synced' | 'stale'
}
export interface BrowserTeambitionBinding {
  id: string
  sessionId: string
  remoteTaskId: string
  projectId: string
  remoteTitle: string
  remoteStatus?: string
  syncState: BrowserTeambitionSyncState
  updatedAt: number
  error?: string
}
export interface BrowserTeambitionTaskList {
  tasks: BrowserTeambitionTask[]
  needsReauth: boolean
}
export interface BrowserTeambitionClaimInput {
  projectId: string
  remoteTaskId: string
  sessionId: string
  idempotencyKey: string
}

function invokeTyped<TResult>(channel: string, ...args: unknown[]): Promise<TResult> {
  return ipcRenderer.invoke(channel, ...args) as Promise<TResult>
}

function toBrowserProject(project: LoadedProject): BrowserProject {
  return { ...project.config, workspaceId: project.workspaceId }
}

function toBrowserProjectAsset(asset: ProjectAsset): BrowserProjectAsset {
  const { absolutePath: _absolutePath, ...browserAsset } = asset
  return browserAsset
}
import { QUICK_TASK_IPC_CHANNELS, TRAY_IPC_CHANNELS, VOICE_DICTATION_IPC_CHANNELS } from '../types'

/**
 * 暴露给渲染进程的 API 接口定义
 */
export interface ElectronAPI {
  // ===== 运行时相关 =====

  /**
   * 获取运行时状态
   * @returns 运行时状态，包含 Bun、Git 等信息
   */
  getRuntimeStatus: () => Promise<RuntimeStatus | null>

  /**
   * 重新初始化运行时状态（重新跑 Node / Bun / Git / Shell 检测）
   * 用户安装完 Git / Node 后触发，强制刷新缓存
   */
  reinitRuntime: () => Promise<RuntimeStatus>

  /**
   * 获取指定目录的 Git 仓库状态
   * @param dirPath - 目录路径
   * @returns Git 仓库状态
   */
  getGitRepoStatus: (dirPath: string) => Promise<GitRepoStatus | null>

  /** 获取未暂存的变更文件列表 */
  getUnstagedChanges: (dirPath: string, sessionPath?: string, workspaceFilesPath?: string, extraPaths?: string[], sessionId?: string) => Promise<import('@myyoda/shared').UnstagedChangesResult>
  /** 获取单个文件的 diff */
  getFileDiff: (input: import('@myyoda/shared').GetFileDiffInput) => Promise<string>
  /** 获取未追踪文件内容 */
  getUntrackedContent: (input: import('@myyoda/shared').GetFileDiffInput) => Promise<string>
  /** 还原文件变更 */
  revertFile: (input: import('@myyoda/shared').RevertFileInput) => Promise<void>
  /** 获取文件新旧版本内容 */
  getDiffContents: (input: import('@myyoda/shared').GetFileDiffInput) => Promise<{ oldContent: string; newContent: string } | null>
  /** 列出 Git Worktree */
  listWorktrees: (repoPath: string, sessionId: string) => Promise<import('@myyoda/shared').WorktreeInfo[]>
  /** 列出新 Agent 会话可选择的 Git 分支 */
  listGitBranches: (input: ListGitBranchesInput) => Promise<GitBranchInfo[]>
  /** 准备新 Agent 会话 Git 上下文（Local checkout 或 Worktree 创建） */
  prepareSessionGitContext: (input: PrepareSessionGitContextInput) => Promise<PrepareSessionGitContextResult | null>
  /** 获取 Worktree 相对于基准分支的全量变更 */
  getWorktreeChanges: (worktreePath: string, baseBranch: string, sessionId: string) => Promise<import('@myyoda/shared').UnstagedChangesResult>
  /** 在独立窗口打开当前文件预览 */
  openDetachedPreview: (input: DetachedPreviewWindowInput) => Promise<string | null>
  /** 获取独立预览窗口数据 */
  getDetachedPreviewData: (previewId: string) => Promise<DetachedPreviewWindowData | null>

  // ===== Pull Request（本地 gh CLI） =====

  /** 获取 gh CLI 安装/登录状态 */
  getGhCliStatus: () => Promise<import('@myyoda/shared').GhCliStatus>
  /** 获取 PR 状态行面板一次性数据（gh + git + 当前分支 PR） */
  getPullRequestPanelState: (repoPath: string) => Promise<import('@myyoda/shared').PullRequestPanelState>
  /** 获取当前分支关联的 open PR（无则返回 null） */
  getCurrentBranchPullRequest: (repoPath: string) => Promise<import('@myyoda/shared').CurrentBranchPullRequest | null>
  /** 列出 open PR */
  listPullRequests: (input: import('@myyoda/shared').PullRequestsListInput) => Promise<import('@myyoda/shared').PullRequestsListResult>
  /** 获取 PR 详情 */
  getPullRequestDetail: (input: import('@myyoda/shared').PullRequestDetailInput) => Promise<import('@myyoda/shared').PullRequestDetail>
  /** 获取 PR diff */
  getPullRequestDiff: (input: import('@myyoda/shared').PullRequestDetailInput) => Promise<import('@myyoda/shared').PullRequestDiffResult>
  /** 创建 PR（duplicate 防护 + push） */
  createPullRequest: (input: import('@myyoda/shared').CreatePullRequestInput) => Promise<import('@myyoda/shared').CreatePullRequestResult>
  /** 获取仓库默认分支名（main/master） */
  getDefaultBranch: (repoPath: string) => Promise<string>
  /** PR 操作（merge/ready/draft/close/reopen） */
  pullRequestAction: (input: import('@myyoda/shared').PullRequestActionInput) => Promise<import('@myyoda/shared').PullRequestActionResult>
  /** 发表评论 */
  addPullRequestComment: (input: import('@myyoda/shared').PullRequestCommentInput) => Promise<import('@myyoda/shared').PullRequestCommentResult>
  /** 检出 PR 到本地 */
  checkoutPullRequest: (repoPath: string, number: number) => Promise<{ branch: string }>
  /** 查询分支是否被其他 worktree 占用（merge --delete-branch 安全） */
  getBranchWorktreeUsage: (repoPath: string, branch: string) => Promise<import('@myyoda/shared').BranchWorktreeUsage>

  // ===== 通用工具 =====

  /** 在系统默认浏览器中打开外部链接 */
  openExternal: (url: string) => Promise<void>
  /** 在系统剪贴板中写入纯文本 */
  writeClipboardText: (text: string) => Promise<void>

  // ===== 窗口控制（Windows 自定义标题栏）=====

  /** 最小化窗口 */
  windowMinimize: () => Promise<void>
  /** 最大化/还原窗口 */
  windowMaximize: () => Promise<void>
  /** 关闭窗口 */
  windowClose: () => Promise<void>
  /** 窗口是否处于最大化状态 */
  windowIsMaximized: () => Promise<boolean>
  /** 窗口是否处于原生全屏状态 */
  windowIsFullScreen: () => Promise<boolean>
  /** 获取当前窗口页面缩放系数（webContents.getZoomFactor，100% 为 1） */
  getZoomFactor: () => Promise<number>
  /** 订阅页面缩放系数变化（Cmd+/Cmd-、菜单缩放、滚轮/触控板缩放） */
  onZoomFactorChange: (callback: (zoomFactor: number) => void) => () => void
  /** 订阅窗口尺寸变化事件 */
  onWindowResize: (callback: () => void) => () => void

  // ===== 渠道管理相关 =====

  /** 获取所有渠道列表（apiKey 保持加密态） */
  listChannels: () => Promise<Channel[]>

  /** 创建渠道（apiKey 为明文，主进程加密） */
  createChannel: (input: ChannelCreateInput) => Promise<Channel>

  /** 更新渠道 */
  updateChannel: (id: string, input: ChannelUpdateInput) => Promise<Channel>

  /** 删除渠道 */
  deleteChannel: (id: string) => Promise<void>

  /** 解密获取明文 API Key（仅在用户查看时调用） */
  decryptApiKey: (channelId: string) => Promise<string>

  /** 测试渠道连接 */
  testChannel: (channelId: string) => Promise<ChannelTestResult>

  /** 直接测试连接（无需已保存渠道，传入明文凭证） */
  testChannelDirect: (input: ChannelDirectTestInput) => Promise<ChannelTestResult>

  /** 从供应商拉取可用模型列表（直接传入凭证，无需已保存渠道） */
  fetchModels: (input: FetchModelsInput) => Promise<FetchModelsResult>

  /** 查询渠道订阅 Plan 额度 */
  getChannelPlanQuota: (channelId: string) => Promise<ChannelPlanQuotaResult>

  /** 发起 ChatGPT (Codex) OAuth 登录，返回序列化凭据（作为 apiKey 存储） */
  codexOAuthLogin: (method?: CodexOAuthLoginMethod) => Promise<CodexOAuthLoginResult>

  /** 取消进行中的 ChatGPT (Codex) OAuth 登录 */
  codexOAuthCancel: () => Promise<void>

  /** 订阅登录期间，接收 Codex device code 与授权链接。返回取消订阅函数。 */
  onCodexOAuthDeviceCode: (callback: (deviceCode: CodexOAuthDeviceCode) => void) => () => void

  /** 生成 Claude Pro/Max 订阅登录授权 URL 并打开浏览器 */
  claudeOAuthPrepare: () => Promise<ClaudeOAuthPrepareResult>

  /** 用用户粘贴的授权码换取凭据，返回序列化凭据（作为 apiKey 存储） */
  claudeOAuthExchange: (code: string) => Promise<ClaudeOAuthLoginResult>

  /** 取消进行中的 Claude 订阅 OAuth 登录 */
  claudeOAuthCancel: () => Promise<void>

  /** 发起 xAI（Grok/X 订阅）OAuth 登录 */
  xaiOAuthLogin: () => Promise<XaiOAuthLoginResult>

  /** 取消进行中的 xAI OAuth 登录 */
  xaiOAuthCancel: () => Promise<void>

  /** 订阅登录期间，接收 xAI device code 与授权链接。返回取消订阅函数。 */
  onXaiOAuthDeviceCode: (callback: (deviceCode: XaiOAuthDeviceCode) => void) => () => void

  // ===== 对话管理相关 =====

  /** 获取对话列表 */
  listConversations: () => Promise<ConversationMeta[]>

  /** 创建对话 */
  createConversation: (title?: string, modelId?: string, channelId?: string) => Promise<ConversationMeta>

  /** 获取对话消息 */
  getConversationMessages: (id: string) => Promise<ChatMessage[]>

  /** 获取对话最近 N 条消息（分页加载） */
  getRecentMessages: (id: string, limit: number) => Promise<RecentMessagesResult>

  /** 更新对话标题 */
  updateConversationTitle: (id: string, title: string) => Promise<ConversationMeta>

  /** 更新对话使用的模型/渠道 */
  updateConversationModel: (id: string, modelId: string, channelId: string) => Promise<ConversationMeta>

  /** 删除对话 */
  deleteConversation: (id: string) => Promise<void>

  /** 切换对话置顶状态 */
  togglePinConversation: (id: string) => Promise<ConversationMeta>

  /** 切换对话归档状态 */
  toggleArchiveConversation: (id: string) => Promise<ConversationMeta>

  /** 搜索对话消息内容 */
  searchConversationMessages: (query: string) => Promise<MessageSearchResult[]>

  // ===== 教程 =====

  /** 获取教程内容 */
  getTutorialContent: () => Promise<string | null>

  /** 创建欢迎对话（含教程附件） */
  createWelcomeConversation: () => Promise<ConversationMeta | null>

  // ===== 消息发送 =====

  /** 发送消息（触发 AI 流式响应） */
  sendMessage: (input: ChatSendInput) => Promise<void>

  /** 中止生成 */
  stopGeneration: (conversationId: string) => Promise<void>

  /** 删除指定消息 */
  deleteMessage: (conversationId: string, messageId: string) => Promise<ChatMessage[]>

  /** 从指定消息开始截断（包含该消息） */
  truncateMessagesFrom: (
    conversationId: string,
    messageId: string,
    preserveFirstMessageAttachments?: boolean,
  ) => Promise<ChatMessage[]>

  /** 更新上下文分隔线 */
  updateContextDividers: (conversationId: string, dividers: string[]) => Promise<ConversationMeta>

  /** 生成对话标题 */
  generateTitle: (input: GenerateTitleInput) => Promise<string | null>

  // ===== 附件管理相关 =====

  /** 保存附件到本地 */
  saveAttachment: (input: AttachmentSaveInput) => Promise<AttachmentSaveResult>

  /** 读取附件（返回 base64 字符串） */
  readAttachment: (localPath: string) => Promise<string>

  /** 另存图片到用户选择的位置（原生 Save As 对话框） */
  saveImageAs: (localPath: string, defaultFilename: string) => Promise<boolean>

  /** 保存应用内置资源文件到用户选择的位置（原生 Save As 对话框） */
  saveResourceFileAs: (resourceRelativePath: string, defaultFilename: string) => Promise<boolean>

  /** 删除附件 */
  deleteAttachment: (localPath: string) => Promise<void>

  /** 打开文件选择对话框 */
  openFileDialog: () => Promise<FileDialogResult>

  /** 提取附件文档的文本内容 */
  extractAttachmentText: (localPath: string) => Promise<string>

  // ===== 用户档案相关 =====

  /** 获取用户档案 */
  getUserProfile: () => Promise<UserProfile>

  /** 更新用户档案 */
  updateUserProfile: (updates: Partial<UserProfile>) => Promise<UserProfile>

  // ===== 应用设置相关 =====

  /** 获取应用设置 */
  getSettings: () => Promise<AppSettings>

  /** 更新应用设置 */
  updateSettings: (updates: Partial<AppSettings>) => Promise<AppSettings>

  /** 同步更新应用设置（用于 beforeunload 场景） */
  updateSettingsSync: (updates: Partial<AppSettings>) => boolean

  /** 获取系统主题（是否深色模式） */
  getSystemTheme: () => Promise<boolean>

  /** 订阅系统主题变化事件（返回清理函数） */
  onSystemThemeChanged: (callback: (isDark: boolean) => void) => () => void

  /** 订阅用户手动切换主题事件（跨窗口同步，返回清理函数） */
  onThemeSettingsChanged: (callback: (payload: { themeMode: string; themeStyle?: string; themePacks?: AppSettings['themePacks']; themeActiveVariant?: string; interfaceVariant?: string }) => void) => () => void

  // ===== Scratch Pad =====

  /** 从磁盘加载 scratch-pad.md */
  loadScratchPad: () => Promise<string>

  /** 异步保存内容到 scratch-pad.md */
  saveScratchPad: (content: string) => Promise<boolean>

  /** 同步保存内容到 scratch-pad.md（beforeunload 场景） */
  saveScratchPadSync: (content: string) => boolean

  /** 导出 ScratchPad 内容为 Markdown 文件到指定目录 */
  exportScratchPad: (markdown: string, dirPath: string, filename: string) => Promise<string>

  /** 打开原生保存对话框，返回用户选择的路径 */
  chooseExportPath: (defaultName: string) => Promise<string | null>

  /** 将图片 data URL 写入系统剪贴板 */
  copyImageToClipboard: (dataUrl: string) => Promise<{ success: boolean; message?: string }>

  // ===== Excalidraw 画布 =====

  /** 列出 Workspace 下所有画板文件（elements 为缩略图用的精简元素快照，不含内嵌图片） */
  listExcalidrawFiles: (workspaceSlug: string) => Promise<Array<{ slug: string; title: string; elementCount: number; background: string; mtime: number; error?: boolean; elements?: unknown[] }>>

  /** 读取单个画板文件的完整数据（title 为文件名派生的真实标题，未经 slug 归一化） */
  readExcalidrawFile: (workspaceSlug: string, slug: string) => Promise<{ elements: unknown[]; appState: Record<string, unknown>; files: Record<string, unknown>; title: string } | null>

  /** 新建空白画板文件 */
  createExcalidrawFile: (workspaceSlug: string, title: string) => Promise<{ slug: string; title: string }>

  /** 保存画板文件 */
  writeExcalidrawFile: (workspaceSlug: string, slug: string, payload: { elements?: unknown[]; appState?: Record<string, unknown>; files?: Record<string, unknown> }) => Promise<{ ok: boolean }>

  /** 导出画板到指定路径（打开保存对话框） */
  exportExcalidrawFile: (workspaceSlug: string, slug: string) => Promise<string>

  /** 删除画板文件 */
  deleteExcalidrawFile: (workspaceSlug: string, slug: string) => Promise<{ ok: boolean }>

  /** 重命名画板文件 */
  renameExcalidrawFile: (workspaceSlug: string, slug: string, newTitle: string) => Promise<{ ok: boolean; slug: string; title: string }>

  /**
   * 同步保存画板（beforeunload / 应用退出场景兜底）；slug 为 null 表示尚未落盘的新画布，
   * 会同步走 CREATE。返回 null 表示失败或参数无效，不抛异常（beforeunload 里不适合抛错）。
   */
  saveExcalidrawFileSync: (
    workspaceSlug: string,
    slug: string | null,
    title: string,
    payload: { elements?: unknown[]; appState?: Record<string, unknown>; files?: Record<string, unknown> },
  ) => { ok: boolean; slug: string; title: string } | null

  /** 设置 Dock/Launcher 角标数量（0 表示清除） */
  setDockBadgeCount: (count: number) => Promise<boolean>

  // ===== 环境检测相关 =====

  /** 执行环境检测 */
  checkEnvironment: () => Promise<EnvironmentCheckResult>

  // ===== 第三方安装包（Git / Node.js）相关 =====

  /** 获取安装包清单（远程，失败回退内置） */
  fetchInstallerManifest: () => Promise<InstallerManifest>

  /** 开始下载指定安装包，resolve 时文件已落地并通过 sha256 校验 */
  downloadInstaller: (req: InstallerDownloadRequest) => Promise<InstallerDownloadResult>

  /** 取消指定 key 的进行中下载 */
  cancelInstallerDownload: (key: string) => Promise<boolean>

  /** 拉起已下载的安装程序（等效双击） */
  launchInstaller: (filePath: string) => Promise<void>

  /** 订阅下载进度事件，返回取消订阅函数 */
  onInstallerProgress: (
    callback: (payload: InstallerProgressPayload) => void,
  ) => () => void

  // ===== 代理配置相关 =====

  /** 获取代理配置 */
  getProxySettings: () => Promise<ProxyConfig>

  /** 更新代理配置 */
  updateProxySettings: (config: ProxyConfig) => Promise<void>

  /** 检测系统代理 */
  detectSystemProxy: () => Promise<SystemProxyDetectResult>

  // ===== 流式事件订阅（返回清理函数） =====

  /** 订阅内容片段事件 */
  onStreamChunk: (callback: (event: StreamChunkEvent) => void) => () => void

  /** 订阅推理片段事件 */
  onStreamReasoning: (callback: (event: StreamReasoningEvent) => void) => () => void

  /** 订阅流式完成事件 */
  onStreamComplete: (callback: (event: StreamCompleteEvent) => void) => () => void

  /** 订阅流式错误事件 */
  onStreamError: (callback: (event: StreamErrorEvent) => void) => () => void

  /** 订阅流式工具活动事件 */
  onStreamToolActivity: (callback: (event: StreamToolActivityEvent) => void) => () => void

  // ===== Agent 会话管理相关 =====

  /** 获取 Agent 会话列表 */
  listAgentSessions: () => Promise<AgentSessionMeta[]>

  /** 创建 Agent 会话 */
  createAgentSession: (title?: string, channelId?: string, workspaceId?: string, modelId?: string) => Promise<AgentSessionMeta>

  /** 获取 Agent 会话 SDKMessage（Phase 4 新格式） */
  getAgentSessionSDKMessages: (id: string) => Promise<SDKMessage[]>

  /** 更新 Agent 会话标题 */
  updateAgentSessionTitle: (id: string, title: string) => Promise<AgentSessionMeta>

  /** 切换 Agent 会话 runtime */
  updateSessionAgentRuntime: (sessionId: string, runtime: AgentRuntime) => Promise<AgentSessionMeta>

  /** 切换当前会话的 ChatGPT Codex Fast Mode */
  updateSessionCodexFastMode: (sessionId: string, enabled: boolean) => Promise<AgentSessionMeta>

  /** 查询 Pi catalog 或专属 profile 支持的会话级推理档位 */
  getPiReasoningCapability: (channelId: string, modelId: string) => Promise<import('@myyoda/shared').ReasoningCapability | undefined>

  /** 更新当前会话的思考深度（Pi sticky） */
  updateSessionThinkingLevel: (sessionId: string, thinkingLevel: AgentThinkingLevel) => Promise<AgentSessionMeta>
  /** 更新统一 reasoning level */
  updateSessionReasoningLevel: (sessionId: string, thinkingLevel: AgentThinkingLevel) => Promise<AgentSessionMeta>
  /** @deprecated 使用 updateSessionThinkingLevel */
  updateSessionOpenAIThinkingLevel: (sessionId: string, thinkingLevel: AgentThinkingLevel) => Promise<AgentSessionMeta>

  /** 更新 Agent 会话模型选择 */
  updateAgentSessionModel: (id: string, channelId?: string, modelId?: string) => Promise<AgentSessionMeta>

  /** 删除 Agent 会话 */
  deleteAgentSession: (id: string) => Promise<void>

  /** 迁移 Chat 对话记录到 Agent 会话 */
  migrateChatToAgent: (conversationId: string, agentSessionId: string) => Promise<void>

  /** 切换 Agent 会话置顶状态 */
  togglePinAgentSession: (id: string) => Promise<AgentSessionMeta>

  /** 切换 Agent 会话星标状态 */
  toggleStarAgentSession: (id: string) => Promise<AgentSessionMeta>

  /** 清除 Agent 会话完成状态（兼容清除旧版 manualWorking） */
  clearAgentCompletionState: (id: string) => Promise<AgentSessionMeta>

  /** 切换 Agent 会话归档状态 */
  toggleArchiveAgentSession: (id: string) => Promise<AgentSessionMeta>

  /** 搜索 Agent 会话消息内容 */
  searchAgentSessionMessages: (query: string) => Promise<AgentMessageSearchResult[]>

  /** 搜索可引用的 Agent 会话；省略 workspaceId 时跨工作区搜索。 */
  searchAgentSessionReferences: (input: AgentSessionReferenceSearchInput) => Promise<AgentSessionReferenceSearchResult[]>

  /** 迁移 Agent 会话到另一个工作区 */
  moveAgentSessionToWorkspace: (input: MoveSessionToWorkspaceInput) => Promise<AgentSessionMeta>

  /** 分叉 Agent 会话 */
  forkAgentSession: (input: ForkSessionInput) => Promise<AgentSessionMeta>

  /** 快照回退（同一会话内回退到指定点，恢复文件 + 截断对话） */
  rewindSession: (input: RewindSessionInput) => Promise<RewindSessionResult>

  /** 生成 Agent 会话标题 */
  generateAgentTitle: (input: AgentGenerateTitleInput) => Promise<string | null>

  /** 发送 Agent 消息 */
  sendAgentMessage: (input: AgentSendInput) => Promise<void>

  /** 中止 Agent 执行 */
  stopAgent: (sessionId: string) => Promise<void>

  /** 会话级拉专家/专家团 cowork（创建注入专家人设的子会话） */
  spawnExpertCowork: (input: SpawnExpertCoworkInput) => Promise<SpawnExpertCoworkResult>

  // ===== Agent 队列消息 =====

  /** 流式追加发送 Agent 消息（Agent 运行中） */
  queueAgentMessage: (input: AgentQueueMessageInput) => Promise<string>

  // ===== Agent 后台任务管理 =====

  /** 获取任务输出 */
  getTaskOutput: (input: GetTaskOutputInput) => Promise<GetTaskOutputResult>

  /** 停止任务 */
  stopTask: (input: StopTaskInput) => Promise<void>

  // ===== Agent 工作区管理相关 =====

  /** 获取 Agent 工作区列表 */
  listAgentWorkspaces: () => Promise<AgentWorkspace[]>

  /** 创建 Agent 工作区 */
  createAgentWorkspace: (name: string) => Promise<AgentWorkspace>

  /** 更新 Agent 工作区 */
  updateAgentWorkspace: (id: string, updates: { name: string }) => Promise<AgentWorkspace>

  /** 删除 Agent 工作区 */
  deleteAgentWorkspace: (id: string) => Promise<void>

  /** 重排工作区顺序 */
  reorderAgentWorkspaces: (orderedIds: string[]) => Promise<AgentWorkspace[]>

  // ===== 工作区能力（MCP + Skill） =====

  /** 获取工作区能力摘要 */
  getWorkspaceCapabilities: (workspaceSlug: string) => Promise<WorkspaceCapabilities>

  /** 获取工作区 MCP 配置 */
  getWorkspaceMcpConfig: (workspaceSlug: string) => Promise<WorkspaceMcpConfig>

  /** 保存工作区 MCP 配置 */
  saveWorkspaceMcpConfig: (workspaceSlug: string, config: WorkspaceMcpConfig) => Promise<void>

  /** 测试 MCP 服务器连接 */
  testMcpServer: (name: string, entry: import('@myyoda/shared').McpServerEntry) => Promise<{ success: boolean; message: string }>

  /** 启用或关闭 MyYoda 内置 MCP */
  setBuiltinMcpEnabled: (workspaceSlug: string, id: string, enabled: boolean) => Promise<WorkspaceCapabilities>

  /** 获取工作区 Skill 列表（含活跃和不活跃） */
  getWorkspaceSkills: (workspaceSlug: string) => Promise<SkillMeta[]>

  /** 获取工作区 Skills 目录绝对路径 */
  getWorkspaceSkillsDir: (workspaceSlug: string) => Promise<string>

  /** 删除工作区 Skill */
  deleteWorkspaceSkill: (workspaceSlug: string, skillSlug: string) => Promise<void>

  /** 切换工作区 Skill 启用/禁用 */
  toggleWorkspaceSkill: (workspaceSlug: string, skillSlug: string, enabled: boolean) => Promise<void>

  /** 获取其他工作区的 Skill 列表 */
  getOtherWorkspaceSkills: (currentSlug: string) => Promise<OtherWorkspaceSkillsGroup[]>

  /** 获取默认 Skills 的 slug 列表（来自 ~/.myyoda/default-skills/） */
  getDefaultSkillSlugs: () => Promise<string[]>

  /** 从其他工作区导入 Skill */
  importSkillFromWorkspace: (targetSlug: string, sourceSlug: string, skillSlug: string) => Promise<SkillMeta>

  /** 从其他工作区批量导入多个 Skill */
  batchImportSkillsFromWorkspaces: (targetSlug: string, selections: import('@myyoda/shared').BulkImportWorkspaceSelection[]) => Promise<import('@myyoda/shared').BulkImportSkillsResult>

  /** 从源工作区同步更新已导入的 Skill */
  updateSkillFromSource: (targetSlug: string, skillSlug: string) => Promise<SkillMeta>

  // ── 企业版组织 Skills 分发 ───────────────────────────────

  /** 获取组织连接配置 */
  orgGetConnection: () => Promise<OrganizationConnection | null>
  /** 设置/清除组织连接配置 */
  orgSetConnection: (mode: 'logout' | 'set', conn?: OrganizationConnection) => Promise<OrganizationConnection | null>
  /** 登录/注册并保存连接 */
  orgAuthenticate: (action: 'login' | 'register' | 'apikey', serverUrl: string, email: string, password: string, displayName?: string, apiKey?: string) => Promise<OrganizationConnection>
  /** 我的组织与角色 */
  orgMe: () => Promise<OrganizationMembership[]>
  /** 创建组织 */
  orgCreate: (name: string) => Promise<OrganizationInfo>
  /** 凭邀请码加入组织 */
  orgJoin: (inviteCode: string) => Promise<{ org: OrganizationInfo; role: string }>
  /** 列出组织成员 */
  orgListMembers: (orgId: string) => Promise<OrganizationMember[]>
  /** 列出组织 Skills */
  orgListSkills: (orgId: string) => Promise<OrganizationSkill[]>
  /** 导入组织 Skill 到工作区 */
  orgImportSkill: (targetSlug: string, orgId: string, orgName: string, skill: OrganizationSkill) => Promise<SkillMeta>
  /** 从组织源更新已导入 Skill */
  orgUpdateSkill: (targetSlug: string, skillSlug: string) => Promise<SkillMeta>

  // ── 社区市场 ───────────────────────────────

  /** 拉取社区市场清单 */
  communityFetchManifest: () => Promise<CommunitySkill[]>
  /** 安装社区市场 Skill 到工作区 */
  communityInstallSkill: (workspaceSlug: string, skill: CommunitySkill) => Promise<CommunitySkillInstallResult>
  /** 检测本机 gh CLI 安装 / 登录状态 */
  communityCheckGhCli: () => Promise<GhCliStatus>
  /** 提交本地 Skill 到社区市场（gh CLI 自动建 PR） */
  communitySubmitSkill: (input: SkillSubmissionInput) => Promise<SkillSubmissionResult>

  /** 读取 SKILL.md 全文内容 */
  readSkillContent: (workspaceSlug: string, skillSlug: string) => Promise<string>

  /** 写入 SKILL.md 全文内容 */
  writeSkillContent: (workspaceSlug: string, skillSlug: string, content: string) => Promise<void>

  /** 列出 Skill 目录下的子文件树（不含 SKILL.md） */
  listSkillFiles: (workspaceSlug: string, skillSlug: string) => Promise<import('@myyoda/shared').SkillFileNode[]>

  /** 读取 Skill 目录下的子文件内容 */
  readSkillFile: (workspaceSlug: string, skillSlug: string, relativePath: string) => Promise<import('@myyoda/shared').SkillFileContent>

  /** 写入 Skill 目录下的子文件内容（文本） */
  writeSkillFile: (workspaceSlug: string, skillSlug: string, relativePath: string, content: string) => Promise<void>

  /** 在 Skill 目录下创建文件或目录 */
  createSkillEntry: (workspaceSlug: string, skillSlug: string, relativePath: string, type: 'file' | 'directory') => Promise<void>

  /** 删除 Skill 目录下的文件或目录 */
  deleteSkillEntry: (workspaceSlug: string, skillSlug: string, relativePath: string) => Promise<void>

  /** 重命名/移动 Skill 目录下的文件或目录 */
  renameSkillEntry: (workspaceSlug: string, skillSlug: string, fromRelative: string, toRelative: string) => Promise<void>

  /** 获取工作区记忆摘要 */
  getWorkspaceMemorySummary: (workspaceSlug: string) => Promise<WorkspaceMemorySummary>

  /** 读取工作区 CLAUDE.md */
  readWorkspaceAgentsMd: (workspaceSlug: string) => Promise<import('@myyoda/shared').SkillFileContent>

  /** 写入工作区 CLAUDE.md */
  writeWorkspaceAgentsMd: (workspaceSlug: string, content: string) => Promise<void>

  /** 列出工作区 auto memory 文件树 */
  listWorkspaceAutoMemoryFiles: (workspaceSlug: string) => Promise<import('@myyoda/shared').SkillFileNode[]>

  /** 读取工作区 auto memory 文件 */
  readWorkspaceAutoMemoryFile: (workspaceSlug: string, relativePath: string) => Promise<import('@myyoda/shared').SkillFileContent>

  /** 写入工作区 auto memory 文件 */
  writeWorkspaceAutoMemoryFile: (workspaceSlug: string, relativePath: string, content: string) => Promise<void>

  /** 打开或聚焦当前 workspace 的独立 Memory 编辑窗口，可选定位到某个记忆文件。 */
  openWorkspaceMemoryWindow: (workspaceSlug: string, relativePath?: string) => Promise<void>

  /** 独立 Memory 编辑窗口接收主进程转发的文件定位请求。 */
  onWorkspaceMemoryWindowOpenFile: (callback: (relativePath: string) => void) => () => void
  /** 主进程请求独立窗口确认未保存内容后的关闭。 */
  onWorkspaceMemoryWindowCloseRequested: (callback: () => void) => () => void
  /** 保存或明确丢弃后确认关闭当前独立记忆窗口。 */
  confirmWorkspaceMemoryWindowClose: (workspaceSlug: string) => Promise<void>
  /** 声明独立记忆窗口已可处理关闭请求。 */
  markWorkspaceMemoryWindowReady: (workspaceSlug: string) => Promise<void>

  /** 仅在当前 Memory 页面存活时订阅当前 workspace 的 memory/ 文件变化。 */
  subscribeWorkspaceMemoryChanges: (
    workspaceSlug: string,
    callback: (change: import('@myyoda/shared').WorkspaceMemoryFileChange) => void,
  ) => () => void

  /** 授权 Agent 主动维护工作区/项目 AGENTS.md 知识 */
  approveWorkspaceProjectKnowledgeMaintenance: (workspaceSlug: string) => Promise<void>

  /** 订阅 Agent 流式事件（返回清理函数） */
  onAgentStreamEvent: (callback: (event: AgentStreamEvent) => void) => () => void

  /** 订阅 Agent 流式完成事件 */
  onAgentStreamComplete: (callback: (data: AgentStreamCompletePayload) => void) => () => void

  /** 订阅 Agent 流式错误事件 */
  onAgentStreamError: (callback: (data: { sessionId: string; error: string }) => void) => () => void

  /** 订阅 Agent 标题自动更新事件 */
  onAgentTitleUpdated: (callback: (data: { sessionId: string; title: string }) => void) => () => void

  // ===== Agent 权限系统 =====

  /** 响应权限请求 */
  respondPermission: (response: PermissionResponse) => Promise<void>

  /** 热切换指定会话的权限模式（运行中生效，仅影响该 session） */
  updateSessionPermissionMode: (sessionId: string, mode: MyYodaPermissionMode) => Promise<void>

  // ===== Chat 工具管理 =====

  /** 获取所有工具信息 */
  getChatTools: () => Promise<ChatToolInfo[]>

  /** 获取工具凭据 */
  getChatToolCredentials: (toolId: string) => Promise<Record<string, string>>

  /** 更新工具开关状态 */
  updateChatToolState: (toolId: string, state: ChatToolState) => Promise<void>

  /** 更新工具凭据 */
  updateChatToolCredentials: (toolId: string, credentials: Record<string, string>) => Promise<void>

  /** 创建自定义工具 */
  createCustomChatTool: (meta: ChatToolMeta) => Promise<void>

  /** 删除自定义工具 */
  deleteCustomChatTool: (toolId: string) => Promise<void>

  /** 监听自定义工具配置变更 */
  onCustomToolChanged: (callback: () => void) => () => void

  /** 测试工具连接 */
  testChatTool: (toolId: string) => Promise<{ success: boolean; message: string }>

  // ===== AskUserQuestion 交互式问答 =====

  /** 响应 AskUser 请求 */
  respondAskUser: (response: AskUserResponse) => Promise<void>

  // ===== ExitPlanMode 计划审批 =====

  /** 响应 ExitPlanMode 请求 */
  respondExitPlanMode: (response: ExitPlanModeResponse) => Promise<void>

  /** 获取所有待处理的交互请求快照（渲染进程重载后恢复状态） */
  getPendingRequests: () => Promise<PendingRequestsSnapshot>

  // ===== Agent 附件 =====

  /** 保存文件到 Agent session 工作目录 */
  saveFilesToAgentSession: (input: AgentSaveFilesInput) => Promise<AgentSavedFile[]>

  /** 保存文件到工作区文件目录 */
  saveFilesToWorkspaceFiles: (input: AgentSaveWorkspaceFilesInput) => Promise<AgentSavedFile[]>

  /** 获取工作区文件目录路径 */
  getWorkspaceFilesPath: (workspaceSlug: string) => Promise<string>
  getWorkspaceRootPath: (workspaceSlug: string) => Promise<string>

  /** 打开文件夹选择对话框 */
  openFolderDialog: () => Promise<{ path: string; name: string } | null>

  /** 打开支持文件与文件夹混合选择的 Composer 对话框 */
  openFileOrFolderDialog: () => Promise<FileOrFolderDialogResult>

  /** 附加外部目录到 Agent 会话 */
  attachDirectory: (input: AgentAttachDirectoryInput) => Promise<string[]>

  /** 移除会话的附加目录 */
  detachDirectory: (input: AgentAttachDirectoryInput) => Promise<string[]>

  /** 附加外部文件到 Agent 会话 */
  attachFile: (input: AgentAttachFileInput) => Promise<string[]>

  /** 移除会话的附加文件 */
  detachFile: (input: AgentAttachFileInput) => Promise<string[]>

  /** 附加外部目录到工作区（所有会话可访问） */
  attachWorkspaceDirectory: (input: WorkspaceAttachDirectoryInput) => Promise<string[]>

  /** 移除工作区的附加目录 */
  detachWorkspaceDirectory: (input: WorkspaceAttachDirectoryInput) => Promise<string[]>

  /** 附加外部文件到工作区（所有会话可访问） */
  attachWorkspaceFile: (input: WorkspaceAttachFileInput) => Promise<string[]>

  /** 移除工作区的附加文件 */
  detachWorkspaceFile: (input: WorkspaceAttachFileInput) => Promise<string[]>

  /** 获取工作区附加目录列表 */
  getWorkspaceDirectories: (workspaceSlug: string) => Promise<string[]>

  /** 获取工作区附加文件列表 */
  getWorkspaceAttachedFiles: (workspaceSlug: string) => Promise<string[]>
  /** 获取工作区 worktree 仓库配置列表 */
  getWorktreeRepos: (workspaceSlug: string) => Promise<import('@myyoda/shared').WorkspaceWorktreeRepo[]>
  /** 添加 worktree 仓库到工作区配置 */
  addWorktreeRepo: (workspaceSlug: string, repo: import('@myyoda/shared').WorkspaceWorktreeRepo) => Promise<import('@myyoda/shared').WorkspaceWorktreeRepo[]>
  /** 从工作区配置移除 worktree 仓库 */
  removeWorktreeRepo: (workspaceSlug: string, repoPath: string) => Promise<import('@myyoda/shared').WorkspaceWorktreeRepo[]>

  /** 获取工作区默认工作目录（未绑定项目的新会话回退使用） */
  getWorkspaceDefaultWorkingDirectory: (workspaceSlug: string) => Promise<string | undefined>
  /** 设置/清空工作区默认工作目录 */
  setWorkspaceDefaultWorkingDirectory: (workspaceSlug: string, path: string | undefined) => Promise<string | undefined>

  // ===== Agent 文件系统操作 =====

  /** 获取 session 工作路径 */
  getAgentSessionPath: (workspaceId: string, sessionId: string) => Promise<string | null>
  /** 获取当前会话统一文件根 */
  getAgentSessionFileRoots: (workspaceId: string, sessionId: string) => Promise<AgentSessionFileRoots | null>
  /** 获取当前会话本轮捕获的文件产出 */
  listAgentSessionOutputs: (workspaceId: string, sessionId: string) => Promise<AgentOutputRecord[]>

  /** 列出目录内容 */
  listDirectory: (dirPath: string, access?: import('@myyoda/shared').FileAccessOptions) => Promise<FileEntry[]>

  /** 删除文件/目录 */
  deleteFile: (filePath: string, access?: import('@myyoda/shared').FileAccessOptions) => Promise<void>

  /** 用系统默认应用打开文件 */
  openFile: (filePath: string, access?: import('@myyoda/shared').FileAccessOptions) => Promise<void>

  /** 将剪贴板文本写入临时预览文件并返回绝对路径 */
  writeClipboardPreview: (filename: string, content: string) => Promise<string>

  /** 用系统默认应用打开任意文件（无工作区限制） */
  systemOpenFile: (filePath: string, appName?: string, access?: import('@myyoda/shared').FileAccessOptions) => Promise<void>

  /** 扫描系统中可用的编辑器应用（仅 macOS） */
  scanEditors: () => Promise<import('@myyoda/shared').EditorApp[]>

  /** 查询本机为该文件类型注册的默认打开应用（含图标 dataURL） */
  getDefaultAppForFile: (filePath: string, access?: import('@myyoda/shared').FileAccessOptions) => Promise<import('@myyoda/shared').DefaultAppInfo | null>

  /** 在系统文件管理器中显示文件 */
  showInFolder: (filePath: string, access?: import('@myyoda/shared').FileAccessOptions) => Promise<void>

  /** 使用系统终端打开文件夹（仅 macOS） */
  openFolderInTerminal: (folderPath: string) => Promise<void>

  /** 在系统文件管理器中显示文件（无工作区限制，支持候选基础目录） */
  showItemInFolder: (filePath: string, candidateBasePaths?: string[]) => Promise<boolean>

  /** 解析文件路径并读取内容（供内联预览使用） */
  resolveAndReadFile: (filePath: string, access?: import('@myyoda/shared').FileAccessOptions) => Promise<{ resolvedPath: string; content: string } | null>

  /** 写入文本文件（供 Markdown 内联编辑使用） */
  writeTextFile: (filePath: string, content: string, access?: import('@myyoda/shared').FileAccessOptions) => Promise<boolean>

  /** 仅解析文件路径（供 PDF/图片等用 file:// 加载） */
  resolveFilePath: (filePath: string, access?: import('@myyoda/shared').FileAccessOptions) => Promise<import('@myyoda/shared').ResolvedFileUrl | null>

  /** 为内联 PDF 预览生成临时 HTML 文件，返回文件路径 */
  preparePdfPreview: (filePath: string, access?: import('@myyoda/shared').FileAccessOptions) => Promise<{ tmpHtmlUrl: string } | null>

  /** 为内联 HTML 预览注册文件所在目录 URL（相对路径资源自动解析） */
  prepareHtmlPreview: (filePath: string, access?: import('@myyoda/shared').FileAccessOptions) => Promise<{ tmpUrl: string } | null>

  /** 读取文件为 base64（带路径校验，供内联图片预览等） */
  readBinaryBase64: (filePath: string, access?: import('@myyoda/shared').FileAccessOptions, maxSize?: number) => Promise<string | null>

  /** DOCX 转 HTML（内联预览） */
  docxToHtml: (filePath: string, access?: import('@myyoda/shared').FileAccessOptions) => Promise<{ resolvedPath: string; html: string } | null>

  /** XLSX/PPTX 转 HTML（内联预览） */
  officeToHtml: (filePath: string, access?: import('@myyoda/shared').FileAccessOptions) => Promise<import('@myyoda/shared').OfficePreviewResult | null>

  /** 截图导出：将 HTML 渲染为 PNG 并复制到剪贴板或保存文件 */
  screenshotCapture: (input: { html: string; isDark: boolean; width?: number; mode: 'clipboard' | 'file'; css?: string; themeClass?: string }) => Promise<{ success: boolean; message: string; filePath?: string }>

  /** 重命名文件/目录 */
  renameFile: (filePath: string, newName: string, access?: import('@myyoda/shared').FileAccessOptions) => Promise<void>

  /** 移动文件/目录到目标目录 */
  moveFile: (filePath: string, targetDir: string, access?: import('@myyoda/shared').FileAccessOptions) => Promise<void>

  /** 列出附加目录内容 */
  listAttachedDirectory: (dirPath: string, access?: import('@myyoda/shared').FileAccessOptions) => Promise<FileEntry[]>

  /** 读取附加目录文件内容为 base64（限制在已附加目录范围内） */
  readAttachedFile: (filePath: string, sessionId?: string, workspaceSlug?: string) => Promise<string>

  /** 在文件管理器中显示附加目录文件 */
  showAttachedInFolder: (filePath: string, access?: import('@myyoda/shared').FileAccessOptions) => Promise<void>

  /** 重命名附加目录文件/目录（无工作区路径限制） */
  renameAttachedFile: (filePath: string, newName: string, access?: import('@myyoda/shared').FileAccessOptions) => Promise<void>

  /** 移动附加目录文件/目录（无工作区路径限制） */
  moveAttachedFile: (filePath: string, targetDir: string, access?: import('@myyoda/shared').FileAccessOptions) => Promise<void>

  /** 检查路径类型（文件 or 目录），用于拖拽检测 */
  checkPathsType: (paths: string[]) => Promise<{ directories: string[]; files: string[] }>

  /** 获取拖拽文件的本地路径（替代已废弃的 File.path） */
  getPathForFile: (file: File) => string

  /** 搜索工作区文件（用于 @ 引用，支持附加目录） */
  searchWorkspaceFiles: (rootPath: string, query: string, limit?: number, additionalPaths?: string[], sessionPaths?: string[]) => Promise<FileSearchResult>

  // ===== 系统提示词管理 =====

  /** 获取系统提示词配置 */
  getSystemPromptConfig: () => Promise<SystemPromptConfig>

  /** 创建提示词 */
  createSystemPrompt: (input: SystemPromptCreateInput) => Promise<SystemPrompt>

  /** 更新提示词 */
  updateSystemPrompt: (id: string, input: SystemPromptUpdateInput) => Promise<SystemPrompt>

  /** 删除提示词 */
  deleteSystemPrompt: (id: string) => Promise<void>

  /** 更新追加日期时间和用户名开关 */
  updateAppendSetting: (enabled: boolean) => Promise<void>

  /** 设置默认提示词 */
  setDefaultPrompt: (id: string | null) => Promise<void>

  // ===== 自动更新 =====

  /** 更新 API */
  updater?: {
    checkForUpdates: () => Promise<void>
    getStatus: () => Promise<{
      status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error'
      version?: string
      releaseNotes?: string
      progress?: { percent: number; transferred: number; total: number; bytesPerSecond: number }
      error?: string
    }>
    onStatusChanged: (callback: (status: {
      status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error'
      version?: string
      releaseNotes?: string
      progress?: { percent: number; transferred: number; total: number; bytesPerSecond: number }
      error?: string
    }) => void) => () => void
    /** 在所有运行中的 Agent 结束后重启并安装更新 */
    installWhenIdle: () => Promise<boolean>
    /** 取消尚未执行的空闲安装请求 */
    cancelIdleInstall: () => Promise<void>
  }

  // GitHub Release
  getLatestRelease: () => Promise<GitHubRelease | null>
  listReleases: (options?: GitHubReleaseListOptions) => Promise<GitHubRelease[]>
  getReleaseByTag: (tag: string) => Promise<GitHubRelease | null>

  // 本地化版本历史（Release Notes）
  listReleaseNotes: () => Promise<ReleaseNote[]>
  getLatestReleaseVersion: () => Promise<string | undefined>
  getCombinedReleaseNotes: () => Promise<string>

  // 工作区文件变化通知
  onCapabilitiesChanged: (callback: () => void) => () => void
  onWorkspaceFilesChanged: (callback: () => void) => () => void

  // ===== 飞书集成 =====

  /** 获取飞书配置 */
  getFeishuConfig: () => Promise<FeishuConfig>
  /** 获取解密后的 App Secret */
  getDecryptedFeishuSecret: () => Promise<string>
  /** 保存飞书配置（appSecret 为明文） */
  saveFeishuConfig: (input: FeishuConfigInput) => Promise<FeishuConfig>
  /** 测试飞书连接 */
  testFeishuConnection: (appId: string, appSecret: string) => Promise<FeishuTestResult>
  /** 启动飞书 Bridge */
  startFeishuBridge: () => Promise<void>
  /** 停止飞书 Bridge */
  stopFeishuBridge: () => Promise<void>
  /** 获取飞书 Bridge 状态 */
  getFeishuStatus: () => Promise<FeishuBridgeState>
  /** 获取绑定列表（包含已归档，调用方按视图过滤） */
  listFeishuBindings: () => Promise<FeishuChatBinding[]>
  /** 更新绑定（修改工作区/会话） */
  updateFeishuBinding: (input: FeishuUpdateBindingInput) => Promise<FeishuChatBinding | null>
  /** 移除绑定 */
  removeFeishuBinding: (chatId: string) => Promise<boolean>
  /** 上报用户在场状态 */
  reportFeishuPresence: (report: FeishuPresenceReport) => Promise<void>
  /** 订阅飞书 Bridge 状态变化 */
  onFeishuStatusChanged: (callback: (state: FeishuBridgeState) => void) => () => void

  // --- 多 Bot v2 API ---

  /** 获取多 Bot 配置 */
  getFeishuMultiConfig: () => Promise<import('@myyoda/shared').FeishuMultiBotConfig>
  /** 保存单个 Bot 配置 */
  saveFeishuBotConfig: (input: import('@myyoda/shared').FeishuBotConfigInput) => Promise<import('@myyoda/shared').FeishuBotConfig>
  /** 获取单个 Bot 解密后的 App Secret */
  getDecryptedFeishuBotSecret: (botId: string) => Promise<string>
  /** 删除 Bot */
  removeFeishuBot: (botId: string) => Promise<boolean>
  /** 启动单个 Bot */
  startFeishuBot: (botId: string) => Promise<void>
  /** 停止单个 Bot */
  stopFeishuBot: (botId: string) => Promise<void>
  /** 获取多 Bot 状态 */
  getFeishuMultiStatus: () => Promise<import('@myyoda/shared').FeishuMultiBridgeState>

  // --- 扫码注册 ---

  /** 启动扫码注册流程，等待用户扫码 + 飞书确认后返回 App ID/Secret */
  registerFeishuApp: () => Promise<import('@myyoda/shared').FeishuRegisterAppResult>
  /** 取消正在进行的扫码注册流程 */
  cancelFeishuRegistration: () => Promise<void>
  /** 监听二维码 URL 生成 */
  onFeishuRegisterQrcode: (callback: (payload: import('@myyoda/shared').FeishuRegisterAppQRCode) => void) => () => void
  /** 监听注册流程状态变化 */
  onFeishuRegisterStatus: (callback: (payload: import('@myyoda/shared').FeishuRegisterAppStatus) => void) => () => void

  // ===== 钉钉集成 =====

  /** 获取钉钉配置 */
  getDingTalkConfig: () => Promise<DingTalkConfig>
  /** 获取解密后的 Client Secret */
  getDecryptedDingTalkSecret: () => Promise<string>
  /** 保存钉钉配置（clientSecret 为明文） */
  saveDingTalkConfig: (input: DingTalkConfigInput) => Promise<DingTalkConfig>
  /** 测试钉钉连接 */
  testDingTalkConnection: (clientId: string, clientSecret: string) => Promise<DingTalkTestResult>
  /** 启动钉钉 Bridge */
  startDingTalkBridge: () => Promise<void>
  /** 停止钉钉 Bridge */
  stopDingTalkBridge: () => Promise<void>
  /** 获取钉钉 Bridge 状态 */
  getDingTalkStatus: () => Promise<DingTalkBridgeState>
  /** 订阅钉钉 Bridge 状态变化 */
  onDingTalkStatusChanged: (callback: (state: DingTalkBridgeState) => void) => () => void

  // --- 钉钉多 Bot v2 API ---

  /** 获取多 Bot 配置 */
  getDingTalkMultiConfig: () => Promise<import('@myyoda/shared').DingTalkMultiBotConfig>
  /** 保存单个 Bot 配置 */
  saveDingTalkBotConfig: (input: import('@myyoda/shared').DingTalkBotConfigInput) => Promise<import('@myyoda/shared').DingTalkBotConfig>
  /** 获取单个 Bot 解密后的 Client Secret */
  getDecryptedDingTalkBotSecret: (botId: string) => Promise<string>
  /** 删除 Bot */
  removeDingTalkBot: (botId: string) => Promise<boolean>
  /** 启动单个 Bot */
  startDingTalkBot: (botId: string) => Promise<void>
  /** 停止单个 Bot */
  stopDingTalkBot: (botId: string) => Promise<void>
  /** 获取多 Bot 状态 */
  getDingTalkMultiStatus: () => Promise<import('@myyoda/shared').DingTalkMultiBridgeState>

  // ===== 微信集成 =====

  /** 获取微信配置 */
  getWeChatConfig: () => Promise<WeChatConfig>
  /** 开始扫码登录 */
  startWeChatLogin: () => Promise<void>
  /** 登出微信 */
  logoutWeChat: () => Promise<void>
  /** 启动微信 Bridge（用已有凭证） */
  startWeChatBridge: () => Promise<void>
  /** 停止微信 Bridge */
  stopWeChatBridge: () => Promise<void>
  /** 获取微信 Bridge 状态 */
  getWeChatStatus: () => Promise<WeChatBridgeState>
  /** 订阅微信 Bridge 状态变化 */
  onWeChatStatusChanged: (callback: (state: WeChatBridgeState) => void) => () => void

  /** 订阅菜单关闭标签页事件（Cmd+W 被菜单拦截后转发） */
  onMenuCloseTab: (callback: () => void) => () => void

  // ===== 快速任务窗口 =====

  /** 提交快速任务 */
  submitQuickTask: (input: QuickTaskSubmitInput) => Promise<void>
  /** 隐藏快速任务窗口 */
  hideQuickTask: () => Promise<void>
  /** 重新注册全局快捷键（设置变更后） */
  reregisterGlobalShortcuts: () => Promise<Record<string, boolean>>
  /** 获取全局快捷键当前是否已被系统成功注册 */
  getGlobalShortcutRegistrationStatus: () => Promise<Record<string, boolean>>
  /** 订阅快速任务窗口聚焦事件 */
  onQuickTaskFocus: (callback: () => void) => () => void
  /** 订阅快速任务打开会话事件（主窗口接收，由渲染进程负责创建会话） */
  onQuickTaskOpenSession: (callback: (data: QuickTaskOpenSessionData) => void) => () => void

  // ===== 语音输入 =====

  /** 获取语音输入设置 */
  getVoiceDictationSettings: () => Promise<VoiceDictationSettings>
  /** 更新语音输入设置 */
  updateVoiceDictationSettings: (updates: VoiceDictationSettingsUpdate) => Promise<VoiceDictationSettings>
  /** 测试语音输入连接 */
  testVoiceDictationConnection: (updates?: VoiceDictationSettingsUpdate) => Promise<VoiceDictationTestResult>
  /** 唤起或停止语音输入浮窗 */
  toggleVoiceDictation: (input?: VoiceDictationToggleInput) => Promise<void>
  /** 开始语音输入会话 */
  startVoiceDictation: (input: VoiceDictationStartInput) => Promise<void>
  /** 发送语音音频分片 */
  sendVoiceDictationAudio: (input: VoiceDictationAudioChunkInput) => Promise<void>
  /** 上报实时麦克风音量，用于外部应用听写状态条。 */
  reportVoiceDictationVolume: (volume: number) => void
  /** 上报实时转写，用于外部应用听写状态条。 */
  reportVoiceDictationTranscript: (text: string) => void
  /** 停止语音输入会话 */
  stopVoiceDictation: (input: VoiceDictationStopInput) => Promise<void>
  /** 取消语音输入会话 */
  cancelVoiceDictation: (input: VoiceDictationStopInput) => Promise<void>
  /** 输出最终语音文本 */
  commitVoiceDictation: (input: VoiceDictationCommitInput) => Promise<VoiceDictationCommitResult>
  /** 更新 Proma 输入框中的临时识别文本 */
  previewVoiceDictation: (input: VoiceDictationPreviewInput) => Promise<void>
  /** 隐藏语音输入窗口 */
  hideVoiceDictation: () => Promise<void>
  /** 调整语音输入窗口高度 */
  resizeVoiceDictation: (input: VoiceDictationResizeInput) => Promise<void>
  /** 订阅语音输入窗口显示事件 */
  onVoiceDictationShown: (callback: (event: VoiceDictationShownEvent) => void) => () => void
  /** 订阅语音输入停止请求事件 */
  onVoiceDictationToggleStop: (callback: () => void) => () => void
  /** 订阅语音输入转写事件 */
  onVoiceDictationTranscript: (callback: (event: VoiceDictationTranscriptEvent) => void) => () => void
  /** 订阅语音输入状态事件 */
  onVoiceDictationState: (callback: (event: VoiceDictationStateEvent) => void) => () => void
  /** 订阅外部应用的听写状态条事件 */
  onVoiceDictationIndicatorState: (callback: (event: VoiceDictationIndicatorEvent) => void) => () => void
  /** 订阅主窗口插入语音文本事件 */
  onVoiceDictationInsertText: (callback: (data: VoiceDictationTextEvent) => void) => () => void
  /** 确认最终语音文本是否已被当前输入目标消费。 */
  acknowledgeVoiceDictationTextDelivery: (input: VoiceDictationTextDeliveryInput) => void
  /** 订阅主窗口临时识别文本更新事件 */
  onVoiceDictationPreviewText: (callback: (data: VoiceDictationTextEvent) => void) => () => void
  /** 订阅主窗口撤销临时识别文本事件 */
  onVoiceDictationClearPreviewText: (callback: (data: Pick<VoiceDictationTextEvent, 'sessionId' | 'targetInputId'>) => void) => () => void

  /** 检查麦克风权限状态 */
  checkMicrophonePermission: () => Promise<MicPermissionResult>
  /** 请求麦克风权限（仅 macOS 有效） */
  requestMicrophonePermission: () => Promise<MicPermissionResult>

  // ===== 菜单栏 =====

  /** 订阅菜单栏打开 Agent 会话事件 */
  onTrayOpenAgentSession: (callback: (data: TrayOpenAgentSessionData) => void) => () => void
  /** 订阅菜单栏创建会话事件 */
  onTrayCreateSession: (callback: (data: TrayCreateSessionData) => void) => () => void

  // ===== 数据迁移 =====

  /** 获取工作区导出预览信息 */
  migrationGetExportPreview: (workspaceId: string) => Promise<unknown>
  /** 获取所有工作区的 Skills/MCP 预览（团队分发模式） */
  migrationGetShareExportPreview: () => Promise<unknown>
  /** 执行导出 */
  migrationExport: (options: unknown) => Promise<MigrationExportResult>
  /** 执行 v2 多工作区导出 */
  migrationExportV2: (options: unknown) => Promise<MigrationExportResult>
  /** 解析导入文件，返回预览信息 */
  migrationParseImportFile: (filePath: string) => Promise<unknown>
  /** 确认导入 */
  migrationConfirmImport: (options: unknown) => Promise<{ success: boolean }>
  /** 打开文件选择对话框（选择 .myyoda-backup 或 .myyoda-share） */
  migrationOpenFileDialog: () => Promise<string | null>
  /** 打开文件保存对话框（选择导出路径） */
  migrationSaveFileDialog: (mode: string) => Promise<string | null>
  /** 订阅双击迁移文件触发的导入事件 */
  onMigrationOpenImportFile: (callback: (data: { filePath: string }) => void) => () => void

  // ===== 存储管理 =====

  /** 获取各目录存储统计 */
  getStorageStats: () => Promise<unknown>
  /** 按选项清理存储 */
  cleanupStorage: (options: unknown) => Promise<unknown>
  /** 清理临时文件（快速） */
  cleanupTempStorage: () => Promise<unknown>

  // ===== 用量统计 =====

  /** 获取跨会话用量聚合统计（range: all | 30d | 7d） */
  getUsageStats: (range: unknown) => Promise<unknown>
  /** 取消迁移导入（清理临时解压目录） */
  migrationCancelImport: (tempDir: string) => Promise<void>

  // ===== 定时任务（Automation）=====
  /** 获取定时任务；scope 默认 'current' 按当前 Workspace 过滤，'all' 不过滤；workspaceId 显式指定时优先使用 */
  listAutomations: (scope?: PlanningWorkspaceScope, workspaceId?: string) => Promise<Automation[]>
  /** 创建定时任务 */
  createAutomation: (input: CreateAutomationInput) => Promise<Automation>
  /** 更新定时任务 */
  updateAutomation: (input: UpdateAutomationInput) => Promise<Automation | undefined>
  /** 删除定时任务 */
  deleteAutomation: (id: string) => Promise<boolean>
  /** 切换启用/暂停 */
  toggleAutomation: (id: string, active: boolean) => Promise<Automation | undefined>
  /** 立即运行一次 */
  runAutomationNow: (id: string) => Promise<void>
  /** 订阅任务列表变更事件 */
  onAutomationChanged: (callback: () => void) => () => void

  // ===== Agent 专家包 =====
  experts: {
    list: () => Promise<ExpertPackage[]>
    get: (id: string) => Promise<ExpertPackage | null>
    create: (input: { id: string; label: string; identitySummary?: string; description?: string; avatar?: { icon?: string; accent?: string }; defaultProviderChannelId?: string; defaultModel?: string; skillSlugs?: string[] }) => Promise<ExpertPackage>
    updateManifest: (
      id: string,
      patch: Partial<Pick<ExpertManifest, 'skillSlugs' | 'mcpIds' | 'label' | 'description' | 'avatar' | 'defaultProviderChannelId' | 'defaultModel'>>,
    ) => Promise<ExpertPackage>
    updateFiles: (
      id: string,
      files: Partial<{ identityMd: string; soulMd: string; rulesMd: string }>,
    ) => Promise<ExpertPackage>
    listTeams: () => Promise<TeamSquad[]>
    getTeam: (id: string) => Promise<TeamSquad | null>
    createTeam: (input: CreateTeamInput) => Promise<TeamSquad>
    updateTeam: (id: string, patch: UpdateTeamInput) => Promise<TeamSquad>
    listTemplates: () => Promise<ExpertTemplate[]>
  }

  // ===== Projects / Tasks Kanban（新版 typed bridge） =====
  projects: {
    get: (workspaceRoot: string) => Promise<BrowserProject[]>
    /** get 的语义别名，方便新组件按集合语义调用。 */
    list: (workspaceRoot: string) => Promise<BrowserProject[]>
    getOne: (workspaceRoot: string, idOrSlug: string) => Promise<BrowserProject | null>
    create: (workspaceRoot: string, input: BrowserProjectCreateInput) => Promise<BrowserProject>
    update: (workspaceRoot: string, slug: string, patch: BrowserProjectUpdateInput) => Promise<BrowserProject>
    delete: (workspaceRoot: string, slug: string) => Promise<void>
    analyzeDeleteImpact: (workspaceRoot: string, idOrSlug: string) => Promise<ProjectDeleteImpact>
    listAssets: (workspaceRoot: string, slug: string) => Promise<BrowserProjectAsset[]>
    uploadAsset: (workspaceRoot: string, slug: string, input: BrowserProjectAssetUploadInput) => Promise<BrowserProjectAsset>
    deleteAsset: (workspaceRoot: string, slug: string, filename: string) => Promise<void>
    readMemory: (workspaceRoot: string, slug: string) => Promise<string>
    writeMemory: (workspaceRoot: string, slug: string, content: string) => Promise<void>
    openOrCreateByPath: (
      workspaceRoot: string,
      folderPath: string,
    ) => Promise<BrowserOpenOrCreateProjectResult>
    resolveEffectiveCwd: (
      workspaceRoot: string,
      projectSlug: string,
    ) => Promise<BrowserEffectiveCwdResult>
    relocateWorkingDirectory: (
      workspaceRoot: string,
      projectSlug: string,
      newPath: string,
    ) => Promise<BrowserProject>
    restoreWorkingDirectory: (
      workspaceRoot: string,
      projectSlug: string,
    ) => Promise<BrowserProject>
    onChanged: (callback: (event: BrowserProjectChangedEvent) => void) => () => void
  }
  sessionGroups: {
    list: (workspaceSlug: string) => Promise<SessionGroup[]>
    create: (workspaceSlug: string, name: string) => Promise<SessionGroup>
    rename: (workspaceSlug: string, id: string, name: string) => Promise<SessionGroup>
    delete: (workspaceSlug: string, id: string) => Promise<void>
  }
  tasks: {
    validate: (yaml: string) => Promise<TaskValidationResult>
    create: (workspaceRoot: string, workspaceId: string, request: TaskCreateRequest) => Promise<TaskCreateResult>
    generate: (workspaceRoot: string, workspaceId: string, request: TaskGenerateRequest) => Promise<{ orchestratorSessionId: string }>
    onGenerated: (callback: (event: TaskGeneratedEventPayload) => void) => () => void
    run: (workspaceRoot: string, workspaceId: string, slug: string, options?: TaskRunOptions) => Promise<BrowserTaskRunSnapshot>
    pause: (workspaceRoot: string, workspaceId: string, slug: string, runId: string) => Promise<void>
    resume: (workspaceRoot: string, workspaceId: string, slug: string, runId: string) => Promise<void>
    stop: (workspaceRoot: string, workspaceId: string, slug: string, runId: string) => Promise<void>
    get: (workspaceRoot: string, slug: string) => Promise<TaskValidationResult | null>
    list: (workspaceRoot: string) => Promise<string[]>
    listSummaries: (workspaceRoot: string, workspaceId: string) => Promise<TaskAggregateSummary[]>
    updateWorkflow: (workspaceRoot: string, workspaceId: string, taskId: string, workflow: TaskWorkflow, expectedRevision?: number) => Promise<TaskAggregateSummary>
    updateMetadata: (workspaceRoot: string, workspaceId: string, taskId: string, patch: TaskMetadataPatch) => Promise<TaskAggregateSummary>
    analyzeDeleteImpact: (workspaceRoot: string, slug: string) => Promise<TaskDeleteImpact>
    delete: (workspaceRoot: string, workspaceId: string, slug: string) => Promise<void>
    getResults: (workspaceRoot: string, slug: string, runId?: string) => Promise<TaskResults | null>
  }
  labels: {
    list: (workspaceRoot: string) => Promise<WorkspaceLabel[]>
    create: (workspaceRoot: string, input: { name: string; color?: string }) => Promise<WorkspaceLabel>
    update: (workspaceRoot: string, labelId: string, patch: { name?: string; color?: string | null; archived?: boolean }) => Promise<WorkspaceLabel>
    archive: (workspaceRoot: string, labelId: string) => Promise<WorkspaceLabel>
    setSessionLabels: (workspaceRoot: string, sessionId: string, labelIds: string[]) => Promise<AgentSessionMeta>
    setTaskLabels: (workspaceRoot: string, workspaceId: string, taskId: string, labelIds: string[]) => Promise<TaskAggregateSummary>
  }
  sessions: {
    move: (sessionId: string, columnId: string) => Promise<AgentSessionMeta>
  }
  teambition: {
    capabilities: (workspaceRoot: string) => Promise<BrowserTeambitionCapabilities>
    listTasks: (workspaceRoot: string, projectId: string) => Promise<BrowserTeambitionTaskList>
    claimTask: (workspaceRoot: string, input: BrowserTeambitionClaimInput) => Promise<BrowserTeambitionBinding>
    bindTask: (workspaceRoot: string, sessionId: string, task: BrowserTeambitionTask) => Promise<BrowserTeambitionBinding>
    getBinding: (workspaceRoot: string, sessionId: string) => Promise<BrowserTeambitionBinding | null>
    listBindings: (workspaceRoot: string) => Promise<BrowserTeambitionBinding[]>
    updateStatus: (workspaceRoot: string, bindingId: string, status: string) => Promise<BrowserTeambitionBinding>
    syncProgress: (workspaceRoot: string, bindingId: string, progress: number) => Promise<BrowserTeambitionBinding>
    retrySync: (workspaceRoot: string, bindingId: string) => Promise<BrowserTeambitionBinding>
  }

  // ===== Projects / Tasks Conductor =====
  getProjects: (workspaceRoot: string) => Promise<LoadedProject[]>
  getProject: (workspaceRoot: string, idOrSlug: string) => Promise<LoadedProject | undefined>
  createProject: (workspaceRoot: string, input: CreateProjectInput) => Promise<LoadedProject>
  updateProject: (workspaceRoot: string, slug: string, patch: UpdateProjectInput) => Promise<LoadedProject>
  deleteProject: (workspaceRoot: string, slug: string) => Promise<void>
  analyzeProjectDeleteImpact: (workspaceRoot: string, idOrSlug: string) => Promise<ProjectDeleteImpact>
  listProjectAssets: (workspaceRoot: string, slug: string) => Promise<ProjectAsset[]>
  uploadProjectAsset: (workspaceRoot: string, slug: string, input: UploadProjectAssetInput) => Promise<ProjectAsset>
  deleteProjectAsset: (workspaceRoot: string, slug: string, filename: string) => Promise<void>
  validateTask: (yaml: string) => Promise<unknown>
  createTask: (workspaceRoot: string, workspaceId: string, request: TaskCreateRequest) => Promise<unknown>
  generateTask: (workspaceRoot: string, workspaceId: string, request: TaskGenerateRequest) => Promise<{ orchestratorSessionId: string }>
  runTask: (workspaceRoot: string, workspaceId: string, slug: string, options?: TaskRunOptions) => Promise<unknown>
  pauseTask: (workspaceRoot: string, workspaceId: string, slug: string, runId: string) => Promise<void>
  resumeTask: (workspaceRoot: string, workspaceId: string, slug: string, runId: string) => Promise<void>
  stopKanbanTask: (workspaceRoot: string, workspaceId: string, slug: string, runId: string) => Promise<void>
  getTask: (workspaceRoot: string, slug: string) => Promise<unknown>
  listTasks: (workspaceRoot: string) => Promise<string[]>
  getTaskResults: (workspaceRoot: string, slug: string, runId?: string) => Promise<TaskResults | null>
  analyzeTaskDeleteImpact: (workspaceRoot: string, slug: string) => Promise<TaskDeleteImpact>
  sendSessionCommand: (sessionId: string, command: SessionKanbanCommand) => Promise<AgentSessionMeta>
  onProjectsChanged: (callback: (payload: ProjectsChangedEventPayload) => void) => () => void
  onTaskGenerated: (callback: (payload: TaskGeneratedEventPayload) => void) => () => void
  /** 订阅快速任务窗口事件 */
  onQuickTaskEvent: (callback: (event: QuickTaskWindowEvent) => void) => () => void

  // ===== 任务 / 日程（Planning）=====
  /** 打开或聚焦单例独立任务/日程窗口。 */
  openPlanningWindow: () => Promise<void>
  /** 为 Todo 启动 Agent 会话（Planning → Agent 桥接） */
  startTodoAgent: (input: StartTodoAgentInput) => Promise<StartTodoAgentResult>
  listTodos: (scope?: PlanningWorkspaceScope, workspaceId?: string) => Promise<Todo[]>
  createTodo: (input: CreateTodoInput) => Promise<Todo>
  updateTodo: (input: UpdateTodoInput) => Promise<Todo | undefined>
  deleteTodo: (id: string) => Promise<boolean>
  listCalendarEvents: (scope?: PlanningWorkspaceScope, workspaceId?: string) => Promise<CalendarEvent[]>
  createCalendarEvent: (input: CreateCalendarEventInput) => Promise<CalendarEvent>
  updateCalendarEvent: (input: UpdateCalendarEventInput) => Promise<CalendarEvent | undefined>
  deleteCalendarEvent: (id: string) => Promise<boolean>
  listPlanningGroups: (scope: PlanningGroupScope) => Promise<PlanningGroup[]>
  createPlanningGroup: (input: CreatePlanningGroupInput) => Promise<PlanningGroup>
  updatePlanningGroup: (input: UpdatePlanningGroupInput) => Promise<PlanningGroup | undefined>
  deletePlanningGroup: (scope: PlanningGroupScope, id: string) => Promise<boolean>
  listPlanningTags: () => Promise<PlanningTag[]>
  listActivePlanningReminders: () => Promise<ActivePlanningReminder[]>
  acknowledgePlanningReminder: (id: string) => Promise<PlanningReminder | undefined>
  snoozePlanningReminder: (input: SnoozePlanningReminderInput) => Promise<PlanningReminder | undefined>
  onPlanningRemindersDue: (callback: (reminders: ActivePlanningReminder[]) => void) => () => void
  onPlanningChanged: (callback: (change: PlanningChange) => void) => () => void
  onPlanningAgentOperation: (callback: (operation: PlanningAgentOperation) => void) => () => void
  /** 独立规划窗口启动的 Todo Agent 会话转交到主窗口（自动打开并注入提示） */
  onTodoAgentSessionReady: (callback: (activation: TodoAgentSessionActivation) => void) => () => void
  /** macOS EventKit 同步设置；非 macOS 返回 unsupported 或空集合。 */
  getPlanningNativeSyncStatus: () => Promise<PlanningNativeSyncStatus>
  requestPlanningNativeSyncAccess: (entity: PlanningNativeSyncEntity) => Promise<PlanningNativeSyncPermissionResult>
  openPlanningNativeSyncPrivacySettings: (entity: PlanningNativeSyncEntity) => Promise<void>
  listPlanningNativeSyncTargets: (entity: PlanningNativeSyncEntity) => Promise<PlanningNativeSyncTarget[]>
  listPlanningNativeConnectionTargets: (entity: PlanningNativeSyncEntity) => Promise<PlanningNativeSyncTarget[]>
  listPlanningNativeConnections: (entity?: PlanningNativeSyncEntity) => Promise<PlanningNativeConnection[]>
  connectPlanningNativeConnection: (input: ConnectPlanningNativeConnectionInput) => Promise<PlanningNativeConnection>
  disconnectPlanningNativeConnection: (id: string) => Promise<boolean>
  listPlanningNativeSyncConflicts: () => Promise<PlanningNativeSyncConflict[]>
  resolvePlanningNativeSyncConflict: (input: ResolvePlanningNativeSyncConflictInput) => Promise<boolean>
  listPlanningSyncProfiles: () => Promise<PlanningSyncProfile[]>
  savePlanningSyncProfile: (input: SavePlanningSyncProfileInput) => Promise<PlanningSyncProfile>

  /** CodeClaw 桌面助手桥接（主进程状态机 → 桌宠窗口） */
  codeClaw: {
    /** 订阅 CodeClaw 全量状态 */
    onState: (callback: (state: CodeClawState) => void) => () => void
    /** 订阅全局光标屏幕坐标（眼动追踪用） */
    onCursor: (callback: (point: { x: number; y: number }) => void) => () => void
    /** 拖拽移动窗口位置 */
    move: (x: number, y: number) => Promise<void>
    /** 打开/聚焦主窗口 */
    openMainWindow: () => Promise<void>
    /** 打开指定 Agent 会话；不传则打开当前优先会话 */
    openSession: (sessionId?: string) => Promise<void>
    /** 用户已在主应用中主动查看完成会话，清除 CodeClaw 未读状态 */
    markSessionViewed: (sessionId: string) => Promise<void>
    /** 切换 CodeClaw clean-room 宠物主题 */
    setTheme: (themeId: CodeClawThemeId) => Promise<void>
    /** 进入/退出 Mini 模式（贴边吸附） */
    setMiniMode: (req: CodeClawMiniRequest) => Promise<void>
    /** Mini 模式悬停探出/缩回 */
    peekMini: (req: CodeClawPeekRequest) => Promise<void>
    /** 调整桌宠窗口尺寸 S/M/L */
    setSize: (size: CodeClawSize) => Promise<void>
    /** 切换免打扰（交互静默） */
    setDnd: (dnd: boolean) => Promise<void>
    /** 切换音效 */
    setSound: (enabled: boolean) => Promise<void>
    /** 弹出桌宠右键菜单 */
    openContextMenu: () => Promise<void>
  }

  /** 内嵌浏览器（synara 移植）：Agent 浏览器面板控制 */
  browser: {
    open: (threadId: string, url?: string, newTab?: boolean) => Promise<{ tabId: string; state: ThreadBrowserState }>
    close: (threadId: string) => Promise<boolean>
    closeTab: (threadId: string, tabId?: string) => Promise<{ closedTabId: string | null; activeTabId: string | null }>
    selectTab: (threadId: string, tabId: string) => Promise<boolean>
    hide: (threadId: string) => Promise<boolean>
    getState: (threadId: string) => Promise<ThreadBrowserState>
    setBounds: (threadId: string, bounds: BrowserPanelBounds | null) => void
    navigate: (threadId: string, url: string) => Promise<boolean>
    back: (threadId: string) => Promise<boolean>
    forward: (threadId: string) => Promise<boolean>
    reload: (threadId: string) => Promise<boolean>
    onStateChange: (callback: (state: ThreadBrowserState) => void) => () => void
    getAnnotations: (threadId: string) => Promise<Array<{ id: string; ref: string; role?: string; name?: string; selector?: string; comment: string }>>
    clearAnnotations: (threadId: string) => Promise<boolean>
    setAnnotationInteractive: (threadId: string, interactive: boolean) => Promise<boolean>
    onAnnotationCommitted: (callback: (threadId: string, annotation: { id: string; ref: string; role?: string; name?: string; selector?: string; comment: string }) => void) => () => void
  }
}

interface MigrationExportResult {
  success: boolean
  filePath: string
  warnings?: string[]
}

/**
 * 实现 ElectronAPI 接口
 */
const electronAPI: ElectronAPI = {
  // 运行时
  getRuntimeStatus: () => {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_RUNTIME_STATUS)
  },

  reinitRuntime: () => {
    return ipcRenderer.invoke(IPC_CHANNELS.REINIT_RUNTIME)
  },

  getGitRepoStatus: (dirPath: string) => {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_GIT_REPO_STATUS, dirPath)
  },

  getUnstagedChanges: (dirPath: string, sessionPath?: string, workspaceFilesPath?: string, extraPaths?: string[], sessionId?: string) => {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_UNSTAGED_CHANGES, dirPath, sessionPath, workspaceFilesPath, extraPaths, sessionId)
  },

  getFileDiff: (input: import('@myyoda/shared').GetFileDiffInput) => {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_FILE_DIFF, input)
  },

  getUntrackedContent: (input: import('@myyoda/shared').GetFileDiffInput) => {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_UNTRACKED_CONTENT, input)
  },

  revertFile: (input: import('@myyoda/shared').RevertFileInput) => {
    return ipcRenderer.invoke(IPC_CHANNELS.REVERT_FILE, input)
  },

  getDiffContents: (input: import('@myyoda/shared').GetFileDiffInput) => {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_DIFF_CONTENTS, input)
  },

  listWorktrees: (repoPath: string, sessionId: string) => {
    return ipcRenderer.invoke(IPC_CHANNELS.LIST_WORKTREES, repoPath, sessionId)
  },

  listGitBranches: (input: ListGitBranchesInput) => {
    return ipcRenderer.invoke(IPC_CHANNELS.LIST_GIT_BRANCHES, input)
  },

  prepareSessionGitContext: (input: PrepareSessionGitContextInput) => {
    return ipcRenderer.invoke(IPC_CHANNELS.PREPARE_SESSION_GIT_CONTEXT, input)
  },

  getWorktreeChanges: (worktreePath: string, baseBranch: string, sessionId: string) => {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_WORKTREE_CHANGES, worktreePath, baseBranch, sessionId)
  },

  openDetachedPreview: (input: DetachedPreviewWindowInput) => {
    return ipcRenderer.invoke(IPC_CHANNELS.OPEN_DETACHED_PREVIEW, input) as Promise<string | null>
  },

  getDetachedPreviewData: (previewId: string) => {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_DETACHED_PREVIEW_DATA, previewId) as Promise<DetachedPreviewWindowData | null>
  },

  // ===== Pull Request（本地 gh CLI） =====

  getGhCliStatus: () => {
    return ipcRenderer.invoke(PR_IPC_CHANNELS.GH_STATUS)
  },

  getPullRequestPanelState: (repoPath: string) => {
    return ipcRenderer.invoke(PR_IPC_CHANNELS.PANEL_STATE, repoPath)
  },

  getCurrentBranchPullRequest: (repoPath: string) => {
    return ipcRenderer.invoke(PR_IPC_CHANNELS.GET_CURRENT_BRANCH_PR, repoPath)
  },

  listPullRequests: (input: import('@myyoda/shared').PullRequestsListInput) => {
    return ipcRenderer.invoke(PR_IPC_CHANNELS.LIST, input)
  },

  getPullRequestDetail: (input: import('@myyoda/shared').PullRequestDetailInput) => {
    return ipcRenderer.invoke(PR_IPC_CHANNELS.DETAIL, input)
  },

  getPullRequestDiff: (input: import('@myyoda/shared').PullRequestDetailInput) => {
    return ipcRenderer.invoke(PR_IPC_CHANNELS.DIFF, input)
  },

  createPullRequest: (input: import('@myyoda/shared').CreatePullRequestInput) => {
    return ipcRenderer.invoke(PR_IPC_CHANNELS.CREATE, input)
  },

  getDefaultBranch: (repoPath: string) => {
    return ipcRenderer.invoke(PR_IPC_CHANNELS.GET_DEFAULT_BRANCH, repoPath)
  },

  pullRequestAction: (input: import('@myyoda/shared').PullRequestActionInput) => {
    return ipcRenderer.invoke(PR_IPC_CHANNELS.ACTION, input)
  },

  addPullRequestComment: (input: import('@myyoda/shared').PullRequestCommentInput) => {
    return ipcRenderer.invoke(PR_IPC_CHANNELS.COMMENT, input)
  },

  checkoutPullRequest: (repoPath: string, number: number) => {
    return ipcRenderer.invoke(PR_IPC_CHANNELS.CHECKOUT, { repoPath, number })
  },

  getBranchWorktreeUsage: (repoPath: string, branch: string) => {
    return ipcRenderer.invoke(PR_IPC_CHANNELS.BRANCH_WORKTREE_USAGE, { repoPath, branch })
  },

  // 通用工具
  openExternal: (url: string) => {
    return ipcRenderer.invoke(IPC_CHANNELS.OPEN_EXTERNAL, url)
  },

  writeClipboardText: (text: string) => {
    return ipcRenderer.invoke(IPC_CHANNELS.WRITE_CLIPBOARD_TEXT, text)
  },

  // 窗口控制
  windowMinimize: () => {
    return ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MINIMIZE)
  },

  windowMaximize: () => {
    return ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MAXIMIZE)
  },

  windowClose: () => {
    return ipcRenderer.invoke(IPC_CHANNELS.WINDOW_CLOSE)
  },

  windowIsMaximized: () => {
    return ipcRenderer.invoke(IPC_CHANNELS.WINDOW_IS_MAXIMIZED)
  },

  windowIsFullScreen: () => {
    return ipcRenderer.invoke(IPC_CHANNELS.WINDOW_IS_FULLSCREEN)
  },

  getZoomFactor: () => {
    return ipcRenderer.invoke(IPC_CHANNELS.WINDOW_GET_ZOOM_FACTOR)
  },

  onZoomFactorChange: (callback: (zoomFactor: number) => void) => {
    const listener = (_: Electron.IpcRendererEvent, zoomFactor: number): void => callback(zoomFactor)
    ipcRenderer.on(IPC_CHANNELS.WINDOW_ZOOM_FACTOR_CHANGED, listener)
    return () => { ipcRenderer.removeListener(IPC_CHANNELS.WINDOW_ZOOM_FACTOR_CHANGED, listener) }
  },

  onWindowResize: (callback: () => void) => {
    const handler = (): void => callback()
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  },

  // 渠道管理
  listChannels: () => {
    return ipcRenderer.invoke(CHANNEL_IPC_CHANNELS.LIST)
  },

  createChannel: (input: ChannelCreateInput) => {
    return ipcRenderer.invoke(CHANNEL_IPC_CHANNELS.CREATE, input)
  },

  updateChannel: (id: string, input: ChannelUpdateInput) => {
    return ipcRenderer.invoke(CHANNEL_IPC_CHANNELS.UPDATE, id, input)
  },

  deleteChannel: (id: string) => {
    return ipcRenderer.invoke(CHANNEL_IPC_CHANNELS.DELETE, id)
  },

  decryptApiKey: (channelId: string) => {
    return ipcRenderer.invoke(CHANNEL_IPC_CHANNELS.DECRYPT_KEY, channelId)
  },

  testChannel: (channelId: string) => {
    return ipcRenderer.invoke(CHANNEL_IPC_CHANNELS.TEST, channelId)
  },

  testChannelDirect: (input: ChannelDirectTestInput) => {
    return ipcRenderer.invoke(CHANNEL_IPC_CHANNELS.TEST_DIRECT, input)
  },

  fetchModels: (input: FetchModelsInput) => {
    return ipcRenderer.invoke(CHANNEL_IPC_CHANNELS.FETCH_MODELS, input)
  },

  getChannelPlanQuota: (channelId: string) => {
    return ipcRenderer.invoke(CHANNEL_IPC_CHANNELS.GET_PLAN_QUOTA, channelId)
  },

  codexOAuthLogin: (method?: CodexOAuthLoginMethod) => {
    return ipcRenderer.invoke(CHANNEL_IPC_CHANNELS.CODEX_OAUTH_LOGIN, method)
  },

  codexOAuthCancel: () => {
    return ipcRenderer.invoke(CHANNEL_IPC_CHANNELS.CODEX_OAUTH_CANCEL)
  },

  onCodexOAuthDeviceCode: (callback: (deviceCode: CodexOAuthDeviceCode) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, deviceCode: CodexOAuthDeviceCode) => callback(deviceCode)
    ipcRenderer.on(CHANNEL_IPC_CHANNELS.CODEX_OAUTH_DEVICE_CODE, listener)
    return () => ipcRenderer.removeListener(CHANNEL_IPC_CHANNELS.CODEX_OAUTH_DEVICE_CODE, listener)
  },

  claudeOAuthPrepare: () => {
    return ipcRenderer.invoke(CHANNEL_IPC_CHANNELS.CLAUDE_OAUTH_PREPARE)
  },

  claudeOAuthExchange: (code: string) => {
    return ipcRenderer.invoke(CHANNEL_IPC_CHANNELS.CLAUDE_OAUTH_EXCHANGE, code)
  },

  claudeOAuthCancel: () => {
    return ipcRenderer.invoke(CHANNEL_IPC_CHANNELS.CLAUDE_OAUTH_CANCEL)
  },

  xaiOAuthLogin: () => {
    return ipcRenderer.invoke(CHANNEL_IPC_CHANNELS.XAI_OAUTH_LOGIN)
  },

  xaiOAuthCancel: () => {
    return ipcRenderer.invoke(CHANNEL_IPC_CHANNELS.XAI_OAUTH_CANCEL)
  },

  onXaiOAuthDeviceCode: (callback: (deviceCode: XaiOAuthDeviceCode) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, deviceCode: XaiOAuthDeviceCode) => callback(deviceCode)
    ipcRenderer.on(CHANNEL_IPC_CHANNELS.XAI_OAUTH_DEVICE_CODE, listener)
    return () => ipcRenderer.removeListener(CHANNEL_IPC_CHANNELS.XAI_OAUTH_DEVICE_CODE, listener)
  },

  // 对话管理
  listConversations: () => {
    return ipcRenderer.invoke(CHAT_IPC_CHANNELS.LIST_CONVERSATIONS)
  },

  createConversation: (title?: string, modelId?: string, channelId?: string) => {
    return ipcRenderer.invoke(CHAT_IPC_CHANNELS.CREATE_CONVERSATION, title, modelId, channelId)
  },

  getConversationMessages: (id: string) => {
    return ipcRenderer.invoke(CHAT_IPC_CHANNELS.GET_MESSAGES, id)
  },

  getRecentMessages: (id: string, limit: number) => {
    return ipcRenderer.invoke(CHAT_IPC_CHANNELS.GET_RECENT_MESSAGES, id, limit)
  },

  updateConversationTitle: (id: string, title: string) => {
    return ipcRenderer.invoke(CHAT_IPC_CHANNELS.UPDATE_TITLE, id, title)
  },

  updateConversationModel: (id: string, modelId: string, channelId: string) => {
    return ipcRenderer.invoke(CHAT_IPC_CHANNELS.UPDATE_MODEL, id, modelId, channelId)
  },

  deleteConversation: (id: string) => {
    return ipcRenderer.invoke(CHAT_IPC_CHANNELS.DELETE_CONVERSATION, id)
  },

  togglePinConversation: (id: string) => {
    return ipcRenderer.invoke(CHAT_IPC_CHANNELS.TOGGLE_PIN, id)
  },

  toggleArchiveConversation: (id: string) => {
    return ipcRenderer.invoke(CHAT_IPC_CHANNELS.TOGGLE_ARCHIVE, id)
  },

  searchConversationMessages: (query: string) => {
    return ipcRenderer.invoke(CHAT_IPC_CHANNELS.SEARCH_MESSAGES, query)
  },

  // 教程
  getTutorialContent: () => {
    return ipcRenderer.invoke(CHAT_IPC_CHANNELS.GET_TUTORIAL_CONTENT)
  },

  createWelcomeConversation: () => {
    return ipcRenderer.invoke(CHAT_IPC_CHANNELS.CREATE_WELCOME_CONVERSATION)
  },

  // 消息发送
  sendMessage: (input: ChatSendInput) => {
    return ipcRenderer.invoke(CHAT_IPC_CHANNELS.SEND_MESSAGE, input)
  },

  stopGeneration: (conversationId: string) => {
    return ipcRenderer.invoke(CHAT_IPC_CHANNELS.STOP_GENERATION, conversationId)
  },

  deleteMessage: (conversationId: string, messageId: string) => {
    return ipcRenderer.invoke(CHAT_IPC_CHANNELS.DELETE_MESSAGE, conversationId, messageId)
  },

  truncateMessagesFrom: (
    conversationId: string,
    messageId: string,
    preserveFirstMessageAttachments = false,
  ) => {
    return ipcRenderer.invoke(
      CHAT_IPC_CHANNELS.TRUNCATE_MESSAGES_FROM,
      conversationId,
      messageId,
      preserveFirstMessageAttachments,
    )
  },

  updateContextDividers: (conversationId: string, dividers: string[]) => {
    return ipcRenderer.invoke(CHAT_IPC_CHANNELS.UPDATE_CONTEXT_DIVIDERS, conversationId, dividers)
  },

  generateTitle: (input: GenerateTitleInput) => {
    return ipcRenderer.invoke(CHAT_IPC_CHANNELS.GENERATE_TITLE, input)
  },

  // 附件管理
  saveAttachment: (input: AttachmentSaveInput) => {
    return ipcRenderer.invoke(CHAT_IPC_CHANNELS.SAVE_ATTACHMENT, input)
  },

  readAttachment: (localPath: string) => {
    return ipcRenderer.invoke(CHAT_IPC_CHANNELS.READ_ATTACHMENT, localPath)
  },

  saveImageAs: (localPath: string, defaultFilename: string) => {
    return ipcRenderer.invoke(CHAT_IPC_CHANNELS.SAVE_IMAGE_AS, localPath, defaultFilename)
  },

  saveResourceFileAs: (resourceRelativePath: string, defaultFilename: string) => {
    return ipcRenderer.invoke(CHAT_IPC_CHANNELS.SAVE_RESOURCE_FILE_AS, resourceRelativePath, defaultFilename)
  },

  deleteAttachment: (localPath: string) => {
    return ipcRenderer.invoke(CHAT_IPC_CHANNELS.DELETE_ATTACHMENT, localPath)
  },

  openFileDialog: () => {
    return ipcRenderer.invoke(CHAT_IPC_CHANNELS.OPEN_FILE_DIALOG)
  },

  extractAttachmentText: (localPath: string) => {
    return ipcRenderer.invoke(CHAT_IPC_CHANNELS.EXTRACT_ATTACHMENT_TEXT, localPath)
  },

  // 用户档案
  getUserProfile: () => {
    return ipcRenderer.invoke(USER_PROFILE_IPC_CHANNELS.GET)
  },

  updateUserProfile: (updates: Partial<UserProfile>) => {
    return ipcRenderer.invoke(USER_PROFILE_IPC_CHANNELS.UPDATE, updates)
  },

  // 应用设置
  getSettings: () => {
    return ipcRenderer.invoke(SETTINGS_IPC_CHANNELS.GET)
  },

  updateSettings: (updates: Partial<AppSettings>) => {
    return ipcRenderer.invoke(SETTINGS_IPC_CHANNELS.UPDATE, updates)
  },

  updateSettingsSync: (updates: Partial<AppSettings>) => {
    return ipcRenderer.sendSync(SETTINGS_IPC_CHANNELS.UPDATE_SYNC, updates)
  },

  getSystemTheme: () => {
    return ipcRenderer.invoke(SETTINGS_IPC_CHANNELS.GET_SYSTEM_THEME)
  },

  onSystemThemeChanged: (callback: (isDark: boolean) => void) => {
    const listener = (_: unknown, isDark: boolean): void => callback(isDark)
    ipcRenderer.on(SETTINGS_IPC_CHANNELS.ON_SYSTEM_THEME_CHANGED, listener)
    return () => { ipcRenderer.removeListener(SETTINGS_IPC_CHANNELS.ON_SYSTEM_THEME_CHANGED, listener) }
  },

  onThemeSettingsChanged: (callback: (payload: { themeMode: string; themeStyle?: string; themePacks?: AppSettings['themePacks']; themeActiveVariant?: string; interfaceVariant?: string }) => void) => {
    const listener = (_: unknown, payload: { themeMode: string; themeStyle?: string; themePacks?: AppSettings['themePacks']; themeActiveVariant?: string; interfaceVariant?: string }): void => callback(payload)
    ipcRenderer.on(SETTINGS_IPC_CHANNELS.ON_THEME_SETTINGS_CHANGED, listener)
    return () => { ipcRenderer.removeListener(SETTINGS_IPC_CHANNELS.ON_THEME_SETTINGS_CHANGED, listener) }
  },

  // Scratch Pad 持久化
  loadScratchPad: () => {
    return ipcRenderer.invoke(SCRATCH_PAD_IPC_CHANNELS.LOAD)
  },

  saveScratchPad: (content: string) => {
    return ipcRenderer.invoke(SCRATCH_PAD_IPC_CHANNELS.SAVE, content)
  },

  saveScratchPadSync: (content: string) => {
    return ipcRenderer.sendSync(SCRATCH_PAD_IPC_CHANNELS.SAVE_SYNC, content)
  },

  exportScratchPad: (markdown: string, dirPath: string, filename: string) => {
    return ipcRenderer.invoke(SCRATCH_PAD_IPC_CHANNELS.EXPORT, markdown, dirPath, filename)
  },

  chooseExportPath: (defaultName: string) => {
    return ipcRenderer.invoke(SCRATCH_PAD_IPC_CHANNELS.CHOOSE_EXPORT_PATH, defaultName)
  },

  copyImageToClipboard: (dataUrl: string) => {
    return ipcRenderer.invoke(SCRATCH_PAD_IPC_CHANNELS.COPY_IMAGE, dataUrl)
  },

  // Excalidraw 画布
  listExcalidrawFiles: (workspaceSlug: string) => {
    return ipcRenderer.invoke(EXCALIDRAW_IPC_CHANNELS.LIST, workspaceSlug)
  },

  readExcalidrawFile: (workspaceSlug: string, slug: string) => {
    return ipcRenderer.invoke(EXCALIDRAW_IPC_CHANNELS.READ, workspaceSlug, slug)
  },

  createExcalidrawFile: (workspaceSlug: string, title: string) => {
    return ipcRenderer.invoke(EXCALIDRAW_IPC_CHANNELS.CREATE, workspaceSlug, title)
  },

  writeExcalidrawFile: (workspaceSlug: string, slug: string, payload: object) => {
    return ipcRenderer.invoke(EXCALIDRAW_IPC_CHANNELS.WRITE, workspaceSlug, slug, payload)
  },

  exportExcalidrawFile: (workspaceSlug: string, slug: string) => {
    return ipcRenderer.invoke(EXCALIDRAW_IPC_CHANNELS.EXPORT, workspaceSlug, slug)
  },

  deleteExcalidrawFile: (workspaceSlug: string, slug: string) => {
    return ipcRenderer.invoke(EXCALIDRAW_IPC_CHANNELS.DELETE, workspaceSlug, slug)
  },

  renameExcalidrawFile: (workspaceSlug: string, slug: string, newTitle: string) => {
    return ipcRenderer.invoke(EXCALIDRAW_IPC_CHANNELS.RENAME, workspaceSlug, slug, newTitle)
  },

  saveExcalidrawFileSync: (workspaceSlug: string, slug: string | null, title: string, payload: object) => {
    return ipcRenderer.sendSync(EXCALIDRAW_IPC_CHANNELS.SAVE_SYNC, workspaceSlug, slug, title, payload)
  },

  // Dock/Launcher 角标
  setDockBadgeCount: (count: number) => {
    return ipcRenderer.invoke(DOCK_BADGE_IPC_CHANNELS.SET_COUNT, count)
  },

  // 环境检测
  checkEnvironment: () => {
    return ipcRenderer.invoke(ENVIRONMENT_IPC_CHANNELS.CHECK)
  },

  // 第三方安装包（Git / Node.js）
  fetchInstallerManifest: () => {
    return ipcRenderer.invoke(INSTALLER_IPC_CHANNELS.MANIFEST)
  },
  downloadInstaller: (req: InstallerDownloadRequest) => {
    return ipcRenderer.invoke(INSTALLER_IPC_CHANNELS.DOWNLOAD, req)
  },
  cancelInstallerDownload: (key: string) => {
    return ipcRenderer.invoke(INSTALLER_IPC_CHANNELS.CANCEL, key)
  },
  launchInstaller: (filePath: string) => {
    return ipcRenderer.invoke(INSTALLER_IPC_CHANNELS.LAUNCH, filePath)
  },
  onInstallerProgress: (callback: (payload: InstallerProgressPayload) => void) => {
    const listener = (_: unknown, payload: InstallerProgressPayload) => callback(payload)
    ipcRenderer.on(INSTALLER_IPC_CHANNELS.PROGRESS, listener)
    return () => ipcRenderer.off(INSTALLER_IPC_CHANNELS.PROGRESS, listener)
  },

  // 代理配置
  getProxySettings: () => {
    return ipcRenderer.invoke(PROXY_IPC_CHANNELS.GET_SETTINGS)
  },

  updateProxySettings: (config: ProxyConfig) => {
    return ipcRenderer.invoke(PROXY_IPC_CHANNELS.UPDATE_SETTINGS, config)
  },

  detectSystemProxy: () => {
    return ipcRenderer.invoke(PROXY_IPC_CHANNELS.DETECT_SYSTEM)
  },

  // 流式事件订阅
  onStreamChunk: (callback: (event: StreamChunkEvent) => void) => {
    const listener = (_: unknown, event: StreamChunkEvent): void => callback(event)
    ipcRenderer.on(CHAT_IPC_CHANNELS.STREAM_CHUNK, listener)
    return () => { ipcRenderer.removeListener(CHAT_IPC_CHANNELS.STREAM_CHUNK, listener) }
  },

  onStreamReasoning: (callback: (event: StreamReasoningEvent) => void) => {
    const listener = (_: unknown, event: StreamReasoningEvent): void => callback(event)
    ipcRenderer.on(CHAT_IPC_CHANNELS.STREAM_REASONING, listener)
    return () => { ipcRenderer.removeListener(CHAT_IPC_CHANNELS.STREAM_REASONING, listener) }
  },

  onStreamComplete: (callback: (event: StreamCompleteEvent) => void) => {
    const listener = (_: unknown, event: StreamCompleteEvent): void => callback(event)
    ipcRenderer.on(CHAT_IPC_CHANNELS.STREAM_COMPLETE, listener)
    return () => { ipcRenderer.removeListener(CHAT_IPC_CHANNELS.STREAM_COMPLETE, listener) }
  },

  onStreamError: (callback: (event: StreamErrorEvent) => void) => {
    const listener = (_: unknown, event: StreamErrorEvent): void => callback(event)
    ipcRenderer.on(CHAT_IPC_CHANNELS.STREAM_ERROR, listener)
    return () => { ipcRenderer.removeListener(CHAT_IPC_CHANNELS.STREAM_ERROR, listener) }
  },

  onStreamToolActivity: (callback: (event: StreamToolActivityEvent) => void) => {
    const listener = (_: unknown, event: StreamToolActivityEvent): void => callback(event)
    ipcRenderer.on(CHAT_IPC_CHANNELS.STREAM_TOOL_ACTIVITY, listener)
    return () => { ipcRenderer.removeListener(CHAT_IPC_CHANNELS.STREAM_TOOL_ACTIVITY, listener) }
  },

  // Agent 会话管理
  listAgentSessions: () => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.LIST_SESSIONS)
  },

  createAgentSession: (title?: string, channelId?: string, workspaceId?: string, modelId?: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.CREATE_SESSION, title, channelId, workspaceId, modelId)
  },

  getAgentSessionSDKMessages: (id: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_SDK_MESSAGES, id)
  },

  updateAgentSessionTitle: (id: string, title: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.UPDATE_TITLE, id, title)
  },

  updateSessionAgentRuntime: (sessionId: string, runtime: AgentRuntime) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.UPDATE_SESSION_AGENT_RUNTIME, sessionId, runtime)
  },

  updateSessionCodexFastMode: (sessionId: string, enabled: boolean) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.UPDATE_SESSION_CODEX_FAST_MODE, sessionId, enabled)
  },

  getPiReasoningCapability: (channelId: string, modelId: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_PI_REASONING_CAPABILITY, channelId, modelId)
  },

  updateSessionThinkingLevel: (sessionId: string, thinkingLevel: AgentThinkingLevel) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.UPDATE_SESSION_THINKING_LEVEL, sessionId, thinkingLevel)
  },

  updateSessionReasoningLevel: (sessionId: string, thinkingLevel: AgentThinkingLevel) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.UPDATE_SESSION_REASONING_LEVEL, sessionId, thinkingLevel)
  },

  updateSessionOpenAIThinkingLevel: (sessionId: string, thinkingLevel: AgentThinkingLevel) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.UPDATE_SESSION_THINKING_LEVEL, sessionId, thinkingLevel)
  },

  updateAgentSessionModel: (id: string, channelId?: string, modelId?: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.UPDATE_SESSION_MODEL, id, channelId, modelId)
  },

  deleteAgentSession: (id: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.DELETE_SESSION, id)
  },

  migrateChatToAgent: (conversationId: string, agentSessionId: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.MIGRATE_CHAT_TO_AGENT, conversationId, agentSessionId)
  },

  togglePinAgentSession: (id: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.TOGGLE_PIN, id)
  },

  toggleStarAgentSession: (id: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.TOGGLE_STAR, id)
  },

  clearAgentCompletionState: (id: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.CLEAR_COMPLETION_STATE, id)
  },

  toggleArchiveAgentSession: (id: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.TOGGLE_ARCHIVE, id)
  },

  searchAgentSessionMessages: (query: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.SEARCH_MESSAGES, query)
  },

  searchAgentSessionReferences: (input: AgentSessionReferenceSearchInput) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.SEARCH_SESSION_REFERENCES, input)
  },

  moveAgentSessionToWorkspace: (input: MoveSessionToWorkspaceInput) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.MOVE_SESSION_TO_WORKSPACE, input)
  },

  forkAgentSession: (input: ForkSessionInput) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.FORK_SESSION, input)
  },

  rewindSession: (input: RewindSessionInput) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.REWIND_SESSION, input)
  },

  generateAgentTitle: (input: AgentGenerateTitleInput) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GENERATE_TITLE, input)
  },

  sendAgentMessage: (input: AgentSendInput) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.SEND_MESSAGE, input)
  },

  stopAgent: (sessionId: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.STOP_AGENT, sessionId)
  },

  spawnExpertCowork: (input: SpawnExpertCoworkInput) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.SPAWN_EXPERT_COWORK, input)
  },

  // Agent 队列消息
  queueAgentMessage: (input: AgentQueueMessageInput) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.QUEUE_MESSAGE, input)
  },

  // Agent 后台任务管理
  getTaskOutput: (input: GetTaskOutputInput) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_TASK_OUTPUT, input)
  },

  stopTask: (input: StopTaskInput) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.STOP_TASK, input)
  },

  // Agent 工作区管理
  listAgentWorkspaces: () => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.LIST_WORKSPACES)
  },

  createAgentWorkspace: (name: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.CREATE_WORKSPACE, name)
  },

  updateAgentWorkspace: (id: string, updates: { name: string }) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.UPDATE_WORKSPACE, id, updates)
  },

  deleteAgentWorkspace: (id: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.DELETE_WORKSPACE, id)
  },

  reorderAgentWorkspaces: (orderedIds: string[]) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.REORDER_WORKSPACES, orderedIds)
  },

  // 工作区能力（MCP + Skill）
  getWorkspaceCapabilities: (workspaceSlug: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_CAPABILITIES, workspaceSlug)
  },

  getWorkspaceMcpConfig: (workspaceSlug: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_MCP_CONFIG, workspaceSlug)
  },

  saveWorkspaceMcpConfig: (workspaceSlug: string, config: WorkspaceMcpConfig) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.SAVE_MCP_CONFIG, workspaceSlug, config)
  },

  testMcpServer: (name: string, entry: import('@myyoda/shared').McpServerEntry) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.TEST_MCP_SERVER, name, entry) as Promise<{ success: boolean; message: string }>
  },

  setBuiltinMcpEnabled: (workspaceSlug: string, id: string, enabled: boolean) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.SET_BUILTIN_MCP_ENABLED, workspaceSlug, id, enabled)
  },

  getWorkspaceSkills: (workspaceSlug: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_SKILLS, workspaceSlug)
  },

  getWorkspaceSkillsDir: (workspaceSlug: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_SKILLS_DIR, workspaceSlug)
  },

  deleteWorkspaceSkill: (workspaceSlug: string, skillSlug: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.DELETE_SKILL, workspaceSlug, skillSlug)
  },

  toggleWorkspaceSkill: (workspaceSlug: string, skillSlug: string, enabled: boolean) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.TOGGLE_SKILL, workspaceSlug, skillSlug, enabled)
  },

  getOtherWorkspaceSkills: (currentSlug: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_OTHER_WORKSPACE_SKILLS, currentSlug)
  },

  getDefaultSkillSlugs: () => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_DEFAULT_SKILL_SLUGS)
  },

  importSkillFromWorkspace: (targetSlug: string, sourceSlug: string, skillSlug: string) => {
    return ipcRenderer.invoke(
      AGENT_IPC_CHANNELS.IMPORT_SKILL_FROM_WORKSPACE,
      targetSlug,
      sourceSlug,
      skillSlug,
    )
  },

  batchImportSkillsFromWorkspaces: (targetSlug: string, selections: import('@myyoda/shared').BulkImportWorkspaceSelection[]) => {
    return ipcRenderer.invoke(
      AGENT_IPC_CHANNELS.BATCH_IMPORT_SKILLS_FROM_WORKSPACES,
      targetSlug,
      selections,
    )
  },

  updateSkillFromSource: (targetSlug: string, skillSlug: string) => {
    return ipcRenderer.invoke(
      AGENT_IPC_CHANNELS.UPDATE_SKILL_FROM_SOURCE,
      targetSlug,
      skillSlug,
    )
  },

  // ── 企业版组织 Skills 分发 ───────────────────────────────

  orgGetConnection: () => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.ORG_GET_CONNECTION)
  },

  orgSetConnection: (mode: 'logout' | 'set', conn?: Parameters<ElectronAPI['orgSetConnection']>[1]) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.ORG_SET_CONNECTION, mode, conn)
  },

  orgAuthenticate: (action: 'login' | 'register' | 'apikey', serverUrl: string, email: string, password: string, displayName?: string, apiKey?: string) => {
    return ipcRenderer.invoke('org:authenticate', action, serverUrl, email, password, displayName, apiKey)
  },

  orgMe: () => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.ORG_ME)
  },

  orgCreate: (name: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.ORG_CREATE, name)
  },

  orgJoin: (inviteCode: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.ORG_JOIN, inviteCode)
  },

  orgListMembers: (orgId: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.ORG_LIST_MEMBERS, orgId)
  },

  orgListSkills: (orgId: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.ORG_LIST_SKILLS, orgId)
  },

  orgImportSkill: (targetSlug: string, orgId: string, orgName: string, skill: OrganizationSkill) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.ORG_IMPORT_SKILL, targetSlug, orgId, orgName, skill)
  },

  orgUpdateSkill: (targetSlug: string, skillSlug: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.ORG_UPDATE_SKILL, targetSlug, skillSlug)
  },

  // ── 社区市场 ───────────────────────────────

  communityFetchManifest: () => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.COMMUNITY_FETCH_MANIFEST)
  },

  communityInstallSkill: (workspaceSlug: string, skill: CommunitySkill) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.COMMUNITY_INSTALL_SKILL, workspaceSlug, skill)
  },

  communityCheckGhCli: () => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.COMMUNITY_CHECK_GH_CLI)
  },

  communitySubmitSkill: (input: SkillSubmissionInput) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.COMMUNITY_SUBMIT_SKILL, input)
  },

  readSkillContent: (workspaceSlug: string, skillSlug: string) => {
    return ipcRenderer.invoke(
      AGENT_IPC_CHANNELS.READ_SKILL_CONTENT,
      workspaceSlug,
      skillSlug,
    )
  },

  writeSkillContent: (workspaceSlug: string, skillSlug: string, content: string) => {
    return ipcRenderer.invoke(
      AGENT_IPC_CHANNELS.WRITE_SKILL_CONTENT,
      workspaceSlug,
      skillSlug,
      content,
    )
  },

  listSkillFiles: (workspaceSlug: string, skillSlug: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.LIST_SKILL_FILES, workspaceSlug, skillSlug)
  },

  readSkillFile: (workspaceSlug: string, skillSlug: string, relativePath: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.READ_SKILL_FILE, workspaceSlug, skillSlug, relativePath)
  },

  writeSkillFile: (workspaceSlug: string, skillSlug: string, relativePath: string, content: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.WRITE_SKILL_FILE, workspaceSlug, skillSlug, relativePath, content)
  },

  createSkillEntry: (workspaceSlug: string, skillSlug: string, relativePath: string, type: 'file' | 'directory') => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.CREATE_SKILL_ENTRY, workspaceSlug, skillSlug, relativePath, type)
  },

  deleteSkillEntry: (workspaceSlug: string, skillSlug: string, relativePath: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.DELETE_SKILL_ENTRY, workspaceSlug, skillSlug, relativePath)
  },

  renameSkillEntry: (workspaceSlug: string, skillSlug: string, fromRelative: string, toRelative: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.RENAME_SKILL_ENTRY, workspaceSlug, skillSlug, fromRelative, toRelative)
  },

  getWorkspaceMemorySummary: (workspaceSlug: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_WORKSPACE_MEMORY_SUMMARY, workspaceSlug)
  },

  readWorkspaceAgentsMd: (workspaceSlug: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.READ_WORKSPACE_AGENTS_MD, workspaceSlug)
  },

  writeWorkspaceAgentsMd: (workspaceSlug: string, content: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.WRITE_WORKSPACE_AGENTS_MD, workspaceSlug, content)
  },

  listWorkspaceAutoMemoryFiles: (workspaceSlug: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.LIST_WORKSPACE_AUTO_MEMORY_FILES, workspaceSlug)
  },

  readWorkspaceAutoMemoryFile: (workspaceSlug: string, relativePath: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.READ_WORKSPACE_AUTO_MEMORY_FILE, workspaceSlug, relativePath)
  },

  writeWorkspaceAutoMemoryFile: (workspaceSlug: string, relativePath: string, content: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.WRITE_WORKSPACE_AUTO_MEMORY_FILE, workspaceSlug, relativePath, content)
  },

  openWorkspaceMemoryWindow: (workspaceSlug: string, relativePath?: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.OPEN_WORKSPACE_MEMORY_WINDOW, workspaceSlug, relativePath)
  },

  onWorkspaceMemoryWindowOpenFile: (callback: (relativePath: string) => void) => {
    const listener = (_: unknown, relativePath: string): void => callback(relativePath)
    ipcRenderer.on(AGENT_IPC_CHANNELS.WORKSPACE_MEMORY_WINDOW_OPEN_FILE, listener)
    return () => { ipcRenderer.removeListener(AGENT_IPC_CHANNELS.WORKSPACE_MEMORY_WINDOW_OPEN_FILE, listener) }
  },

  onWorkspaceMemoryWindowCloseRequested: (callback: () => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(AGENT_IPC_CHANNELS.WORKSPACE_MEMORY_WINDOW_CLOSE_REQUESTED, listener)
    return () => { ipcRenderer.removeListener(AGENT_IPC_CHANNELS.WORKSPACE_MEMORY_WINDOW_CLOSE_REQUESTED, listener) }
  },

  confirmWorkspaceMemoryWindowClose: (workspaceSlug: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.CONFIRM_WORKSPACE_MEMORY_WINDOW_CLOSE, workspaceSlug)
  },

  markWorkspaceMemoryWindowReady: (workspaceSlug: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.WORKSPACE_MEMORY_WINDOW_READY, workspaceSlug)
  },

  subscribeWorkspaceMemoryChanges: (workspaceSlug: string, callback: (change: import('@myyoda/shared').WorkspaceMemoryFileChange) => void) => {
    const listener = (_: unknown, payload: { workspaceSlug: string; change: import('@myyoda/shared').WorkspaceMemoryFileChange }): void => {
      if (payload.workspaceSlug === workspaceSlug) callback(payload.change)
    }
    ipcRenderer.on(AGENT_IPC_CHANNELS.WORKSPACE_MEMORY_FILE_CHANGED, listener)
    void ipcRenderer.invoke(AGENT_IPC_CHANNELS.START_WORKSPACE_MEMORY_WATCH, workspaceSlug)
    return () => {
      ipcRenderer.removeListener(AGENT_IPC_CHANNELS.WORKSPACE_MEMORY_FILE_CHANGED, listener)
      void ipcRenderer.invoke(AGENT_IPC_CHANNELS.STOP_WORKSPACE_MEMORY_WATCH, workspaceSlug)
    }
  },

  approveWorkspaceProjectKnowledgeMaintenance: (workspaceSlug: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.APPROVE_WORKSPACE_PROJECT_KNOWLEDGE_MAINTENANCE, workspaceSlug)
  },

  onAgentStreamEvent: (callback: (event: AgentStreamEvent) => void) => {
    const listener = (_: unknown, event: AgentStreamEvent): void => callback(event)
    ipcRenderer.on(AGENT_IPC_CHANNELS.STREAM_EVENT, listener)
    return () => { ipcRenderer.removeListener(AGENT_IPC_CHANNELS.STREAM_EVENT, listener) }
  },

  onAgentStreamComplete: (callback: (data: AgentStreamCompletePayload) => void) => {
    const listener = (_: unknown, data: AgentStreamCompletePayload): void => callback(data)
    ipcRenderer.on(AGENT_IPC_CHANNELS.STREAM_COMPLETE, listener)
    return () => { ipcRenderer.removeListener(AGENT_IPC_CHANNELS.STREAM_COMPLETE, listener) }
  },

  onAgentStreamError: (callback: (data: { sessionId: string; error: string }) => void) => {
    const listener = (_: unknown, data: { sessionId: string; error: string }): void => callback(data)
    ipcRenderer.on(AGENT_IPC_CHANNELS.STREAM_ERROR, listener)
    return () => { ipcRenderer.removeListener(AGENT_IPC_CHANNELS.STREAM_ERROR, listener) }
  },

  // 标题自动更新通知
  onAgentTitleUpdated: (callback: (data: { sessionId: string; title: string }) => void) => {
    const listener = (_: unknown, data: { sessionId: string; title: string }): void => callback(data)
    ipcRenderer.on(AGENT_IPC_CHANNELS.TITLE_UPDATED, listener)
    return () => { ipcRenderer.removeListener(AGENT_IPC_CHANNELS.TITLE_UPDATED, listener) }
  },

  // Agent 权限系统
  respondPermission: (response: PermissionResponse) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.PERMISSION_RESPOND, response)
  },

  updateSessionPermissionMode: (sessionId: string, mode: MyYodaPermissionMode) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.UPDATE_SESSION_PERMISSION_MODE, sessionId, mode)
  },

  // Chat 工具管理
  getChatTools: () => {
    return ipcRenderer.invoke(CHAT_TOOL_IPC_CHANNELS.GET_ALL_TOOLS)
  },

  getChatToolCredentials: (toolId: string) => {
    return ipcRenderer.invoke(CHAT_TOOL_IPC_CHANNELS.GET_TOOL_CREDENTIALS, toolId)
  },

  updateChatToolState: (toolId: string, state: ChatToolState) => {
    return ipcRenderer.invoke(CHAT_TOOL_IPC_CHANNELS.UPDATE_TOOL_STATE, toolId, state)
  },

  updateChatToolCredentials: (toolId: string, credentials: Record<string, string>) => {
    return ipcRenderer.invoke(CHAT_TOOL_IPC_CHANNELS.UPDATE_TOOL_CREDENTIALS, toolId, credentials)
  },

  createCustomChatTool: (meta: ChatToolMeta) => {
    return ipcRenderer.invoke(CHAT_TOOL_IPC_CHANNELS.CREATE_CUSTOM_TOOL, meta)
  },

  deleteCustomChatTool: (toolId: string) => {
    return ipcRenderer.invoke(CHAT_TOOL_IPC_CHANNELS.DELETE_CUSTOM_TOOL, toolId)
  },

  onCustomToolChanged: (callback: () => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(CHAT_TOOL_IPC_CHANNELS.CUSTOM_TOOL_CHANGED, listener)
    return () => { ipcRenderer.removeListener(CHAT_TOOL_IPC_CHANNELS.CUSTOM_TOOL_CHANGED, listener) }
  },

  testChatTool: (toolId: string) => {
    return ipcRenderer.invoke(CHAT_TOOL_IPC_CHANNELS.TEST_TOOL, toolId)
  },

  // AskUserQuestion 交互式问答
  respondAskUser: (response: AskUserResponse) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.ASK_USER_RESPOND, response)
  },

  // ExitPlanMode 计划审批
  respondExitPlanMode: (response: ExitPlanModeResponse) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.EXIT_PLAN_MODE_RESPOND, response)
  },

  // 待处理请求恢复
  getPendingRequests: () => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_PENDING_REQUESTS)
  },

  // 工作区文件变化通知
  onCapabilitiesChanged: (callback: () => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(AGENT_IPC_CHANNELS.CAPABILITIES_CHANGED, listener)
    return () => { ipcRenderer.removeListener(AGENT_IPC_CHANNELS.CAPABILITIES_CHANGED, listener) }
  },

  onWorkspaceFilesChanged: (callback: () => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(AGENT_IPC_CHANNELS.WORKSPACE_FILES_CHANGED, listener)
    return () => { ipcRenderer.removeListener(AGENT_IPC_CHANNELS.WORKSPACE_FILES_CHANGED, listener) }
  },

  // Agent 附件
  saveFilesToAgentSession: (input: AgentSaveFilesInput) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.SAVE_FILES_TO_SESSION, input)
  },

  saveFilesToWorkspaceFiles: (input: AgentSaveWorkspaceFilesInput) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.SAVE_FILES_TO_WORKSPACE, input)
  },

  getWorkspaceFilesPath: (workspaceSlug: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_WORKSPACE_FILES_PATH, workspaceSlug)
  },

  getWorkspaceRootPath: (workspaceSlug: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_WORKSPACE_ROOT_PATH, workspaceSlug)
  },

  openFolderDialog: () => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.OPEN_FOLDER_DIALOG)
  },

  openFileOrFolderDialog: () => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.OPEN_FILE_OR_FOLDER_DIALOG)
  },

  attachDirectory: (input: AgentAttachDirectoryInput) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.ATTACH_DIRECTORY, input)
  },

  detachDirectory: (input: AgentAttachDirectoryInput) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.DETACH_DIRECTORY, input)
  },

  attachFile: (input: AgentAttachFileInput) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.ATTACH_FILE, input)
  },

  detachFile: (input: AgentAttachFileInput) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.DETACH_FILE, input)
  },

  attachWorkspaceDirectory: (input: WorkspaceAttachDirectoryInput) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.ATTACH_WORKSPACE_DIRECTORY, input)
  },

  detachWorkspaceDirectory: (input: WorkspaceAttachDirectoryInput) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.DETACH_WORKSPACE_DIRECTORY, input)
  },

  attachWorkspaceFile: (input: WorkspaceAttachFileInput) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.ATTACH_WORKSPACE_FILE, input)
  },

  detachWorkspaceFile: (input: WorkspaceAttachFileInput) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.DETACH_WORKSPACE_FILE, input)
  },

  getWorkspaceDirectories: (workspaceSlug: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_WORKSPACE_DIRECTORIES, workspaceSlug)
  },

  getWorkspaceAttachedFiles: (workspaceSlug: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_WORKSPACE_ATTACHED_FILES, workspaceSlug)
  },

  getWorktreeRepos: (workspaceSlug: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_WORKTREE_REPOS, workspaceSlug)
  },

  addWorktreeRepo: (workspaceSlug: string, repo: import('@myyoda/shared').WorkspaceWorktreeRepo) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.ADD_WORKTREE_REPO, workspaceSlug, repo)
  },

  removeWorktreeRepo: (workspaceSlug: string, repoPath: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.REMOVE_WORKTREE_REPO, workspaceSlug, repoPath)
  },

  getWorkspaceDefaultWorkingDirectory: (workspaceSlug: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_WORKSPACE_DEFAULT_WORKING_DIRECTORY, workspaceSlug)
  },

  setWorkspaceDefaultWorkingDirectory: (workspaceSlug: string, path: string | undefined) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.SET_WORKSPACE_DEFAULT_WORKING_DIRECTORY, workspaceSlug, path)
  },

  // Agent 文件系统操作
  getAgentSessionPath: (workspaceId: string, sessionId: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_SESSION_PATH, workspaceId, sessionId)
  },
  getAgentSessionFileRoots: (workspaceId: string, sessionId: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_SESSION_FILE_ROOTS, workspaceId, sessionId) as Promise<AgentSessionFileRoots | null>
  },
  listAgentSessionOutputs: (workspaceId: string, sessionId: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.LIST_SESSION_OUTPUTS, workspaceId, sessionId) as Promise<AgentOutputRecord[]>
  },

  listDirectory: (dirPath: string, access?: import('@myyoda/shared').FileAccessOptions) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.LIST_DIRECTORY, dirPath, access)
  },

  deleteFile: (filePath: string, access?: import('@myyoda/shared').FileAccessOptions) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.DELETE_FILE, filePath, access)
  },

  openFile: (filePath: string, access?: import('@myyoda/shared').FileAccessOptions) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.OPEN_FILE, filePath, access)
  },

  writeClipboardPreview: (filename: string, content: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.WRITE_CLIPBOARD_PREVIEW, filename, content)
  },

  systemOpenFile: (filePath: string, appName?: string, access?: import('@myyoda/shared').FileAccessOptions) => {
    return ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_OPEN_FILE, filePath, appName, access)
  },

  scanEditors: () => {
    return ipcRenderer.invoke(IPC_CHANNELS.SCAN_EDITORS)
  },

  getDefaultAppForFile: (filePath: string, access?: import('@myyoda/shared').FileAccessOptions) => {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_DEFAULT_APP_FOR_FILE, filePath, access) as Promise<import('@myyoda/shared').DefaultAppInfo | null>
  },

  showInFolder: (filePath: string, access?: import('@myyoda/shared').FileAccessOptions) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.SHOW_IN_FOLDER, filePath, access)
  },

  openFolderInTerminal: (folderPath: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.OPEN_FOLDER_IN_TERMINAL, folderPath)
  },

  /** 在系统文件管理器中显示文件（无工作区限制，支持候选基础目录） */
  showItemInFolder: (filePath: string, candidateBasePaths?: string[]): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.SHOW_ITEM_IN_FOLDER, filePath, candidateBasePaths)
  },

  resolveAndReadFile: (filePath: string, access?: import('@myyoda/shared').FileAccessOptions) => {
    return ipcRenderer.invoke('file:resolve-and-read', filePath, access) as Promise<{ resolvedPath: string; content: string } | null>
  },

  writeTextFile: (filePath: string, content: string, access?: import('@myyoda/shared').FileAccessOptions) => {
    return ipcRenderer.invoke('file:write-text', filePath, content, access) as Promise<boolean>
  },

  resolveFilePath: (filePath: string, access?: import('@myyoda/shared').FileAccessOptions) => {
    return ipcRenderer.invoke('file:resolve-path', filePath, access) as Promise<import('@myyoda/shared').ResolvedFileUrl | null>
  },

  preparePdfPreview: (filePath: string, access?: import('@myyoda/shared').FileAccessOptions) => {
    return ipcRenderer.invoke('file:prepare-pdf-preview', filePath, access) as Promise<{ tmpHtmlUrl: string } | null>
  },

  prepareHtmlPreview: (filePath: string, access?: import('@myyoda/shared').FileAccessOptions) => {
    return ipcRenderer.invoke('file:prepare-html-preview', filePath, access) as Promise<{ tmpUrl: string } | null>
  },

  readBinaryBase64: (filePath: string, access?: import('@myyoda/shared').FileAccessOptions, maxSize?: number) => {
    return ipcRenderer.invoke('file:read-binary-base64', filePath, access, maxSize) as Promise<string | null>
  },

  docxToHtml: (filePath: string, access?: import('@myyoda/shared').FileAccessOptions) => {
    return ipcRenderer.invoke('file:docx-to-html', filePath, access) as Promise<{ resolvedPath: string; html: string } | null>
  },

  officeToHtml: (filePath: string, access?: import('@myyoda/shared').FileAccessOptions) => {
    return ipcRenderer.invoke('file:office-to-html', filePath, access) as Promise<import('@myyoda/shared').OfficePreviewResult | null>
  },

  screenshotCapture: (input: { html: string; isDark: boolean; width?: number; mode: 'clipboard' | 'file'; css?: string; themeClass?: string }) => {
    return ipcRenderer.invoke(IPC_CHANNELS.SCREENSHOT_CAPTURE, input) as Promise<{ success: boolean; message: string; filePath?: string }>
  },

  renameFile: (filePath: string, newName: string, access?: import('@myyoda/shared').FileAccessOptions) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.RENAME_FILE, filePath, newName, access)
  },

  moveFile: (filePath: string, targetDir: string, access?: import('@myyoda/shared').FileAccessOptions) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.MOVE_FILE, filePath, targetDir, access)
  },

  listAttachedDirectory: (dirPath: string, access?: import('@myyoda/shared').FileAccessOptions) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.LIST_ATTACHED_DIRECTORY, dirPath, access)
  },

  readAttachedFile: (filePath: string, sessionId?: string, workspaceSlug?: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.READ_ATTACHED_FILE, filePath, sessionId, workspaceSlug)
  },

  showAttachedInFolder: (filePath: string, access?: import('@myyoda/shared').FileAccessOptions) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.SHOW_ATTACHED_IN_FOLDER, filePath, access)
  },

  renameAttachedFile: (filePath: string, newName: string, access?: import('@myyoda/shared').FileAccessOptions) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.RENAME_ATTACHED_FILE, filePath, newName, access)
  },

  moveAttachedFile: (filePath: string, targetDir: string, access?: import('@myyoda/shared').FileAccessOptions) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.MOVE_ATTACHED_FILE, filePath, targetDir, access)
  },

  checkPathsType: (paths: string[]) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.CHECK_PATHS_TYPE, paths)
  },

  getPathForFile: (file: File) => {
    return webUtils.getPathForFile(file)
  },

  searchWorkspaceFiles: (rootPath: string, query: string, limit = 20, additionalPaths?: string[], sessionPaths?: string[]) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.SEARCH_WORKSPACE_FILES, rootPath, query, limit, additionalPaths, sessionPaths)
  },

  // 系统提示词管理
  getSystemPromptConfig: () => {
    return ipcRenderer.invoke(SYSTEM_PROMPT_IPC_CHANNELS.GET_CONFIG)
  },

  createSystemPrompt: (input: SystemPromptCreateInput) => {
    return ipcRenderer.invoke(SYSTEM_PROMPT_IPC_CHANNELS.CREATE, input)
  },

  updateSystemPrompt: (id: string, input: SystemPromptUpdateInput) => {
    return ipcRenderer.invoke(SYSTEM_PROMPT_IPC_CHANNELS.UPDATE, id, input)
  },

  deleteSystemPrompt: (id: string) => {
    return ipcRenderer.invoke(SYSTEM_PROMPT_IPC_CHANNELS.DELETE, id)
  },

  updateAppendSetting: (enabled: boolean) => {
    return ipcRenderer.invoke(SYSTEM_PROMPT_IPC_CHANNELS.UPDATE_APPEND_SETTING, enabled)
  },

  setDefaultPrompt: (id: string | null) => {
    return ipcRenderer.invoke(SYSTEM_PROMPT_IPC_CHANNELS.SET_DEFAULT, id)
  },

  // 自动更新
  updater: {
    checkForUpdates: () => ipcRenderer.invoke('updater:check'),
    getStatus: () => ipcRenderer.invoke('updater:get-status'),
    onStatusChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, status: Parameters<typeof callback>[0]): void => callback(status)
      ipcRenderer.on('updater:status-changed', listener)
      return () => { ipcRenderer.removeListener('updater:status-changed', listener) }
    },
    installWhenIdle: () => ipcRenderer.invoke('updater:install-when-idle'),
    cancelIdleInstall: () => ipcRenderer.invoke('updater:cancel-idle-install'),
  },

  // GitHub Release
  getLatestRelease: () => {
    return ipcRenderer.invoke(GITHUB_RELEASE_IPC_CHANNELS.GET_LATEST_RELEASE)
  },

  listReleases: (options) => {
    return ipcRenderer.invoke(GITHUB_RELEASE_IPC_CHANNELS.LIST_RELEASES, options)
  },

  getReleaseByTag: (tag) => {
    return ipcRenderer.invoke(GITHUB_RELEASE_IPC_CHANNELS.GET_RELEASE_BY_TAG, tag)
  },

  // 本地化版本历史（Release Notes）
  listReleaseNotes: () => {
    return ipcRenderer.invoke(RELEASE_NOTES_IPC_CHANNELS.LIST)
  },

  getLatestReleaseVersion: () => {
    return ipcRenderer.invoke(RELEASE_NOTES_IPC_CHANNELS.LATEST)
  },

  getCombinedReleaseNotes: () => {
    return ipcRenderer.invoke(RELEASE_NOTES_IPC_CHANNELS.COMBINED)
  },

  // ===== 飞书集成 =====

  getFeishuConfig: () => {
    return ipcRenderer.invoke(FEISHU_IPC_CHANNELS.GET_CONFIG)
  },

  getDecryptedFeishuSecret: () => {
    return ipcRenderer.invoke(FEISHU_IPC_CHANNELS.GET_DECRYPTED_SECRET)
  },

  saveFeishuConfig: (input: FeishuConfigInput) => {
    return ipcRenderer.invoke(FEISHU_IPC_CHANNELS.SAVE_CONFIG, input)
  },

  testFeishuConnection: (appId: string, appSecret: string) => {
    return ipcRenderer.invoke(FEISHU_IPC_CHANNELS.TEST_CONNECTION, appId, appSecret)
  },

  startFeishuBridge: () => {
    return ipcRenderer.invoke(FEISHU_IPC_CHANNELS.START_BRIDGE)
  },

  stopFeishuBridge: () => {
    return ipcRenderer.invoke(FEISHU_IPC_CHANNELS.STOP_BRIDGE)
  },

  getFeishuStatus: () => {
    return ipcRenderer.invoke(FEISHU_IPC_CHANNELS.GET_STATUS)
  },

  listFeishuBindings: () => {
    return ipcRenderer.invoke(FEISHU_IPC_CHANNELS.LIST_BINDINGS)
  },

  updateFeishuBinding: (input: FeishuUpdateBindingInput) => {
    return ipcRenderer.invoke(FEISHU_IPC_CHANNELS.UPDATE_BINDING, input)
  },

  removeFeishuBinding: (chatId: string) => {
    return ipcRenderer.invoke(FEISHU_IPC_CHANNELS.REMOVE_BINDING, chatId)
  },

  reportFeishuPresence: (report: FeishuPresenceReport) => {
    return ipcRenderer.invoke(FEISHU_IPC_CHANNELS.REPORT_PRESENCE, report)
  },

  onFeishuStatusChanged: (callback: (state: FeishuBridgeState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: FeishuBridgeState): void => callback(state)
    ipcRenderer.on(FEISHU_IPC_CHANNELS.STATUS_CHANGED, listener)
    return () => { ipcRenderer.removeListener(FEISHU_IPC_CHANNELS.STATUS_CHANGED, listener) }
  },

  // --- 多 Bot v2 API ---

  getFeishuMultiConfig: () => {
    return ipcRenderer.invoke(FEISHU_IPC_CHANNELS.GET_MULTI_CONFIG)
  },

  saveFeishuBotConfig: (input: import('@myyoda/shared').FeishuBotConfigInput) => {
    return ipcRenderer.invoke(FEISHU_IPC_CHANNELS.SAVE_BOT_CONFIG, input)
  },

  getDecryptedFeishuBotSecret: (botId: string) => {
    return ipcRenderer.invoke(FEISHU_IPC_CHANNELS.GET_BOT_DECRYPTED_SECRET, botId)
  },

  removeFeishuBot: (botId: string) => {
    return ipcRenderer.invoke(FEISHU_IPC_CHANNELS.REMOVE_BOT, botId)
  },

  startFeishuBot: (botId: string) => {
    return ipcRenderer.invoke(FEISHU_IPC_CHANNELS.START_BOT, botId)
  },

  stopFeishuBot: (botId: string) => {
    return ipcRenderer.invoke(FEISHU_IPC_CHANNELS.STOP_BOT, botId)
  },

  getFeishuMultiStatus: () => {
    return ipcRenderer.invoke(FEISHU_IPC_CHANNELS.GET_MULTI_STATUS)
  },

  // --- 扫码注册 ---

  registerFeishuApp: () => {
    return ipcRenderer.invoke(FEISHU_IPC_CHANNELS.REGISTER_APP_START)
  },

  cancelFeishuRegistration: () => {
    return ipcRenderer.invoke(FEISHU_IPC_CHANNELS.REGISTER_APP_CANCEL)
  },

  onFeishuRegisterQrcode: (callback: (payload: import('@myyoda/shared').FeishuRegisterAppQRCode) => void) => {
    const listener = (_: unknown, payload: import('@myyoda/shared').FeishuRegisterAppQRCode) => callback(payload)
    ipcRenderer.on(FEISHU_IPC_CHANNELS.REGISTER_APP_QRCODE, listener)
    return () => { ipcRenderer.removeListener(FEISHU_IPC_CHANNELS.REGISTER_APP_QRCODE, listener) }
  },

  onFeishuRegisterStatus: (callback: (payload: import('@myyoda/shared').FeishuRegisterAppStatus) => void) => {
    const listener = (_: unknown, payload: import('@myyoda/shared').FeishuRegisterAppStatus) => callback(payload)
    ipcRenderer.on(FEISHU_IPC_CHANNELS.REGISTER_APP_STATUS, listener)
    return () => { ipcRenderer.removeListener(FEISHU_IPC_CHANNELS.REGISTER_APP_STATUS, listener) }
  },

  // ===== 微信集成 =====

  getWeChatConfig: () => {
    return ipcRenderer.invoke(WECHAT_IPC_CHANNELS.GET_CONFIG)
  },

  startWeChatLogin: () => {
    return ipcRenderer.invoke(WECHAT_IPC_CHANNELS.START_LOGIN)
  },

  logoutWeChat: () => {
    return ipcRenderer.invoke(WECHAT_IPC_CHANNELS.LOGOUT)
  },

  startWeChatBridge: () => {
    return ipcRenderer.invoke(WECHAT_IPC_CHANNELS.START_BRIDGE)
  },

  stopWeChatBridge: () => {
    return ipcRenderer.invoke(WECHAT_IPC_CHANNELS.STOP_BRIDGE)
  },

  getWeChatStatus: () => {
    return ipcRenderer.invoke(WECHAT_IPC_CHANNELS.GET_STATUS)
  },

  onWeChatStatusChanged: (callback: (state: WeChatBridgeState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: WeChatBridgeState): void => callback(state)
    ipcRenderer.on(WECHAT_IPC_CHANNELS.STATUS_CHANGED, listener)
    return () => { ipcRenderer.removeListener(WECHAT_IPC_CHANNELS.STATUS_CHANGED, listener) }
  },

  // ===== 钉钉集成 =====

  getDingTalkConfig: () => {
    return ipcRenderer.invoke(DINGTALK_IPC_CHANNELS.GET_CONFIG)
  },

  getDecryptedDingTalkSecret: () => {
    return ipcRenderer.invoke(DINGTALK_IPC_CHANNELS.GET_DECRYPTED_SECRET)
  },

  saveDingTalkConfig: (input: DingTalkConfigInput) => {
    return ipcRenderer.invoke(DINGTALK_IPC_CHANNELS.SAVE_CONFIG, input)
  },

  testDingTalkConnection: (clientId: string, clientSecret: string) => {
    return ipcRenderer.invoke(DINGTALK_IPC_CHANNELS.TEST_CONNECTION, clientId, clientSecret)
  },

  startDingTalkBridge: () => {
    return ipcRenderer.invoke(DINGTALK_IPC_CHANNELS.START_BRIDGE)
  },

  stopDingTalkBridge: () => {
    return ipcRenderer.invoke(DINGTALK_IPC_CHANNELS.STOP_BRIDGE)
  },

  getDingTalkStatus: () => {
    return ipcRenderer.invoke(DINGTALK_IPC_CHANNELS.GET_STATUS)
  },

  onDingTalkStatusChanged: (callback: (state: DingTalkBridgeState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: DingTalkBridgeState): void => callback(state)
    ipcRenderer.on(DINGTALK_IPC_CHANNELS.STATUS_CHANGED, listener)
    return () => { ipcRenderer.removeListener(DINGTALK_IPC_CHANNELS.STATUS_CHANGED, listener) }
  },

  // --- 钉钉多 Bot v2 API ---

  getDingTalkMultiConfig: () => {
    return ipcRenderer.invoke(DINGTALK_IPC_CHANNELS.GET_MULTI_CONFIG)
  },

  saveDingTalkBotConfig: (input: import('@myyoda/shared').DingTalkBotConfigInput) => {
    return ipcRenderer.invoke(DINGTALK_IPC_CHANNELS.SAVE_BOT_CONFIG, input)
  },

  getDecryptedDingTalkBotSecret: (botId: string) => {
    return ipcRenderer.invoke(DINGTALK_IPC_CHANNELS.GET_BOT_DECRYPTED_SECRET, botId)
  },

  removeDingTalkBot: (botId: string) => {
    return ipcRenderer.invoke(DINGTALK_IPC_CHANNELS.REMOVE_BOT, botId)
  },

  startDingTalkBot: (botId: string) => {
    return ipcRenderer.invoke(DINGTALK_IPC_CHANNELS.START_BOT, botId)
  },

  stopDingTalkBot: (botId: string) => {
    return ipcRenderer.invoke(DINGTALK_IPC_CHANNELS.STOP_BOT, botId)
  },

  getDingTalkMultiStatus: () => {
    return ipcRenderer.invoke(DINGTALK_IPC_CHANNELS.GET_MULTI_STATUS)
  },

  onMenuCloseTab: (callback: () => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('menu:close-tab', listener)
    return () => { ipcRenderer.removeListener('menu:close-tab', listener) }
  },

  // ===== 快速任务窗口 =====

  submitQuickTask: (input: QuickTaskSubmitInput) => {
    return ipcRenderer.invoke(QUICK_TASK_IPC_CHANNELS.SUBMIT, input)
  },

  hideQuickTask: () => {
    return ipcRenderer.invoke(QUICK_TASK_IPC_CHANNELS.HIDE)
  },

  reregisterGlobalShortcuts: () => {
    return ipcRenderer.invoke(QUICK_TASK_IPC_CHANNELS.REREGISTER_GLOBAL_SHORTCUTS)
  },

  getGlobalShortcutRegistrationStatus: () => {
    return ipcRenderer.invoke(QUICK_TASK_IPC_CHANNELS.GET_GLOBAL_SHORTCUT_REGISTRATION_STATUS)
  },

  onQuickTaskFocus: (callback: () => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(QUICK_TASK_IPC_CHANNELS.FOCUS, listener)
    return () => { ipcRenderer.removeListener(QUICK_TASK_IPC_CHANNELS.FOCUS, listener) }
  },

  onQuickTaskOpenSession: (callback: (data: QuickTaskOpenSessionData) => void) => {
    const listener = (_: unknown, data: QuickTaskOpenSessionData): void => callback(data)
    ipcRenderer.on('quick-task:open-session', listener)
    return () => { ipcRenderer.removeListener('quick-task:open-session', listener) }
  },
  onQuickTaskEvent: (callback: (event: QuickTaskWindowEvent) => void) => {
    // MyYoda: planning quick-task IPC stub, to be completed with quick-task window
    const listener = (_: unknown, event: QuickTaskWindowEvent): void => callback(event)
    ipcRenderer.on('quick-task:event', listener)
    return () => { ipcRenderer.removeListener('quick-task:event', listener) }
  },

  // ===== 语音输入 =====

  getVoiceDictationSettings: () => {
    return ipcRenderer.invoke(VOICE_DICTATION_IPC_CHANNELS.GET_SETTINGS)
  },

  updateVoiceDictationSettings: (updates: VoiceDictationSettingsUpdate) => {
    return ipcRenderer.invoke(VOICE_DICTATION_IPC_CHANNELS.UPDATE_SETTINGS, updates)
  },

  testVoiceDictationConnection: (updates?: VoiceDictationSettingsUpdate) => {
    return ipcRenderer.invoke(VOICE_DICTATION_IPC_CHANNELS.TEST_CONNECTION, updates)
  },

  toggleVoiceDictation: (input?: VoiceDictationToggleInput) => {
    return ipcRenderer.invoke(VOICE_DICTATION_IPC_CHANNELS.TOGGLE, input)
  },

  startVoiceDictation: (input: VoiceDictationStartInput) => {
    return ipcRenderer.invoke(VOICE_DICTATION_IPC_CHANNELS.START, input)
  },

  sendVoiceDictationAudio: (input: VoiceDictationAudioChunkInput) => {
    return ipcRenderer.invoke(VOICE_DICTATION_IPC_CHANNELS.SEND_AUDIO, input)
  },

  reportVoiceDictationVolume: (volume: number) => {
    ipcRenderer.send(VOICE_DICTATION_IPC_CHANNELS.REPORT_VOLUME, volume)
  },

  reportVoiceDictationTranscript: (text: string) => {
    ipcRenderer.send(VOICE_DICTATION_IPC_CHANNELS.REPORT_TRANSCRIPT, text)
  },

  stopVoiceDictation: (input: VoiceDictationStopInput) => {
    return ipcRenderer.invoke(VOICE_DICTATION_IPC_CHANNELS.STOP, input)
  },

  cancelVoiceDictation: (input: VoiceDictationStopInput) => {
    return ipcRenderer.invoke(VOICE_DICTATION_IPC_CHANNELS.CANCEL, input)
  },

  commitVoiceDictation: (input: VoiceDictationCommitInput) => {
    return ipcRenderer.invoke(VOICE_DICTATION_IPC_CHANNELS.COMMIT, input)
  },

  previewVoiceDictation: (input: VoiceDictationPreviewInput) => {
    return ipcRenderer.invoke(VOICE_DICTATION_IPC_CHANNELS.PREVIEW, input)
  },

  hideVoiceDictation: () => {
    return ipcRenderer.invoke(VOICE_DICTATION_IPC_CHANNELS.HIDE)
  },

  resizeVoiceDictation: (input: VoiceDictationResizeInput) => {
    return ipcRenderer.invoke(VOICE_DICTATION_IPC_CHANNELS.RESIZE, input)
  },

  onVoiceDictationShown: (callback: (event: VoiceDictationShownEvent) => void) => {
    const listener = (_: unknown, event: VoiceDictationShownEvent): void => callback(event)
    ipcRenderer.on(VOICE_DICTATION_IPC_CHANNELS.SHOWN, listener)
    return () => { ipcRenderer.removeListener(VOICE_DICTATION_IPC_CHANNELS.SHOWN, listener) }
  },

  onVoiceDictationToggleStop: (callback: () => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(VOICE_DICTATION_IPC_CHANNELS.TOGGLE_STOP, listener)
    return () => { ipcRenderer.removeListener(VOICE_DICTATION_IPC_CHANNELS.TOGGLE_STOP, listener) }
  },

  onVoiceDictationTranscript: (callback: (event: VoiceDictationTranscriptEvent) => void) => {
    const listener = (_: unknown, event: VoiceDictationTranscriptEvent): void => callback(event)
    ipcRenderer.on(VOICE_DICTATION_IPC_CHANNELS.TRANSCRIPT, listener)
    return () => { ipcRenderer.removeListener(VOICE_DICTATION_IPC_CHANNELS.TRANSCRIPT, listener) }
  },

  onVoiceDictationState: (callback: (event: VoiceDictationStateEvent) => void) => {
    const listener = (_: unknown, event: VoiceDictationStateEvent): void => callback(event)
    ipcRenderer.on(VOICE_DICTATION_IPC_CHANNELS.STATE, listener)
    return () => { ipcRenderer.removeListener(VOICE_DICTATION_IPC_CHANNELS.STATE, listener) }
  },

  onVoiceDictationIndicatorState: (callback: (event: VoiceDictationIndicatorEvent) => void) => {
    const listener = (_: unknown, event: VoiceDictationIndicatorEvent): void => callback(event)
    ipcRenderer.on(VOICE_DICTATION_IPC_CHANNELS.INDICATOR_STATE, listener)
    return () => { ipcRenderer.removeListener(VOICE_DICTATION_IPC_CHANNELS.INDICATOR_STATE, listener) }
  },

  onVoiceDictationInsertText: (callback: (data: VoiceDictationTextEvent) => void) => {
    const listener = (_: unknown, data: VoiceDictationTextEvent): void => callback(data)
    ipcRenderer.on(VOICE_DICTATION_IPC_CHANNELS.INSERT_TEXT, listener)
    return () => { ipcRenderer.removeListener(VOICE_DICTATION_IPC_CHANNELS.INSERT_TEXT, listener) }
  },

  acknowledgeVoiceDictationTextDelivery: (input: VoiceDictationTextDeliveryInput) => {
    ipcRenderer.send(VOICE_DICTATION_IPC_CHANNELS.ACK_INSERT_TEXT, input)
  },

  onVoiceDictationPreviewText: (callback: (data: VoiceDictationTextEvent) => void) => {
    const listener = (_: unknown, data: VoiceDictationTextEvent): void => callback(data)
    ipcRenderer.on(VOICE_DICTATION_IPC_CHANNELS.PREVIEW_TEXT, listener)
    return () => { ipcRenderer.removeListener(VOICE_DICTATION_IPC_CHANNELS.PREVIEW_TEXT, listener) }
  },

  onVoiceDictationClearPreviewText: (callback: (data: Pick<VoiceDictationTextEvent, 'sessionId' | 'targetInputId'>) => void) => {
    const listener = (_: unknown, data: Pick<VoiceDictationTextEvent, 'sessionId' | 'targetInputId'>): void => callback(data)
    ipcRenderer.on(VOICE_DICTATION_IPC_CHANNELS.CLEAR_PREVIEW_TEXT, listener)
    return () => { ipcRenderer.removeListener(VOICE_DICTATION_IPC_CHANNELS.CLEAR_PREVIEW_TEXT, listener) }
  },

  checkMicrophonePermission: () => {
    return ipcRenderer.invoke(VOICE_DICTATION_IPC_CHANNELS.CHECK_MIC_PERMISSION)
  },

  requestMicrophonePermission: () => {
    return ipcRenderer.invoke(VOICE_DICTATION_IPC_CHANNELS.REQUEST_MIC_PERMISSION)
  },

  onTrayOpenAgentSession: (callback: (data: TrayOpenAgentSessionData) => void) => {
    const listener = (_: unknown, data: TrayOpenAgentSessionData): void => callback(data)
    ipcRenderer.on(TRAY_IPC_CHANNELS.OPEN_AGENT_SESSION, listener)
    return () => { ipcRenderer.removeListener(TRAY_IPC_CHANNELS.OPEN_AGENT_SESSION, listener) }
  },

  onTrayCreateSession: (callback: (data: TrayCreateSessionData) => void) => {
    const listener = (_: unknown, data: TrayCreateSessionData): void => callback(data)
    ipcRenderer.on(TRAY_IPC_CHANNELS.CREATE_SESSION, listener)
    return () => { ipcRenderer.removeListener(TRAY_IPC_CHANNELS.CREATE_SESSION, listener) }
  },

  migrationGetExportPreview: (workspaceId: string) => {
    return ipcRenderer.invoke('migration:getExportPreview', workspaceId)
  },

  migrationGetShareExportPreview: () => {
    return ipcRenderer.invoke('migration:getShareExportPreview')
  },

  migrationExport: (options: unknown) => {
    return ipcRenderer.invoke('migration:export', options)
  },

  migrationExportV2: (options: unknown) => {
    return ipcRenderer.invoke('migration:exportV2', options)
  },

  migrationParseImportFile: (filePath: string) => {
    return ipcRenderer.invoke('migration:parseImportFile', filePath)
  },

  migrationConfirmImport: (options: unknown) => {
    return ipcRenderer.invoke('migration:confirmImport', options)
  },

  migrationOpenFileDialog: () => {
    return ipcRenderer.invoke('migration:openFileDialog')
  },

  migrationSaveFileDialog: (mode: string) => {
    return ipcRenderer.invoke('migration:saveFileDialog', mode)
  },

  onMigrationOpenImportFile: (callback: (data: { filePath: string }) => void) => {
    const listener = (_: unknown, data: { filePath: string }): void => callback(data)
    ipcRenderer.on('migration:open-import-file', listener)
    return () => { ipcRenderer.removeListener('migration:open-import-file', listener) }
  },

  // ===== 存储管理 =====

  getStorageStats: () => {
    return ipcRenderer.invoke(STORAGE_IPC_CHANNELS.GET_STATS)
  },

  cleanupStorage: (options: unknown) => {
    return ipcRenderer.invoke(STORAGE_IPC_CHANNELS.CLEANUP, options)
  },

  cleanupTempStorage: () => {
    return ipcRenderer.invoke(STORAGE_IPC_CHANNELS.CLEANUP_TEMP)
  },

  // ===== 用量统计 =====

  getUsageStats: (range: unknown) => {
    return ipcRenderer.invoke(USAGE_IPC_CHANNELS.GET_STATS, range)
  },

  migrationCancelImport: (tempDir: string) => {
    return ipcRenderer.invoke('migration:cancelImport', tempDir)
  },

  // ===== 定时任务（Automation）=====
  listAutomations: (scope?: PlanningWorkspaceScope, workspaceId?: string) => ipcRenderer.invoke(AUTOMATION_IPC_CHANNELS.LIST, scope, workspaceId),
  createAutomation: (input: CreateAutomationInput) =>
    ipcRenderer.invoke(AUTOMATION_IPC_CHANNELS.CREATE, input),
  updateAutomation: (input: UpdateAutomationInput) =>
    ipcRenderer.invoke(AUTOMATION_IPC_CHANNELS.UPDATE, input),
  deleteAutomation: (id: string) =>
    ipcRenderer.invoke(AUTOMATION_IPC_CHANNELS.DELETE, id),
  toggleAutomation: (id: string, active: boolean) =>
    ipcRenderer.invoke(AUTOMATION_IPC_CHANNELS.TOGGLE, id, active),
  runAutomationNow: (id: string) =>
    ipcRenderer.invoke(AUTOMATION_IPC_CHANNELS.RUN_NOW, id),
  onAutomationChanged: (callback: () => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(AUTOMATION_IPC_CHANNELS.CHANGED, listener)
    return () => { ipcRenderer.removeListener(AUTOMATION_IPC_CHANNELS.CHANGED, listener) }
  },

  // ===== Agent 专家包 =====
  experts: {
    list: (): Promise<ExpertPackage[]> =>
      invokeTyped<ExpertPackage[]>(EXPERT_IPC_CHANNELS.LIST),
    get: (id: string): Promise<ExpertPackage | null> =>
      invokeTyped<ExpertPackage | null>(EXPERT_IPC_CHANNELS.GET, id),
    create: (input: { id: string; label: string; identitySummary?: string; description?: string; avatar?: { icon?: string; accent?: string }; defaultProviderChannelId?: string; defaultModel?: string; skillSlugs?: string[] }): Promise<ExpertPackage> =>
      invokeTyped<ExpertPackage>(EXPERT_IPC_CHANNELS.CREATE, input),
    updateManifest: (
      id: string,
      patch: Partial<Pick<ExpertManifest, 'skillSlugs' | 'mcpIds' | 'label' | 'description' | 'avatar' | 'defaultProviderChannelId' | 'defaultModel'>>,
    ): Promise<ExpertPackage> =>
      invokeTyped<ExpertPackage>(EXPERT_IPC_CHANNELS.UPDATE_MANIFEST, id, patch),
    updateFiles: (
      id: string,
      files: Partial<{ identityMd: string; soulMd: string; rulesMd: string }>,
    ): Promise<ExpertPackage> =>
      invokeTyped<ExpertPackage>(EXPERT_IPC_CHANNELS.UPDATE_FILES, id, files),
    listTeams: (): Promise<TeamSquad[]> =>
      invokeTyped<TeamSquad[]>(EXPERT_IPC_CHANNELS.TEAMS_LIST),
    getTeam: (id: string): Promise<TeamSquad | null> =>
      invokeTyped<TeamSquad | null>(EXPERT_IPC_CHANNELS.TEAMS_GET, id),
    createTeam: (input: CreateTeamInput): Promise<TeamSquad> =>
      invokeTyped<TeamSquad>(EXPERT_IPC_CHANNELS.TEAMS_CREATE, input),
    updateTeam: (id: string, patch: UpdateTeamInput): Promise<TeamSquad> =>
      invokeTyped<TeamSquad>(EXPERT_IPC_CHANNELS.TEAMS_UPDATE, id, patch),
    listTemplates: (): Promise<ExpertTemplate[]> =>
      invokeTyped<ExpertTemplate[]>(EXPERT_IPC_CHANNELS.TEMPLATES_LIST),
  },

  // ===== Projects / Tasks Kanban（新版 typed bridge） =====
  projects: {
    get: async (workspaceRoot: string): Promise<BrowserProject[]> => {
      const projects = await invokeTyped<LoadedProject[]>(PROJECT_IPC_CHANNELS.GET, workspaceRoot)
      return projects.map(toBrowserProject)
    },
    list: async (workspaceRoot: string): Promise<BrowserProject[]> => {
      const projects = await invokeTyped<LoadedProject[]>(PROJECT_IPC_CHANNELS.GET, workspaceRoot)
      return projects.map(toBrowserProject)
    },
    getOne: async (workspaceRoot: string, idOrSlug: string): Promise<BrowserProject | null> => {
      const project = await invokeTyped<LoadedProject | null>(PROJECT_IPC_CHANNELS.GET_ONE, workspaceRoot, idOrSlug)
      return project ? toBrowserProject(project) : null
    },
    create: async (workspaceRoot: string, input: BrowserProjectCreateInput): Promise<BrowserProject> => {
      const project = await invokeTyped<LoadedProject>(PROJECT_IPC_CHANNELS.CREATE, workspaceRoot, input)
      return toBrowserProject(project)
    },
    update: async (workspaceRoot: string, slug: string, patch: BrowserProjectUpdateInput): Promise<BrowserProject> => {
      const project = await invokeTyped<LoadedProject>(PROJECT_IPC_CHANNELS.UPDATE, workspaceRoot, slug, patch)
      return toBrowserProject(project)
    },
    delete: (workspaceRoot: string, slug: string): Promise<void> =>
      invokeTyped<void>(PROJECT_IPC_CHANNELS.DELETE, workspaceRoot, slug),
    analyzeDeleteImpact: (workspaceRoot: string, idOrSlug: string): Promise<ProjectDeleteImpact> =>
      invokeTyped<ProjectDeleteImpact>(PROJECT_IPC_CHANNELS.ANALYZE_DELETE_IMPACT, workspaceRoot, idOrSlug),
    listAssets: async (workspaceRoot: string, slug: string): Promise<BrowserProjectAsset[]> => {
      const assets = await invokeTyped<ProjectAsset[]>(PROJECT_IPC_CHANNELS.LIST_ASSETS, workspaceRoot, slug)
      return assets.map(toBrowserProjectAsset)
    },
    uploadAsset: async (
      workspaceRoot: string,
      slug: string,
      input: BrowserProjectAssetUploadInput,
    ): Promise<BrowserProjectAsset> => {
      const asset = await invokeTyped<ProjectAsset>(PROJECT_IPC_CHANNELS.UPLOAD_ASSET, workspaceRoot, slug, input)
      return toBrowserProjectAsset(asset)
    },
    deleteAsset: (workspaceRoot: string, slug: string, filename: string): Promise<void> =>
      invokeTyped<void>(PROJECT_IPC_CHANNELS.DELETE_ASSET, workspaceRoot, slug, filename),
    readMemory: (workspaceRoot: string, slug: string): Promise<string> =>
      invokeTyped<string>(PROJECT_IPC_CHANNELS.READ_MEMORY, workspaceRoot, slug),
    writeMemory: (workspaceRoot: string, slug: string, content: string): Promise<void> =>
      invokeTyped<void>(PROJECT_IPC_CHANNELS.WRITE_MEMORY, workspaceRoot, slug, content),
    openOrCreateByPath: async (
      workspaceRoot: string,
      folderPath: string,
    ): Promise<BrowserOpenOrCreateProjectResult> => {
      const result = await invokeTyped<{ project: LoadedProject; created: boolean }>(
        PROJECT_IPC_CHANNELS.OPEN_OR_CREATE_BY_PATH,
        workspaceRoot,
        folderPath,
      )
      return { project: toBrowserProject(result.project), created: result.created }
    },
    resolveEffectiveCwd: (
      workspaceRoot: string,
      projectSlug: string,
    ): Promise<BrowserEffectiveCwdResult> =>
      invokeTyped<BrowserEffectiveCwdResult>(
        PROJECT_IPC_CHANNELS.RESOLVE_EFFECTIVE_CWD,
        workspaceRoot,
        projectSlug,
      ),
    relocateWorkingDirectory: async (
      workspaceRoot: string,
      projectSlug: string,
      newPath: string,
    ): Promise<BrowserProject> => {
      const project = await invokeTyped<LoadedProject>(
        PROJECT_IPC_CHANNELS.RELOCATE_WORKING_DIRECTORY,
        workspaceRoot,
        projectSlug,
        newPath,
      )
      return toBrowserProject(project)
    },
    restoreWorkingDirectory: async (
      workspaceRoot: string,
      projectSlug: string,
    ): Promise<BrowserProject> => {
      const project = await invokeTyped<LoadedProject>(
        PROJECT_IPC_CHANNELS.RESTORE_WORKING_DIRECTORY,
        workspaceRoot,
        projectSlug,
      )
      return toBrowserProject(project)
    },
    onChanged: (callback: (event: BrowserProjectChangedEvent) => void): (() => void) => {
      const listener = (_event: unknown, payload: ProjectsChangedEventPayload): void => {
        callback({
          kind: payload.kind,
          workspaceId: payload.workspaceId,
          projects: payload.projects.map(toBrowserProject),
        })
      }
      ipcRenderer.on(PROJECT_IPC_CHANNELS.CHANGED, listener)
      return () => { ipcRenderer.removeListener(PROJECT_IPC_CHANNELS.CHANGED, listener) }
    },
  },

  sessionGroups: {
    list: (workspaceSlug: string): Promise<SessionGroup[]> =>
      invokeTyped<SessionGroup[]>(SESSION_GROUP_IPC_CHANNELS.LIST, workspaceSlug),
    create: (workspaceSlug: string, name: string): Promise<SessionGroup> =>
      invokeTyped<SessionGroup>(SESSION_GROUP_IPC_CHANNELS.CREATE, workspaceSlug, name),
    rename: (workspaceSlug: string, id: string, name: string): Promise<SessionGroup> =>
      invokeTyped<SessionGroup>(SESSION_GROUP_IPC_CHANNELS.RENAME, workspaceSlug, id, name),
    delete: (workspaceSlug: string, id: string): Promise<void> =>
      invokeTyped<void>(SESSION_GROUP_IPC_CHANNELS.DELETE, workspaceSlug, id),
  },
  tasks: {
    validate: (yaml: string): Promise<TaskValidationResult> => invokeTyped<TaskValidationResult>(TASK_IPC_CHANNELS.VALIDATE, yaml),
    create: (workspaceRoot: string, workspaceId: string, request: TaskCreateRequest): Promise<TaskCreateResult> =>
      invokeTyped<TaskCreateResult>(TASK_IPC_CHANNELS.CREATE, workspaceRoot, workspaceId, request),
    generate: (workspaceRoot: string, workspaceId: string, request: TaskGenerateRequest): Promise<{ orchestratorSessionId: string }> =>
      invokeTyped<{ orchestratorSessionId: string }>(TASK_IPC_CHANNELS.GENERATE, workspaceRoot, workspaceId, request),
    onGenerated: (callback: (event: TaskGeneratedEventPayload) => void): (() => void) => {
      const listener = (_event: unknown, payload: TaskGeneratedEventPayload): void => callback(payload)
      ipcRenderer.on(TASK_IPC_CHANNELS.GENERATED, listener)
      return () => { ipcRenderer.removeListener(TASK_IPC_CHANNELS.GENERATED, listener) }
    },
    run: (workspaceRoot: string, workspaceId: string, slug: string, options?: TaskRunOptions): Promise<BrowserTaskRunSnapshot> =>
      invokeTyped<BrowserTaskRunSnapshot>(TASK_IPC_CHANNELS.RUN, workspaceRoot, workspaceId, slug, options),
    pause: (workspaceRoot: string, workspaceId: string, slug: string, runId: string): Promise<void> =>
      invokeTyped<void>(TASK_IPC_CHANNELS.PAUSE, workspaceRoot, workspaceId, slug, runId),
    resume: (workspaceRoot: string, workspaceId: string, slug: string, runId: string): Promise<void> =>
      invokeTyped<void>(TASK_IPC_CHANNELS.RESUME, workspaceRoot, workspaceId, slug, runId),
    stop: (workspaceRoot: string, workspaceId: string, slug: string, runId: string): Promise<void> =>
      invokeTyped<void>(TASK_IPC_CHANNELS.STOP, workspaceRoot, workspaceId, slug, runId),
    get: (workspaceRoot: string, slug: string): Promise<TaskValidationResult | null> =>
      invokeTyped<TaskValidationResult | null>(TASK_IPC_CHANNELS.GET, workspaceRoot, slug),
    list: (workspaceRoot: string): Promise<string[]> => invokeTyped<string[]>(TASK_IPC_CHANNELS.LIST, workspaceRoot),
    listSummaries: (workspaceRoot: string, workspaceId: string): Promise<TaskAggregateSummary[]> =>
      invokeTyped<TaskAggregateSummary[]>(TASK_IPC_CHANNELS.LIST_SUMMARIES, workspaceRoot, workspaceId),
    updateWorkflow: (workspaceRoot: string, workspaceId: string, taskId: string, workflow: TaskWorkflow, expectedRevision?: number): Promise<TaskAggregateSummary> =>
      invokeTyped<TaskAggregateSummary>(TASK_IPC_CHANNELS.UPDATE_WORKFLOW, workspaceRoot, workspaceId, taskId, workflow, expectedRevision),
    updateMetadata: (workspaceRoot: string, workspaceId: string, taskId: string, patch: TaskMetadataPatch): Promise<TaskAggregateSummary> =>
      invokeTyped<TaskAggregateSummary>(TASK_IPC_CHANNELS.UPDATE_METADATA, workspaceRoot, workspaceId, taskId, patch),
    analyzeDeleteImpact: (workspaceRoot: string, slug: string): Promise<TaskDeleteImpact> =>
      invokeTyped<TaskDeleteImpact>(TASK_IPC_CHANNELS.ANALYZE_DELETE_IMPACT, workspaceRoot, slug),
    delete: (workspaceRoot: string, workspaceId: string, slug: string): Promise<void> =>
      invokeTyped<void>(TASK_IPC_CHANNELS.DELETE, workspaceRoot, workspaceId, slug),
    getResults: (workspaceRoot: string, slug: string, runId?: string): Promise<TaskResults | null> =>
      invokeTyped<TaskResults | null>(TASK_IPC_CHANNELS.GET_RESULTS, workspaceRoot, slug, runId),
  },
  labels: {
    list: (workspaceRoot: string): Promise<WorkspaceLabel[]> =>
      invokeTyped<WorkspaceLabel[]>(LABEL_IPC_CHANNELS.LIST, workspaceRoot),
    create: (workspaceRoot: string, input: { name: string; color?: string }): Promise<WorkspaceLabel> =>
      invokeTyped<WorkspaceLabel>(LABEL_IPC_CHANNELS.CREATE, workspaceRoot, input),
    update: (workspaceRoot: string, labelId: string, patch: { name?: string; color?: string | null; archived?: boolean }): Promise<WorkspaceLabel> =>
      invokeTyped<WorkspaceLabel>(LABEL_IPC_CHANNELS.UPDATE, workspaceRoot, labelId, patch),
    archive: (workspaceRoot: string, labelId: string): Promise<WorkspaceLabel> =>
      invokeTyped<WorkspaceLabel>(LABEL_IPC_CHANNELS.ARCHIVE, workspaceRoot, labelId),
    setSessionLabels: (workspaceRoot: string, sessionId: string, labelIds: string[]): Promise<AgentSessionMeta> =>
      invokeTyped<AgentSessionMeta>(LABEL_IPC_CHANNELS.SET_SESSION_LABELS, workspaceRoot, sessionId, labelIds),
    setTaskLabels: (workspaceRoot: string, workspaceId: string, taskId: string, labelIds: string[]): Promise<TaskAggregateSummary> =>
      invokeTyped<TaskAggregateSummary>(LABEL_IPC_CHANNELS.SET_TASK_LABELS, workspaceRoot, workspaceId, taskId, labelIds),
  },
  sessions: {
    move: (sessionId: string, columnId: string): Promise<AgentSessionMeta> =>
      invokeTyped<AgentSessionMeta>(SESSION_COMMAND_CHANNEL, sessionId, { kind: 'set_kanban_column', kanbanColumn: columnId }),
  },
  teambition: {
    capabilities: (workspaceRoot: string): Promise<BrowserTeambitionCapabilities> =>
      invokeTyped<BrowserTeambitionCapabilities>(TEAMBITION_IPC_CHANNELS.CAPABILITIES, workspaceRoot),
    listTasks: (workspaceRoot: string, projectId: string): Promise<BrowserTeambitionTaskList> =>
      invokeTyped<BrowserTeambitionTaskList>(TEAMBITION_IPC_CHANNELS.LIST_TASKS, workspaceRoot, projectId),
    claimTask: (workspaceRoot: string, input: BrowserTeambitionClaimInput): Promise<BrowserTeambitionBinding> =>
      invokeTyped<BrowserTeambitionBinding>(TEAMBITION_IPC_CHANNELS.CLAIM_TASK, workspaceRoot, input),
    bindTask: (workspaceRoot: string, sessionId: string, task: BrowserTeambitionTask): Promise<BrowserTeambitionBinding> =>
      invokeTyped<BrowserTeambitionBinding>(TEAMBITION_IPC_CHANNELS.BIND_PROJECT, workspaceRoot, sessionId, task),
    getBinding: (workspaceRoot: string, sessionId: string): Promise<BrowserTeambitionBinding | null> =>
      invokeTyped<BrowserTeambitionBinding | null>(TEAMBITION_IPC_CHANNELS.GET_BINDING, workspaceRoot, sessionId),
    listBindings: (workspaceRoot: string): Promise<BrowserTeambitionBinding[]> =>
      invokeTyped<BrowserTeambitionBinding[]>(TEAMBITION_IPC_CHANNELS.LIST_BINDINGS, workspaceRoot),
    updateStatus: (workspaceRoot: string, bindingId: string, status: string): Promise<BrowserTeambitionBinding> =>
      invokeTyped<BrowserTeambitionBinding>(TEAMBITION_IPC_CHANNELS.UPDATE_STATUS, workspaceRoot, bindingId, status),
    syncProgress: (workspaceRoot: string, bindingId: string, progress: number): Promise<BrowserTeambitionBinding> =>
      invokeTyped<BrowserTeambitionBinding>(TEAMBITION_IPC_CHANNELS.SYNC_PROGRESS, workspaceRoot, bindingId, progress),
    retrySync: (workspaceRoot: string, bindingId: string): Promise<BrowserTeambitionBinding> =>
      invokeTyped<BrowserTeambitionBinding>(TEAMBITION_IPC_CHANNELS.RETRY_SYNC, workspaceRoot, bindingId),
  },

  // ===== Projects / Tasks Conductor =====
  getProjects: (workspaceRoot: string) => ipcRenderer.invoke(PROJECT_IPC_CHANNELS.GET, workspaceRoot),
  getProject: (workspaceRoot: string, idOrSlug: string) => ipcRenderer.invoke(PROJECT_IPC_CHANNELS.GET_ONE, workspaceRoot, idOrSlug),
  createProject: (workspaceRoot: string, input: CreateProjectInput) => ipcRenderer.invoke(PROJECT_IPC_CHANNELS.CREATE, workspaceRoot, input),
  updateProject: (workspaceRoot: string, slug: string, patch: UpdateProjectInput) => ipcRenderer.invoke(PROJECT_IPC_CHANNELS.UPDATE, workspaceRoot, slug, patch),
  deleteProject: (workspaceRoot: string, slug: string) => ipcRenderer.invoke(PROJECT_IPC_CHANNELS.DELETE, workspaceRoot, slug),
  analyzeProjectDeleteImpact: (workspaceRoot: string, idOrSlug: string) => ipcRenderer.invoke(PROJECT_IPC_CHANNELS.ANALYZE_DELETE_IMPACT, workspaceRoot, idOrSlug),
  listProjectAssets: (workspaceRoot: string, slug: string) => ipcRenderer.invoke(PROJECT_IPC_CHANNELS.LIST_ASSETS, workspaceRoot, slug),
  uploadProjectAsset: (workspaceRoot: string, slug: string, input: UploadProjectAssetInput) => ipcRenderer.invoke(PROJECT_IPC_CHANNELS.UPLOAD_ASSET, workspaceRoot, slug, input),
  deleteProjectAsset: (workspaceRoot: string, slug: string, filename: string) => ipcRenderer.invoke(PROJECT_IPC_CHANNELS.DELETE_ASSET, workspaceRoot, slug, filename),
  validateTask: (yaml: string) => ipcRenderer.invoke(TASK_IPC_CHANNELS.VALIDATE, yaml),
  createTask: (workspaceRoot: string, workspaceId: string, request: TaskCreateRequest) => ipcRenderer.invoke(TASK_IPC_CHANNELS.CREATE, workspaceRoot, workspaceId, request),
  generateTask: (workspaceRoot: string, workspaceId: string, request: TaskGenerateRequest) => ipcRenderer.invoke(TASK_IPC_CHANNELS.GENERATE, workspaceRoot, workspaceId, request),
  runTask: (workspaceRoot: string, workspaceId: string, slug: string, options?: TaskRunOptions) => ipcRenderer.invoke(TASK_IPC_CHANNELS.RUN, workspaceRoot, workspaceId, slug, options),
  pauseTask: (workspaceRoot: string, workspaceId: string, slug: string, runId: string) => ipcRenderer.invoke(TASK_IPC_CHANNELS.PAUSE, workspaceRoot, workspaceId, slug, runId),
  resumeTask: (workspaceRoot: string, workspaceId: string, slug: string, runId: string) => ipcRenderer.invoke(TASK_IPC_CHANNELS.RESUME, workspaceRoot, workspaceId, slug, runId),
  stopKanbanTask: (workspaceRoot: string, workspaceId: string, slug: string, runId: string) => ipcRenderer.invoke(TASK_IPC_CHANNELS.STOP, workspaceRoot, workspaceId, slug, runId),
  getTask: (workspaceRoot: string, slug: string) => ipcRenderer.invoke(TASK_IPC_CHANNELS.GET, workspaceRoot, slug),
  listTasks: (workspaceRoot: string) => ipcRenderer.invoke(TASK_IPC_CHANNELS.LIST, workspaceRoot),
  getTaskResults: (workspaceRoot: string, slug: string, runId?: string) => ipcRenderer.invoke(TASK_IPC_CHANNELS.GET_RESULTS, workspaceRoot, slug, runId),
  analyzeTaskDeleteImpact: (workspaceRoot: string, slug: string) => ipcRenderer.invoke(TASK_IPC_CHANNELS.ANALYZE_DELETE_IMPACT, workspaceRoot, slug),
  sendSessionCommand: (sessionId: string, command: SessionKanbanCommand) => ipcRenderer.invoke(SESSION_COMMAND_CHANNEL, sessionId, command),
  onProjectsChanged: (callback: (payload: ProjectsChangedEventPayload) => void) => {
    const listener = (_event: unknown, payload: ProjectsChangedEventPayload): void => callback(payload)
    ipcRenderer.on(PROJECT_IPC_CHANNELS.CHANGED, listener)
    return () => { ipcRenderer.removeListener(PROJECT_IPC_CHANNELS.CHANGED, listener) }
  },
  onTaskGenerated: (callback: (payload: TaskGeneratedEventPayload) => void) => {
    const listener = (_event: unknown, payload: TaskGeneratedEventPayload): void => callback(payload)
    ipcRenderer.on(TASK_IPC_CHANNELS.GENERATED, listener)
    return () => { ipcRenderer.removeListener(TASK_IPC_CHANNELS.GENERATED, listener) }
  },

  // ===== 任务 / 日程（Planning）=====
  openPlanningWindow: () => ipcRenderer.invoke(PLANNING_IPC_CHANNELS.OPEN_WINDOW),
  startTodoAgent: (input: StartTodoAgentInput) => ipcRenderer.invoke(PLANNING_IPC_CHANNELS.START_TODO_AGENT, input),
  listTodos: (scope?: PlanningWorkspaceScope, workspaceId?: string) => ipcRenderer.invoke(PLANNING_IPC_CHANNELS.LIST_TODOS, scope, workspaceId),
  createTodo: (input: CreateTodoInput) => ipcRenderer.invoke(PLANNING_IPC_CHANNELS.CREATE_TODO, input),
  updateTodo: (input: UpdateTodoInput) => ipcRenderer.invoke(PLANNING_IPC_CHANNELS.UPDATE_TODO, input),
  deleteTodo: (id: string) => ipcRenderer.invoke(PLANNING_IPC_CHANNELS.DELETE_TODO, id),
  listCalendarEvents: (scope?: PlanningWorkspaceScope, workspaceId?: string) => ipcRenderer.invoke(PLANNING_IPC_CHANNELS.LIST_CALENDAR_EVENTS, scope, workspaceId),
  createCalendarEvent: (input: CreateCalendarEventInput) => ipcRenderer.invoke(PLANNING_IPC_CHANNELS.CREATE_CALENDAR_EVENT, input),
  updateCalendarEvent: (input: UpdateCalendarEventInput) => ipcRenderer.invoke(PLANNING_IPC_CHANNELS.UPDATE_CALENDAR_EVENT, input),
  deleteCalendarEvent: (id: string) => ipcRenderer.invoke(PLANNING_IPC_CHANNELS.DELETE_CALENDAR_EVENT, id),
  listPlanningGroups: (scope: PlanningGroupScope) => ipcRenderer.invoke(PLANNING_IPC_CHANNELS.LIST_GROUPS, scope),
  createPlanningGroup: (input: CreatePlanningGroupInput) => ipcRenderer.invoke(PLANNING_IPC_CHANNELS.CREATE_GROUP, input),
  updatePlanningGroup: (input: UpdatePlanningGroupInput) => ipcRenderer.invoke(PLANNING_IPC_CHANNELS.UPDATE_GROUP, input),
  deletePlanningGroup: (scope: PlanningGroupScope, id: string) => ipcRenderer.invoke(PLANNING_IPC_CHANNELS.DELETE_GROUP, scope, id),
  listPlanningTags: () => ipcRenderer.invoke(PLANNING_IPC_CHANNELS.LIST_TAGS),
  listActivePlanningReminders: () => ipcRenderer.invoke(PLANNING_IPC_CHANNELS.LIST_ACTIVE_REMINDERS),
  acknowledgePlanningReminder: (id: string) => ipcRenderer.invoke(PLANNING_IPC_CHANNELS.ACKNOWLEDGE_REMINDER, id),
  snoozePlanningReminder: (input: SnoozePlanningReminderInput) => ipcRenderer.invoke(PLANNING_IPC_CHANNELS.SNOOZE_REMINDER, input),
  onPlanningRemindersDue: (callback: (reminders: ActivePlanningReminder[]) => void) => {
    const listener = (_: Electron.IpcRendererEvent, reminders: ActivePlanningReminder[]): void => callback(reminders)
    ipcRenderer.on(PLANNING_IPC_CHANNELS.REMINDER_DUE, listener)
    return () => { ipcRenderer.removeListener(PLANNING_IPC_CHANNELS.REMINDER_DUE, listener) }
  },
  onPlanningChanged: (callback: (change: PlanningChange) => void) => {
    const listener = (_: Electron.IpcRendererEvent, change: PlanningChange): void => callback(change)
    ipcRenderer.on(PLANNING_IPC_CHANNELS.CHANGED, listener)
    return () => { ipcRenderer.removeListener(PLANNING_IPC_CHANNELS.CHANGED, listener) }
  },
  onPlanningAgentOperation: (callback: (operation: PlanningAgentOperation) => void) => {
    const listener = (_: Electron.IpcRendererEvent, operation: PlanningAgentOperation): void => callback(operation)
    ipcRenderer.on(PLANNING_IPC_CHANNELS.AGENT_OPERATION, listener)
    return () => { ipcRenderer.removeListener(PLANNING_IPC_CHANNELS.AGENT_OPERATION, listener) }
  },
  onTodoAgentSessionReady: (callback: (activation: TodoAgentSessionActivation) => void) => {
    const listener = (_: Electron.IpcRendererEvent, activation: TodoAgentSessionActivation): void => callback(activation)
    ipcRenderer.on(PLANNING_IPC_CHANNELS.TODO_AGENT_SESSION_READY, listener)
    return () => { ipcRenderer.removeListener(PLANNING_IPC_CHANNELS.TODO_AGENT_SESSION_READY, listener) }
  },
  getPlanningNativeSyncStatus: () => ipcRenderer.invoke(PLANNING_IPC_CHANNELS.GET_NATIVE_SYNC_STATUS),
  requestPlanningNativeSyncAccess: (entity: PlanningNativeSyncEntity) => ipcRenderer.invoke(PLANNING_IPC_CHANNELS.REQUEST_NATIVE_SYNC_ACCESS, entity),
  openPlanningNativeSyncPrivacySettings: (entity: PlanningNativeSyncEntity) => ipcRenderer.invoke(PLANNING_IPC_CHANNELS.OPEN_NATIVE_SYNC_PRIVACY_SETTINGS, entity),
  listPlanningNativeSyncTargets: (entity: PlanningNativeSyncEntity) => ipcRenderer.invoke(PLANNING_IPC_CHANNELS.LIST_NATIVE_SYNC_TARGETS, entity),
  listPlanningNativeConnectionTargets: (entity: PlanningNativeSyncEntity) => ipcRenderer.invoke(PLANNING_IPC_CHANNELS.LIST_NATIVE_CONNECTION_TARGETS, entity),
  listPlanningNativeConnections: (entity?: PlanningNativeSyncEntity) => ipcRenderer.invoke(PLANNING_IPC_CHANNELS.LIST_NATIVE_CONNECTIONS, entity),
  connectPlanningNativeConnection: (input: ConnectPlanningNativeConnectionInput) => ipcRenderer.invoke(PLANNING_IPC_CHANNELS.CONNECT_NATIVE_CONNECTION, input),
  disconnectPlanningNativeConnection: (id: string) => ipcRenderer.invoke(PLANNING_IPC_CHANNELS.DISCONNECT_NATIVE_CONNECTION, id),
  listPlanningNativeSyncConflicts: () => ipcRenderer.invoke(PLANNING_IPC_CHANNELS.LIST_NATIVE_SYNC_CONFLICTS),
  resolvePlanningNativeSyncConflict: (input: ResolvePlanningNativeSyncConflictInput) => ipcRenderer.invoke(PLANNING_IPC_CHANNELS.RESOLVE_NATIVE_SYNC_CONFLICT, input),
  listPlanningSyncProfiles: () => ipcRenderer.invoke(PLANNING_IPC_CHANNELS.LIST_SYNC_PROFILES),
  savePlanningSyncProfile: (input: SavePlanningSyncProfileInput) => ipcRenderer.invoke(PLANNING_IPC_CHANNELS.SAVE_SYNC_PROFILE, input),

  // ===== CodeClaw 桌面助手 =====
  codeClaw: {
    onState: (callback: (state: CodeClawState) => void) => {
      const listener = (_: Electron.IpcRendererEvent, state: CodeClawState): void => callback(state)
      ipcRenderer.on(CODECLAW_IPC_CHANNELS.STATE, listener)
      return () => { ipcRenderer.removeListener(CODECLAW_IPC_CHANNELS.STATE, listener) }
    },
    onCursor: (callback: (point: { x: number; y: number }) => void) => {
      const listener = (_: Electron.IpcRendererEvent, point: { x: number; y: number }): void => callback(point)
      ipcRenderer.on(CODECLAW_IPC_CHANNELS.CURSOR, listener)
      return () => { ipcRenderer.removeListener(CODECLAW_IPC_CHANNELS.CURSOR, listener) }
    },
    move: (x: number, y: number) =>
      ipcRenderer.invoke(CODECLAW_IPC_CHANNELS.MOVE, { x, y }),
    openMainWindow: () =>
      ipcRenderer.invoke(CODECLAW_IPC_CHANNELS.OPEN_MAIN_WINDOW),
    openSession: (sessionId?: string) =>
      ipcRenderer.invoke(CODECLAW_IPC_CHANNELS.OPEN_SESSION, sessionId),
    markSessionViewed: (sessionId: string) =>
      ipcRenderer.invoke(CODECLAW_IPC_CHANNELS.MARK_SESSION_VIEWED, sessionId),
    setTheme: (themeId: CodeClawThemeId) =>
      ipcRenderer.invoke(CODECLAW_IPC_CHANNELS.SET_THEME, themeId),
    setMiniMode: (req: CodeClawMiniRequest) =>
      ipcRenderer.invoke(CODECLAW_IPC_CHANNELS.SET_MINI_MODE, req),
    peekMini: (req: CodeClawPeekRequest) =>
      ipcRenderer.invoke(CODECLAW_IPC_CHANNELS.PEEK_MINI, req),
    setSize: (size: CodeClawSize) =>
      ipcRenderer.invoke(CODECLAW_IPC_CHANNELS.SET_SIZE, size),
    setDnd: (dnd: boolean) =>
      ipcRenderer.invoke(CODECLAW_IPC_CHANNELS.SET_DND, dnd),
    setSound: (enabled: boolean) =>
      ipcRenderer.invoke(CODECLAW_IPC_CHANNELS.SET_SOUND, enabled),
    openContextMenu: () =>
      ipcRenderer.invoke(CODECLAW_IPC_CHANNELS.OPEN_CONTEXT_MENU),
  },

  // ===== 内嵌浏览器（synara 移植） =====
  browser: {
    open: (threadId: string, url?: string, newTab?: boolean) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.open, { threadId, url, newTab }),
    close: (threadId: string) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.close, { threadId }),
    closeTab: (threadId: string, tabId?: string) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.closeTab, { threadId, tabId }),
    selectTab: (threadId: string, tabId: string) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.selectTab, { threadId, tabId }),
    hide: (threadId: string) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.hide, { threadId }),
    getState: (threadId: string) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.getState, { threadId }),
    setBounds: (threadId: string, bounds: BrowserPanelBounds | null) => ipcRenderer.send(BROWSER_IPC_CHANNELS.setBounds, { threadId, bounds }),
    navigate: (threadId: string, url: string) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.navigate, { threadId, url }),
    back: (threadId: string) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.back, { threadId }),
    forward: (threadId: string) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.forward, { threadId }),
    reload: (threadId: string) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.reload, { threadId }),
    onStateChange: (callback: (state: ThreadBrowserState) => void) => {
      const listener = (_: Electron.IpcRendererEvent, state: ThreadBrowserState): void => callback(state)
      ipcRenderer.on(BROWSER_IPC_CHANNELS.stateEvent, listener)
      return () => { ipcRenderer.removeListener(BROWSER_IPC_CHANNELS.stateEvent, listener) }
    },
    getAnnotations: (threadId: string) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.getAnnotations, { threadId }),
    clearAnnotations: (threadId: string) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.clearAnnotations, { threadId }),
    setAnnotationInteractive: (threadId: string, interactive: boolean) => ipcRenderer.invoke(BROWSER_IPC_CHANNELS.setAnnotationInteractive, { threadId, interactive }),
    onAnnotationCommitted: (callback: (threadId: string, annotation: { id: string; ref: string; role?: string; name?: string; selector?: string; comment: string }) => void) => {
      const listener = (_: Electron.IpcRendererEvent, payload: { threadId: string; annotation: { id: string; ref: string; role?: string; name?: string; selector?: string; comment: string } }): void => callback(payload.threadId, payload.annotation)
      ipcRenderer.on(BROWSER_IPC_CHANNELS.annotationCommitted, listener)
      return () => { ipcRenderer.removeListener(BROWSER_IPC_CHANNELS.annotationCommitted, listener) }
    },
  },
}

const myyodaWindowKind = process.argv
  .find((arg) => arg.startsWith('--myyoda-window='))
  ?.slice('--myyoda-window='.length)

// 将 API 暴露到渲染进程的 window 对象上
contextBridge.exposeInMainWorld('electronAPI', electronAPI)
contextBridge.exposeInMainWorld('__myyodaWindowKind', myyodaWindowKind)

// 扩展 Window 接口的类型定义
declare global {
  interface Window {
    electronAPI: ElectronAPI
    __myyodaWindowKind?: string
  }
}
