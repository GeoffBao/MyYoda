/**
 * feedback-service 单元测试
 *
 * 覆盖：连接测试（成功/401/网络失败）、提交成功链路（含截图上传与段落切块）、
 * 未配置降级草稿、输入校验。网络层用 scripted fetch mock，配置/草稿落临时 HOME。
 */

import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as os from 'node:os'
import { mockElectronModule } from './electron-mock'

let tempHome = ''

mockElectronModule({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf-8'),
    decryptString: (value: Buffer) => value.toString('utf-8'),
  },
})

mock.module('node:os', () => ({
  ...os,
  homedir: () => tempHome,
}))

let configPaths: typeof import('../config-paths')
let service: typeof import('../feedback-service')

beforeAll(async () => {
  tempHome = mkdtempSync(join(os.tmpdir(), 'myyoda-feedback-'))
  configPaths = await import('../config-paths')
  service = await import('../feedback-service')
})

beforeEach(() => {
  const configDir = join(tempHome, configPaths.getConfigDirName())
  rmSync(configDir, { recursive: true, force: true })
  mkdirSync(configDir, { recursive: true })
})

afterAll(() => {
  rmSync(tempHome, { recursive: true, force: true })
})

/** 构造 scripted fetch：按 URL 关键字分发响应 */
function scriptedFetch(
  handlers: Array<{
    match: (url: string) => boolean
    respond: (url: string, init?: RequestInit) => Promise<Response>
  }>,
): (input: unknown, init?: RequestInit) => Promise<Response> {
  const fetchFn = async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : typeof input === 'object' && input !== null && 'url' in input
            ? String((input as { url: string }).url)
            : ''
    const handler = handlers.find((h) => h.match(url))
    if (!handler) {
      return new Response(JSON.stringify({ object: 'error', status: 500, message: 'no handler' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return handler.respond(url, init)
  }
  return fetchFn
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('testFeedbackConnection', () => {
  test('成功：GET 数据库返回 200', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = scriptedFetch([
      {
        match: (url) => url.includes('/v1/databases/'),
        respond: async () => jsonResponse({ id: 'db-1', title: [{ plain_text: '用户反馈' }] }),
      },
    ]) as unknown as typeof fetch
    try {
      const result = await service.testFeedbackConnection({ token: 'ntn_test', databaseId: 'db-1' })
      expect(result.success).toBe(true)
      expect(result.message).toContain('连接成功')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('401 → Token 无效提示', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = scriptedFetch([
      { match: (url) => url.includes('/v1/databases/'), respond: async () => jsonResponse({}, 401) },
    ]) as unknown as typeof fetch
    try {
      const result = await service.testFeedbackConnection({ token: 'bad', databaseId: 'db-1' })
      expect(result.success).toBe(false)
      expect(result.message).toContain('Token')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('网络异常 → 网络失败提示', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch
    try {
      const result = await service.testFeedbackConnection({ token: 'ntn_test', databaseId: 'db-1' })
      expect(result.success).toBe(false)
      expect(result.message).toContain('网络')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('字段留空时回退到已保存配置', async () => {
    service.saveFeedbackConfig({ token: 'ntn_saved', databaseId: 'db-saved' })
    const originalFetch = globalThis.fetch
    globalThis.fetch = scriptedFetch([
      {
        match: (url) => url.includes('/v1/databases/db-saved'),
        respond: async () => jsonResponse({ id: 'db-saved' }),
      },
    ]) as unknown as typeof fetch
    try {
      const result = await service.testFeedbackConnection({})
      expect(result.success).toBe(true)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('submitFeedback', () => {
  test('未配置渠道 → 失败并保存草稿', () => {
    const resultPromise = service.submitFeedback(
      { type: 'bug', description: '测试描述', screenshots: [] },
      '0.9.0',
      'darwin',
    )
    return resultPromise.then((result) => {
      expect(result.success).toBe(false)
      expect(result.draftSaved).toBe(true)
      expect(result.error).toContain('尚未配置')
      const draftsDir = join(tempHome, configPaths.getConfigDirName(), 'feedback-drafts')
      expect(readdirSync(draftsDir).length).toBeGreaterThan(0)
    })
  })

  test('空描述 → 直接拒绝，不落草稿', async () => {
    service.saveFeedbackConfig({ token: 'ntn_test', databaseId: 'db-1' })
    const result = await service.submitFeedback({ type: 'bug', description: '   ', screenshots: [] }, '0.9.0', 'darwin')
    expect(result.success).toBe(false)
    expect(result.error).toContain('详细描述')
    expect(result.draftSaved).toBeUndefined()
  })

  test('成功链路：截图上传 + 段落切块 + 创建页面', async () => {
    service.saveFeedbackConfig({ token: 'ntn_test', databaseId: 'db-1' })

    // 写一个假截图文件
    const shotPath = join(tempHome, 'shot.png')
    writeFileSync(shotPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    const originalFetch = globalThis.fetch
    let createdPageBody: Record<string, unknown> | null = null
    globalThis.fetch = scriptedFetch([
      {
        match: (url) => url.endsWith('/v1/file_uploads'),
        respond: async () => jsonResponse({ id: 'fu-1', upload_url: 'https://api.notion.com/v1/file_uploads/fu-1/send' }),
      },
      {
        match: (url) => url.includes('/v1/file_uploads/fu-1/send'),
        respond: async () => jsonResponse({ object: 'file_upload', id: 'fu-1', status: 'uploaded' }),
      },
      {
        match: (url) => url.endsWith('/v1/pages'),
        respond: async (_url, init) => {
          createdPageBody = JSON.parse(String(init?.body)) as Record<string, unknown>
          return jsonResponse({ id: 'page-1', url: 'https://app.notion.com/p/page-1' })
        },
      },
    ]) as unknown as typeof fetch

    try {
      // 长描述：3500 字（跨两个 1800 字符的 rich_text 切块）
      const longDescription = '复现步骤很长的内容。'.repeat(350)
      const result = await service.submitFeedback(
        { type: 'feature', description: longDescription, screenshots: [shotPath], contactEmail: 'e@example.com' },
        '0.9.0',
        'darwin arm64',
      )
      expect(result.success).toBe(true)
      expect(result.pageUrl).toBe('https://app.notion.com/p/page-1')

      expect(createdPageBody).not.toBeNull()
      const body = createdPageBody as unknown as { parent: Record<string, unknown>; properties: Record<string, unknown>; children: Array<Record<string, unknown>> }
      expect(body.parent).toEqual({ type: 'database_id', database_id: 'db-1' })

      const props = body.properties as {
        标题: { title: Array<{ text: { content: string } }> }
        类型: { select: { name: string } }
        状态: { select: { name: string } }
        联系方式: { email: string }
        版本: { rich_text: Array<{ text: { content: string } }> }
      }
      expect(props.标题.title[0]!.text.content).toContain('[功能建议]')
      expect(props.类型.select.name).toBe('功能建议')
      expect(props.状态.select.name).toBe('待处理')
      expect(props.联系方式.email).toBe('e@example.com')
      expect(props.版本.rich_text[0]!.text.content).toBe('0.9.0')

      // children：至少 2 个段落块（长描述切块）+ 1 个图片块（file_upload 引用）
      const paragraphs = body.children.filter((b) => b.type === 'paragraph')
      const images = body.children.filter((b) => b.type === 'image')
      expect(paragraphs.length).toBeGreaterThanOrEqual(2)
      expect(images.length).toBe(1)
      const imageBlock = images[0] as { image: { file_upload: { id: string } } }
      expect(imageBlock!.image.file_upload.id).toBe('fu-1')
      // 每条段落文本不超过切块上限
      for (const p of paragraphs) {
        const text = (p.paragraph as { rich_text: Array<{ text: { content: string } }> }).rich_text[0]!.text.content
        expect(text.length).toBeLessThanOrEqual(1800)
      }
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('上传截图失败时跳过截图、继续提交正文', async () => {
    service.saveFeedbackConfig({ token: 'ntn_test', databaseId: 'db-1' })
    const shotPath = join(tempHome, 'missing.png')
    writeFileSync(shotPath, Buffer.from([1, 2, 3]))

    const originalFetch = globalThis.fetch
    globalThis.fetch = scriptedFetch([
      {
        match: (url) => url.endsWith('/v1/file_uploads'),
        respond: async () => jsonResponse({ object: 'error' }, 500),
      },
      {
        match: (url) => url.endsWith('/v1/pages'),
        respond: async (_url, init) => {
          const body = JSON.parse(String(init?.body)) as { children: Array<Record<string, unknown>> }
          const images = body.children.filter((b) => b.type === 'image')
          expect(images.length).toBe(0)
          return jsonResponse({ id: 'page-2', url: 'https://app.notion.com/p/page-2' })
        },
      },
    ]) as unknown as typeof fetch
    try {
      const result = await service.submitFeedback(
        { type: 'bug', description: '正文仍然成功', screenshots: [shotPath] },
        '0.9.0',
        'darwin',
      )
      expect(result.success).toBe(true)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
