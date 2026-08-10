import { homedir } from 'node:os'

/**
 * 视觉助手（VisionRelay）授权根：在附加目录基础上，把当前会话的实际工作目录
 * （项目 workingDirectory）也纳入——它是用户明确授权 Agent 读写的工作目录，
 * 用户解读的图片往往就放在这里，或由 Agent 在工作目录内生成。
 *
 * 同时把会话专属 sandbox 目录纳入：用户拖拽/粘贴/上传到聊天的文件会被复制进
 * session sandbox（~/.myyoda/agent-workspaces/{slug}/{sessionId}/），它是本会话的
 * 私有工作目录，自然应属于该会话 VisionRelay 的授权范围。不这样做时，project 模式
 * 下（agentCwd=项目目录）上传的图片会被 VISION_FILE_NOT_AUTHORIZED 拒绝。
 *
 * agentCwd / sessionSandboxDir 兜底为 homedir()（无 workspace 时），此时不无脑放宽
 * 整个主目录，直接返回原列表。
 */
export function appendVisionRelayAllowedRoot(
  baseRoots: string[],
  agentCwd: string | undefined,
  homeDir = homedir(),
  sessionSandboxDir?: string,
): string[] {
  const roots = [...baseRoots]
  if (agentCwd && agentCwd !== homeDir && !roots.includes(agentCwd)) {
    roots.push(agentCwd)
  }
  if (sessionSandboxDir && sessionSandboxDir !== homeDir && !roots.includes(sessionSandboxDir)) {
    roots.push(sessionSandboxDir)
  }
  return roots
}
