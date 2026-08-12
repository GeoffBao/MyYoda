import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import * as os from 'node:os'
import { join } from 'node:path'
import type { SDKMessage } from '@myyoda/shared'
import { mockElectronModule } from './__tests__/electron-mock'

type AgentSessionManager = typeof import('./agent-session-manager')
type AgentSessionContextPrompt = typeof import('./agent-session-context-prompt')

let manager: AgentSessionManager
let contextPrompt: AgentSessionContextPrompt
let tempHome: string
const originalHome = process.env.HOME
const originalMyyodaDev = process.env.MYYODA_DEV
const originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR

mockElectronModule({
  app: {
    isPackaged: true,
    getPath: () => join(process.env.HOME ?? tempHome, 'Library', 'Application Support'),
  },
})

mock.module('node:os', () => ({
  ...os,
  homedir: () => tempHome,
}))

function jsonl(rows: string[]): string {
  return rows.join('\n') + '\n'
}

function writeAgentSessionJsonl(sessionId: string, rows: string[]): void {
  const dir = join(tempHome, '.myyoda', 'agent-sessions')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${sessionId}.jsonl`), jsonl(rows), 'utf-8')
}

function writeSdkSessionJsonl(sdkSessionId: string, rows: string[]): void {
  const dir = join(tempHome, '.myyoda', 'sdk-config', 'projects', 'test-project')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${sdkSessionId}.jsonl`), jsonl(rows), 'utf-8')
}

function writeAgentSessionsIndex(sessions: Array<{
  id: string
  title: string
  workspaceId: string
  createdAt: number
  updatedAt: number
}>): void {
  const dir = join(tempHome, '.myyoda')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'agent-sessions.json'), JSON.stringify({ version: 1, sessions }), 'utf-8')
}

function writeAgentWorkspacesIndex(workspaces: Array<{
  id: string
  name: string
  slug: string
  createdAt: number
  updatedAt: number
}>): void {
  const dir = join(tempHome, '.myyoda')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'agent-workspaces.json'), JSON.stringify({ version: 2, workspaces }), 'utf-8')
}

function createIndexedSessions(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `session-${index}`,
    title: `会话 ${index}`,
    workspaceId: 'workspace-a',
    createdAt: index,
    updatedAt: index,
  }))
}

beforeAll(async () => {
  tempHome = mkdtempSync(join(os.tmpdir(), 'myyoda-agent-session-manager-'))
  process.env.HOME = tempHome
  delete process.env.MYYODA_DEV
  delete process.env.MYYODA_DEV
  delete process.env.CLAUDE_CONFIG_DIR
  manager = await import('./agent-session-manager')
  contextPrompt = await import('./agent-session-context-prompt')
})

afterAll(() => {
  if (originalHome === undefined) {
    delete process.env.HOME
  } else {
    process.env.HOME = originalHome
  }
  if (originalMyyodaDev === undefined) {
    delete process.env.MYYODA_DEV
  } else {
    process.env.MYYODA_DEV = originalMyyodaDev
  }
  if (originalClaudeConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir
  }
  rmSync(tempHome, { recursive: true, force: true })
})

