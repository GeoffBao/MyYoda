/**
 * layout-atoms — 跨模块派生的窗口布局状态。
 *
 * 目前只有一个用途：判断「中间主区域（MainArea/TabBar）是否已经延伸到窗口真实右边缘」。
 * AppShell 的 [LeftSidebar | MainArea flex-1 | RightSidePanel] 是普通 flex 行，RightSidePanel
 * 打开时会把 MainArea 挤窄，其右边缘不再等于窗口右边缘；而 Windows 自定义 WindowControls（最小化/
 * 最大化/关闭）是 `fixed` 定位在物理窗口右上角，不随这个 flex 布局收缩。
 *
 * TabBar 内浏览器/终端按钮、面板展开按钮、拖拽层等原先按“自身右边缘 = 窗口右边缘”硬编码
 * WindowControls 预留宽度（126px），RightSidePanel 打开时这个假设不成立，按钮会被错误地
 * 向左推出一大截。TabBar 读取本文件导出的 [[rightFilePanelVisibleAtom]] 来修正这个假设；
 * AppShell 自身的挂载条件不依赖它（面板关闭时仍需保持挂载以保留宽度过渡动画）。
 */

import { atom } from 'jotai'
import { appModeAtom } from './app-mode'
import { codeMainViewAtom } from './project-atoms'
import { activeViewAtom } from './active-view'
import { automationFormAtom } from './automation-atoms'
import { currentSessionSidePanelOpenAtom, currentAgentSessionIdAtom } from './agent-atoms'

/**
 * 右侧文件面板（相关文件/文件改动）当前是否实际占用宽度、挤窄 MainArea。
 * 与 AppShell 内 `showRightPanel` 的判定条件保持一致（Agent 模式 + 会话主视图 + 会话列表视图 +
 * 有当前会话 + 定时任务表单未打开），并另加上面板自身的展开/折叠状态（currentSessionSidePanelOpenAtom）——
 * SidePanel 关闭时会 `!w-0`，此时 MainArea 仍能伸展到窗口真实右边缘，不应计入避让。
 */
export const rightFilePanelVisibleAtom = atom((get) => {
  const appMode = get(appModeAtom)
  const codeMainView = get(codeMainViewAtom)
  const activeView = get(activeViewAtom)
  const currentSessionId = get(currentAgentSessionIdAtom)
  const automationForm = get(automationFormAtom)
  const isPanelOpen = get(currentSessionSidePanelOpenAtom)
  return appMode === 'agent'
    && codeMainView === 'session'
    && activeView === 'conversations'
    && !!currentSessionId
    && !automationForm.open
    && isPanelOpen
})
