import { describe, expect, test } from 'bun:test'
import {
  buildPageTreeFromFileNames,
  friendlyWikiError,
  isWikiPageNameSafe,
  parseSidebar,
  rewriteWikiMedia,
} from './wiki-pages'

describe('parseSidebar', () => {
  test('解析两层嵌套并排除下划线页面', () => {
    const md = [
      '* [首页](Home)',
      '* [指南](Guide)',
      '  * [安装](Install)',
      '    * [国内网络](Install-CN)',
      '* [_Sidebar](_Sidebar)',
      '',
      '# 标题行应被忽略',
    ].join('\n')
    const tree = parseSidebar(md)
    expect(tree.fromSidebar).toBe(true)
    expect(tree.nodes).toHaveLength(2)
    expect(tree.nodes[0]).toEqual({ name: 'Home', title: '首页', depth: 0, children: [] })
    const guide = tree.nodes[1]!
    expect(guide.children).toHaveLength(1)
    expect(guide.children[0]!.name).toBe('Install')
    expect(guide.children[0]!.children).toHaveLength(1)
    expect(guide.children[0]!.children[0]!.name).toBe('Install-CN')
  })

  test('空内容返回空树 fromSidebar=false', () => {
    const tree = parseSidebar('')
    expect(tree.nodes).toEqual([])
    expect(tree.fromSidebar).toBe(false)
  })
})

describe('buildPageTreeFromFileNames', () => {
  test('Home 置顶，其余按名称排序，排除下划线文件', () => {
    const tree = buildPageTreeFromFileNames(['Guide.md', 'Home.md', '_Sidebar.md', 'FAQ.md'])
    expect(tree.fromSidebar).toBe(false)
    expect(tree.nodes.map((n) => n.name)).toEqual(['Home', 'FAQ', 'Guide'])
    expect(tree.nodes[0]!.title).toBe('Home')
  })
})

describe('isWikiPageNameSafe', () => {
  test('合法中文名与常规名', () => {
    expect(isWikiPageNameSafe('使用指南')).toBe(true)
    expect(isWikiPageNameSafe('Install-CN')).toBe(true)
  })
  test('拒绝路径穿越与内部页面', () => {
    expect(isWikiPageNameSafe('../etc/passwd')).toBe(false)
    expect(isWikiPageNameSafe('a/b')).toBe(false)
    expect(isWikiPageNameSafe('_Sidebar')).toBe(false)
    expect(isWikiPageNameSafe('')).toBe(false)
  })
})

describe('rewriteWikiMedia', () => {
  const register = (url: string): string | null =>
    url.includes('raw.githubusercontent.com') ? `myyoda-remote://${encodeURIComponent(url)}` : null

  test('相对路径图片解析为 raw wiki 地址并注册代理', () => {
    const out = rewriteWikiMedia('![a](assets/logo.png)\n![b](./img/x.jpg)', register)
    expect(out).toContain('myyoda-remote://')
    expect(out).toContain('raw.githubusercontent.com')
  })

  test('绝对 http 图片与 data URI 原样保留', () => {
    const md = '![a](https://example.com/x.png) ![b](data:image/png;base64,xx)'
    expect(rewriteWikiMedia(md, register)).toBe(md)
  })
})

describe('friendlyWikiError', () => {
  test('git 仓库不存在 → 文档库尚未创建', () => {
    const out = friendlyWikiError("fatal: remote error: Repository not found.")
    expect(out).toContain('尚未创建')
  })

  test('网络错误 → 提示检查代理', () => {
    const out = friendlyWikiError('fatal: unable to access xxx: Could not resolve host: github.com')
    expect(out).toContain('代理')
  })

  test('其他错误 → 通用文案', () => {
    expect(friendlyWikiError('boom')).toBe('文档库拉取失败，请稍后重试')
  })
})