describe('Agent 会话 JSONL 读取', () => {
  test('Given Worktree 干净但 recovery 隔离不可用 When 删除会话 Then Worktree 与 Session 索引都保留', () => {
    const sessionId = 'session-worktree-recovery'
    const repo = join(tempHome, 'repo-for-delete')
    const worktree = join(tempHome, 'worktree-for-delete')
    mkdirSync(repo, { recursive: true })
    execFileSync('git', ['init', '-q', repo])
    execFileSync('git', ['-C', repo, 'config', 'user.email', 'test@example.com'])
    execFileSync('git', ['-C', repo, 'config', 'user.name', 'Test'])
    writeFileSync(join(repo, 'README.md'), 'safe\n', 'utf-8')
    execFileSync('git', ['-C', repo, 'add', 'README.md'])
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init'])
    execFileSync('git', ['-C', repo, 'worktree', 'add', '-q', '-b', 'delete-test', worktree])

    writeAgentSessionJsonl(sessionId, ['{"type":"user"}'])
    writeFileSync(join(tempHome, '.myyoda', 'agent-sessions.json'), JSON.stringify({
      version: 1,
      sessions: [{
        id: sessionId,
        title: 'Worktree 会话',
        createdAt: 1,
        updatedAt: 2,
        gitRepoPath: repo,
        gitWorktreePath: worktree,
      }],
    }), 'utf-8')
    const recoveryRoot = join(tempHome, '.myyoda', 'agent-sessions', '.recovery-trash')
    const outside = join(tempHome, 'outside-session-recovery')
    mkdirSync(outside, { recursive: true })
    symlinkSync(outside, recoveryRoot, 'dir')

    try {
      expect(() => manager.deleteAgentSession(sessionId)).toThrow('安全的本地目录')
      expect(existsSync(worktree)).toBe(true)
      expect(manager.getAgentSessionMeta(sessionId)?.gitWorktreePath).toBe(worktree)
    } finally {
      rmSync(recoveryRoot, { recursive: true, force: true })
    }
  })

  test('Given 会话 JSONL 与 session 工作目录存在 When 删除会话 Then 源数据移入恢复隔离区而不是被物理删除', () => {
    const sessionId = 'session-recoverable'
    writeAgentSessionsIndex([{
      id: sessionId,
      title: '可恢复会话',
      workspaceId: 'workspace-a',
      createdAt: 1,
      updatedAt: 2,
    }])
    writeAgentWorkspacesIndex([{
      id: 'workspace-a',
      name: '工作区 A',
      slug: 'workspace-a',
      createdAt: 1,
      updatedAt: 2,
    }])
    writeAgentSessionJsonl(sessionId, ['{"type":"user"}'])
    const sessionDir = join(tempHome, '.myyoda', 'agent-workspaces', 'workspace-a', sessionId)
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(join(sessionDir, 'draft.md'), '保留内容\n', 'utf-8')

    manager.deleteAgentSession(sessionId)

    const messagePath = join(tempHome, '.myyoda', 'agent-sessions', `${sessionId}.jsonl`)
    expect(() => manager.appendSDKMessages(sessionId, [{ type: 'user' } as SDKMessage])).toThrow('不存在')
    const recoveryRoot = join(tempHome, '.myyoda', 'agent-sessions', '.recovery-trash')
    const workspaceRecoveryRoot = join(tempHome, '.myyoda', 'agent-workspaces', 'workspace-a', '.recovery-trash')
    expect(existsSync(messagePath)).toBe(false)
    expect(existsSync(sessionDir)).toBe(false)

    const messageJournal = readFileSync(join(recoveryRoot, 'journal.jsonl'), 'utf-8')
    const messageRecord = JSON.parse(messageJournal.trim()) as { quarantinePath: string }
    expect(existsSync(messageRecord.quarantinePath)).toBe(true)
    expect(readFileSync(messageRecord.quarantinePath, 'utf-8')).toContain('user')

    const workspaceJournal = readFileSync(join(workspaceRecoveryRoot, 'journal.jsonl'), 'utf-8')
    const workspaceRecord = JSON.parse(workspaceJournal.trim()) as { quarantinePath: string }
    expect(existsSync(workspaceRecord.quarantinePath)).toBe(true)
    expect(readFileSync(join(workspaceRecord.quarantinePath, 'draft.md'), 'utf-8')).toContain('保留内容')
  })

  test('Given 会话 JSONL 混入损坏行 When 读取 SDKMessage Then 跳过坏行并保留其它消息', () => {
    writeAgentSessionJsonl('session-with-bad-line', [
      JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: '你好' }] }, parent_tool_use_id: null }),
      '{ 这不是合法 JSON',
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '仍然可读' }] }, parent_tool_use_id: null }),
    ])

    const messages = manager.getAgentSessionSDKMessages('session-with-bad-line')

    expect(messages.map((message) => message.type)).toEqual(['user', 'assistant'])
  })

  test('Given SDK rewind JSONL 存在损坏行 When 从快照恢复文件 Then 严格失败避免误报成功', () => {
    const cwd = join(tempHome, 'workspace')
    mkdirSync(cwd, { recursive: true })
    writeSdkSessionJsonl('sdk-session-with-bad-line', [
      JSON.stringify({ type: 'user', uuid: 'user-1', message: { content: [{ type: 'text', text: '修改文件' }] } }),
      '{ 这不是合法 JSON',
      JSON.stringify({
        type: 'file-history-snapshot',
        isSnapshotUpdate: false,
        snapshot: {
          messageId: 'user-1',
          trackedFileBackups: {
            'a.txt': { backupFileName: null },
          },
        },
      }),
    ])

    const result = manager.rewindFilesFromSnapshot('sdk-session-with-bad-line', 'user-1', cwd)

    expect(result.canRewind).toBe(false)
    expect(result.error).toContain('JSONL 第 2 行解析失败')
  })

  test('Given 会话 JSONL 存在损坏行 When 截断 SDKMessage Then 抛错避免重写不完整历史', () => {
    writeAgentSessionJsonl('session-truncate-bad-line', [
      JSON.stringify({ type: 'assistant', uuid: 'assistant-1', message: { content: [{ type: 'text', text: '完成' }] } }),
      '{ 这不是合法 JSON',
    ])

    expect(() => manager.truncateSDKMessages('session-truncate-bad-line', 'assistant-1'))
      .toThrow('JSONL 第 2 行解析失败')
  })
})

