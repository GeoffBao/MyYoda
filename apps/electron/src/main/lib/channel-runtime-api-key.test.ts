import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { serializeCodexCredentials, serializeClaudeOAuthCredentials } from '@myyoda/shared'
import { mockElectronModule } from './__tests__/electron-mock'

type ChannelManagerModule = typeof import('./channel-manager')

let channelManager: ChannelManagerModule
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
  tempHome = mkdtempSync(join(os.tmpdir(), 'myyoda-channel-runtime-key-'))
  process.env.HOME = tempHome
  delete process.env.MYYODA_DEV
  process.env.MYYODA_DEV = '0'
  channelManager = await import('./channel-manager')
})

beforeEach(() => {
  rmSync(join(tempHome, '.myyoda'), { recursive: true, force: true })
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
  rmSync(tempHome, { recursive: true, force: true })
})

describe('渠道运行时认证解析', () => {
  test('Given ChatGPT OAuth 渠道 When 解析运行时 key Then 返回 access token 而不是凭据 JSON', async () => {
    writeChannels([
      {
        id: 'codex-channel',
        name: 'ChatGPT',
        provider: 'openai-codex',
        baseUrl: '',
        apiKey: serializeCodexCredentials({
          access: 'oauth-access-token',
          refresh: 'oauth-refresh-token',
          expires: Date.now() + 3_600_000,
        }),
        models: [],
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ])

    await expect(channelManager.resolveChannelRuntimeApiKey('codex-channel'))
      .resolves.toBe('oauth-access-token')
  })

  test('Given 普通渠道 When 解析运行时 key Then 返回解密后的 API Key', async () => {
    writeChannels([
      {
        id: 'api-key-channel',
        name: 'Anthropic',
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'plain-api-key',
        models: [],
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ])

    await expect(channelManager.resolveChannelRuntimeApiKey('api-key-channel'))
      .resolves.toBe('plain-api-key')
  })

  test('Given Claude 订阅 OAuth 渠道 When 解析运行时 key Then 返回 token 而不是凭据 JSON', async () => {
    writeChannels([
      {
        id: 'claude-oauth-channel',
        name: 'Claude Pro/Max',
        provider: 'anthropic-oauth',
        baseUrl: '',
        apiKey: serializeClaudeOAuthCredentials({
          token: 'sk-ant-oat01-runtime-token',
          obtainedAt: Date.now(),
        }),
        models: [],
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ])

    await expect(channelManager.resolveChannelRuntimeApiKey('claude-oauth-channel'))
      .resolves.toBe('sk-ant-oat01-runtime-token')
  })

  test('Given Claude 订阅渠道凭据损坏 When 解析运行时 key Then 抛出可读错误', async () => {
    writeChannels([
      {
        id: 'claude-oauth-broken',
        name: 'Claude Pro/Max',
        provider: 'anthropic-oauth',
        baseUrl: '',
        apiKey: 'not-valid-json',
        models: [],
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ])

    await expect(channelManager.resolveChannelRuntimeApiKey('claude-oauth-broken'))
      .rejects.toThrow(/重新登录/)
  })
})
