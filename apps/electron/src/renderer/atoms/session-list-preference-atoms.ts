/**
 * Code 侧边栏会话列表筛选/分组/排序偏好 Atoms
 *
 * 持久化到 ~/.myyoda/settings.json 的 `sessionListPreference` 字段
 * （遵循"配置文件优于 localStorage"约束，与 sidebar-module-atoms.ts 同一套模式）。
 * 只影响 Project 模式的会话列表——Chat 模式的归档切换继续用独立的 sidebarViewModeAtom。
 *
 * 回归 Proma（2026-08-14）：左侧栏 Agent 模式以「项目」分组为主导（Proma 左侧都是项目），
 * 默认 groupBy='project'；分组方式不再暴露筛选 UI。
 */

import { atom } from 'jotai'
import type { SessionListPreference } from '@myyoda/shared'

const DEFAULT_PREFERENCE: SessionListPreference = { status: 'active', groupBy: 'project', sortBy: 'recency' }

/** 原始值 atom：仅供启动时从 settings.json 水合，不触发持久化写回 */
export const sessionListPreferenceValueAtom = atom<SessionListPreference>(DEFAULT_PREFERENCE)

/** 会话列表偏好（读写）；写入时同步持久化到 settings.json */
export const sessionListPreferenceAtom = atom(
  (get) => get(sessionListPreferenceValueAtom),
  (get, set, next: Partial<SessionListPreference>) => {
    const merged = { ...get(sessionListPreferenceValueAtom), ...next }
    set(sessionListPreferenceValueAtom, merged)
    window.electronAPI
      .updateSettings({ sessionListPreference: merged })
      .catch((error) => console.error('[会话列表偏好] 持久化失败:', error))
  },
)

/**
 * 从主进程加载持久化的会话列表偏好。
 *
 * 回归 Proma（2026-08-14）：会话筛选菜单已从左侧栏移除，Agent 模式列表固定为
 * 项目分组（Proma 左侧都是项目）+ 最近更新 + 活跃。旧版本曾允许用户持久化
 * 其他 groupBy/status/sortBy，这里一次性归一为默认值，避免已选过
 * 「日期/状态/自定义分组」的用户在筛选入口消失后仍看到旧分组。
 */
export async function initializeSessionListPreference(
  setPreference: (preference: SessionListPreference) => void,
): Promise<void> {
  try {
    const settings = await window.electronAPI.getSettings()
    setPreference(DEFAULT_PREFERENCE)
    if (settings.sessionListPreference
      && settings.sessionListPreference.groupBy === DEFAULT_PREFERENCE.groupBy
      && settings.sessionListPreference.status === DEFAULT_PREFERENCE.status
      && settings.sessionListPreference.sortBy === DEFAULT_PREFERENCE.sortBy) {
      // 已是默认值：保留（等价于无操作）
      return
    }
    // 旧偏好已归一：把默认值持久化回去，下次加载直接命中默认
    window.electronAPI
      .updateSettings({ sessionListPreference: DEFAULT_PREFERENCE })
      .catch((error) => console.error('[会话列表偏好] 归一化持久化失败:', error))
  } catch (error) {
    console.error('[会话列表偏好] 加载失败:', error)
  }
}
