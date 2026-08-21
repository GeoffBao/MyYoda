/**
 * CustomHttpConnectorDialog — 在连接器页创建自定义 HTTP 工具。
 */

import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { extractHttpTemplateParams } from '@/lib/http-template-params'
import type { ChatToolMeta } from '@myyoda/shared'

interface CustomHttpConnectorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: () => void
}

export function CustomHttpConnectorDialog({
  open,
  onOpenChange,
  onCreated,
}: CustomHttpConnectorDialogProps): React.ReactElement {
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [method, setMethod] = React.useState<'GET' | 'POST'>('GET')
  const [urlTemplate, setUrlTemplate] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (open) return
    setName('')
    setDescription('')
    setMethod('GET')
    setUrlTemplate('')
    setSaving(false)
  }, [open])

  const handleCreate = async (): Promise<void> => {
    const trimmedName = name.trim()
    const trimmedUrl = urlTemplate.trim()
    if (!trimmedName || !trimmedUrl) {
      toast.error('请填写名称和 URL')
      return
    }

    const meta: ChatToolMeta = {
      id: `http-${Date.now().toString(36)}`,
      name: trimmedName,
      description: description.trim() || '自定义 HTTP 连接器',
      params: extractHttpTemplateParams(trimmedUrl),
      category: 'custom',
      executorType: 'http',
      httpConfig: {
        urlTemplate: trimmedUrl,
        method,
      },
    }

    setSaving(true)
    try {
      await window.electronAPI.createCustomChatTool(meta)
      toast.success(`已添加「${trimmedName}」，默认关闭`)
      onCreated?.()
      onOpenChange(false)
    } catch (error) {
      console.error('[连接器] 创建自定义 HTTP 失败:', error)
      toast.error('创建失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogTitle>添加自定义 HTTP</DialogTitle>
        <DialogDescription>
          按 URL 模板发请求。用 {'{{param}}'} 声明参数；添加后默认关闭，可在连接器里启用。
        </DialogDescription>

        <div className="flex flex-col gap-3 pt-1">
          <Field label="名称">
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如 天气查询" />
          </Field>
          <Field label="说明">
            <Input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Agent 什么时候该用它"
            />
          </Field>
          <div className="grid grid-cols-[7rem_1fr] gap-2">
            <Field label="方法">
              <select
                value={method}
                onChange={(event) => setMethod(event.target.value === 'POST' ? 'POST' : 'GET')}
                className="h-9 w-full rounded-md border border-border/60 bg-background/40 px-2 text-sm"
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
              </select>
            </Field>
            <Field label="URL 模板">
              <Input
                value={urlTemplate}
                onChange={(event) => setUrlTemplate(event.target.value)}
                placeholder="https://api.example.com/x?q={{query}}"
              />
            </Field>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button disabled={saving} onClick={() => void handleCreate()}>添加</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}
