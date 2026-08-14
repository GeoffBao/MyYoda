import { describe, expect, test } from 'bun:test'
import * as path from 'node:path'
import { buildAgentSessionFileRoots } from './agent-file-roots'

describe('buildAgentSessionFileRoots', () => {
  test('Project effective cwd 是托管 Project 时，Outbox 仍独立于 Project root', () => {
    const result = buildAgentSessionFileRoots({
      sessionDir: path.join('/myyoda','workspaces','default','session-1'),
      workspaceFilesPath: path.join('/myyoda','workspaces','default','workspace-files'),
      executionCwd: path.join('/myyoda','workspaces','default','projects/demo/workdir'),
      executionSource: 'project',
      projectId: 'project-1',
      projectAssetsPath: path.join('/myyoda','workspaces','default','projects/demo/assets'),
    })

    expect(result).toMatchObject({
      sessionDir: path.join('/myyoda','workspaces','default','session-1'),
      executionCwd: path.join('/myyoda','workspaces','default','projects/demo/workdir'),
      executionSource: 'project',
      projectRoot: path.join('/myyoda','workspaces','default','projects/demo/workdir'),
      projectAssetsPath: path.join('/myyoda','workspaces','default','projects/demo/assets'),
    })
  })

  test('历史 Session 只使用 sandbox，不误把绑定 Project 当成执行目录', () => {
    const result = buildAgentSessionFileRoots({
      sessionDir: path.join('/myyoda','workspaces','default','session-2'),
      workspaceFilesPath: path.join('/myyoda','workspaces','default','workspace-files'),
      executionCwd: path.join('/myyoda','workspaces','default','session-2'),
      executionSource: 'sandbox',
      projectId: 'project-1',
    })

    expect(result.executionCwd).toBe(result.sessionDir)
    expect(result.projectRoot).toBeUndefined()
  })

  test('Project 目录不可达时透传原始路径，供 UI 与"未绑定"区分', () => {
    const result = buildAgentSessionFileRoots({
      sessionDir: path.join('/myyoda','workspaces','default','session-3'),
      workspaceFilesPath: path.join('/myyoda','workspaces','default','workspace-files'),
      executionCwd: path.join('/myyoda','workspaces','default','session-3'),
      executionSource: 'sandbox',
      projectId: 'project-1',
      projectUnavailablePath: '/Volumes/External/demo-project',
    })

    expect(result.projectRoot).toBeUndefined()
    expect(result.projectUnavailablePath).toBe('/Volumes/External/demo-project')
  })

  test('会话完全没绑定 Project 时不出现 projectUnavailablePath', () => {
    const result = buildAgentSessionFileRoots({
      sessionDir: path.join('/myyoda','workspaces','default','session-4'),
      workspaceFilesPath: path.join('/myyoda','workspaces','default','workspace-files'),
      executionCwd: path.join('/myyoda','workspaces','default','session-4'),
      executionSource: 'sandbox',
    })

    expect(result.projectId).toBeUndefined()
    expect(result.projectUnavailablePath).toBeUndefined()
  })
})
