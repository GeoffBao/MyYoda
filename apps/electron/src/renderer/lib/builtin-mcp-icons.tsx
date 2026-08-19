/**
 * 内置 MCP 品牌/语义图标（卡片 + 详情页共用）
 *
 * 第三方品牌连接器（企业微信 / Chrome DevTools / Gemini）使用官方品牌图标，
 * MyYoda 自家功能（定时任务 / 协作子 Agent / 创建任务）使用语义化 lucide 图标，
 * 其余内置项回退为默认 Plug 图标。
 */

import * as React from 'react'
import { Plug, CalendarClock, Users, ClipboardList, Globe } from 'lucide-react'
import WecomLogo from '@/assets/brand/wecom-logo.png'
import ChromeLogo from '@/assets/brand/chrome-logo.svg'
import GeminiLogo from '@/assets/brand/gemini-logo.png'
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
import SlackLogo from '@/assets/brand/slack-logo.svg'
import LinearLogo from '@/assets/brand/linear-logo.svg'
import JiraLogo from '@/assets/brand/jira-logo.svg'
import CloudflareLogo from '@/assets/brand/cloudflare-logo.svg'
import RedisLogo from '@/assets/brand/redis-logo.svg'
import PostgresLogo from '@/assets/brand/postgres-logo.svg'
import HuggingfaceLogo from '@/assets/brand/huggingface-logo.svg'
import StripeLogo from '@/assets/brand/stripe-logo.svg'
import ElevenlabsLogo from '@/assets/brand/elevenlabs-logo.svg'
import DeepgramLogo from '@/assets/brand/deepgram-logo.svg'
import ChatcutLogo from '@/assets/brand/chatcut-logo.svg'
import HeygenLogo from '@/assets/brand/heygen-logo.svg'
import PlaywrightLogo from '@/assets/brand/playwright-logo.svg'
import FirecrawlLogo from '@/assets/brand/firecrawl-logo.png'
import TavilyLogo from '@/assets/brand/tavily-logo.png'

/** 内置 MCP 图标尺寸（与默认 Plug size=18 一致） */
const ICON_CLASS = 'size-[18px]'

export function getBuiltinMcpIcon(serverId: string): React.ReactNode {
  switch (serverId) {
    case 'wecom':
      return <img src={WecomLogo} alt="企业微信" className={ICON_CLASS} />
    case 'chrome-devtools':
      return <img src={ChromeLogo} alt="Chrome" className={ICON_CLASS} />
    case 'nano-banana':
      return <img src={GeminiLogo} alt="Gemini" className={ICON_CLASS} />
    case 'readwise':
      return <img src={ReadwiseLogo} alt="Readwise" className={ICON_CLASS} />
    case 'weread':
      return <img src={WereadLogo} alt="微信读书" className={ICON_CLASS} />
    case 'github':
      return <img src={GithubLogo} alt="GitHub" className={ICON_CLASS} />
    case 'gitlab':
      return <img src={GitlabLogo} alt="GitLab" className={ICON_CLASS} />
    case 'git':
      return <img src={GitLogo} alt="Git" className={ICON_CLASS} />
    case 'notion':
      return <img src={NotionLogo} alt="Notion" className={ICON_CLASS} />
    case 'figma':
      return <img src={FigmaLogo} alt="Figma" className={ICON_CLASS} />
    case 'brave-search':
      return <img src={BraveLogo} alt="Brave Search" className={ICON_CLASS} />
    case 'exa':
      return <img src={ExaLogo} alt="Exa" className={ICON_CLASS} />
    case 'sqlite':
      return <img src={SqliteLogo} alt="SQLite" className={ICON_CLASS} />
    case 'browserbase':
      return <img src={BrowserbaseLogo} alt="Browserbase" className={ICON_CLASS} />
    // MyYoda社区官方连接器（2026-08-19）
    case 'slack':
      return <img src={SlackLogo} alt="Slack" className={ICON_CLASS} />
    case 'linear':
      return <img src={LinearLogo} alt="Linear" className={ICON_CLASS} />
    case 'jira':
      return <img src={JiraLogo} alt="Jira" className={ICON_CLASS} />
    case 'cloudflare':
      return <img src={CloudflareLogo} alt="Cloudflare" className={ICON_CLASS} />
    case 'redis':
      return <img src={RedisLogo} alt="Redis" className={ICON_CLASS} />
    case 'postgres':
      return <img src={PostgresLogo} alt="PostgreSQL" className={ICON_CLASS} />
    case 'huggingface':
      return <img src={HuggingfaceLogo} alt="Hugging Face" className={ICON_CLASS} />
    case 'stripe':
      return <img src={StripeLogo} alt="Stripe" className={ICON_CLASS} />
    case 'elevenlabs':
      return <img src={ElevenlabsLogo} alt="ElevenLabs" className={ICON_CLASS} />
    case 'deepgram':
      return <img src={DeepgramLogo} alt="Deepgram" className={ICON_CLASS} />
    // 无官方图标的第三方（语义化 lucide 兜底）
    case 'firecrawl':
      return <img src={FirecrawlLogo} alt="Firecrawl" className={ICON_CLASS} />
    case 'tavily':
      return <img src={TavilyLogo} alt="Tavily" className={ICON_CLASS} />
    case 'playwright':
      return <img src={PlaywrightLogo} alt="Playwright" className={ICON_CLASS} />
    case 'chatcut':
      return <img src={ChatcutLogo} alt="ChatCut" className={ICON_CLASS} />
    case 'heygen':
      return <img src={HeygenLogo} alt="HyperFrames by HeyGen" className={ICON_CLASS} />
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
