/**
 * cli-auth — CLI 连接器扫码授权（企业微信 wecom-cli auth init 等）
 *
 * 把「在终端扫码授权」搬到应用内：
 * - authStart：spawn `<cli> auth init --noninteractive --no-browser --output-qrcode <qr.png>`
 *   解析 stdout 中的扫码链接，把二维码 PNG 转 base64 返回给 UI 直接展示；
 * - authStatus：实时执行 authCheckCommand 判断是否已认证（不走 60s 缓存，授权过程中需要实时结果）；
 * - authCancel：关闭弹窗时终止仍挂起的扫码进程。
 *
 * 仅对 installKind='cli' 且带 authCheckCommand 的市场条目可用。
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { exec as execCallback } from 'node:child_process'
import type { MarketplaceItem } from '@myyoda/shared'
import { listMarketplaceCatalog } from './marketplace-manager'
import { getMarketplaceRemoteItems } from './marketplace-service'

const execAsync = promisify(execCallback)

/** 当前正在进行的扫码授权进程（同一时间只允许一个） */
let activeAuthProcess: ChildProcess | null = null
let activeAuthDir: string | null = null
let activeAuthCommand: string | null = null

/** 解析出 cli 命令的绝对路径（优先当前 PATH，其次 login shell） */
async function resolveCliPath(command: string): Promise<string> {
  const fast = await execAsync(`command -v ${command} 2>/dev/null`, { timeout: 1500 })
  const fastPath = fast.stdout?.trim()
  if (fastPath) return fastPath
  const slow = await execAsync(`zsh -ilc "command -v ${command}" 2>/dev/null`, { timeout: 5000 })
  const slowPath = slow.stdout?.trim()
  if (slowPath) return slowPath
  return command // 找不到也返回原始命令，让 spawn 报 ENOENT，上层给可读错误
}

/** 从 auth init 输出中解析扫码链接（wecom-cli 打印 "请打开二维码链接扫码: <url>"） */
function extractAuthUrl(output: string): string | undefined {
  const match = output.match(/https?:\/\/[^\s"'`]+/)
  return match?.[0]
}

/** 查找工作区内已安装的 CLI 条目（本地目录 + 远程快照） */
function findCliItem(itemId: string): MarketplaceItem | undefined {
  const local = listMarketplaceCatalog().find((i) => i.id === itemId)
  if (local) return local
  return getMarketplaceRemoteItems()[itemId]
}

export interface CliAuthStartResult {
  /** 扫码链接（可点击在浏览器打开） */
  url?: string
  /** 二维码 PNG 的 base64 data URL（UI 直接 <img> 展示） */
  qrDataUrl?: string
  /** 错误信息（命令不存在/不支持扫码等） */
  error?: string
}

/**
 * 启动 CLI 扫码授权：
 * - 生成临时目录，spawn `auth init --noninteractive --no-browser --output-qrcode qr.png`
 * - 等二维码 PNG 生成后读取并转 base64 返回
 * 返回后进程继续在后台等待扫码；调用 authStatus 轮询结果，authCancel 可终止。
 */
export async function cliAuthStart(itemId: string): Promise<CliAuthStartResult> {
  // 同一时间只保留一个扫码会话
  await cliAuthCancel()

  const item = findCliItem(itemId)
  if (!item || item.installKind !== 'cli') return { error: '条目不存在或非 CLI 连接器' }
  const cliCommand = item.cliCommand
  if (!cliCommand) return { error: '条目缺少 cliCommand' }

  let binPath: string
  try {
    binPath = await resolveCliPath(cliCommand)
  } catch {
    return { error: `未检测到 ${cliCommand} 命令，请先安装` }
  }

  const dir = mkdtempSync(join(tmpdir(), 'myyoda-cli-auth-'))
  const qrPath = join(dir, 'qr.png')

  const child = spawn(binPath, ['auth', 'init', '--noninteractive', '--no-browser', '--output-qrcode', qrPath], {
    cwd: dir,
    env: { ...process.env },
    // stdin 不接管（CLI 非交互模式不需要输入）；stdout/stderr 收集用于解析扫码链接
    stdio: ['ignore', 'pipe', 'pipe'],
    // 独立进程组：auth 进程可能再拉起子进程（node wrapper → 原生二进制），取消时整组终止
    detached: true,
  })
  try {
    child.unref()
  } catch { /* 忽略 */ }
  activeAuthProcess = child
  activeAuthDir = dir
  activeAuthCommand = cliCommand

  let output = ''
  child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString() })
  child.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString() })
  child.on('exit', () => {
    if (activeAuthProcess === child) activeAuthProcess = null
  })
  child.on('error', (error) => {
    console.error(`[CLI 授权] 启动失败（${cliCommand}）:`, error)
    if (activeAuthProcess === child) activeAuthProcess = null
  })

  // 等待二维码 PNG 生成（最长 15s；部分 CLI 也可能直接打印 URL）
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (existsSync(qrPath)) break
    if (activeAuthProcess !== child) break // 进程已退出
    await new Promise((resolve) => setTimeout(resolve, 300))
  }

  const qrDataUrl = existsSync(qrPath)
    ? `data:image/png;base64,${readFileSync(qrPath).toString('base64')}`
    : undefined

  return {
    url: extractAuthUrl(output),
    qrDataUrl,
    // 进程已退出且无二维码 → 大概率命令不支持该参数（如 --noninteractive）
    error: !qrDataUrl && activeAuthProcess !== child && !extractAuthUrl(output)
      ? `无法启动扫码（${cliCommand} auth init 退出）`
      : undefined,
  }
}

/** 实时检测 CLI 认证状态（不走 60s 缓存；授权过程需要最新结果） */
export async function cliAuthStatus(itemId: string): Promise<{ authenticated: boolean; error?: string }> {
  const item = findCliItem(itemId)
  if (!item || item.installKind !== 'cli' || !item.authCheckCommand) {
    return { authenticated: false, error: '条目不支持认证检测' }
  }
  try {
    const fast = await execAsync(item.authCheckCommand as string, { timeout: 4000 })
    const fastOut = fast.stdout ?? ''
    if (fastOut) {
      const failed = item.authFailPattern && fastOut.toLowerCase().includes(item.authFailPattern.toLowerCase())
      return { authenticated: !failed }
    }
    const slow = await execAsync(`zsh -ilc "${item.authCheckCommand}" 2>/dev/null`, { timeout: 8000 })
    const slowOut = slow.stdout ?? ''
    const failed = item.authFailPattern && slowOut.toLowerCase().includes(item.authFailPattern.toLowerCase())
    return { authenticated: Boolean(slowOut.trim()) && !failed }
  } catch {
    return { authenticated: false }
  }
}

/** 终止当前扫码授权进程（整组 SIGTERM，2s 后 SIGKILL 兜底）并清理临时目录 */
export async function cliAuthCancel(): Promise<void> {
  if (activeAuthProcess && activeAuthProcess.pid) {
    try { process.kill(-activeAuthProcess.pid, 'SIGTERM') } catch { /* 已退出 */ }
    // SIGKILL 兜底：wecom-cli 可能忽略 SIGTERM（node wrapper + 原生二进制）
    setTimeout(() => {
      if (activeAuthProcess?.pid) {
        try { process.kill(-(activeAuthProcess.pid as number), 'SIGKILL') } catch { /* 已退出 */ }
      }
    }, 2000).unref()
    activeAuthProcess = null
  }
  if (activeAuthDir) {
    try { rmSync(activeAuthDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
    activeAuthDir = null
  }
  activeAuthCommand = null
}
