/**
 * StickyUserMessage — 用户消息悬浮置顶条
 *
 * 当任意用户消息完全滚出 Conversation 视口顶部时，
 * 在顶部显示该消息的精简版悬浮条，点击可回滚到原始消息位置。
 * 必须放在 StickToBottom（Conversation）内部使用。
 *
 * 核心逻辑：遍历所有 [data-message-role="user"] DOM 节点，
 * 找到最后一个 bottom < containerTop 的节点（即视口上方最近的用户消息），
 * 匹配其 data-message-id 到 userMessages 数据列表，显示对应内容。
 */

import * as React from 'react'
import { Paperclip, ChevronUp } from 'lucide-react'
import { useStickToBottomContext } from 'use-stick-to-bottom'
import { useAtomValue } from 'jotai'
import { UserAvatar } from '@/components/chat/UserAvatar'
import { userProfileAtom } from '@/atoms/user-profile'
import { stickyUserMessageEnabledAtom } from '@/atoms/ui-preferences'
import { cn } from '@/lib/utils'

/**
 * 悬浮条只需要单行摘要，不需要完整 Markdown 渲染（那是原始消息本身的事）。
 * 直接把 Markdown 语法压平成纯文本，配合 CSS truncate 单行省略——
 * 比用 remark 渲染再靠 CSS 强制所有块级元素 inline 更稳妥，不会因为消息里
 * 恰好有标题/列表/引用等块级结构而意外撑成两行。
 */
function toPlainPreview(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' [代码] ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/@file:(\S+)/g, (_m, p: string) => {
      // #1393 后 @file 路径已 encodeURIComponent（含空格路径不再被 \S+ 截断），摘要层需解码回真实路径再取文件名。
      let decoded = p
      try { decoded = decodeURIComponent(p) } catch { /* 保持原值 */ }
      return `📎 ${decoded.split('/').pop()}`
    })
    .replace(/\/skill:(\S+)/g, (_m, p: string) => `/${p}`)
    .replace(/#mcp:(\S+)/g, (_m, p: string) => `#${p}`)
    .replace(/&session:(\S+)/g, (_m, p: string) => `会话 ${p}`)
    .replace(/\s+/g, ' ')
    .trim()
}

interface StickyAttachment {
  filename: string
  isImage: boolean
}

interface UserMessageData {
  id: string | null
  text: string
  attachments: StickyAttachment[]
}

interface StickyUserMessageProps {
  userMessages: UserMessageData[]
  /** 历史结构变化签名，用于 prepend 非用户消息时刷新用户位置缓存。 */
  layoutSignature?: string
}

interface UserMessagePosition {
  id: string
  bottom: number
}

