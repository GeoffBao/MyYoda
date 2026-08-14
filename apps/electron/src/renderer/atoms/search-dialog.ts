/**
 * Search Dialog Atom - 全局搜索弹窗状态
 *
 * 搜索从主内容区独立视图（activeView='yoda-search'）迁移为居中浮层后，
 * 用本 atom 控制弹窗开合。LeftSidebar、GlobalShortcuts 等入口统一写入 true，
 * YodaSearchDialog 组件消费并处理关闭。
 */

import { atom } from 'jotai'

/** 全局搜索弹窗是否打开 */
export const searchDialogOpenAtom = atom(false)
