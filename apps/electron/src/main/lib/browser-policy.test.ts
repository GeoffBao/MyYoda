import { describe, expect, test } from 'bun:test'
import {
  BING_SEARCH_URL,
  GOOGLE_SEARCH_URL,
  USER_NEW_TAB_FALLBACK_URL,
  USER_NEW_TAB_URL,
  normalizeBrowserUrl,
  resolveBrowserDestinationWithFallback,
} from './browser-policy'

describe('browser policy URL normalization', () => {
  test('uses HTTPS for explicit port 443 even on local network hosts', () => {
    expect(normalizeBrowserUrl('localhost:443')).toBe('https://localhost:443')
    expect(normalizeBrowserUrl('192.168.1.10:443/admin')).toBe('https://192.168.1.10:443/admin')
  })

  test('keeps non-443 local development ports on HTTP', () => {
    expect(normalizeBrowserUrl('localhost:3000')).toBe('http://localhost:3000')
    expect(normalizeBrowserUrl('192.168.1.10:8080')).toBe('http://192.168.1.10:8080')
  })
})

describe('browser destination fallback', () => {
  test('adds Bing fallback only for the managed browser default new tab URL', () => {
    expect(resolveBrowserDestinationWithFallback(USER_NEW_TAB_URL)).toEqual({
      url: USER_NEW_TAB_URL,
      fallbackUrl: USER_NEW_TAB_FALLBACK_URL,
    })
    expect(resolveBrowserDestinationWithFallback('https://www.google.com')).toEqual({
      url: 'https://www.google.com',
    })
  })

  test('adds Bing fallback for search text but not explicit URLs', () => {
    const query = encodeURIComponent('MyYoda release')
    expect(resolveBrowserDestinationWithFallback('MyYoda release')).toEqual({
      url: `${GOOGLE_SEARCH_URL}?q=${query}`,
      fallbackUrl: `${BING_SEARCH_URL}?q=${query}`,
    })
    expect(resolveBrowserDestinationWithFallback('example.com/docs')).toEqual({
      url: 'https://example.com/docs',
    })
  })
})
