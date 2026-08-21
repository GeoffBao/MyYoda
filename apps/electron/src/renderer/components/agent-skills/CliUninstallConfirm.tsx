/**
 * CliUninstallConfirm — CLI 连接器卸载确认弹窗
 *
 * CLI 卸载有两个层级，让用户自己选：
 * - 「仅从会话移除」：保留系统 CLI（npm 全局包不动），市场显示「已忽略 + 添加到会话」；
 * - 「同时卸载系统 CLI」：执行 npm uninstall -g，彻底移除，市场回到「未安装」。
 */

import * as React from 'react'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Loader2, Trash2, PlugZap } from 'lucide-react'

interface CliUninstallConfirmProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  itemName: string
  cliCommand?: string
  /** 正在卸载（任一模式） */
  removing?: boolean
  /** 仅从会话移除 */
  onRemoveFromSession: () => void
  /** 同时卸载系统 CLI */
  onPurgeSystem: () => void
}

export function CliUninstallConfirm({
  open,
  onOpenChange,
  itemName,
  cliCommand,
  removing,
  onRemoveFromSession,
  onPurgeSystem,
}: CliUninstallConfirmProps): React.ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px] p-0 flex flex-col gap-0 rounded-2xl border-border/70 shadow-xl" hideClose>
        <DialogTitle className="sr-only">卸载 {itemName}</DialogTitle>
        <DialogDescription className="sr-only">选择卸载方式</DialogDescription>

        <div className="border-b border-border/60 px-5 py-4">
          <div className="text-[15px] font-semibold text-foreground">卸载 {itemName}</div>
          <div className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            系统已安装 CLI（{cliCommand ?? 'npm 全局包'}）。选择卸载方式：
          </div>
        </div>

        <div className="flex flex-col gap-2 px-5 py-4">
          <Button
            variant="outline"
            disabled={removing}
            onClick={() => onRemoveFromSession()}
            className="justify-start"
          >
            <PlugZap size={15} className="mr-2 shrink-0 text-muted-foreground" />
            <div className="flex flex-col items-start gap-0.5">
              <span className="text-[13px] font-medium">仅从会话移除</span>
              <span className="text-[11px] font-normal text-muted-foreground">
                保留系统 CLI，之后可随时「添加到会话」
              </span>
            </div>
          </Button>
          <Button
            variant="destructive"
            disabled={removing}
            onClick={() => onPurgeSystem()}
            className="justify-start"
          >
            {removing ? <Loader2 size={15} className="mr-2 animate-spin" /> : <Trash2 size={15} className="mr-2 shrink-0" />}
            <div className="flex flex-col items-start gap-0.5">
              <span className="text-[13px] font-medium">同时卸载系统 CLI</span>
              <span className="text-[11px] font-normal opacity-80">
                执行 npm uninstall -g，终端里也不再有此命令
              </span>
            </div>
          </Button>
        </div>

        <div className="flex justify-end border-t border-border/40 px-5 py-3">
          <Button variant="ghost" size="sm" disabled={removing} onClick={() => onOpenChange(false)}>
            取消
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
