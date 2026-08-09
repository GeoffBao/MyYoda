/**
 * GitHub CLI（gh）检测模块
 *
 * 仅用于「上传本地 Skill 到社区市场」功能：检测本机是否已安装并登录 gh，
 * 不在 MyYoda 内存储任何 GitHub 凭证，所有鉴权都由用户本机的 `gh auth login` 完成。
 */

import { execSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { GhCliStatus } from '@myyoda/shared'

/** 从系统 PATH 查找 gh 可执行路径 */
function findGhPath(): string | null {
  try {
    const command = process.platform === 'win32' ? 'where gh' : 'which gh'
    const result = execSync(command, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    })
    const ghPath = result.trim().split('\n')[0]
    if (ghPath && existsSync(ghPath)) return ghPath
  } catch {
    // gh 未安装或不在 PATH 中
  }
  return null
}

function getGhVersion(ghPath: string): string | undefined {
  try {
    const result = spawnSync(ghPath, ['--version'], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    if (result.status === 0 && result.stdout) {
      const match = result.stdout.match(/gh version (\S+)/)
      return match ? match[1] : result.stdout.trim().split('\n')[0]
    }
  } catch {
    // 忽略
  }
  return undefined
}

/** 检测是否已通过 `gh auth login` 登录 github.com，登录则返回用户名 */
function getGhLogin(ghPath: string): string | null {
  try {
    const authResult = spawnSync(ghPath, ['auth', 'status', '--hostname', 'github.com'], {
      encoding: 'utf-8',
      timeout: 8000,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    if (authResult.status !== 0) return null

    const loginResult = spawnSync(ghPath, ['api', 'user', '--jq', '.login'], {
      encoding: 'utf-8',
      timeout: 8000,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    if (loginResult.status === 0 && loginResult.stdout) {
      const login = loginResult.stdout.trim()
      return login || null
    }
    return null
  } catch {
    return null
  }
}

// getGhCliStatus 每次调用都是同步阻塞主进程的子进程调用，且 `gh auth status` /
// `gh api user` 各是一次真实网络请求。PR 面板每次挂载/刷新、每个 PR 操作前置校验
// 都会调一次，短时间内会重复触发多次网络往返（阻塞整个主进程），做一个短 TTL 缓存
// 摊掉这些重复调用——gh 的安装/登录状态在几十秒内基本不会变化。
const GH_STATUS_CACHE_TTL_MS = 30_000
let cachedGhStatus: { status: GhCliStatus; expiresAt: number } | null = null

function computeGhCliStatus(): GhCliStatus {
  const ghPath = findGhPath()
  if (!ghPath) {
    return { installed: false, authenticated: false }
  }

  const version = getGhVersion(ghPath)
  const login = getGhLogin(ghPath)

  return {
    installed: true,
    version,
    authenticated: !!login,
    login: login ?? undefined,
  }
}

/** 检测本机 gh CLI 的安装 / 登录状态（短 TTL 缓存，避免高频重复网络往返） */
export function getGhCliStatus(): GhCliStatus {
  const now = Date.now()
  if (cachedGhStatus && cachedGhStatus.expiresAt > now) {
    return cachedGhStatus.status
  }
  const status = computeGhCliStatus()
  cachedGhStatus = { status, expiresAt: now + GH_STATUS_CACHE_TTL_MS }
  return status
}

/** 供提交服务复用的 gh 可执行路径解析（未安装时抛错） */
export function resolveGhPath(): string {
  const ghPath = findGhPath()
  if (!ghPath) {
    throw new Error('未检测到 gh（GitHub CLI），请先安装：https://cli.github.com/')
  }
  return ghPath
}
