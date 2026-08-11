/**
 * useCreateSession — 共享的创建 Chat 对话 / Agent 会话逻辑
 *
 * 从 LeftSidebar 提取，供 WelcomeView 模式切换和侧边栏共同使用。
 */

import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { toast } from 'sonner'
import type { AgentSessionMeta } from '@myyoda/shared'
import {
  conversationsAtom,
  selectedModelAtom,
} from '@/atoms/chat-atoms'
import {
  agentSessionsAtom,
  agentSessionDraftsAtom,
  agentChannelIdAtom,
  agentModelIdAtom,
  agentSessionChannelMapAtom,
  agentSessionModelMapAtom,
  currentAgentWorkspaceIdAtom,
} from '@/atoms/agent-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { promptConfigAtom, selectedPromptIdAtom } from '@/atoms/system-prompt-atoms'
import { draftSessionIdsAtom } from '@/atoms/draft-session-atoms'
import { serverKanbanProjectsAtom } from '@/atoms/project-atoms'
import { projectOnboardingSessionIdsAtom } from '@/atoms/project-onboarding-atoms'
import {
  findRecallableDraftSession,
  resolveCreateAgentWorkspaceId,
  resolveDefaultProjectId,
  shouldMarkDraft,
  type CreateAgentSessionFlowInput,
} from './create-agent-session-flow'
import { getProjectOnboardingStorageKey, shouldPromptProjectOnboarding } from './project-onboarding-model'
import { useOpenSession } from './useOpenSession'

export type CreateSessionOptions = CreateAgentSessionFlowInput

interface CreateSessionActions {
  /** 创建新 Chat 对话并打开标签页 */
  createChat: (options?: CreateSessionOptions) => Promise<string | undefined>
  /** 创建新 Agent 会话并打开标签页（默认 Draft；可绑定 projectId） */
  createAgent: (options?: CreateSessionOptions) => Promise<string | undefined>
}

