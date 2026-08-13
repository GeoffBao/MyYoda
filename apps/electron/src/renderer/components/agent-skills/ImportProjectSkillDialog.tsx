/**
 * ImportProjectSkillDialog — 从工作区默认或其他嵌套 Project 批量导入 Skill 到当前 Project
 *
 * 对齐 Proma「从其他项目批量导入 Skill」的真实交互模式（勾选多个、自动过滤同名项、一键批量导入），
 * 但来源限定在同一 MyYoda 工作区内：Proma 一个 workspace 绑定一个仓库，等价于这里的一个嵌套 Project，
 * 所以这里的“其他来源”是「工作区默认（跨项目共享）」+「同工作区下其他嵌套 Project」，不跨 MyYoda 工作区。
 *
 * 与 ImportSkillDialog（工作区级）的结构基本一致，仅把「来源工作区」换成「来源分组（工作区默认/某个 Project）」。
 */

import * as React from 'react'
import { toast } from 'sonner'
import { Check, Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SettingsCard } from '@/components/settings/primitives'
import { cn } from '@/lib/utils'
import type { BulkImportProjectSelection, BulkImportSkillsResult, OtherProjectSkillsGroup, SkillMeta } from '@myyoda/shared'

function getFailureDescription(result: BulkImportSkillsResult): string | undefined {
  const failed = result.items.filter((item) => item.status === 'failed')
  if (failed.length === 0) return undefined

  const visible = failed.slice(0, 3).map((item) => `${item.slug}: ${item.reason ?? '未知原因'}`)
  const remaining = failed.length - visible.length
  return `${visible.join('；')}${remaining > 0 ? `；另有 ${remaining} 个失败项` : ''}`
}

/** 来源分组的稳定 key（'workspace' 或 'project:{id}'），用于下拉选中态与勾选 key 前缀 */
function groupKeyOf(group: Pick<OtherProjectSkillsGroup, 'sourceKind' | 'sourceProjectId'>): string {
  return group.sourceKind === 'workspace' ? 'workspace' : `project:${group.sourceProjectId ?? ''}`
}

interface ImportProjectSkillDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceSlug: string
  /** 导入目标 Project ID */
  projectId: string
  installedSkills: SkillMeta[]
  onImported: () => void
}

