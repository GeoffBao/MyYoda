import { describe, expect, test } from 'bun:test'
import { isSafeDeleteTarget } from './destructive-file-policy'

describe('destructive file policy', () => {
  test('Given a capability root When deleting Then rejects the root itself', () => {
    expect(isSafeDeleteTarget('/workspace/session', ['/workspace/session'])).toBe(false)
  })

  test('Given a child file under a capability root When deleting Then allows the child', () => {
    expect(isSafeDeleteTarget('/workspace/session/report.md', ['/workspace/session'])).toBe(true)
  })

  test('Given a sibling with a similar prefix When deleting Then rejects it', () => {
    expect(isSafeDeleteTarget('/workspace/session-copy', ['/workspace/session'])).toBe(false)
  })

  test('Given no protected roots When deleting Then fails closed', () => {
    expect(isSafeDeleteTarget('/workspace/session/report.md', [])).toBe(false)
  })
})
