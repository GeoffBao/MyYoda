import * as React from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getToolDisplayName, getToolIcon } from './tool-utils'
import type {
  SDKContentBlock,
  SDKMessage,
  SDKToolResultBlock,
  SDKToolUseBlock,
  SDKUserMessage,
} from '@myyoda/shared'

interface ProcessBlockGroupProps {
  blocks: SDKContentBlock[]
  isStreaming?: boolean
  // 该过程组是否为整条消息的末尾项：是则流式中保留最后一段为正常显示，
  // 否则（最终答案已作为后续兄弟块外置）整组统一弱化。
  isMessageTail?: boolean
  children: React.ReactNode
}

const MAX_PROCESS_GROUP_ICONS = 4
const PROCESS_GROUP_COLLAPSE_DURATION_MS = 500
const PROCESS_GROUP_AUTO_COLLAPSE_SOUND_DELAY_MS = 900
const PROCESS_GROUP_AUTO_COLLAPSE_COUNTDOWN_SECONDS = 3

interface IndexedContentBlock {
  block: SDKContentBlock
  index: number
}

export type AssistantTurnRenderItem =
  | { type: 'block'; item: IndexedContentBlock }
  | { type: 'process-group'; items: IndexedContentBlock[] }

interface BuildAssistantTurnRenderItemsOptions {
  isStreaming?: boolean
  completedToolResultIds?: Set<string>
}

export function buildCompletedToolResultIds(turnMessages: SDKMessage[]): Set<string> {
  const ids = new Set<string>()
  for (const msg of turnMessages) {
    if (msg.type !== 'user') continue
    const userMsg = msg as SDKUserMessage
    const blocks = userMsg.message?.content
    if (!Array.isArray(blocks)) continue
    for (const b of blocks) {
      if (b.type !== 'tool_result') continue
      const rb = b as SDKToolResultBlock
      ids.add(rb.tool_use_id)
    }
  }
  return ids
}

interface ContentRun {
  /** true = 连续的 text 块；false = 连续的 tool_use/thinking 等过程块 */
  isText: boolean
  start: number
  end: number
}

/**
 * 把内容块按类型切成连续片段：text 片段之间可能夹着 tool_use/thinking 片段。
 * 一轮回答里模型经常「查一段、说一段发现、再查一段、再说一段」，text 并不只出现在结尾——
 * 早期实现只把「结尾连续的 text」当作正文、其余一律折进过程组，导致中间那些已经写完的
 * 发现内容被整段吞掉，用户得展开「执行过程」才能看到。这里改为逐段识别，任何 text 片段
 * 都是正文，只有 tool_use/thinking 片段才折叠。
 */
function partitionContentRuns(blocks: SDKContentBlock[]): ContentRun[] {
  const runs: ContentRun[] = []
  let i = 0
  while (i < blocks.length) {
    const isText = blocks[i]?.type === 'text'
    let j = i + 1
    while (j < blocks.length && (blocks[j]?.type === 'text') === isText) j += 1
    runs.push({ isText, start: i, end: j })
    i = j
  }
  return runs
}

function areToolsBeforeIndexCompleted(
  blocks: SDKContentBlock[],
  endIndex: number,
  completedToolResultIds: Set<string> | undefined,
): boolean {
  if (!completedToolResultIds) return false

  let hasToolUse = false
  for (let index = 0; index < endIndex; index++) {
    const block = blocks[index]
    if (block?.type !== 'tool_use') continue
    hasToolUse = true
    const toolBlock = block as SDKToolUseBlock
    if (!completedToolResultIds.has(toolBlock.id)) return false
  }

  // 没有 tool_use 时不认为"工具已完成"——避免流式中只有 thinking + 尾部 text
  // 时把还可能变成中间过程的 text 提前外置。
  return hasToolUse
}