export function ImportProjectSkillDialog({
  open,
  onOpenChange,
  workspaceSlug,
  projectId,
  installedSkills,
  onImported,
}: ImportProjectSkillDialogProps): React.ReactElement {
  const [otherGroups, setOtherGroups] = React.useState<OtherProjectSkillsGroup[]>([])
  const [selectedGroupKey, setSelectedGroupKey] = React.useState('')
  const [selectedKeys, setSelectedKeys] = React.useState<Set<string>>(new Set())
  const [loadingGroups, setLoadingGroups] = React.useState(false)
  const [importing, setImporting] = React.useState(false)
  const requestIdRef = React.useRef(0)
  const importOperationRef = React.useRef(0)
  const dialogScopeRef = React.useRef({ open, workspaceSlug, projectId })
  dialogScopeRef.current = { open, workspaceSlug, projectId }

  React.useEffect(() => {
    importOperationRef.current += 1
    setImporting(false)
  }, [workspaceSlug, projectId])

  React.useEffect(() => {
    const requestId = ++requestIdRef.current
    if (!open || !workspaceSlug || !projectId) {
      setOtherGroups([])
      setSelectedGroupKey('')
      setSelectedKeys(new Set())
      setLoadingGroups(false)
      return
    }

    // 每次打开或切换目标 Project 都丢弃旧列表，避免用户看到并操作过期来源。
    setOtherGroups([])
    setSelectedGroupKey('')
    setSelectedKeys(new Set())
    setLoadingGroups(true)

    void (async () => {
      try {
        const groups = await window.electronAPI.getOtherProjectSkills(workspaceSlug, projectId)
        if (requestIdRef.current !== requestId) return
        setOtherGroups(groups)
      } catch (error) {
        if (requestIdRef.current !== requestId) return
        console.error('[Agent 技能] 加载其他 Project Skill 失败:', error)
        setOtherGroups([])
        toast.error('加载其他项目 Skill 失败', {
          description: error instanceof Error ? error.message : '未知错误',
        })
      } finally {
        if (requestIdRef.current === requestId) setLoadingGroups(false)
      }
    })()

    return () => {
      // 让尚未完成的请求失效，防止旧 Project 响应覆盖新状态。
      if (requestIdRef.current === requestId) requestIdRef.current += 1
    }
  }, [open, workspaceSlug, projectId])

  const installedSlugs = React.useMemo(() => new Set(installedSkills.map((s) => s.slug)), [installedSkills])

  const availableGroups = React.useMemo(
    () =>
      otherGroups
        .map((g) => ({ ...g, skills: g.skills.filter((s) => !installedSlugs.has(s.slug)) }))
        .filter((g) => g.skills.length > 0),
    [otherGroups, installedSlugs],
  )

  // 来源分组下拉默认选中第一个可用分组（保持当前值仍有效时不切换）
  React.useEffect(() => {
    if (!open || loadingGroups || availableGroups.length === 0) {
      if (!loadingGroups) setSelectedGroupKey('')
      return
    }
    setSelectedGroupKey((current) =>
      availableGroups.some((g) => groupKeyOf(g) === current)
        ? current
        : groupKeyOf(availableGroups[0]!),
    )
  }, [availableGroups, loadingGroups, open])

  const selectedGroup = React.useMemo(
    () => availableGroups.find((g) => groupKeyOf(g) === selectedGroupKey) ?? null,
    [availableGroups, selectedGroupKey],
  )

  const selectedCount = React.useMemo(() => {
    if (!selectedGroup) return 0
    const prefix = groupKeyOf(selectedGroup)
    return selectedGroup.skills.filter((s) => selectedKeys.has(`${prefix}/${s.slug}`)).length
  }, [selectedGroup, selectedKeys])

  const toggleSelection = (groupPrefix: string, skillSlug: string): void => {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      const key = `${groupPrefix}/${skillSlug}`
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleGroupChange = (value: string): void => {
    setSelectedGroupKey(value)
    setSelectedKeys(new Set())
  }

  const handleDialogOpenChange = (nextOpen: boolean): void => {
    if (!nextOpen) {
      importOperationRef.current += 1
      setImporting(false)
    }
    onOpenChange(nextOpen)
  }

  const isActiveImportOperation = (operationId: number, targetWorkspaceSlug: string, targetProjectId: string): boolean => {
    return (
      importOperationRef.current === operationId &&
      dialogScopeRef.current.open &&
      dialogScopeRef.current.workspaceSlug === targetWorkspaceSlug &&
      dialogScopeRef.current.projectId === targetProjectId
    )
  }

  const handleImport = async (): Promise<void> => {
    if (!workspaceSlug || !projectId || importing || !selectedGroup || selectedCount === 0) return
    const operationId = ++importOperationRef.current
    const targetWorkspaceSlug = workspaceSlug
    const targetProjectId = projectId
    const prefix = groupKeyOf(selectedGroup)
    const selections: BulkImportProjectSelection[] = selectedGroup.skills
      .filter((s) => selectedKeys.has(`${prefix}/${s.slug}`))
      .map((s) => ({ sourceKind: selectedGroup.sourceKind, sourceProjectId: selectedGroup.sourceProjectId, skillSlug: s.slug }))
    setImporting(true)
    try {
      const importResult = await window.electronAPI.batchImportSkillsToProject(targetWorkspaceSlug, targetProjectId, selections)
      if (!isActiveImportOperation(operationId, targetWorkspaceSlug, targetProjectId)) return

      const failureDescription = getFailureDescription(importResult)
      if (importResult.imported > 0) {
        onImported()
        const detail =
          importResult.skipped > 0 && importResult.failed > 0
            ? `（跳过 ${importResult.skipped} 个、失败 ${importResult.failed} 个）`
            : importResult.skipped > 0
              ? `（跳过 ${importResult.skipped} 个）`
              : importResult.failed > 0
                ? `（失败 ${importResult.failed} 个）`
                : ''
        toast.success(`已导入 ${importResult.imported} 个 Skill${detail}`, {
          description: failureDescription,
        })
        handleDialogOpenChange(false)
      } else if (importResult.failed === 0) {
        toast.info(`没有新导入的 Skill，已跳过 ${importResult.skipped} 个同名项`)
      } else {
        toast.error(`导入失败 ${importResult.failed} 个${importResult.skipped > 0 ? `，跳过 ${importResult.skipped} 个` : ''}`, {
          description: failureDescription,
        })
      }
    } catch (error) {
      if (!isActiveImportOperation(operationId, targetWorkspaceSlug, targetProjectId)) return
      console.error('[Agent 技能] 批量导入到项目失败:', error)
      toast.error('批量导入失败', { description: error instanceof Error ? error.message : '未知错误' })
    } finally {
      if (isActiveImportOperation(operationId, targetWorkspaceSlug, targetProjectId)) setImporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="max-w-2xl gap-0 overflow-hidden p-0">
        <DialogHeader className="px-6 pb-4 pt-6">
          <DialogTitle>从其他项目批量导入 Skill</DialogTitle>
          <DialogDescription>
            从工作区默认或同工作区下其他项目勾选多个 Skill 导入到当前项目。已安装的同名 Skill 会自动过滤。
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto px-6 pb-6">
          {loadingGroups ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 size={15} className="animate-spin" />
              正在加载其他项目 Skill...
            </div>
          ) : availableGroups.length === 0 ? (
            <SettingsCard divided={false}>
              <div className="py-10 text-center text-sm text-muted-foreground">
                没有可导入的 Skill。工作区默认和其他项目暂无 Skill，或者都已经安装到当前项目了。
              </div>
            </SettingsCard>
          ) : (
            <div className="space-y-2">
              <div className="text-sm font-medium text-foreground">选择来源</div>
              <Select value={selectedGroupKey} onValueChange={handleGroupChange} disabled={loadingGroups || importing}>
                <SelectTrigger>
                  <SelectValue placeholder="选择来源" />
                </SelectTrigger>
                <SelectContent>
                  {availableGroups.map((g) => (
                    <SelectItem key={groupKeyOf(g)} value={groupKeyOf(g)}>
                      {g.sourceLabel}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {selectedGroup ? (
            <>
              <div className="mb-3 flex items-center justify-between gap-3 text-sm text-muted-foreground">
                <span className="truncate">{selectedGroup.sourceLabel}</span>
                <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-xs font-medium tabular-nums">
                  {selectedGroup.skills.length} 个
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {selectedGroup.skills.map((skill) => {
                  const prefix = groupKeyOf(selectedGroup)
                  const checked = selectedKeys.has(`${prefix}/${skill.slug}`)
                  return (
                    <SettingsCard key={skill.slug} divided={false} className="overflow-hidden">
                      <button
                        type="button"
                        aria-pressed={checked}
                        aria-label={`${skill.name}${checked ? '，已选中' : '，未选中'}`}
                        disabled={importing}
                        onClick={() => toggleSelection(prefix, skill.slug)}
                        className={cn(
                          'flex h-full w-full flex-col gap-3 p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                          checked ? 'bg-accent/40' : 'hover:bg-accent/30',
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <span
                            aria-hidden="true"
                            className={cn(
                              'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors',
                              checked
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-border/80 text-transparent',
                            )}
                          >
                            <Check size={13} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium text-foreground">{skill.name}</span>
                              {skill.version ? (
                                <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                                  v{skill.version}
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">{skill.slug}</div>
                          </div>
                          <Sparkles size={16} className="shrink-0 text-amber-500" />
                        </div>
                        <div className="line-clamp-3 min-h-[40px] text-sm leading-6 text-muted-foreground">
                          {skill.description ?? '暂无描述'}
                        </div>
                      </button>
                    </SettingsCard>
                  )
                })}
              </div>
            </>
          ) : null}
        </div>

        <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-border/60 bg-background/95 px-6 py-4">
          <span className="text-xs text-muted-foreground">
            {loadingGroups
              ? '正在加载其他项目 Skill...'
              : '勾选要导入的 Skill，已安装的同名 Skill 会自动过滤'}
          </span>
          <Button size="sm" onClick={() => void handleImport()} disabled={loadingGroups || importing || selectedCount === 0}>
            {importing ? <Loader2 size={13} className="animate-spin" /> : null}
            {importing ? '导入中...' : `一键导入所选（${selectedCount}）`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
