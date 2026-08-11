import { describe, expect, test } from 'bun:test'
import { buildSystemPrompt } from './agent-prompt-builder'

const BASE_CTX = {
  sessionId: 'test-session',
  permissionMode: 'plan' as const,
}

function build(ctx: Record<string, unknown>): string {
  return buildSystemPrompt({ ...BASE_CTX, ...ctx } as Parameters<typeof buildSystemPrompt>[0])
}

describe('编码优化总开关（optimizedCoding）', () => {
  test('默认关闭：不注入模型专属编码规范（含 DeepSeek 模型）', () => {
    const prompt = build({ currentModelId: 'deepseek-v4-flash' })
    expect(prompt).not.toContain('模型专属编码规范')
  })

  test('开启 + DeepSeek：注入编码规范', () => {
    const prompt = build({ currentModelId: 'deepseek-v4-flash', optimizedCoding: true })
    expect(prompt).toContain('模型专属编码规范（DeepSeek runtime）')
  })

  test('开启 + 非 DeepSeek：不注入 DeepSeek 专属规范', () => {
    const prompt = build({ currentModelId: 'claude-opus-4-8', optimizedCoding: true })
    expect(prompt).not.toContain('模型专属编码规范')
  })

  test('兼容旧字段：仅 codingMode=true 时同样视为开启（resolveOptimizedCodingEnabled）', () => {
    // prompt-builder 只认 optimizedCoding；兼容合并发生在 resolveOptimizedCodingEnabled（orchestrator 调用）
    const { resolveOptimizedCodingEnabled } = require('./agent-thinking-level')
    expect(resolveOptimizedCodingEnabled({ codingMode: true })).toBe(true)
    expect(resolveOptimizedCodingEnabled({ optimizedCoding: true, codingMode: false })).toBe(true)
    expect(resolveOptimizedCodingEnabled({})).toBe(false)
  })
})
