/**
 * BotHubSettings - 消息（IM 集成）视图
 *
 * 由 Proma 遗留的「远程连接 / BotHub」重构为 MyYoda 独有「消息」模块，
 * 入口在左侧栏「功能」组（插件与知识库之间，仅 Project 模式），以全屏视图
 * 取代 TabBar + TabContent（activeView='messaging'，见 MainArea.tsx）。
 *
 * 布局采用 MyYoda 自有设计（与 Proma 的左侧平台栏 + 右侧配置面板、Hermes 的
 * 三栏 Messaging 页刻意拉开差异）：
 * - Hub：顶部标题 + 「已接入」渠道卡片网格 + 「默认配置与命令」+「即将上线」占位卡片网格
 * - 点已接入卡片 → 进入该渠道配置详情（带返回按钮）
 * - 点占位卡片 → 弹出「即将上线」说明弹窗（规划能力清单）
 *
 * 渠道：已上线=飞书、微信；即将上线=企业微信、Slack、Discord、Email、API 服务、Webhooks。
 * 钉钉入口已移除（后端代码暂保留），未来 IM 渠道统一在 PLATFORMS 中扩展。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { cn } from '@/lib/utils'
import { feishuBotStatesAtom } from '@/atoms/feishu-atoms'
import { wechatBridgeStateAtom } from '@/atoms/wechat-atoms'
import { FeishuSettings } from './FeishuSettings'
import { WeChatSettings } from './WeChatSettings'
import { BotDefaultSettings } from './BotDefaultSettings'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  MessagesSquare,
  ArrowLeft,
  Clock3,
  Sparkles,
  Mail,
  Plug,
  Webhook,
  type LucideIcon,
} from 'lucide-react'
import feishuLogo from '@/assets/bots/feishu.png'
import wechatLogo from '@/assets/bots/wechat.png'

// ===== 类型 =====

type BotPlatformId =
  | 'feishu'
  | 'wechat'
  | 'wecom'
  | 'slack'
  | 'discord'
  | 'email'
  | 'api-server'
  | 'webhooks'

interface BotPlatformDef {
  id: BotPlatformId
  name: string
  /** 是否尚未上线（渲染占位卡片 + 说明弹窗） */
  comingSoon?: boolean
  /** Logo 图片 src（有图片时使用） */
  iconSrc?: string
  /** 无图片时显示的字符 */
  iconChar?: string
  /** 无字符时使用的 lucide 图标 */
  icon?: LucideIcon
  iconBgClass: string
  iconTextClass?: string
  /** 平台一句话说明（卡片 / 弹窗头部使用） */
  description: string
  /** 规划中的能力清单（占位弹窗使用） */
  plannedFeatures?: string[]
}

// ===== 平台定义 =====

