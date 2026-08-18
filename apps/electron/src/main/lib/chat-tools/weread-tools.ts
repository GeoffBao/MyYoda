/**
 * 微信读书工具模块（Agent 模式）
 *
 * 通过微信读书官方 Agent API Gateway（https://i.weread.qq.com/api/agent/gateway）
 * 暴露只读工具：搜索书籍、书架、阅读进度、划线/笔记、阅读统计、推荐。
 * 认证：Authorization: Bearer $WEREAD_API_KEY（wrk- 开头，从官方页面登录获取）。
 *
 * 对齐官方 Skill（Tencent/WeChatReading v1.0.4）的调用规范：
 * - 业务参数与 api_name、skill_version 平铺在同一层
 * - 每次请求必须带 skill_version；回包出现 upgrade_info 时必须提示用户升级
 * - 分页接口用游标（lastSort），不支持 offset/limit
 *
 * 凭据存 chat-tools.json toolCredentials['weread']，由 buildPiBuiltinTools 注入。
 */

import { Type } from 'typebox'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { AgentToolResult } from '@earendil-works/pi-agent-core'

/** 微信读书官方 Agent Gateway */
const WEREAD_GATEWAY = 'https://i.weread.qq.com/api/agent/gateway'

/** 对齐官方 Skill 的版本号（每次请求必须携带） */
const SKILL_VERSION = '1.0.4'

/** 请求超时（毫秒） */
const REQUEST_TIMEOUT_MS = 15_000

/** 游标分页最大循环页数（防止异常时死循环） */
const MAX_PAGINATION_PAGES = 10

/** 统一返回 JSON 工具结果 */
function jsonResult(data: unknown): AgentToolResult<unknown> {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    details: data,
  } as AgentToolResult<unknown>
}

/** 调用 gateway；返回业务数据（若含 upgrade_info 则合并返回，不抛错） */
async function gatewayCall(apiKey: string, apiName: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const resp = await fetch(WEREAD_GATEWAY, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ api_name: apiName, skill_version: SKILL_VERSION, ...params }),
      signal: controller.signal,
    })

    if (resp.status === 401 || resp.status === 403) {
      throw new Error('微信读书 API Key 无效或已过期（OAuth Token 会过期），请重新生成 WEREAD_API_KEY 并更新配置')
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new Error(`微信读书请求失败（HTTP ${resp.status}）：${text.slice(0, 300) || '无响应内容'}`)
    }

    const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>
    if (data.errcode && data.errcode !== 0) {
      throw new Error(`微信读书接口错误（${apiName}）：${String(data.errmsg ?? data.errcode)}`)
    }
    // 官方规范：出现 upgrade_info 必须立即暂停并提示升级
    if (data.upgrade_info) {
      const info = data.upgrade_info as { message?: string }
      return {
        ...data,
        upgrade_notice: `微信读书官方 Skill 需要升级：${info?.message ?? '请按官方指引升级后重试'}`,
      }
    }
    return data
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('微信读书请求超时，请稍后重试')
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/** 游标分页拉全（hasMore 循环），供 /user/notebooks 等接口使用 */
async function paginateAll(
  apiKey: string,
  apiName: string,
  firstParams: Record<string, unknown>,
  cursorField: string,
  itemsField: string,
): Promise<Record<string, unknown>> {
  if (!apiKey.trim()) {
    throw new Error('微信读书 API Key 未配置，请在「API Tab → 微信读书」填写（wrk- 开头，官方页面获取）')
  }
  const all: unknown[] = []
  let cursor: unknown = undefined
  let page = 0
  let last: Record<string, unknown> = {}

  do {
    if (++page > MAX_PAGINATION_PAGES) break
    const params: Record<string, unknown> = { ...firstParams }
    if (cursor !== undefined) params[cursorField] = cursor
    last = (await gatewayCall(apiKey, apiName, params)) as Record<string, unknown>
    const items = (last[itemsField] as unknown[]) ?? []
    all.push(...items)
    cursor = items.length > 0 ? (items[items.length - 1] as { sort?: unknown }).sort : undefined
  } while (last.hasMore === 1 && cursor !== undefined)

  return { ...last, [itemsField]: all }
}

/**
 * 构建微信读书工具集（Pi ToolDefinition）。
 * 注入条件：内置 MCP 开关开启；Key 由 getApiKey 回调提供（支持运行中改配）。
 */
