import { atom } from 'jotai'
import type { WorkspaceMemoryFileChange } from '@myyoda/shared'

/** 渲染进程生命周期内的展示态：当前工作区全局记忆变更 Dock 用。 */
export const workspaceMemoryChangesAtom = atom<Map<string, WorkspaceMemoryFileChange[]>>(new Map())

/** 从全局 Dock 跳转到 WorkspaceMemoryTab 的一次性路由。 */
export const memoryFileNavigationAtom = atom<{
  workspaceSlug: string
  relativePath: string
  mode: 'preview' | 'edit'
} | null>(null)
