/**
 * ConnectorDetailDialog — 连接器详情居中模态（对标小米 Mico / PR #105）
 *
 * 展示来源、类型、权限、配置方式、能做什么、故障下一步；测试连接；启用/停用。
 * 我的连接的编辑表单嵌在同一弹层，不再另开右侧 Sheet。
 */

import * as React from 'react'
import { CheckCircle2, Loader2, Trash2, XCircle } from 'lucide-react'
import { useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { NanoBananaSettings, WebSearchSettings } from '@/components/settings/ToolSettings'
import { McpServerForm } from '@/components/settings/McpServerForm'
import { chatToolsAtom } from '@/atoms/chat-tool-atoms'
import { getConnectorIcon } from '@/lib/builtin-mcp-icons'
import { describeConnectorDetail } from '@/lib/connector-detail-model'
import { cn } from '@/lib/utils'
import type { ConnectorItem } from '@/lib/connectors-model'
import type { BuiltinMcpServerSummary, McpServerEntry } from '@myyoda/shared'

interface ConnectorDetailDialogProps {
  item: ConnectorItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
  builtinServers: BuiltinMcpServerSummary[]
  userEntries: Array<[string, McpServerEntry]>
  workspaceSlug: string
  projectId?: string | null
  onToggle?: (item: ConnectorItem, enabled: boolean) => void
  onUserMcpChanged?: () => void
  onDeletedHttp?: () => void
}

export function ConnectorDetailDialog({
  item,
  open,
  onOpenChange,
  builtinServers,
  userEntries,
  workspaceSlug,
  projectId,
  onToggle,
  onUserMcpChanged,
  onDeletedHttp,
}: ConnectorDetailDialogProps): React.ReactElement {
  const [editingUserMcp, setEditingUserMcp] = React.useState(false)
  const [testing, setTesting] = React.useState(false)
  const [testResult, setTestResult] = React.useState<{ success: boolean; message: string } | null>(null)

  React.useEffect(() => {
    if (!open) {
      setEditingUserMcp(false)
      setTesting(false)
      setTestResult(null)
    }
  }, [open, item?.id])

  const userEntry = item?.kind === 'user-mcp'
    ? userEntries.find(([name]) => name === item.sourceId)?.[1]
    : undefined
  const canTest = item?.id === 'builtin:chrome-devtools'
    || (item?.kind === 'user-mcp' && !!userEntry)
  const showFooter = !editingUserMcp

  const handleTest = React.useCallback(async (): Promise<void> => {
    if (!item) return
    setTesting(true)
    setTestResult(null)
    try {
      if (item.id === 'builtin:chrome-devtools') {
        setTestResult(await window.electronAPI.testBuiltinConnector(item.sourceId))
        onUserMcpChanged?.()
        return
      }
      if (item.kind === 'user-mcp' && userEntry) {
        setTestResult(await window.electronAPI.testMcpServer(item.sourceId, userEntry))
      }
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setTesting(false)
    }
  }, [item, onUserMcpChanged, userEntry])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[86vh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">{item?.name ?? '连接器详情'}</DialogTitle>
        <DialogDescription className="sr-only">{item?.description ?? '查看连接器能力、配置与状态。'}</DialogDescription>

        <header className="shrink-0 border-b border-border/60 px-6 pb-4 pr-12 pt-5">
          {item && (
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {item.sourceLabel}
            </div>
          )}
          <div className="mt-2 flex items-start gap-3">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.04]">
              {item ? getConnectorIcon(item) : null}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-lg font-semibold text-foreground">
                {item?.name ?? '连接器详情'}
              </h2>
              {item && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[
                    ['类型', item.typeLabel],
                    ['分类', item.categoryLabel],
                    ['状态', item.statusLabel],
                  ].map(([field, label]) => (
                    <span
                      key={field}
                      className="rounded-md bg-foreground/[0.05] px-1.5 py-0.5 text-[11px] font-medium text-foreground/70"
                    >
                      {label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 scrollbar-thin">
          {editingUserMcp && item && userEntry ? (
            <McpServerForm
              key={item.sourceId}
              server={{ name: item.sourceId, entry: userEntry }}
              workspaceSlug={workspaceSlug}
              projectId={projectId}
              onSaved={() => {
                setEditingUserMcp(false)
                onUserMcpChanged?.()
              }}
              onChanged={onUserMcpChanged}
              onCancel={() => setEditingUserMcp(false)}
            />
          ) : (
            <DetailBody
              item={item}
              builtinServers={builtinServers}
              userEntries={userEntries}
              testResult={testResult}
              onUserMcpChanged={onUserMcpChanged}
              onEditUserMcp={() => setEditingUserMcp(true)}
              onDeletedHttp={() => {
                onDeletedHttp?.()
                onOpenChange(false)
              }}
            />
          )}
        </div>

        {showFooter && (
          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border/60 px-6 py-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              继续浏览
            </Button>
            <div className="flex items-center gap-2">
              {canTest && (
                <Button variant="outline" disabled={testing} onClick={() => void handleTest()}>
                  {testing ? <Loader2 size={14} className="animate-spin" /> : null}
                  测试连接
                </Button>
              )}
              {item && onToggle && (
                <Button
                  variant={item.enabled ? 'outline' : 'default'}
                  onClick={() => onToggle(item, !item.enabled)}
                >
                  {item.enabled ? '停用' : '启用'}
                </Button>
              )}
            </div>
          </footer>
        )}
      </DialogContent>
    </Dialog>
  )
}

interface DetailBodyProps {
  item: ConnectorItem | null
  builtinServers: BuiltinMcpServerSummary[]
  userEntries: Array<[string, McpServerEntry]>
  testResult: { success: boolean; message: string } | null
  onUserMcpChanged?: () => void
  onEditUserMcp: () => void
  onDeletedHttp?: () => void
}

function DetailBody({
  item,
  builtinServers,
  userEntries,
  testResult,
  onUserMcpChanged,
  onEditUserMcp,
  onDeletedHttp,
}: DetailBodyProps): React.ReactElement {
  const chatTools = useAtomValue(chatToolsAtom)
  const setChatTools = useSetAtom(chatToolsAtom)

  if (!item) {
    return <p className="text-sm text-muted-foreground">未选择连接器。</p>
  }

  const meta = describeConnectorDetail(item)
  const credentialForm = credentialFormOf(item)
  const builtin = item.kind === 'builtin-mcp' ? builtinServers.find((server) => server.id === item.sourceId) : undefined
  const userEntry = item.kind === 'user-mcp' ? userEntries.find(([name]) => name === item.sourceId)?.[1] : undefined
  const customTool = item.kind === 'custom-http' ? chatTools.find((tool) => tool.meta.id === item.sourceId) : undefined
  const writable = builtin?.tools.some((tool) => !tool.readOnly) ?? item.kind !== 'api-tool'

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] leading-relaxed text-muted-foreground">{item.description}</p>

      {meta.nextStep && (
        <div className="rounded-lg bg-amber-500/10 px-3 py-2.5 text-[13px] text-amber-700 dark:text-amber-400">
          {meta.nextStep}
        </div>
      )}

      <InfoRow label="来源" value={item.sourceLabel} />
      <InfoRow label="类型" value={`${item.typeLabel} · ${item.categoryLabel}`} />
      <InfoRow label="权限" value={meta.permissionLabel} />
      <InfoRow label="配置方式" value={meta.configMethodLabel} />

      <div className="flex flex-col gap-2">
        <div className="text-sm font-medium text-foreground">能做什么</div>
        <ul className="flex flex-col gap-1.5">
          {meta.capabilities.map((line) => (
            <li key={line} className="rounded-lg bg-muted/45 px-3 py-2 text-[13px] text-foreground">
              {line}
            </li>
          ))}
        </ul>
      </div>

      {item.kind === 'builtin-mcp' && builtin && builtin.tools.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-sm font-medium text-foreground">包含工具</div>
          <ul className="flex flex-col gap-1.5">
            {builtin.tools.map((tool) => (
              <li key={tool.name} className="rounded-lg bg-muted/45 px-3 py-2 text-[13px] text-foreground">
                <span className="font-medium">{tool.name}</span>
                {tool.readOnly ? <span className="ml-1.5 text-[11px] text-muted-foreground">（只读）</span> : null}
                {tool.description ? <span className="block text-[12px] text-muted-foreground">{tool.description}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-[12px] leading-relaxed text-muted-foreground">
        启用后，Agent 可能在任务中调用此能力。
        {writable ? '高风险写操作仍会在运行时请求确认。' : ''}
      </p>

      {testResult && (
        <div className={cn(
          'flex items-start gap-2 rounded-lg p-3 text-sm',
          testResult.success
            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
            : 'bg-destructive/10 text-destructive',
        )}>
          {testResult.success
            ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
            : <XCircle size={16} className="mt-0.5 shrink-0" />}
          <span>{testResult.message}</span>
        </div>
      )}

      {credentialForm === 'web-search' && <WebSearchSettings embedded />}
      {credentialForm === 'nano-banana' && <NanoBananaSettings embedded onChanged={onUserMcpChanged} />}

      {item.kind === 'user-mcp' && userEntry && (
        <div className="flex flex-col gap-3">
          <InfoRow label="传输" value={userEntry.type.toUpperCase()} />
          {userEntry.type === 'stdio' && userEntry.command && (
            <InfoRow label="命令" value={userEntry.command} mono />
          )}
          {(userEntry.type === 'http' || userEntry.type === 'sse') && userEntry.url && (
            <InfoRow label="URL" value={userEntry.url} mono />
          )}
          {userEntry.lastTestResult && (
            <div className={cn(
              'flex items-start gap-2 rounded-lg p-3 text-sm',
              userEntry.lastTestResult.success
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'bg-destructive/10 text-destructive',
            )}>
              {userEntry.lastTestResult.success
                ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
                : <XCircle size={16} className="mt-0.5 shrink-0" />}
              <span className="flex flex-col gap-0.5">
                <span>{userEntry.lastTestResult.message}</span>
                <span className="text-[11px] opacity-70">
                  最近测试：{new Date(userEntry.lastTestResult.timestamp).toLocaleString()}
                </span>
              </span>
            </div>
          )}
          <Button variant="outline" size="sm" className="self-start" onClick={onEditUserMcp}>
            编辑配置
          </Button>
        </div>
      )}

      {item.kind === 'custom-http' && customTool?.meta.httpConfig && (
        <div className="flex flex-col gap-3">
          <InfoRow label="方法" value={customTool.meta.httpConfig.method} />
          <InfoRow label="URL 模板" value={customTool.meta.httpConfig.urlTemplate} mono />
          {customTool.meta.params.length > 0 && (
            <InfoRow
              label="参数"
              value={customTool.meta.params.map((param) => param.name).join('、')}
            />
          )}
          <div className="flex justify-end border-t border-border/60 pt-3">
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => {
                void window.electronAPI
                  .deleteCustomChatTool(item.sourceId)
                  .then(() => window.electronAPI.getChatTools())
                  .then((tools) => {
                    setChatTools(tools)
                    toast.success(`已删除工具：${item.name}`)
                    onDeletedHttp?.()
                  })
                  .catch(() => toast.error('删除工具失败'))
              }}
            >
              <Trash2 size={14} />
              删除该工具
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function credentialFormOf(item: ConnectorItem): 'web-search' | 'nano-banana' | null {
  if (item.id === 'api:web-search') return 'web-search'
  if (item.id === 'builtin:nano-banana') return 'nano-banana'
  return null
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }): React.ReactElement {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-muted/45 px-3 py-2.5">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      <span className={cn('break-all text-[13px] text-foreground', mono && 'font-mono text-[12px]')}>
        {value}
      </span>
    </div>
  )
}
