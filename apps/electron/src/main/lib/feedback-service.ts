/**
 * 用户反馈服务（→ GitHub Issues）
 *
 * 反馈提交到 GeoffBao/MyYoda 公开仓库的 Issues（fine-grained PAT 认证）。
 * - 配置：~/.myyoda/feedback.json（token 用 Electron safeStorage 加密）
 * - 截图：非官方 user-attachments 端点上传（与网页端拖拽等效），URL 嵌入 issue 正文
 * - 草稿：~/.myyoda/feedback-drafts/（v2 格式，提交失败降级，可重试）
 * - 去重：~/.myyoda/feedback-submitted.json（类型+描述 hash，30 天窗口）
 * - HTTP 统一走代理感知的 getFetchFn（国内网络环境刚需）
 *
 * 设计契约参考 docs/superpowers/specs/2026-08-17-discover-feedback-github-issues-wiki-design.md §4。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { BrowserWindow, dialog, safeStorage } from 'electron'
import type { WebContents } from 'electron'
import {
  FEEDBACK_DESCRIPTION_MAX_LENGTH,
  FEEDBACK_MAX_IMAGE_BYTES,
  FEEDBACK_MAX_SCREENSHOTS,
  FEEDBACK_REPO,
  type FeedbackDraft,
  type FeedbackDraftItem,
  type FeedbackGithubConfig,
  type FeedbackSubmitInput,
  type FeedbackSubmitResult,
  type FeedbackTestConnectionResult,
} from '@myyoda/shared'
import { getFeedbackConfigPath, getFeedbackDraftsDir, getFeedbackSubmittedPath } from './config-paths'
import {
  buildDedupKey,
  buildIssueBody,
  buildIssueTitle,
  extractAttachmentUrl,
  resolveIssueLabels,
} from './feedback-format'
import { getFetchFn } from './proxy-fetch'
import { getEffectiveProxyUrl } from './proxy-settings-service'

const GITHUB_API_BASE = 'https://api.github.com'
const UPLOADS_API_BASE = 'https://uploads.github.com'

/** 预览 JPEG 最长边 */
const PREVIEW_MAX_DIMENSION = 1280
/** 去重记录上限 */
const DEDUP_MAX_ENTRIES = 200
/** 去重记录保留窗口（天） */
const DEDUP_KEEP_DAYS = 30

// ===== 配置读写（token 加密） =====

interface FeedbackConfigFile {
  version?: 2
  tokenEncrypted?: string
  repo?: { owner: string; repo: string }
  /** 旧 Notion 字段（迁移后不再写入；读取时仅用于提示） */
  databaseId?: string
}

function encryptSecret(plainSecret: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    return plainSecret
  }
  return safeStorage.encryptString(plainSecret).toString('base64')
}

function decryptSecret(encryptedSecret: string): string {
  if (!encryptedSecret) return ''
  if (!safeStorage.isEncryptionAvailable()) {
    return encryptedSecret
  }
  try {
    return safeStorage.decryptString(Buffer.from(encryptedSecret, 'base64'))
  } catch {
    return ''
  }
}

function readConfigFile(): FeedbackConfigFile {
  const filePath = getFeedbackConfigPath()
  if (!existsSync(filePath)) return {}
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown
    if (typeof raw !== 'object' || raw === null) return {}
    return raw as FeedbackConfigFile
  } catch {
    return {}
  }
}

/** 读取完整配置（含解密 token，仅供内部提交/测试使用） */
export function getFeedbackConfig(): FeedbackGithubConfig {
  const raw = readConfigFile()
  return {
    token: raw.tokenEncrypted ? decryptSecret(raw.tokenEncrypted) : '',
    repo: raw.repo?.owner && raw.repo?.repo ? raw.repo : FEEDBACK_REPO,
  }
}

/** 保存配置；token 传空字符串表示清除 */
export function saveFeedbackConfig(config: FeedbackGithubConfig): void {
  const repo = config.repo?.owner && config.repo?.repo ? config.repo : FEEDBACK_REPO
  const raw: FeedbackConfigFile = { version: 2, repo }
  const token = config.token?.trim() ?? ''
  if (token) {
    raw.tokenEncrypted = encryptSecret(token)
  }
  writeFileSync(getFeedbackConfigPath(), JSON.stringify(raw, null, 2), 'utf-8')
  // 仓库变化时失效内存缓存
  repoIdCache = null
  knownLabelsCache = null
}