describe('Agent 会话 runtime 元数据', () => {
  test('Given 新安装用户将默认思考设为 off When 连续新建并读取会话 Then 默认值不固化到会话（运行期解析）', () => {
    const settingsPath = join(tempHome, '.myyoda', 'settings.json')
    const indexPath = join(tempHome, '.myyoda', 'agent-sessions.json')
    const indexBackupPath = `${indexPath}.bak`
    mkdirSync(join(tempHome, '.myyoda'), { recursive: true })
    rmSync(indexPath, { force: true })
    rmSync(indexBackupPath, { force: true })
    writeFileSync(settingsPath, JSON.stringify({ defaultThinkingLevel: 'off' }), 'utf-8')

    try {
      const firstSession = manager.createAgentSession('关闭思考会话一')
      const secondSession = manager.createAgentSession('关闭思考会话二')

      // 默认档不再固化到会话 meta（留空=未设置）；生效值由运行期解析链决定（编码优化→max / defaultThinkingLevel）
      expect(firstSession.thinkingLevel).toBeUndefined()
      expect(secondSession.thinkingLevel).toBeUndefined()
      expect(manager.getAgentSessionMeta(firstSession.id)).toMatchObject({})
    } finally {
      rmSync(settingsPath, { force: true })
      rmSync(indexPath, { force: true })
      rmSync(indexBackupPath, { force: true })
    }
  })

  test('Given 历史索引没有迁移标记 When 读取旧版 off 会话 Then 仍执行一次 high 默认升级', () => {
    const indexPath = join(tempHome, '.myyoda', 'agent-sessions.json')
    const indexBackupPath = `${indexPath}.bak`
    mkdirSync(join(tempHome, '.myyoda'), { recursive: true })
    writeFileSync(indexPath, JSON.stringify({
      version: 1,
      sessions: [{
        id: 'legacy-off-session',
        title: '旧版关闭思考会话',
        agentRuntime: 'pi',
        thinkingLevel: 'off',
        openAIThinkingLevel: 'off',
        createdAt: 1,
        updatedAt: 1,
      }],
    }), 'utf-8')

    try {
      expect(manager.getAgentSessionMeta('legacy-off-session')).toMatchObject({
        thinkingLevel: 'high',
        openAIThinkingLevel: 'high',
      })
    } finally {
      rmSync(indexPath, { force: true })
      rmSync(indexBackupPath, { force: true })
    }
  })

  test('Given 新建会话 When 省略 runtime Then 默认 Pi（Claude runtime 已退役）', () => {
    const defaultRuntimeSession = manager.createAgentSession('默认内核会话')

    // Claude runtime 已退役，所有会话统一 Pi。
    // 思考深度不再在创建时固化（留空=未设置，由运行期解析链决定：编码优化→max / defaultThinkingLevel）。
    expect(defaultRuntimeSession.thinkingLevel).toBeUndefined()
    expect(defaultRuntimeSession.reasoningLevel).toBeUndefined()
  })

  test('Given session thinking level When updating Then dual-writes thinkingLevel and legacy openAIThinkingLevel', () => {
    const session = manager.createAgentSession('Codex 会话')

    const updated = manager.updateAgentSessionMeta(session.id, { thinkingLevel: 'xhigh' })

    expect(updated.thinkingLevel).toBe('xhigh')
    expect(updated.openAIThinkingLevel).toBe('xhigh')
    expect(manager.getAgentSessionMeta(session.id)).toMatchObject({
      thinkingLevel: 'xhigh',
      openAIThinkingLevel: 'xhigh',
    })
  })

  test('Given a session When star state is updated Then it persists without changing freshness or archive state', () => {
    const session = manager.createAgentSession('星标会话')
    const archived = manager.updateAgentSessionMeta(session.id, { archived: true })

    const updated = manager.updateAgentSessionMeta(session.id, { starred: true })

    expect(updated).toMatchObject({ starred: true, archived: true })
    expect(updated.updatedAt).toBe(archived.updatedAt)
    expect(manager.getAgentSessionMeta(session.id)).toMatchObject({ starred: true, archived: true })
  })

  test('Given a session When labelIds are updated Then it persists without changing freshness or archive state', () => {
    const session = manager.createAgentSession('标签会话')
    const archived = manager.updateAgentSessionMeta(session.id, { archived: true })

    const updated = manager.updateAgentSessionMeta(session.id, { labelIds: ['label-a'] })

    expect(updated).toMatchObject({ labelIds: ['label-a'], archived: true })
    expect(updated.updatedAt).toBe(archived.updatedAt)
    expect(manager.getAgentSessionMeta(session.id)).toMatchObject({ labelIds: ['label-a'], archived: true })
  })

  test('Given 新建会话 When 多次 appendSDKMessages Then messageCount 按追加条数累加', () => {
    const session = manager.createAgentSession('消息计数会话')
    expect(manager.getAgentSessionMeta(session.id)?.messageCount).toBeUndefined()

    manager.appendSDKMessages(session.id, [
      { type: 'user', message: { content: [{ type: 'text', text: '你好' }] }, parent_tool_use_id: null } as never,
    ])
    expect(manager.getAgentSessionMeta(session.id)?.messageCount).toBe(1)

    manager.appendSDKMessages(session.id, [
      { type: 'assistant', message: { content: [{ type: 'text', text: '收到' }] }, parent_tool_use_id: null } as never,
      { type: 'result', subtype: 'success' } as never,
    ])
    expect(manager.getAgentSessionMeta(session.id)?.messageCount).toBe(3)
  })

  test('Given 新会话准备 Git Worktree 上下文 When 更新元数据 Then 持久化完整执行上下文', () => {
    const session = manager.createAgentSession('Git 上下文会话')

    const updated = manager.updateAgentSessionMeta(session.id, {
      workingDirectory: '/repo/.worktrees/git-context-session',
      gitRepoPath: '/repo',
      gitBranch: 'main',
      gitExecutionMode: 'worktree',
      gitWorktreePath: '/repo/.worktrees/git-context-session',
      gitBaseRef: 'main',
    })

    expect(updated).toMatchObject({
      workingDirectory: '/repo/.worktrees/git-context-session',
      gitRepoPath: '/repo',
      gitBranch: 'main',
      gitExecutionMode: 'worktree',
      gitWorktreePath: '/repo/.worktrees/git-context-session',
      gitBaseRef: 'main',
    })
    expect(manager.getAgentSessionMeta(session.id)).toMatchObject({
      gitRepoPath: '/repo',
      gitBranch: 'main',
      gitExecutionMode: 'worktree',
      gitWorktreePath: '/repo/.worktrees/git-context-session',
      gitBaseRef: 'main',
    })
  })

  test('Given 空数组 When appendSDKMessages Then 直接返回不改动 messageCount', () => {
    const session = manager.createAgentSession('空追加会话')

    manager.appendSDKMessages(session.id, [])

    expect(manager.getAgentSessionMeta(session.id)?.messageCount).toBeUndefined()
  })

  test('Given 绑定 taskSlug 的历史会话缺失 messageCount When 读取索引 Then 按 JSONL 行数一次性回填', () => {
    const session = manager.createAgentSession('历史任务会话')
    manager.updateAgentSessionMeta(session.id, { taskSlug: 'legacy-task' })
    writeAgentSessionJsonl(session.id, [
      JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: '一' }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '二' }] } }),
      JSON.stringify({ type: 'result', subtype: 'success' }),
    ])

    expect(manager.getAgentSessionMeta(session.id)?.messageCount).toBe(3)
  })

  test('Given 未绑定 taskSlug 的历史会话缺失 messageCount When 读取索引 Then 不回填（不在看板展示范围）', () => {
    const session = manager.createAgentSession('无任务历史会话')
    writeAgentSessionJsonl(session.id, [
      JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: '一' }] } }),
    ])

    expect(manager.getAgentSessionMeta(session.id)?.messageCount).toBeUndefined()
  })
})

