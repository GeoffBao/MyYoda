import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import { WASM_DIR } from './constants';
import logger from './logger';

const LANGUAGE_WASM_MAP: Record<string, { url: string; urls: string[]; file: string }> = {
  python: {
        url: 'https://unpkg.com/tree-sitter-python/tree-sitter-python.wasm',
    urls: [
      'https://unpkg.com/tree-sitter-python/tree-sitter-python.wasm',
      'https://cdn.jsdelivr.net/npm/tree-sitter-python/tree-sitter-python.wasm',
      'https://fastly.jsdelivr.net/npm/tree-sitter-python/tree-sitter-python.wasm',
    ],
    file: 'tree-sitter-python.wasm',
  },
  javascript: {
        url: 'https://unpkg.com/tree-sitter-javascript/tree-sitter-javascript.wasm',
    urls: [
      'https://unpkg.com/tree-sitter-javascript/tree-sitter-javascript.wasm',
      'https://cdn.jsdelivr.net/npm/tree-sitter-javascript/tree-sitter-javascript.wasm',
      'https://fastly.jsdelivr.net/npm/tree-sitter-javascript/tree-sitter-javascript.wasm',
    ],
    file: 'tree-sitter-javascript.wasm',
  },
  typescript: {
        url: 'https://unpkg.com/tree-sitter-typescript/tree-sitter-typescript.wasm',
    urls: [
      'https://unpkg.com/tree-sitter-typescript/tree-sitter-typescript.wasm',
      'https://cdn.jsdelivr.net/npm/tree-sitter-typescript/tree-sitter-typescript.wasm',
      'https://fastly.jsdelivr.net/npm/tree-sitter-typescript/tree-sitter-typescript.wasm',
    ],
    file: 'tree-sitter-typescript.wasm',
  },
  tsx: {
        url: 'https://unpkg.com/tree-sitter-typescript/tree-sitter-tsx.wasm',
    urls: [
      'https://unpkg.com/tree-sitter-typescript/tree-sitter-tsx.wasm',
      'https://cdn.jsdelivr.net/npm/tree-sitter-typescript/tree-sitter-tsx.wasm',
      'https://fastly.jsdelivr.net/npm/tree-sitter-typescript/tree-sitter-tsx.wasm',
    ],
    file: 'tree-sitter-tsx.wasm',
  },
  java: {
        url: 'https://unpkg.com/tree-sitter-java/tree-sitter-java.wasm',
    urls: [
      'https://unpkg.com/tree-sitter-java/tree-sitter-java.wasm',
      'https://cdn.jsdelivr.net/npm/tree-sitter-java/tree-sitter-java.wasm',
      'https://fastly.jsdelivr.net/npm/tree-sitter-java/tree-sitter-java.wasm',
    ],
    file: 'tree-sitter-java.wasm',
  },
  go: {
        url: 'https://unpkg.com/tree-sitter-go/tree-sitter-go.wasm',
    urls: [
      'https://unpkg.com/tree-sitter-go/tree-sitter-go.wasm',
      'https://cdn.jsdelivr.net/npm/tree-sitter-go/tree-sitter-go.wasm',
      'https://fastly.jsdelivr.net/npm/tree-sitter-go/tree-sitter-go.wasm',
    ],
    file: 'tree-sitter-go.wasm',
  },
  rust: {
        url: 'https://unpkg.com/tree-sitter-rust/tree-sitter-rust.wasm',
    urls: [
      'https://unpkg.com/tree-sitter-rust/tree-sitter-rust.wasm',
      'https://cdn.jsdelivr.net/npm/tree-sitter-rust/tree-sitter-rust.wasm',
      'https://fastly.jsdelivr.net/npm/tree-sitter-rust/tree-sitter-rust.wasm',
    ],
    file: 'tree-sitter-rust.wasm',
  },
  c: {
        url: 'https://unpkg.com/tree-sitter-c/tree-sitter-c.wasm',
    urls: [
      'https://unpkg.com/tree-sitter-c/tree-sitter-c.wasm',
      'https://cdn.jsdelivr.net/npm/tree-sitter-c/tree-sitter-c.wasm',
      'https://fastly.jsdelivr.net/npm/tree-sitter-c/tree-sitter-c.wasm',
    ],
    file: 'tree-sitter-c.wasm',
  },
  cpp: {
        url: 'https://unpkg.com/tree-sitter-cpp/tree-sitter-cpp.wasm',
    urls: [
      'https://unpkg.com/tree-sitter-cpp/tree-sitter-cpp.wasm',
      'https://cdn.jsdelivr.net/npm/tree-sitter-cpp/tree-sitter-cpp.wasm',
      'https://fastly.jsdelivr.net/npm/tree-sitter-cpp/tree-sitter-cpp.wasm',
    ],
    file: 'tree-sitter-cpp.wasm',
  },
  ruby: {
        url: 'https://unpkg.com/tree-sitter-ruby/tree-sitter-ruby.wasm',
    urls: [
      'https://unpkg.com/tree-sitter-ruby/tree-sitter-ruby.wasm',
      'https://cdn.jsdelivr.net/npm/tree-sitter-ruby/tree-sitter-ruby.wasm',
      'https://fastly.jsdelivr.net/npm/tree-sitter-ruby/tree-sitter-ruby.wasm',
    ],
    file: 'tree-sitter-ruby.wasm',
  },
  php: {
        url: 'https://unpkg.com/tree-sitter-php/tree-sitter-php.wasm',
    urls: [
      'https://unpkg.com/tree-sitter-php/tree-sitter-php.wasm',
      'https://cdn.jsdelivr.net/npm/tree-sitter-php/tree-sitter-php.wasm',
      'https://fastly.jsdelivr.net/npm/tree-sitter-php/tree-sitter-php.wasm',
    ],
    file: 'tree-sitter-php.wasm',
  },
  scala: {
        url: 'https://unpkg.com/tree-sitter-scala/tree-sitter-scala.wasm',
    urls: [
      'https://unpkg.com/tree-sitter-scala/tree-sitter-scala.wasm',
      'https://cdn.jsdelivr.net/npm/tree-sitter-scala/tree-sitter-scala.wasm',
      'https://fastly.jsdelivr.net/npm/tree-sitter-scala/tree-sitter-scala.wasm',
    ],
    file: 'tree-sitter-scala.wasm',
  },
  dart: {
        url: 'https://unpkg.com/tree-sitter-dart/tree-sitter-dart.wasm',
    urls: [
      'https://unpkg.com/tree-sitter-dart/tree-sitter-dart.wasm',
      'https://cdn.jsdelivr.net/npm/tree-sitter-dart/tree-sitter-dart.wasm',
      'https://fastly.jsdelivr.net/npm/tree-sitter-dart/tree-sitter-dart.wasm',
    ],
    file: 'tree-sitter-dart.wasm',
  },
  ocaml: {
        url: 'https://unpkg.com/tree-sitter-ocaml/tree-sitter-ocaml.wasm',
    urls: [
      'https://unpkg.com/tree-sitter-ocaml/tree-sitter-ocaml.wasm',
      'https://cdn.jsdelivr.net/npm/tree-sitter-ocaml/tree-sitter-ocaml.wasm',
      'https://fastly.jsdelivr.net/npm/tree-sitter-ocaml/tree-sitter-ocaml.wasm',
    ],
    file: 'tree-sitter-ocaml.wasm',
  },
  ocaml_interface: {
        url: 'https://unpkg.com/tree-sitter-ocaml/tree-sitter-ocaml_interface.wasm',
    urls: [
      'https://unpkg.com/tree-sitter-ocaml/tree-sitter-ocaml_interface.wasm',
      'https://cdn.jsdelivr.net/npm/tree-sitter-ocaml/tree-sitter-ocaml_interface.wasm',
      'https://fastly.jsdelivr.net/npm/tree-sitter-ocaml/tree-sitter-ocaml_interface.wasm',
    ],
    file: 'tree-sitter-ocaml_interface.wasm',
  },
  c_sharp: {
        url: 'https://unpkg.com/tree-sitter-c-sharp/tree-sitter-c_sharp.wasm',
    urls: [
      'https://unpkg.com/tree-sitter-c-sharp/tree-sitter-c_sharp.wasm',
      'https://cdn.jsdelivr.net/npm/tree-sitter-c-sharp/tree-sitter-c_sharp.wasm',
      'https://fastly.jsdelivr.net/npm/tree-sitter-c-sharp/tree-sitter-c_sharp.wasm',
    ],
    file: 'tree-sitter-c_sharp.wasm',
  },
  haskell: {
        url: 'https://unpkg.com/tree-sitter-haskell/tree-sitter-haskell.wasm',
    urls: [
      'https://unpkg.com/tree-sitter-haskell/tree-sitter-haskell.wasm',
      'https://cdn.jsdelivr.net/npm/tree-sitter-haskell/tree-sitter-haskell.wasm',
      'https://fastly.jsdelivr.net/npm/tree-sitter-haskell/tree-sitter-haskell.wasm',
    ],
    file: 'tree-sitter-haskell.wasm',
  },
  julia: {
        url: 'https://unpkg.com/tree-sitter-julia/tree-sitter-julia.wasm',
    urls: [
      'https://unpkg.com/tree-sitter-julia/tree-sitter-julia.wasm',
      'https://cdn.jsdelivr.net/npm/tree-sitter-julia/tree-sitter-julia.wasm',
      'https://fastly.jsdelivr.net/npm/tree-sitter-julia/tree-sitter-julia.wasm',
    ],
    file: 'tree-sitter-julia.wasm',
  },
}

