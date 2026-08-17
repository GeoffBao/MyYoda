import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as os from 'node:os'
import { mockElectronModule } from './__tests__/electron-mock'

type StorageService = typeof import('./storage-service')

let storageService: StorageService
let tempHome: string
const originalHome = process.env.HOME
const originalMyyodaDev = process.env.MYYODA_DEV

mockElectronModule({
  app: {
    isPackaged: true,
    getPath: () => join(process.env.HOME ?? tempHome, 'Library', 'Application Support'),
  },
})

mock.module('node:os', () => ({
  ...os,
  homedir: () => tempHome,
}))

function sessionDir(): string {
  return join(tempHome, '.myyoda', 'agent-sessions')
}

function writeSessionJsonl(sessionId: string, content: string): void {
  mkdirSync(sessionDir(), { recursive: true })
  writeFileSync(join(sessionDir(), `${sessionId}.jsonl`), content, 'utf-8')
}

function writeAgentSessionsIndex(sessions: Array<{
  id: string
  title: string
  workspaceId?: string
  createdAt?: number
  updatedAt?: number
  archived?: boolean
}>): void {
  const dir = join(tempHome, '.myyoda')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'agent-sessions.json'), JSON.stringify({
    version: 1,
    sessions: sessions.map((s) => ({
      workspaceId: 'workspace-a',
      createdAt: 1,
      updatedAt: 1,
      ...s,
    })),
  }), 'utf-8')
}

/** 构造一条内嵌大图（Pi 顶层 data 格式）的 tool_result 消息行 */
function oversizedImageLine(toolUseId: string, dataLength: number): string {
  const msg = {
    type: 'user',
    uuid: `uuid-${toolUseId}`,
    message: {
      content: [{
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: [
          { type: 'text', text: '截图成功' },
          { type: 'image', data: 'a'.repeat(dataLength), mimeType: 'image/png' },
        ],
      }],
    },
    parent_tool_use_id: null,
  }
  return JSON.stringify(msg)
}

beforeAll(async () => {
  tempHome = mkdtempSync(join(os.tmpdir(), 'myyoda-storage-service-'))
  process.env.HOME = tempHome
  delete process.env.MYYODA_DEV
  storageService = await import('./storage-service')
})

beforeEach(() => {
  // 每个用例独立的会话目录，避免 strip 类全量扫描测试之间互相污染
  rmSync(join(tempHome, '.myyoda'), { recursive: true, force: true })
})

afterAll(() => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  if (originalMyyodaDev === undefined) delete process.env.MYYODA_DEV
  else process.env.MYYODA_DEV = originalMyyodaDev
  rmSync(tempHome, { recursive: true, force: true })
})

describe('存储统计（top 大文件 + 孤儿检测）', () => {
  test('Given 索引内多个会话与孤儿 JSONL When 计算统计 Then topItems 按大小排序且孤儿被识别', async () => {
    const small = JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: '短会话' }] } })
    const large = JSON.stringify({
      type: 'user',
      message: { content: [{ type: 'text', text: 'x'.repeat(20_000) }] },
    })
    writeSessionJsonl('session-small', small + '\n')
    writeSessionJsonl('session-large', large + '\n')
    writeSessionJsonl('orphan-leftover', large + '\n')
    writeAgentSessionsIndex([
      { id: 'session-small', title: '小会话' },
      { id: 'session-large', title: '大会话', updatedAt: 5, archived: true },
    ])

    const stats = await storageService.calculateStorageStats()
    const cat = stats.categories.find((c) => c.key === 'agent-sessions')!

    expect(cat.topItems).toBeDefined()
    expect(cat.topItems![0]!.sessionId).toBe('session-large')
    expect(cat.topItems![0]!.archived).toBe(true)
    expect(cat.topItems!.some((t) => t.sessionId === 'orphan-leftover')).toBe(true)
    expect(cat.hasOrphans).toBe(true)
    expect(cat.orphanCount).toBe(1)
    expect(cat.orphanBytes).toBeGreaterThan(0)
  })
})

