/**
 * 社区市场投稿服务：把本地 Skill 提交回 MyYoda 私有市场（GeoffBao/myyoda-skills）
 *
 * 全程通过用户本机已登录的 `gh`（GitHub CLI）完成 fork / clone / commit / push / 建 PR，
 * MyYoda 不存储任何 GitHub 凭证。流程：
 * 1. 校验 gh 已安装且已登录（见 gh-cli.ts）
 * 2. fork 市场仓库到用户账号下（幂等）并尽力同步到上游最新
 * 3. 克隆 fork 到临时目录，新建分支
 * 4. 拷贝本地 Skill 目录到 skills/<slug>/，剔除本地专属的 .source.json
 * 5. 在 sources.yaml 末尾追加一条新 skill 清单条目
 * 6. 提交、推送分支，`gh pr create` 向上游开 PR
 */

import { existsSync, readFileSync, writeFileSync, cpSync, rmSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { SkillSubmissionInput, SkillSubmissionResult } from '@myyoda/shared'
import { getWorkspaceSkillsDir } from './config-paths'
import { getGhCliStatus, resolveGhPath } from './gh-cli'

/** MyYoda 私有市场仓库，需与 community-skill-service.ts 的 COMMUNITY_MARKET.repo 保持一致 */
const MARKET_REPO = 'GeoffBao/myyoda-skills'
const MARKET_BASE_BRANCH = 'main'

// ===== 纯函数：YAML 条目 / 分支名 / PR 文案（可单测） =====

export interface SourcesYamlEntryInput {
  name: string
  description: string
  category: string
  /** 仓库内相对路径，如 skills/my-skill */
  path: string
  license: string
  homepage?: string
}

/** 判断字符串是否需要 YAML 双引号包裹才能安全作为明文标量 */
function needsYamlQuoting(value: string): boolean {
  if (!value) return true
  if (/^\s|\s$/.test(value)) return true
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(value)) return true
  if (/:(\s|$)/.test(value)) return true
  if (/#/.test(value)) return true
  return false
}

function yamlScalar(value: string): string {
  if (!needsYamlQuoting(value)) return value
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** 生成一条追加到 sources.yaml 末尾的 skill 条目文本（2 空格缩进，与既有条目风格一致） */
export function buildSourcesYamlEntry(entry: SourcesYamlEntryInput): string {
  const lines = [
    `  - name: ${yamlScalar(entry.name)}`,
    `    description: ${yamlScalar(entry.description)}`,
    `    target:`,
    `      category: ${yamlScalar(entry.category)}`,
    `      path: ${entry.path}`,
    `    license: ${yamlScalar(entry.license)}`,
  ]
  if (entry.homepage) lines.push(`    homepage: ${entry.homepage}`)
  return lines.join('\n') + '\n'
}

/** 生成本次提交使用的分支名，slug 中的非法字符会被替换 */
export function buildBranchName(slug: string): string {
  const safeSlug = slug.replace(/[^a-zA-Z0-9-]/g, '-')
  return `add-skill-${safeSlug}-${Math.floor(Date.now() / 1000)}`
}

/** 生成 PR 标题与正文 */
export function buildPrTitleAndBody(entry: { name: string; slug: string; description: string }): { title: string; body: string } {
  const title = `feat(skills): add ${entry.slug}`
  const body = [
    `## 新增 Skill：${entry.name}`,
    '',
    entry.description,
    '',
    '通过 MyYoda 客户端「上传到社区市场」功能自动提交。',
  ].join('\n')
  return { title, body }
}

// ===== 本地 Skill 校验 =====

interface LocalSkillFrontmatter {
  name: string
  description: string
}

/** 读取本地 SKILL.md 的 name / description（缺失即视为不可提交） */
function readLocalSkillFrontmatter(skillDir: string): LocalSkillFrontmatter {
  const skillMdPath = join(skillDir, 'SKILL.md')
  if (!existsSync(skillMdPath)) {
    throw new Error('Skill 缺少 SKILL.md，无法提交')
  }
  const content = readFileSync(skillMdPath, 'utf-8')
  const frontmatter = content.match(/^---\s*\n([\s\S]*?)\n---/)
  const getField = (key: string): string | undefined => {
    const m = frontmatter?.[1]?.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
    return m?.[1]?.trim().replace(/^["']|["']$/g, '')
  }
  const name = getField('name')
  const description = getField('description')
  if (!name || !description) {
    throw new Error('SKILL.md 缺少 name 或 description，无法提交')
  }
  return { name, description }
}

// ===== git / gh 调用封装 =====

// fork/clone/push/pr create 都是秒级到分钟级的网络操作，必须用异步 execFile——
// 用同步的 execFileSync 会整段阻塞 Electron 主进程事件循环，冻结所有正在运行的 Agent 会话和 IPC。
const execFileAsync = promisify(execFile)

function extractProcessError(error: unknown): string {
  const stderr = error && typeof error === 'object' && 'stderr' in error
    ? String((error as { stderr?: unknown }).stderr ?? '').trim()
    : ''
  return stderr || (error instanceof Error ? error.message : String(error))
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf-8',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
    })
    return stdout.trim()
  } catch (error) {
    throw new Error(`git ${args[0]} 失败: ${extractProcessError(error)}`)
  }
}

async function runGh(ghPath: string, args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(ghPath, args, {
      cwd,
      encoding: 'utf-8',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    })
    return stdout.trim()
  } catch (error) {
    throw new Error(extractProcessError(error))
  }
}

