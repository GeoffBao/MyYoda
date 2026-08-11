import * as React from 'react'
import { Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { WorkingDirectoryField } from '@/components/app-shell/kanban/WorkingDirectoryField'
import { useExpertOptions } from '@/components/agent-experts/useExpertOptions'
import { AccentColorPicker } from '@/components/work/AccentColorPicker'
import { buildProjectUpdate, type ProjectSettingsDraft } from '@/components/work/project-view-model'
import type { KanbanProject } from '@/components/app-shell/kanban/types'

interface ProjectSettingsTabProps {
  workspaceRoot: string
  project: KanbanProject
  onProjectChanged: (project: KanbanProject) => void
}

function toDraft(project: KanbanProject): ProjectSettingsDraft {
  return {
    name: project.name,
    description: project.description ?? '',
    details: project.details ?? '',
    color: project.color ?? '',
    workingDirectory: project.workingDirectory ?? '',
    defaultExpertId: project.defaultExpertId ?? '',
  }
}

export function ProjectSettingsTab({ workspaceRoot, project, onProjectChanged }: ProjectSettingsTabProps): React.ReactElement {
  const { options } = useExpertOptions()
  const [draft, setDraft] = React.useState(() => toDraft(project))
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => setDraft(toDraft(project)), [project])

  const save = async (): Promise<void> => {
    if (!project.slug || !draft.name.trim() || busy) return
    setBusy(true)
    try {
      const updated = await window.electronAPI.projects.update(workspaceRoot, project.slug, buildProjectUpdate(draft))
      onProjectChanged(updated)
      toast.success('项目设置已保存')
    } catch (cause) {
      toast.error('保存失败', { description: cause instanceof Error ? cause.message : String(cause) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-5">
      <section className="space-y-4 rounded-xl border border-border/40 bg-card p-4 shadow-sm">
        <div>
          <h2 className="text-sm font-semibold">基本信息</h2>
          <p className="text-xs text-muted-foreground">项目名称、描述和视觉标识。</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <label className="space-y-1.5 text-xs font-medium">项目名称<Input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
          <div className="space-y-1.5 text-xs font-medium">强调色<AccentColorPicker value={draft.color} onChange={(color) => setDraft((current) => ({ ...current, color }))} /></div>
        </div>
        <label className="block space-y-1.5 text-xs font-medium">描述<Input value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} /></label>
      </section>

      <section className="space-y-4 rounded-xl border border-border/40 bg-card p-4 shadow-sm">
        <div><h2 className="text-sm font-semibold">执行上下文</h2><p className="text-xs text-muted-foreground">Task 未显式覆盖时继承这里的工作目录和专家。</p></div>
        <div className="space-y-1.5 text-xs font-medium">工作目录<WorkingDirectoryField value={draft.workingDirectory ?? ''} onChange={(path) => setDraft((current) => ({ ...current, workingDirectory: path }))} /></div>
        <label className="block space-y-1.5 text-xs font-medium">默认专家
          <select value={draft.defaultExpertId} onChange={(event) => setDraft((current) => ({ ...current, defaultExpertId: event.target.value }))} className="flex h-9 w-full rounded-md border border-border/60 bg-background px-3 text-sm">
            <option value="">未设置</option>
            {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <label className="block space-y-1.5 text-xs font-medium">项目说明
          <Textarea rows={5} value={draft.details} onChange={(event) => setDraft((current) => ({ ...current, details: event.target.value }))} placeholder="注入 Agent 上下文的项目背景；长期工程知识请写入“知识”。" />
        </label>
      </section>

      <div className="flex justify-end"><Button disabled={busy || !draft.name.trim()} onClick={() => { void save() }}><Save className="mr-1 h-4 w-4" />{busy ? '保存中…' : '保存设置'}</Button></div>
    </div>
  )
}
