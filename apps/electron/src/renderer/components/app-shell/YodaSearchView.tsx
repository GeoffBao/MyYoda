/**
 * YodaSearchView — 「搜索」弹窗（Spotlight / Command Palette 形态）
 *
 * 参考 NewMax：搜索不再展开到主内容区，而是居中浮层弹出，背景遮罩。
 * 能力保持与之前一致：
 * - 顶部搜索框（自动聚焦；Enter 手动触发）
 * - 默认态：最近会话按时间分组（今天 / 昨天 / 前天 / 更早）
 * - 搜索态：项目 / 标题 / 消息内容 三段结果 + 关键词高亮 + 键盘导航 + Agent 搜索兜底
 *
 * 触发入口：
 * - LeftSidebar 搜索按钮
 * - 全局快捷键（默认 ⌘⇧F / Ctrl+Shift+F）
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { Search, X, MessageSquare, Bot, Archive, Loader2, FolderOpen, PenLine, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { searchDialogOpenAtom } from '@/atoms/search-dialog'
import { getActiveAccelerator, getAcceleratorDisplay } from '@/lib/shortcut-registry'
import { sessionHoverPreviewEnabledAtom } from '@/atoms/ui-preferences'
import { conversationsAtom, channelsAtom } from '@/atoms/chat-atoms'
import {
  agentSessionsAtom,
  agentWorkspacesAtom,
  agentChannelIdAtom,
  agentPendingPromptAtom,
} from '@/atoms/agent-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { resolveSearchScope } from './search-dialog-model'
import { appModeAtom } from '@/atoms/app-mode'
import { useOpenSession } from '@/hooks/useOpenSession'
import { useCreateSession } from '@/hooks/useCreateSession'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  SessionMiniMapPopover,
  useSessionMiniMapHover,
} from '@/components/session-preview/SessionMiniMapPopover'
import type {
  MessageSearchResult,
  AgentMessageSearchResult,
} from '@myyoda/shared'
import { findBestSearchMatch } from '@myyoda/shared'

/** 标题搜索结果项 */
interface TitleResult {
  id: string
  title: string
  type: 'chat' | 'agent'
  archived?: boolean
  updatedAt: number
}

/** 内容搜索结果项（统一格式） */
interface ContentResult {
  id: string
  title: string
  type: 'chat' | 'agent'
  messageId: string
  snippet: string
  matchStart: number
  matchLength: number
  archived?: boolean
}

type SearchResult = TitleResult | ContentResult

function isContentResult(result: SearchResult): result is ContentResult {
  return 'snippet' in result
}

/** 默认态「最近会话」条目（Chat 对话 + Agent 会话混合） */
interface RecentSessionItem {
  id: string
  title: string
  type: 'chat' | 'agent'
  archived?: boolean
  updatedAt: number
  /** Agent 会话所属工作区名（展示用） */
  workspaceName?: string
}

type DateGroup = '今天' | '昨天' | '前天' | '更早'

/** 按 updatedAt 将条目分为 今天 / 昨天 / 前天 / 更早 四组 */
export function getDateGroupLabel(timestamp: number, now: number): DateGroup {
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const startOfYesterday = startOfToday.getTime() - 86_400_000
  const startOfDayBefore = startOfToday.getTime() - 2 * 86_400_000
  if (timestamp >= startOfToday.getTime()) return '今天'
  if (timestamp >= startOfYesterday) return '昨天'
  if (timestamp >= startOfDayBefore) return '前天'
  return '更早'
}

export function groupRecentByDate(items: RecentSessionItem[], now: number = Date.now()): Array<{ label: DateGroup; items: RecentSessionItem[] }> {
  const buckets = new Map<DateGroup, RecentSessionItem[]>()
  for (const item of items) {
    const label = getDateGroupLabel(item.updatedAt, now)
    const bucket = buckets.get(label)
    if (bucket) bucket.push(item)
    else buckets.set(label, [item])
  }
  const groups: Array<{ label: DateGroup; items: RecentSessionItem[] }> = []
  for (const label of ['今天', '昨天', '前天', '更早'] as const) {
    const bucket = buckets.get(label)
    if (bucket && bucket.length > 0) groups.push({ label, items: bucket })
  }
  return groups
}

