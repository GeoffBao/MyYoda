/**
 * Wiki 页面树与媒体重写纯逻辑（无 IO，便于单测）
 *
 * - _Sidebar.md 解析：`* [标题](页面名)` + 缩进层级（2 空格 = 1 层）
 * - fallback：文件列表构建平铺树（Home 置顶）
 * - 媒体重写：相对路径图片解析到 raw.githubusercontent.com/wiki 后交给远程媒体注册
 */
import type { WikiPageNode, WikiPageTree } from '@myyoda/shared'

/** raw 访问 wiki 文件的基础地址（wiki 默认分支 master） */
export const WIKI_RAW_BASE = 'https://raw.githubusercontent.com/wiki/GeoffBao/MyYoda/master'

interface SidebarItem {
  depth: number
  title: string
  name: string
}

/** 解析单行 `* [标题](页面名)`；缩进 2 空格 = 1 层；下划线页面（_Sidebar/_Footer）返回 null */
function parseSidebarLine(line: string): SidebarItem | null {
  const match = /^( *)\*\s+\[([^\]]+)\]\(([^)\s]+)\)\s*$/.exec(line)
  if (!match) return null
  let name = match[3]!
  name = name.replace(/^\.\//, '')
  if (name.toLowerCase().endsWith('.md')) name = name.slice(0, -3)
  if (name.startsWith('_')) return null
  return { depth: Math.floor(match[1]!.length / 2), title: match[2]!, name }
}

/** 由带深度的条目构建树（栈式归并） */
export function buildPageTreeFromItems(items: SidebarItem[]): WikiPageNode[] {
  const roots: WikiPageNode[] = []
  const stack: WikiPageNode[] = []
  for (const item of items) {
    const node: WikiPageNode = { name: item.name, title: item.title, depth: item.depth, children: [] }
    while (stack.length > 0 && stack[stack.length - 1]!.depth >= item.depth) stack.pop()
    if (stack.length === 0) roots.push(node)
    else stack[stack.length - 1]!.children.push(node)
    stack.push(node)
  }
  return roots
}

/** 解析 _Sidebar.md 为页面树（无有效条目时 fromSidebar=false） */
export function parseSidebar(markdown: string): WikiPageTree {
  const items: SidebarItem[] = []
  for (const line of markdown.split('\n')) {
    const parsed = parseSidebarLine(line)
    if (parsed) items.push(parsed)
  }
  return { nodes: buildPageTreeFromItems(items), fromSidebar: items.length > 0 }
}

/** fallback：由 .md 文件列表构建平铺树（Home 置顶，其余按名称排序） */
export function buildPageTreeFromFileNames(fileNames: string[]): WikiPageTree {
  const names = fileNames
    .map((file) => file.trim())
    .filter((file) => file.toLowerCase().endsWith('.md'))
    .filter((file) => !file.startsWith('_'))
    .map((file) => file.slice(0, -3))
  const ordered = ['Home', ...names.filter((name) => name !== 'Home').sort((a, b) => a.localeCompare(b))]
  return {
    nodes: ordered.map((name) => ({ name, title: name, depth: 0, children: [] })),
    fromSidebar: false,
  }
}

/** 校验页面名（防路径穿越 / 内部页面） */
export function isWikiPageNameSafe(name: string): boolean {
  if (!name || name.length > 100) return false
  if (name.includes('/') || name.includes('\\') || name.includes('..')) return false
  if (name.startsWith('_')) return false
  return true
}

/** 把 wiki markdown 中的相对路径图片解析为 raw URL 并注册远程媒体代理；绝对 http/data 图片原样保留 */
export function rewriteWikiMedia(
  markdown: string,
  register: (url: string) => string | null,
): string {
  return markdown.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (whole, alt: string, src: string) => {
    if (/^https?:\/\//i.test(src) || src.startsWith('data:')) return whole
    const clean = src.split('#')[0]!.replace(/^\.\//, '')
    const resolved = `${WIKI_RAW_BASE}/${clean}`
    const proxied = register(resolved)
    return `![${alt}](${proxied ?? resolved})`
  })
}
