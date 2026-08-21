/**
 * 内置 MCP 品牌/语义图标（卡片 + 详情页共用）
 *
 * 第三方品牌连接器（企业微信 / Chrome DevTools / Gemini）使用官方品牌图标，
 * MyYoda 自家功能（定时任务 / 协作子 Agent / 创建任务）使用语义化 lucide 图标，
 * 其余内置项回退为默认 Plug 图标。
 */

import * as React from 'react'
import { Plug, CalendarClock, Users, ClipboardList, Globe } from 'lucide-react'
import ChromeLogo from '@/assets/brand/chrome-logo.svg'
import GeminiLogo from '@/assets/brand/gemini-logo.png'
import WecomLogo from '@/assets/brand/wecom-logo.png'
import ReadwiseLogo from '@/assets/brand/readwise-logo.svg'
import WereadLogo from '@/assets/brand/weread-logo.png'
import GithubLogo from '@/assets/brand/github-logo.svg'
import GitlabLogo from '@/assets/brand/gitlab-logo.svg'
import GitLogo from '@/assets/brand/git-logo.svg'
import NotionLogo from '@/assets/brand/notion-logo.svg'
import FigmaLogo from '@/assets/brand/figma-logo.svg'
import BraveLogo from '@/assets/brand/brave-logo.svg'
import ExaLogo from '@/assets/brand/exa-logo.png'
import SqliteLogo from '@/assets/brand/sqlite-logo.svg'
import BrowserbaseLogo from '@/assets/brand/browserbase-logo.png'
import SlackLogo from '@/assets/brand/slack-logo.png'
import LinearLogo from '@/assets/brand/linear-logo.svg'
import CloudflareLogo from '@/assets/brand/cloudflare-logo.svg'
import ChatcutLogo from '@/assets/brand/chatcut-logo.svg'
import HeygenLogo from '@/assets/brand/heygen-logo.svg'
import PlaywrightLogo from '@/assets/brand/playwright-logo.svg'
import FirecrawlLogo from '@/assets/brand/firecrawl-logo.png'
import TavilyLogo from '@/assets/brand/tavily-mark-black.svg'
import VercelLogo from '@/assets/brand/vercel-logo.svg'
import SupabaseLogo from '@/assets/brand/supabase-logo.svg'
import NetlifyLogo from '@/assets/brand/netlify-logo.svg'
import RailwayLogo from '@/assets/brand/railway-logo.svg'

/** 内置 MCP 图标尺寸（与默认 Plug size=18 一致） */
const ICON_CLASS = 'size-[18px]'

/**
 * 深色模式需反白的品牌图标（纯黑/深色单色 logo，dark:invert 黑白对调）：
 * Vercel/Notion/Readwise/GitHub 官方 logo 即黑/白双版，invert 语义正确；
 * Tavily mark 为官方黑色版，反白后深色模式清晰。彩色 logo 不在此列。
 */
const DARK_INVERT_IDS = new Set(['vercel', 'notion', 'github', 'readwise', 'tavily'])

/** 品牌图渲染：深色模式对纯黑 logo 做黑白反转 */
function brandImg(src: string, alt: string, serverId: string): React.ReactElement {
  return (
    <img
      src={src}
      alt={alt}
      className={`${ICON_CLASS}${DARK_INVERT_IDS.has(serverId) ? ' dark:invert' : ''}`}
    />
  )
}

export function getBuiltinMcpIcon(serverId: string): React.ReactNode {
  switch (serverId) {
    case 'wecom':
      return brandImg(WecomLogo, "企业微信", 'wecom')
    case 'readwise':
      return brandImg(ReadwiseLogo, "Readwise", 'readwise')
    case 'chrome-devtools':
      return brandImg(ChromeLogo, "Chrome", 'chrome-devtools')
    case 'nano-banana':
      return brandImg(GeminiLogo, "Gemini", 'nano-banana')
    case 'weread':
      return brandImg(WereadLogo, "微信读书", 'weread')
    case 'github':
      return brandImg(GithubLogo, "GitHub", 'github')
    case 'gitlab':
      return brandImg(GitlabLogo, "GitLab", 'gitlab')
    case 'git':
      return brandImg(GitLogo, "Git", 'git')
    case 'notion':
      return brandImg(NotionLogo, "Notion", 'notion')
    case 'figma':
      return brandImg(FigmaLogo, "Figma", 'figma')
    case 'brave-search':
      return brandImg(BraveLogo, "Brave Search", 'brave-search')
    case 'exa':
      return brandImg(ExaLogo, "Exa", 'exa')
    case 'sqlite':
      // 官方深蓝 #003B57 在深色背景对比度不足 → 固定白底容器（与 ChatCut 同款）
      return (
        <span className="inline-flex size-[18px] items-center justify-center rounded-[4px] bg-white">
          <img src={SqliteLogo} alt="SQLite" className="size-[16px]" />
        </span>
      )
    case 'browserbase':
      return brandImg(BrowserbaseLogo, "Browserbase", 'browserbase')
    // MyYoda社区官方连接器（2026-08-19）
    case 'slack':
      return brandImg(SlackLogo, "Slack", 'slack')
    case 'linear':
      return brandImg(LinearLogo, "Linear", 'linear')
    case 'cloudflare':
      return brandImg(CloudflareLogo, "Cloudflare", 'cloudflare')
    // 无官方图标的第三方（语义化 lucide 兜底）
    case 'firecrawl':
      return brandImg(FirecrawlLogo, "Firecrawl", 'firecrawl')
    case 'tavily':
      return brandImg(TavilyLogo, "Tavily", 'tavily')
    case 'playwright':
      return brandImg(PlaywrightLogo, "Playwright", 'playwright')
    case 'chatcut':
      // 官方 favicon 为纯黑图形，深色模式下不可见 → 固定白底容器
      return (
        <span className="inline-flex size-[18px] items-center justify-center rounded-[4px] bg-white">
          <img src={ChatcutLogo} alt="ChatCut" className="size-[16px]" />
        </span>
      )
    case 'heygen':
      return brandImg(HeygenLogo, "HyperFrames by HeyGen", 'heygen')
    // CLI 连接器官方图标（2026-08-19）
    case 'vercel':
      return brandImg(VercelLogo, "Vercel", 'vercel')
    case 'supabase':
      return brandImg(SupabaseLogo, "Supabase", 'supabase')
    case 'netlify':
      return brandImg(NetlifyLogo, "Netlify", 'netlify')
    // Cloudflare Wrangler 复用 Cloudflare 品牌图标（同属 Cloudflare）
    case 'railway':
      return brandImg(RailwayLogo, "Railway", 'railway')
    case 'fetch':
      return <Globe size={18} />
    case 'automation':
      return <CalendarClock size={18} />
    case 'collaboration':
      return <Users size={18} />
    case 'create-task':
      return <ClipboardList size={18} />
    default:
      return <Plug size={18} />
  }
}
