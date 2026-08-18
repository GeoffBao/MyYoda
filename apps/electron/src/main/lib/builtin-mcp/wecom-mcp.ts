/**
 * 企业微信 MCP builtin server。
 *
 * 基于官方 wecom-cli（npm @wecom/cli）的 stdio MCP server 模式
 * （`wecom-cli mcp-server --transport stdio`），让 Agent 直接操作企业微信：
 * 消息、文档、智能表格、日程、会议、待办、通讯录等。
 *
 * 凭据两种来源（互不冲突）：
 * - MyYoda 设置里填写的 Bot ID / Secret（toolCredentials['wecom']）→ 注入为环境变量
 * - 用户已在终端执行过 `wecom-cli auth init`（扫码/手动），CLI 复用本地加密凭证
 *
 * 依赖 @wecom/cli 的 mcp-server 命令（官方已发布路线中；命令缺失时启动静默失败，
 * 不阻塞 Agent 会话），因此按 optional + 短启动超时注入。
 */

import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { getBuiltinMcpName } from './baseline'
import { getToolCredentials } from '../chat-tool-config'

function npxCommand(): string {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx'
}

const PROXY_ENV_KEYS = new Set([
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
  'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
])

function getProxyEnv(runtimeEnv?: Record<string, string | undefined>): Record<string, string> {
  if (!runtimeEnv) return {}
  const filtered: Record<string, string> = {}
  for (const [key, value] of Object.entries(runtimeEnv)) {
    if (PROXY_ENV_KEYS.has(key) && value !== undefined) {
      filtered[key] = value
    }
  }
  return filtered
}

/** wecom-cli 默认配置目录下的机器人凭证文件（auth init 后生成） */
function getWecomEncryptedCredentialPath(): string {
  const configDir = process.env.WECOM_CLI_CONFIG_DIR ?? join(homedir(), '.config', 'wecom')
  return join(configDir, 'bot.enc')
}

/**
 * 是否已具备可用凭据：
 * - MyYoda 设置里配置了 Bot ID + Secret，或
 * - 本机已通过 `wecom-cli auth init` 保存过机器人凭证
 */
export function hasWecomCredentials(): boolean {
  const credentials = getToolCredentials('wecom')
  if (credentials.botId && credentials.botSecret) return true
  return existsSync(getWecomEncryptedCredentialPath())
}

export function injectWecomMcpServer(
  mcpServers: Record<string, Record<string, unknown>>,
  runtimeEnv?: Record<string, string | undefined>,
): void {
  const name = getBuiltinMcpName('wecom')
  if (mcpServers[name]) return

  const credentials = getToolCredentials('wecom')
  const env: Record<string, string> = {
    ...(process.env.PATH && { PATH: process.env.PATH }),
    ...(process.env.HOME && { HOME: process.env.HOME }),
    ...(process.env.USERPROFILE && { USERPROFILE: process.env.USERPROFILE }),
    ...(process.env.TMPDIR && { TMPDIR: process.env.TMPDIR }),
    ...(process.env.TEMP && { TEMP: process.env.TEMP }),
    ...(process.env.TMP && { TMP: process.env.TMP }),
    ...getProxyEnv(runtimeEnv),
  }
  // 设置里填了凭据则优先注入为环境变量；未填时 CLI 会回退到本地 auth init 凭证
  if (credentials.botId) env.WECOM_CLI_BOT_ID = credentials.botId
  if (credentials.botSecret) env.WECOM_CLI_BOT_SECRET = credentials.botSecret

  mcpServers[name] = {
    type: 'stdio',
    command: npxCommand(),
    args: ['-y', '@wecom/cli@latest', 'mcp-server', '--transport', 'stdio'],
    // 企业微信是可选的办公能力增强：@wecom/cli 未安装、版本暂缺 mcp-server 命令
    // 或首次下载 npm 包失败都不应阻塞主 Agent 会话。
    required: false,
    // 首次使用需下载 npm 包，给足启动时间；失败由后续会话重试。
    startup_timeout_sec: 10,
    env,
    timeout: 60,
  }
}