describe('归档清理预览', () => {
  test('Given 已归档且超时的会话 When 预览 Then 计入可回收；未归档或未超时不计入', () => {
    const content = JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: '旧会话' }] } })
    writeSessionJsonl('archived-old', content + '\n')
    writeSessionJsonl('archived-new', content + '\n')
    writeSessionJsonl('active-old', content + '\n')
    const now = Date.now()
    writeAgentSessionsIndex([
      { id: 'archived-old', title: '归档旧', updatedAt: now - 10 * 24 * 3600_000, archived: true },
      { id: 'archived-new', title: '归档新', updatedAt: now - 1000, archived: true },
      { id: 'active-old', title: '活跃旧', updatedAt: now - 10 * 24 * 3600_000, archived: false },
    ])

    const preview = storageService.previewArchivedCleanup(7)
    expect(preview.affectedCount).toBe(1)
    expect(preview.reclaimableBytes).toBe(Buffer.byteLength(content + '\n'))
  })

  test('Given 已归档会话的 JSONL 不存在 When 预览 Then 跳过不报错', () => {
    const now = Date.now()
    writeAgentSessionsIndex([
      { id: 'archived-missing', title: '归档无文件', updatedAt: now - 10 * 24 * 3600_000, archived: true },
    ])

    const preview = storageService.previewArchivedCleanup(7)
    expect(preview.affectedCount).toBe(0)
    expect(preview.reclaimableBytes).toBe(0)
  })
})

describe('孤儿数据清理门控', () => {
  test('Given 未显式确认 When 清理孤儿 Then 拒绝执行且文件保留', async () => {
    writeSessionJsonl('orphan-guard', JSON.stringify({ type: 'user' }) + '\n')
    writeAgentSessionsIndex([{ id: 'active-only', title: '唯一活跃' }])

    const result = await storageService.cleanupStorage({
      categories: ['agent-sessions'],
      orphansOnly: true,
      archivedBeforeDays: 0,
    })

    expect(result.freedBytes).toBe(0)
    expect(result.errors.some((e) => e.includes('显式确认'))).toBe(true)
    expect(existsSync(join(sessionDir(), 'orphan-guard.jsonl'))).toBe(true)
  })

  test('Given 显式确认 When 清理孤儿 Then 删除未索引 JSONL 且保留活跃会话文件', async () => {
    writeSessionJsonl('orphan-remove', JSON.stringify({ type: 'user' }) + '\n')
    writeSessionJsonl('active-keep', JSON.stringify({ type: 'user' }) + '\n')
    writeAgentSessionsIndex([{ id: 'active-keep', title: '活跃' }])

    const result = await storageService.cleanupStorage({
      categories: ['agent-sessions'],
      orphansOnly: true,
      archivedBeforeDays: 0,
      confirmedOrphanCleanup: true,
    })

    expect(result.freedBytes).toBeGreaterThan(0)
    expect(existsSync(join(sessionDir(), 'orphan-remove.jsonl'))).toBe(false)
    expect(existsSync(join(sessionDir(), 'active-keep.jsonl'))).toBe(true)
  })
})

describe('存量大图剥离', () => {
  test('Given 含 Pi 格式内嵌大图的会话 When 预览 Then 报告可回收体积与受影响会话数', async () => {
    writeSessionJsonl('strip-preview', oversizedImageLine('call-strip', 100_000) + '\n')
    writeAgentSessionsIndex([{ id: 'strip-preview', title: '大图会话' }])

    const preview = await storageService.previewStripOversizedImages()
    expect(preview.affectedCount).toBe(1)
    expect(preview.reclaimableBytes).toBeGreaterThan(0)
    expect(preview.reclaimableBytes).toBeLessThanOrEqual(100_000)
  })

  test('Given 无内嵌大图的会话 When 预览 Then 报告零回收', async () => {
    writeSessionJsonl('strip-none', JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: '普通消息' }] } }) + '\n')
    writeAgentSessionsIndex([{ id: 'strip-none', title: '普通会话' }])

    const preview = await storageService.previewStripOversizedImages()
    expect(preview.reclaimableBytes).toBe(0)
  })

  test('Given 含内嵌大图 When 执行剥离 Then 文件变小且图片块替换为截断标记', async () => {
    writeSessionJsonl('strip-execute', oversizedImageLine('call-exec', 150_000) + '\n')
    writeAgentSessionsIndex([{ id: 'strip-execute', title: '执行剥离会话' }])
    const before = readFileSync(join(sessionDir(), 'strip-execute.jsonl'), 'utf-8')

    const result = await storageService.stripOversizedImages()
    expect(result.affectedSessions).toBe(1)
    expect(result.freedBytes).toBeGreaterThan(0)

    const after = readFileSync(join(sessionDir(), 'strip-execute.jsonl'), 'utf-8')
    expect(after.length).toBeLessThan(before.length)
    expect(after).not.toContain('a'.repeat(150_000))
    expect(after).toContain('"_truncated":true')
    expect(after).toContain('截图成功')
  })

  test('Given 已剥离过的会话 When 再次预览 Then 零回收（幂等）', async () => {
    const preview = await storageService.previewStripOversizedImages()
    expect(preview.reclaimableBytes).toBe(0)
  })
})
