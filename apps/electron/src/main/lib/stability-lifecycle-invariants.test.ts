import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const mainDir = join(import.meta.dir, '..')

function readMainSource(relativePath: string): string {
  return readFileSync(join(mainDir, relativePath), 'utf-8')
}

describe('主进程稳定性生命周期约束', () => {
  test('飞书 Bridge stop 会释放待合并附件', () => {
    const source = readMainSource('lib/feishu-bridge.ts')
    const stopBody = source.slice(source.indexOf('  stop(): void {'), source.indexOf('  async restart(): Promise<void>'))

    expect(stopBody).toContain('this.pendingImages.clear()')
    expect(stopBody).toContain('this.pendingFiles.clear()')
    expect(stopBody).toContain('this.lifecycleGeneration += 1')
    expect(source).toContain('if (await abandonIfStale()) return')
  })

  test('钉钉过期 start 只释放本次 client，不会 disconnect 新连接', () => {
    const source = readMainSource('lib/dingtalk-bridge.ts')
    const startBody = source.slice(source.indexOf('  async start(): Promise<void> {'), source.indexOf('  /** 停止连接 */'))

    expect(startBody).toContain('if (this.client === liveClient)')
    expect(startBody).toContain('liveClient.disconnect()')
    expect(startBody).not.toMatch(/if \(this\.client\) this\.client = null/)
  })

  test('工作区 watcher stop 会清理主 watcher 的 debounce 计时器', () => {
    const source = readMainSource('lib/workspace-watcher.ts')
    const stopBody = source.slice(
      source.indexOf('export function stopWorkspaceWatcher(): void'),
      source.indexOf('export function watchAttachedDirectory'),
    )

    expect(stopBody).toContain('clearTimeout(capabilitiesTimer)')
    expect(stopBody).toContain('clearTimeout(filesTimer)')
    expect(stopBody).toContain('workspaceWatcherGeneration += 1')
    expect(source).toContain('generation === workspaceWatcherGeneration')
  })

  test('启动降级路径不会重复注册 IPC handler', () => {
    const source = readMainSource('index.ts')
    const ipcSource = readMainSource('ipc.ts')
    const registrationCount = source.match(/registerIpcHandlers\(\)/g)?.length ?? 0

    expect(ipcSource).toContain('ipcHandlersRegistered')
    expect(ipcSource).toContain('if (ipcHandlersRegistered)')
    expect(registrationCount).toBe(2)
    expect(source).toContain('registerIpcHandlers()')
    expect(source.slice(source.indexOf('function handleBootstrapFailure'))).toContain('registerIpcHandlers()')
  })

  test('退出路径显式释放 Agent 浏览器', () => {
    const source = readMainSource('index.ts')

    expect(source).toContain("name: '释放 Agent 浏览器'")
    expect(source).toContain('browserController.dispose()')
  })

  test('退出路径有界等待 Pi MCP stdio 连接关闭', () => {
    const source = readMainSource('index.ts')

    expect(source).toContain('asyncCleanup: disposePiMcpConnections')
    expect(source).toContain('timeoutMs: MCP_QUIT_TIMEOUT_MS')
  })

  test('协作阻塞事件在解决和委派淘汰后释放', () => {
    const source = readMainSource('lib/agent-collaboration-tools.ts')
    const finishStart = source.indexOf('function markDelegationFinished(')
    const finishBody = source.slice(finishStart, finishStart + 700)

    expect(source).toContain('blockedEvents.delete(be.id)')
    expect(finishBody).toContain('deleteBlockedEventsForDelegation(record.delegationId)')
    expect(source).toContain('deleteBlockedEventsForDelegation(item.delegationId)')
    expect(source).toContain("note: '该阻塞事件不存在或已被解决'")
  })
})
