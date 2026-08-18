/**
 * feedback-service 单元测试（GitHub Issues 语义）
 *
 * 覆盖：连接测试（成功/401/403/404/网络失败/未配置）、提交成功链路（仓库信息 →
 * user-attachments 截图上传 → labels → 创建 issue）、截图上传失败跳过、label 422
 * 降级重试、issue 创建失败落 v2 草稿（含已上传附件 URL）、去重、草稿列表/删除
 * （v1 旧格式 legacy 标记 + 非法文件名防护）。网络层用 scripted fetch mock，
 * 配置/草稿/去重记录落临时 HOME。
 */

import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
      return new Response(JSON.stringify({ message: 'no handler', url }), {
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

/** 草稿目录路径 */
function draftsDir(): string {
  return join(tempHome, configPaths.getConfigDirName(), 'feedback-drafts')
}

/** 读取当前所有草稿 JSON */
function readDrafts(): Array<Record<string, unknown>> {
  const dir = draftsDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((fileName) => fileName.endsWith('.json'))
    .map((fileName) => JSON.parse(readFileSync(join(dir, fileName), 'utf-8')) as Record<string, unknown>)
}

/** 写一个假截图文件（PNG 魔数） */
function writeFakeScreenshot(name = 'shot.png'): string {
  const shotPath = join(tempHome, name)
  writeFileSync(shotPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  return shotPath
}

describe('testFeedbackConnection', () => {
  test('成功：GET /repos/GeoffBao/MyYoda 返回 200', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = scriptedFetch([
      {
        match: (url) => url.includes('/repos/GeoffBao/MyYoda'),
        respond: async () => jsonResponse({ id: 12345, full_name: 'GeoffBao/MyYoda' }),
      },
    ]) as unknown as typeof fetch
    try {
      const result = await service.testFeedbackConnection({ token: 'github_pat_test' })
      expect(result.success).toBe(true)
      expect(result.message).toContain('凭证有效')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('401 → Token 无效提示', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = scriptedFetch([
      {
        match: (url) => url.includes('/repos/GeoffBao/MyYoda'),
        respond: async () => jsonResponse({ message: 'Bad credentials' }, 401),
      },
    ]) as unknown as typeof fetch
    try {
      const result = await service.testFeedbackConnection({ token: 'github_pat_bad' })
      expect(result.success).toBe(false)
      expect(result.message).toContain('Token 无效')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('403 → 权限不足提示', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = scriptedFetch([
      {
        match: (url) => url.includes('/repos/GeoffBao/MyYoda'),
        respond: async () => jsonResponse({ message: 'Forbidden' }, 403),
      },
    ]) as unknown as typeof fetch
    try {
      const result = await service.testFeedbackConnection({ token: 'github_pat_test' })
      expect(result.success).toBe(false)
      expect(result.message).toContain('权限不足')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('404 → 找不到目标仓库提示', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = scriptedFetch([
      {
        match: (url) => url.includes('/repos/GeoffBao/MyYoda'),
        respond: async () => jsonResponse({ message: 'Not Found' }, 404),
      },
    ]) as unknown as typeof fetch
    try {
      const result = await service.testFeedbackConnection({ token: 'github_pat_test' })
      expect(result.success).toBe(false)
      expect(result.message).toContain('找不到目标仓库')
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
      const result = await service.testFeedbackConnection({ token: 'github_pat_test' })
      expect(result.success).toBe(false)
      expect(result.message).toContain('网络')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('token 留空且无已存配置 → 请先填写', async () => {
    const result = await service.testFeedbackConnection({})
    expect(result.success).toBe(false)
    expect(result.message).toContain('请先填写')
  })

  test('token 留空时回退到已保存配置', async () => {
    service.saveFeedbackConfig({ token: 'github_pat_saved' })
    const originalFetch = globalThis.fetch
    globalThis.fetch = scriptedFetch([
      {
        match: (url) => url.includes('/repos/GeoffBao/MyYoda'),
        respond: async () => jsonResponse({ id: 12345 }),
      },
    ]) as unknown as typeof fetch
    try {
      const result = await service.testFeedbackConnection({})
      expect(result.success).toBe(true)
      expect(result.message).toContain('凭证有效')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('submitFeedback', () => {
  test('未配置 GitHub 凭证 → 失败并保存草稿', async () => {
    const result = await service.submitFeedback(
      { type: 'bug', description: '测试描述', screenshots: [] },
      '0.10.8',
      'darwin',
    )
    expect(result.success).toBe(false)
    expect(result.draftSaved).toBe(true)
    expect(result.error).toContain('尚未配置 GitHub')
    expect(readDrafts().length).toBeGreaterThan(0)
  })

  test('空描述 → 直接拒绝，不落草稿', async () => {
    service.saveFeedbackConfig({ token: 'github_pat_test' })
    const result = await service.submitFeedback({ type: 'bug', description: '   ', screenshots: [] }, '0.10.8', 'darwin')
    expect(result.success).toBe(false)
    expect(result.error).toContain('详细描述')
    expect(result.draftSaved).toBeUndefined()
    expect(readDrafts().length).toBe(0)
  })

  test('成功链路：仓库信息 → 截图上传 → labels → 创建 issue', async () => {
    service.saveFeedbackConfig({ token: 'github_pat_test' })
    const shotPath = writeFakeScreenshot()

    const originalFetch = globalThis.fetch
    let createdIssueBody: { title: string; body: string; labels: string[] } | null = null
    globalThis.fetch = scriptedFetch([
      {
        match: (url) => url.includes('uploads.github.com/user-attachments'),
        respond: async () => jsonResponse({ url: 'https://github.com/user-attachments/assets/abc-123' }),
      },
      {
        match: (url) => url.includes('/repos/GeoffBao/MyYoda/labels'),
        respond: async () => jsonResponse([{ name: 'bug' }, { name: 'enhancement' }]),
      },
      {
        match: (url) => url.includes('/repos/GeoffBao/MyYoda/issues'),
        respond: async (_url, init) => {
          createdIssueBody = JSON.parse(String(init?.body)) as { title: string; body: string; labels: string[] }
          return jsonResponse({ html_url: 'https://github.com/GeoffBao/MyYoda/issues/42' }, 201)
        },
      },
      {
        match: (url) => url.includes('/repos/GeoffBao/MyYoda'),
        respond: async () => jsonResponse({ id: 12345 }),
      },
    ]) as unknown as typeof fetch

    try {
      const result = await service.submitFeedback(
        { type: 'bug', description: '窗口闪退，复现步骤见截图', screenshots: [shotPath], contactEmail: 'a@b.com' },
        '0.10.8',
        'darwin',
      )
      expect(result.success).toBe(true)
      expect(result.issueUrl).toBe('https://github.com/GeoffBao/MyYoda/issues/42')

      expect(createdIssueBody).not.toBeNull()
      const body = createdIssueBody!
      expect(body.title.startsWith('[Bug 报告] ')).toBe(true)
      expect(body.body).toContain('<!-- 来自 MyYoda 应用内反馈 -->')
      expect(body.body).toContain('![截图 1](https://github.com/user-attachments/assets/abc-123)')
      expect(body.body).toContain('**环境信息**：')
      expect(body.labels).toEqual(['bug'])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('截图上传失败 → 跳过截图仍创建 issue 成功', async () => {
    service.saveFeedbackConfig({ token: 'github_pat_test' })
    const shotPath = writeFakeScreenshot()

    const originalFetch = globalThis.fetch
    let issueBodyText = ''
    globalThis.fetch = scriptedFetch([
      {
        match: (url) => url.includes('uploads.github.com/user-attachments'),
        respond: async () => jsonResponse({ message: 'boom' }, 500),
      },
      {
        match: (url) => url.includes('/repos/GeoffBao/MyYoda/labels'),
        respond: async () => jsonResponse([{ name: 'bug' }]),
      },
      {
        match: (url) => url.includes('/repos/GeoffBao/MyYoda/issues'),
        respond: async (_url, init) => {
          const body = JSON.parse(String(init?.body)) as { body: string }
          issueBodyText = body.body
          return jsonResponse({ html_url: 'https://github.com/GeoffBao/MyYoda/issues/43' })
        },
      },
      {
        match: (url) => url.includes('/repos/GeoffBao/MyYoda'),
        respond: async () => jsonResponse({ id: 12345 }),
      },
    ]) as unknown as typeof fetch
    try {
      const result = await service.submitFeedback(
        { type: 'bug', description: '正文仍然成功', screenshots: [shotPath] },
        '0.10.8',
        'darwin',
      )
      expect(result.success).toBe(true)
      expect(result.screenshotsSkipped).toBe(true)
      expect(issueBodyText).not.toContain('![截图')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('label 不存在 422 → 降级重试不带 label 并成功', async () => {
    service.saveFeedbackConfig({ token: 'github_pat_test' })

    const originalFetch = globalThis.fetch
    let postCalls = 0
    const bodies: Array<{ title: string; body: string; labels?: string[] }> = []
    globalThis.fetch = scriptedFetch([
      {
        match: (url) => url.includes('/repos/GeoffBao/MyYoda/labels'),
        respond: async () => jsonResponse([{ name: 'bug' }, { name: 'enhancement' }]),
      },
      {
        match: (url) => url.includes('/repos/GeoffBao/MyYoda/issues'),
        respond: async (_url, init) => {
          postCalls += 1
          const body = JSON.parse(String(init?.body)) as { title: string; body: string; labels?: string[] }
          bodies.push(body)
          if (postCalls === 1) return jsonResponse({ message: 'Validation Failed' }, 422)
          return jsonResponse({ html_url: 'https://github.com/GeoffBao/MyYoda/issues/44' })
        },
      },
      {
        match: (url) => url.includes('/repos/GeoffBao/MyYoda'),
        respond: async () => jsonResponse({ id: 12345 }),
      },
    ]) as unknown as typeof fetch
    try {
      const result = await service.submitFeedback({ type: 'bug', description: 'label 重试', screenshots: [] }, '0.10.8', 'darwin')
      expect(result.success).toBe(true)
      expect(result.issueUrl).toBe('https://github.com/GeoffBao/MyYoda/issues/44')
      expect(postCalls).toBe(2)
      expect(bodies[0]?.labels).toEqual(['bug'])
      expect(bodies[1]?.labels).toBeUndefined()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('创建 issue 500 → 失败并保存 v2 草稿（含已上传附件 URL）', async () => {
    service.saveFeedbackConfig({ token: 'github_pat_test' })
    const shotPath = writeFakeScreenshot()

    const originalFetch = globalThis.fetch
    globalThis.fetch = scriptedFetch([
      {
        match: (url) => url.includes('uploads.github.com/user-attachments'),
        respond: async () => jsonResponse({ url: 'https://github.com/user-attachments/assets/def-456' }),
      },
      {
        match: (url) => url.includes('/repos/GeoffBao/MyYoda/labels'),
        respond: async () => jsonResponse([{ name: 'bug' }]),
      },
      {
        match: (url) => url.includes('/repos/GeoffBao/MyYoda/issues'),
        respond: async () => jsonResponse({ message: 'Server Error' }, 500),
      },
      {
        match: (url) => url.includes('/repos/GeoffBao/MyYoda'),
        respond: async () => jsonResponse({ id: 12345 }),
      },
    ]) as unknown as typeof fetch
    try {
      const result = await service.submitFeedback(
        { type: 'bug', description: '失败降级草稿', screenshots: [shotPath] },
        '0.10.8',
        'darwin',
      )
      expect(result.success).toBe(false)
      expect(result.draftSaved).toBe(true)
      expect(result.error).toContain('GitHub 返回错误（500）')

      const drafts = readDrafts()
      expect(drafts.length).toBe(1)
      expect(drafts[0]?.version).toBe(2)
      expect(drafts[0]?.uploadedAssetUrls).toContain('https://github.com/user-attachments/assets/def-456')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('去重：相同类型+描述重复提交返回 duplicate=true', async () => {
    service.saveFeedbackConfig({ token: 'github_pat_test' })

    const originalFetch = globalThis.fetch
    globalThis.fetch = scriptedFetch([
      {
        match: (url) => url.includes('/repos/GeoffBao/MyYoda/labels'),
        respond: async () => jsonResponse([{ name: 'bug' }]),
      },
      {
        match: (url) => url.includes('/repos/GeoffBao/MyYoda/issues'),
        respond: async () => jsonResponse({ html_url: 'https://github.com/GeoffBao/MyYoda/issues/45' }),
      },
      {
        match: (url) => url.includes('/repos/GeoffBao/MyYoda'),
        respond: async () => jsonResponse({ id: 12345 }),
      },
    ]) as unknown as typeof fetch
    try {
      const input = { type: 'bug' as const, description: '去重测试描述', screenshots: [] }
      const first = await service.submitFeedback(input, '0.10.8', 'darwin')
      expect(first.success).toBe(true)
      expect(first.duplicate).toBe(false)

      const second = await service.submitFeedback(input, '0.10.8', 'darwin')
      expect(second.success).toBe(true)
      expect(second.duplicate).toBe(true)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('listFeedbackDrafts / deleteFeedbackDraft', () => {
  function writeDraftFile(fileName: string, content: Record<string, unknown>): void {
    const dir = draftsDir()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, fileName), JSON.stringify(content, null, 2), 'utf-8')
  }

  test('v2 与 v1 旧格式草稿：list 标记 legacy，delete 精确删除', () => {
    writeDraftFile('draft-v2.json', {
      version: 2,
      createdAt: '2026-08-17T06:00:00.000Z',
      input: { type: 'bug', description: 'v2 草稿', screenshots: [] },
      appVersion: '0.10.8',
      platform: 'darwin',
    })
    writeDraftFile('draft-old.json', {
      version: 1,
      createdAt: '2026-08-16T06:00:00.000Z',
      input: { type: 'feature', description: 'v1 旧草稿', screenshots: [] },
    })

    const all = service.listFeedbackDrafts()
    expect(all).toHaveLength(2)

    const v2 = all.find((item) => item.fileName === 'draft-v2.json')
    const v1 = all.find((item) => item.fileName === 'draft-old.json')
    expect(v2?.version).toBe(2)
    expect(v2?.legacy).toBe(false)
    expect(v1?.version).toBe(1)
    expect(v1?.legacy).toBe(true)

    expect(service.deleteFeedbackDraft('draft-v2.json')).toBe(true)
    const remaining = service.listFeedbackDrafts()
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.fileName).toBe('draft-old.json')
  })

  test('非法文件名（路径穿越）与不存在文件 → 返回 false', () => {
    expect(service.deleteFeedbackDraft('../x.json')).toBe(false)
    expect(service.deleteFeedbackDraft('no-such.json')).toBe(false)
  })
})
