/**
 * ProjectContextPicker 纯模型 — 分区与跳过规则
 */

import { PROJECT_TERMS } from '@/lib/workspace-project-terminology'

export type ProjectContextPickerMode = 'session' | 'task'

export interface PickerProject {
  id: string
  name: string
  workingDirectory?: string
  updatedAt: number | string
  archivedAt?: number | string
}

export type PickerActionId = 'browse' | 'create' | 'skip'

export interface PickerAction {
  id: PickerActionId
  label: string
}

export interface PickerSections {
  /** 全部激活项目，最近使用的排在前面，其余按项目自身 updatedAt 倒序；不重复出现 */
  projects: PickerProject[]
  actions: PickerAction[]
}

export function allowsSkipProject(mode: ProjectContextPickerMode): boolean {
  return mode === 'session'
}

/**
 * 是否应响应 browseRequest 递增。
 * baseline=null 表示选择器刚挂载：只同步基线，不回放历史请求
 * （否则点「新会话/新任务」会误弹系统选文件夹对话框）。
 */
export function shouldHonorBrowseRequest(input: {
  browseRequest: number
  baseline: number | null
}): { honor: boolean; nextBaseline: number } {
  if (input.baseline === null) {
    return { honor: false, nextBaseline: input.browseRequest }
  }
  if (input.browseRequest === input.baseline) {
    return { honor: false, nextBaseline: input.baseline }
  }
  return {
    honor: input.browseRequest > 0,
    nextBaseline: input.browseRequest,
  }
}

export function buildPickerSections(input: {
  mode: ProjectContextPickerMode
  projects: PickerProject[]
  recentProjectIds: string[]
  /** 当前已绑定的项目 id；仅在有绑定时才提供"清除项目"动作，未绑定时它和直接关闭面板没有区别 */
  selectedProjectId?: string
}): PickerSections {
  const active = input.projects.filter((project) => !project.archivedAt)
  const byId = new Map(active.map((project) => [project.id, project]))

  // 最近使用的项目排前面，其余按项目自身 updatedAt 倒序补齐；同一项目只出现一次。
  const recentIds = new Set<string>()
  const projects: PickerProject[] = []
  for (const id of input.recentProjectIds) {
    const project = byId.get(id)
    if (project && !recentIds.has(id)) {
      recentIds.add(id)
      projects.push(project)
    }
  }
  const rest = active
    .filter((project) => !recentIds.has(project.id))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  projects.push(...rest)

  // 动作标签对齐 Cursor/Codex/Kimi：新建优先、浏览次之、会话可跳过
  const actions: PickerAction[] = [
    { id: 'create', label: `${PROJECT_TERMS.create}…` },
    { id: 'browse', label: '使用现有项目文件夹…' },
  ]
  // Task 首屏不再暴露“无项目”入口：新建任务优先绑定/创建项目；底层仍允许 Task 编辑器保存为工作区级任务作为 fallback。
  // Session 已绑定项目时才需要“清除”；未绑定时它和直接关闭面板效果一样。
  if (allowsSkipProject(input.mode) && input.selectedProjectId) {
    actions.push({ id: 'skip', label: PROJECT_TERMS.clear })
  }

  return { projects, actions }
}