export function buildAssistantTurnRenderItems(
  blocks: SDKContentBlock[],
  options: BuildAssistantTurnRenderItemsOptions = {},
): AssistantTurnRenderItem[] {
  if (blocks.length === 0) return []

  const runs = partitionContentRuns(blocks)
  const lastRunIndex = runs.length - 1
  const lastRun = runs[lastRunIndex]
  const hasProcessBlock = blocks.some((block) => block.type === 'tool_use' || block.type === 'thinking')

  // 只有「最后一段」存在流式不稳定的问题（后续还可能追加工具调用，把它变回中间过程）。
  // 更早的 text 片段后面已经出现过别的内容，说明它已经写完，可以直接展示——
  // 不需要、也不应该等到整轮结束才放出来。
  const canExposeTrailingRun = lastRun
    ? lastRun.isText && (
      !options.isStreaming
      || !hasProcessBlock
      || areToolsBeforeIndexCompleted(blocks, lastRun.start, options.completedToolResultIds)
    )
    : false

  const items: AssistantTurnRenderItem[] = []
  let pendingProcessBlocks: IndexedContentBlock[] = []

  const flushProcessGroup = (): void => {
    if (pendingProcessBlocks.length === 0) return
    items.push({ type: 'process-group', items: pendingProcessBlocks })
    pendingProcessBlocks = []
  }

  runs.forEach((run, runIndex) => {
    const isLastRun = runIndex === lastRunIndex
    const exposeDirectly = run.isText && (!isLastRun || canExposeTrailingRun)
    const runItems: IndexedContentBlock[] = []
    for (let index = run.start; index < run.end; index++) {
      const block = blocks[index]
      if (block) runItems.push({ block, index })
    }

    if (exposeDirectly) {
      flushProcessGroup()
      for (const item of runItems) items.push({ type: 'block', item })
    } else {
      pendingProcessBlocks.push(...runItems)
    }
  })

  flushProcessGroup()

  return items
}

function buildProcessGroupSummary(blocks: SDKContentBlock[]): string {
  let toolCount = 0
  let messageCount = 0

  for (const block of blocks) {
    if (block.type === 'tool_use') {
      toolCount += 1
    } else if (block.type === 'thinking' || block.type === 'text') {
      messageCount += 1
    }
  }

  const parts: string[] = []
  if (toolCount > 0) parts.push(`${toolCount} 次工具调用`)
  if (messageCount > 0) parts.push(`${messageCount} 条消息`)
  const summary = parts.join('，') || '过程'
  return `执行过程：${summary}`
}

export function buildProcessGroupToolNames(blocks: SDKContentBlock[]): string[] {
  const toolNames: string[] = []
  const seen = new Set<string>()

  for (const block of blocks) {
    if (block.type !== 'tool_use') continue
    const toolBlock = block as SDKToolUseBlock
    if (seen.has(toolBlock.name)) continue
    seen.add(toolBlock.name)
    toolNames.push(toolBlock.name)
  }

  return toolNames
}

