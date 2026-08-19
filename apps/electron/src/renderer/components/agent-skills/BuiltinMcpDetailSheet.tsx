/**
 * BuiltinMcpDetailSheet — MyYoda 内置 MCP 托管详情（居中 Modal，对标 Mico 连接器详情弹窗）
 */

import * as React from 'react'
import { CheckCircle2, ExternalLink, Settings2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { BuiltinMcpServerSummary } from '@myyoda/shared'
import { getBuiltinMcpIcon } from '@/lib/builtin-mcp-icons'

interface BuiltinMcpDetailSheetProps {
  open: boolean
  server: BuiltinMcpServerSummary | null
  onOpenChange: (open: boolean) => void
  onConfigure?: (serverId: string) => void
}

const CATEGORY_LABELS: Record<BuiltinMcpServerSummary['category'], string> = {
  system: '系统',
  automation: '自动化',
  collaboration: '协作',
  memory: '记忆',
  media: '媒体',
  browser: '浏览器',
  task: '任务',
  office: '办公',
  knowledge: '知识',
  code: '代码',
  design: '设计',
  search: '搜索',
  data: '数据',
}

interface BuiltinMcpConfigInfo {
  source: string
  description: string
  actionLabel?: string
}

function getConfigInfo(server: BuiltinMcpServerSummary): BuiltinMcpConfigInfo {
  if (server.id === 'nano-banana') {
    return {
      source: 'Agent 工具 / Nano Banana',
      description: '配置 Gemini API Key、API 地址、模型与开关后，Agent 会话才能注入生图 MCP。',
      actionLabel: '配置生图',
    }
  }
  if (server.id === 'chrome-devtools') {
    return {
      source: 'Chrome DevTools MCP / npx',
      description: '启用后 MyYoda 会通过 npx 启动 chrome-devtools-mcp，让 Agent 可以打开真实浏览器页面、截图和检查 DOM。首次使用可能需要下载 npm 包，并要求本机安装 Chrome。',
    }
  }
  if (server.id === 'wecom') {
    return {
      source: 'Agent 工具 / 企业微信',
      description: '在企业微信 App「工作台 → 智能机器人 → 创建机器人」选择 API 模式（长连接），拿到 Bot ID / Secret 后在「连接器 Tab → 企业微信」配置并开启（也可在本机终端执行 wecom-cli auth init 扫码授权）。≤10 人小团队全量能力；10 人以上企业当前开放文档/待办，需企业管理员配合管理机器人权限。详细步骤见企微帮助中心 doc 21677。',
      actionLabel: '配置企业微信',
    }
  }
  if (server.id === 'collaboration') {
    return {
      source: '当前 Agent 工作区',
      description: '协作子 Agent 使用当前工作区、会话和权限上下文，无需填写额外凭据。',
    }
  }
  if (server.id === 'automation') {
    return {
      source: 'MyYoda 本地自动任务',
      description: '自动任务 MCP 直接使用 MyYoda 本地任务服务，无需填写额外凭据。',
    }
  }
  if (server.id === 'readwise') {
    return {
      source: 'Agent 工具 / Readwise',
      description: '在「连接器 Tab → Readwise」填入 API Token（readwise.io/access_token 获取）并开启开关。Agent 即可检索你的划线笔记与 Reader 文库（只读）。官方 MCP 为 OAuth 模式，MyYoda 采用 REST API 直连。',
      actionLabel: '配置 Readwise',
    }
  }
  if (server.id === 'weread') {
    return {
      source: 'Agent 工具 / 微信读书',
      description: '在「连接器 Tab → 微信读书」填入 API Key（wrk- 开头，官方 Skill 页面登录获取）并开启开关。Agent 即可搜索书城、查看书架/划线/阅读统计（只读）。Key 是 OAuth Token 会过期，失效时重新生成。',
      actionLabel: '配置微信读书',
    }
  }
  if (server.id === 'git') {
    return {
      source: 'MyYoda 自研桥接 / git 命令',
      description: '对当前 Agent 工作目录的 Git 仓库提供只读检查（状态/差异/日志/分支），无需凭据。写操作（add/commit/push）请让 Agent 用终端命令完成并由你确认。',
    }
  }
  if (server.id === 'fetch') {
    return {
      source: 'MyYoda 自研桥接 / 内置抓取',
      description: '抓取任意 http/https 页面并转为可读文本（HTML 自动剥离脚本样式），无需凭据。不支持需要登录的页面，单次响应上限 512KB。',
    }
  }
  if (server.id === 'sqlite') {
    return {
      source: 'MyYoda 自研桥接 / node:sqlite',
      description: '对指定本地 SQLite 数据库提供只读查询（SELECT/PRAGMA，最多 500 行）。在连接器详情中配置数据库文件路径后开启即可。',
      actionLabel: '配置数据库路径',
    }
  }
  return {
    source: 'MyYoda 运行时',
    description: '该内置 MCP 由 MyYoda 运行时托管。',
  }
}

export function BuiltinMcpDetailSheet({ open, server, onOpenChange, onConfigure }: BuiltinMcpDetailSheetProps): React.ReactElement {
  const configInfo = server ? getConfigInfo(server) : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent hideClose className="sm:max-w-[560px] max-h-[85vh] p-0 flex flex-col gap-0 rounded-2xl border-border/70 shadow-xl">
        <DialogTitle className="sr-only">{server ? `连接器详情 · ${server.displayName}` : '连接器详情'}</DialogTitle>
        <DialogDescription className="sr-only">{server?.description ?? ''}</DialogDescription>

        {/* 头部（对标 Mico：小字标签 + 图标 + 名称 + 内置标签） */}
        <div className="shrink-0 border-b border-border/60 px-6 pb-4 pt-5">
          <div className="mb-2 text-[12px] font-medium text-muted-foreground">系统能力</div>
          {server && (
            <div className="flex items-center gap-3">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-blue-500/12 shadow-sm text-blue-500">
                {getBuiltinMcpIcon(server.id)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-lg font-semibold text-foreground">{server.displayName}</h2>
                  <span className="shrink-0 rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[11px] font-medium text-blue-600 dark:text-blue-400">
                    MyYoda 内置
                  </span>
                </div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">{server.name}</div>
              </div>
            </div>
          )}
        </div>

        {/* 主体 */}
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-6 py-4">
          {server && configInfo && (
            <div className="flex flex-col gap-6">
              <p className="text-[13px] leading-relaxed text-foreground/75">{server.description}</p>

              <div className="grid gap-3 sm:grid-cols-2">
                <InfoItem label="MCP 名称" value={server.name} />
                <InfoItem label="分类" value={CATEGORY_LABELS[server.category]} />
                {server.source && (
                  <InfoItem
                    label="来源"
                    value={server.source.vendor === 'official' ? '官方' : 'MyYoda 自研'}
                    tone={server.source.vendor === 'official' ? 'success' : 'default'}
                  />
                )}
                {server.source?.authType && <InfoItem label="认证方式" value={server.source.authType} />}
                {server.source?.author && <InfoItem label="维护方" value={server.source.author} />}
                {server.source?.homepage && (
                  <InfoItem
                    label="主页"
                    value={
                      <a
                        href={server.source.homepage}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
                      >
                        {server.source.homepage.replace(/^https?:\/\//, '').split('/')[0]}
                        <ExternalLink size={12} />
                      </a>
                    }
                  />
                )}
                <InfoItem label="注入开关" value={server.enabled ? '允许注入' : '已手动关闭'} tone={server.enabled ? 'success' : 'muted'} />
                <InfoItem label="可用状态" value={server.available ? '当前可用' : (server.availabilityReason ?? '不可用')} tone={server.available ? 'success' : 'muted'} />
                <InfoItem label="配置来源" value={configInfo.source} />
              </div>

              <section className="rounded-lg bg-muted/45 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground">如何配置</div>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{configInfo.description}</p>
                  </div>
                  {configInfo.actionLabel && onConfigure && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => onConfigure(server.id)}
                    >
                      <Settings2 size={14} />
                      <span>{configInfo.actionLabel}</span>
                    </Button>
                  )}
                </div>
              </section>

              <section className="flex flex-col gap-3">
                <div className="text-sm font-medium text-foreground">工具</div>
                <div className="flex flex-col gap-2">
                  {server.tools.map((tool) => (
                    <div key={tool.name} className="rounded-lg bg-muted/45 p-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{tool.name}</span>
                        {tool.readOnly && (
                          <span className="rounded-md bg-foreground/5 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                            只读
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{tool.description}</p>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}
        </div>

        {/* 底部操作栏 */}
        <div className="shrink-0 border-t border-border/60 px-6 py-4">
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              继续浏览
            </Button>
            {server && configInfo?.actionLabel && onConfigure && (
              <Button onClick={() => onConfigure(server.id)}>
                {configInfo.actionLabel}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function InfoItem({ label, value, tone = 'default' }: { label: string; value: React.ReactNode; tone?: 'default' | 'success' | 'muted' }): React.ReactElement {
  return (
    <div className="rounded-lg bg-muted/45 p-3">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className={cn(
        'mt-1 flex items-center gap-1.5 text-sm font-medium',
        tone === 'success' && 'text-emerald-600 dark:text-emerald-400',
        tone === 'muted' && 'text-muted-foreground',
      )}>
        {tone === 'success' && <CheckCircle2 size={14} />}
        {tone === 'muted' && <XCircle size={14} />}
        <span>{value}</span>
      </div>
    </div>
  )
}
