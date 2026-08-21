/**
 * Canvas Panel Atoms — 画布快速开关面板状态管理
 *
 * 每个 Agent 会话拥有独立的画布面板状态（是否打开、当前打开的画布文件）。
 * 画布文件本体持久化在 workspaceSlug 维度（见 getExcalidrawDir），这里只记录
 * "该会话当前文档槽里展示的是哪个画布文件"，用于按钮再次点击时恢复上次画布。
 */

import { atom } from 'jotai'

/** 会话当前打开的画布文件引用 */
export interface CanvasFileRef {
  workspaceSlug: string
  slug: string
}

/** 每会话画布面板开关（是否在文档槽内展示画布） */
export const canvasPanelOpenMapAtom = atom<Map<string, boolean>>(new Map())

/** 每会话当前打开的画布文件；null = 该会话点开过画布按钮但还没保存出任何 slug（全新未命名画布） */
export const canvasFileMapAtom = atom<Map<string, CanvasFileRef | null>>(new Map())
