/**
 * Node.js 运行时检测模块
 *
 * 负责检测系统中 Node.js 的可用性和版本信息
 */

import { execSync, spawnSync } from 'child_process'
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import type { NodeRuntimeStatus } from '@myyoda/shared'
import { getNodeInstallPathFromRegistry, getRegistryPathFromRegistry } from './windows-env'

/**
 * 判断路径是否为 Bun 临时 node 兼容 shim（%TEMP%\bun-node-*）。
 * Bun 1.3+ 在 Windows 上会把 node wrapper（不支持 --version 等参数）
 * 注入到 PATH 最前面，命中它会导致误判“Node.js 已找到但无法执行”。
 */
function isBunNodeShimPath(p: string): boolean {
  const basename = p.split(/[\\/]/).filter(Boolean).pop() ?? ''
  return basename.toLowerCase().startsWith('bun-node-')
}

/**
 * 缓存一次可靠来源扫描结果（findNodePathFromReliableSources 涉及 reg query / readdir，
 * 检测失败时避免在 findNodePath 里被重复执行两次）。
 */
let reliableNodePath: string | null | undefined
function getReliableNodePath(): string | null {
  if (reliableNodePath === undefined) {
    reliableNodePath = findNodePathFromReliableSources()
  }
  return reliableNodePath
}

/**
 * 从系统 PATH 查找 Node.js
 *
 * @returns Node.js 可执行路径，如果未找到返回 null
 */
function findNodePath(): string | null {
  // Windows 上优先扫描注册表 / winget 等确定位置，避免依赖残缺 process.env.PATH。
  // `where node` 在 PATH 被 Bun shim 抢先时命中 bun-node-*（非真实 Node），
  // 且 existsSync 为 true 会被误当作 Node，因此这里先尝试可靠来源。
  if (process.platform === 'win32') {
    const reliable = getReliableNodePath()
    if (reliable) return reliable
  }

  try {
    const command = process.platform === 'win32' ? 'where node' : 'which node'

    const result = execSync(command, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    })

    const candidates = result.trim().split(/\r?\n/)
    for (const candidate of candidates) {
      const nodePath = candidate.trim()
      if (!nodePath || !existsSync(nodePath)) continue
      // 跳过 Bun 临时 node shim（不是真实 Node，--version 会报错）
      if (isBunNodeShimPath(nodePath)) continue
      return nodePath
    }
  } catch {
    // Node.js 未安装（或不在当前 PATH）
  }

  // 注：可靠来源已在函数开头查过一次并缓存（getReliableNodePath 内部 memo），
  // 此处无需重复调用——若开头未命中，这里重新查也只会拿到相同的缓存结果。

  return null
}

/**
 * Windows 上从可靠来源查找 Node.js（注册表、winget、用户 PATH 条目）。
 *
 * @returns Node.js 可执行路径，如果未找到返回 null
 */
function findNodePathFromReliableSources(): string | null {
  if (process.platform !== 'win32') return null

  const localAppData = process.env.LOCALAPPDATA
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
  const commonPaths: string[] = []

  // 从注册表读取 Node.js 安装路径
  const regInstallPath = getNodeInstallPathFromRegistry()
  if (regInstallPath) {
    commonPaths.push(join(regInstallPath, 'node.exe'))
  }

  // 常见包管理器的默认安装位置
  const scoop = process.env.SCOOP
  if (scoop) {
    commonPaths.push(
      join(scoop, 'apps', 'nodejs', 'current', 'node.exe'),
      join(scoop, 'apps', 'nodejs-lts', 'current', 'node.exe'),
      join(scoop, 'shims', 'node.exe'),
    )
  }
  if (localAppData) {
    commonPaths.push(
      join(localAppData, 'scoop', 'apps', 'nodejs', 'current', 'node.exe'),
      join(localAppData, 'scoop', 'apps', 'nodejs-lts', 'current', 'node.exe'),
    )
  }

  // Chocolatey 默认位置
  commonPaths.push(
    'C:\\ProgramData\\chocolatey\\bin\\node.exe',
  )

  // 官方安装器默认位置
  commonPaths.push(
    join(programFiles, 'nodejs', 'node.exe'),
    'C:\\Program Files (x86)\\nodejs\\node.exe',
  )

  // 用户 PATH 注册表中的 node.exe（覆盖便携版、自定义安装等非默认位置）。
  // 注册表是权威环境来源，比 process.env.PATH（可能残缺）更可靠。
  const registryPath = getRegistryPathFromRegistry()
  if (registryPath) {
    for (const entry of registryPath.split(';')) {
      const trimmed = entry.trim()
      if (!trimmed) continue
      // 排除 Bun 临时 node shim（不支持 --version 的兼容层，不是真实 Node）
      if (isBunNodeShimPath(trimmed)) continue
      commonPaths.push(join(trimmed, 'node.exe'))
    }
  }

  for (const path of commonPaths) {
    if (existsSync(path)) {
      return path
    }
  }

  // winget Packages 目录下可能有多个版本的 node（OpenJS.NodeJS.LTS_*\node-v*-win-x64\node.exe）
  if (localAppData) {
    const wingetPackages = join(localAppData, 'Microsoft', 'WinGet', 'Packages')
    if (existsSync(wingetPackages)) {
      try {
        const candidates: string[] = []
        for (const entry of readdirSyncSafe(wingetPackages)) {
          if (!/^OpenJS\.NodeJS/i.test(entry)) continue
          const pkgDir = join(wingetPackages, entry)
          for (const sub of readdirSyncSafe(pkgDir)) {
            const nodePath = join(pkgDir, sub, 'node.exe')
            if (existsSync(nodePath)) candidates.push(nodePath)
          }
        }
        // 优先选择版本号更高的 node（node-v24.19.0-win-x64 > node-v20.x）
        candidates.sort((a, b) => {
          const va = parseNodeVersionFromPath(a)
          const vb = parseNodeVersionFromPath(b)
          return vb - va
        })
        if (candidates.length > 0) return candidates[0]!
      } catch {
        // 扫描失败忽略
      }
    }
  }

  return null
}