export function StickyUserMessage({
  userMessages,
  layoutSignature,
}: StickyUserMessageProps): React.ReactElement {
  const { scrollRef, stopScroll, state: stickyState } = useStickToBottomContext()
  const userProfile = useAtomValue(userProfileAtom)
  const stickyEnabled = useAtomValue(stickyUserMessageEnabledAtom)

  // 当前悬浮展示的消息
  const [stickyMessage, setStickyMessage] = React.useState<UserMessageData | null>(null)
  const positionsRef = React.useRef<UserMessagePosition[]>([])

  const userMessageSignature = React.useMemo(
    () => userMessages.map((message) => message.id ?? '').join('\u0000'),
    [userMessages],
  )

  // 构建 id → data 查找表；流式 assistant 更新会重建上游数组，但用户消息未变时
  // 保持 map 引用稳定，避免重新绑定观察器和测量全部历史消息。
  const messageMap = React.useMemo(() => {
    const map = new Map<string, UserMessageData>()
    for (const msg of userMessages) {
      if (msg.id) map.set(msg.id, msg)
    }
    return map
  }, [userMessageSignature])

  React.useEffect(() => {
    const el = scrollRef.current
    if (!el || userMessages.length === 0 || !stickyEnabled) {
      positionsRef.current = []
      setStickyMessage(null)
      return
    }

    let scrollFrame: number | null = null
    let measureFrame: number | null = null
    let containerWidth = el.clientWidth

    const updateStickyMessage = (): void => {
      const scrollTop = el.scrollTop
      const positions = positionsRef.current
      let low = 0
      let high = positions.length - 1
      let match: UserMessagePosition | undefined
      while (low <= high) {
        const middle = Math.floor((low + high) / 2)
        const candidate = positions[middle]!
        if (candidate.bottom < scrollTop) {
          match = candidate
          low = middle + 1
        } else {
          high = middle - 1
        }
      }
      const found = match ? messageMap.get(match.id) ?? null : null
      setStickyMessage((previous) => previous?.id === found?.id ? previous : found)
    }

    const measurePositions = (): void => {
      const containerRect = el.getBoundingClientRect()
      const positions: UserMessagePosition[] = []
      for (const node of el.querySelectorAll<HTMLElement>('[data-message-role="user"]')) {
        const id = node.getAttribute('data-message-id')
        if (!id) continue
        const rect = node.getBoundingClientRect()
        positions.push({ id, bottom: rect.bottom - containerRect.top + el.scrollTop })
      }
      positionsRef.current = positions
      const messageElements = Array.from(el.querySelectorAll<HTMLElement>('[data-message-id]'))
      const lastUserMessageIndex = messageElements.findLastIndex(
        (message) => message.dataset.messageRole === 'user',
      )
      for (const message of messageElements.slice(0, lastUserMessageIndex + 1)) {
        resizeObserver.observe(message)
      }
      updateStickyMessage()
    }

    const scheduleMeasure = (): void => {
      if (measureFrame !== null) return
      measureFrame = requestAnimationFrame(() => {
        measureFrame = null
        measurePositions()
      })
    }
    const scheduleScrollUpdate = (): void => {
      if (scrollFrame !== null) return
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = null
        updateStickyMessage()
      })
    }

    el.addEventListener('scroll', scheduleScrollUpdate, { passive: true })
    const resizeObserver = new ResizeObserver((entries) => {
      const containerEntry = entries.find((entry) => entry.target === el)
      if (containerEntry && Math.abs(containerEntry.contentRect.width - containerWidth) >= 1) {
        containerWidth = containerEntry.contentRect.width
        scheduleMeasure()
        return
      }
      if (entries.some((entry) => entry.target !== el)) scheduleMeasure()
    })
    // 只观察滚动容器尺寸和用户消息节点：assistant 流式内容位于最后一个用户消息之后，
    // 它的高度变化不会改变已记录的用户消息位置。
    resizeObserver.observe(el)

    const messageElements = Array.from(el.querySelectorAll<HTMLElement>('[data-message-id]'))
    const lastUserMessageIndex = messageElements.findLastIndex(
      (message) => message.dataset.messageRole === 'user',
    )
    for (const message of messageElements.slice(0, lastUserMessageIndex + 1)) {
      resizeObserver.observe(message)
    }
    scheduleMeasure()

    return () => {
      if (scrollFrame !== null) cancelAnimationFrame(scrollFrame)
      if (measureFrame !== null) cancelAnimationFrame(measureFrame)
      el.removeEventListener('scroll', scheduleScrollUpdate)
      resizeObserver.disconnect()
    }
  }, [scrollRef, userMessageSignature, messageMap, layoutSignature, stickyEnabled])

  // 点击回滚到原始消息
  const scrollToOriginal = React.useCallback(() => {
    const el = scrollRef.current
    if (!el || !stickyMessage?.id) return

    const target = Array.from(el.querySelectorAll<HTMLElement>('[data-message-id]')).find(
      (node) => node.getAttribute('data-message-id') === stickyMessage.id
    )
    if (!target) return

    stopScroll()
    stickyState.animation = undefined
    stickyState.velocity = 0
    stickyState.accumulated = 0

    const containerRect = el.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    const targetScrollTop = el.scrollTop + (targetRect.top - containerRect.top)
    el.scrollTo({ top: Math.max(0, targetScrollTop - 24), behavior: 'smooth' })
  }, [scrollRef, stopScroll, stickyState, stickyMessage])

  const isSticky = stickyMessage !== null
  const hasContent = stickyMessage && (stickyMessage.text || stickyMessage.attachments.length > 0)

  if (!stickyEnabled) return <></>
  if (!hasContent && !isSticky) return <></>

  return (
    <div
      className={cn(
        'absolute left-0 right-0 top-0 z-20 transition-[opacity,transform] duration-base ease-out',
        isSticky
          ? 'opacity-100 translate-y-0 pointer-events-auto'
          : 'opacity-0 -translate-y-2 pointer-events-none'
      )}
    >
      {/* 复用 ConversationContent + Message 的 padding 链，保证与内容区等宽。
          单行胶囊条：头像 + 单行截断文本 + chevron，去掉原来的独立头像/用户名标题行 +
          两行文本 + 附件文件名卡片——那版高度接近 70-90px，遮住的正文太多；
          单行版本 ~32px，"提醒你问了什么"就够了，完整内容点一下就能跳回去看。 */}
      <div className="mx-5 px-2.5 pt-2 md:mx-8">
        <div
          className="sticky-user-banner ml-[40px] flex cursor-pointer items-center gap-2.5 rounded-full bg-[hsl(var(--input-surface))]/95 py-2 pl-2.5 pr-3.5 shadow-sm backdrop-blur-md transition-colors hover:bg-accent/50"
          onClick={scrollToOriginal}
        >
          <UserAvatar avatar={userProfile.avatar} size={20} className="shrink-0" />
          <div className="min-w-0 flex-1 truncate text-sm text-foreground/70">
            {stickyMessage?.text
              ? toPlainPreview(stickyMessage.text)
              : stickyMessage && stickyMessage.attachments.length > 0
                ? `${stickyMessage.attachments.length} 个附件`
                : null}
          </div>
          {stickyMessage?.text && stickyMessage.attachments.length > 0 && (
            <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
              <Paperclip className="size-3.5" />
              {stickyMessage.attachments.length}
            </span>
          )}
          <ChevronUp className="size-3.5 shrink-0 text-muted-foreground" />
        </div>
      </div>
    </div>
  )
}
