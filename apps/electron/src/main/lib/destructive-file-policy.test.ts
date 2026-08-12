import { describe, expect, test } from 'bun:test'
import { join, resolve } from 'node:path'
import { isSafeDeleteTarget } from './destructive-file-policy'

// 参数语义为已 resolve 的绝对路径；用 resolve 构造保证跨平台
const WS = resolve('/agent-workspaces/default')
const MEM = join(WS, 'memory')

describe('destructive file policy', () => {
  test('Given a forbidden root When deleting Then rejects the root itself', () => {
    expect(isSafeDeleteTarget(join(WS, 'session'), [join(WS, 'session')], [`${WS}`])).toBe(false)
  })

  test('Given a child file under an allowed root When deleting Then allows the child', () => {
    expect(isSafeDeleteTarget(join(WS, 'session', 'report.md'), [], [join(WS, 'session')])).toBe(true)
  })

  test('Given a sibling with a similar prefix When deleting Then rejects it', () => {
    expect(isSafeDeleteTarget(join(WS, 'session-copy'), [], [join(WS, 'session')])).toBe(false)
  })

  test('Given no allowed roots When deleting Then fails closed', () => {
    expect(isSafeDeleteTarget(join(WS, 'session', 'report.md'), [], [])).toBe(false)
  })

  // ─── root guard bypass regression ──────────────────────────────────
  test('Given workspace root in forbiddenRoots and a broader parent in allowedRoots When deleting Then rejects workspace root', () => {
    // 复现先前单参数 some() 实现的绕过：workspace root 是 agent-workspaces/ 的子项，
    // 会被父级根判定为 child 而允许递归删除。
    expect(isSafeDeleteTarget(WS, [WS], ['/agent-workspaces'])).toBe(false)
  })

  test('Given memory dir in forbiddenRoots and workspace in allowedRoots When deleting Then rejects memory dir', () => {
    expect(isSafeDeleteTarget(MEM, [MEM, WS], ['/agent-workspaces'])).toBe(false)
  })

  test('Given session dir in forbiddenRoots and workspace in allowedRoots When deleting Then rejects session dir', () => {
    expect(isSafeDeleteTarget(`${WS}/abc-123`, [`${WS}/abc-123`], ['/agent-workspaces'])).toBe(false)
  })
})
