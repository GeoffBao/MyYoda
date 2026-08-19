/**
 * 内置连接器「测试连接」实现（表驱动）
 *
 * 每个连接器一个轻量验证请求（等价于对应官方 API 的「whoami / 最小查询」），
 * 用当前保存的凭据真实调用，返回成功/失败与可读原因。SQLite 走本地文件
 * 打开验证。与「测试」按钮（ConnectorCredentials）配套。
 */

import { getToolCredentials } from '../chat-tool-config'
import { getFetchFn } from '../proxy-fetch'
import { getEffectiveProxyUrl } from '../proxy-settings-service'

const TEST_TIMEOUT_MS = 15_000

export interface ConnectorTestResult {
  success: boolean
  message: string
}

interface ConnectorTestSpec {
  /** 构造请求（返回 null 表示凭据缺失，由调用方统一提示） */
  build: (credentials: Record<string, string | undefined>) => { url: string; headers: Record<string, string>; method?: 'GET' | 'POST'; body?: string } | null
  /** 成功判定（默认 2xx 即成功） */
  ok?: (status: number, text: string) => boolean
  /** 成功文案 */
  successMessage: string
  /** 401/403 时的提示 */
  authErrorMessage: string
}

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` }
}

/** 连接器测试规格表（导出供单测） */
export const CONNECTOR_TEST_SPECS: Record<string, ConnectorTestSpec> = {
  github: {
    build: (c) => (c.token ? { url: 'https://api.github.com/user', headers: { ...bearer(c.token), Accept: 'application/vnd.github+json' } } : null),
    successMessage: 'GitHub Token 有效',
    authErrorMessage: 'Token 无效或已过期，请检查 GitHub Personal Access Token',
  },
  gitlab: {
    build: (c) => {
      if (!c.token) return null
      const base = (c.apiUrl?.trim() || 'https://gitlab.com/api/v4').replace(/\/+$/, '')
      return { url: `${base}/user`, headers: bearer(c.token) }
    },
    successMessage: 'GitLab Token 有效',
    authErrorMessage: 'Token 无效或已过期，请检查 GitLab Personal Access Token（自建实例还需确认 API 地址）',
  },
  notion: {
    build: (c) => (c.token
      ? { url: 'https://api.notion.com/v1/users/me', headers: { ...bearer(c.token), 'Notion-Version': '2022-06-28' } }
      : null),
    successMessage: 'Notion Token 有效',
    authErrorMessage: 'Token 无效或已过期，请检查 Notion Token（并确认目标页面已 Share 给集成）',
  },
  figma: {
    build: (c) => (c.apiKey ? { url: 'https://api.figma.com/v1/me', headers: { 'X-Figma-Token': c.apiKey } } : null),
    successMessage: 'Figma API Key 有效',
    authErrorMessage: 'API Key 无效或已过期，请检查 Figma Personal Access Token',
  },
  'brave-search': {
    build: (c) => (c.apiKey
      ? { url: 'https://api.search.brave.com/res/v1/web/search?q=test&count=1', headers: { 'X-Subscription-Token': c.apiKey, Accept: 'application/json' } }
      : null),
    successMessage: 'Brave Search API Key 有效',
    authErrorMessage: 'API Key 无效或已过期，请检查 Brave Search API Key',
  },
  exa: {
    build: (c) => (c.apiKey
      ? {
          url: 'https://api.exa.ai/search',
          method: 'POST',
          headers: { 'x-api-key': c.apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: 'test connection', numResults: 1 }),
        }
      : null),
    successMessage: 'Exa API Key 有效',
    authErrorMessage: 'API Key 无效或已过期，请检查 Exa API Key',
  },
  browserbase: {
    build: (c) => (c.apiKey
      ? { url: 'https://api.browserbase.com/v1/projects', headers: { 'X-BB-API-Key': c.apiKey } }
      : null),
    successMessage: 'Browserbase API Key 有效',
    authErrorMessage: 'API Key 无效或已过期，请检查 Browserbase API Key 与 Project ID',
  },
}

/** SQLite 本地连接测试（打开 readOnly + SELECT 1） */
async function testSqliteConnection(dbPath: string): Promise<ConnectorTestResult> {
  const { DatabaseSync } = require('node:sqlite') as {
    DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => {
      prepare(sql: string): { get(...params: unknown[]): unknown }
      close(): void
    }
  }
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true })
    try {
      db.prepare('SELECT 1').get()
      return { success: true, message: '数据库连接成功（只读模式）' }
    } finally {
      db.close()
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { success: false, message: `无法打开数据库：${detail.slice(0, 300)}` }
  }
}

/** 执行单个连接器测试（fetchFn 可注入便于单测） */
export async function runConnectorTest(
  spec: ConnectorTestSpec,
  credentials: Record<string, string | undefined>,
  fetchFn: typeof globalThis.fetch,
): Promise<ConnectorTestResult> {
  const request = spec.build(credentials)
  if (!request) return { success: false, message: '请先填写全部必填凭据' }

  try {
    const response = await fetchFn(request.url, {
      method: request.method ?? 'GET',
      headers: request.headers,
      body: request.body,
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    })
    const text = await response.text().catch(() => '')
    if (spec.ok) {
      const ok = spec.ok(response.status, text)
      return ok
        ? { success: true, message: spec.successMessage }
        : { success: false, message: spec.authErrorMessage }
    }
    if (response.status >= 200 && response.status < 300) {
      return { success: true, message: spec.successMessage }
    }
    if (response.status === 401 || response.status === 403) {
      return { success: false, message: spec.authErrorMessage }
    }
    return { success: false, message: `请求失败（HTTP ${response.status}）：${text.slice(0, 200) || response.statusText}` }
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      return { success: false, message: '请求超时，请检查网络或代理设置' }
    }
    const detail = error instanceof Error ? error.message : String(error)
    return { success: false, message: `连接失败：${detail.slice(0, 300)}` }
  }
}

/** 测试内置连接器连接（凭据来自 chat-tools.json toolCredentials[<id>]） */
export async function testBuiltinConnectorConnection(connectorId: string): Promise<ConnectorTestResult> {
  const credentials = getToolCredentials(connectorId) as Record<string, string | undefined>

  if (connectorId === 'sqlite') {
    const dbPath = (credentials.dbPath ?? '').trim()
    if (!dbPath) return { success: false, message: '请先填写数据库文件路径' }
    return testSqliteConnection(dbPath)
  }

  const spec = CONNECTOR_TEST_SPECS[connectorId]
  if (!spec) return { success: false, message: '该连接器暂不支持连接测试' }

  const fetchFn = getFetchFn(await getEffectiveProxyUrl())
  return runConnectorTest(spec, credentials, fetchFn)
}
