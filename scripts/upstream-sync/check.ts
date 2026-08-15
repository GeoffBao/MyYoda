#!/usr/bin/env bun
/**
 * Proma upstream 同步后门禁。
 *
 * 检查：
 * 1. rename 残留（@proma / ~/.proma / Codex-agent-sdk 等）
 * 2. SDK 版本一致性（Pi runtime 包：deps / overrides / electron-builder / esbuild external）
 * 3. default-skills version frontmatter；可选对比 upstream
 *
 *   bun run sync:check
 *   bun run sync:check -- --skills-upstream
 *   bun run sync:check -- --strict-docs   # 文档类残留也当 error
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { $ } from 'bun'
import {
  compareSemver,
  isAllowlisted,
  isWarnOnly,
  loadRenameMap,
  parseSkillVersionFromContent,
  printFindings,
  readText,
  repoRoot,
  type Finding,
  walkFiles,
} from './shared.ts'

const args = new Set(process.argv.slice(2))
const skillsUpstream = args.has('--skills-upstream')
const strictDocs = args.has('--strict-docs')

const map = loadRenameMap()
const root = repoRoot()
const findings: Finding[] = []

function add(f: Finding): void {
  findings.push(f)
}

// ── 1. rename 残留 ──────────────────────────────────────────────

const compiled = map.forbiddenPatterns.map((p) => ({
  ...p,
  re: new RegExp(p.regex, 'g'),
}))

for (const full of walkFiles(root, map)) {
  const rel = relative(root, full)
  if (isAllowlisted(rel, map)) continue

  const text = readText(full)
  if (text === null) continue

  const lines = text.split('\n')
  for (const pattern of compiled) {
    pattern.re.lastIndex = 0
    for (let i = 0; i < lines.length; i++) {
      pattern.re.lastIndex = 0
      if (!pattern.re.test(lines[i]!)) continue
      const warnDoc = isWarnOnly(rel, map) && !strictDocs
      add({
        severity: warnDoc ? 'warn' : 'error',
        check: `rename/${pattern.id}`,
        file: rel,
        line: i + 1,
        message: pattern.message,
      })
    }
  }
}

// ── 2. SDK 版本一致性 ───────────────────────────────────────────

interface PkgJson {
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  overrides?: Record<string, string>
  scripts?: Record<string, string>
}

function readJson(path: string): PkgJson | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as PkgJson
  } catch {
    return null
  }
}

const electronPkgPath = join(root, 'apps/electron/package.json')
const rootPkgPath = join(root, 'package.json')
const electronPkg = readJson(electronPkgPath)
const rootPkg = readJson(rootPkgPath)

// Claude runtime 已于 2026-08 退役，@anthropic-ai/claude-agent-sdk 全量移除；
// 门禁改为校验 Pi runtime 包（@earendil-works/pi-*）的版本一致性与打包覆盖。
const PI_SDK_PACKAGES = [
  '@earendil-works/pi-agent-core',
  '@earendil-works/pi-ai',
  '@earendil-works/pi-coding-agent',
  '@earendil-works/pi-tui',
]
// esbuild --external 只覆盖这 3 个包；pi-tui 含 native 模块，不走 esbuild external
// （随 node_modules 打包），因此显式列出子集而非按位置 slice，避免顺序调整时静默漏检。
const PI_SDK_ESBUILD_EXTERNAL_PACKAGES = [
  '@earendil-works/pi-agent-core',
  '@earendil-works/pi-ai',
  '@earendil-works/pi-coding-agent',
]

const sdkMain = '@earendil-works/pi-coding-agent'
const pinned = electronPkg?.dependencies?.[sdkMain]

if (!pinned) {
  add({
    severity: 'error',
    check: 'sdk/pin',
    file: 'apps/electron/package.json',
    message: `缺少 dependencies["${sdkMain}"]`,
  })
} else {
  const overrides = rootPkg?.overrides ?? {}
  for (const key of PI_SDK_PACKAGES) {
    const v = overrides[key]
    if (!v) {
      add({
        severity: 'error',
        check: 'sdk/overrides',
        file: 'package.json',
        message: `overrides 未钉住 ${key}`,
      })
    } else if (v !== pinned) {
      add({
        severity: 'error',
        check: 'sdk/overrides',
        file: 'package.json',
        message: `overrides["${key}"]=${v} 与主包 ${pinned} 不一致`,
      })
    }
  }

  // esbuild external
  const scripts = electronPkg?.scripts ?? {}
  for (const [name, cmd] of Object.entries(scripts)) {
    if (!name.startsWith('build:main') && !name.startsWith('watch:main')) continue
    if (cmd.includes('Codex-agent-sdk') || cmd.includes('claude-agent-sdk')) {
      add({
        severity: 'error',
        check: 'sdk/esbuild',
        file: 'apps/electron/package.json',
        message: `${name} 仍 external 了已退役的 claude-agent-sdk`,
      })
    }
    for (const pkg of PI_SDK_ESBUILD_EXTERNAL_PACKAGES) {
      if (!cmd.includes(`--external:${pkg}`)) {
        add({
          severity: 'error',
          check: 'sdk/esbuild',
          file: 'apps/electron/package.json',
          message: `${name} 未 --external:${pkg}`,
        })
      }
    }
  }

  // electron-builder.yml files
  const builderPath = join(root, 'apps/electron/electron-builder.yml')
  if (!existsSync(builderPath)) {
    add({
      severity: 'error',
      check: 'sdk/builder',
      file: 'apps/electron/electron-builder.yml',
      message: '找不到 electron-builder.yml',
    })
  } else {
    const yml = readFileSync(builderPath, 'utf-8')
    if (yml.includes('claude-agent-sdk') || yml.includes('Codex-agent-sdk')) {
      add({
        severity: 'error',
        check: 'sdk/builder',
        file: 'apps/electron/electron-builder.yml',
        message: '仍引用已退役的 claude-agent-sdk',
      })
    }
    // 旧 @proma 排除应变为 @myyoda
    if (yml.includes('!node_modules/@proma/**')) {
      add({
        severity: 'error',
        check: 'sdk/builder',
        file: 'apps/electron/electron-builder.yml',
        message: '仍排除 @proma/**，应改为 @myyoda/**',
      })
    }
  }

  // 文档里的 SDK 版本号：Pi-only 后文档不应再标注 claude-agent-sdk 版本（warn；--strict-docs 升 error）
  for (const doc of ['CLAUDE.md', 'AGENTS.md']) {
    const path = join(root, doc)
    if (!existsSync(path)) continue
    const text = readFileSync(path, 'utf-8')
    const mentions = [...text.matchAll(/claude-agent-sdk@(\d+\.\d+\.\d+)/g)].map((m) => m[1]!)
    const tableMentions = [...text.matchAll(/claude-agent-sdk\s*\|\s*(\d+\.\d+\.\d+)/g)].map(
      (m) => m[1]!,
    )
    const versions = [...new Set([...mentions, ...tableMentions])]
    for (const v of versions) {
      add({
        severity: strictDocs ? 'error' : 'warn',
        check: 'sdk/docs',
        file: doc,
        message: `文档仍标注已退役的 claude-agent-sdk ${v}`,
      })
    }
    if (/Codex-agent-sdk/.test(text)) {
      add({
        severity: strictDocs ? 'error' : 'warn',
        check: 'sdk/docs',
        file: doc,
        message: '文档残留 Codex-agent-sdk 错写',
      })
    }
  }
}

// ── 3. default-skills version ───────────────────────────────────

const skillsRoot = join(root, 'apps/electron/default-skills')
if (existsSync(skillsRoot)) {
  const skillDirs = readdirSync(skillsRoot, { withFileTypes: true }).filter((d) => d.isDirectory())

  for (const dir of skillDirs) {
    const skillMd = join(skillsRoot, dir.name, 'SKILL.md')
    const rel = relative(root, skillMd)
    if (!existsSync(skillMd)) {
      add({
        severity: 'error',
        check: 'skills/missing',
        file: relative(root, join(skillsRoot, dir.name)),
        message: '缺少 SKILL.md',
      })
      continue
    }

    const content = readFileSync(skillMd, 'utf-8')
    const version = parseSkillVersionFromContent(content)
    if (version === '0.0.0') {
      add({
        severity: 'error',
        check: 'skills/version',
        file: rel,
        message: 'frontmatter 缺少 version（老用户升级契约会失效）',
      })
    }

    if (!skillsUpstream) continue
    if (map.luxOnlySkills.includes(dir.name)) continue

    // 对比 upstream/main 同名 skill version
    try {
      const upPath = `apps/electron/default-skills/${dir.name}/SKILL.md`
      const result = await $`git show upstream/main:${upPath}`.quiet().nothrow()
      if (result.exitCode !== 0) continue
      const upContent = result.stdout.toString('utf-8')
      const upVersion = parseSkillVersionFromContent(upContent)
      if (compareSemver(upVersion, version) > 0) {
        add({
          severity: 'warn',
          check: 'skills/upstream',
          file: rel,
          message: `upstream version ${upVersion} > local ${version}，同步内容后记得 bump version`,
        })
      } else if (
        compareSemver(upVersion, version) === 0 &&
        normalizeSkillBody(upContent) !== normalizeSkillBody(content)
      ) {
        add({
          severity: 'warn',
          check: 'skills/upstream',
          file: rel,
          message: `与 upstream 内容不同但 version 同为 ${version}；若已合入上游改动必须 bump version`,
        })
      }
    } catch {
      // upstream 不可用时跳过
    }
  }
} else {
  add({
    severity: 'error',
    check: 'skills/root',
    message: '找不到 apps/electron/default-skills/',
  })
}

/** 去掉 frontmatter 与空白后比较正文，减少品牌替换噪声误报 */
function normalizeSkillBody(content: string): string {
  let text = content
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  text = text.replace(/^---\s*\n[\s\S]*?\n---\s*/, '')
  // 忽略已知品牌差异
  text = text
    .replace(/~\/\.proma/g, '~/.myyoda')
    .replace(/~\/\.myyoda/g, '~/.myyoda')
    .replace(/@proma\//g, '@myyoda/')
    .replace(/Proma/g, 'MyYoda')
    .replace(/\s+/g, ' ')
    .trim()
  return text
}

// ── 输出 ────────────────────────────────────────────────────────

printFindings(findings)
const errors = findings.filter((f) => f.severity === 'error')
if (errors.length > 0) {
  console.log('失败。先 bun run sync:apply-renames -- --write，再修剩余项。')
  process.exit(1)
}
console.log('通过。')
if (!skillsUpstream) {
  console.log('提示: 加 --skills-upstream 可对比 upstream/main 的 skill version')
}
