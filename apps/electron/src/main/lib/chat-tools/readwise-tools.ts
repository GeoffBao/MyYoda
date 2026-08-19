/**
 * Readwise 工具模块（Agent 模式）
 *
 * 通过 Readwise 官方 REST API v2（https://readwise.io/api/v2）暴露只读工具：
 * 搜索/读取 Reader 文档、查看划线段落与书单。
 * 认证使用静态 API Token（readwise.io/access_token 获取，Authorization: Token <token>）。
 *
 * 设计为「知识类」内置 MCP：全只读，Agent 用你自己的阅读积累回答问题、
 * 整理笔记、写读书报告。凭据存 chat-tools.json toolCredentials['readwise']。
 *
 * 注意：Readwise 官方 MCP server 走 OAuth 动态授权，MyYoda 的 MCP 基础设施
 * 不支持浏览器授权回调，因此这里用 Pi defineTool 桥接 + REST API 静态 token，
 * 与 automation / collaboration 同模式。
 */

import { Type } from 'typebox'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { AgentToolResult } from '@earendil-works/pi-agent-core'

/** Readwise API v2 基地址 */
const READWISE_API_V2 = 'https://readwise.io/api/v2'
const READWISE_API_V3 = 'https://readwise.io/api/v3'

/** 请求超时（毫秒） */
const REQUEST_TIMEOUT_MS = 15_000

/** 单次请求最大条数（服务端上限 1000，这里限制在合理范围） */
const MAX_PAGE_SIZE = 100

/** 统一返回 JSON 工具结果 */
function jsonResult(data: unknown): AgentToolResult<unknown> {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    details: data,
  } as AgentToolResult<unknown>
}

/** 解析 HTTP 响应为 JSON；对错误状态给出可读信息 */
async function parseResponse(resp: Response, action: string): Promise<unknown> {
  if (resp.status === 401) {
    throw new Error('Readwise Token 无效或已过期，请在「API Tab → Readwise」重新配置（readwise.io/access_token 获取）')
  }
  if (resp.status === 429) {
    throw new Error('Readwise API 请求过于频繁，请稍后再试')
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`${action}失败（HTTP ${resp.status}）：${text.slice(0, 300) || '无响应内容'}`)
  }
  return resp.json().catch(() => ({}))
}

/** 执行 Readwise API GET 请求（base 可选：v3 list 用，默认 v2） */
async function readwiseGet(
  token: string,
  path: string,
  searchParams?: Record<string, string | number | boolean | undefined>,
  base: string = READWISE_API_V2,
): Promise<unknown> {
  const url = new URL(`${base}${path}`)
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
    }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const resp = await fetch(url.toString(), {
      headers: { Authorization: `Token ${token}` },
      signal: controller.signal,
    })
    return await parseResponse(resp, 'Readwise 请求')
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Readwise 请求超时，请稍后重试')
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 构建 Readwise 工具集（Pi ToolDefinition）。
 * 注入条件：内置 MCP 开关开启 + 已配置 Token。
 * token 通过回调传入（不随工具构建缓存，支持运行中改配）。
 */
