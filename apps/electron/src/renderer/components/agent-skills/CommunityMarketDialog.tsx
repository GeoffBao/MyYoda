/**
 * CommunityMarketDialog — 社区市场
 *
 * 拉取 MyYoda 私有市场清单，浏览/搜索 Skill，一键安装到当前空间。
 */

import * as React from 'react'
import { toast } from 'sonner'
import { Store, Download, RefreshCw, Search, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import type { CommunitySkill } from '@myyoda/shared'

interface CommunityMarketDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceSlug: string
  installedSkills: Array<{ slug: string }>
  onImported: () => void
}

export function CommunityMarketDialog({ open, onOpenChange, workspaceSlug, installedSkills, onImported }: CommunityMarketDialogProps): React.ReactElement {
  const [skills, setSkills] = React.useState<CommunitySkill[]>([])
  const [loading, setLoading] = React.useState(false)
  const [installing, setInstalling] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)

  const installed = React.useMemo(
    () => new Set(installedSkills.map((s) => s.slug)),
    [installedSkills],
  )

  React.useEffect(() => {
    if (!open) return
    void load()
  }, [open, workspaceSlug])

  const load = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const data = await window.electronAPI.communityFetchManifest()
      setSkills(data)
    } catch (err) {
      console.error('[社区市场] 拉取清单失败:', err)
      setError((err as Error).message || '拉取社区市场失败')
    } finally {
      setLoading(false)
    }
  }

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return skills
    return skills.filter((s) =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.category?.toLowerCase().includes(q),
    )
  }, [skills, search])

  const handleInstall = async (skill: CommunitySkill): Promise<void> => {
    setInstalling(skill.name)
    try {
      await window.electronAPI.communityInstallSkill(workspaceSlug, skill)
      toast.success(`已从社区市场安装 Skill：${skill.displayName ?? skill.name}`)
      onImported()
    } catch (err) {
      console.error('[社区市场] 安装失败:', err)
      toast.error('安装失败', { description: (err as Error).message || undefined })
    } finally {
      setInstalling(null)
    }
  }

  const categoryCount = React.useMemo(() => {
    const map = new Map<string, number>()
    for (const s of skills) {
      const c = s.category ?? 'other'
      map.set(c, (map.get(c) ?? 0) + 1)
    }
    return map
  }, [skills])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Store className="size-5 text-emerald-500" />
            社区市场
          </DialogTitle>
          <DialogDescription>
            浏览社区贡献的 Agent Skills，一键安装到当前空间。由 MyYoda 官方维护，遵循各 Skill 的许可证。
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索技能 / 描述 / 分类..."
              className="pl-8"
            />
          </div>
          <Button variant="outline" size="icon" onClick={() => void load()} disabled={loading} title="刷新">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </Button>
        </div>

        {categoryCount.size > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {[...categoryCount.entries()].map(([cat, count]) => (
              <Badge key={cat} variant="secondary" className="gap-1 text-[11px]">
                {cat} · {count}
              </Badge>
            ))}
          </div>
        )}

        <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">加载中...</div>
          ) : error ? (
            <div className="py-10 text-center">
              <p className="text-sm text-destructive">{error}</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => void load()}>重试</Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {skills.length === 0 ? '社区市场暂无可用的 Skills' : '没有匹配的 Skill'}
            </div>
          ) : (
            filtered.map((skill) => {
              const already = installed.has(skill.name)
              return (
                <div key={skill.name} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{skill.displayName ?? skill.name}</span>
                      {skill.category && <Badge variant="outline" className="text-[10px]">{skill.category}</Badge>}
                      {skill.license && <span className="shrink-0 text-[10px] text-muted-foreground">{skill.license}</span>}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{skill.description || '暂无描述'}</p>
                    {skill.authorName && (
                      <p className="mt-0.5 text-[10px] text-muted-foreground/70">by {skill.authorName}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {skill.homepage && (
                      <a
                        href={skill.homepage}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/[0.06]"
                        title="查看项目主页"
                      >
                        <ExternalLink size={14} />
                      </a>
                    )}
                    <Button
                      size="sm"
                      variant={already ? 'ghost' : 'default'}
                      disabled={already || installing === skill.name}
                      onClick={() => void handleInstall(skill)}
                      className={already ? '' : 'bg-emerald-600 hover:bg-emerald-500'}
                    >
                      {installing === skill.name
                        ? <RefreshCw size={14} className="animate-spin" />
                        : <Download size={14} />}
                      {already ? '已安装' : '安装'}
                    </Button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
