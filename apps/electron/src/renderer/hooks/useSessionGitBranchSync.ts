/**
 * useSessionGitBranchSync — 会话头部 Git 分支徽章的漂移自愈
 *
 * 背景：会话头部 `Local · <branch>` 徽章读取的是 session.gitBranch，这是会话绑定 Git
 * 上下文时一次性写入的持久化字段（见 git-session-context-service.ts）。若 Agent 之后
 * 绕过 UI 直接用 Bash 执行 `git checkout` / `git branch -D` 改动仓库分支，这个字段不会
 * 自动更新——旧分支被删除后，徽章会永久卡在已不存在的分支名上，且没有任何交互能刷新它
 * （分支选择器仅在草稿/空会话阶段可见）。
 *
 * 参考 Synara（同类桌面 Agent 产品）的 shouldSyncLocalThreadBranch 设计：Local 模式下
 * 线程/会话记录的分支应当镜像真实 checkout 状态。在会话挂载和窗口重新聚焦时静默核对
 * 一次，检测到漂移就直接回写 session.gitBranch，而不是维护额外的展示态双轨逻辑——
 * 这样持久化状态本身保持新鲜，formatSessionGitBadge 等既有展示逻辑无需改动。
 *
 * 判断"是否需要同步"的核心逻辑收口在主进程 refreshSessionGitBranch（含单元测试），
 * 本 hook 只负责触发时机、IPC 调用与本地状态回写，不重复业务判断。
 */

import * as React from 'react'
import { useSetAtom } from 'jotai'
import type { AgentSessionMeta } from '@myyoda/shared'
import { agentSessionsAtom } from '@/atoms/agent-atoms'

export function useSessionGitBranchSync(session: AgentSessionMeta | null | undefined): void {
  const setAgentSessions = useSetAtom(agentSessionsAtom)

  React.useEffect(() => {
    if (!session?.gitRepoPath) return

    const sessionId = session.id
    const repoPath = session.gitRepoPath
    const boundBranch = session.gitBranch
    const executionMode = session.gitExecutionMode
    let cancelled = false

    const refresh = async (): Promise<void> => {
      try {
        const result = await window.electronAPI.refreshSessionGitBranch({
          sessionId,
          repoPath,
          boundBranch,
          executionMode,
        })
        if (cancelled || !result?.synced || !result.currentBranch) return
        const nextBranch = result.currentBranch
        setAgentSessions((prev) => prev.map((s) => (
          s.id === sessionId ? { ...s, gitBranch: nextBranch } : s
        )))
      } catch {
        // 静默降级：非 git 仓库、路径已被移除等场景不应影响会话主流程
      }
    }

    void refresh()
    window.addEventListener('focus', refresh)
    return () => {
      cancelled = true
      window.removeEventListener('focus', refresh)
    }
  }, [session?.id, session?.gitRepoPath, session?.gitBranch, session?.gitExecutionMode, setAgentSessions])
}
