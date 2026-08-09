/**
 * release-notes-service - 本地化版本历史服务
 *
 * 从 app bundle 的 resources/release-notes/*.md 读取版本历史，完全离线可用。
 * 开发模式读源码目录，打包模式读 process.resourcesPath/release-notes
 * （electron-builder extraResources 注入）。
 *
 * 同时将 bundle 内容同步到 ~/.myyoda/release-notes/，供其他场景复用。
 */

import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'fs'
import {
  parseReleaseVersion,
  compareReleaseSemver,
  type ReleaseNote,
} from '@myyoda/shared'

/** 是否为语义化版本文件名（如 "0.7.1.md"），排除 next.md 等辅助文件 */
const VERSION_FILE_RE = /^\d+\.\d+\.\d+\.md$/

/** 打包模式下 bundle 目录名（extraResources 的 to 值） */
const BUNDLED_DIR_NAME = 'release-notes'

/**
 * 解析 release notes bundle 目录绝对路径。
 * 打包模式：process.resourcesPath/release-notes
 * 开发模式：dist/resources/release-notes
 *
 * 注意：esbuild 把主进程全部代码打包进单个 dist/main.cjs，运行时 __dirname
 * 是 dist/ 目录本身，不是这个源文件在 src/ 下的原始路径。dev:electron 会先跑
 * build:resources 把 resources/ 复制到 dist/resources/，因此直接取
 * __dirname/resources 即可，不能按源码目录层级往上跳。
 */
function getBundledReleaseNotesDir(): string | undefined {
  const { app } = require('electron') as typeof import('electron')
  if (app.isPackaged) {
    return join(process.resourcesPath, BUNDLED_DIR_NAME)
  }
  return join(__dirname, 'resources', BUNDLED_DIR_NAME)
}

/** 读取 bundle 目录下的全部版本 md，返回 { filename → content } */
function loadBundledNotes(): Record<string, string> {
  const dir = getBundledReleaseNotesDir()
  const notes: Record<string, string> = {}
  if (!dir || !existsSync(dir)) {
    console.warn(`[release-notes] 未找到内置 release-notes 目录: ${dir ?? '(none)'}`)
    return notes
  }
  let files: string[]
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.md') && VERSION_FILE_RE.test(f))
  } catch (err) {
    console.warn('[release-notes] 读取 release-notes 目录失败:', err)
    return notes
  }
  for (const file of files) {
    try {
      notes[file] = readFileSync(join(dir, file), 'utf-8')
    } catch (err) {
      console.error(`[release-notes] 读取 ${file} 失败:`, err)
    }
  }
  return notes
}

let cachedNotes: Record<string, string> | null = null

function getNotes(): Record<string, string> {
  if (cachedNotes === null) cachedNotes = loadBundledNotes()
  return cachedNotes
}

/**
 * 获取版本历史列表（semver 降序，完整历史）。
 * 调用方可传 limit 截断（如「最新动态」只取 3 条）；不传时返回全部版本。
 */
export function getReleaseNotesList(limit?: number): ReleaseNote[] {
  const notes = getNotes()
  const list = Object.entries(notes)
    .map(([file, content]) => ({
      version: parseReleaseVersion(file),
      content,
    }))
    .sort((a, b) => compareReleaseSemver(a.version, b.version))
  return typeof limit === 'number' && limit >= 0 ? list.slice(0, limit) : list
}

/** 获取最新版本号 */
export function getLatestReleaseVersion(): string | undefined {
  return getReleaseNotesList()[0]?.version
}

/** 获取合并后的完整版本历史 Markdown（每条之间用 --- 分隔，自动补版本标题；不截断，含全部历史） */
export function getCombinedReleaseNotes(): string {
  return getReleaseNotesList()
    .map((n) => {
      if (!n.content.trimStart().startsWith('# ')) {
        return `# v${n.version}\n\n${n.content}`
      }
      return n.content
    })
    .join('\n\n---\n\n')
}

/** 初始化：将 bundle 的 release notes 同步到 ~/.myyoda/release-notes/ */
export function initializeReleaseNotes(): void {
  const { app } = require('electron') as typeof import('electron')
  const targetDir = join(app.getPath('userData'), 'release-notes')
  try {
    if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true })
    const notes = getNotes()
    for (const [file, content] of Object.entries(notes)) {
      writeFileSync(join(targetDir, file), content, 'utf-8')
    }
    console.log(`[release-notes] 已同步 ${Object.keys(notes).length} 条版本历史到 ${targetDir}`)
  } catch (err) {
    // 同步失败不影响主流程（渲染层直接读 bundle），仅告警
    console.warn('[release-notes] 同步到用户目录失败（忽略）:', err)
  }
}
