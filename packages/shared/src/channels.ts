/**
 * IPC 通道常量 — 轻量入口
 *
 * 专供 preload 等不需要完整 @myyoda/shared 的模块使用。
 * 仅导出 IPC 通道常量，不引入 projects/、tasks/ 等重依赖。
 *
 * 每个常量引用自各自的类型定义文件，这些文件仅包含纯常量 + type-only 导入，
 * 不会拖入 Node.js 核心模块（fs/path/crypto）或第三方包（zod/yaml）。
 */

export { IPC_CHANNELS } from './types/runtime'
export { CHANNEL_IPC_CHANNELS } from './types/channel'
export { CHAT_IPC_CHANNELS } from './types/chat'
export { AGENT_IPC_CHANNELS } from './types/agent'
export { ENVIRONMENT_IPC_CHANNELS } from './types/environment'
export { INSTALLER_IPC_CHANNELS } from './types/installer'
export { PROXY_IPC_CHANNELS } from './types/proxy'
export { GITHUB_RELEASE_IPC_CHANNELS } from './types/github'
export { SYSTEM_PROMPT_IPC_CHANNELS } from './types/system-prompt'
export { CHAT_TOOL_IPC_CHANNELS } from './types/chat-tool'
export { FEISHU_IPC_CHANNELS } from './types/feishu'
export { DINGTALK_IPC_CHANNELS } from './types/dingtalk'
export { WECHAT_IPC_CHANNELS } from './types/wechat'
export { AUTOMATION_IPC_CHANNELS } from './types/automation'
export { EXPERT_IPC_CHANNELS } from './experts/channels'
export {
  LABEL_IPC_CHANNELS,
  PROJECT_IPC_CHANNELS,
  TASK_IPC_CHANNELS,
  SESSION_COMMAND_CHANNEL,
  SESSION_GROUP_IPC_CHANNELS,
} from './protocol/channels'
