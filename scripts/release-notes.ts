#!/usr/bin/env bun
/**
 * 发布说明同步脚本 —— 一份 markdown 正文同时写入两处消费方，避免漏写。
 *
 *   bun run release-notes <version> <content-file> [--force]
 *
 * <version>      语义化版本号，如 0.7.3（不带 v 前缀）
 * <content-file> 本次版本说明正文（markdown），可带 "# MyYoda vX.Y.Z 更新" 标题，缺失会自动补上
 * --force        bundled 版本文件已存在时允许覆盖（默认拒绝，避免误改历史版本说明）
 *
 * 写入：
 *   - apps/electron/RELEASE_NOTES.md                     覆盖，供 GitHub Release 页面使用
 *   - apps/electron/resources/release-notes/{version}.md 新建，供应用内「关于/版本历史」使用
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const repoRoot = join(import.meta.dir, '..')
const force = process.argv.includes('--force')
const [version, contentFile] = process.argv.slice(2).filter((a) => a !== '--force')

if (!version || !contentFile) {
  console.error('用法: bun run release-notes <version> <content-file> [--force]')
  process.exit(1)
}

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`版本号格式错误："${version}"，应为 X.Y.Z（不带 v 前缀）`)
  process.exit(1)
}

if (!existsSync(contentFile)) {
  console.error(`找不到内容文件: ${contentFile}`)
  process.exit(1)
}

const appPackageJsonPath = join(repoRoot, 'apps/electron/package.json')
const appVersion = JSON.parse(readFileSync(appPackageJsonPath, 'utf-8')).version as string
if (appVersion !== version) {
  console.warn(
    `⚠️  apps/electron/package.json 当前版本是 ${appVersion}，与传入的 ${version} 不一致（如果还没 bump，先改 package.json 再跑本脚本）`
  )
}

let content = readFileSync(contentFile, 'utf-8').trimEnd() + '\n'
if (!content.startsWith('# ')) {
  content = `# MyYoda v${version} 更新\n\n${content}`
}

const releaseNotesPath = join(repoRoot, 'apps/electron/RELEASE_NOTES.md')
const bundledPath = join(repoRoot, 'apps/electron/resources/release-notes', `${version}.md`)

if (existsSync(bundledPath) && !force) {
  console.error(`${bundledPath} 已存在，如需覆盖请加 --force`)
  process.exit(1)
}

writeFileSync(releaseNotesPath, content, 'utf-8')
writeFileSync(bundledPath, content, 'utf-8')

console.log('已写入:')
console.log(`  - ${releaseNotesPath}（GitHub Release 说明，覆盖）`)
console.log(`  - ${bundledPath}（应用内版本历史，${force ? '已强制覆盖' : '新建'}）`)
