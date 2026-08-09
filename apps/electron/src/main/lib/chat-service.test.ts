import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { CHAT_IPC_CHANNELS } from '@myyoda/shared'
import type { WebContents } from 'electron'
import { mockElectronModule } from './__tests__/electron-mock'

const sendMock = mock(() => undefined)
let tempHome: string
const originalHome = process.env.HOME
const originalMyyodaDev = process.env.MYYODA_DEV
const originalPromaDev = process.env.PROMA_DEV

// chat-service.ts 间接 import conversation-manager / attachment-service 等模块，
// 这些模块可能在加载时触碰 Electron API（对齐 channel-runtime-api-key.test.ts
// 的既有防御性做法，避免非 Electron 环境下 bun test 因缺失全局对象而在 import
// 阶段就崩溃）。
mockElectronModule({
  app: { isPackaged: true, getPath: () => join(tempHome, 'Library', 'Application Support') },
  shell: { openExternal: async () => undefined },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
})

// 不 mock './channel-manager'：bun 的 mock.module 是进程级注册表，跨测试文件共享，
// 一旦 mock 会污染依赖真实 channel-manager 的其他测试（如 channel-runtime-api-key.test）。
// 这里通过真实 channel-manager + channels.json 构造 anthropic-oauth 渠道。
mock.module('node:os', () => ({
  ...os,
  homedir: () => tempHome,
}))

function writeChannels(channels: unknown[]): void {
  const configDir = join(tempHome, '.myyoda')
  mkdirSync(configDir, { recursive: true })
  writeFileSync(
    join(configDir, 'channels.json'),
    JSON.stringify({ version: 2, channels }),
    'utf-8',
  )
}

beforeAll(async () => {
  tempHome = mkdtempSync(join(os.tmpdir(), 'myyoda-chat-service-'))
  process.env.HOME = tempHome
  delete process.env.MYYODA_DEV
  process.env.PROMA_DEV = '0'
  writeChannels([
    {
      id: 'claude-oauth-1',
      provider: 'anthropic-oauth',
      name: 'Claude Pro/Max',
      baseUrl: '',
      apiKey: '',
      models: [],
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    },
  ])
})

afterAll(() => {
  process.env.HOME = originalHome
  if (originalMyyodaDev === undefined) delete process.env.MYYODA_DEV
  else process.env.MYYODA_DEV = originalMyyodaDev
  if (originalPromaDev === undefined) delete process.env.PROMA_DEV
  else process.env.PROMA_DEV = originalPromaDev
  rmSync(tempHome, { recursive: true, force: true })
})

describe('Chat 模式 anthropic-oauth guard', () => {
  test('Given anthropic-oauth 渠道 When 发消息 Then 直接拒绝并引导切换 Agent 模式，不解密 apiKey', async () => {
    const { sendMessage } = await import('./chat-service')
    const webContents = { send: sendMock } as unknown as WebContents

    await sendMessage(
      {
        conversationId: 'conv-1',
        userMessage: 'hi',
        messageHistory: [],
        channelId: 'claude-oauth-1',
        modelId: 'claude-sonnet-5',
      },
      webContents,
    )

    expect(sendMock).toHaveBeenCalledWith(
      CHAT_IPC_CHANNELS.STREAM_ERROR,
      expect.objectContaining({
        conversationId: 'conv-1',
        error: expect.stringContaining('Agent 模式'),
      }),
    )
  })
})