const PLATFORMS: readonly BotPlatformDef[] = [
  {
    id: 'feishu',
    name: '飞书',
    iconSrc: feishuLogo,
    iconBgClass: 'bg-blue-500/15',
    description: '通过飞书 Bot 与 MyYoda Agent 对话，支持群聊 / 单聊绑定与 Session 同步。',
  },
  {
    id: 'wechat',
    name: '微信',
    iconSrc: wechatLogo,
    iconBgClass: 'bg-green-500/15',
    description: '扫码登录微信，在微信中收发消息、控制 MyYoda Agent。',
  },
  {
    id: 'wecom',
    name: '企业微信',
    comingSoon: true,
    iconChar: '企',
    iconBgClass: 'bg-sky-500/15',
    iconTextClass: 'text-sky-600 dark:text-sky-400',
    description: '把 MyYoda Agent 接入企业微信，在公司通讯录里直接对话与协作。',
    plannedFeatures: [
      '群机器人接入（Webhook 回调）',
      '自建应用接入（收发单聊 / 群聊消息）',
      '会话与工作区绑定管理',
      '任务进展推送到群聊',
    ],
  },
  {
    id: 'slack',
    name: 'Slack',
    comingSoon: true,
    iconChar: 'S',
    iconBgClass: 'bg-purple-500/15',
    iconTextClass: 'text-purple-600 dark:text-purple-400',
    description: '在 Slack 工作区中与 MyYoda Agent 对话，用 @提及 唤起协作。',
    plannedFeatures: [
      'Slack App OAuth 接入',
      '@提及 触发对话',
      '频道与会话绑定',
      '任务通知推送到频道',
    ],
  },
  {
    id: 'discord',
    name: 'Discord',
    comingSoon: true,
    iconChar: 'D',
    iconBgClass: 'bg-indigo-500/15',
    iconTextClass: 'text-indigo-600 dark:text-indigo-400',
    description: '把 MyYoda Agent 接入你的 Discord 服务器，支持 Bot 消息与斜杠命令。',
    plannedFeatures: [
      'Bot Token 接入',
      '斜杠命令交互',
      '频道绑定与会话管理',
      '消息推送通知',
    ],
  },
  {
    id: 'email',
    name: 'Email',
    comingSoon: true,
    icon: Mail,
    iconBgClass: 'bg-red-500/15',
    iconTextClass: 'text-red-600 dark:text-red-400',
    description: '通过专属邮箱与 MyYoda Agent 通信，支持 IMAP 收信与 SMTP 发信。',
    plannedFeatures: [
      'IMAP / SMTP 邮箱配置',
      '白名单用户限制',
      '邮件自动回复与附件处理',
      '任务状态邮件通知',
    ],
  },
  {
    id: 'api-server',
    name: 'API 服务',
    comingSoon: true,
    icon: Plug,
    iconBgClass: 'bg-emerald-500/15',
    iconTextClass: 'text-emerald-600 dark:text-emerald-400',
    description: '把 MyYoda 包装为 OpenAI 兼容的 HTTP API，供 Open WebUI 等第三方前端调用。',
    plannedFeatures: [
      '一键开关与鉴权 Key',
      '自定义监听端口与主机',
      '模型名称映射',
      'OpenAI 兼容接口',
    ],
  },
  {
    id: 'webhooks',
    name: 'Webhooks',
    comingSoon: true,
    icon: Webhook,
    iconBgClass: 'bg-cyan-500/15',
    iconTextClass: 'text-cyan-600 dark:text-cyan-400',
    description: '接收来自 GitHub、GitLab 等外部服务的事件推送，让 Agent 自动响应代码事件。',
    plannedFeatures: [
      'HTTP 事件接收服务',
      'HMAC 签名校验',
      '按来源路由事件到 Agent',
      '自定义端口与密钥',
    ],
  },
] as const

// ===== 状态映射 =====

/** 连接状态颜色映射 */
const BRIDGE_STATUS_COLORS = {
  disconnected: 'bg-gray-400',
  connecting: 'bg-amber-400',
  connected: 'bg-green-500',
  error: 'bg-destructive',
} as const

/** 连接状态文案 */
const STATUS_LABELS: Record<string, string> = {
  disconnected: '未连接',
  connecting: '连接中',
  connected: '已连接',
  error: '连接错误',
}

/** 从多 Bot 状态推导平台级状态：任一 connected → connected，否则按 error > connecting > disconnected 优先级 */
function getPlatformStatus(states: Record<string, { status: string }>): string {
  const values = Object.values(states)
  if (values.length === 0) return 'disconnected'
  if (values.some((s) => s.status === 'connected')) return 'connected'
  if (values.some((s) => s.status === 'error')) return 'error'
  if (values.some((s) => s.status === 'connecting')) return 'connecting'
  return 'disconnected'
}

/** 微信 Bridge 状态归一化到通用状态 */
function normalizeWeChatStatus(status: string): string {
  if (status === 'connected') return 'connected'
  if (status === 'error') return 'error'
  if (status === 'waiting_scan' || status === 'scanned' || status === 'connecting') return 'connecting'
  return 'disconnected'
}

/** 渠道连接状态（feishu/wechat 归一化到通用状态，未知渠道回退 disconnected） */
function getLiveStatus(platformId: BotPlatformId, feishuBotStates: Record<string, { status: string }>, wechatStatus: string): string {
  const statusMap: Record<string, string> = {
    feishu: getPlatformStatus(feishuBotStates),
    wechat: normalizeWeChatStatus(wechatStatus),
  }
  const raw = statusMap[platformId]
  if (!raw) return 'disconnected'
  return BRIDGE_STATUS_COLORS[raw as keyof typeof BRIDGE_STATUS_COLORS] ? raw : 'disconnected'
}

// ===== 子组件 =====

