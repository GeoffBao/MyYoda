/**
 * ConnectorCollectionDialog — 精选集合配置引导面板（对标 Trae Marketplace 的组合引导）
 *
 * 集合不是「一键启用开关」，而是推荐组合的逐步配置向导：
 * 面板内逐个列出集合内连接器，实时显示状态（未启用 / 需配置 / 已配置并启用），
 * 点击任意一项直接跳到对应的凭据配置或只读详情，配完回来状态自动更新。
 */

import * as React from 'react'
import { CheckCircle2, ChevronRight, Blocks } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { BuiltinMcpServerSummary } from '@myyoda/shared'
import { getBuiltinMcpIcon } from '@/lib/builtin-mcp-icons'

export interface ConnectorCollection {
  id: string
  title: string
  description: string
  icon: React.ReactNode
  connectorIds: string[]
  /** 预装连接器条目（Readwise/企业微信等，未安装显示「需安装」） */
  marketplaceIds?: string[]
  /** 预装技能条目（ChatCut/HyperFrames 等，点击引导去技能 Tab） */
  skillIds?: string[]
}

interface ConnectorCollectionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 当前打开的集合（null 时不渲染内容） */
  collection: ConnectorCollection | null
  /** 全部内置连接器（用于取状态与图标） */
  servers: BuiltinMcpServerSummary[]
  /** 点击集合内某一项（由父组件决定打开凭据配置还是只读详情） */
  onOpenServer: (server: BuiltinMcpServerSummary) => void
  /** 预装连接器条目（marketplace 状态，未安装可引导安装） */
  presets?: Array<{ id: string; name: string; description?: string; iconKey?: string; installed: boolean }>
  /** 点击集合内预装连接器（打开凭据/详情或安装引导） */
  onOpenPreset?: (id: string) => void
  /** 技能条目（slug → 名称/描述），用于集合内预装技能展示 */
  skills?: Array<{ slug: string; name: string; description?: string }>
  /** 点击集合内技能（由父组件切到技能 Tab 并打开详情） */
  onOpenSkill?: (slug: string) => void
}

export function ConnectorCollectionDialog({
  open,
  onOpenChange,
  collection,
  servers,
  onOpenServer,
  presets = [],
  onOpenPreset,
  skills = [],
  onOpenSkill,
}: ConnectorCollectionDialogProps): React.ReactElement {
  if (!collection) return <></>
  const items = collection.connectorIds
    .map((id) => servers.find((s) => s.id === id))
    .filter((s): s is BuiltinMcpServerSummary => Boolean(s))
  const presetItems = (collection.marketplaceIds ?? [])
    .map((id) => presets.find((p) => p.id === id))
    .filter((p): p is NonNullable<(typeof presets)[number]> => Boolean(p))
  const skillItems = (collection.skillIds ?? [])
    .map((slug) => skills.find((s) => s.slug === slug))
    .filter((s): s is NonNullable<(typeof skills)[number]> => Boolean(s))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto rounded-2xl border-border/70 shadow-xl sm:max-w-[520px]">
        <DialogHeader className="text-left">
          <div className="flex items-center gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              {collection.icon}
            </div>
            <div>
              <DialogTitle className="text-[17px]">{collection.title}</DialogTitle>
              <DialogDescription className="mt-0.5 text-[12px]">
                {collection.description} · 按顺序完成配置即可使用整套能力
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {items.map((server) => {
            const ready = server.enabled && server.available
            const needsConfig = server.enabled && !server.available
            return (
              <button
                key={server.id}
                type="button"
                onClick={() => onOpenServer(server)}
                className="flex w-full items-center gap-3 rounded-xl border border-border/60 bg-background p-3 text-left transition-colors hover:border-border hover:bg-content-area/60"
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-content-area">
                  {getBuiltinMcpIcon(server.id)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-foreground">{server.displayName}</div>
                  <div
                    className={cn(
                      'text-[11px]',
                      ready
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : needsConfig
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-muted-foreground',
                    )}
                  >
                    {ready ? '已配置并启用' : needsConfig ? '需配置凭据' : '未启用'}
                  </div>
                </div>
                {ready ? (
                  <CheckCircle2 size={16} className="shrink-0 text-emerald-500" />
                ) : (
                  <ChevronRight size={16} className="shrink-0 text-muted-foreground/60" />
                )}
              </button>
            )
          })}
          {presetItems.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => onOpenPreset?.(preset.id)}
              className="flex w-full items-center gap-3 rounded-xl border border-border/60 bg-background p-3 text-left transition-colors hover:border-border hover:bg-content-area/60"
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-content-area">
                {getBuiltinMcpIcon(preset.iconKey ?? preset.id)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-foreground">{preset.name}</div>
                <div className="text-[11px] text-muted-foreground">{preset.description || '预装连接器'}</div>
              </div>
              {preset.installed ? (
                <span className="shrink-0 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                  已安装
                </span>
              ) : (
                <span className="shrink-0 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                  需安装
                </span>
              )}
              <ChevronRight size={16} className="shrink-0 text-muted-foreground/60" />
            </button>
          ))}
          {skillItems.map((skill) => (
            <button
              key={skill.slug}
              type="button"
              onClick={() => onOpenSkill?.(skill.slug)}
              className="flex w-full items-center gap-3 rounded-xl border border-border/60 bg-background p-3 text-left transition-colors hover:border-border hover:bg-content-area/60"
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-content-area">
                <Blocks size={16} className="text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-foreground">{skill.name}</div>
                <div className="text-[11px] text-muted-foreground">{skill.description || '预装技能'}</div>
              </div>
              <span className="shrink-0 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                已内置
              </span>
              <ChevronRight size={16} className="shrink-0 text-muted-foreground/60" />
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
