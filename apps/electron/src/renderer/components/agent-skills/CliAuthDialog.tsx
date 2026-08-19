/**
 * CliAuthDialog — CLI 连接器扫码授权弹窗（企业微信 wecom-cli 等）
 *
 * 打开后调用 marketplaceCliAuthStart 生成二维码（PNG data URL），
 * UI 直接展示二维码 + 扫码链接；每 2s 轮询 marketplaceCliAuthStatus，
 * 认证成功自动关闭并通知父组件刷新；关闭时 marketplaceCliAuthCancel 终止挂起进程。
 */

import * as React from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, RefreshCw, ExternalLink, X, KeyRound, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'

interface CliAuthDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 市场条目 id（marketplace:<id> 里的原始 id） */
  itemId: string
  /** 连接器名称（标题展示） */
  itemName: string
  /** 认证方式：qr=扫码（默认）；token=输入 token（Readwise 等） */
  authKind?: 'qr' | 'token'
  /** token 模式：获取 token 的页面链接 */
  authTokenUrl?: string
  /** 认证成功回调（刷新列表用） */
  onAuthenticated?: () => void
}

export function CliAuthDialog({
  open,
  onOpenChange,
  itemId,
  itemName,
  authKind = 'qr',
  authTokenUrl,
  onAuthenticated,
}: CliAuthDialogProps): React.ReactElement {
  const [qrDataUrl, setQrDataUrl] = React.useState<string | undefined>()
  const [authUrl, setAuthUrl] = React.useState<string | undefined>()
  const [error, setError] = React.useState<string | undefined>()
  const [starting, setStarting] = React.useState(true)
  const [checked, setChecked] = React.useState(false)
  const [token, setToken] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [tokenDone, setTokenDone] = React.useState(false)
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null)

  /** 启动扫码（含刷新重试） */
  const startAuth = React.useCallback(async () => {
    setStarting(true)
    setError(undefined)
    setQrDataUrl(undefined)
    setAuthUrl(undefined)
    setChecked(false)
    try {
      const result = await window.electronAPI.marketplaceCliAuthStart(itemId)
      if (result.error) {
        setError(result.error)
      } else {
        setQrDataUrl(result.qrDataUrl)
        setAuthUrl(result.url)
        if (!result.qrDataUrl && !result.url) {
          setError('未能生成二维码，请重试')
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setStarting(false)
    }
  }, [itemId])

  /** 打开时启动 + 轮询认证状态（扫码模式；token 模式提交后也轮询复检） */
  React.useEffect(() => {
    if (!open) return
    if (authKind === 'qr') {
      void startAuth()
    } else {
      setStarting(false)
    }
    timerRef.current = setInterval(async () => {
      try {
        const status = await window.electronAPI.marketplaceCliAuthStatus(itemId)
        setChecked(true)
        if (status.authenticated) {
          if (timerRef.current) clearInterval(timerRef.current)
          toast.success(`${itemName} 认证成功`)
          onAuthenticated?.()
          onOpenChange(false)
        }
      } catch {
        // 轮询失败静默，下轮再试
      }
    }, 2000)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [open, itemId, itemName, onAuthenticated, onOpenChange, startAuth, authKind])

  /** token 模式：提交 token 写入凭据 */
  const handleTokenSubmit = React.useCallback(async () => {
    if (!token.trim()) return
    setSubmitting(true)
    setError(undefined)
    try {
      const result = await window.electronAPI.marketplaceCliAuthToken(itemId, token.trim())
      if (result.ok) {
        setTokenDone(true)
        toast.success(`${itemName} 认证成功`)
        onAuthenticated?.()
        onOpenChange(false)
      } else {
        setError(result.error ?? '认证失败')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }, [token, itemId, itemName, onAuthenticated, onOpenChange])

  /** 关闭时终止挂起的扫码进程 */
  const handleClose = React.useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    void window.electronAPI.marketplaceCliAuthCancel()
    onOpenChange(false)
  }, [onOpenChange])

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) handleClose() }}>
      <DialogContent className="sm:max-w-[420px] p-0 flex flex-col gap-0 rounded-2xl border-border/70 shadow-xl">
        <DialogTitle className="sr-only">{itemName} 扫码授权</DialogTitle>
        <DialogDescription className="sr-only">{itemName} 扫码授权弹窗</DialogDescription>

        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
          <div>
            <div className="text-[11px] font-medium text-muted-foreground">连接授权</div>
            <div className="text-[15px] font-semibold text-foreground">{itemName}</div>
          </div>
          <button
            onClick={handleClose}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>

        {/* 主体 */}
        <div className="flex flex-col items-center gap-3 px-5 py-5">
          {authKind === 'token' ? (
            <div className="flex w-full flex-col gap-3">
              <div className="flex flex-col items-center gap-1.5 rounded-lg border border-border/60 bg-muted/30 p-4">
                <KeyRound size={18} className="text-muted-foreground" />
                <div className="text-[13px] font-medium text-foreground">输入 Readwise API Token</div>
                <div className="text-center text-[12px] text-muted-foreground">
                  Token 在 Readwise 网页获取（登录后可见）
                </div>
                {authTokenUrl && (
                  <a
                    href={authTokenUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-0.5 inline-flex items-center gap-1 text-[12px] text-blue-600 hover:underline dark:text-blue-400"
                  >
                    <ExternalLink size={12} />
                    前往获取 Token
                  </a>
                )}
              </div>
              <Input
                type="password"
                placeholder="粘贴 Readwise Access Token（rk_...）"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleTokenSubmit() }}
                className="font-mono text-[13px]"
              />
              {error && (
                <div className="rounded-lg bg-amber-500/10 p-2.5 text-[12px] text-amber-600 dark:text-amber-400">
                  {error}
                </div>
              )}
              <Button
                disabled={!token.trim() || submitting}
                onClick={() => void handleTokenSubmit()}
                className="w-full"
              >
                {submitting ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <CheckCircle2 size={14} className="mr-1.5" />}
                {submitting ? '正在连接…' : '连接'}
              </Button>
              {tokenDone && (
                <div className="flex items-center justify-center gap-1.5 text-[12px] text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 size={12} />
                  已认证，正在关闭…
                </div>
              )}
            </div>
          ) : starting ? (
            <div className="flex h-[300px] w-full flex-col items-center justify-center gap-3">
              <Loader2 size={24} className="animate-spin text-muted-foreground" />
              <div className="text-[13px] text-muted-foreground">正在获取二维码…</div>
            </div>
          ) : error ? (
            <div className="flex h-[300px] w-full flex-col items-center justify-center gap-3 px-4 text-center">
              <div className="text-[13px] text-amber-600 dark:text-amber-400">{error}</div>
              <div className="text-[12px] text-muted-foreground">
                也可以打开系统终端，执行 <span className="font-mono">{itemName === '企业微信' ? 'wecom-cli auth init' : '相关 CLI 的 auth 命令'}</span> 完成授权
              </div>
              <Button variant="outline" size="sm" onClick={() => void startAuth()}>
                <RefreshCw size={14} className="mr-1.5" />
                重试
              </Button>
            </div>
          ) : (
            <>
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt={`${itemName} 扫码授权二维码`}
                  className="h-[240px] w-[240px] rounded-lg border border-border/60 bg-white p-2"
                />
              ) : (
                <div className="flex h-[240px] w-[240px] items-center justify-center rounded-lg border border-dashed border-border/60 text-[12px] text-muted-foreground">
                  二维码生成中…
                </div>
              )}
              <div className="text-[13px] text-foreground">
                请使用<strong>企业微信 App</strong>扫描二维码完成授权
              </div>
              {authUrl && (
                <a
                  href={authUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[12px] text-blue-600 hover:underline dark:text-blue-400"
                >
                  <ExternalLink size={12} />
                  打不开二维码？点此在浏览器打开
                </a>
              )}
              <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <Loader2 size={12} className="animate-spin" />
                等待扫码确认{checked ? '…' : '…'}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
