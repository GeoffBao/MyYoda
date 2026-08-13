import * as React from 'react'
import { ArrowRight, Blocks, Save } from 'lucide-react'
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { WorkingDirectoryField } from '@/components/app-shell/kanban/WorkingDirectoryField'
import { useExpertOptions } from '@/components/agent-experts/useExpertOptions'
import { AccentColorPicker } from '@/components/work/AccentColorPicker'
import { buildProjectUpdate, type ProjectSettingsDraft } from '@/components/work/project-view-model'
import type { KanbanProject } from '@/components/app-shell/kanban/types'
import { activeViewAtom, agentSkillsTabAtom, pendingAgentSkillsProjectIdAtom } from '@/atoms/active-view'

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

interface ProjectCapabilitySummary {
  skillsCount: number
  mcpCount: number
  /** 项目是否已自己配置过 Skills/MCP（区别于“没配置过，现在看到的是工作区默认”与“已经自己配置过”两种状态） */
  hasOwnSkills: boolean
  hasOwnMcp: boolean
}

export function ProjectSettingsTab({ workspaceRoot, project, onProjectChanged }: ProjectSettingsTabProps): React.ReactElement {
  const { options } = useExpertOptions()
  const [draft, setDraft] = React.useState(() => toDraft(project))
  const [busy, setBusy] = React.useState(false)
  const [capability, setCapability] = React.useState<ProjectCapabilitySummary | null>(null)
  const setActiveView = useSetAtom(activeViewAtom)
  const setAgentSkillsTab = useSetAtom(agentSkillsTabAtom)
  const setPendingAgentSkillsProjectId = useSetAtom(pendingAgentSkillsProjectIdAtom)

  React.useEffect(() => setDraft(toDraft(project)), [project])

  // KanbanProject.workspaceId 存的就是 workspace slug（主进程 basename(workspaceRoot)），与 AutomationFormView 同样的取数方式，
  // 不需要另外从 workspaceRoot 解析。项目尚未关联到 workspaceId（理论上不应发生）时跳过，不显示该小节。
  React.useEffect(() => {
    const workspaceSlug = project.workspaceId
    if (!workspaceSlug) { setCapability(null); return }
    let cancelled = false
    Promise.all([
      window.electronAPI.getProjectSkills(workspaceSlug, project.id),
      window.electronAPI.getProjectMcpConfig(workspaceSlug, project.id),
      window.electronAPI.hasProjectSkills(workspaceSlug, project.id),
      window.electronAPI.hasProjectMcpServers(workspaceSlug, project.id),
    ]).then(([skills, mcpConfig, hasOwnSkills, hasOwnMcp]) => {
      if (cancelled) return
      setCapability({
        skillsCount: skills.length,
        mcpCount: Object.keys(mcpConfig.servers).length,
        hasOwnSkills,
        hasOwnMcp,
      })
    }).catch((cause) => {
      console.error('[项目设置] 加载 Skills/MCP 摘要失败:', cause)
    })
    return () => { cancelled = true }
  }, [project.workspaceId, project.id])

  /** 跳转到 Yoda 插件并自动预选中当前 Project 的 Skills tab */
  const openSkillsAndMcp = (): void => {
    setPendingAgentSkillsProjectId(project.id)
    setAgentSkillsTab('skills')
    setActiveView('agent-skills')
  }

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

      {project.workspaceId && (
        <section className="space-y-3 rounded-xl border border-border/40 bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Skills / MCP</h2>
              <p className="text-xs text-muted-foreground">该项目自己的 Skills 与 MCP 服务器；未单独配置时自动沿用工作区默认。</p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={openSkillsAndMcp} className="shrink-0 gap-1.5">
              <Blocks className="h-3.5 w-3.5" />
              管理
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
          {capability && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>Skills：{capability.skillsCount} 个{capability.hasOwnSkills ? '' : '（沿用工作区默认）'}</span>
              <span>MCP：{capability.mcpCount} 个{capability.hasOwnMcp ? '' : '（沿用工作区默认）'}</span>
            </div>
          )}
        </section>
      )}

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
