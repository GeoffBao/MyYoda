import * as React from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { ArrowLeft, FolderOpen, LayoutDashboard, MessageSquare, Settings } from 'lucide-react'
import {
  codeMainViewAtom,
  projectPageTabAtom,
  selectedProjectIdAtom,
  type ProjectPageTab,
} from '@/atoms/project-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { buildTaskBoardNavigation } from '@/components/app-shell/code-main-view-model'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { KanbanProject } from '@/components/app-shell/kanban/types'
import { ProjectAssetsTab } from './ProjectAssetsTab'
import { ProjectOverviewTab } from './ProjectOverviewTab'
import { ProjectSessionsTab } from './ProjectSessionsTab'
import { ProjectSettingsTab } from './ProjectSettingsTab'

interface ProjectPageProps {
  workspaceRoot: string
  project: KanbanProject
  onProjectChanged: (project: KanbanProject) => void
}

/** 对齐 Proma：无独立「Project Knowledge」（记忆统一走 Yoda 插件 → 记忆页，Proma 形态） */
const TABS: Array<{ id: ProjectPageTab; label: string; icon: React.ElementType }> = [
  { id: 'overview', label: '概览', icon: LayoutDashboard },
  { id: 'sessions', label: '会话', icon: MessageSquare },
  { id: 'assets', label: '资料', icon: FolderOpen },
  { id: 'settings', label: '设置', icon: Settings },
]

function ErrorBanner({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="mx-3 mb-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {children}
    </div>
  )
}

export function ProjectPage({ workspaceRoot, project, onProjectChanged }: ProjectPageProps): React.ReactElement {
  const [tab, setTab] = useAtom(projectPageTabAtom)
  const setSelectedProjectId = useSetAtom(selectedProjectIdAtom)
  const setCodeMainView = useSetAtom(codeMainViewAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const [error, setError] = React.useState<string | null>(null)

  const color = project.color ?? 'hsl(var(--muted-foreground))'

  const openTaskBoard = (): void => {
    const navigation = buildTaskBoardNavigation(project.id)
    setSelectedProjectId(navigation.selectedProjectId)
    setCodeMainView(navigation.codeMainView)
    setActiveView(navigation.activeView)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* Header */}
      <div className="titlebar-drag-region flex min-h-9 shrink-0 items-center gap-2 border-b border-border/40 px-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={openTaskBoard}
          className="titlebar-no-drag h-7 gap-1 text-xs"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          返回 Project 看板
        </Button>
        <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <h1 className="truncate text-sm font-semibold">{project.name}</h1>
        {project.archivedAt && (
          <span className="ml-1 rounded bg-muted px-1.5 py-px text-[11px] text-muted-foreground">
            已归档
          </span>
        )}
      </div>

      {/* Tabs */}
      <nav className="flex shrink-0 border-b border-border/40 px-3" role="tablist">
        {TABS.map((tabOption) => (
          <button
            key={tabOption.id}
            type="button"
            role="tab"
            aria-selected={tab === tabOption.id}
            onClick={() => setTab(tabOption.id)}
            className={cn(
              'flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors',
              tab === tabOption.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <tabOption.icon className="h-3.5 w-3.5" />
            {tabOption.label}
          </button>
        ))}
      </nav>

      {/* Tab content */}
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'overview' && <ProjectOverviewTab project={project} onOpenTasks={openTaskBoard} />}
        {tab === 'sessions' && (
          <ProjectSessionsTab workspaceRoot={workspaceRoot} project={project} onError={setError} onOpenTasks={openTaskBoard} />
        )}
        {tab === 'assets' && (
          <ProjectAssetsTab workspaceRoot={workspaceRoot} project={project} onError={setError} />
        )}
        {tab === 'settings' && (
          <ProjectSettingsTab workspaceRoot={workspaceRoot} project={project} onProjectChanged={onProjectChanged} />
        )}
      </div>
    </div>
  )
}
