import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

describe('AgentOrchestrator 生命周期约束', () => {
  test('终态回调不得同步重读整份会话 JSONL', () => {
    const source = readFileSync(import.meta.dir + '/agent-orchestrator.ts', 'utf-8')

    expect(source).not.toMatch(
      /(?:completeRun|idleComplete|failRun)\([^;\n]*getAgentSessionMessages\(sessionId\)/,
    )
  })

  test('stop 仅在存在 active run 时清 AskUser，stopAll 仍全量释放', () => {
    const source = readFileSync(import.meta.dir + '/agent-orchestrator.ts', 'utf-8')
    const stopStart = source.indexOf('  stop(sessionId: string, stopBeforeRun = false): void {')
    const stopBody = source.slice(stopStart, source.indexOf('  isActive(sessionId: string): boolean {'))
    const stopAllStart = source.indexOf('  stopAll(): void {')
    const stopAllBody = source.slice(stopAllStart, stopAllStart + 900)

    expect(stopBody).toContain('if (runGeneration != null)')
    expect(stopBody).toContain('askUserService.clearSessionPending(sessionId)')
    expect(stopAllBody).toContain('askUserService.clearAllPending()')
    expect(stopAllBody).toContain('permissionService.clearAllPending()')
    expect(stopAllBody).toContain('exitPlanService.clearAllPending()')
  })
})