/** 面向 renderer 的公开配置（不泄露 token） */
export function getFeedbackConfigPublic(): {
  configured: boolean
  repo: string
  legacyNotionDetected: boolean
} {
  const raw = readConfigFile()
  const config = getFeedbackConfig()
  return {
    configured: Boolean(config.token),
    repo: `${config.repo?.owner}/${config.repo?.repo}`,
    legacyNotionDetected: Boolean(raw.databaseId),
  }
}

// ===== 连接测试 =====

/** 测试 PAT 是否有效且可访问目标仓库（GET /repos；fine-grained token 无 user scope，不能用 GET /user 验证） */
export async function testFeedbackConnection(config: FeedbackGithubConfig): Promise<FeedbackTestConnectionResult> {
  const saved = getFeedbackConfig()
  const token = (config.token?.trim() || saved.token || '').trim()
  const repo = config.repo?.owner && config.repo?.repo ? config.repo : saved.repo ?? FEEDBACK_REPO
  if (!token) {
    return { success: false, message: '请先填写 GitHub Personal Access Token' }
  }
  try {
    const fetchFn = getFetchFn(await getEffectiveProxyUrl())
    const response = await fetchFn(`${GITHUB_API_BASE}/repos/${repo.owner}/${repo.repo}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    })
    if (response.ok) {
      return { success: true, message: '凭证有效，反馈将提交到该仓库的 Issues' }
    }
    if (response.status === 401) {
      return { success: false, message: 'Token 无效或已失效，请到 GitHub 重新生成' }
    }
    if (response.status === 403) {
      return { success: false, message: '权限不足：请确认 Token 已授权访问 GeoffBao/MyYoda 仓库' }
    }
    if (response.status === 404) {
      return { success: false, message: '找不到目标仓库 GeoffBao/MyYoda' }
    }
    return { success: false, message: `GitHub 返回错误（${response.status}）` }
  } catch {
    return { success: false, message: '网络请求失败，请检查代理设置后重试' }
  }
}

// ===== 截图/图片处理 =====

/** 用 sharp 把图片压缩为预览级 JPEG，返回 { filePath, dataUrl } */
async function prepareScreenshot(srcPath: string): Promise<{ filePath: string; dataUrl: string } | null> {
  const { default: sharp } = await import('sharp')
  const draftsDir = getFeedbackDraftsDir()
  if (!existsSync(draftsDir)) mkdirSync(draftsDir, { recursive: true })

  const outPath = join(draftsDir, `shot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`)
  try {
    const buffer = await sharp(srcPath)
      .rotate()
      .resize({ width: PREVIEW_MAX_DIMENSION, height: PREVIEW_MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer()
    writeFileSync(outPath, buffer)
    return {
      filePath: outPath,
      dataUrl: `data:image/jpeg;base64,${buffer.toString('base64')}`,
    }
  } catch (error) {
    console.warn('[反馈] 图片压缩失败:', error instanceof Error ? error.message : String(error))
    return null
  }
}

/** 截取当前应用窗口（调用前 renderer 会短暂隐藏反馈弹窗自身） */
export async function captureFeedbackWindow(sender: WebContents): Promise<{ filePath: string; dataUrl: string } | null> {
  try {
    const win = BrowserWindow.fromWebContents(sender)
    if (!win) return null
    const image = await win.webContents.capturePage()
    const jpeg = image.toJPEG(85)
    if (jpeg.length > FEEDBACK_MAX_IMAGE_BYTES) {
      // 超限时降分辨率重压
      const { default: sharp } = await import('sharp')
      const buffer = await sharp(jpeg).resize({ width: PREVIEW_MAX_DIMENSION, height: PREVIEW_MAX_DIMENSION, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toBuffer()
      const filePath = writeCaptureBuffer(buffer)
      return { filePath, dataUrl: `data:image/jpeg;base64,${buffer.toString('base64')}` }
    }
    const filePath = writeCaptureBuffer(jpeg)
    return { filePath, dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}` }
  } catch (error) {
    console.warn('[反馈] 窗口截图失败:', error instanceof Error ? error.message : String(error))
    return null
  }
}

