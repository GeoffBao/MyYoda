/**
 * Project Onboarding Atoms
 *
 * 记录「该 sessionId 挂载时应自动弹一次新建项目表单」的会话集合，
 * 用于整个工作区首次建 Agent 会话时的一次性引导（参考 Synara）。
 * 纯运行时状态，不持久化——是否已经弹过用 localStorage 判断（见 hooks/project-onboarding-model.ts）。
 */

import { atom } from 'jotai'

export const projectOnboardingSessionIdsAtom = atom(new Set<string>())
