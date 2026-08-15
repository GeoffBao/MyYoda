import { describe, expect, test } from 'bun:test'
import { rewriteMarkdownMedia, rewriteRemoteMediaUrl } from './media-rewrite'

/** 测试用 register：给白名单地址加前缀标记 */
const fakeRegister = (url: string): string | null => {
  if (url.includes('user-images.githubusercontent.com') || url.includes('github.com')) {
    return `myyoda-remote://token-for-${encodeURIComponent(url.slice(0, 24))}`
  }
  return null
}

describe('rewriteMarkdownMedia', () => {
  test('白名单图片地址被重写为代理 URL', () => {
    const markdown = '正文 ![截图](https://user-images.githubusercontent.com/1/2.png) 结尾'
    const result = rewriteMarkdownMedia(markdown, fakeRegister)
    expect(result).toContain('myyoda-remote://')
    expect(result).not.toContain('https://user-images.githubusercontent.com')
    expect(result).toContain('正文')
    expect(result).toContain('结尾')
  })

  test('非白名单地址保持原样', () => {
    const markdown = '![外链图](https://codesandbox.io/a.png)'
    const result = rewriteMarkdownMedia(markdown, fakeRegister)
    expect(result).toBe('![image](https://codesandbox.io/a.png)')
  })

  test('上传未完成占位符被剥离', () => {
    const markdown = '前文\n![Uploading 20241122.webp…]()\n后文'
    const result = rewriteMarkdownMedia(markdown, fakeRegister)
    expect(result).not.toContain('Uploading')
    expect(result).toContain('前文')
    expect(result).toContain('后文')
  })

  test('相对路径图片解析为 github.com 绝对地址并重写', () => {
    const markdown = '![assets](/assets/images/a.png)'
    const result = rewriteMarkdownMedia(markdown, fakeRegister)
    expect(result).toContain('myyoda-remote://')
  })

  test('多图混合场景', () => {
    const markdown = '![a](https://user-images.githubusercontent.com/1/2.png)\n![b](https://cdn.jsdelivr.net/x/y.png)\n![c](https://other.example.com/c.png)'
    const result = rewriteMarkdownMedia(markdown, fakeRegister)
    // jsDelivr 不在 fakeRegister 白名单 → 保持原样
    expect(result).toContain('https://cdn.jsdelivr.net/x/y.png')
    // other.example.com 保持原样
    expect(result).toContain('https://other.example.com/c.png')
  })
})

describe('rewriteRemoteMediaUrl', () => {
  test('头像地址被重写', () => {
    const result = rewriteRemoteMediaUrl('https://avatars.githubusercontent.com/u/1?v=4', () => 'myyoda-remote://x')
    expect(result).toBe('myyoda-remote://x')
  })

  test('register 返回 null 时保持原值', () => {
    const result = rewriteRemoteMediaUrl('https://a.com/b.png', () => null)
    expect(result).toBe('https://a.com/b.png')
  })

  test('undefined 原样返回', () => {
    expect(rewriteRemoteMediaUrl(undefined, fakeRegister)).toBeUndefined()
  })
})
