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
