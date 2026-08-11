import { describe, expect, test } from 'bun:test'
import { resolveSafeAttachmentPath } from './attachment-path-policy'

describe('attachment path policy', () => {
  test('Given a conversation-relative attachment path When resolving Then keeps it under attachments root', () => {
    expect(resolveSafeAttachmentPath('/config/attachments', 'conversation-1/file.pdf')).toBe(
      '/config/attachments/conversation-1/file.pdf',
    )
  })

  test('Given an attachment traversal path When resolving Then rejects it', () => {
    expect(() => resolveSafeAttachmentPath('/config/attachments', '../outside.txt')).toThrow()
  })
})
