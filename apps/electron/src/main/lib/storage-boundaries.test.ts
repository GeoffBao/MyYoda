import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isWorkspaceMetadataDir } from './storage-boundaries'

/**
 * 回归测试：防止"忘记登记新的每工作区顶层目录"再次导致孤儿清理误删真实数据
 * （历史事故：projects/ 和 excalidraw/ 曾经漏登记，见 storage-boundaries.ts 顶部注释）。
 *
 * 从 config-paths.ts 源码里反射出所有 `join(getAgentWorkspacePath(slug), '<字面量>')` 形式
 * 定义的顶层子路径，过滤掉文件（带扩展名）和动态路径（如 sessionId 变量），
 * 断言剩下的每一个目录字面量都在 isWorkspaceMetadataDir() 的白名单里。
 *
 * 注意：这只能覆盖 config-paths.ts 里定义的目录。跨包定义的目录（如
 * packages/shared/src/projects/storage.ts 的 'projects'）无法被反射，需要
 * 在 storage-boundaries.ts 里手动登记并在下面的 KNOWN_CROSS_PACKAGE_DIRS 里补一条，
 * 保证这条测试知道要去检查它。
 */
const KNOWN_CROSS_PACKAGE_DIRS = ['projects', 'tasks', 'labels', 'expert-bindings']

function extractTopLevelWorkspaceDirLiterals(): string[] {
  const configPathsSource = readFileSync(
    join(__dirname, 'config-paths.ts'),
    'utf-8',
  )
  const pattern = /getAgentWorkspacePath\([^)]*\),\s*'([^']+)'/g
  const literals: string[] = []
  for (const match of configPathsSource.matchAll(pattern)) {
    const literal = match[1]
    if (literal && !literal.includes('.')) literals.push(literal) // 排除 mcp.json / session-groups.json 等文件
  }
  return literals
}

describe('Workspace metadata cleanup boundaries', () => {
  test('Outbox 位于 workspace-files 下，整个 metadata 根不会被 session orphan 清理', () => {
    expect(isWorkspaceMetadataDir('workspace-files')).toBe(true)
    expect(isWorkspaceMetadataDir('Outbox')).toBe(false)
  })

  test('config-paths.ts 里定义的每一个顶层工作区目录都必须在清理白名单里', () => {
    const literals = extractTopLevelWorkspaceDirLiterals()
    expect(literals.length).toBeGreaterThan(0) // 反射本身要先能找到东西，否则这条测试是假绿

    for (const dirName of literals) {
      expect(isWorkspaceMetadataDir(dirName)).toBe(true)
    }
  })

  test('跨包定义的顶层工作区目录（无法被 config-paths.ts 反射）必须手动登记在白名单里', () => {
    for (const dirName of KNOWN_CROSS_PACKAGE_DIRS) {
      expect(isWorkspaceMetadataDir(dirName)).toBe(true)
    }
  })

  test('MyYoda Workspace Memory 的 memory/ 顶层目录必须受 orphan cleanup 保护', () => {
    expect(isWorkspaceMetadataDir('memory')).toBe(true)
  })

  test('recovery trash 顶层目录必须受 orphan cleanup 保护', () => {
    expect(isWorkspaceMetadataDir('.recovery-trash')).toBe(true)
  })
})