function writeCaptureBuffer(buffer: Buffer): string {
  const draftsDir = getFeedbackDraftsDir()
  if (!existsSync(draftsDir)) mkdirSync(draftsDir, { recursive: true })
  const filePath = join(draftsDir, `cap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`)
  writeFileSync(filePath, buffer)
  return filePath
}

/** 打开图片选择对话框，返回压缩后的 { filePath, dataUrl } 列表 */
export async function pickFeedbackImages(sender: WebContents): Promise<Array<{ filePath: string; dataUrl: string }>> {
  const win = BrowserWindow.fromWebContents(sender)
  const options: Electron.OpenDialogOptions = {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return []

  const prepared: Array<{ filePath: string; dataUrl: string }> = []
  for (const filePath of result.filePaths.slice(0, FEEDBACK_MAX_SCREENSHOTS)) {
    const item = await prepareScreenshot(filePath)
    if (item) prepared.push(item)
  }
  return prepared
}

// ===== GitHub 提交 =====

/** 仓库 id 内存缓存（user-attachments 上传需要） */
let repoIdCache: number | null = null

/** 仓库已有 label 内存缓存 */
let knownLabelsCache: string[] | null = null

async function getRepositoryId(token: string, fetchFn: typeof globalThis.fetch): Promise<number> {
  if (repoIdCache !== null) return repoIdCache
  const repo = getFeedbackConfig().repo ?? FEEDBACK_REPO
  const response = await fetchFn(`${GITHUB_API_BASE}/repos/${repo.owner}/${repo.repo}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  })
  if (!response.ok) throw new Error(`获取仓库信息失败（${response.status}）`)
  const data = (await response.json()) as { id: number }
  repoIdCache = data.id
  return data.id
}

/** 上传单张截图到 user-attachments（非官方端点，与网页端拖拽等效），返回附件 URL */
async function uploadScreenshotAsset(
  filePath: string,
  token: string,
  repositoryId: number,
  fetchFn: typeof globalThis.fetch,
): Promise<string> {
  const filename = basename(filePath)
  const ext = extname(filePath).toLowerCase()
  const contentType = ext === '.png' ? 'image/png' : 'image/jpeg'
  const query = new URLSearchParams({
    name: filename,
    content_type: contentType,
    repository_id: String(repositoryId),
  })
  const buffer = readFileSync(filePath)
  const response = await fetchFn(`${UPLOADS_API_BASE}/user-attachments/assets?${query.toString()}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': contentType,
    },
    body: new Uint8Array(buffer),
  })
  if (!response.ok) throw new Error(`上传截图失败（${response.status}）`)
  const payload = (await response.json()) as unknown
  const url = extractAttachmentUrl(payload)
  if (!url) throw new Error('上传截图失败（响应中未找到附件 URL）')
  return url
}

/** 探测仓库已有 labels（失败按空处理，内存缓存） */
async function getKnownLabels(token: string, fetchFn: typeof globalThis.fetch): Promise<string[]> {
  if (knownLabelsCache !== null) return knownLabelsCache
  const repo = getFeedbackConfig().repo ?? FEEDBACK_REPO
  const response = await fetchFn(`${GITHUB_API_BASE}/repos/${repo.owner}/${repo.repo}/labels`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  })
  if (!response.ok) {
    knownLabelsCache = []
    return []
  }
  const payload = (await response.json()) as Array<{ name?: unknown }>
  knownLabelsCache = payload
    .map((label) => (typeof label?.name === 'string' ? label.name : ''))
    .filter(Boolean)
  return knownLabelsCache
}

