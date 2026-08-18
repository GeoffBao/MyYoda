/**
 * WikiBrowser — 「帮助」tab 的在线文档浏览器
 *
 * - 列表：wiki 页面树（_Sidebar 层级缩进）+ 标题过滤 + 手动刷新
 * - 页面：应用内 markdown 渲染（复用 ReleaseNoteMarkdown），「在 GitHub 打开」外链
 * - 离线：刷新失败显示旧缓存 + 离线横幅；从未成功时给出错误与重试
 */
import * as React from 'react'
import { useAtom } from 'jotai'
import { toast } from 'sonner'
import { ArrowLeft, ChevronRight, CloudOff, ExternalLink, Loader2, RefreshCw, Search } from 'lucide-react'
import type { WikiPageNode } from '@myyoda/shared'
import {
  wikiCurrentPageAtom,
  wikiPageContentAtom,
  wikiPageLoadingAtom,
  wikiPagesLoadingAtom,
  wikiPagesResultAtom,
} from '@/atoms/discover-atoms'
import { ReleaseNoteMarkdown } from '@/components/settings/ReleaseNoteMarkdown'

/** GitHub Wiki 网页地址（空态外链用） */
const WIKI_HTML_BASE = 'https://github.com/GeoffBao/MyYoda/wiki'

/** 拍平页面树（搜索用） */
function flatten(nodes: WikiPageNode[]): WikiPageNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)])
}

/** 取正文首个一级标题（页面视图标题优先用，无则用文件名） */
function extractHeading(markdown: string): string | null {
  const match = /^#\s+(.+)$/m.exec(markdown)
  return match ? match[1]!.trim() : null
}

export function WikiBrowser(): React.ReactElement {
  const [result, setResult] = useAtom(wikiPagesResultAtom)
  const [loading, setLoading] = useAtom(wikiPagesLoadingAtom)
  const [current, setCurrent] = useAtom(wikiCurrentPageAtom)
  const [page, setPage] = useAtom(wikiPageContentAtom)
  const [pageLoading, setPageLoading] = useAtom(wikiPageLoadingAtom)
  const [query, setQuery] = React.useState('')

  const loadPages = React.useCallback(
    async (force: boolean): Promise<void> => {
      setLoading(true)
      try {
        const next = force
          ? await window.electronAPI.discoverRefreshWiki()
          : await window.electronAPI.discoverGetWikiPages(false)
        setResult(next)
      } catch {
        setResult((prev) => ({ ...prev, fromCache: true, error: '加载文档失败' }))
      } finally {
        setLoading(false)
      }
    },
    [setLoading, setResult],
  )

  // 首次挂载：读缓存并后台刷新；后台刷新发现新 commit 时提示并重读
  React.useEffect(() => {
    void loadPages(false)
    const unsubscribe = window.electronAPI.onWikiUpdated(() => {
      toast.info('帮助文档已更新')
      void loadPages(false)
    })
    return unsubscribe
  }, [loadPages])

  const openPage = async (node: WikiPageNode): Promise<void> => {
    setCurrent(node.name)
    setPage(null)
    setPageLoading(true)
    try {
      setPage(await window.electronAPI.discoverGetWikiPage(node.name))
    } catch {
      toast.error('页面加载失败，请稍后重试')
      setCurrent(null)
    } finally {
      setPageLoading(false)
    }
  }

  const backToList = (): void => {
    setCurrent(null)
    setPage(null)
  }

  // ===== 页面视图 =====
  if (current) {
    return (
      <div className="rounded-xl border border-border/60 bg-content-area p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={backToList}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft size={13} />
            返回文档列表
          </button>
          {page && (
            <a
              href={page.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              在 GitHub 打开
              <ExternalLink size={11} />
            </a>
          )}
        </div>
        {pageLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 size={16} className="animate-spin" />
          </div>
        ) : page ? (
          <div className="mt-3">
            <h2 className="mb-3 text-lg font-semibold">{extractHeading(page.markdown) ?? current}</h2>
            <ReleaseNoteMarkdown content={page.markdown.replace(/^#\s+.*$/m, '')} compact />
          </div>
        ) : null}
      </div>
    )
  }

  // ===== 列表视图 =====
  const allNodes = flatten(result.tree.nodes)
  const filtered = query.trim()
    ? allNodes.filter((node) => node.title.toLowerCase().includes(query.trim().toLowerCase()))
    : allNodes

  return (
    <div className="rounded-xl border border-border/60 bg-content-area p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 items-center gap-1.5 rounded-lg border border-border/70 bg-background px-2.5 py-1.5">
          <Search size={13} className="shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索文档标题"
            className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground/70"
          />
        </div>
        <button
          type="button"
          onClick={() => void loadPages(true)}
          disabled={loading}
          title="刷新文档"
          aria-label="刷新文档"
          className="rounded-lg border border-border/70 p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {result.fromCache && result.error && (
        <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-2.5 py-1.5 text-xs text-foreground/70">
          <CloudOff size={13} className="shrink-0 text-amber-500" />
          离线模式：显示上次缓存内容
        </div>
      )}

      {result.tree.nodes.length === 0 && !loading ? (
        <div className="mt-3 rounded-lg bg-accent/40 px-3 py-4 text-center text-xs text-muted-foreground">
          {result.error ?? '文档库还是空的：维护者还没有创建任何 wiki 页面'}
          <div className="mt-1 text-[10px] text-muted-foreground/70">可点击右上角刷新重试</div>
          <a
            href={WIKI_HTML_BASE}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-primary transition-colors hover:underline"
          >
            <ExternalLink size={11} />
            打开 GitHub Wiki
          </a>
        </div>
      ) : (
        <div className="mt-2 space-y-0.5">
          {filtered.map((node) => (
            <button
              key={node.name}
              type="button"
              onClick={() => void openPage(node)}
              className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs text-foreground/75 transition-colors hover:bg-accent hover:text-foreground"
              style={{ paddingLeft: `${8 + node.depth * 14}px` }}
            >
              {node.depth > 0 && <ChevronRight size={11} className="shrink-0 text-muted-foreground/50" />}
              <span className="truncate">{node.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
