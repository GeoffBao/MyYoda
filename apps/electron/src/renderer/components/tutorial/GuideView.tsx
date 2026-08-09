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
import { ImageLightbox } from './ImageLightbox'

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

const GUIDE_SECTIONS = [
  {
    id: 'task-prompt',
    eyebrow: 'Make it actionable',
    title: '把任务说清楚，Agent 才能真正帮你完成',
    summary: '不要只说“帮我处理一下”。把目标、范围、限制和验收标准一起交给 Agent。',
    steps: ['先说明最终想得到什么结果', '指出相关文件、目录或 Project', '写出不能做什么和需要确认的边界', '告诉 Agent 如何验证已经完成'],
    example: '请检查当前项目的登录流程，先定位根因，不要修改数据库结构。实现后运行相关测试，并说明改动文件和剩余风险。',
  },
  {
    id: 'context',
    eyebrow: 'Keep context clean',
    title: '文件、记忆和会话，各自承担不同的上下文',
    summary: '好的工作流不是把所有资料都塞给 Agent，而是让每类信息放在正确的位置。',
    steps: ['当前任务临时材料放在会话文件', '多个会话共享的资料放在 Project 文件', '稳定规则和结论写入 Project 记忆', '跨项目通用偏好放入 Yoda 记忆'],
    example: '请先读取 Project 资料中的接口约定，再修改当前会话中的实现；完成后把稳定的约定补充到 Project 记忆。',
  },
  {
    id: 'capabilities',
    eyebrow: 'Compose capabilities',
    title: '先选工作方式，再组合 Skills、MCP 和专家',
    summary: '能力越多不一定越好。根据任务选择最小的一组工具，结果通常更稳定、更容易复查。',
    steps: ['简单问答和阅读优先使用 Chat', '需要文件和命令执行时使用 Code', '重复流程沉淀为 Skill', '需要外部系统数据时再启用 MCP'],
    example: '请用当前空间的“研究整理”专家，读取指定资料并生成一份带来源的报告；不要调用与本任务无关的工具。',
  },
  {
    id: 'troubleshooting',
    eyebrow: 'When blocked',
    title: '遇到问题时，先定位在哪一层',
    summary: '模型、权限、工具、工作目录和任务状态是不同问题，按层排查比反复重试更快。',
    steps: ['模型不可用：检查渠道、模型和网络代理', 'Agent 不执行：检查权限模式与工具是否启用', '找不到文件：检查 Project 工作目录', '任务失败：查看运行记录后从对应会话继续'],
    example: 'Agent 没有修改文件时，先查看工具活动和权限提示，再确认当前会话绑定的 Project 与工作目录。',
  },
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
                <div className="relative aspect-[1.55] overflow-hidden bg-muted"><ImageLightbox src={image} alt={`${title}界面截图`} title={title} description={description} imageClassName="object-top transition-transform duration-500 group-hover:scale-[1.035]" /><div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" /><div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-2 text-white"><Icon className="size-4" /><span className="text-sm font-medium">{title}</span></div></div>
                <p className="px-4 py-3 text-xs leading-5 text-muted-foreground">{description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-14" aria-labelledby="guide-path-heading">
          <div className="mb-5"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">Practical path</p><h2 id="guide-path-heading" className="mt-1 text-xl font-semibold tracking-[-0.02em]">从会用到用好</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">下面四个知识点来自旧版长教程，改成了可以直接照做的步骤和示例。</p></div>
          <nav aria-label="使用指南章节" className="mb-5 flex flex-wrap gap-2 rounded-2xl border border-border/60 bg-muted/25 p-3">
            {GUIDE_SECTIONS.map((section, index) => <a key={section.id} href={`#${section.id}`} className="rounded-xl bg-background/60 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary">0{index + 1} {section.title}</a>)}
          </nav>
          <div className="space-y-4">
            {GUIDE_SECTIONS.map((section, index) => (
              <article key={section.id} id={section.id} className="scroll-mt-8 rounded-2xl border border-border/60 bg-background/45 p-5 shadow-sm md:p-6">
                <div className="flex gap-4">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-semibold text-primary">0{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">{section.eyebrow}</p>
                    <h3 className="mt-1 text-base font-semibold">{section.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{section.summary}</p>
                    <div className="mt-4 grid gap-2 md:grid-cols-2">
                      {section.steps.map((step, stepIndex) => <div key={step} className="flex gap-2 text-xs leading-5 text-foreground/80"><span className="font-mono text-primary/70">{stepIndex + 1}.</span><span>{step}</span></div>)}
                    </div>
                    <div className="mt-4 rounded-xl bg-muted/45 px-4 py-3"><p className="mb-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">可以直接复制</p><p className="text-xs leading-5 text-foreground/80">{section.example}</p></div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <footer className="mt-12 flex items-center gap-3 border-t border-border/60 pt-6 text-xs text-muted-foreground"><span>遇到具体问题？</span><button type="button" onClick={() => setFaqDialogOpen(true)} className="font-medium text-primary transition-colors hover:text-primary/75">打开 FAQ，按主题查找答案</button></footer>
      </div>
    </div>
  )
}
