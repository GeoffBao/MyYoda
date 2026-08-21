/**
 * 外部 stdio MCP 连接器通用注入器（npx 启动）。
 *
 * 用于 Phase 2 接入的一批官方 MCP server（GitHub / GitLab / Notion / Figma /
 * Brave Search / Exa / Browserbase），全部是「npx 拉包 + 环境变量凭据」的
 * stdio server，与 chrome-devtools / wecom 同构，但凭据字段各不相同，
 * 因此收敛为一个表驱动注入器，避免每个连接器复制一份样板代码。
 *
 * 凭据统一存 chat-tools.json 的 toolCredentials[<id>]，由 UI 写入；
 * 未配置凭据时连接器默认关闭（DEFAULT_DISABLED_IDS），不会注入。
 */

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

/** 单个外部 npx 连接器规格 */
export interface NpxConnectorSpec {
  /** 内置 MCP id（= 凭据键 = default-mcp.json id） */
  id: string
  /** npm 包名（scoped 官方包） */
  npmPackage: string
  /** npx 追加参数（如 figma 的 --stdio） */
  extraArgs?: string[]
  /** 凭据键 → 环境变量名映射（toolCredentials[id] 的字段注入为 env） */
  envMap?: Record<string, string>
  /** 启动超时秒数（默认 10；首次 npx 拉包较慢） */
  startupTimeoutSec?: number
}

/** 外部 npx 连接器规格表（Phase 2 接入的 7 个官方 MCP server） */
export const NPX_CONNECTOR_SPECS: NpxConnectorSpec[] = [
  {
    id: 'github',
    npmPackage: '@modelcontextprotocol/server-github',
    envMap: { token: 'GITHUB_PERSONAL_ACCESS_TOKEN' },
  },
  {
    id: 'gitlab',
    npmPackage: '@modelcontextprotocol/server-gitlab',
    envMap: {
      token: 'GITLAB_PERSONAL_ACCESS_TOKEN',
      apiUrl: 'GITLAB_API_URL',
    },
  },
  {
    id: 'notion',
    npmPackage: '@notionhq/notion-mcp-server',
    envMap: { token: 'NOTION_TOKEN' },
  },
  {
    id: 'figma',
    npmPackage: 'figma-developer-mcp',
    extraArgs: ['--stdio'],
    envMap: { apiKey: 'FIGMA_API_KEY' },
  },
  {
    id: 'brave-search',
    npmPackage: '@modelcontextprotocol/server-brave-search',
    envMap: { apiKey: 'BRAVE_API_KEY' },
  },
  {
    id: 'exa',
    npmPackage: 'exa-mcp-server',
    envMap: { apiKey: 'EXA_API_KEY' },
  },
  {
    id: 'browserbase',
    npmPackage: '@browserbasehq/mcp',
    envMap: {
      apiKey: 'BROWSERBASE_API_KEY',
      projectId: 'BROWSERBASE_PROJECT_ID',
    },
  },
]

/** 是否已为指定连接器配置凭据（catalog 可用性判断用） */
export function hasNpxConnectorCredentials(spec: NpxConnectorSpec): boolean {
  if (!spec.envMap) return true
  const credentials = getToolCredentials(spec.id)
  const keys = Object.keys(spec.envMap)
  if (keys.length === 0) return true
  // 所有声明了 env 映射的字段都非空才视为已配置
  return keys.every((key) => Boolean((credentials as Record<string, string | undefined>)[key]?.trim()))
}

export function injectNpxConnectorMcpServer(
  spec: NpxConnectorSpec,
  mcpServers: Record<string, Record<string, unknown>>,
  runtimeEnv?: Record<string, string | undefined>,
): void {
  const name = getBuiltinMcpName(spec.id)
  if (mcpServers[name]) return

  const env: Record<string, string> = {
    ...(process.env.PATH && { PATH: process.env.PATH }),
    ...(process.env.HOME && { HOME: process.env.HOME }),
    ...(process.env.USERPROFILE && { USERPROFILE: process.env.USERPROFILE }),
    ...(process.env.TMPDIR && { TMPDIR: process.env.TMPDIR }),
    ...(process.env.TEMP && { TEMP: process.env.TEMP }),
    ...(process.env.TMP && { TMP: process.env.TMP }),
    ...getProxyEnv(runtimeEnv),
  }
  if (spec.envMap) {
    const credentials = getToolCredentials(spec.id) as Record<string, string | undefined>
    for (const [credKey, envKey] of Object.entries(spec.envMap)) {
      const value = credentials[credKey]?.trim()
      if (value) env[envKey] = value
    }
  }

  mcpServers[name] = {
    type: 'stdio',
    command: npxCommand(),
    args: ['-y', spec.npmPackage, ...(spec.extraArgs ?? [])],
    // 外部连接器是可选增强：npx 未安装、首次拉包失败、凭据无效等都不阻塞主 Agent 会话。
    required: false,
    startup_timeout_sec: spec.startupTimeoutSec ?? 10,
    env,
    timeout: 60,
  }
}