export function buildReadwiseTools(
  sdk: {
    defineTool: (def: Parameters<typeof import('@earendil-works/pi-coding-agent')['defineTool']>[0]) => ToolDefinition
  },
  getToken: () => string,
): ToolDefinition[] {
  const rw = (path: string, searchParams?: Record<string, string | number | boolean | undefined>, base?: string): Promise<unknown> => {
    const token = getToken().trim()
    if (!token) throw new Error('Readwise Token 未配置，请在「API Tab → Readwise」填写')
    return readwiseGet(token, path, searchParams, base)
  }

  /** v3 list：官方 Reader API（v2 /documents/ 已废弃 404），返回 { count, nextPageCursor, results } */
  const rwList = (searchParams?: Record<string, string | number | boolean | undefined>): Promise<unknown> =>
    rw('/list/', searchParams, READWISE_API_V3)

  return [
    sdk.defineTool({
      name: 'mcp__readwise__search_documents',
      label: '搜索 Readwise 文库',
      description: '在 Readwise Reader 文库中按关键词搜索已保存的文档（文章/网页/PDF 等），返回标题、作者、摘要与文档 ID。用于回答问题时定位你自己保存过的阅读材料。',
      parameters: Type.Object({
        query: Type.String({ description: '搜索关键词，如「AI agents」' }),
        limit: Type.Optional(Type.Number({ description: '最多返回条数，默认 10，最大 50' })),
      }),
      async execute(_toolCallId: string, params: unknown) {
        const args = params as { query?: string; limit?: number }
        const query = (args.query ?? '').trim()
        if (!query) throw new Error('query 必填')
        // v3 list 无全文搜索端点：拉第一页（最多 100 条）后本地过滤标题/作者/摘要
        const data = (await rwList({ limit: 100 })) as { results?: Array<Record<string, unknown>> }
        const q = query.toLowerCase()
        const results = (data.results ?? [])
          .filter((doc) => {
            const title = String(doc.title ?? '').toLowerCase()
            const author = String(doc.author ?? '').toLowerCase()
            const summary = String(doc.summary ?? '').toLowerCase()
            const site = String(doc.site_name ?? '').toLowerCase()
            return title.includes(q) || author.includes(q) || summary.includes(q) || site.includes(q)
          })
          .slice(0, Math.min(args.limit ?? 10, 50))
        return jsonResult({ count: results.length, results })
      },
    }),

    sdk.defineTool({
      name: 'mcp__readwise__get_document',
      label: '读取 Readwise 文档',
      description: '按文档 ID 读取 Reader 文档详情与全文（HTML 格式）。文档 ID 来自 search_documents / list_documents 返回的 id 字段。',
      parameters: Type.Object({
        document_id: Type.String({ description: 'Reader 文档 ID' }),
      }),
      async execute(_toolCallId: string, params: unknown) {
        const args = params as { document_id?: string }
        const id = (args.document_id ?? '').trim()
        if (!id) throw new Error('document_id 必填')
        // v3 list?id= 单文档查询 + withHtmlContent 拿全文（HTML）
        const data = (await rwList({ id, withHtmlContent: true, limit: 1 })) as { results?: unknown[] }
        const doc = (data.results ?? [])[0] ?? {}
        return jsonResult(doc)
      },
    }),

    sdk.defineTool({
      name: 'mcp__readwise__list_documents',
      label: '列出 Readwise 文库',
      description: '列出 Readwise Reader 文库中的文档（可筛选文章/PDF/播客等分类）。适合快速浏览你最近保存的内容。',
      parameters: Type.Object({
        category: Type.Optional(Type.String({ description: '文档分类：article / email / rss / highlight / pdf / epub / tweet / video 等' })),
        limit: Type.Optional(Type.Number({ description: '最多返回条数，默认 10，最大 100' })),
      }),
      async execute(_toolCallId: string, params: unknown) {
        const args = params as { category?: string; limit?: number }
        const data = await rwList({ category: args.category, limit: Math.min(args.limit ?? 10, 100) })
        return jsonResult(data)
      },
    }),

    sdk.defineTool({
      name: 'mcp__readwise__list_highlights',
      label: '查看 Readwise 划线',
      description: '获取最近的高亮划线段落（可筛选书/文档，或按时间）。适合回顾你最近划了什么、整理读书笔记。',
      parameters: Type.Object({
        book_id: Type.Optional(Type.Number({ description: '书籍 ID（list_books 返回的 id），只看某本书的划线' })),
        updated_after: Type.Optional(Type.String({ description: 'ISO 时间（如 2026-08-01T00:00:00Z），只看该时间之后更新的划线' })),
        limit: Type.Optional(Type.Number({ description: '最多返回条数，默认 20，最大 100' })),
      }),
      async execute(_toolCallId: string, params: unknown) {
        const args = params as { book_id?: number; updated_after?: string; limit?: number }
        const searchParams: Record<string, string | number | undefined> = {
          page_size: Math.min(args.limit ?? 20, MAX_PAGE_SIZE),
        }
        if (args.book_id !== undefined) searchParams.book_id = args.book_id
        if (args.updated_after) searchParams.updated_after = args.updated_after
        const data = await rw('/highlights/', searchParams)
        return jsonResult(data)
      },
    }),

    sdk.defineTool({
      name: 'mcp__readwise__list_books',
      label: '查看 Readwise 书单',
      description: '列出 Readwise 中已保存的书籍（含作者、划线数量）。适合回答「我读过/收藏了哪些书」。',
      parameters: Type.Object({
        limit: Type.Optional(Type.Number({ description: '最多返回条数，默认 20，最大 100' })),
      }),
      async execute(_toolCallId: string, params: unknown) {
        const args = params as { limit?: number }
        const data = await rw('/books/', { page_size: Math.min(args.limit ?? 20, MAX_PAGE_SIZE) })
        return jsonResult(data)
      },
    }),

    sdk.defineTool({
      name: 'mcp__readwise__get_book_highlights',
      label: '查看书籍划线',
      description: '获取指定书籍（book_id 来自 list_books）的全部高亮划线。用于整理某本书的读书笔记。',
      parameters: Type.Object({
        book_id: Type.Number({ description: '书籍 ID（list_books 返回的 id）' }),
        limit: Type.Optional(Type.Number({ description: '最多返回条数，默认 100' })),
      }),
      async execute(_toolCallId: string, params: unknown) {
        const args = params as { book_id?: number; limit?: number }
        if (args.book_id === undefined) throw new Error('book_id 必填')
        // 官方 v2 划线端点按 book_id 查询：/highlights/?book_id=（/books/{id}/highlights/ 不存在）
        const data = await rw('/highlights/', { book_id: args.book_id, page_size: Math.min(args.limit ?? 100, MAX_PAGE_SIZE) })
        return jsonResult(data)
      },
    }),
  ]
}