/** 相对时间显示（今天 → HH:MM，昨天 → 昨天，更早 → M月D日） */
export function formatRelativeTime(timestamp: number, now: number): string {
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  if (timestamp >= startOfToday.getTime()) {
    return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  }
  if (timestamp >= startOfToday.getTime() - 86_400_000) return '昨天'
  return new Date(timestamp).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

/** 高亮文本中的匹配部分 */
function HighlightText({ text, query }: { text: string; query: string }): React.ReactElement {
  const match = findBestSearchMatch(text, query)
  if (!match) return <>{text}</>

  const before = text.slice(0, match.matchStart)
  const matchedText = text.slice(match.matchStart, match.matchStart + match.matchLength)
  const after = text.slice(match.matchStart + match.matchLength)

  return (
    <>
      {before}
      <mark className="bg-primary/20 text-foreground rounded-sm px-0.5">{matchedText}</mark>
      {after}
    </>
  )
}

/** 高亮 snippet 中的匹配部分（使用预计算位置） */
function HighlightSnippet({ snippet, matchStart, matchLength }: {
  snippet: string
  matchStart: number
  matchLength: number
}): React.ReactElement {
  if (matchStart < 0 || matchStart >= snippet.length) return <>{snippet}</>

  const before = snippet.slice(0, matchStart)
  const match = snippet.slice(matchStart, matchStart + matchLength)
  const after = snippet.slice(matchStart + matchLength)

  return (
    <>
      {before}
      <mark className="bg-primary/20 text-foreground rounded-sm px-0.5">{match}</mark>
      {after}
    </>
  )
}

function SearchResultIcon({ result }: { result: SearchResult }): React.ReactElement {
  return result.type === 'chat' ? (
    <MessageSquare size={14} className="flex-shrink-0 text-foreground/40" />
  ) : (
    <Bot size={14} className="flex-shrink-0 text-blue-500/70" />
  )
}

interface SearchResultRowProps {
  result: SearchResult
  index: number
  isSelected: boolean
  committedQuery: string
  getAgentWorkspaceName: (sessionId: string) => string | undefined
  onSelect: (result: SearchResult) => void
  onHover: (index: number) => void
}

function SearchResultRow({
  result,
  index,
  isSelected,
  committedQuery,
  getAgentWorkspaceName,
  onSelect,
  onHover,
}: SearchResultRowProps): React.ReactElement {
  const sessionHoverPreviewEnabled = useAtomValue(sessionHoverPreviewEnabledAtom)
  const preview = useSessionMiniMapHover(400, !sessionHoverPreviewEnabled)
  const isContent = isContentResult(result)
  const wsName = result.type === 'agent' ? getAgentWorkspaceName(result.id) : undefined

  return (
    <>
      <button
        ref={preview.setAnchorRef}
        data-index={index}
        onClick={() => onSelect(result)}
        onMouseEnter={() => {
          onHover(index)
          preview.handleMouseEnter()
        }}
        onMouseLeave={preview.handleMouseLeave}
        className={cn(
          'w-full px-4 py-2 text-left transition-colors',
          isContent ? 'flex flex-col gap-0.5' : 'flex items-center gap-2.5',
          isSelected
            ? 'bg-primary/10'
            : 'hover:bg-foreground/[0.04]',
          'archived' in result && result.archived && 'opacity-60'
        )}
      >
        <div className="flex items-center gap-2.5">
          <SearchResultIcon result={result} />
          <span className="flex-1 min-w-0 truncate text-[13px] text-foreground/80">
            {isContent ? result.title : <HighlightText text={result.title} query={committedQuery} />}
          </span>
          {wsName && (
            <span className="flex-shrink-0 px-1.5 py-0 rounded-full bg-foreground/[0.06] text-[10px] leading-4 text-foreground/40 font-medium truncate max-w-[80px]">
              {wsName}
            </span>
          )}
          {'archived' in result && result.archived && (
            <Archive size={12} className="flex-shrink-0 text-foreground/30" />
          )}
        </div>
        {isContent && (
          <div className="pl-[22px] text-[12px] text-foreground/50 truncate">
            <HighlightSnippet
              snippet={result.snippet}
              matchStart={result.matchStart}
              matchLength={result.matchLength}
            />
          </div>
        )}
      </button>
      <SessionMiniMapPopover
        target={{
          type: result.type,
          sessionId: result.id,
          title: result.title,
          workspaceName: wsName,
        }}
        anchorRef={preview.anchorRef}
        open={preview.isOpen}
        isLeaving={preview.isLeaving}
        onMouseEnter={preview.handlePanelMouseEnter}
        onMouseLeave={preview.handlePanelMouseLeave}
      />
    </>
  )
}

/** 默认态最近会话行（无搜索词时展示，点击直接打开会话） */
function RecentSessionRow({ item, now, onOpen }: { item: RecentSessionItem; now: number; onOpen: (item: RecentSessionItem) => void }): React.ReactElement {
  return (
    <button
      type="button"
      data-session-id={item.id}
      onClick={() => onOpen(item)}
      className={cn(
        'w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors rounded-lg hover:bg-foreground/[0.04]',
        item.archived && 'opacity-60'
      )}
    >
      {item.type === 'chat' ? (
        <MessageSquare size={14} className="flex-shrink-0 text-foreground/40" />
      ) : (
        <Bot size={14} className="flex-shrink-0 text-blue-500/70" />
      )}
      <span className="flex-1 min-w-0 truncate text-[13px] text-foreground/80">{item.title || '（未命名会话）'}</span>
      {item.workspaceName && (
        <span className="flex flex-shrink-0 items-center gap-1 px-1.5 py-0.5 rounded-full bg-foreground/[0.06] text-[10px] leading-4 text-foreground/40 font-medium truncate max-w-[90px]">
          <FolderOpen size={10} className="flex-shrink-0" />
          {item.workspaceName}
        </span>
      )}
      <span className="flex-shrink-0 text-[11px] tabular-nums text-foreground/35">
        {formatRelativeTime(item.updatedAt, now)}
      </span>
      {item.archived && <Archive size={12} className="flex-shrink-0 text-foreground/30" />}
    </button>
  )
}

export function YodaSearchDialog(): React.ReactElement {
  const [open, setOpen] = useAtom(searchDialogOpenAtom)
  const conversations = useAtomValue(conversationsAtom)
  const agentSessions = useAtomValue(agentSessionsAtom)
  const agentWorkspaces = useAtomValue(agentWorkspacesAtom)
  const channels = useAtomValue(channelsAtom)
  const appMode = useAtomValue(appModeAtom)
  const currentAgentChannelId = useAtomValue(agentChannelIdAtom)
  const setAgentPendingPrompt = useSetAtom(agentPendingPromptAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const openSession = useOpenSession()
  const { createAgent, createChat } = useCreateSession()

  const workspaceNameMap = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const w of agentWorkspaces) map.set(w.id, w.name)
    return map
  }, [agentWorkspaces])

  const getAgentWorkspaceName = React.useCallback((sessionId: string): string | undefined => {
    const session = agentSessions.find((s) => s.id === sessionId)
    if (!session?.workspaceId) return undefined
    return workspaceNameMap.get(session.workspaceId)
  }, [agentSessions, workspaceNameMap])

  // query：输入框当前值（实时跟随用户）
  // committedQuery：用户已确认提交的搜索词（点击/回车后才更新），用于结果展示与高亮
  const [query, setQuery] = React.useState('')
  const [committedQuery, setCommittedQuery] = React.useState('')
  const [titleResults, setTitleResults] = React.useState<TitleResult[]>([])
  const [contentResults, setContentResults] = React.useState<ContentResult[]>([])
  const [selectedIndex, setSelectedIndex] = React.useState(0)
  const [loading, setLoading] = React.useState(false)
  const [hasSearched, setHasSearched] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const isComposingRef = React.useRef(false)
  // 用 ref 持有当前请求的 token，发起新请求时使旧请求结果作废
  const searchTokenRef = React.useRef(0)

  // 默认态：最近会话（Chat + Agent 混合，按 updatedAt 倒序，最多 50 条）
  const recentItems = React.useMemo<RecentSessionItem[]>(() => {
    const items: RecentSessionItem[] = [
      ...conversations.map((c) => ({ id: c.id, title: c.title, type: 'chat' as const, archived: c.archived, updatedAt: c.updatedAt })),
      ...agentSessions.map((s) => ({
        id: s.id,
        title: s.title,
        type: 'agent' as const,
        archived: s.archived,
        updatedAt: s.updatedAt,
        workspaceName: s.workspaceId ? workspaceNameMap.get(s.workspaceId) : undefined,
      })),
    ]
    return items.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 50)
  }, [conversations, agentSessions, workspaceNameMap])
  const recentGroups = React.useMemo(() => groupRecentByDate(recentItems), [recentItems])
  // 默认态当前时间基准（挂载时取一次即可，避免每行重复计算）
  const [relativeNow] = React.useState(() => Date.now())

  // 弹窗打开时聚焦搜索框
  React.useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => inputRef.current?.focus(), 50)
    return () => window.clearTimeout(timer)
  }, [open])

  // 关闭弹窗后清空状态，避免下次打开时仍显示旧结果
  React.useEffect(() => {
    if (open) return
    setQuery('')
    setCommittedQuery('')
    setTitleResults([])
    setContentResults([])
    setHasSearched(false)
    setSelectedIndex(0)
    setLoading(false)
    searchTokenRef.current += 1
  }, [open])

  const handleInputChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value)
  }, [])

  const handleCompositionStart = React.useCallback(() => {
    isComposingRef.current = true
  }, [])

  const handleCompositionEnd = React.useCallback(() => {
    isComposingRef.current = false
  }, [])

  const handleClearQuery = React.useCallback(() => {
    setQuery('')
    setCommittedQuery('')
    setTitleResults([])
    setContentResults([])
    setHasSearched(false)
    setSelectedIndex(0)
    searchTokenRef.current += 1
    setLoading(false)
    inputRef.current?.focus()
  }, [])

  /**
   * 执行一次搜索：标题前端过滤 + 内容主进程 IPC 并行调用。
   *
   * 通过 token 隔离多次手动触发——若用户在搜索进行中再次触发，旧 token 的结果会被丢弃。
   */
  const runSearch = React.useCallback(async () => {
    const q = query.trim()
    if (!q || q.length < 2) {
      setTitleResults([])
      setContentResults([])
      setHasSearched(false)
      setCommittedQuery('')
      return
    }

    const token = ++searchTokenRef.current
    setCommittedQuery(q)
    setHasSearched(true)
    setLoading(true)
    setSelectedIndex(0)

    const { includeChatScope, includeAgentScope } = resolveSearchScope(appMode)
    const matchesTitle = (title: string): boolean => findBestSearchMatch(title, q) !== null
    const titles: TitleResult[] = [
      ...(includeChatScope
        ? conversations
          .filter((c) => matchesTitle(c.title))
          .map((c) => ({ id: c.id, title: c.title, type: 'chat' as const, archived: c.archived, updatedAt: c.updatedAt }))
        : []),
      ...(includeAgentScope
        ? agentSessions
          .filter((s) => matchesTitle(s.title))
          .map((s) => ({ id: s.id, title: s.title, type: 'agent' as const, archived: s.archived, updatedAt: s.updatedAt }))
        : []),
    ]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 20)

    setTitleResults(titles)

    try {
      const [chatResults, agentResults] = await Promise.all([
        includeChatScope ? window.electronAPI.searchConversationMessages(q) : Promise.resolve([]),
        includeAgentScope ? window.electronAPI.searchAgentSessionMessages(q) : Promise.resolve([]),
      ])
      if (token !== searchTokenRef.current) return

      const titleIds = new Set(titles.map((t) => t.id))
      const chatContent: ContentResult[] = (chatResults as MessageSearchResult[])
        .filter((r) => !titleIds.has(r.conversationId))
        .map((r) => ({
          id: r.conversationId,
          title: r.conversationTitle,
          type: 'chat' as const,
          messageId: r.messageId,
          snippet: r.snippet,
          matchStart: r.matchStart,
          matchLength: r.matchLength,
          archived: r.archived,
        }))
      const agentContent: ContentResult[] = (agentResults as AgentMessageSearchResult[])
        .filter((r) => !titleIds.has(r.sessionId))
        .map((r) => ({
          id: r.sessionId,
          title: r.sessionTitle,
          type: 'agent' as const,
          messageId: r.messageId,
          snippet: r.snippet,
          matchStart: r.matchStart,
          matchLength: r.matchLength,
          archived: r.archived,
        }))

      setContentResults([...chatContent, ...agentContent])
    } catch (error) {
      console.error('[Yoda 搜索] 内容搜索失败:', error)
      if (token === searchTokenRef.current) setContentResults([])
    } finally {
      if (token === searchTokenRef.current) setLoading(false)
    }
  }, [query, conversations, agentSessions, appMode])

  const handleAgentSearch = React.useCallback(async () => {
    const q = query.trim()
    if (!q) return

    const deepseekChannel = channels.find(
      (c) => c.enabled && c.models.some((m) => m.id === 'deepseek-v4-flash' && m.enabled)
    )
    const channelId = deepseekChannel?.id ?? currentAgentChannelId ?? undefined

    const configDir = import.meta.env.DEV ? '.myyoda-dev' : '.myyoda'
    const prompt = `请帮我在 MyYoda 的全部会话历史中搜索与以下描述相关的内容：\n\n"${q}"\n\n搜索范围：\n- Chat 会话消息文件：~/${configDir}/conversations/ 目录下所有 .jsonl 文件\n- Agent 会话消息文件：~/${configDir}/agent-sessions/ 目录下所有 .jsonl 文件\n\n要求：\n1. 理解用户描述的语义，不要求关键词完全匹配，根据内容相关性判断\n2. 找到相关会话后，给出会话标题、相关内容摘要，以及文件路径\n3. 按相关性排序，最相关的结果排在最前面`

    setOpen(false)
    const sessionId = await createAgent({ channelId })
    if (!sessionId) return

    setAgentPendingPrompt({ sessionId, message: prompt })
    setActiveView('conversations')
  }, [query, channels, currentAgentChannelId, createAgent, setAgentPendingPrompt, setActiveView, setOpen])

  // 全部结果列表（标题在前、内容在后）
  const allResults = React.useMemo<SearchResult[]>(
    () => [...titleResults, ...contentResults],
    [titleResults, contentResults]
  )

  // 导航到对话/会话
  const navigateToResult = React.useCallback((result: SearchResult) => {
    setOpen(false)

    if (result.type === 'chat') {
      const conv = conversations.find((c) => c.id === result.id)
      const title = conv?.title ?? result.title
      openSession('chat', result.id, title)
    } else {
      const session = agentSessions.find((s) => s.id === result.id)
      const title = session?.title ?? result.title
      openSession('agent', result.id, title)
    }
  }, [setOpen, openSession, conversations, agentSessions])

  /** 打开默认态最近会话 */
  const openRecentSession = React.useCallback((item: RecentSessionItem) => {
    setOpen(false)
    if (item.type === 'chat') {
      const conv = conversations.find((c) => c.id === item.id)
      openSession('chat', item.id, conv?.title ?? item.title)
    } else {
      const session = agentSessions.find((s) => s.id === item.id)
      openSession('agent', item.id, session?.title ?? item.title)
    }
  }, [setOpen, openSession, conversations, agentSessions])

  /** 新建 Chat 对话（快捷操作） */
  const handleNewChat = React.useCallback(() => {
    setOpen(false)
    void createChat()
  }, [setOpen, createChat])

  /** 新建 Agent 会话（快捷操作） */
  const handleNewAgent = React.useCallback(() => {
    setOpen(false)
    void createAgent()
  }, [setOpen, createAgent])

  /**
   * Enter 键语义：
   * - 输入法 composition 中 → 让浏览器处理（确认候选词），不做任何事
   * - 用户改了搜索词、或还没搜过 → 触发搜索
   * - 否则（搜索词未变且有结果）→ 打开当前选中项
   */
  const handleKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (isComposingRef.current) return
      e.preventDefault()
      const trimmed = query.trim()
      const isQueryDirty = trimmed !== committedQuery
      if (isQueryDirty || !hasSearched) {
        void runSearch()
      } else if (allResults[selectedIndex]) {
        navigateToResult(allResults[selectedIndex]!)
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.min(prev + 1, Math.max(allResults.length - 1, 0)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.max(prev - 1, 0))
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (query.trim().length > 0) {
        handleClearQuery()
      } else {
        setOpen(false)
      }
    }
  }, [query, committedQuery, hasSearched, allResults, selectedIndex, runSearch, navigateToResult, handleClearQuery, setOpen])

  // 自动滚动选中项到可视区域
  React.useEffect(() => {
    const list = listRef.current
    if (!list) return
    const selected = list.querySelector(`[data-index="${selectedIndex}"]`)
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  const trimmedQuery = query.trim()
  const canSearch = trimmedQuery.length >= 2 && !loading
  const isQueryDirty = trimmedQuery !== committedQuery

  const handleOpenChange = React.useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)
  }, [setOpen])

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        hideClose
        className="gap-0 overflow-hidden p-0 border border-border/60 bg-background/95 backdrop-blur-sm rounded-2xl shadow-2xl max-w-2xl w-[90vw] top-[18%] translate-y-0"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">搜索</DialogTitle>
        {/* 搜索框 */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border/40">
          <Search size={18} className="text-foreground/40 flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={handleInputChange}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            onKeyDown={handleKeyDown}
            placeholder="搜索所有工作区的标题或内容"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-foreground placeholder:text-foreground/40 outline-none"
          />
          {query && (
            <button
              onClick={handleClearQuery}
              title="清空"
              className="p-0.5 rounded text-foreground/30 hover:text-foreground/60 transition-colors"
            >
              <X size={14} />
            </button>
          )}
          <kbd className="flex-shrink-0 hidden sm:inline-flex items-center px-1.5 py-0.5 rounded-md bg-foreground/[0.06] font-mono text-[10px] leading-4 text-foreground/35 select-none">
            {getAcceleratorDisplay(getActiveAccelerator('global-search'))}
          </kbd>
          <button
            onClick={() => void runSearch()}
            disabled={!canSearch}
            className={cn(
              'flex shrink-0 items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors',
              canSearch
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-foreground/[0.06] text-foreground/30 cursor-not-allowed'
            )}
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
            <span>搜索</span>
          </button>
          <button
            onClick={() => void handleAgentSearch()}
            disabled={trimmedQuery.length < 2}
            title="适合在精准搜索找不到的情况下使用，Agent 会帮助你搜索整个 MyYoda 会话库"
            className={cn(
              'flex shrink-0 items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors',
              trimmedQuery.length >= 2
                ? 'bg-blue-500/10 text-blue-500 hover:bg-blue-500/20'
                : 'bg-foreground/[0.06] text-foreground/30 cursor-not-allowed'
            )}
          >
            <Bot size={12} />
            <span>Agent 搜索</span>
          </button>
        </div>

        {/* 内容区 */}
        <div ref={listRef} className="max-h-[60vh] overflow-y-auto scrollbar-thin px-2 py-2">
          {!hasSearched && (
            <>
              {trimmedQuery.length === 0 ? (
                /* 默认态：快捷操作 + 最近会话按时间分组（今天 / 昨天 / 前天 / 更早） */
                <div className="animate-in fade-in duration-fast">
                  {/* 快捷操作 */}
                  <div className="px-1 pt-1 pb-1">
                    <div className="px-2 py-1.5 text-[11px] font-medium text-foreground/40 select-none">
                      快捷操作
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <button
                        type="button"
                        onClick={handleNewChat}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-left rounded-lg transition-colors hover:bg-foreground/[0.04]"
                      >
                        <MessageSquare size={14} className="flex-shrink-0 text-foreground/40" />
                        <span className="flex-1 min-w-0 truncate text-[13px] text-foreground/80">新建对话</span>
                        <PenLine size={12} className="flex-shrink-0 text-foreground/30" />
                      </button>
                      <button
                        type="button"
                        onClick={handleNewAgent}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-left rounded-lg transition-colors hover:bg-foreground/[0.04]"
                      >
                        <Bot size={14} className="flex-shrink-0 text-blue-500/70" />
                        <span className="flex-1 min-w-0 truncate text-[13px] text-foreground/80">新建 Agent 会话</span>
                        <Sparkles size={12} className="flex-shrink-0 text-blue-500/40" />
                      </button>
                    </div>
                  </div>

                  {recentGroups.length > 0 ? (
                    <>
                      <div className="mx-2 my-1 border-t border-border/30" />
                      <div className="px-2 pt-1 pb-2 text-[13px] font-medium text-foreground/40 select-none">
                        最近会话
                      </div>
                      {recentGroups.map((group) => (
                        <div key={group.label} className="mb-2">
                          <div className="px-2 py-1.5 text-[12px] font-medium text-foreground/45 select-none">
                            {group.label}
                          </div>
                          <div className="flex flex-col gap-0.5">
                            {group.items.map((item) => (
                              <div key={`recent-${item.type}-${item.id}`}>
                                <RecentSessionRow item={item} now={relativeNow} onOpen={openRecentSession} />
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </>
                  ) : (
                    <div className="py-8 text-center text-[13px] text-foreground/40">
                      还没有会话，去新建一个对话吧
                    </div>
                  )}
                </div>
              ) : trimmedQuery.length < 2 ? (
                <div className="py-12 text-center text-[13px] text-foreground/40">
                  关键词至少需要 2 个字符
                </div>
              ) : (
                <div className="py-12 text-center text-[13px] text-foreground/40">
                  按 Enter 或点击搜索开始查找
                </div>
              )}
            </>
          )}

          {hasSearched && loading && allResults.length === 0 && (
            <div className="py-12 flex items-center justify-center gap-2 text-[13px] text-foreground/40">
              <Loader2 size={14} className="animate-spin" />
              <span>正在搜索...</span>
            </div>
          )}

          {hasSearched && !loading && allResults.length === 0 && (
            <div className="py-10 flex flex-col items-center gap-3 text-[13px] text-foreground/40">
              <span>未找到匹配结果</span>
              <button
                onClick={() => void handleAgentSearch()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 transition-colors"
              >
                <Bot size={12} />
                <span>试试 Agent 搜索</span>
              </button>
            </div>
          )}

          {/* 标题匹配区域 */}
          {titleResults.length > 0 && (
            <div className="py-1 animate-in fade-in duration-fast">
              <div className="px-3 pt-2 pb-1 text-[11px] font-medium text-foreground/40 select-none">
                标题匹配
              </div>
              {titleResults.map((result, idx) => (
                <SearchResultRow
                  key={`title-${result.id}`}
                  result={result}
                  index={idx}
                  isSelected={selectedIndex === idx}
                  committedQuery={committedQuery}
                  getAgentWorkspaceName={getAgentWorkspaceName}
                  onSelect={navigateToResult}
                  onHover={setSelectedIndex}
                />
              ))}
            </div>
          )}

          {/* 内容匹配区域 */}
          {(contentResults.length > 0 || (loading && hasSearched && titleResults.length > 0)) && (
            <div className="py-1 border-t border-border/30 animate-in fade-in duration-fast">
              <div className="px-3 pt-2 pb-1 flex items-center gap-2 text-[11px] font-medium text-foreground/40 select-none">
                <span>消息内容匹配</span>
                {loading && <Loader2 size={12} className="animate-spin text-foreground/30" />}
              </div>
              {contentResults.map((result, i) => {
                const globalIdx = titleResults.length + i
                return (
                  <SearchResultRow
                    key={`content-${result.id}-${result.messageId}`}
                    result={result}
                    index={globalIdx}
                    isSelected={selectedIndex === globalIdx}
                    committedQuery={committedQuery}
                    getAgentWorkspaceName={getAgentWorkspaceName}
                    onSelect={navigateToResult}
                    onHover={setSelectedIndex}
                  />
                )
              })}
            </div>
          )}
        </div>

        {/* 底部快捷键提示 */}
        <div className="flex items-center gap-3 px-4 py-2 border-t border-border/30 text-[11px] text-foreground/30">
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 rounded bg-foreground/[0.06] font-mono">↵</kbd>
            <span>{isQueryDirty || !hasSearched ? '搜索' : '打开'}</span>
          </span>
          {allResults.length > 0 && (
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-foreground/[0.06] font-mono">↑↓</kbd>
              <span>选择</span>
            </span>
          )}
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 rounded bg-foreground/[0.06] font-mono">Esc</kbd>
            <span>清空/关闭</span>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** 兼容旧导出名：YodaSearchView 现在即弹窗组件 */
export const YodaSearchView = YodaSearchDialog
export default YodaSearchDialog
