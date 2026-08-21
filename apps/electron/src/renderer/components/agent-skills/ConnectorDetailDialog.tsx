/**
 * ConnectorDetailDialog — 插件中心连接器详情弹层
 *
 * DefaultBody：web-search / nano-banana 复用设置页表单；其余显示 statusReason。
 * `body` 可覆盖 DefaultBody（Task 6 给 builtin MCP 传入 BuiltinMcpDetailSheet 相关内容）。
 */

import * as React from 'react'
import { Plug } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { NanoBananaSettings, WebSearchSettings } from '@/components/settings/ToolSettings'
import { connectorKindLabel } from '@/components/agent-skills/ConnectorCard'
import type { ConnectorItem } from '@/lib/connectors-model'

interface ConnectorDetailDialogProps {
  item: ConnectorItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
  body?: React.ReactNode
}

export function ConnectorDetailDialog({
  item,
  open,
  onOpenChange,
  body,
}: ConnectorDetailDialogProps): React.ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[82vh] max-w-3xl gap-0 overflow-y-auto p-0">
        <div className="border-b border-border/60 px-6 pb-4 pt-5">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary shadow-sm">
              <Plug size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-lg font-semibold">
                {item?.name ?? '连接器详情'}
              </DialogTitle>
              <DialogDescription className="mt-1 leading-relaxed">
                {item?.description ?? '查看连接器能力、配置、状态和权限范围。'}
              </DialogDescription>
              {item && (
                <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                  <span className="rounded-md bg-muted px-1.5 py-0.5">
                    {connectorKindLabel(item.kind)}
                  </span>
                  <span className="rounded-md bg-muted px-1.5 py-0.5">{item.categoryLabel}</span>
                  <span className="rounded-md bg-muted px-1.5 py-0.5">{item.statusLabel}</span>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="p-6">{body ?? <DefaultBody item={item} />}</div>
        <div className="flex justify-end border-t border-border/60 px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            继续浏览
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function DefaultBody({ item }: { item: ConnectorItem | null }): React.ReactElement {
  if (!item) {
    return <div className="text-sm text-muted-foreground">未选择连接器。</div>
  }
  if (item.sourceId === 'web-search') {
    return <WebSearchSettings />
  }
  if (item.sourceId === 'nano-banana') {
    return <NanoBananaSettings />
  }
  return (
    <div className="space-y-4 text-sm text-muted-foreground">
      <p>{item.statusReason ?? '该连接器由插件中心管理。'}</p>
      <p>启用后，Agent 可能在任务中调用此能力。高风险写操作仍会在运行时请求确认。</p>
    </div>
  )
}
