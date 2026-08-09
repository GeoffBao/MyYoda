/**
 * MyYoda 使用指南：以功能地图和真实界面截图为主的入门页。
 * 具体问题交给 FAQ，完整指南负责建立整体心智模型。
 */

import * as React from 'react'
import { useSetAtom } from 'jotai'
import {
  ArrowRight,
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  FolderKanban,
  Layers3,
  PlayCircle,
  Sparkles,
  Wrench,
} from 'lucide-react'
import agentPreview from '@/assets/faq/faq-agent.png'
import projectPreview from '@/assets/faq/faq-project.png'
import memoryPreview from '@/assets/faq/faq-memory.png'
import skillsPreview from '@/assets/faq/faq-skills.png'
import automationPreview from '@/assets/faq/faq-automation.png'
import usagePreview from '@/assets/faq/faq-usage.png'
import { faqDialogOpenAtom } from '@/atoms/faq-dialog'

interface GuideFeature {
  title: string
  description: string
  image: string
  icon: React.ComponentType<{ className?: string }>
}

const GUIDE_FEATURES: GuideFeature[] = [
  { title: 'Agent / Code', description: '把复杂目标交给 Agent，读取文件、调用工具并完成可验证的工作。', image: agentPreview, icon: Sparkles },
  { title: 'Project 工作台', description: '用 Project 绑定目录，组织会话、Task、资料和长期项目上下文。', image: projectPreview, icon: FolderKanban },
  { title: 'Yoda 记忆', description: '把稳定规则、技术约定和项目经验沉淀为可复用的上下文。', image: memoryPreview, icon: BrainCircuit },
  { title: 'Skills 与 MCP', description: '按空间组合 Skills、MCP 和专家，让 Agent 获得适合当前工作的能力。', image: skillsPreview, icon: Wrench },
  { title: '自动任务', description: '将重复工作安排为定时任务，并保留每次运行的状态和结果。', image: automationPreview, icon: Layers3 },
  { title: '用量统计', description: '查看会话、消息、Token、模型和活跃时间，了解工作投入。', image: usagePreview, icon: BarChart3 },
]

const QUICK_START = [
  ['配置一个模型渠道', '进入设置 → 模型配置，添加可用的 API 或订阅渠道。'],
  ['创建一个 Project', '选择工作目录，让会话、文件、任务和记忆拥有明确的归属。'],
  ['从一个真实任务开始', '告诉 Agent 目标、范围、限制和验收标准，先做小任务再逐步沉淀方法。'],
] as const

export function GuideView(): React.ReactElement {
  const setFaqDialogOpen = useSetAtom(faqDialogOpenAtom)

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-content-area text-foreground">
      <div className="mx-auto max-w-6xl px-6 py-10 md:px-10 md:py-14">
        <header className="relative overflow-hidden rounded-[28px] border border-border/60 bg-[radial-gradient(circle_at_88%_0%,rgba(121,170,139,0.26),transparent_35%),linear-gradient(135deg,hsl(var(--dialog)),hsl(var(--muted))/0.5)] px-7 py-9 shadow-[0_18px_50px_rgba(15,30,20,0.08)] md:px-10 md:py-12">
          <div className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full border border-primary/10" />
          <div className="pointer-events-none absolute right-14 top-10 size-28 rounded-full border border-primary/10" />
          <div className="relative max-w-2xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.2em] text-primary">
              <Sparkles className="size-3.5" />
              MyYoda Guide
            </div>
            <h1 className="text-3xl font-semibold tracking-[-0.04em] md:text-5xl">从一个真实问题开始。</h1>
            <p className="mt-4 max-w-xl text-sm leading-7 text-muted-foreground md:text-base">
              MyYoda 是本地优先的 AI 工作台。Chat 负责思考与表达，Project 负责执行与交付，Agent 会把你的目标转化为可追踪的工作过程。
            </p>
            <div className="mt-7 flex flex-wrap gap-2.5 text-xs text-muted-foreground">
              {['Chat 思考', 'Code 执行', 'Project 组织', 'Yoda 沉淀'].map((item) => (
                <span key={item} className="rounded-full border border-border/70 bg-background/55 px-3 py-1.5">{item}</span>
              ))}
            </div>
          </div>
        </header>

        <section className="mt-10 grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">Start here</p>
                <h2 className="mt-1 text-xl font-semibold tracking-[-0.02em]">五分钟建立工作流</h2>
              </div>
              <span className="hidden text-xs text-muted-foreground sm:block">先完成一次，再慢慢优化</span>
            </div>
            <div className="space-y-3">
              {QUICK_START.map(([title, description], index) => (
                <article key={title} className="flex gap-4 rounded-2xl border border-border/60 bg-background/45 p-4 shadow-sm">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-semibold text-primary">0{index + 1}</span>
                  <div>
                    <h3 className="text-sm font-medium">{title}</h3>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
                  </div>
                  <CheckCircle2 className="ml-auto mt-0.5 size-4 shrink-0 text-primary/60" />
                </article>
              ))}
            </div>
          </div>

          <article className="relative overflow-hidden rounded-2xl border border-border/60 bg-muted/30 p-5">
            <div className="flex items-center gap-2 text-primary"><PlayCircle className="size-4" /><span className="text-sm font-medium">视频教程</span></div>
            <h2 className="mt-4 text-lg font-semibold">一段视频，带你走完第一条路径</h2>
            <p className="mt-2 text-xs leading-6 text-muted-foreground">旧版视频已经不再作为当前产品的使用说明。新版视频会根据最新的 Project、Agent、记忆和协作能力重新录制。</p>
            <div className="mt-6 flex aspect-video items-center justify-center rounded-xl border border-dashed border-primary/25 bg-primary/[0.045] text-center">
              <div><PlayCircle className="mx-auto size-8 text-primary/60" /><p className="mt-2 text-xs text-muted-foreground">视频教程即将上线</p></div>
            </div>
          </article>
        </section>

        <section className="mt-12">
          <div className="mb-5 flex items-end justify-between gap-4">
            <div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">Feature map</p><h2 className="mt-1 text-xl font-semibold tracking-[-0.02em]">认识 MyYoda 的工作单元</h2></div>
            <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">从左到右逐步深入 <ArrowRight className="size-3.5" /></span>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {GUIDE_FEATURES.map(({ title, description, image, icon: Icon }) => (
              <article key={title} className="group overflow-hidden rounded-2xl border border-border/60 bg-background/45 shadow-[0_8px_24px_rgba(15,30,20,0.04)]">
                <div className="relative aspect-[1.55] overflow-hidden bg-muted"><img src={image} alt="" className="h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.035]" /><div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" /><div className="absolute bottom-3 left-3 flex items-center gap-2 text-white"><Icon className="size-4" /><span className="text-sm font-medium">{title}</span></div></div>
                <p className="px-4 py-3 text-xs leading-5 text-muted-foreground">{description}</p>
              </article>
            ))}
          </div>
        </section>

        <footer className="mt-12 flex items-center gap-3 border-t border-border/60 pt-6 text-xs text-muted-foreground"><span>遇到具体问题？</span><button type="button" onClick={() => setFaqDialogOpen(true)} className="font-medium text-primary transition-colors hover:text-primary/75">打开 FAQ，按主题查找答案</button></footer>
      </div>
    </div>
  )
}
