import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';

// esbuild cjs 输出下 import.meta 为空，需优先用 __dirname（打包版 Node 环境）
const require = createRequire(typeof __dirname !== 'undefined' ? __dirname : import.meta.url)

/**
 * 解析 MyYoda 内置 repo-map 资源目录（queries / wasm）。
 *
 * 优先级：
 * 1. 打包版：process.resourcesPath/repo-map（electron-builder extraResources）
 * 2. 开发/构建产物：<dist 或源码>/resources/repo-map（build:resources 拷贝）
 */
export function resolveRepoMapResourcesDir(): string {
  const candidates: string[] = []

  // Electron 打包环境（process.resourcesPath 由 Electron 注入）
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'repo-map'))
  }

  // 主进程 bundle 产物目录（dev: apps/electron/dist/resources；watch 模式产物）
  if (typeof __dirname !== 'undefined') {
    candidates.push(path.join(__dirname, '..', 'resources', 'repo-map'))
    candidates.push(path.join(__dirname, 'resources', 'repo-map'))
  }

  // 源码目录（bun test 直接跑 TS 时兜底）
  candidates.push(path.join(__dirname, '..', '..', '..', '..', '..', '..', 'resources', 'repo-map'))

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(path.join(candidate, 'queries'))) {
        return candidate
      }
    } catch {
      // ignore
    }
  }

  // 兜底：返回第一个候选（调用方会报错）
  return candidates[0] ?? path.join(process.cwd(), 'resources', 'repo-map')
}

const repoMapResourcesDir = resolveRepoMapResourcesDir()

export const RESOURCES_DIR = repoMapResourcesDir
export const QUERIES_DIR = path.join(repoMapResourcesDir, 'queries')
export const WASM_DIR = path.join(repoMapResourcesDir, 'wasm')

/**
 * 定位 web-tree-sitter 核心 WASM（Parser.init 的 locateFile 使用）。
 *
 * 优先级：内置资源（resources/repo-map/wasm/tree-sitter.wasm）→ node_modules 包内文件（dev）。
 */
export function resolveCoreWasmPath(): string | undefined {
  const bundled = path.join(WASM_DIR, 'tree-sitter.wasm')
  try {
    if (fs.existsSync(bundled)) return bundled
  } catch {
    // ignore
  }

  // dev 兜底：从 web-tree-sitter npm 包读取
  try {
    const pkgRoot = require.resolve('web-tree-sitter/package.json')
    const pkgDir = path.dirname(pkgRoot)
    const pkgWasm = path.join(pkgDir, 'tree-sitter.wasm')
    if (fs.existsSync(pkgWasm)) return pkgWasm
  } catch {
    // ignore
  }

  return undefined
}
