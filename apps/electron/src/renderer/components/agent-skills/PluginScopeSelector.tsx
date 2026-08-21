/**
 * PluginScopeSelector — 插件中心作用域：默认配置 vs 当前工作区下的 Project
 *
 * 与标题栏工作区切换器并列、互不替代。
 * 默认档 = 全局 MCP（所有工作区共享）+ 当前工作区 Skills overlay。
 * 项目档按 hasOwnMcp / hasOwnSkills 描述真实覆盖关系，不写「全部项目共享」。
 */

import * as React from 'react'
import { Check, ChevronDown, Layers } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import {
  describePluginScope,
  type PluginScope,
  type PluginScopeOption,
} from '@/lib/plugin-scope-model'

interface PluginScopeSelectorProps {
  scope: PluginScope
  options: PluginScopeOption[]
  onChange: (scope: PluginScope) => void
}

function isSameScope(option: PluginScopeOption, scope: PluginScope): boolean {
  if (option.scope.kind === 'workspace') return scope.kind === 'workspace'
  return scope.kind === 'project' && option.scope.projectId === scope.projectId
}

export function PluginScopeSelector({ scope, options, onChange }: PluginScopeSelectorProps): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const currentLabel = scope.kind === 'workspace' ? '默认配置' : scope.projectName

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="titlebar-no-drag flex items-center gap-2 rounded-lg border border-border/60 bg-content-area px-3 py-1.5 text-[13px] font-medium text-foreground/80 transition-[background-color,color,transform] duration-fast ease-out hover:bg-foreground/[0.04]"
        >
          <Layers size={14} className="text-foreground/45" />
          <span className="max-w-[180px] truncate">{currentLabel}</span>
          <ChevronDown size={14} className="text-foreground/45" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-1">
        <div className="px-2 py-1.5 text-[11px] font-medium text-muted-foreground/70">
          插件作用域
        </div>
        {options.map((option) => {
          const selected = isSameScope(option, scope)
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                onChange(option.scope)
                setOpen(false)
              }}
              className={cn(
                'flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-[13px] transition-[background-color,color] duration-fast ease-out',
                selected ? 'bg-accent text-accent-foreground' : 'text-foreground/80 hover:bg-accent/50',
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{option.label}</span>
                <span className="block text-[11px] leading-relaxed text-muted-foreground">
                  {option.description}
                </span>
              </span>
              {selected && <Check size={14} className="mt-0.5 shrink-0 text-primary" />}
            </button>
          )
        })}
        <div className="border-t border-border/60 px-2 py-2 text-[11px] leading-relaxed text-muted-foreground">
          {describePluginScope(scope)}
        </div>
      </PopoverContent>
    </Popover>
  )
}
