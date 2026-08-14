import * as React from 'react'
import { FolderOpen, Save, Trash2 } from 'lucide-react'
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { WorkingDirectoryField } from '@/components/app-shell/kanban/WorkingDirectoryField'
import type { AgentWorkspace } from '@myyoda/shared'
import { cn } from '@/lib/utils'
import { agentWorkspacesAtom, currentAgentWorkspaceIdAtom } from '@/atoms/agent-atoms'

interface ProjectSettingsTabProps {
  workspaceRoot: string
  workspace: AgentWorkspace
  onWorkspaceChanged?: (workspace: AgentWorkspace) => void
  onError: (message: string | null) => void
}

/** 工作区设置（项目=工作区：名称/工程目录/看板列；删除有默认工作区保护） */
export function ProjectSettingsTab({ workspaceRoot: _workspaceRoot, workspace, onWorkspaceChanged, onError }: ProjectSettingsTabProps): React.ReactElement {
  const setWorkspaces = useSetAtom(agentWorkspacesAtom)
  const setCurrentWorkspaceId = useSetAtom(currentAgentWorkspaceIdAtom)
  const [name, setName] = React.useState(workspace.name)
  const [workingDirectory, setWorkingDirectory] = React.useState(workspace.projectRootPath ?? '')
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    setName(workspace.name)
    setWorkingDirectory(workspace.projectRootPath ?? '')
  }, [workspace])

  const save = async (): Promise<void> => {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      // 名称重命名（slug 与目录不变）
      if (name.trim() !== workspace.name) {
        await window.electronAPI.updateAgentWorkspace(workspace.id, { name: name.trim() })
      }
      // 工程目录关联/变更（realpath 校验在主进程）
      if (workingDirectory.trim() && workingDirectory.trim() !== workspace.projectRootPath) {
        await window.electronAPI.relinkAgentWorkspaceProjectRoot(workspace.id, workingDirectory.trim())
      } else if (!workingDirectory.trim() && workspace.projectRootPath) {
        toast.error('工程目录不能留空；如需解除绑定请使用「重新关联」选择目录')
      }
      const updated = await window.electronAPI.listAgentWorkspaces()
      const next = updated.find((item) => item.id === workspace.id)
      if (next) {
        onWorkspaceChanged?.(next)
        setWorkspaces(updated)
      }
      toast.success('工作区设置已保存')
      onError(null)
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause)
      onError(msg)
      toast.error('保存失败', { description: msg })
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (): Promise<void> => {
    if (workspace.slug === 'default') {
      toast.error('默认工作区不能删除')
      return
    }
    if (!window.confirm(`删除工作区「${workspace.name}」将同时删除其会话、自动任务与托管数据，且无法恢复；绑定的外部工程目录不会被删除。确定继续吗？`)) return
    setBusy(true)
    try {
      await window.electronAPI.deleteAgentWorkspace(workspace.id)
      const remaining = await window.electronAPI.listAgentWorkspaces()
      setWorkspaces(remaining)
      if (remaining[0]) setCurrentWorkspaceId(remaining[0].id)
      toast.success(`已删除工作区「${workspace.name}」`)
    } catch (cause) {
      toast.error('删除失败', { description: cause instanceof Error ? cause.message : String(cause) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-5">
      <section className="space-y-4 rounded-xl border border-border/40 bg-card p-4 shadow-sm">
        <div>
          <h2 className="text-sm font-semibold">基本信息</h2>
          <p className="text-xs text-muted-foreground">工作区名称与工程目录（会话 cwd 与记忆落在此目录）。</p>
        </div>
        <label className="block space-y-1.5 text-xs font-medium">
          名称
          <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={50} />
        </label>
        <div className="space-y-1.5 text-xs font-medium">
          <span>工程目录</span>
          <WorkingDirectoryField value={workingDirectory} onChange={setWorkingDirectory} />
          <p className="text-[11px] font-normal text-muted-foreground">
            选择本地文件夹会绑定为项目工程目录（Agent cwd 与项目地图 AGENTS.md 所在）；缺失时可在侧栏菜单恢复。
          </p>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-border/40 bg-card p-4 shadow-sm">
        <div>
          <h2 className="text-sm font-semibold">看板</h2>
          <p className="text-xs text-muted-foreground">看板列配置在「看板」页编辑（保存到此工作区）。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FolderOpen className="h-4 w-4 text-muted-foreground/60" />
          {workspace.kanbanColumns?.length
            ? workspace.kanbanColumns.map((column) => (
                <span key={column.id} className="inline-flex items-center gap-1.5 rounded-full bg-foreground/[0.05] px-2 py-0.5 text-xs text-foreground/70">
                  <span className="size-1.5 rounded-full" style={{ backgroundColor: column.color ?? '#888' }} />
                  {column.name}
                </span>
              ))
            : <span className="text-xs text-muted-foreground">默认四列（待办 / 进行中 / 待验收 / 已完成）</span>}
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-destructive/20 bg-card p-4 shadow-sm">
        <div>
          <h2 className="text-sm font-semibold text-destructive">危险区</h2>
          <p className="text-xs text-muted-foreground">删除工作区会同时删除会话、自动任务与托管数据。</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || workspace.slug === 'default'}
          onClick={() => void handleDelete()}
          className={cn('gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10', workspace.slug === 'default' && 'cursor-not-allowed opacity-50')}
        >
          <Trash2 className="h-3.5 w-3.5" />
          {workspace.slug === 'default' ? '默认工作区不可删除' : '删除工作区…'}
        </Button>
      </section>

      <div className="flex justify-end">
        <Button disabled={busy || !name.trim()} onClick={() => { void save() }}>
          <Save className="mr-1 h-4 w-4" />
          {busy ? '保存中…' : '保存设置'}
        </Button>
      </div>
    </div>
  )
}