export function useCreateSession(): CreateSessionActions {
  const store = useStore()
  const openSession = useOpenSession()
  const setActiveView = useSetAtom(activeViewAtom)
  const setDraftSessionIds = useSetAtom(draftSessionIdsAtom)

  // Chat
  const setConversations = useSetAtom(conversationsAtom)
  const selectedModel = useAtomValue(selectedModelAtom)
  const promptConfig = useAtomValue(promptConfigAtom)
  const setSelectedPromptId = useSetAtom(selectedPromptIdAtom)

  // Agent
  const setAgentSessions = useSetAtom(agentSessionsAtom)
  const agentChannelId = useAtomValue(agentChannelIdAtom)
  const agentModelId = useAtomValue(agentModelIdAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const setCurrentWorkspaceId = useSetAtom(currentAgentWorkspaceIdAtom)
  const setSessionChannelMap = useSetAtom(agentSessionChannelMapAtom)
  const setSessionModelMap = useSetAtom(agentSessionModelMapAtom)
  const setProjectOnboardingSessionIds = useSetAtom(projectOnboardingSessionIdsAtom)

  const createChat = async (options?: CreateSessionOptions): Promise<string | undefined> => {
    try {
      const meta = await window.electronAPI.createConversation(
        undefined,
        selectedModel?.modelId,
        selectedModel?.channelId,
      )
      setConversations((prev) => [meta, ...prev])
      openSession('chat', meta.id, meta.title)
      setActiveView('conversations')
      if (promptConfig.defaultPromptId) {
        setSelectedPromptId(promptConfig.defaultPromptId)
      }
      // Chat 仍需显式 draft: true，避免误伤历史入口
      if (options?.draft) {
        setDraftSessionIds((prev: Set<string>) => { const next = new Set(prev); next.add(meta.id); return next })
      }
      return meta.id
    } catch (error) {
      console.error('[创建会话] 创建 Chat 对话失败:', error)
      return undefined
    }
  }

  const createAgent = async (options?: CreateSessionOptions): Promise<string | undefined> => {
    const input = options ?? {}
    const channelId = input.channelId ?? agentChannelId ?? undefined
    const modelId = input.modelId ?? agentModelId ?? undefined
    const workspaceId = resolveCreateAgentWorkspaceId(input, currentWorkspaceId)

    // 仅显式开启 recallDraft 的空白新会话入口（无 projectId、未强制新建）才回到草稿：
    // 若当前工作区已有输入过内容但未发送的草稿会话，直接回到它，而不是新建一个空会话
    // 把刚才的内容"顶没"。程序化创建会话（如搜索建会话、Skills 分类）不传 recallDraft，
    // 行为不变，避免误把生成的 prompt 发进不相关的旧草稿。
    if (input.recallDraft && shouldMarkDraft(input) && !input.projectId && !input.forceNew) {
      const recallable = findRecallableDraftSession({
        candidates: store.get(agentSessionsAtom),
        draftSessionIds: store.get(draftSessionIdsAtom),
        draftTexts: store.get(agentSessionDraftsAtom),
        workspaceId,
      })
      if (recallable) {
        openSession('agent', recallable.id, recallable.title)
        setActiveView('conversations')
        toast.info('已回到上次未发送的草稿', {
          action: {
            label: '新建',
            onClick: () => { void createAgent({ ...input, forceNew: true }) },
          },
        })
        return recallable.id
      }
    }

    // 空白「新会话」入口（recallDraft）且未显式指定项目时，默认绑定同工作区最近工作的项目
    // （参考 Synara）；程序化建会话（如搜索建会话/Skills 分类）保持历史行为不受影响。
    const defaultProjectId = resolveDefaultProjectId({
      explicitProjectId: input.projectId,
      recallDraft: input.recallDraft,
      sessions: store.get(agentSessionsAtom),
      workspaceId,
    })

    // 整个工作区第一次建 Agent 会话（没有任何项目可默认绑定）时，弹一次「新建项目」引导；
    // 立刻写 localStorage 标记，哪怕用户之后取消对话框也不会再弹第二次。
    let shouldPromptOnboarding = false
    if (!defaultProjectId && input.recallDraft && workspaceId) {
      const hasAnyProjectInWorkspace = store.get(serverKanbanProjectsAtom)
        .some((project) => project.workspaceId === workspaceId && !project.archivedAt)
      const alreadySeen = localStorage.getItem(getProjectOnboardingStorageKey(workspaceId)) !== null
      shouldPromptOnboarding = shouldPromptProjectOnboarding({ workspaceId, hasAnyProjectInWorkspace, alreadySeen })
      if (shouldPromptOnboarding) {
        localStorage.setItem(getProjectOnboardingStorageKey(workspaceId), '1')
      }
    }

    try {
      if (workspaceId && workspaceId !== currentWorkspaceId) {
        setCurrentWorkspaceId(workspaceId)
        window.electronAPI.updateSettings({ agentWorkspaceId: workspaceId }).catch(console.error)
      }

      let session: AgentSessionMeta = await window.electronAPI.createAgentSession(
        undefined,
        channelId,
        workspaceId,
        modelId,
      )

      if (defaultProjectId) {
        try {
          session = await window.electronAPI.sendSessionCommand(session.id, {
            kind: 'set_project_id',
            projectId: defaultProjectId,
          })
        } catch (error) {
          console.error('[创建会话] 新会话绑定项目失败:', error)
          toast.error('已创建会话，但绑定项目失败')
        }
      }

      setAgentSessions((prev) => [session, ...prev.filter((s) => s.id !== session.id)])

      if (shouldPromptOnboarding) {
        setProjectOnboardingSessionIds((prev) => {
          const next = new Set(prev)
          next.add(session.id)
          return next
        })
      }

      if (channelId) {
        setSessionChannelMap((prev) => {
          const map = new Map(prev)
          map.set(session.id, channelId)
          return map
        })
      }
      if (modelId) {
        setSessionModelMap((prev) => {
          const map = new Map(prev)
          map.set(session.id, modelId)
          return map
        })
      }

      openSession('agent', session.id, session.title)
      setActiveView('conversations')

      if (shouldMarkDraft(input)) {
        setDraftSessionIds((prev: Set<string>) => {
          const next = new Set(prev)
          next.add(session.id)
          return next
        })
      }

      return session.id
    } catch (error) {
      console.error('[创建会话] 创建 Agent 会话失败:', error)
      toast.error('新建会话失败')
      return undefined
    }
  }

  return { createChat, createAgent }
}
