/**
 * SubmitToCommunityDialog — 把本地 Skill 提交到社区市场
 *
 * 全程依赖用户本机已安装并登录的 gh（GitHub CLI）：检测就绪状态 → 填写分类/License →
 * 确认后调用主进程走 fork/clone/commit/push/gh pr create，完成后展示 PR 链接。
 * MyYoda 不存储任何 GitHub 凭证。
 */

import * as React from 'react'
import { toast } from 'sonner'
import { UploadCloud, ExternalLink, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import type { GhCliStatus, SkillMeta } from '@myyoda/shared'

interface SubmitToCommunityDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceSlug: string
  skill: SkillMeta
}

type Stage = 'checking' | 'not_installed' | 'not_authenticated' | 'ready' | 'submitting' | 'success'

export function SubmitToCommunityDialog({ open, onOpenChange, workspaceSlug, skill }: SubmitToCommunityDialogProps): React.ReactElement {
  const [stage, setStage] = React.useState<Stage>('checking')
  const [ghStatus, setGhStatus] = React.useState<GhCliStatus | null>(null)
  const [category, setCategory] = React.useState('community')
  const [categoryOptions, setCategoryOptions] = React.useState<string[]>([])
  const [license, setLicense] = React.useState('MIT')
  const [homepage, setHomepage] = React.useState('')
  const [prUrl, setPrUrl] = React.useState('')

  const checkGhCli = React.useCallback(async (): Promise<void> => {
    setStage('checking')
    try {
      const status = await window.electronAPI.communityCheckGhCli()
      setGhStatus(status)
      if (!status.installed) setStage('not_installed')
      else if (!status.authenticated) setStage('not_authenticated')
      else setStage('ready')
    } catch (error) {
      console.error('[社区提交] 检测 gh CLI 失败:', error)
      setGhStatus(null)
      setStage('not_installed')
    }
  }, [])

  React.useEffect(() => {
    if (!open) return
    setCategory((skill.group ?? 'community').toLowerCase())
    setLicense('MIT')
    setHomepage('')
    setPrUrl('')
    void checkGhCli()
    window.electronAPI.communityFetchManifest()
      .then((skills) => {
        const cats = [...new Set(skills.map((s) => s.category).filter((c): c is string => !!c))].sort()
        setCategoryOptions(cats)
      })
      .catch(() => { /* 分类建议是锦上添花，拉取失败不影响提交 */ })
  }, [open, skill.group, checkGhCli])

  const handleSubmit = async (): Promise<void> => {
    setStage('submitting')
    try {
      const result = await window.electronAPI.communitySubmitSkill({
        workspaceSlug,
        skillSlug: skill.slug,
        category: category.trim() || 'community',
        license: license.trim() || 'MIT',
        homepage: homepage.trim() || undefined,
      })
      setPrUrl(result.prUrl)
      setStage('success')
      toast.success('已创建 Pull Request')
    } catch (error) {
      console.error('[社区提交] 提交失败:', error)
      toast.error('提交失败', { description: (error as Error).message || undefined })
      setStage('ready')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UploadCloud className="size-5 text-emerald-500" />
            上传到社区市场
          </DialogTitle>
          <DialogDescription>
            把「{skill.name}」提交为 Pull Request，通过审核后其他人就能在社区市场里安装它。
          </DialogDescription>
        </DialogHeader>

        {stage === 'checking' && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            <RefreshCw size={16} className="mx-auto mb-2 animate-spin" />
            正在检测 gh（GitHub CLI）...
          </div>
        )}

        {stage === 'not_installed' && (
          <div className="space-y-3">
            <Alert>
              <AlertTriangle className="size-4" />
              <AlertTitle>未检测到 gh（GitHub CLI）</AlertTitle>
              <AlertDescription>
                上传功能依赖本机的 GitHub CLI 自动创建 Pull Request，MyYoda 不会存储任何 GitHub 凭证。请先安装 gh 并登录。
              </AlertDescription>
            </Alert>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => void window.electronAPI.openExternal('https://cli.github.com/')}>
                <ExternalLink size={14} /> 查看安装文档
              </Button>
              <Button size="sm" onClick={() => void checkGhCli()}>
                <RefreshCw size={14} /> 重新检测
              </Button>
            </div>
          </div>
        )}

        {stage === 'not_authenticated' && (
          <div className="space-y-3">
            <Alert>
              <AlertTriangle className="size-4" />
              <AlertTitle>gh 尚未登录 GitHub</AlertTitle>
              <AlertDescription>
                已检测到 gh {ghStatus?.version}，请先在终端执行 <code className="rounded bg-muted px-1 py-0.5">gh auth login</code> 完成登录后重试。
              </AlertDescription>
            </Alert>
            <div className="flex justify-end">
              <Button size="sm" onClick={() => void checkGhCli()}>
                <RefreshCw size={14} /> 重新检测
              </Button>
            </div>
          </div>
        )}

        {(stage === 'ready' || stage === 'submitting') && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="submit-category">分类</Label>
              <Input
                id="submit-category"
                list="community-category-options"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="例如 tools / automation / community"
              />
              <datalist id="community-category-options">
                {categoryOptions.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="submit-license">License</Label>
              <Input id="submit-license" value={license} onChange={(e) => setLicense(e.target.value)} placeholder="MIT" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="submit-homepage">主页链接（可选）</Label>
              <Input id="submit-homepage" value={homepage} onChange={(e) => setHomepage(e.target.value)} placeholder="https://..." />
            </div>

            <Alert variant="destructive">
              <AlertTriangle className="size-4" />
              <AlertDescription>
                以 <span className="font-mono">{ghStatus?.login}</span> 身份 fork <span className="font-mono">GeoffBao/myyoda-skills</span>、
                推送新分支并创建真实的 Pull Request。可在 GitHub 上关闭或撤回，但请确认无误后再提交。
              </AlertDescription>
            </Alert>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={stage === 'submitting'}>取消</Button>
              <Button onClick={() => void handleSubmit()} disabled={stage === 'submitting'} className="bg-emerald-600 hover:bg-emerald-500">
                {stage === 'submitting' ? <RefreshCw size={14} className="animate-spin" /> : <UploadCloud size={14} />}
                {stage === 'submitting' ? '提交中...' : '提交 PR'}
              </Button>
            </DialogFooter>
          </div>
        )}

        {stage === 'success' && (
          <div className="space-y-4">
            <Alert>
              <CheckCircle2 className="size-4 text-emerald-500" />
              <AlertTitle>Pull Request 已创建</AlertTitle>
              <AlertDescription>
                审核通过后即可在社区市场安装。
              </AlertDescription>
            </Alert>
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2.5">
              <span className="truncate text-sm text-foreground">{prUrl}</span>
              <Button size="sm" variant="outline" onClick={() => void window.electronAPI.openExternal(prUrl)}>
                <ExternalLink size={14} /> 打开
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>完成</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
