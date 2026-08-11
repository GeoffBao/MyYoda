import * as React from 'react'
import { Save } from 'lucide-react'
import { toast } from 'sonner'
import { estimateTokenCount, MEMORY_TOKEN_CAP } from '@myyoda/shared/projects'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { KanbanProject } from '@/components/app-shell/kanban/types'
import { getProjectKnowledgeDraft, removeProjectKnowledgeDraft, setProjectKnowledgeDraft } from './project-knowledge-draft-store'

interface ProjectKnowledgeTabProps {
  workspaceRoot: string
  project: KanbanProject
  onError: (message: string | null) => void
  onDirtyChange?: (dirty: boolean) => void
}

export function ProjectKnowledgeTab({ workspaceRoot, project, onError, onDirtyChange }: ProjectKnowledgeTabProps): React.ReactElement {
  const slug = project.slug
  const draftKey = `${workspaceRoot}/${slug ?? project.id}`
  const [memory, setMemory] = React.useState('')
  const [loaded, setLoaded] = React.useState(false)
  const [dirty, setDirty] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!slug) return
    let cancelled = false
    setLoaded(false)
    setDirty(false)
    onDirtyChange?.(false)
    window.electronAPI.projects.readMemory(workspaceRoot, slug)
      .then((content) => {
        if (cancelled) return
        const cachedDraft = getProjectKnowledgeDraft(draftKey)
        setMemory(cachedDraft ?? content)
        setLoaded(true)
        const hasDraft = cachedDraft !== undefined && cachedDraft !== content
        setDirty(hasDraft)
        onDirtyChange?.(hasDraft)
      })
      .catch(() => {
        if (cancelled) return
        const cachedDraft = getProjectKnowledgeDraft(draftKey)
        setMemory(cachedDraft ?? '')
        setLoaded(true)
        const hasDraft = cachedDraft !== undefined
        setDirty(hasDraft)
        onDirtyChange?.(hasDraft)
      })
    return () => { cancelled = true }
  }, [draftKey, onDirtyChange, slug, workspaceRoot])

  // 退出保护由跨页面 draft store 统一维护，切换 Tab/路由后仍然有效。

  const handleSave = async (): Promise<void> => {
    if (!slug || busy) return
    setBusy(true)
    try {
      // Allow clearing: write empty string to save
      await window.electronAPI.projects.writeMemory(workspaceRoot, slug, memory)
      removeProjectKnowledgeDraft(draftKey)
      setDirty(false)
      onDirtyChange?.(false)
      onError(null)
      toast.success('Project Knowledge 已保存')
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause)
      onError(msg)
      toast.error('保存失败', { description: msg })
    } finally {
      setBusy(false)
    }
  }

  const tokens = React.useMemo(() => estimateTokenCount(memory), [memory])
  const overCap = tokens > MEMORY_TOKEN_CAP

  return (
    <div className="space-y-4 p-4">
      <div className="rounded-xl border border-border/40 bg-muted/20 p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Project Knowledge</h2>
            <p className="text-xs text-muted-foreground">
              用于记录工程架构、技术决策、常用命令和注意事项。Agent 在该项目执行任务时会自动引用。
            </p>
          </div>
          <Button size="sm" disabled={!dirty || busy} onClick={() => void handleSave()}>
            <Save className="mr-1 h-3.5 w-3.5" />
            保存
          </Button>
        </div>
        <Textarea
          value={memory}
          onChange={(e) => {
            setMemory(e.target.value)
            setProjectKnowledgeDraft(draftKey, e.target.value)
            setDirty(true)
            onDirtyChange?.(true)
          }}
          placeholder="例如：## 架构&#10;- 使用 React + TypeScript&#10;- API 网关地址: ...&#10;&#10;## 常用命令&#10;- bun run dev&#10;- bun test&#10;&#10;## 注意事项&#10;..."
          className="min-h-[300px] w-full resize-y font-mono text-sm"
          disabled={busy || !loaded}
        />
        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>Markdown 格式 · 约 {tokens} tokens（上限 {MEMORY_TOKEN_CAP}）</span>
          {overCap && <span className="font-medium text-destructive">超出推荐上限</span>}
          {dirty && <span className="font-medium text-amber-500">未保存 · 本次应用会话中会保留草稿</span>}
        </div>
      </div>

      <div className="text-xs text-muted-foreground space-y-1 px-1">
        <p><strong>提示</strong>：该内容存储在项目 MEMORY.md 中；本地目录项目可能位于 <code>&lt;项目工作目录&gt;/.context/MEMORY.md</code>，历史或托管项目沿用 MyYoda 托管目录。</p>
        <p><strong>工作区级、跨项目的规则与偏好</strong>请写入工作区记忆，不要写在这里。</p>
      </div>
    </div>
  )
}