/** 下载失败冷却：24h 内不重试（避免每次生成都卡网络） */
const WASM_DOWNLOAD_COOLDOWN_MS = 24 * 60 * 60 * 1000
/** 单源下载超时 */
const WASM_DOWNLOAD_TIMEOUT_MS = 10_000
/** 语言 → 最近失败时间（内存） */
const wasmDownloadCooldown = new Map<string, number>()

/**
 * 下载/加载语言 grammar WASM。
 *
 * 优先级：内置 WASM（resources/repo-map/wasm）→ 本地缓存（~/.myyoda/cache/tree-sitter）→ 网络下载（多源轮询）。
 */
export async function downloadWasmForLanguage(language: string): Promise<Buffer | null> {
  const config = LANGUAGE_WASM_MAP[language]
  if (!config) {
    logger.warn(`No WASM configuration for language: ${language}`)
    return null
  }

  // 1. 内置 WASM（随安装包分发，离线可用）
  try {
    const bundledPath = path.join(WASM_DIR, config.file)
    const bundled = await fs.readFile(bundledPath)
    logger.debug(`Loaded WASM for ${language} from bundled resources`)
    return bundled
  } catch {
    // not bundled, continue
  }

  // 2. 本地缓存（之前下载过的）
  const cacheDir = path.join(os.homedir(), '.myyoda', 'cache', 'tree-sitter')
  const wasmPath = path.join(cacheDir, config.file)
  try {
    const cached = await fs.readFile(wasmPath)
    logger.debug(`Loaded WASM for ${language} from cache: ${wasmPath}`)
    return cached
  } catch {
    // not cached
  }

  // 3. 网络下载（仅在线环境兜底）：多源轮询 + 超时 + 失败冷却
  // 冷却：某语言 24h 内下载失败不再重试（避免每次生成都卡网络 + 日志噪音）
  const now = Date.now()
  const lastFailure = wasmDownloadCooldown.get(language)
  if (lastFailure && now - lastFailure < WASM_DOWNLOAD_COOLDOWN_MS) {
    logger.debug(`[Wasm] ${language} 下载处于冷却期（24h），跳过网络请求`)
    return null
  }

  const sources = config.urls ?? [config.url]
  for (const source of sources) {
    try {
      logger.info(`Downloading WASM for ${language} from ${source}`)
      const response = await fetch(source, {
        redirect: 'follow',
        signal: AbortSignal.timeout(WASM_DOWNLOAD_TIMEOUT_MS),
      })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`)
      }
      const buffer = Buffer.from(await response.arrayBuffer())
      // 有效性自检：wasm 魔数（\0asm）
      if (buffer.length < 8 || buffer.subarray(0, 4).toString('latin1') !== '\0asm') {
        throw new Error('下载内容不是有效 WASM（缺少 \\0asm 魔数）')
      }
      await fs.mkdir(cacheDir, { recursive: true })
      await fs.writeFile(wasmPath, buffer)
      logger.info(`Downloaded and cached WASM for ${language} (${Math.round(buffer.byteLength / 1024)} KB) from ${source}`)
      return buffer
    } catch (error) {
      logger.warn(`Failed to download WASM for ${language} from ${source}:`, error)
    }
  }
  wasmDownloadCooldown.set(language, Date.now())
  logger.error(`All ${sources.length} sources failed for WASM ${language}; entering 24h cooldown`)
  return null
}

export function getLanguageWasmConfig(language: string): { url: string; file: string } | null {
  return LANGUAGE_WASM_MAP[language] || null
}

export function getSupportedLanguagesForWasm(): string[] {
  return Object.keys(LANGUAGE_WASM_MAP)
}