export function ProcessBlockGroup({ blocks, isStreaming, isMessageTail = false, children }: ProcessBlockGroupProps): React.ReactElement {
  const shouldExpandByDefault = !!isStreaming
  const [expanded, setExpanded] = React.useState(shouldExpandByDefault)
  const [shouldRenderContent, setShouldRenderContent] = React.useState(shouldExpandByDefault)
  const [collapseCountdown, setCollapseCountdown] = React.useState<number | null>(null)
  const userToggledRef = React.useRef(false)
  const wasStreamingRef = React.useRef(!!isStreaming)
  const autoCollapseTimersRef = React.useRef<number[]>([])
  const contentRef = React.useRef<HTMLDivElement>(null)
  const [measuredHeight, setMeasuredHeight] = React.useState<number | undefined>(undefined)

  const clearAutoCollapseTimers = React.useCallback(() => {
    for (const timer of autoCollapseTimersRef.current) window.clearTimeout(timer)
    autoCollapseTimersRef.current = []
  }, [])

  React.useEffect(() => {
    clearAutoCollapseTimers()

    if (isStreaming) {
      setCollapseCountdown(null)
      if (isStreaming && !wasStreamingRef.current) {
        userToggledRef.current = false
      }
      if (!userToggledRef.current) {
        setExpanded(true)
      }
      wasStreamingRef.current = !!isStreaming
      return
    }

    const shouldAutoCollapseAfterCompletion = wasStreamingRef.current && !userToggledRef.current
    wasStreamingRef.current = false

    if (!shouldAutoCollapseAfterCompletion) {
      if (!userToggledRef.current) {
        setExpanded(false)
      }
      return
    }

    const soundDelayTimer = window.setTimeout(() => {
      setCollapseCountdown(PROCESS_GROUP_AUTO_COLLAPSE_COUNTDOWN_SECONDS)

      for (let second = PROCESS_GROUP_AUTO_COLLAPSE_COUNTDOWN_SECONDS - 1; second >= 1; second--) {
        const elapsed = (PROCESS_GROUP_AUTO_COLLAPSE_COUNTDOWN_SECONDS - second) * 1000
        autoCollapseTimersRef.current.push(window.setTimeout(() => setCollapseCountdown(second), elapsed))
      }

      autoCollapseTimersRef.current.push(window.setTimeout(() => {
        setCollapseCountdown(null)
        setExpanded(false)
      }, PROCESS_GROUP_AUTO_COLLAPSE_COUNTDOWN_SECONDS * 1000))
    }, PROCESS_GROUP_AUTO_COLLAPSE_SOUND_DELAY_MS)
    autoCollapseTimersRef.current.push(soundDelayTimer)

    return clearAutoCollapseTimers
  }, [clearAutoCollapseTimers, isStreaming])

  // 折叠前测量实际高度，用于丝滑的 height 过渡（子元素不 reflow，只裁剪边界）
  React.useEffect(() => {
    if (expanded) {
      setShouldRenderContent(true)
      setMeasuredHeight(undefined)
      return
    }

    // 折叠时：先测量当前高度，触发 height 过渡动画，动画结束后卸载 DOM
    const el = contentRef.current
    if (el) {
      const h = el.scrollHeight
      setMeasuredHeight(h)
      // 强制浏览器在下一帧开始从 h → 0 的过渡
      requestAnimationFrame(() => setMeasuredHeight(0))
    }

    const timer = window.setTimeout(() => setShouldRenderContent(false), PROCESS_GROUP_COLLAPSE_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [expanded])

  const summary = React.useMemo(
    () => buildProcessGroupSummary(blocks),
    [blocks],
  )
  const toolNames = React.useMemo(() => buildProcessGroupToolNames(blocks), [blocks])
  const visibleToolNames = toolNames.slice(0, MAX_PROCESS_GROUP_ICONS)
  const hiddenToolCount = Math.max(0, toolNames.length - visibleToolNames.length)

  // 内容区子项渲染策略：
  // - 流式中：每个新块有入场动画，最新一段（消息末尾过程组的最后一个 child）保持正常显示，
  //   其余步骤轻微弱化以引导视觉重心到最下方。
  // - 流式结束后用户展开：所有内容以正常颜色显示，无动画。
  const childArray = React.Children.toArray(children)
  const renderContentChildren = (): React.ReactNode =>
    childArray.map((child, i) => {
      const isLast = i === childArray.length - 1
      const dimmed = isStreaming && !(isMessageTail && isLast)
      return (
        <div
          key={i}
          className={cn(
            dimmed && 'opacity-80',
            isStreaming && 'animate-in fade-in slide-in-from-top-1 duration-base',
          )}
        >
          {child}
        </div>
      )
    })

  return (
    <div className="process-block-group space-y-1.5">
      <button
        type="button"
        className={cn(
          'group flex w-fit max-w-full items-center gap-2 rounded-full bg-muted/35 px-2.5 py-1 text-left',
          'text-muted-foreground transition-[background-color,color,opacity] hover:bg-muted/60 hover:text-foreground/75',
        )}
        onClick={() => {
          userToggledRef.current = true
          clearAutoCollapseTimers()
          setCollapseCountdown(null)
          setExpanded((prev) => !prev)
        }}
      >
        <ChevronRight
          className={cn(
            'size-3 shrink-0 text-muted-foreground/40 transition-transform duration-fast',
            expanded && 'rotate-90',
          )}
        />
        <span className="min-w-0 truncate text-[12px] font-medium">{summary}</span>
        {collapseCountdown !== null && (
          <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground/50">
            （{collapseCountdown}）
          </span>
        )}
        {visibleToolNames.length > 0 && (
          <span className="flex shrink-0 items-center gap-1 text-muted-foreground/60">
            {visibleToolNames.map((toolName) => {
              const ToolIcon = getToolIcon(toolName)
              return (
                <ToolIcon
                  key={toolName}
                  className="size-3.5"
                  aria-label={getToolDisplayName(toolName)}
                />
              )
            })}
            {hiddenToolCount > 0 && (
              <span className="text-[11px] tabular-nums text-muted-foreground/60">
                +{hiddenToolCount}
              </span>
            )}
          </span>
        )}
      </button>

      {shouldRenderContent && (
        <div
          ref={contentRef}
          data-agent-history-selection-excluded={expanded ? undefined : 'true'}
          className="overflow-hidden"
          style={{
            height: measuredHeight !== undefined ? `${measuredHeight}px` : 'auto',
            opacity: expanded ? 1 : 0,
            transition: measuredHeight !== undefined
              ? `height ${PROCESS_GROUP_COLLAPSE_DURATION_MS}ms ease-in-out, opacity ${PROCESS_GROUP_COLLAPSE_DURATION_MS}ms ease-in-out`
              : `opacity ${PROCESS_GROUP_COLLAPSE_DURATION_MS}ms ease-in-out`,
          }}
        >
          <div className="space-y-2">
            {renderContentChildren()}
            <button
                type="button"
                className="flex items-center gap-1 text-xs text-foreground/40 hover:text-foreground/70 transition-colors"
                onClick={() => {
                  userToggledRef.current = true
                  clearAutoCollapseTimers()
                  setCollapseCountdown(null)
                  setExpanded(false)
                }}
              >
                <ChevronRight className="size-3 -rotate-90" />
                <span>收起</span>
              </button>
            </div>
          </div>
        )}
      </div>
  )
}
