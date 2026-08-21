/**
 * ImportSkillDialog — 批量导入 Skill
 *
 * 工作区档：从其他工作区导入。项目档：从工作区默认或其他项目导入到当前项目。
 */

import * as React from 'react'
import { toast } from 'sonner'
import { Check, Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SettingsCard } from '@/components/settings/primitives'
import { cn } from '@/lib/utils'
import type { BulkImportSkillsResult, OtherWorkspaceSkillsGroup, SkillMeta } from '@myyoda/shared'

function getFailureDescription(result: BulkImportSkillsResult): string | undefined {
  const failed = result.items.filter((item) => item.status === 'failed')
  if (failed.length === 0) return undefined

  const visible = failed.slice(0, 3).map((item) => `${item.slug}: ${item.reason ?? '未知原因'}`)
  const remaining = failed.length - visible.length
  return `${visible.join('；')}${remaining > 0 ? `；另有 ${remaining} 个失败项` : ''}`
}

interface ImportSkillDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceSlug: string
  /** 选中项目时导入到该项目 Skills；否则导入到当前工作区 */
  projectId?: string | null
  installedSkills: SkillMeta[]
  onImported: () => void
}

export function ImportSkillDialog({
  open,
  onOpenChange,
  workspaceSlug,
  projectId,
  installedSkills,
  onImported,
}: ImportSkillDialogProps): React.ReactElement {
  const [otherWorkspaces, setOtherWorkspaces] = React.useState<OtherWorkspaceSkillsGroup[]>([])
  const [selectedWorkspaceSlug, setSelectedWorkspaceSlug] = React.useState('')
  const [selectedKeys, setSelectedKeys] = React.useState<Set<string>>(new Set())
  const [loadingWorkspaces, setLoadingWorkspaces] = React.useState(false)
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
    if (!open || !workspaceSlug) {
      setOtherWorkspaces([])
      setSelectedWorkspaceSlug('')
      setSelectedKeys(new Set())
      setLoadingWorkspaces(false)
      return
    }

    // 每次打开或切换目标项目都丢弃旧列表，避免用户看到并操作过期来源。
    setOtherWorkspaces([])
    setSelectedWorkspaceSlug('')
    setSelectedKeys(new Set())
    setLoadingWorkspaces(true)

    void (async () => {
      try {
        const groups: OtherWorkspaceSkillsGroup[] = projectId
          ? (await window.electronAPI.getOtherProjectSkills(workspaceSlug, projectId)).map((group) => ({
              workspaceSlug: `${group.sourceKind}:${group.sourceProjectId ?? ''}`,
              workspaceName: group.sourceLabel,
              skills: group.skills,
            }))
          : await window.electronAPI.getOtherWorkspaceSkills(workspaceSlug)
        if (requestIdRef.current !== requestId) return
        setOtherWorkspaces(groups)
      } catch (error) {
        if (requestIdRef.current !== requestId) return
        console.error('[Agent 技能] 加载可导入 Skill 失败:', error)
        setOtherWorkspaces([])
        toast.error('加载可导入 Skill 失败', {
          description: error instanceof Error ? error.message : '未知错误',
        })
      } finally {
        if (requestIdRef.current === requestId) setLoadingWorkspaces(false)
      }
    })()

    return () => {
      // 让尚未完成的请求失效，防止旧工作区响应覆盖新状态。
      if (requestIdRef.current === requestId) requestIdRef.current += 1
    }
  }, [open, projectId, workspaceSlug])

  const installedSlugs = React.useMemo(() => new Set(installedSkills.map((s) => s.slug)), [installedSkills])

  /** 只显示有可导入项的工作区（同名全过滤的不占用下拉，避免选项过多） */
  const availableWorkspaces = React.useMemo(
    () =>
      otherWorkspaces
        .map((w) => {
          const importable = w.skills.filter((s) => !installedSlugs.has(s.slug))
          return { ...w, skills: importable, remainingCount: importable.length }
        })
        .filter((w) => w.remainingCount > 0),
    [otherWorkspaces, installedSlugs],
  )

  // 来源工作区下拉默认选中第一个可用工作区（保持当前值仍有效时不切换）
  React.useEffect(() => {
    if (!open || loadingWorkspaces || availableWorkspaces.length === 0) {
      if (!loadingWorkspaces) setSelectedWorkspaceSlug('')
      return
    }
    setSelectedWorkspaceSlug((current) =>
      availableWorkspaces.some((w) => w.workspaceSlug === current)
        ? current
        : availableWorkspaces[0]!.workspaceSlug,
    )
  }, [availableWorkspaces, loadingWorkspaces, open])

  const selectedWorkspace = React.useMemo(
    () => availableWorkspaces.find((w) => w.workspaceSlug === selectedWorkspaceSlug) ?? null,
    [availableWorkspaces, selectedWorkspaceSlug],
  )

  const selectedCount = React.useMemo(() => {
    if (!selectedWorkspace) return 0
    return selectedWorkspace.skills.filter((s) =>
      selectedKeys.has(`${selectedWorkspace.workspaceSlug}/${s.slug}`),
    ).length
  }, [selectedWorkspace, selectedKeys])

  const toggleSelection = (sourceSlug: string, skillSlug: string): void => {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      const key = `${sourceSlug}/${skillSlug}`
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleWorkspaceChange = (value: string): void => {
    setSelectedWorkspaceSlug(value)
    setSelectedKeys(new Set())
  }

  const handleDialogOpenChange = (nextOpen: boolean): void => {
    if (!nextOpen) {
      importOperationRef.current += 1
      setImporting(false)
    }
    onOpenChange(nextOpen)
  }

  const isActiveImportOperation = (operationId: number, targetWorkspaceSlug: string, targetProjectId: string | null | undefined): boolean => {
    return (
      importOperationRef.current === operationId &&
      dialogScopeRef.current.open &&
      dialogScopeRef.current.workspaceSlug === targetWorkspaceSlug &&
      (dialogScopeRef.current.projectId ?? null) === (targetProjectId ?? null)
    )
  }

  const handleImport = async (): Promise<void> => {
    if (!workspaceSlug || importing || !selectedWorkspace || selectedCount === 0) return
    const operationId = ++importOperationRef.current
    const targetWorkspaceSlug = workspaceSlug
    const targetProjectId = projectId ?? null
    setImporting(true)
    try {
      const importResult = targetProjectId
        ? await window.electronAPI.batchImportSkillsToProject(
            targetWorkspaceSlug,
            targetProjectId,
            selectedWorkspace.skills
              .filter((s) => selectedKeys.has(`${selectedWorkspace.workspaceSlug}/${s.slug}`))
              .map((s) => {
                const separator = selectedWorkspace.workspaceSlug.indexOf(':')
                const sourceKind = selectedWorkspace.workspaceSlug.slice(0, separator) === 'project' ? 'project' as const : 'workspace' as const
                const sourceProjectId = selectedWorkspace.workspaceSlug.slice(separator + 1) || undefined
                return { sourceKind, sourceProjectId, skillSlug: s.slug }
              }),
          )
        : await window.electronAPI.batchImportSkillsFromWorkspaces(
            targetWorkspaceSlug,
            selectedWorkspace.skills
              .filter((s) => selectedKeys.has(`${selectedWorkspace.workspaceSlug}/${s.slug}`))
              .map((s) => ({ sourceSlug: selectedWorkspace.workspaceSlug, skillSlug: s.slug })),
          )
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
      console.error('[Agent 技能] 批量导入失败:', error)
      toast.error('批量导入失败', { description: error instanceof Error ? error.message : '未知错误' })
    } finally {
      if (isActiveImportOperation(operationId, targetWorkspaceSlug, targetProjectId)) setImporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="max-w-2xl gap-0 overflow-hidden p-0">
        <DialogHeader className="px-6 pb-4 pt-6">
          <DialogTitle>{projectId ? '导入 Skill 到当前项目' : '从其他工作区批量导入 Skill'}</DialogTitle>
          <DialogDescription>
            {projectId
              ? '从工作区默认或其他项目勾选 Skill，导入后只在本项目生效。已有的同名 Skill 会自动过滤。'
              : '从其他工作区勾选多个 Skill 导入到当前工作区。已安装的同名 Skill 会自动过滤。'}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto px-6 pb-6">
          {loadingWorkspaces ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 size={15} className="animate-spin" />
              正在加载可导入 Skill...
            </div>
          ) : availableWorkspaces.length === 0 ? (
            <SettingsCard divided={false}>
              <div className="py-10 text-center text-sm text-muted-foreground">
                没有可导入的 Skill。来源暂无 Skill，或者它们都已经安装了。
              </div>
            </SettingsCard>
          ) : (
            <div className="space-y-2">
              <div className="text-sm font-medium text-foreground">{projectId ? '选择来源' : '选择来源工作区'}</div>
              <Select value={selectedWorkspaceSlug} onValueChange={handleWorkspaceChange} disabled={loadingWorkspaces || importing}>
                <SelectTrigger>
                  <SelectValue placeholder={projectId ? '选择来源' : '选择来源工作区'} />
                </SelectTrigger>
                <SelectContent>
                  {availableWorkspaces.map((w) => (
                    <SelectItem key={w.workspaceSlug} value={w.workspaceSlug}>
                      {w.workspaceName}（{w.remainingCount} 个可导入）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {selectedWorkspace ? (
            <>
              <div className="mb-3 flex items-center justify-between gap-3 text-sm text-muted-foreground">
                <span className="truncate">{selectedWorkspace.workspaceName}</span>
                <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-xs font-medium tabular-nums">
                  {selectedWorkspace.skills.length} 个
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {selectedWorkspace.skills.map((skill) => {
                  const checked = selectedKeys.has(`${selectedWorkspace.workspaceSlug}/${skill.slug}`)
                  return (
                    <SettingsCard key={skill.slug} divided={false} className="overflow-hidden">
                      <button
                        type="button"
                        aria-pressed={checked}
                        aria-label={`${skill.name}${checked ? '，已选中' : '，未选中'}`}
                        disabled={importing}
                        onClick={() => toggleSelection(selectedWorkspace.workspaceSlug, skill.slug)}
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
            {loadingWorkspaces
              ? '正在加载可导入 Skill...'
              : '勾选要导入的 Skill，已安装的同名 Skill 会自动过滤'}
          </span>
          <Button size="sm" onClick={() => void handleImport()} disabled={loadingWorkspaces || importing || selectedCount === 0}>
            {importing ? <Loader2 size={13} className="animate-spin" /> : null}
            {importing ? '导入中...' : `一键导入所选（${selectedCount}）`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