describe('Agent 会话引用搜索', () => {
  test('Given 工作区有超过 20 个会话 When 请求最近 200 条 Then 按更新时间返回 200 条', async () => {
    writeAgentSessionsIndex(createIndexedSessions(220))

    const results = await manager.searchAgentSessionReferences({
      workspaceId: 'workspace-a',
      limit: 200,
    })

    expect(results).toHaveLength(200)
    expect(results[0]?.sessionId).toBe('session-219')
    expect(results.at(-1)?.sessionId).toBe('session-20')
    expect(results.every((result) => result.matchSource === 'recent')).toBe(true)
  })

  test('Given 请求数量超过性能上限 When 搜索可引用会话 Then 最多返回 200 条', async () => {
    writeAgentSessionsIndex(createIndexedSessions(220))

    const results = await manager.searchAgentSessionReferences({
      workspaceId: 'workspace-a',
      limit: 500,
    })

    expect(results).toHaveLength(200)
  })

  test('Given 未指定工作区 When 搜索可引用会话 Then 返回全部工作区的最近会话并标示来源', async () => {
    writeAgentWorkspacesIndex([
      { id: 'workspace-a', name: '产品研发', slug: 'product-dev', createdAt: 1, updatedAt: 1 },
      { id: 'workspace-b', name: '客户支持', slug: 'customer-support', createdAt: 2, updatedAt: 2 },
      { id: 'workspace-c', name: '当前项目', slug: 'current-project', createdAt: 3, updatedAt: 3 },
    ])
    writeAgentSessionsIndex([
      { id: 'workspace-a-session', title: '同名会话', workspaceId: 'workspace-a', createdAt: 1, updatedAt: 1 },
      { id: 'workspace-b-session', title: '同名会话', workspaceId: 'workspace-b', createdAt: 2, updatedAt: 2 },
      { id: 'current-session', title: '当前会话', workspaceId: 'workspace-c', createdAt: 3, updatedAt: 3 },
    ])

    const results = await manager.searchAgentSessionReferences({
      excludeSessionId: 'current-session',
      limit: 200,
    })

    expect(results).toMatchObject([
      { sessionId: 'workspace-b-session', workspaceName: '客户支持', workspaceSlug: 'customer-support' },
      { sessionId: 'workspace-a-session', workspaceName: '产品研发', workspaceSlug: 'product-dev' },
    ])
  })

  test('Given 消息内容命中 When 搜索可引用会话 Then 异步返回匹配片段和工作区来源', async () => {
    writeAgentWorkspacesIndex([
      { id: 'workspace-b', name: '客户支持', slug: 'customer-support', createdAt: 1, updatedAt: 1 },
    ])
    writeAgentSessionsIndex([
      { id: 'message-session', title: '项目讨论', workspaceId: 'workspace-b', createdAt: 1, updatedAt: 1 },
    ])
    writeAgentSessionJsonl('message-session', [
      JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: '需要核对跨工作区的会话引用。' }] } }),
    ])

    const results = await manager.searchAgentSessionReferences({ query: '跨工作区' })

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      sessionId: 'message-session',
      workspaceName: '客户支持',
      workspaceSlug: 'customer-support',
      matchSource: 'message',
      snippet: expect.stringContaining('跨工作区'),
    })
  })

  test('Given 正文扫描预算耗尽 When 较旧会话标题命中 Then 仍返回标题命中结果', async () => {
    const scannedSessions = Array.from({ length: 50 }, (_, index) => ({
      id: `body-scan-${index}`,
      title: `普通会话 ${index}`,
      workspaceId: 'workspace-a',
      createdAt: 100 - index,
      updatedAt: 100 - index,
    }))
    writeAgentSessionsIndex([
      ...scannedSessions,
      { id: 'older-title-match', title: '目标会话', workspaceId: 'workspace-a', createdAt: 1, updatedAt: 1 },
    ])
    for (const session of scannedSessions) {
      writeAgentSessionJsonl(session.id, [
        JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: '没有匹配内容' }] } }),
      ])
    }

    const results = await manager.searchAgentSessionReferences({ query: '目标' })

    expect(results).toMatchObject([{ sessionId: 'older-title-match', matchSource: 'title' }])
  })

  test('Given 正文命中在单文件扫描上限之后 When 搜索引用 Then 不读取超出输入补全预算的历史', async () => {
    writeAgentSessionsIndex([
      { id: 'oversized-session', title: '大历史', workspaceId: 'workspace-a', createdAt: 1, updatedAt: 1 },
    ])
    writeAgentSessionJsonl('oversized-session', [
      JSON.stringify({
        type: 'user',
        message: { content: [{ type: 'text', text: `${'x'.repeat(300 * 1024)}隐藏关键词` }] },
      }),
    ])

    const results = await manager.searchAgentSessionReferences({ query: '隐藏关键词' })

    expect(results).toEqual([])
  })
})

describe('Agent 会话引用 prompt', () => {
  test('Given 用户显式引用跨工作区会话 When 构建发送 prompt Then 保留该会话上下文', () => {
    writeAgentSessionsIndex([
      { id: 'current-session', title: '当前工作区会话', workspaceId: 'workspace-a', createdAt: 1, updatedAt: 1 },
      { id: 'other-workspace-session', title: '其他工作区会话', workspaceId: 'workspace-b', createdAt: 2, updatedAt: 2 },
    ])

    const processWithResourcesPath = process as NodeJS.Process & { resourcesPath?: string }
    const originalResourcesPath = processWithResourcesPath.resourcesPath
    processWithResourcesPath.resourcesPath = tempHome
    try {
      const prompt = contextPrompt.buildReferencedSessionsPrompt(
        'current-session',
        ['other-workspace-session'],
      )

      expect(prompt).toContain('id="other-workspace-session"')
      expect(prompt).toContain('title="其他工作区会话"')
      expect(prompt).not.toContain('同工作区')
    } finally {
      Object.defineProperty(processWithResourcesPath, 'resourcesPath', {
        value: originalResourcesPath,
        configurable: true,
        writable: true,
      })
    }
  })
})
