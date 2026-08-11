/**
 * OrgSkillImportDialog — 从企业组织导入 Skill
 *
 * 列出当前组织的 Skills，选择后下载导入到当前工作区。
 * 未连接组织服务时提示先到设置页配置。
 */

import * as React from 'react'
import { toast } from 'sonner'
import { Building2, Download, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import type { OrganizationMembership, OrganizationSkill } from '@myyoda/shared'

interface OrgSkillImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceSlug: string
  installedSkills: Array<{ slug: string }>
  onImported: () => void
}

export function OrgSkillImportDialog({ open, onOpenChange, workspaceSlug, installedSkills, onImported }: OrgSkillImportDialogProps): React.ReactElement {
  const [memberships, setMemberships] = React.useState<OrganizationMembership[]>([])
  const [skills, setSkills] = React.useState<OrganizationSkill[]>([])
  const [selectedOrgId, setSelectedOrgId] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [importing, setImporting] = React.useState<string | null>(null)

  const installed = React.useMemo(
    () => new Set(installedSkills.map((s) => s.slug)),
    [installedSkills],
  )

  React.useEffect(() => {
    if (!open) return
    void (async () => {
      setLoading(true)
      try {
        const membershipData = await window.electronAPI.orgMe()
        setMemberships(membershipData)
        if (membershipData.length > 0) {
          const orgId = membershipData[0]!.orgId
          setSelectedOrgId(orgId)
          const skillData = await window.electronAPI.orgListSkills(orgId)
          setSkills(skillData)
        } else {
          setSkills([])
        }
      } catch (error) {
        console.error('[组织技能] 加载组织数据失败:', error)
        toast.error('加载组织数据失败，请先到「设置 → 企业组织技能」完成连接')
      } finally {
        setLoading(false)
      }
    })()
  }, [open, workspaceSlug])

  const handleSelectOrg = async (orgId: string): Promise<void> => {
    setSelectedOrgId(orgId)
    setLoading(true)
    try {
      const skillData = await window.electronAPI.orgListSkills(orgId)
      setSkills(skillData)
    } catch (error) {
      console.error('[组织技能] 加载 Skills 失败:', error)
      toast.error('加载 Skills 失败')
    } finally {
      setLoading(false)
    }
  }

  const handleImport = async (skill: OrganizationSkill): Promise<void> => {
    setImporting(skill.slug)
    try {
      const org = memberships.find((m) => m.orgId === selectedOrgId)
      await window.electronAPI.orgImportSkill(workspaceSlug, selectedOrgId, org?.orgName ?? '组织', skill)
      toast.success(`已导入 Skill：${skill.name}`)
      onImported()
      // 刷新列表去掉已安装项
      setSkills((prev) => prev.filter((s) => s.slug !== skill.slug))
    } catch (error) {
      console.error('[组织技能] 导入 Skill 失败:', error)
      toast.error('导入 Skill 失败', { description: error instanceof Error ? error.message : undefined })
    } finally {
      setImporting(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="size-5 text-indigo-500" />
            从企业组织导入技能
          </DialogTitle>
          <DialogDescription>
            选择组织中的 Skill 导入到当前工作区。管理员发布的 Skill 会随组织版本更新同步。
          </DialogDescription>
        </DialogHeader>

        {memberships.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            你尚未加入任何组织。
            <br />
            请先到「设置 → 企业组织技能」创建或加入企业组织。
          </div>
        ) : (
          <div className="space-y-4">
            {memberships.length > 1 && (
              <div className="flex gap-2">
                {memberships.map((m) => (
                  <Button
                    key={m.orgId}
                    size="sm"
                    variant={m.orgId === selectedOrgId ? 'default' : 'outline'}
                    onClick={() => void handleSelectOrg(m.orgId)}
                  >
                    {m.orgName}
                  </Button>
                ))}
              </div>
            )}

            <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
              {loading ? (
                <div className="py-8 text-center text-sm text-muted-foreground">加载中...</div>
              ) : skills.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  {memberships.length > 0 ? '该组织暂无已发布的 Skills' : '无 Skills'}
                </div>
              ) : (
                skills.map((skill) => {
                  const already = installed.has(skill.slug)
                  return (
                    <div
                      key={skill.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{skill.name}</span>
                          <Badge variant="outline" className="text-[10px]">v{skill.version}</Badge>
                        </div>
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">{skill.description || skill.slug}</div>
                      </div>
                      <Button
                        size="sm"
                        variant={already ? 'ghost' : 'default'}
                        disabled={already || importing === skill.slug}
                        onClick={() => void handleImport(skill)}
                        className="shrink-0"
                      >
                        {importing === skill.slug
                          ? <RefreshCw size={14} className="animate-spin" />
                          : <Download size={14} />}
                        {already ? '已安装' : '导入'}
                      </Button>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
