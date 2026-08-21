/**
 * ConnectorDetailDialog — 连接器详情居中模态（对标小米 Mico 的连接器详情弹窗）
 *
 * 壳负责：头部（小字标签 + 品牌图标 + 名称 + 标签组）、主体（children 注入）、
 * 底部操作栏（「继续浏览」+ 可选主操作）。主体内容由父组件按连接器类型分发。
 */

import * as React from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ConnectorDetailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 头部小字标签，如「预置连接器」「系统能力」「自定义连接器」 */
  eyebrow?: string
  title: string
  /** 品牌图标节点 */
  icon?: React.ReactNode
  /** 标签组文案（MCP 连接器 / 传输方式 / 品类 / 风险等级等） */
  tags?: string[]
  /** 底部主操作按钮文案（不传则不渲染主按钮） */
  primaryLabel?: string
  onPrimary?: () => void
  /** 主按钮是否禁用 */
  primaryDisabled?: boolean
  children?: React.ReactNode
  /** 主体区最大高度（配置表单较长时滚动），默认 none */
  bodyClassName?: string
}

export function ConnectorDetailDialog({
  open,
  onOpenChange,
  eyebrow,
  title,
  icon,
  tags,
  primaryLabel,
  onPrimary,
  primaryDisabled,
  children,
  bodyClassName,
}: ConnectorDetailDialogProps): React.ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'sm:max-w-[560px] p-0 flex flex-col gap-0 max-h-[85vh]',
          'rounded-2xl border-border/70 shadow-xl',
        )}
        hideClose
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{title} 详情</DialogDescription>

        {/* 头部 */}
        <div className="shrink-0 border-b border-border/60 px-6 pb-4 pt-5">
          {eyebrow && (
            <div className="mb-2 text-[12px] font-medium text-muted-foreground">{eyebrow}</div>
          )}
          <div className="flex items-center gap-3">
            {icon && (
              <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-content-area shadow-sm">
                {icon}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-lg font-semibold text-foreground">{title}</h2>
            </div>
          </div>
          {tags && tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-md bg-muted/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* 主体 */}
        <div className={cn('min-h-0 flex-1 overflow-y-auto scrollbar-thin px-6 py-4', bodyClassName)}>
          {children}
        </div>

        {/* 底部操作栏（对标 Mico：次要「继续浏览」+ 主要「安装/启用/保存」） */}
        <div className="shrink-0 border-t border-border/60 px-6 py-4">
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              继续浏览
            </Button>
            {primaryLabel && onPrimary && (
              <Button onClick={onPrimary} disabled={primaryDisabled}>
                {primaryLabel}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
