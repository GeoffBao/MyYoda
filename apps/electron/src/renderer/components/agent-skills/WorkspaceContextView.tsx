/**
 * WorkspaceContextView — Workspace 级记忆「Yoda 记忆」
 *
 * 管理整个 workspace 的长期记忆（AGENTS.md + memory + 用户画像），
 * 跨 Home / Code 两模式共享：对话、项目任务、项目等所有产物都在同一 workspace
 * 顶层文件层级下，本模块提供统一的记忆查看、编辑与初始化沉淀。
 *
 * 使用方式：
 * - 独立全屏视图：`<WorkspaceContextView />`（MainArea activeView='workspace-context'，左侧栏「Yoda 记忆」入口）
 * - `embedded` prop 保留供未来嵌入其他容器复用，当前无消费者
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { Brain, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { agentWorkspacesAtom, currentAgentWorkspaceIdAtom } from '@/atoms/agent-atoms'
import { WorkspaceMemoryTab } from './WorkspaceMemoryTab'

function EmptyState({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }): React.ReactElement {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 pt-24 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-foreground/[0.04]">{icon}</div>
      <div className="flex flex-col gap-1.5">
        <div className="text-[15px] font-medium text-foreground/85">{title}</div>
        <div className="text-[13px] leading-relaxed text-foreground/50">{hint}</div>
      </div>
    </div>
  )
}

export function WorkspaceContextView({ embedded = false }: { embedded?: boolean }): React.ReactElement {
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const workspaceSlug = workspaces.find((w) => w.id === currentWorkspaceId)?.slug ?? ''
  const [search, setSearch] = React.useState('')

  return (
    <div className={embedded ? 'flex flex-col' : 'flex h-full flex-col overflow-hidden'}>
      {/* 标题栏：全屏模式保留；embedded（设置面板内）由设置面板导航提供标题，隐藏以免重复 */}
      {!embedded && (
        <div className="titlebar-no-drag mx-auto flex w-full max-w-6xl shrink-0 items-center px-8 pt-14 pb-4">
          <div className="flex items-center gap-2.5">
            <Brain className="size-6 text-foreground/70" />
            <h1 className="text-2xl font-semibold text-foreground">Yoda 记忆</h1>
          </div>
        </div>
      )}

      {/* 搜索框 */}
      <div className={cn('titlebar-no-drag flex w-full items-center gap-3 shrink-0', embedded ? '' : 'mx-auto max-w-6xl px-8 pb-4')}>
        <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border/60 bg-content-area px-3 transition-colors focus-within:border-primary/40">
          <Search size={14} className="shrink-0 text-foreground/40" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索工作区记忆..."
            className="w-full bg-transparent text-[13px] text-foreground placeholder:text-foreground/35 focus:outline-none"
          />
        </div>
      </div>

      {/* 内容 */}
      <div className={cn(embedded ? 'mt-4' : 'min-h-0 flex-1 overflow-y-auto scrollbar-thin')}>
        <div className={embedded ? '' : 'mx-auto w-full max-w-6xl px-8 pb-10'}>
          {workspaceSlug ? (
            <WorkspaceMemoryTab workspaceSlug={workspaceSlug} search={search} />
          ) : (
            <EmptyState
              icon={<Brain className="size-8 text-foreground/30" />}
              title="未选择工作区"
              hint="请先选择或创建一个工作区，再来管理它的 Yoda 记忆（AGENTS.md 与工作区长期记忆）。"
            />
          )}
        </div>
      </div>
    </div>
  )
}
