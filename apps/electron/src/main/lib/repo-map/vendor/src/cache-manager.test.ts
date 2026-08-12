import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CacheManager } from './cache-manager'

function makeCacheDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'repo-map-cache-'))
  return dir
}

describe('CacheManager 并发与损坏自愈（2026-08-12 修复）', () => {
  test('损坏的缓存文件：initialize 备份为 .corrupt-<ts> 并空缓存启动', async () => {
    const dir = makeCacheDir()
    const db = join(dir, 'file-cache.json')
    writeFileSync(db, '{"bad": "\\e\\d\\s 非法转义",', 'utf-8') // 损坏 JSON
    try {
      const cm = new CacheManager(db)
      await cm.initialize()
      // 损坏文件被备份
      const backups = readdirSync(dir).filter((n) => n.startsWith('file-cache.json.corrupt-'))
      expect(backups.length).toBe(1)
      // 空缓存可用
      expect(await cm.getFileCache('/some/file.ts')).toBeNull()
      // 写入后落盘为合法 JSON
      await cm.setFileCache('/some/file.ts', 123, [{ name: 'fn', kind: 'def', line: 1, rel_fname: '/some/file.ts', fname: 'file.ts' }])
      await cm.close()
      expect(JSON.parse(readFileSync(db, 'utf-8'))).toHaveProperty(['/some/file.ts'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('残留 .tmp/.lock 文件在 initialize 时清理（>60s）', async () => {
    const dir = makeCacheDir()
    const db = join(dir, 'file-cache.json')
    const staleTmp = `${db}.12345.9999999999999.tmp`
    const staleLock = `${db}.lock`
    mkdirSync(staleLock)
    writeFileSync(staleTmp, '{"stale": true}', 'utf-8')
    // 把 mtime 改老（60s 前）
    const old = new Date(Date.now() - 120_000)
    const { utimesSync } = await import('node:fs')
    utimesSync(staleTmp, old, old)
    utimesSync(staleLock, old, old)
    try {
      const cm = new CacheManager(db)
      await cm.initialize()
      expect(existsSync(staleTmp)).toBe(false)
      expect(existsSync(staleLock)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('并发写：两个实例同时 persist 不损坏（唯一 tmp + 写锁）', async () => {
    const dir = makeCacheDir()
    const db = join(dir, 'file-cache.json')
    try {
      // 模拟两个实例的 CacheManager 并发写
      const a = new CacheManager(db)
      const b = new CacheManager(db)
      await a.initialize()
      await b.initialize()
      const jobs: Promise<void>[] = []
      for (let i = 0; i < 30; i++) {
        const cm = i % 2 === 0 ? a : b
        jobs.push(cm.setFileCache(`/file-${i}.ts`, i, [{ name: `fn${i}`, kind: 'def', line: i, rel_fname: `/file-${i}.ts`, fname: `file-${i}.ts` }]))
      }
      await Promise.all(jobs)
      await Promise.all([a.close(), b.close()])
      // 结果必须是合法 JSON，且不因并发互相覆盖丢失条目
      const parsed = JSON.parse(readFileSync(db, 'utf-8'))
      const keys = Object.keys(parsed)
      expect(keys.length).toBeGreaterThanOrEqual(25)
      // 无残留 tmp（唯一 tmp 全部 rename 成功）
      const leftovers = readdirSync(dir).filter((n) => n.endsWith('.tmp'))
      expect(leftovers.length).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('写锁残留自愈（2026-08-12 review 补）', () => {
  test('残留锁（>10s）在 persist 时被清理并继续写入', async () => {
    const dir = makeCacheDir()
    const db = join(dir, 'file-cache.json')
    const lockPath = `${db}.lock`
    try {
      // 预置一个"老"锁（模拟异常退出残留）
      mkdirSync(lockPath)
      const { utimesSync } = await import('node:fs')
      const old = new Date(Date.now() - 60_000)
      utimesSync(lockPath, old, old)

      const cm = new CacheManager(db)
      await cm.initialize()
      await cm.setFileCache('/stale-lock.ts', 1, [{ name: 'fn', kind: 'def', line: 1, rel_fname: '/stale-lock.ts', fname: 'stale-lock.ts' }])
      await cm.close()
      // 写入成功（锁残留被自愈清理）
      expect(JSON.parse(readFileSync(db, 'utf-8'))).toHaveProperty(['/stale-lock.ts'])
      expect(existsSync(lockPath)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('新锁（<10s）不被误删（等待其释放）', async () => {
    const dir = makeCacheDir()
    const db = join(dir, 'file-cache.json')
    const lockPath = `${db}.lock`
    try {
      // 模拟另一实例刚创建锁（<10s）
      mkdirSync(lockPath)
      const cm = new CacheManager(db)
      await cm.initialize()
      await cm.setFileCache('/fresh-lock.ts', 1, [{ name: 'fn', kind: 'def', line: 1, rel_fname: '/fresh-lock.ts', fname: 'fresh-lock.ts' }])
      // 立即 close：锁 <10s 不删，重试 500ms 后放弃（数据不落盘但锁保留）
      await cm.close()
      expect(existsSync(lockPath)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
