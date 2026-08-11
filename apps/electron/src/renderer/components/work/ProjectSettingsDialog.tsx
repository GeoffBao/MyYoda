/**
 * ProjectSettingsDialog — 项目设置弹窗
 *
 * 从侧栏项目菜单触发，编辑项目元信息和默认专家。Project Knowledge 只在项目页面维护。
 */

import * as React from 'react'
import { Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { WorkingDirectoryField } from '@/components/app-shell/kanban/WorkingDirectoryField'
import { AccentColorPicker } from './AccentColorPicker'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useExpertOptions } from '@/components/agent-experts/useExpertOptions'
import type { KanbanProject } from '@/components/app-shell/kanban/types'
import { buildProjectUpdate, type ProjectSettingsDraft } from './project-view-model'

// ── 卡片分区：用轻量卡片替代整页表单堆叠，分区之间视觉更清楚 ──────────

function SettingsCard({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <section className="space-y-3 rounded-xl border border-border/40 bg-muted/20 p-4 shadow-sm">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

// ── component ──────────────────────────────────

export interface ProjectSettingsDialogProps {
  open: boolean
  workspaceRoot: string
  project: KanbanProject
  onOpenChange: (open: boolean) => void
  onProjectChanged: (project: KanbanProject) => void
}

function draftFromProject(project: KanbanProject): ProjectSettingsDraft {
  return {
    name: project.name,
    description: project.description ?? '',
    details: project.details ?? '',
    color: project.color ?? '',
    workingDirectory: project.workingDirectory ?? '',
    defaultExpertId: project.defaultExpertId ?? '',
  }
}

export function ProjectSettingsDialog({
  open,
  workspaceRoot,
  project,
  onOpenChange,
  onProjectChanged,
}: ProjectSettingsDialogProps): React.ReactElement {
  const { options: expertOptions } = useExpertOptions()
  const slug = project.slug

  const [settingsDraft, setSettingsDraft] = React.useState<ProjectSettingsDraft>(() => draftFromProject(project))
  const [busy, setBusy] = React.useState(false)

  // 重置 draft 当 project 变化
  React.useEffect(() => {
    setSettingsDraft(draftFromProject(project))
  }, [project])

  const saveSettings = async (): Promise<void> => {
    if (!slug || !settingsDraft.name.trim()) {
      toast.error('项目名称不能为空')
      return
    }
    setBusy(true)
    try {
      const updated = await window.electronAPI.projects.update(
        workspaceRoot,
        slug,
        buildProjectUpdate(settingsDraft),
      )
      onProjectChanged(updated)
      toast.success('项目设置已保存')
      onOpenChange(false)
    } catch (cause) {
      toast.error('保存失败', {
        description: cause instanceof Error ? cause.message : String(cause),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>项目设置</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <SettingsCard title="基本信息">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <label className="space-y-1.5 text-xs font-medium">
                项目名称
                <Input
                  value={settingsDraft.name}
                  onChange={(e) => setSettingsDraft((d) => ({ ...d, name: e.target.value }))}
                />
              </label>
              <div className="space-y-1.5 text-xs font-medium">
                强调色
                <AccentColorPicker
                  value={settingsDraft.color}
                  onChange={(color) => setSettingsDraft((d) => ({ ...d, color }))}
                />
              </div>
            </div>
            <label className="block space-y-1.5 text-xs font-medium">
              描述
              <Input
                value={settingsDraft.description}
                onChange={(e) => setSettingsDraft((d) => ({ ...d, description: e.target.value }))}
                placeholder="列表/详情中显示的一句话简介"
              />
            </label>
          </SettingsCard>

          <SettingsCard title="工作目录与专家">
            <div className="space-y-1.5 text-xs font-medium">
              <span>工作目录</span>
              <WorkingDirectoryField
                value={settingsDraft.workingDirectory ?? ''}
                onChange={(path) => setSettingsDraft((d) => ({ ...d, workingDirectory: path }))}
              />
              <p className="text-[11px] font-normal text-muted-foreground">
                可选；留空则使用托管 workdir
              </p>
            </div>
            <label className="block space-y-1.5 text-xs font-medium">
              默认专家
              <select
                value={settingsDraft.defaultExpertId}
                onChange={(e) => setSettingsDraft((d) => ({ ...d, defaultExpertId: e.target.value }))}
                className="flex h-9 w-full rounded-md border border-border/60 bg-background/40 px-3 py-1 text-sm"
              >
                <option value="">未设置</option>
                {expertOptions.map((expert) => (
                  <option key={expert.id} value={expert.id}>{expert.label}</option>
                ))}
              </select>
            </label>
          </SettingsCard>

          <SettingsCard title="项目说明" hint="注入系统提示词的自由文本，帮助 Agent 理解项目背景">
            <Textarea
              value={settingsDraft.details}
              onChange={(e) => setSettingsDraft((d) => ({ ...d, details: e.target.value }))}
              rows={4}
            />
          </SettingsCard>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button disabled={busy || !slug} onClick={() => { void saveSettings() }}>
            <Save className="h-4 w-4" />保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
