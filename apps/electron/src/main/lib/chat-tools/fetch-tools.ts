/**
 * 网页抓取工具模块（Agent 模式，MyYoda 自研桥接）
 *
 * 提供 fetch_url 工具：抓取任意 HTTP(S) URL，剥离脚本/样式后转换为可读文本
 * 返回给 Agent。官方 fetch MCP server 目前只有 Python（uvx）版，npm 上的
 * unscoped `mcp-server-fetch` 是供应链攻击研究 canary 包（2026-08-19 已确认），
 * 因此这里用 Pi defineTool 自研桥接，与 weread 同模式，无需凭据。
 *
 * 安全边界：仅 GET；响应体上限 512KB；超时 20s；不携带 Cookie/凭据。
 */

import { Type } from 'typebox'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import { fetchWithSystemFallback } from '../proxy-fetch'

const REQUEST_TIMEOUT_MS = 20_000
const MAX_BODY_BYTES = 512 * 1024

function textResult(text: string): AgentToolResult<unknown> {
  return {
    content: [{ type: 'text', text }],
    details: text,
  } as AgentToolResult<unknown>
}

/** 把 HTML 粗略转成可读文本（去 script/style/标签 + 解码实体 + 压缩空行） */
function htmlToText(html: string): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
  text = text
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n')
  return text.slice(0, 200_000)
}

/** 判断响应是否像是 HTML（避免把 JSON/纯文本误转） */
function isHtmlResponse(resp: Response): boolean {
  const contentType = resp.headers.get('content-type') ?? ''
  return /text\/html|application\/xhtml/i.test(contentType)
}

async function fetchUrl(url: string): Promise<string> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('只支持 http/https URL')
  }
  const resp = await fetchWithSystemFallback(
    url,
    { timeoutMs: REQUEST_TIMEOUT_MS },
    undefined,
  )
  if (!resp.ok) {
    throw new Error(`抓取失败（HTTP ${resp.status} ${resp.statusText}）`)
  }
  const buf = new Uint8Array(await resp.arrayBuffer())
  if (buf.byteLength > MAX_BODY_BYTES) {
    throw new Error(`响应体过大（${(buf.byteLength / 1024).toFixed(0)}KB > 512KB 上限），请改用本地下载或浏览器工具`)
  }
  const body = new TextDecoder().decode(buf)
  if (isHtmlResponse(resp)) {
    return htmlToText(body)
  }
  return body.slice(0, 200_000)
}

export function buildFetchTools(
  sdk: {
    defineTool: (def: Parameters<typeof import('@earendil-works/pi-coding-agent')['defineTool']>[0]) => ToolDefinition
  },
): ToolDefinition[] {
  return [
    sdk.defineTool({
      name: 'mcp__fetch__fetch_url',
      label: '抓取网页',
      description:
        '抓取任意 HTTP(S) URL 并转换为可读文本返回（HTML 会剥离脚本/样式保留正文）。' +
        '适合读取静态网页、公开 API、文档页；不支持需要登录/Cookie 的页面，大文件请改用本地下载。',
      parameters: Type.Object({
        url: Type.String({ description: '要抓取的完整 URL（http/https）' }),
      }),
      async execute(_toolCallId: string, params: unknown) {
        const args = params as { url?: string }
        const url = (args.url ?? '').trim()
        if (!url) throw new Error('url 必填')
        const text = await fetchUrl(url)
        return textResult(text)
      },
    }),
  ] as ToolDefinition[]
}
