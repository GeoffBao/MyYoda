/**
 * 连接器品牌/语义图标（卡片 + 详情页共用）
 *
 * 现有内置连接器使用官方品牌图标；其余回退语义 lucide。
 */

import type * as React from 'react'
import { Globe, ImageIcon, Plug, Search } from 'lucide-react'
import ChromeLogo from '@/assets/brand/chrome-logo.svg'
import GeminiLogo from '@/assets/brand/gemini-logo.png'
import TavilyLogo from '@/assets/brand/tavily-mark-black.svg'
import type { ConnectorItem } from '@/lib/connectors-model'

const ICON_CLASS = 'size-[22px]'

function brandImg(src: string, alt: string, invertDark = false): React.ReactElement {
  return (
    <img
      src={src}
      alt={alt}
      className={`${ICON_CLASS}${invertDark ? ' dark:invert' : ''}`}
    />
  )
}

export function getConnectorIcon(item: ConnectorItem): React.ReactNode {
  // 按带 kind 命名空间的完整 id 判定，避免自建同名 MCP（如 mcp:web-search）误拿内置连接器品牌图标。
  switch (item.id) {
    case 'builtin:chrome-devtools':
      return brandImg(ChromeLogo, 'Chrome')
    case 'builtin:nano-banana':
      return brandImg(GeminiLogo, 'Gemini')
    case 'api:web-search':
      return brandImg(TavilyLogo, 'Tavily', true)
    default:
      break
  }

  switch (item.kind) {
    case 'api-tool':
      return <Search size={22} />
    case 'custom-http':
      return <Globe size={22} />
    case 'builtin-mcp':
      return item.categoryLabel === '媒体' ? <ImageIcon size={22} /> : <Plug size={22} />
    case 'user-mcp':
      return <Plug size={22} />
    default: {
      const _exhaustive: never = item.kind
      return _exhaustive
    }
  }
}
