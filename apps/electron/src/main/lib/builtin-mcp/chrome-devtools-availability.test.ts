import { describe, expect, test } from 'bun:test'
import {
  chromeBrowserCandidates,
  evaluateChromeDevtoolsAvailability,
  npxCandidates,
} from './chrome-devtools-availability'

describe('chrome-devtools-availability', () => {
  test('treats missing Chrome as needs_config, not enabled', () => {
    expect(evaluateChromeDevtoolsAvailability({
      browserPath: null,
      npxPath: 'C:\\Program Files\\nodejs\\npx.cmd',
    })).toEqual({
      available: false,
      reason: '未检测到 Chrome，请安装 Google Chrome 后重试',
    })
  })

  test('treats missing npx as needs_config when Chrome exists', () => {
    expect(evaluateChromeDevtoolsAvailability({
      browserPath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      npxPath: null,
    })).toEqual({
      available: false,
      reason: '需要本机 Node.js（npx）才能启动浏览器连接器',
    })
  })

  test('is available only when Chrome and npx both exist', () => {
    expect(evaluateChromeDevtoolsAvailability({
      browserPath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      npxPath: '/usr/local/bin/npx',
    })).toEqual({ available: true })
  })

  test('windows candidates include Chrome and Edge install locations', () => {
    const candidates = chromeBrowserCandidates('win32', {
      PROGRAMFILES: 'C:\\Program Files',
      'PROGRAMFILES(X86)': 'C:\\Program Files (x86)',
      LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
    }, 'C:\\Users\\me')

    expect(candidates).toContain('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
    expect(candidates).toContain('C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe')
    expect(candidates).toContain('C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe')
  })

  test('windows npx candidates include nodejs install dir and PATH', () => {
    const candidates = npxCandidates('win32', {
      PROGRAMFILES: 'C:\\Program Files',
      PATH: 'C:\\tools\\node;C:\\Windows\\System32',
    })
    expect(candidates[0]).toBe('C:\\Program Files\\nodejs\\npx.cmd')
    expect(candidates).toContain('C:\\tools\\node\\npx.cmd')
  })
})