// ===== 主流程 =====

/** 把工作区内一个本地 Skill 提交为社区市场仓库的 Pull Request */
export async function submitSkillToCommunity(input: SkillSubmissionInput): Promise<SkillSubmissionResult> {
  const { workspaceSlug, skillSlug, category, license, homepage } = input

  const status = getGhCliStatus()
  if (!status.installed) {
    throw new Error('未检测到 gh（GitHub CLI），请先安装：https://cli.github.com/')
  }
  if (!status.authenticated || !status.login) {
    throw new Error('gh 尚未登录 GitHub，请先在终端执行 `gh auth login`')
  }
  const ghPath = resolveGhPath()
  const login = status.login

  const localSkillDir = join(getWorkspaceSkillsDir(workspaceSlug), skillSlug)
  if (!existsSync(localSkillDir)) {
    throw new Error(`Skill 不存在: ${skillSlug}`)
  }
  const frontmatter = readLocalSkillFrontmatter(localSkillDir)

  const forkRepo = `${login}/myyoda-skills`
  const branch = buildBranchName(skillSlug)
  const tmpDir = join(tmpdir(), `myyoda-submit-${randomUUID()}`)

  try {
    // 1. fork 市场仓库到用户账号下（幂等：已 fork 过时 gh 直接成功，不当作错误）
    try {
      await runGh(ghPath, ['repo', 'fork', MARKET_REPO, '--clone=false', '--remote=false'])
    } catch (error) {
      const message = (error as Error).message
      if (!/already exists/i.test(message)) {
        throw new Error(`Fork 仓库失败: ${message}`)
      }
    }

    // 2. 尽力把 fork 同步到上游最新，失败不阻断（可能是网络抖动或已是最新）
    try {
      await runGh(ghPath, ['repo', 'sync', forkRepo, '--source', MARKET_REPO, '--force'])
    } catch (error) {
      console.warn('[社区提交] 同步 fork 到上游失败（忽略，继续提交）:', extractProcessError(error))
    }

    // 3. 克隆 fork 到临时目录
    await runGh(ghPath, ['repo', 'clone', forkRepo, tmpDir, '--', '--depth=1'])

    // 4. 新建分支
    await runGit(tmpDir, ['checkout', '-b', branch])

    // 5. 目标路径冲突检查
    const targetRelPath = `skills/${skillSlug}`
    const targetAbsPath = join(tmpDir, targetRelPath)
    if (existsSync(targetAbsPath)) {
      throw new Error(`市场仓库已存在同名 Skill 目录: ${targetRelPath}`)
    }

    // 6. 拷贝 Skill 目录，剔除本地导入元数据
    cpSync(localSkillDir, targetAbsPath, { recursive: true })
    const sourceMetaPath = join(targetAbsPath, '.source.json')
    if (existsSync(sourceMetaPath)) {
      rmSync(sourceMetaPath, { force: true })
    }

    // 7. 追加 sources.yaml 条目
    const sourcesYamlPath = join(tmpDir, 'sources.yaml')
    const entryText = buildSourcesYamlEntry({
      name: frontmatter.name,
      description: frontmatter.description,
      category,
      path: targetRelPath,
      license,
      homepage,
    })
    const existingYaml = existsSync(sourcesYamlPath) ? readFileSync(sourcesYamlPath, 'utf-8') : ''
    const separator = existingYaml.length === 0 || existingYaml.endsWith('\n\n')
      ? ''
      : existingYaml.endsWith('\n') ? '\n' : '\n\n'
    writeFileSync(sourcesYamlPath, `${existingYaml}${separator}${entryText}`, 'utf-8')

    // 8. 提交并推送
    const { title, body } = buildPrTitleAndBody({ name: frontmatter.name, slug: skillSlug, description: frontmatter.description })
    await runGit(tmpDir, ['add', '-A'])
    await runGit(tmpDir, ['commit', '-m', title])
    await runGit(tmpDir, ['push', '-u', 'origin', branch])

    // 9. 创建 PR
    const prOutput = await runGh(ghPath, [
      'pr', 'create',
      '--repo', MARKET_REPO,
      '--head', `${login}:${branch}`,
      '--base', MARKET_BASE_BRANCH,
      '--title', title,
      '--body', body,
    ], tmpDir)
    const prUrl = prOutput.split('\n').map((line) => line.trim()).filter(Boolean).pop() || prOutput

    console.log(`[社区提交] 已创建 PR: ${prUrl}`)
    return { prUrl, branch }
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // 临时目录清理失败不影响提交结果
    }
  }
}
