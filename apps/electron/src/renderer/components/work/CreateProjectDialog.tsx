import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { WorkingDirectoryField } from '@/components/app-shell/kanban/WorkingDirectoryField'
import { buildCreateProjectInput, type CreateProjectDraft } from './project-view-model'

export interface CreateProjectDialogProps {
  open: boolean
  busy?: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (input: ReturnType<typeof buildCreateProjectInput>) => void
}

const EMPTY: CreateProjectDraft = {
  name: '',
  description: '',
  workingDirectory: '',
  color: '',
}

/** 从目录路径推导项目名：取 basename，去掉尾部斜杠后取最后一段 */
export function deriveProjectNameFromPath(path: string): string {
  const trimmed = path.trim().replace(/[\\/]+$/, '')
  const segment = trimmed.split(/[\\/]/).filter(Boolean).pop() ?? ''
  return segment
}

export function CreateProjectDialog({
  open,
  busy = false,
  onOpenChange,
  onSubmit,
}: CreateProjectDialogProps): React.ReactElement {
  const [draft, setDraft] = React.useState<CreateProjectDraft>(EMPTY)
  /** 用户手动改过名称后，不再随目录自动覆盖 */
  const nameTouchedRef = React.useRef(false)

  React.useEffect(() => {
    if (open) {
      setDraft(EMPTY)
      nameTouchedRef.current = false
    }
  }, [open])

  const handleWorkingDirectoryChange = (path: string): void => {
    setDraft((current) => {
      const next: CreateProjectDraft = { ...current, workingDirectory: path }
      // 选文件夹即建：目录路径变化时，项目名自动取目录名（除非用户已手动改名）
      if (!nameTouchedRef.current) {
        const derived = deriveProjectNameFromPath(path)
        if (derived) next.name = derived
      }
      return next
    })
  }

  const handleNameChange = (name: string): void => {
    nameTouchedRef.current = name.trim().length > 0
    setDraft((current) => ({ ...current, name }))
  }

  // 两种交互都支持（对齐 WorkBuddy）：
  // 1. 纯命名新建：只填名称，不选本地文件夹（项目可作为工作区内的会话/任务分组）
  // 2. 打开本地文件夹：选择文件夹后名称自动取目录名，可改
  const canSubmit = draft.name.trim().length > 0 && !busy

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy || next) onOpenChange(next) }}>
      <DialogContent className="sm:max-w-md" aria-busy={busy}>
        <form onSubmit={(event) => { event.preventDefault(); if (canSubmit) onSubmit(buildCreateProjectInput(draft)) }}>
          <DialogHeader>
            <DialogTitle>新建项目</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <label className="block space-y-1.5 text-xs font-medium">
              项目名称
              <Input
                autoFocus
                value={draft.name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="必填；选文件夹时自动取目录名"
              />
            </label>
            <div className="space-y-1.5 text-xs font-medium">
              <span>项目工作目录（可选）</span>
              <WorkingDirectoryField
                value={draft.workingDirectory}
                onChange={handleWorkingDirectoryChange}
              />
              <p className="text-[11px] font-normal text-muted-foreground">
                选择本地文件夹会绑定为项目工作目录，名称自动取文件夹名；也可以留空仅创建项目分组
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              取消
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {busy ? '创建中…' : '创建'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
