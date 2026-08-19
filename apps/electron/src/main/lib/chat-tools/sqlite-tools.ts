/**
 * SQLite 数据库工具模块（Agent 模式，MyYoda 自研桥接）
 *
 * 提供只读 SQLite 查询工具：list_tables / describe_table / query（仅 SELECT/
 * WITH/PRAGMA/EXPLAIN 白名单），基于 Node 内置 node:sqlite（Electron 43 的
 * Node 24 内置，无需外部依赖）。npm 上的 unscoped `mcp-server-sqlite` 是个人
 * 包（0.0.2），官方 reference server 只有 Python（uvx）版，因此自研桥接。
 *
 * DB 路径配置在「连接器详情 → SQLite」的 dbPath 字段（toolCredentials['sqlite'].dbPath），
 * 未配置时工具会给出明确提示。安全边界：只读白名单，禁止 INSERT/UPDATE/DELETE/
 * DROP/ATTACH 等写操作与多语句。
 */

import { Type } from 'typebox'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { AgentToolResult } from '@earendil-works/pi-agent-core'

const MAX_RESULT_ROWS = 500
const MAX_CELL_CHARS = 5_000

type SqliteModule = {
  DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => {
    prepare(sql: string): {
      all(...params: unknown[]): Record<string, unknown>[]
      get(...params: unknown[]): Record<string, unknown> | undefined
    }
    close(): void
  }
}

function jsonResult(data: unknown): AgentToolResult<unknown> {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    details: data,
  } as AgentToolResult<unknown>
}

/** 只读 SQL 白名单：仅允许以这些关键字开头的语句（防写库/防注入多语句） */
const READONLY_PREFIXES = ['select', 'with', 'pragma', 'explain']

function assertReadOnlyQuery(sql: string): void {
  const trimmed = sql.trim().replace(/^\(+/, '').trim()
  const firstWord = trimmed.split(/\s|\(/, 1)[0]?.toLowerCase() ?? ''
  if (!READONLY_PREFIXES.includes(firstWord)) {
    throw new Error('SQLite 工具只允许只读查询（SELECT / WITH / PRAGMA / EXPLAIN），写操作请用本地终端自行执行')
  }
  if (/;\s*\S/.test(trimmed.replace(/;\s*$/, ''))) {
    throw new Error('不允许一次执行多条语句')
  }
}

/** 结果单元格截断（防止大字段撑爆上下文） */
function truncateRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === 'string' && value.length > MAX_CELL_CHARS) {
      out[key] = value.slice(0, MAX_CELL_CHARS) + '…（已截断）'
    } else if (value instanceof Uint8Array) {
      out[key] = `<binary ${value.byteLength} bytes>`
    } else {
      out[key] = value
    }
  }
  return out
}

function openDatabase(dbPath: string): { db: { prepare: (sql: string) => { all(...p: unknown[]): Record<string, unknown>[]; get(...p: unknown[]): Record<string, unknown> | undefined }; close(): void } } {
  const { DatabaseSync } = require('node:sqlite') as SqliteModule
  // readOnly: true 双保险（只读白名单之外再加文件层只读）
  const db = new DatabaseSync(dbPath, { readOnly: true })
  return { db }
}

export function buildSqliteTools(
  sdk: {
    defineTool: (def: Parameters<typeof import('@earendil-works/pi-coding-agent')['defineTool']>[0]) => ToolDefinition
  },
  getDbPath: () => string,
): ToolDefinition[] {
  const withDb = <T>(fn: (db: ReturnType<typeof openDatabase>['db']) => T): T => {
    const dbPath = getDbPath().trim()
    if (!dbPath) {
      throw new Error('SQLite DB 路径未配置，请在「连接器 → SQLite」详情中填写数据库文件路径（如 /Users/you/data/app.db）')
    }
    const { db } = openDatabase(dbPath)
    try {
      return fn(db)
    } finally {
      db.close()
    }
  }

  return [
    sdk.defineTool({
      name: 'mcp__sqlite__sqlite_list_tables',
      label: '列出 SQLite 表',
      description: '列出数据库中的所有表（含视图）。',
      parameters: Type.Object({}),
      async execute() {
        return jsonResult(withDb((db) => db.prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') ORDER BY name").all()))
      },
    }),
    sdk.defineTool({
      name: 'mcp__sqlite__sqlite_describe_table',
      label: '查看 SQLite 表结构',
      description: '查看某张表的列定义（名称/类型/约束）。',
      parameters: Type.Object({
        table: Type.String({ description: '表名' }),
      }),
      async execute(_toolCallId: string, params: unknown) {
        const args = params as { table?: string }
        const table = (args.table ?? '').trim()
        if (!table) throw new Error('table 必填')
        return jsonResult(withDb((db) => db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all().map(truncateRow)))
      },
    }),
    sdk.defineTool({
      name: 'mcp__sqlite__sqlite_query',
      label: '查询 SQLite',
      description:
        '对数据库执行只读 SQL 查询（仅允许 SELECT / WITH / PRAGMA / EXPLAIN），最多返回 500 行。' +
        '参数使用 ? 占位符绑定，避免拼接注入。',
      parameters: Type.Object({
        sql: Type.String({ description: '只读 SQL 语句，如 SELECT * FROM users LIMIT 10' }),
        params: Type.Optional(Type.Array(Type.Union([Type.String(), Type.Number(), Type.Null()]), { description: '? 占位符对应的参数值' })),
      }),
      async execute(_toolCallId: string, params: unknown) {
        const args = params as { sql?: string; params?: (string | number | null)[] }
        const sql = (args.sql ?? '').trim()
        if (!sql) throw new Error('sql 必填')
        assertReadOnlyQuery(sql)
        const bound = args.params ?? []
        return jsonResult({
          rows: withDb((db) => db.prepare(sql).all(...bound).slice(0, MAX_RESULT_ROWS).map(truncateRow)),
          truncated: undefined,
        })
      },
    }),
  ] as ToolDefinition[]
}
