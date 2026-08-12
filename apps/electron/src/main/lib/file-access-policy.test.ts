import { describe, expect, test } from 'bun:test'
import type { FileAccessOptions } from '@myyoda/shared'
import { normalizeFileAccessOptions } from './file-access-policy'

describe('file access options policy', () => {
  test('Given legacy unrestricted input When normalizing Then drops the renderer-controlled bypass', () => {
    expect(normalizeFileAccessOptions({ sessionId: 'session-1', unrestricted: true } as unknown as FileAccessOptions)).toEqual({
      sessionId: 'session-1',
    })
  })

  test('Given malformed access input When normalizing Then keeps only typed safe fields', () => {
    expect(normalizeFileAccessOptions({
      sessionId: 123,
      workspaceSlug: 'workspace-1',
      candidateBasePaths: ['/safe', 42, ''],
      unrestricted: true,
    } as unknown as FileAccessOptions)).toEqual({
      workspaceSlug: 'workspace-1',
      candidateBasePaths: ['/safe'],
    })
  })
})
