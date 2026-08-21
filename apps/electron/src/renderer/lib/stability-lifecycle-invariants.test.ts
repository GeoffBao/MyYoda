import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const rendererDir = join(import.meta.dir, '..')

function readRendererSource(relativePath: string): string {
  return readFileSync(join(rendererDir, relativePath), 'utf-8')
}

describe('渲染进程稳定性生命周期约束', () => {
  test('全局 Agent 监听器在终态释放自动打开变更面板的 run 记录', () => {
    const source = readRendererSource('hooks/useGlobalAgentListeners.ts')
    const cleanupCount = source.match(/autoActivatedChangeTurns\.delete\(data\.sessionId\)/g)?.length ?? 0

    expect(cleanupCount).toBeGreaterThanOrEqual(2)
  })

  test('飞书连接轮询在组件卸载时停止', () => {
    const source = readRendererSource('components/settings/FeishuSettings.tsx')

    expect(source).toContain('clearBotConnectionPolling')
    expect(source).toContain('botConnectionGenerationRef.current += 1')
    expect(source).toContain('mountedRef.current = false')
    expect(source).toContain('pollGeneration !== botConnectionGenerationRef.current')
  })
})
