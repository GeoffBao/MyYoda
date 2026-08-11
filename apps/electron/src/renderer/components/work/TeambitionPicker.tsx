import * as React from 'react'
import { useAtomValue } from 'jotai'
import { CloudDownload, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import type { AgentSessionMeta } from '@myyoda/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { serverKanbanProjectsAtom } from '@/atoms/project-atoms'
import { buildClaimIdempotencyKey, planTeambitionClaim, resolveTeambitionSyncBadge } from './teambition-view'

interface ClaimableTask {
  id: string
  title: string
  projectId: string
  status?: string
  syncState?: 'synced' | 'stale'
}

interface ClaimedBinding {
  id: string
  sessionId: string
  remoteTaskId: string
  remoteTitle: string
  syncState: 'synced' | 'pending' | 'conflict' | 'stale' | 'needs-reauth'
}

export interface TeambitionPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceRoot: string
  workspaceId: string
  localProjectId?: string
  onClaimed: (session: AgentSessionMeta, binding: ClaimedBinding) => void
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export function TeambitionPicker({
  open,
  onOpenChange,
  workspaceRoot,
  workspaceId,
  localProjectId,
  onClaimed,
}: TeambitionPickerProps): React.ReactElement {
  const projects = useAtomValue(serverKanbanProjectsAtom)
  const [pickedProjectId, setPickedProjectId] = React.useState(localProjectId ?? '')
  const [remoteProjectId, setRemoteProjectId] = React.useState('')
  const [tasks, setTasks] = React.useState<ClaimableTask[]>([])
  const [canClaim, setCanClaim] = React.useState(false)
  const [needsReauth, setNeedsReauth] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [claimingId, setClaimingId] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    setPickedProjectId(localProjectId ?? '')
    setRemoteProjectId('')
    setTasks([])
    void window.electronAPI.teambition.capabilities(workspaceRoot).then((capabilities) => {
      setCanClaim(capabilities.claimTask)
      setNeedsReauth(capabilities.needsReauth)
    }).catch((cause: unknown) => {
      setNeedsReauth(true)
      toast.error('检查 Teambition 能力失败', { description: message(cause) })
    })
  }, [localProjectId, open, workspaceRoot])

  const resolvedLocalProjectId = React.useMemo(() => {
    const plan = planTeambitionClaim({
      localProjectId,
      userPicked: pickedProjectId.trim() || undefined,
    })
    return plan.kind === 'proceed' ? plan.localProjectId : null
  }, [localProjectId, pickedProjectId])

  const loadTasks = async (): Promise<void> => {
    if (!resolvedLocalProjectId) {
      toast.error('请先选择本地项目')
      return
    }
    if (!remoteProjectId.trim()) {
      toast.error('请输入 Teambition 项目 ID')
      return
    }
    setLoading(true)
    try {
      const result = await window.electronAPI.teambition.listTasks(workspaceRoot, remoteProjectId.trim())
      setTasks(result.tasks)
      setNeedsReauth(result.needsReauth)
    } catch (cause) {
      toast.error('加载 Teambition 任务失败', { description: message(cause) })
    } finally {
      setLoading(false)
    }
  }

  const claimTask = async (task: ClaimableTask): Promise<void> => {
    const plan = planTeambitionClaim({
      localProjectId,
      userPicked: pickedProjectId.trim() ? pickedProjectId.trim() : null,
    })
    if (plan.kind === 'abort' || plan.kind === 'need_pick') {
      toast.error('请先选择本地项目')
      return
    }

    setClaimingId(task.id)
    let createdSession: AgentSessionMeta | null = null
    try {
      const created = await window.electronAPI.createAgentSession(task.title, undefined, workspaceId)
      createdSession = created
      const session = await window.electronAPI.sendSessionCommand(created.id, {
        kind: 'set_project_id',
        projectId: plan.localProjectId,
      })
      const binding = await window.electronAPI.teambition.claimTask(workspaceRoot, {
        projectId: task.projectId,
        remoteTaskId: task.id,
        sessionId: session.id,
        idempotencyKey: buildClaimIdempotencyKey(workspaceId, session.id, task.id),
      })
      onClaimed(session, binding)
      setTasks((current) => current.filter((candidate) => candidate.id !== task.id))
      onOpenChange(false)
      toast.success('Teambition 任务已认领到本地看板')
    } catch (cause) {
      if (createdSession) await window.electronAPI.deleteAgentSession(createdSession.id).catch(() => undefined)
      toast.error('认领 Teambition 任务失败', { description: message(cause) })
    } finally {
      setClaimingId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>从 Teambition 认领任务</DialogTitle>
          <DialogDescription>必须先选择本地 Project；远端信息只作为绑定视图。</DialogDescription>
        </DialogHeader>
        <label className="block space-y-1.5 text-xs font-medium">
          本地项目
          <select
            value={pickedProjectId}
            disabled={Boolean(localProjectId)}
            onChange={(event) => setPickedProjectId(event.target.value)}
            className="h-9 w-full rounded-md border border-border/60 bg-background px-2 text-sm disabled:opacity-70"
          >
            <option value="" disabled>请选择项目</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
        </label>
        <div className="flex gap-2">
          <Input
            value={remoteProjectId}
            onChange={(event) => setRemoteProjectId(event.target.value)}
            placeholder="Teambition 项目 ID"
          />
          <Button variant="outline" disabled={loading || !resolvedLocalProjectId} onClick={() => { void loadTasks() }}>
            <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            加载
          </Button>
        </div>
        {needsReauth && (
          <div className="rounded-xl bg-orange-500/10 px-3 py-2 text-sm text-orange-700 dark:text-orange-300">
            Teambition 凭据无效或缺失，请在工作区 MCP 设置中重新授权。本地看板不受影响。
          </div>
        )}
        {!needsReauth && !canClaim && (
          <div className="rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
            当前 Teambition gateway 没有 claimTask 能力。
          </div>
        )}
        <div className="max-h-[420px] space-y-2 overflow-y-auto">
          {tasks.map((task) => {
            const badge = resolveTeambitionSyncBadge(task.syncState ?? 'synced')
            return (
              <div key={task.id} className="flex items-center gap-3 rounded-xl bg-muted/40 p-3">
                <CloudDownload className="h-4 w-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{task.title}</div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span>{task.id}</span>
                    <span className={`rounded-full px-2 py-0.5 ${badge.className}`}>{badge.label}</span>
                  </div>
                </div>
                <Button
                  size="sm"
                  disabled={!canClaim || needsReauth || claimingId !== null || !resolvedLocalProjectId}
                  onClick={() => { void claimTask(task) }}
                >
                  {claimingId === task.id ? '认领中…' : '认领'}
                </Button>
              </div>
            )
          })}
          {tasks.length === 0 && !loading && (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {resolvedLocalProjectId ? '输入 Teambition 项目 ID 后加载可认领任务' : '请先选择本地项目'}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
