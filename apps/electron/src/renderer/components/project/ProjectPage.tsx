import * as React from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { ArrowLeft, FolderOpen, LayoutDashboard, MessageSquare, Settings } from 'lucide-react'
import {
  codeMainViewAtom,
  projectPageTabAtom,
  type ProjectPageTab,
} from '@/atoms/project-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { buildTaskBoardNavigation } from '@/components/app-shell/code-main-view-model'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { AgentWorkspace } from '@myyoda/shared'
import { LocalProjectBadge } from '@/components/agent-skills/LocalProjectBadge'
import { ProjectAssetsTab } from './ProjectAssetsTab'
import { ProjectOverviewTab } from './ProjectOverviewTab'
import { ProjectSessionsTab } from './ProjectSessionsTab'
import { ProjectSettingsTab } from './ProjectSettingsTab'

interface ProjectPageProps {
  workspaceRoot: string
  workspace: AgentWorkspace
  onWorkspaceChanged?: (workspace: AgentWorkspace) => void
}

/** 工作区详情页（参考 craft ProjectInfoPage：概览/会话/资料/设置；项目=工作区） */
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

export function ProjectPage({ workspaceRoot, workspace, onWorkspaceChanged }: ProjectPageProps): React.ReactElement {
  const [tab, setTab] = useAtom(projectPageTabAtom)
  const setCodeMainView = useSetAtom(codeMainViewAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const [error, setError] = React.useState<string | null>(null)

  const openTaskBoard = (): void => {
    const navigation = buildTaskBoardNavigation(null)
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
          返回看板
        </Button>
        <FolderOpen className="h-3.5 w-3.5 shrink-0 text-foreground/45" />
        <h1 className="truncate text-sm font-semibold">{workspace.name}</h1>
        {workspace.projectRootPath && (
          <LocalProjectBadge workingDirectory={workspace.projectRootPath} className="bg-foreground/[0.05] text-foreground/45" />
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
        {tab === 'overview' && <ProjectOverviewTab workspace={workspace} onOpenTasks={openTaskBoard} />}
        {tab === 'sessions' && (
          <ProjectSessionsTab workspaceRoot={workspaceRoot} workspace={workspace} onError={setError} onOpenTasks={openTaskBoard} />
        )}
        {tab === 'assets' && (
          <ProjectAssetsTab workspaceRoot={workspaceRoot} workspaceSlug={workspace.slug} onError={setError} />
        )}
        {tab === 'settings' && (
          <ProjectSettingsTab workspaceRoot={workspaceRoot} workspace={workspace} onWorkspaceChanged={onWorkspaceChanged} onError={setError} />
        )}
      </div>
    </div>
  )
}
