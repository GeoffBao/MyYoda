/**
 * Chrome DevTools 连接器可用性：本机是否有 Chrome/Edge，以及 npx。
 *
 * catalog 每次刷新都会问一次，只做 existsSync，不 spawn。
 */

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'

export interface ChromeDevtoolsAvailability {
  available: boolean
  reason?: string
}

function pathApi(platform: NodeJS.Platform): typeof posix {
  return platform === 'win32' ? win32 : posix
}

function envPathDelimiter(platform: NodeJS.Platform): string {
  return platform === 'win32' ? ';' : ':'
}

export function evaluateChromeDevtoolsAvailability(input: {
  browserPath: string | null
  npxPath: string | null
}): ChromeDevtoolsAvailability {
  if (!input.browserPath) {
    return { available: false, reason: '未检测到 Chrome，请安装 Google Chrome 后重试' }
  }
  if (!input.npxPath) {
    return { available: false, reason: '需要本机 Node.js（npx）才能启动浏览器连接器' }
  }
  return { available: true }
}

export function chromeBrowserCandidates(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  home: string,
): string[] {
  const { join } = pathApi(platform)
  switch (platform) {
    case 'win32': {
      const programFiles = env.PROGRAMFILES || env.ProgramFiles || 'C:\\Program Files'
      const programFilesX86 = env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)'
      const localAppData = env.LOCALAPPDATA || join(home, 'AppData', 'Local')
      return [
        join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(localAppData, 'Google', 'Chrome SxS', 'Application', 'chrome.exe'),
        join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      ]
    }
    case 'darwin':
      return [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        join(home, 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'),
      ]
    default:
      return [
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/usr/bin/microsoft-edge',
        '/snap/bin/chromium',
      ]
  }
}

export function npxCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  const { join } = pathApi(platform)
  const binary = platform === 'win32' ? 'npx.cmd' : 'npx'
  const fromPath = (env.PATH ?? env.Path ?? '')
    .split(envPathDelimiter(platform))
    .map((dir) => dir.trim())
    .filter(Boolean)
    .filter((dir) => !dir.toLowerCase().includes('bun-node-'))
    .map((dir) => join(dir, binary))

  if (platform !== 'win32') return fromPath

  const programFiles = env.PROGRAMFILES || env.ProgramFiles || 'C:\\Program Files'
  return [
    join(programFiles, 'nodejs', binary),
    'C:\\Program Files (x86)\\nodejs\\npx.cmd',
    ...fromPath,
  ]
}

function firstExisting(paths: string[]): string | null {
  for (const candidate of paths) {
    if (candidate && existsSync(candidate)) return candidate
  }
  return null
}

export function resolveChromeDevtoolsAvailability(): ChromeDevtoolsAvailability {
  return evaluateChromeDevtoolsAvailability({
    browserPath: firstExisting(chromeBrowserCandidates(process.platform, process.env, homedir())),
    npxPath: firstExisting(npxCandidates(process.platform, process.env)),
  })
}
