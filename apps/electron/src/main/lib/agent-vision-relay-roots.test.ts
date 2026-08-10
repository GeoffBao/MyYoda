import { describe, expect, test } from 'bun:test'
import { appendVisionRelayAllowedRoot } from './vision-relay-roots'

const PROJECT_DIR = '/Users/admin/Workspace/Resources/obsidian/AI-KN-Base'
const HOME = '/Users/admin'

describe('appendVisionRelayAllowedRoot', () => {
  test('agentCwd 为项目工作目录且不在基础列表 → 追加到授权根', () => {
    const base = ['/tmp/additional', '/tmp/workspace-files']
    const result = appendVisionRelayAllowedRoot(base, PROJECT_DIR, HOME)
    expect(result).toEqual([...base, PROJECT_DIR])
  })

  test('agentCwd 已在基础列表 → 不重复追加', () => {
    const base = ['/tmp/additional', PROJECT_DIR]
    const result = appendVisionRelayAllowedRoot(base, PROJECT_DIR, HOME)
    expect(result).toEqual(base)
  })

  test('agentCwd 未定义 → 原样返回', () => {
    const base = ['/tmp/additional']
    expect(appendVisionRelayAllowedRoot(base, undefined, HOME)).toEqual(base)
  })

  test('agentCwd 等于 homedir（无 workspace 兜底）→ 不无脑放宽整个主目录', () => {
    const base = ['/tmp/additional']
    expect(appendVisionRelayAllowedRoot(base, HOME, HOME)).toEqual(base)
  })

  test('sessionSandboxDir 不在基础列表 → 追加到授权根（project 模式下上传附件所在目录）', () => {
    const base = ['/tmp/additional', PROJECT_DIR]
    const sandbox = '/Users/admin/.myyoda/agent-workspaces/default/abc-123'
    const result = appendVisionRelayAllowedRoot(base, PROJECT_DIR, HOME, sandbox)
    expect(result).toEqual([...base, sandbox])
  })

  test('sessionSandboxDir 已在基础列表 → 不重复追加', () => {
    const base = ['/tmp/additional', PROJECT_DIR]
    const sandbox = '/Users/admin/.myyoda/agent-workspaces/default/abc-123'
    const result = appendVisionRelayAllowedRoot([...base, sandbox], PROJECT_DIR, HOME, sandbox)
    expect(result).toEqual([...base, sandbox])
  })

  test('sessionSandboxDir 等于 homedir → 不追加（防御）', () => {
    const base = ['/tmp/additional']
    expect(appendVisionRelayAllowedRoot(base, undefined, HOME, HOME)).toEqual(base)
  })

  test('sessionSandboxDir 未提供 → 行为与旧签名一致', () => {
    const base = ['/tmp/additional']
    expect(appendVisionRelayAllowedRoot(base, PROJECT_DIR, HOME)).toEqual([...base, PROJECT_DIR])
  })
})