/** 提交反馈到 GitHub Issues */
export async function submitFeedback(
  input: FeedbackSubmitInput,
  appVersion: string,
  platform: string,
): Promise<FeedbackSubmitResult> {
  const config = getFeedbackConfig()
  if (!config.token) {
    const draftPath = saveFeedbackDraft(input, appVersion, platform, [])
    return { success: false, error: '尚未配置 GitHub 凭证', draftSaved: true, draftPath }
  }

  // 输入校验（renderer 已限制，这里兜底）
  const description = input.description.trim()
  if (!description) {
    return { success: false, error: '请填写详细描述' }
  }
  if (description.length > FEEDBACK_DESCRIPTION_MAX_LENGTH) {
    return { success: false, error: `描述超过 ${FEEDBACK_DESCRIPTION_MAX_LENGTH} 字上限` }
  }
  if (input.screenshots.length > FEEDBACK_MAX_SCREENSHOTS) {
    return { success: false, error: `截图最多 ${FEEDBACK_MAX_SCREENSHOTS} 张` }
  }

  const dedupKey = buildDedupKey(input.type, description)
  const duplicate = hasSubmitted(dedupKey)

  // 已上传的附件 URL：issue 创建失败时写入草稿，重试可复用（作用域在 try 外，catch 兜底也能拿到）
  let uploadedUrls: string[] = []

  try {
    const fetchFn = getFetchFn(await getEffectiveProxyUrl())
    const repositoryId = await getRepositoryId(config.token, fetchFn)

    // 1. 上传截图（单张失败跳过，全部完成后统一嵌入正文）
    let skippedScreenshots = 0
    for (const shotPath of input.screenshots) {
      if (!existsSync(shotPath)) {
        skippedScreenshots += 1
        continue
      }
      try {
        uploadedUrls.push(await uploadScreenshotAsset(shotPath, config.token, repositoryId, fetchFn))
      } catch (error) {
        skippedScreenshots += 1
        console.warn('[反馈] 单张截图上传失败，跳过:', error instanceof Error ? error.message : String(error))
      }
    }

    // 2. 组装并创建 issue
    const title = buildIssueTitle(input.type, description)
    const body = buildIssueBody(input, {
      appVersion,
      platform,
      submittedAt: new Date().toISOString(),
      screenshotUrls: uploadedUrls,
    })
    const repo = config.repo ?? FEEDBACK_REPO
    const labels = resolveIssueLabels(input.type, await getKnownLabels(config.token, fetchFn))

    const createIssue = (withLabels: string[]): Promise<Response> =>
      fetchFn(`${GITHUB_API_BASE}/repos/${repo.owner}/${repo.repo}/issues`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(withLabels.length > 0 ? { title, body, labels: withLabels } : { title, body }),
      })

    let createResponse = await createIssue(labels)
    // label 不存在的 422 → 降级重试不带 label
    if (!createResponse.ok && createResponse.status === 422 && labels.length > 0) {
      createResponse = await createIssue([])
    }

    if (!createResponse.ok) {
      const errBody = (await createResponse.text()).slice(0, 300)
      let error = `GitHub 返回错误（${createResponse.status}）`
      if (createResponse.status === 401) error = 'Token 无效或已失效，请到设置中重新配置'
      if (createResponse.status === 403) error = '权限不足：请确认 Token 已授权 Issues 写权限'
      console.warn('[反馈] 创建 issue 失败:', error, errBody)
      const draftPath = saveFeedbackDraft(input, appVersion, platform, uploadedUrls)
      return { success: false, error, draftSaved: true, draftPath }
    }

    const created = (await createResponse.json()) as { html_url?: string }
    recordSubmitted(dedupKey)
    // 清理临时截图（截图/上传产生的临时文件都落在 feedback-drafts 目录）
    cleanupTempScreenshots(input.screenshots)
    return {
      success: true,
      issueUrl: created.html_url,
      screenshotsSkipped: skippedScreenshots > 0,
      duplicate,
    }
  } catch {
    const draftPath = saveFeedbackDraft(input, appVersion, platform, uploadedUrls)
    return { success: false, error: '网络请求失败，已保存草稿，请检查代理后重试', draftSaved: true, draftPath }
  }
}

// ===== 草稿 =====

/** 删除 drafts 目录下的临时截图文件（只清理本服务自己产生的临时文件） */
function cleanupTempScreenshots(screenshotPaths: string[]): void {
  const draftsDir = getFeedbackDraftsDir()
  for (const filePath of screenshotPaths) {
    try {
      if (!filePath.startsWith(draftsDir)) continue
      unlinkSync(filePath)
    } catch {
      // 清理失败不影响提交结果
    }
  }
}