/** 安全读取目录内容（失败返回空数组） */
function readdirSyncSafe(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

/** 从路径提取 node 版本号（node-v24.19.0-win-x64 → 24.19.0 → 数字比较） */
function parseNodeVersionFromPath(p: string): number {
  const m = p.match(/node-v(\d+)\.(\d+)\.(\d+)/)
  if (!m) return 0
  return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3])
}

/**
 * 获取 Node.js 版本号
 *
 * @param nodePath - Node.js 可执行路径
 * @returns 版本号，如果无法获取返回 null
 */
function getNodeVersion(nodePath: string): string | null {
  try {
    const result = spawnSync(nodePath, ['--version'], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    if (result.status === 0 && result.stdout) {
      // v22.13.1 -> 22.13.1
      const version = result.stdout.trim().replace(/^v/, '')
      return version
    }
  } catch {
    // 执行失败
  }

  return null
}

/**
 * 解析版本号为数字数组
 *
 * @param version - 版本号字符串（如 "22.13.1"）
 * @returns 数字数组 [22, 13, 1]
 */
function parseVersion(version: string): number[] {
  return version.split('.').map((n) => parseInt(n, 10))
}

/**
 * 比较版本号
 *
 * @param version - 当前版本
 * @param target - 目标版本
 * @returns 是否满足目标版本（>= target）
 */
function meetsVersion(version: string, target: string): boolean {
  const v = parseVersion(version)
  const t = parseVersion(target)

  for (let i = 0; i < Math.max(v.length, t.length); i++) {
    const vPart = v[i] || 0
    const tPart = t[i] || 0

    if (vPart > tPart) return true
    if (vPart < tPart) return false
  }

  return true // 版本相等
}

/**
 * 检测 Node.js 运行时状态
 *
 * @returns Node.js 运行时状态
 */
export async function detectNodeRuntime(): Promise<NodeRuntimeStatus> {
  console.log('[Node.js 检测] 开始检测 Node.js 运行时...')

  const nodePath = findNodePath()

  if (!nodePath) {
    console.warn('[Node.js 检测] 未找到 Node.js')
    return {
      available: false,
      version: null,
      path: null,
      error: '未找到 Node.js。请安装 Node.js 后重试。',
    }
  }

  const version = getNodeVersion(nodePath)

  if (!version) {
    console.warn(`[Node.js 检测] Node.js 无法执行: ${nodePath}`)
    return {
      available: false,
      version: null,
      path: nodePath,
      error: 'Node.js 已找到但无法执行',
    }
  }

  console.log(`[Node.js 检测] 找到 Node.js: ${nodePath} (${version})`)
  return {
    available: true,
    version,
    path: nodePath,
    error: null,
  }
}

/**
 * 检查 Node.js 版本是否满足要求
 *
 * @param version - Node.js 版本号
 * @param minimum - 最低版本（默认 18）
 * @param recommended - 推荐版本（默认 22）
 * @returns { meetsMinimum, meetsRecommended }
 */
export function checkNodeVersion(
  version: string,
  minimum = '18.0.0',
  recommended = '22.0.0'
): { meetsMinimum: boolean; meetsRecommended: boolean } {
  return {
    meetsMinimum: meetsVersion(version, minimum),
    meetsRecommended: meetsVersion(version, recommended),
  }
}
