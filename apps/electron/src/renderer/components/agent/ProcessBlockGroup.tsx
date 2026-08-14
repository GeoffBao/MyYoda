import * as React from 'react'
import { Brain, ChevronRight, MessageSquareText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getToolDisplayName, getToolIcon } from './tool-utils'
import { getToolPhrase } from './tool-phrase'
import type {
  SDKContentBlock,
  SDKThinkingBlock,
  SDKToolUseBlock,
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
const PROCESS_GROUP_COLLAPSE_DURATION_MS = 200

interface IndexedContentBlock {
  block: SDKContentBlock
  index: number
}

export type AssistantTurnRenderItem =
  | { type: 'block'; item: IndexedContentBlock }
  | { type: 'process-group'; items: IndexedContentBlock[] }

interface BuildAssistantTurnRenderItemsOptions {
  isStreaming?: boolean
}

function getTrailingTextStartIndex(blocks: SDKContentBlock[]): number | null {
  const lastBlock = blocks[blocks.length - 1]
  if (lastBlock?.type !== 'text') return null

  let finalStartIndex = blocks.length - 1
  while (finalStartIndex > 0 && blocks[finalStartIndex - 1]?.type === 'text') {
    finalStartIndex -= 1
  }
  return finalStartIndex
}

export function buildAssistantTurnRenderItems(
  blocks: SDKContentBlock[],
  options: BuildAssistantTurnRenderItemsOptions = {},
): AssistantTurnRenderItem[] {
  if (blocks.length === 0) return []

  // 流式阶段不提前猜测最终答案：所有过程性输出固定留在紧凑过程块内，
  // 直到 Agent 完成后才把最终 text 呈现为顶层内容，避免末段反复跳位。
  const hasProcessBlock = blocks.some((block) => block.type === 'tool_use' || block.type === 'thinking')
  const trailingTextStartIndex = getTrailingTextStartIndex(blocks)

  if (options.isStreaming && hasProcessBlock) {
    return [{
      type: 'process-group',
      items: blocks.map((block, index) => ({ block, index })),
    }]
  }

  if (trailingTextStartIndex === null) {
    return [{
      type: 'process-group',
      items: blocks.map((block, index) => ({ block, index })),
    }]
  }

  const items: AssistantTurnRenderItem[] = []
  if (trailingTextStartIndex > 0) {
    items.push({
      type: 'process-group',
      items: blocks.slice(0, trailingTextStartIndex).map((block, index) => ({ block, index })),
    })
  }

  for (let index = trailingTextStartIndex; index < blocks.length; index++) {
    const block = blocks[index]
    if (!block) continue
    items.push({ type: 'block', item: { block, index } })
  }

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

function firstLine(text: string): string {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

function latestLine(text: string): string {
  const visible = text.trimEnd()
  const newline = visible.lastIndexOf('\n')
  return newline === -1 ? visible : visible.slice(newline + 1)
}

/**
 * 过程组折叠时展示思考摘要：流式跟随最新一行，结束后保留首行作为稳定回顾。
 * 让思考保持可感知，同时不展开整段过程占据会话空间。
 */
export function getProcessGroupThinkingPreview(
  blocks: SDKContentBlock[],
  isStreaming: boolean,
): string | undefined {
  for (let index = blocks.length - 1; index >= 0; index--) {
    const block = blocks[index]
    if (block?.type !== 'thinking') continue
    const thinking = (block as SDKThinkingBlock).thinking
    if (!thinking.trim()) continue
    return isStreaming ? latestLine(thinking) : firstLine(thinking)
  }
  return undefined
}

type ProcessGroupLiveActivity =
  | { kind: 'thinking'; label: string; preview: string }
  | { kind: 'tool'; label: string; toolName: string }
  | { kind: 'text'; label: string; preview: string }

/** 返回当前正在发生的过程类型，避免把工具执行误标成思考。 */
export function getProcessGroupLiveActivity(
  blocks: SDKContentBlock[],
): ProcessGroupLiveActivity | undefined {
  for (let index = blocks.length - 1; index >= 0; index--) {
    const block = blocks[index]
    if (!block) continue

    if (block.type === 'thinking') {
      const thinking = (block as SDKThinkingBlock).thinking
      if (thinking.trim()) {
        return { kind: 'thinking', label: '思考中', preview: latestLine(thinking) }
      }
      continue
    }

    if (block.type === 'tool_use') {
      const toolBlock = block as SDKToolUseBlock
      return {
        kind: 'tool',
        label: getToolPhrase(toolBlock.name, toolBlock.input).loadingLabel,
        toolName: toolBlock.name,
      }
    }

    if (block.type === 'text') {
      const content = (block as { text: string }).text
      if (content.trim()) {
        return { kind: 'text', label: '正在生成回复', preview: latestLine(content) }
      }
    }
  }
  return undefined
}

export function ProcessBlockGroup({ blocks, isStreaming, isMessageTail = false, children }: ProcessBlockGroupProps): React.ReactElement {
  // 过程默认始终收起：流式时仅在标题行展示正在更新的思考摘要，避免挤占对话空间。
  const [expanded, setExpanded] = React.useState(false)
  const [shouldRenderContent, setShouldRenderContent] = React.useState(false)
  const wasStreamingRef = React.useRef(!!isStreaming)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const summaryRef = React.useRef<HTMLSpanElement>(null)
  const [measuredHeight, setMeasuredHeight] = React.useState<number | undefined>(undefined)

  React.useEffect(() => {
    if (isStreaming && !wasStreamingRef.current) {
      setExpanded(false)
    }
    wasStreamingRef.current = !!isStreaming
  }, [isStreaming])

  // 折叠前测量实际高度，用于丝滑的 height 过渡（子元素不 reflow，只裁剪边界）
  React.useEffect(() => {
    if (expanded) {
      setShouldRenderContent(true)
      setMeasuredHeight(undefined)
      return
    }

    const el = contentRef.current
    if (el) {
      const height = el.scrollHeight
      setMeasuredHeight(height)
      const animationFrame = requestAnimationFrame(() => setMeasuredHeight(0))
      const timer = window.setTimeout(() => setShouldRenderContent(false), PROCESS_GROUP_COLLAPSE_DURATION_MS)
      return () => {
        cancelAnimationFrame(animationFrame)
        window.clearTimeout(timer)
      }
    }

    setShouldRenderContent(false)
  }, [expanded])

  const summary = React.useMemo(() => buildProcessGroupSummary(blocks), [blocks])
  const thinkingPreview = React.useMemo(
    () => getProcessGroupThinkingPreview(blocks, !!isStreaming),
    [blocks, isStreaming],
  )
  const liveActivity = React.useMemo(
    () => isStreaming ? getProcessGroupLiveActivity(blocks) : undefined,
    [blocks, isStreaming],
  )
  const toolNames = React.useMemo(() => buildProcessGroupToolNames(blocks), [blocks])
  const visibleToolNames = toolNames.slice(0, MAX_PROCESS_GROUP_ICONS)
  const hiddenToolCount = Math.max(0, toolNames.length - visibleToolNames.length)

  const inlinePreview = isStreaming
    ? (liveActivity?.kind === 'thinking' || liveActivity?.kind === 'text' ? liveActivity.preview : undefined)
    : thinkingPreview
  const inlineLabel = liveActivity?.label ?? (isStreaming ? '执行中' : summary)
  const LiveActivityIcon = liveActivity?.kind === 'tool'
    ? getToolIcon(liveActivity.toolName)
    : liveActivity?.kind === 'thinking'
      ? Brain
      : liveActivity?.kind === 'text'
        ? MessageSquareText
        : undefined

  // 流式摘要跟随最新文本末尾，让一行展示始终反映正在发生的思考或回复。
  React.useEffect(() => {
    if (!inlinePreview || !summaryRef.current) return
    const element = summaryRef.current
    const animationFrame = requestAnimationFrame(() => {
      element.scrollLeft = isStreaming ? element.scrollWidth - element.clientWidth : 0
    })
    return () => cancelAnimationFrame(animationFrame)
  }, [inlinePreview, isStreaming])

  // 过程组会在工具完成时因结果状态更新而重渲染。这里不为已挂载的步骤附加入场动画，
  // 否则相邻的 thinking 块会随工具状态一起重复淡入，形成闪烁。
  const childArray = React.Children.toArray(children)
  const renderContentChildren = (): React.ReactNode =>
    childArray.map((child, index) => {
      const isLast = index === childArray.length - 1
      const dimmed = isStreaming && !(isMessageTail && isLast)
      return (
        <div key={index} className={cn(dimmed && 'opacity-80')}>
          {child}
        </div>
      )
    })

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        aria-expanded={expanded}
        className={cn(
          'flex w-full max-w-full items-center gap-2 py-0.5 text-left transition-opacity group',
          'hover:opacity-70',
        )}
        onClick={() => {
          setExpanded((previous) => !previous)
        }}
      >
        <ChevronRight
          className={cn(
            'size-3 shrink-0 text-muted-foreground/40 transition-transform duration-150',
            expanded && 'rotate-90',
          )}
        />
        {LiveActivityIcon && (
          <LiveActivityIcon className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden />
        )}
        <span className="shrink-0 text-[14px] text-muted-foreground">{inlineLabel}</span>
        {inlinePreview && (
          <>
            <span className="size-0.5 shrink-0 rounded-full bg-muted-foreground/50" aria-hidden />
            <span
              ref={summaryRef}
              className={cn(
                'min-w-0 flex-1 overflow-hidden whitespace-nowrap text-[14px] text-muted-foreground/60',
                !isStreaming && 'text-ellipsis',
              )}
            >
              {inlinePreview}
            </span>
          </>
        )}
        {!isStreaming && visibleToolNames.length > 0 && (
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
              <span className="text-[11px] tabular-nums text-muted-foreground/60">+{hiddenToolCount}</span>
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
