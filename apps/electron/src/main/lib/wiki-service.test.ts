import { afterAll, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getWikiPage, getWikiPages, refreshWikiCache } from './wiki-service'

/** 本地 fixture wiki 仓库（git init + 提交 Home/Guide/_Sidebar），返回目录路径 */
function createFixtureWiki(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wiki-fixture-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 'test@test.local'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: dir })
  writeFileSync(join(dir, 'Home.md'), '# 首页\n\n欢迎使用。\n\n![logo](assets/logo.png)\n')
  writeFileSync(join(dir, 'Guide.md'), '# 使用指南\n\n指南正文')
  writeFileSync(join(dir, '_Sidebar.md'), '* [首页](Home)\n* [指南](Guide)\n')
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'assets', 'logo.png'), 'fake-bytes')
  execFileSync('git', ['add', '-A'], { cwd: dir })
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir })
  return dir
}

const fixture = createFixtureWiki()
const cacheDir = mkdtempSync(join(tmpdir(), 'wiki-cache-'))

/**
 * 同步刷新缓存并重试：test 2 的非强制读取会派生后台刷新（fetch/reset），
 * 与后续测试的 git 操作并发时会撞 shallow.lock/index.lock，这里重试等待后台任务结束。
 */
async function refreshWikiCacheWithRetry(cacheDir: string, attempts = 20): Promise<string> {
  let lastError: unknown = null
  for (let i = 0; i < attempts; i++) {
    try {
      return await refreshWikiCache(cacheDir)
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  throw lastError
}

afterAll(() => {
  rmSync(fixture, { recursive: true, force: true })
  rmSync(cacheDir, { recursive: true, force: true })
})

describe('wiki-service（本地 fixture 仓库）', () => {
  test('首次克隆返回 commit hash，页面树来自 _Sidebar', async () => {
    const hash = await refreshWikiCache(cacheDir, `file://${fixture}`)
    expect(hash).toMatch(/^[0-9a-f]{40}$/)

    const result = await getWikiPages(null, true, cacheDir)
    expect(result.tree.fromSidebar).toBe(true)
    expect(result.tree.nodes.map((n) => n.name)).toEqual(['Home', 'Guide'])
    expect(result.fromCache).toBe(false)
    expect(result.commitHash).toBe(hash)
  })

  test('非强制读取直接返回缓存（不触发网络）', async () => {
    const result = await getWikiPages(null, false, cacheDir)
    expect(result.tree.nodes).toHaveLength(2)
    // 非强制读取会派生后台刷新（fire-and-forget），本测试等它结束再退出，
    // 避免与后续测试的 git 操作并发撞 shallow.lock/index.lock
    await refreshWikiCacheWithRetry(cacheDir)
  })

  test('fixture 追加提交后 force 刷新拿到新 hash', async () => {
    const before = { commitHash: await refreshWikiCacheWithRetry(cacheDir) }
    writeFileSync(join(fixture, 'FAQ.md'), '# FAQ\n\n常见问题')
    writeFileSync(join(fixture, '_Sidebar.md'), '* [首页](Home)\n* [指南](Guide)\n* [FAQ](FAQ)\n')
    execFileSync('git', ['add', '-A'], { cwd: fixture })
    execFileSync('git', ['commit', '-q', '-m', 'add faq'], { cwd: fixture })

    const result = await getWikiPages(null, true, cacheDir)
    expect(result.tree.nodes.map((n) => n.name)).toContain('FAQ')
    expect(result.commitHash).not.toBe(before.commitHash)
  })

  test('单页正文：相对路径图片重写为代理 URL，htmlUrl 正确', () => {
    const page = getWikiPage('Home', cacheDir)
    expect(page.markdown).toContain('myyoda-remote://')
    expect(page.markdown).not.toContain('](assets/logo.png)')
    expect(page.htmlUrl).toBe('https://github.com/GeoffBao/MyYoda/wiki/Home')
  })

  test('非法页面名抛错', () => {
    expect(() => getWikiPage('../etc/passwd', cacheDir)).toThrow()
    expect(() => getWikiPage('NoSuchPage', cacheDir)).toThrow()
  })
})