/** 平台图标：优先 Logo 图片，其次 lucide 图标，最后字符 */
function PlatformIcon({ platform, size }: { platform: BotPlatformDef; size: 'md' | 'lg' }): React.ReactElement {
  const containerClass = cn(
    'flex items-center justify-center flex-shrink-0',
    size === 'lg' ? 'w-12 h-12 rounded-xl text-2xl' : 'w-10 h-10 rounded-xl text-base',
  )

  if (platform.iconSrc) {
    return (
      <div className={containerClass}>
        <img
          src={platform.iconSrc}
          alt={platform.name}
          className={cn('object-contain', size === 'lg' ? 'w-12 h-12 rounded-xl' : 'w-10 h-10 rounded-xl')}
        />
      </div>
    )
  }

  const Icon = platform.icon
  return (
    <div className={cn(containerClass, platform.iconBgClass, platform.iconTextClass)}>
      {Icon ? <Icon size={size === 'lg' ? 24 : 18} /> : platform.iconChar}
    </div>
  )
}

/** 连接状态徽标：色点 + 文案（区别于 Proma / Hermes 的纯状态点） */
function StatusBadge({ status }: { status: string }): React.ReactElement {
  const colorClass = BRIDGE_STATUS_COLORS[status as keyof typeof BRIDGE_STATUS_COLORS] ?? 'bg-gray-400'
  const label = STATUS_LABELS[status] ?? '未连接'
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-foreground/[0.04] px-2 py-0.5 text-[11px] font-medium text-foreground/60">
      <span className={cn('h-1.5 w-1.5 rounded-full', colorClass, status === 'connecting' && 'animate-pulse')} />
      {label}
    </span>
  )
}

/** 即将上线徽标 */
function ComingSoonBadge(): React.ReactElement {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
      <Clock3 size={11} />
      即将上线
    </span>
  )
}

/** 已接入渠道卡片（内部订阅各 Bridge 状态，避免 hooks 在 map 中调用） */
function LiveChannelCard({
  platform,
  onOpen,
}: {
  platform: BotPlatformDef
  onOpen: () => void
}): React.ReactElement {
  const feishuBotStates = useAtomValue(feishuBotStatesAtom)
  const wechatState = useAtomValue(wechatBridgeStateAtom)
  const status = getLiveStatus(platform.id, feishuBotStates, wechatState.status)

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'group flex flex-col gap-3 rounded-xl border border-border/60 bg-content-area p-5 text-left',
        'transition-[border-color,background-color] duration-fast hover:border-primary/40 hover:bg-foreground/[0.02]',
      )}
    >
      <div className="flex items-center gap-3">
        <PlatformIcon platform={platform} size="md" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">{platform.name}</span>
            <StatusBadge status={status} />
          </div>
          <span className="line-clamp-2 text-xs leading-relaxed text-foreground/45">{platform.description}</span>
        </div>
      </div>
      <div className="flex justify-end">
        <span className="inline-flex items-center rounded-md bg-foreground/[0.05] px-2.5 py-1 text-xs font-medium text-foreground/70 transition-colors group-hover:text-foreground">
          配置
        </span>
      </div>
    </button>
  )
}

/** 详情页渠道状态徽标（内部订阅各 Bridge 状态） */
function DetailStatusBadge({ platformId }: { platformId: BotPlatformId }): React.ReactElement | null {
  const feishuBotStates = useAtomValue(feishuBotStatesAtom)
  const wechatState = useAtomValue(wechatBridgeStateAtom)
  if (platformId !== 'feishu' && platformId !== 'wechat') return null
  return <StatusBadge status={getLiveStatus(platformId, feishuBotStates, wechatState.status)} />
}

/** 即将上线占位卡片 */
function ComingSoonCard({
  platform,
  onOpen,
}: {
  platform: BotPlatformDef
  onOpen: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'flex flex-col gap-3 rounded-xl border border-dashed border-border/50 bg-foreground/[0.015] p-5 text-left',
        'transition-[border-color,background-color] duration-fast hover:border-border/80 hover:bg-foreground/[0.03]',
      )}
    >
      <div className="flex items-center gap-3">
        <PlatformIcon platform={platform} size="md" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground/75">{platform.name}</span>
            <ComingSoonBadge />
          </div>
          <span className="line-clamp-2 text-xs leading-relaxed text-foreground/40">{platform.description}</span>
        </div>
      </div>
    </button>
  )
}

