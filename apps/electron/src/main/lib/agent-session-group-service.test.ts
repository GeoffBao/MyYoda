import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { mockElectronModule } from './__tests__/electron-mock'

type GroupService = typeof import('./agent-session-group-service')
type SessionManager = typeof import('./agent-session-manager')

let groupService: GroupService
let sessionManager: SessionManager
let tempHome: string
const originalHome = process.env.HOME
const originalMyyodaDev = process.env.MYYODA_DEV

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

function writeAgentSessionsIndex(sessions: Array<{ id: string; title: string; customGroupId?: string }>): void {
  const dir = join(tempHome, '.myyoda')
  mkdirSync(dir, { recursive: true })
  const now = Date.now()
  writeFileSync(
    join(dir, 'agent-sessions.json'),
    JSON.stringify({
      version: 1,
      sessions: sessions.map((s) => ({ ...s, createdAt: now, updatedAt: now })),
    }),
    'utf-8',
  )
}

beforeAll(async () => {
  tempHome = mkdtempSync(join(os.tmpdir(), 'myyoda-session-group-service-'))
  process.env.HOME = tempHome
  delete process.env.MYYODA_DEV
  delete process.env.MYYODA_DEV
  groupService = await import('./agent-session-group-service')
  sessionManager = await import('./agent-session-manager')
})

beforeEach(() => {
  const configDir = join(tempHome, '.myyoda')
  rmSync(configDir, { recursive: true, force: true })
  mkdirSync(configDir, { recursive: true })
})

afterAll(() => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  if (originalMyyodaDev === undefined) delete process.env.MYYODA_DEV
  else process.env.MYYODA_DEV = originalMyyodaDev
  rmSync(tempHome, { recursive: true, force: true })
})

describe('会话自定义分组服务', () => {
  test('Given 空工作区 When 列出分组 Then 返回空数组', () => {
    expect(groupService.listSessionGroups('workspace-a')).toEqual([])
  })

  test('Given 新建分组 When 列出 Then 能查到该分组', () => {
    const group = groupService.createSessionGroup('workspace-a', '研究类会话')

    expect(group.name).toBe('研究类会话')
    expect(groupService.listSessionGroups('workspace-a').map((g) => g.id)).toContain(group.id)
  })

  test('Given 分组名前后有空白 When 新建 Then 去除首尾空白', () => {
    const group = groupService.createSessionGroup('workspace-a', '  带空格的名字  ')

    expect(group.name).toBe('带空格的名字')
  })

  test('Given 空白分组名 When 新建 Then 抛出错误', () => {
    expect(() => groupService.createSessionGroup('workspace-a', '   ')).toThrow('分组名称不能为空')
  })

  test('Given 已有分组 When 重命名 Then 名称更新且 updatedAt 变化', () => {
    const group = groupService.createSessionGroup('workspace-a', '旧名字')
    const renamed = groupService.renameSessionGroup('workspace-a', group.id, '新名字')

    expect(renamed.name).toBe('新名字')
    expect(groupService.listSessionGroups('workspace-a').find((g) => g.id === group.id)?.name).toBe('新名字')
  })

  test('Given 不存在的分组 id When 重命名 Then 抛出错误', () => {
    expect(() => groupService.renameSessionGroup('workspace-a', 'not-exist', '新名字')).toThrow('分组不存在')
  })

  test('Given 两个工作区各自建组 When 列出 Then 互不干扰', () => {
    groupService.createSessionGroup('workspace-a', 'A 的分组')
    groupService.createSessionGroup('workspace-b', 'B 的分组')

    expect(groupService.listSessionGroups('workspace-a').map((g) => g.name)).toEqual(['A 的分组'])
    expect(groupService.listSessionGroups('workspace-b').map((g) => g.name)).toEqual(['B 的分组'])
  })

  test('Given 会话引用了某分组 When 删除该分组 Then 分组消失且引用会话的 customGroupId 被清空', () => {
    const group = groupService.createSessionGroup('workspace-a', '待删除分组')
    writeAgentSessionsIndex([
      { id: 'session-1', title: '会话一', customGroupId: group.id },
      { id: 'session-2', title: '会话二', customGroupId: 'other-group' },
      { id: 'session-3', title: '会话三' },
    ])

    groupService.deleteSessionGroup('workspace-a', group.id)

    expect(groupService.listSessionGroups('workspace-a')).toEqual([])
    expect(sessionManager.getAgentSessionMeta('session-1')?.customGroupId).toBeUndefined()
    expect(sessionManager.getAgentSessionMeta('session-2')?.customGroupId).toBe('other-group')
    expect(sessionManager.getAgentSessionMeta('session-3')?.customGroupId).toBeUndefined()
  })
})
