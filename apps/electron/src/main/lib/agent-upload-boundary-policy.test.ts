import { describe, expect, test } from 'bun:test'
import { assertRegisteredSessionUpload, resolveRegisteredUploadWorkspace } from './agent-upload-boundary-policy'

describe('Agent upload workspace boundary', () => {
  const workspaces = [{ id: 'workspace-1', slug: 'default-workspace' }]
  const sessions = [{ id: 'session-1', workspaceId: 'workspace-1' }]

  test('只接受已注册 Workspace slug，拒绝 traversal 与相似前缀', () => {
    expect(resolveRegisteredUploadWorkspace('default-workspace', workspaces)).toEqual(workspaces[0]!)
    expect(resolveRegisteredUploadWorkspace('../../outside', workspaces)).toBeNull()
    expect(resolveRegisteredUploadWorkspace('default-workspace-extra', workspaces)).toBeNull()
  })

  test('只允许当前 Workspace 所属的已知 Session 写入', () => {
    expect(assertRegisteredSessionUpload('default-workspace', 'session-1', workspaces, sessions).session.id).toBe('session-1')
    expect(() => assertRegisteredSessionUpload('../../outside', 'session-1', workspaces, sessions)).toThrow('Workspace slug 未注册')
    expect(() => assertRegisteredSessionUpload('default-workspace', '../../outside', workspaces, sessions)).toThrow('Agent 会话不属于当前 Workspace')
    expect(() => assertRegisteredSessionUpload('default-workspace', 'session-2', workspaces, sessions)).toThrow('Agent 会话不属于当前 Workspace')
  })
})