export function buildWereadTools(
  sdk: {
    defineTool: (def: Parameters<typeof import('@earendil-works/pi-coding-agent')['defineTool']>[0]) => ToolDefinition
  },
  getApiKey: () => string,
): ToolDefinition[] {
  const call = (apiName: string, params: Record<string, unknown> = {}): Promise<unknown> => {
    const apiKey = getApiKey().trim()
    if (!apiKey) throw new Error('微信读书 API Key 未配置，请在「API Tab → 微信读书」填写（wrk- 开头，官方页面获取）')
    return gatewayCall(apiKey, apiName, params)
  }

  return [
    sdk.defineTool({
      name: 'mcp__weread__search_books',
      label: '搜索微信读书书城',
      description: '在微信读书书城搜索书籍，返回书名、作者、评分等信息。用户提到书名时先调本工具获取 bookId。',
      parameters: Type.Object({
        keyword: Type.String({ description: '搜索关键词，如「三体」' }),
        count: Type.Optional(Type.Number({ description: '返回条数，默认 10，最大 20' })),
      }),
      async execute(_toolCallId: string, params: unknown) {
        const args = params as { keyword?: string; count?: number }
        const keyword = (args.keyword ?? '').trim()
        if (!keyword) throw new Error('keyword 必填')
        const data = await call('/store/search', { keyword, count: Math.min(args.count ?? 10, 20) })
        return jsonResult(data)
      },
    }),

    sdk.defineTool({
      name: 'mcp__weread__get_book_info',
      label: '查看书籍信息',
      description: '查看书籍详情、章节目录与你的阅读进度。bookId 来自 search_books / get_shelf。',
      parameters: Type.Object({
        bookId: Type.String({ description: '书籍 ID' }),
      }),
      async execute(_toolCallId: string, params: unknown) {
        const args = params as { bookId?: string }
        const bookId = (args.bookId ?? '').trim()
        if (!bookId) throw new Error('bookId 必填')
        const data = await call('/book/info', { bookId })
        return jsonResult(data)
      },
    }),

    sdk.defineTool({
      name: 'mcp__weread__get_shelf',
      label: '查看微信读书书架',
      description: '获取书架全部条目（书籍/专辑/有声书），含阅读进度与标记状态。回答「我的书架/我最近在看什么」时使用。书架数量 = books.length + albums.length + (mp 非空 ? 1 : 0)。',
      parameters: Type.Object({}),
      async execute() {
        const data = await call('/shelf/sync')
        return jsonResult(data)
      },
    }),

    sdk.defineTool({
      name: 'mcp__weread__get_reading_stats',
      label: '查看阅读统计',
      description: '获取阅读时长、天数、偏好分析与统计摘要。回答「我读了多久/今年读了几本书」时使用。注意：时长字段单位为秒，展示时转「X小时Y分钟」；时间戳转 YYYY-MM-DD。',
      parameters: Type.Object({}),
      async execute() {
        const data = await call('/readdata/detail')
        return jsonResult(data)
      },
    }),

    sdk.defineTool({
      name: 'mcp__weread__get_notebooks',
      label: '查看微信读书笔记',
      description: '获取所有有笔记的书籍概览（自动分页拉全）：每本书的划线数 noteCount、想法数 reviewCount、书签数 bookmarkCount。总笔记数 = 三者之和（不要重复加点评数）。展示时间戳时转 YYYY-MM-DD。',
      parameters: Type.Object({}),
      async execute() {
        const data = await paginateAll(getApiKey(), '/user/notebooks', {}, 'lastSort', 'books')
        return jsonResult(data)
      },
    }),

    sdk.defineTool({
      name: 'mcp__weread__get_underlines',
      label: '查看书籍划线',
      description: '获取某本书的划线原文与想法（bookId 来自 search_books / get_shelf）。用于整理读书笔记、回顾划线。',
      parameters: Type.Object({
        bookId: Type.String({ description: '书籍 ID' }),
      }),
      async execute(_toolCallId: string, params: unknown) {
        const args = params as { bookId?: string }
        const bookId = (args.bookId ?? '').trim()
        if (!bookId) throw new Error('bookId 必填')
        const data = await call('/book/underlines', { bookId })
        return jsonResult(data)
      },
    }),

    sdk.defineTool({
      name: 'mcp__weread__get_recommendations',
      label: '微信读书推荐',
      description: '基于用户阅读偏好获取个性化推荐书籍。回答「推荐几本书」时使用。',
      parameters: Type.Object({}),
      async execute() {
        const data = await call('/book/recommend')
        return jsonResult(data)
      },
    }),
  ]
}