function saveFeedbackDraft(
  input: FeedbackSubmitInput,
  appVersion: string,
  platform: string,
  uploadedAssetUrls: string[],
): string {
  const draftsDir = getFeedbackDraftsDir()
  if (!existsSync(draftsDir)) mkdirSync(draftsDir, { recursive: true })
  const draft: FeedbackDraft = {
    version: 2,
    createdAt: new Date().toISOString(),
    input,
    appVersion,
    platform,
    uploadedAssetUrls: uploadedAssetUrls.length > 0 ? uploadedAssetUrls : undefined,
  }
  const draftPath = join(draftsDir, `draft-${Date.now()}.json`)
  writeFileSync(draftPath, JSON.stringify(draft, null, 2), 'utf-8')
  return draftPath
}

/** 列出本地草稿（v2 可重试；v1 Notion 旧格式标记 legacy，不可提交） */
export function listFeedbackDrafts(): FeedbackDraftItem[] {
  const draftsDir = getFeedbackDraftsDir()
  if (!existsSync(draftsDir)) return []
  const items: FeedbackDraftItem[] = []
  for (const fileName of readdirSync(draftsDir)) {
    if (!fileName.endsWith('.json')) continue
    try {
      const raw = JSON.parse(readFileSync(join(draftsDir, fileName), 'utf-8')) as Record<string, unknown>
      if (typeof raw !== 'object' || raw === null) continue
      const input = raw.input as Partial<FeedbackSubmitInput> | undefined
      if (!input || typeof input.type !== 'string' || typeof input.description !== 'string') continue
      const legacy = raw.version !== 2
      items.push({
        fileName,
        version: legacy ? 1 : 2,
        createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
        input: {
          type: input.type === 'feature' ? 'feature' : 'bug',
          description: input.description,
          screenshots: Array.isArray(input.screenshots) ? input.screenshots : [],
          contactEmail: typeof input.contactEmail === 'string' ? input.contactEmail : undefined,
        },
        appVersion: typeof raw.appVersion === 'string' ? raw.appVersion : undefined,
        platform: typeof raw.platform === 'string' ? raw.platform : undefined,
        legacy,
      })
    } catch {
      // 损坏文件跳过
    }
  }
  return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

/** 删除本地草稿（严格校验文件名，防路径穿越）；不存在返回 false */
export function deleteFeedbackDraft(fileName: string): boolean {
  if (!/^draft-[\w-]+\.json$/.test(fileName)) return false
  const filePath = join(getFeedbackDraftsDir(), fileName)
  if (!existsSync(filePath)) return false
  try {
    unlinkSync(filePath)
    return true
  } catch {
    return false
  }
}

// ===== 去重记录 =====

interface SubmittedRecord {
  [dedupKey: string]: number
}

function readSubmittedRecords(): SubmittedRecord {
  try {
    const raw = JSON.parse(readFileSync(getFeedbackSubmittedPath(), 'utf-8')) as unknown
    if (typeof raw === 'object' && raw !== null) return raw as SubmittedRecord
    return {}
  } catch {
    return {}
  }
}

/** 该 key 是否已提交过 */
export function hasSubmitted(dedupKey: string): boolean {
  return dedupKey in readSubmittedRecords()
}

/** 记录提交（保留 30 天窗口，超出 200 条时淘汰最旧） */
function recordSubmitted(dedupKey: string): void {
  const records = readSubmittedRecords()
  const cutoff = Date.now() - DEDUP_KEEP_DAYS * 24 * 60 * 60 * 1000
  for (const [key, at] of Object.entries(records)) {
    if (at < cutoff) delete records[key]
  }
  records[dedupKey] = Date.now()
  const keys = Object.keys(records)
  if (keys.length > DEDUP_MAX_ENTRIES) {
    keys.sort((a, b) => (records[a] ?? 0) - (records[b] ?? 0))
    for (const key of keys.slice(0, keys.length - DEDUP_MAX_ENTRIES)) delete records[key]
  }
  writeFileSync(getFeedbackSubmittedPath(), JSON.stringify(records, null, 2), 'utf-8')
}
