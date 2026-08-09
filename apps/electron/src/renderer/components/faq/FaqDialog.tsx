/**
 * MyYoda 全局 FAQ 弹窗。
 *
 * 采用「目录 + 内容」布局，内容侧支持关键词过滤，适合快速查阅而不是替代完整文档。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import {
  ArrowUpRight,
  BookOpen,
  Bot,
  BrainCircuit,
  CheckCircle2,
  FolderKanban,
  HelpCircle,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
  Wrench,
  X,
} from 'lucide-react'
import { faqDialogOpenAtom } from '@/atoms/faq-dialog'
import { cn } from '@/lib/utils'
import { FAQ_GROUPS, type FaqGroup, type FaqItem } from './faq-content'
import editorialBackground from '@/assets/faq/faq-editorial-bg.png'
import agentPreview from '@/assets/faq/faq-agent.png'
import projectPreview from '@/assets/faq/faq-project.png'
import memoryPreview from '@/assets/faq/faq-memory.png'
import skillsPreview from '@/assets/faq/faq-skills.png'
import automationPreview from '@/assets/faq/faq-automation.png'
import usagePreview from '@/assets/faq/faq-usage.png'
import { ImageLightbox } from '@/components/tutorial/ImageLightbox'

const GROUP_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  'getting-started': BookOpen,
  agent: Bot,
  'projects-files': FolderKanban,
  work: Wrench,
  knowledge: BrainCircuit,
  integrations: Users,
  privacy: ShieldCheck,
  troubleshooting: Wrench,
}

interface SearchResult {
  group: FaqGroup
  items: FaqItem[]
}

const FAQ_VISUALS = [
  {
    title: '从 Agent 开始',
    caption: '把想法交给 Code 执行',
    image: agentPreview,
  },
  {
    title: '用 Project 组织工作',
    caption: '目录、会话、任务与文件',
    image: projectPreview,
  },
  {
    title: '沉淀项目记忆',
    caption: '把经验变成可复用上下文',
    image: memoryPreview,
  },
  {
    title: '组合你的能力',
    caption: 'Skills / MCP / 专家',
    image: skillsPreview,
  },
  {
    title: '让工作自动发生',
    caption: '定时任务与运行记录',
    image: automationPreview,
  },
  {
    title: '看见使用情况',
    caption: 'Token、模型与会话用量',
    image: usagePreview,
  },
] as const

function filterGroups(query: string): SearchResult[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return FAQ_GROUPS.map((group) => ({ group, items: group.items }))

  return FAQ_GROUPS.flatMap((group) => {
    const groupText = `${group.topic} ${group.description}`.toLocaleLowerCase()
    const items = group.items.filter((item) => (
      `${item.question} ${item.answer} ${(item.keywords ?? []).join(' ')}`
        .toLocaleLowerCase()
        .includes(normalized)
    ))
    return groupText.includes(normalized) || items.length > 0 ? [{ group, items: items.length > 0 ? items : group.items }] : []
  })
}

export function FaqDialog(): React.ReactElement {
  const open = useAtomValue(faqDialogOpenAtom)
  const setOpen = useSetAtom(faqDialogOpenAtom)
  const [query, setQuery] = React.useState('')
  const [activeGroupId, setActiveGroupId] = React.useState(FAQ_GROUPS[0]?.id ?? '')
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const results = React.useMemo(() => filterGroups(query), [query])

  React.useEffect(() => {
    if (!open) {
      setQuery('')
      setActiveGroupId(FAQ_GROUPS[0]?.id ?? '')
    }
  }, [open])

  const scrollToGroup = React.useCallback((groupId: string) => {
    const container = scrollRef.current
    const element = container?.querySelector<HTMLElement>(`[data-faq-group="${groupId}"]`)
    if (!container || !element) return
    setActiveGroupId(groupId)
    container.scrollTo({ top: element.offsetTop - 20, behavior: 'smooth' })
  }, [])

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-[#07120e]/55 backdrop-blur-[3px] titlebar-no-drag data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-[101] flex h-[min(780px,88vh)] w-[min(1040px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[24px] border border-border/70 bg-dialog text-dialog-foreground shadow-[0_28px_100px_rgba(10,30,20,0.35)] titlebar-no-drag data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <div className="relative shrink-0 overflow-hidden border-b border-border/60 bg-[radial-gradient(circle_at_88%_0%,rgba(121,170,139,0.24),transparent_34%),linear-gradient(135deg,hsl(var(--dialog)),hsl(var(--muted))/0.55)] px-6 pb-5 pt-6 md:px-8">
            <div className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full border border-primary/10" />
            <div className="pointer-events-none absolute right-10 top-6 size-24 rounded-full border border-primary/10" />
          <div
            className="absolute inset-0 bg-cover bg-center opacity-[0.16]"
            style={{ backgroundImage: `url(${editorialBackground})` }}
          />
          <div className="relative flex items-start justify-between gap-4">
              <div>
                <div className="mb-3 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.24em] text-primary">
                  <Sparkles className="size-3.5" />
                  MyYoda Help Desk
                </div>
                <DialogPrimitive.Title className="text-2xl font-semibold tracking-[-0.03em] md:text-3xl">
                  你想了解什么？
                </DialogPrimitive.Title>
                <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                  从会话、Project 到专家、任务和本地数据，快速找到下一步。
                </p>
              </div>
              <DialogPrimitive.Close className="rounded-full border border-border/70 bg-background/55 p-2 text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                <X className="size-4" />
                <span className="sr-only">关闭 FAQ</span>
              </DialogPrimitive.Close>
            </div>
            <label className="relative mt-5 block max-w-2xl">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索问题、功能或关键词…"
                className="h-11 w-full rounded-xl border border-border/70 bg-background/75 pl-10 pr-4 text-sm outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
              />
            </label>
          </div>

          <div className="flex min-h-0 flex-1">
            <aside className="hidden w-56 shrink-0 overflow-y-auto border-r border-border/60 bg-muted/20 px-3 py-5 md:block">
              <div className="px-2 pb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/70">主题目录</div>
              <nav className="space-y-1" aria-label="FAQ 主题">
                {FAQ_GROUPS.map((group) => {
                  const Icon = GROUP_ICONS[group.id] ?? HelpCircle
                  const active = activeGroupId === group.id
                  return (
                    <button
                      key={group.id}
                      type="button"
                      onClick={() => scrollToGroup(group.id)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left text-xs transition-all',
                        active ? 'bg-primary/10 font-medium text-primary shadow-sm' : 'text-muted-foreground hover:bg-background/80 hover:text-foreground',
                      )}
                    >
                      <Icon className="size-3.5 shrink-0" />
                      <span className="truncate">{group.topic}</span>
                    </button>
                  )
                })}
              </nav>
              <div className="mt-7 rounded-xl border border-primary/10 bg-primary/[0.045] p-3">
                <CheckCircle2 className="size-4 text-primary" />
                <p className="mt-2 text-[11px] leading-5 text-muted-foreground">FAQ 是快速入口。遇到具体项目问题，直接把上下文交给 Code Agent 往往更快。</p>
              </div>
            </aside>

            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto scroll-smooth px-5 py-5 md:px-8 md:py-7">
              {results.length === 0 ? (
                <div className="flex h-full min-h-64 flex-col items-center justify-center text-center">
                  <Search className="size-8 text-muted-foreground/40" />
                  <h3 className="mt-4 text-sm font-semibold">没有找到匹配的问题</h3>
                  <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">换个关键词试试，比如“项目”“权限”或“模型”。</p>
                </div>
              ) : (
                <div className="mx-auto max-w-3xl space-y-9">
                  {!query.trim() && (
                    <section aria-labelledby="faq-featured-heading">
                      <div className="mb-3 flex items-end justify-between gap-3">
                        <div>
                          <h2 id="faq-featured-heading" className="text-base font-semibold tracking-[-0.01em]">先看几个核心能力</h2>
                          <p className="mt-0.5 text-xs text-muted-foreground">用真实界面快速建立 MyYoda 的整体认知。</p>
                        </div>
                        <span className="hidden text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/60 sm:block">精选导览</span>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-3">
                        {FAQ_VISUALS.map((visual) => (
                          <article key={visual.title} className="group overflow-hidden rounded-2xl border border-border/60 bg-background/55 shadow-[0_8px_24px_rgba(15,30,20,0.05)]">
                            <div className="relative aspect-[1.55] overflow-hidden bg-muted">
                              <ImageLightbox src={visual.image} alt={`${visual.title}界面截图`} title={visual.title} description={visual.caption} imageClassName="object-top transition-transform duration-500 group-hover:scale-[1.035]" />
                              <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" />
                              <span className="absolute bottom-2.5 left-3 text-xs font-medium text-white">{visual.title}</span>
                            </div>
                            <p className="px-3 py-2.5 text-[11px] text-muted-foreground">{visual.caption}</p>
                          </article>
                        ))}
                      </div>
                    </section>
                  )}
                  {results.map(({ group, items }) => {
                    const Icon = GROUP_ICONS[group.id] ?? HelpCircle
                    return (
                      <section key={group.id} data-faq-group={group.id} aria-labelledby={`faq-heading-${group.id}`}>
                        <div className="mb-3 flex items-end gap-3">
                          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="size-4" /></span>
                          <div className="min-w-0">
                            <h2 id={`faq-heading-${group.id}`} className="text-base font-semibold tracking-[-0.01em]">{group.topic}</h2>
                            <p className="mt-0.5 text-xs text-muted-foreground">{group.description}</p>
                          </div>
                          <span className="ml-auto hidden text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/60 sm:block">{items.length} 个问题</span>
                        </div>
                        <div className="overflow-hidden rounded-2xl border border-border/60 bg-background/45 shadow-[0_8px_24px_rgba(15,30,20,0.04)]">
                          {items.map((item, index) => (
                            <article key={item.question} className={cn('group px-4 py-4 md:px-5', index > 0 && 'border-t border-border/50')}>
                              <h3 className="text-sm font-medium leading-6 text-foreground">{item.question}</h3>
                              <p className="mt-1.5 max-w-2xl text-[13px] leading-6 text-muted-foreground">{item.answer}</p>
                              {item.keywords && (
                                <div className="mt-2.5 flex flex-wrap gap-1.5">
                                  {item.keywords.map((keyword) => <span key={keyword} className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{keyword}</span>)}
                                </div>
                              )}
                            </article>
                          ))}
                        </div>
                      </section>
                    )
                  })}
                  <div className="flex items-center justify-between border-t border-border/60 pt-5 text-xs text-muted-foreground">
                    <span>还没找到答案？</span>
                    <span className="inline-flex items-center gap-1 text-primary">让 Code Agent 帮你排查 <ArrowUpRight className="size-3.5" /></span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
