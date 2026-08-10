/**
 * Repo Map 冒烟测试
 *
 * 用 MyYoda 仓库自身的 packages/shared/src/types 作为解析对象，
 * 验证：核心 WASM 定位、queries 资源加载、符号提取、PageRank、渲染整链路。
 */
import { describe, expect, test } from 'bun:test'
import * as path from 'node:path'
import { getRepoMap } from './vendor/src/index'

// repo-map/ → apps/electron/src/main/lib/repo-map
// 向上 6 级到 workspace 根：lib(1) main(2) src(3) electron(4) apps(5) 根(6)
const workspaceRoot = path.resolve(import.meta.dir, '..', '..', '..', '..', '..', '..')
const sampleDir = path.join(workspaceRoot, 'packages', 'shared', 'src', 'types')

describe('repo-map vendor smoke', () => {
  test('getRepoMap 在真实 TS 目录上生成非空地图', async () => {
    const map = await getRepoMap(sampleDir, {
      maxLines: 200,
      excludePatterns: [],
    })

    expect(typeof map).toBe('string')
    expect(map.length).toBeGreaterThan(100)

    // 输出应包含文件名（如 channel.ts 或 reasoning-profile.ts）
    const anyFileShown = /[\w-]+\.ts:/.test(map)
    expect(anyFileShown).toBe(true)

    // 输出应包含树形代码行
    expect(map).toContain('├──')
  })

  test('maxLines 极小时降级为文件列表', async () => {
    const map = await getRepoMap(sampleDir, {
      maxLines: 3,
      excludePatterns: [],
    })

    // 文件数 > maxLines 时只列文件名
    expect(map.split('\n').length).toBeLessThanOrEqual(4)
  })

  test('mention 感知：提到标识符后地图仍可生成', async () => {
    const map = await getRepoMap(sampleDir, {
      maxLines: 100,
      excludePatterns: [],
      mentionedIdents: new Set(['ProviderType']),
      mentionedFiles: new Set([path.join(sampleDir, 'channel.ts')]),
    })

    expect(typeof map).toBe('string')
    expect(map.length).toBeGreaterThan(50)
  })
})
