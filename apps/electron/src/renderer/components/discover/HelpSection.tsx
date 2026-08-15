/**
 * HelpSection — 「发现」面板的「帮助」分区
 *
 * 收纳产品自带的三个帮助资源入口：
 * - 使用指南：打开主区 tutorial tab（GuideView）
 * - 常见问题：打开 FAQ 弹窗
 * - 键盘快捷键：打开快捷键弹窗
 */
import * as React from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { BookOpen, CircleHelp, Keyboard } from 'lucide-react'
import { tabsAtom, activeTabIdAtom, openTab, TUTORIAL_TAB_ID } from '@/atoms/tab-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { faqDialogOpenAtom } from '@/atoms/faq-dialog'
import { shortcutGuideOpenAtom } from '@/atoms/shortcut-guide'

interface HelpEntry {
  icon: React.ComponentType<{ size?: number | string; className?: string }>
  title: string
  description: string
  actionLabel: string
  onOpen: () => void
}

export function HelpSection(): React.ReactElement {
  const [tabs, setTabs] = useAtom(tabsAtom)
  const setActiveTabId = useSetAtom(activeTabIdAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const setFaqOpen = useSetAtom(faqDialogOpenAtom)
  const setShortcutOpen = useSetAtom(shortcutGuideOpenAtom)

  const openGuide = React.useCallback((): void => {
    const result = openTab(tabs, { type: 'tutorial', sessionId: TUTORIAL_TAB_ID, title: 'MyYoda 使用指南' })
    setTabs(result.tabs)
    setActiveTabId(result.activeTabId)
    setActiveView('conversations')
  }, [tabs, setTabs, setActiveTabId, setActiveView])

  const entries: HelpEntry[] = [
    {
      icon: BookOpen,
      title: '使用指南',
      description: '从配置渠道到复杂任务：分步讲解核心概念与实战示例，主区打开完整指南。',
      actionLabel: '打开指南',
      onOpen: openGuide,
    },
    {
      icon: CircleHelp,
      title: '常见问题 FAQ',
      description: '按主题组织的常见问题解答：渠道、项目、Agent、自动任务、权限等。',
      actionLabel: '打开 FAQ',
      onOpen: () => setFaqOpen(true),
    },
    {
      icon: Keyboard,
      title: '键盘快捷键',
      description: '全局与输入区的快捷键清单，提升日常操作效率。',
      actionLabel: '查看快捷键',
      onOpen: () => setShortcutOpen(true),
    },
  ]

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs leading-relaxed text-foreground/45">
        使用帮助资源与官方内容、社区讨论同处一栏，随时回来翻查。
      </p>
      {entries.map((entry) => {
        const Icon = entry.icon
        return (
          <div
            key={entry.title}
            className="flex items-start gap-3 rounded-xl border border-border/60 bg-content-area p-4 shadow-sm"
          >
            <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.04] text-foreground/60">
              <Icon size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-medium text-foreground/90">{entry.title}</div>
              <div className="mt-1 text-[11.5px] leading-relaxed text-foreground/45">{entry.description}</div>
            </div>
            <button
              type="button"
              onClick={entry.onOpen}
              className="mt-1 shrink-0 rounded-lg border border-border/70 px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
            >
              {entry.actionLabel}
            </button>
          </div>
        )
      })}
    </div>
  )
}
