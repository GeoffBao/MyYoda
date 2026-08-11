import { describe, expect, test } from 'bun:test'
import { isResolvedHtmlPreviewResourcePath } from './file-preview-service'

describe('HTML preview resource boundaries', () => {
  test('accepts referenced assets under a Windows directory root', () => {
    expect(isResolvedHtmlPreviewResourcePath('C:\\preview\\page\\assets\\style.css', 'C:\\preview\\page', '\\')).toBe(true)
  })

  test('rejects sibling paths that merely share the same prefix', () => {
    expect(isResolvedHtmlPreviewResourcePath('C:\\preview\\page-other\\style.css', 'C:\\preview\\page', '\\')).toBe(false)
  })
})