/** 占位渠道说明弹窗 */
function ComingSoonDialog({
  platform,
  open,
  onOpenChange,
}: {
  platform: BotPlatformDef | null
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        {platform && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-3">
                <PlatformIcon platform={platform} size="md" />
                <div className="min-w-0">
                  <DialogTitle className="flex items-center gap-2">
                    {platform.name}
                    <ComingSoonBadge />
                  </DialogTitle>
                  <DialogDescription className="mt-1 leading-relaxed">
                    {platform.description}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-4">
              <div>
                <div className="mb-2 text-xs font-medium text-foreground/60">规划中的能力</div>
                <ul className="space-y-2">
                  {platform.plannedFeatures?.map((feature) => (
                    <li key={feature} className="flex items-start gap-2.5 text-[13px] text-foreground/75">
                      <span className="mt-[6px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-foreground/25" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex items-start gap-2.5 rounded-lg bg-foreground/[0.03] px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                <Sparkles size={14} className="mt-0.5 flex-shrink-0 text-primary/70" />
                <span>
                  {platform.name} 接入能力将在后续版本陆续开放。你可以在「意见反馈」中告诉我们最期待哪个渠道，我们会优先安排开发。
                </span>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ===== 主组件 =====

export function BotHubSettings(): React.ReactElement {
  /** null=Hub；否则为已上线渠道配置详情 */
  const [detailId, setDetailId] = React.useState<BotPlatformId | null>(null)
  const [comingSoonTarget, setComingSoonTarget] = React.useState<BotPlatformDef | null>(null)

  const detailPlatform = React.useMemo(
    () => (detailId ? PLATFORMS.find((p) => p.id === detailId) : undefined),
    [detailId],
  )

  const livePlatforms = React.useMemo(() => PLATFORMS.filter((p) => !p.comingSoon), [])
  const upcomingPlatforms = React.useMemo(() => PLATFORMS.filter((p) => p.comingSoon), [])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 标题栏 */}
      <div className="titlebar-no-drag mx-auto flex w-full max-w-6xl shrink-0 items-center justify-between px-8 pt-14 pb-4">
        {detailPlatform ? (
          /* 详情态：返回 + 渠道名 + 状态 */
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setDetailId(null)}
              className="flex size-8 items-center justify-center rounded-lg border border-border/60 text-foreground/60 transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
              aria-label="返回消息"
            >
              <ArrowLeft size={15} />
            </button>
            <PlatformIcon platform={detailPlatform} size="lg" />
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-semibold text-foreground">{detailPlatform.name}</h1>
              <DetailStatusBadge platformId={detailPlatform.id} />
            </div>
          </div>
        ) : (
          /* Hub 态：标题 + 一句话说明 */
          <>
            <div className="flex items-center gap-2.5">
              <MessagesSquare className="size-6 text-foreground/70" />
              <h1 className="text-2xl font-semibold text-foreground">消息</h1>
            </div>
            <span className="hidden text-[13px] text-foreground/40 sm:block">
              在飞书、微信等 IM 中与 MyYoda Agent 对话
            </span>
          </>
        )}
      </div>

      {/* 内容区 */}
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {detailPlatform ? (
          <div className="mx-auto w-full max-w-6xl px-8 pb-16 pt-2">
            {detailPlatform.id === 'feishu' && <FeishuSettings />}
            {detailPlatform.id === 'wechat' && <WeChatSettings />}
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-8 pb-16 pt-2">
            {/* 已接入渠道 */}
            <section>
              <div className="mb-4 flex items-baseline gap-2">
                <h2 className="text-sm font-medium text-foreground/80">已接入渠道</h2>
                <span className="text-xs text-foreground/35">{livePlatforms.length}</span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {livePlatforms.map((p) => (
                  <LiveChannelCard
                    key={p.id}
                    platform={p}
                    onOpen={() => setDetailId(p.id)}
                  />
                ))}
              </div>
            </section>

            {/* 默认配置与机器人命令 */}
            <section>
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground/80">默认配置与命令</h2>
              </div>
              <BotDefaultSettings />
            </section>

            {/* 即将上线 */}
            <section>
              <div className="mb-4 flex items-baseline gap-2">
                <h2 className="text-sm font-medium text-foreground/80">即将上线</h2>
                <span className="text-xs text-foreground/35">{upcomingPlatforms.length}</span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {upcomingPlatforms.map((p) => (
                  <ComingSoonCard
                    key={p.id}
                    platform={p}
                    onOpen={() => setComingSoonTarget(p)}
                  />
                ))}
              </div>
            </section>
          </div>
        )}
      </div>

      {/* 占位渠道说明弹窗 */}
      <ComingSoonDialog
        platform={comingSoonTarget}
        open={comingSoonTarget !== null}
        onOpenChange={(open) => { if (!open) setComingSoonTarget(null) }}
      />
    </div>
  )
}
