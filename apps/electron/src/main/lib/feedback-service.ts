/**
 * 用户反馈服务（→ Notion）
 *
 * 反馈弹窗提交的数据写入用户自己的 Notion 数据库（2026-03-11 API，实测契约）。
 * - 配置：~/.myyoda/feedback.json（token 用 Electron safeStorage 加密）
 * - 草稿：~/.myyoda/feedback-drafts/（提交失败降级）
 * - HTTP 统一走代理感知的 getFetchFn（国内网络环境刚需）
 *
 * Notion API 契约参考 docs/luxcoder/05-feedback-to-notion-design.md §9。
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { BrowserWindow, dialog, safeStorage } from 'electron'
import type { WebContents } from 'electron'
import {
  FEEDBACK_DESCRIPTION_MAX_LENGTH,
  FEEDBACK_MAX_IMAGE_BYTES,
  FEEDBACK_MAX_SCREENSHOTS,
  FEEDBACK_TYPE_NOTION_VALUE,
  type FeedbackDraft,
  type FeedbackNotionConfig,
  type FeedbackSubmitInput,
  type FeedbackSubmitResult,
  type FeedbackTestConnectionResult,
} from '@myyoda/shared'
import { getFeedbackConfigPath, getFeedbackDraftsDir } from './config-paths'
import { getFetchFn } from './proxy-fetch'
import { getEffectiveProxyUrl } from './proxy-settings-service'

const NOTION_API_BASE = 'https://api.notion.com'
const NOTION_API_VERSION = '2026-03-11'

/** 单条 rich_text 的字符上限（Notion API 限制 2000，留余量） */
const RICH_TEXT_CHUNK_LIMIT = 1800
/** 标题截断长度（描述前 N 字） */
const TITLE_PREFIX_LIMIT = 40
/** 预览 JPEG 最长边 */
const PREVIEW_MAX_DIMENSION = 1280

// ===== 配置读写（token 加密） =====

interface FeedbackConfigFile {
  tokenEncrypted?: string
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
    return JSON.parse(readFileSync(filePath, 'utf-8')) as FeedbackConfigFile
  } catch {
    return {}
  }
}

/** 读取完整配置（含解密 token，仅供内部提交/测试使用） */
export function getFeedbackConfig(): FeedbackNotionConfig {
  const raw = readConfigFile()
  return {
    token: raw.tokenEncrypted ? decryptSecret(raw.tokenEncrypted) : '',
    databaseId: raw.databaseId ?? '',
  }
}

/** 保存配置；token 传空字符串表示清除 */
export function saveFeedbackConfig(config: FeedbackNotionConfig): void {
  const raw: FeedbackConfigFile = {
    databaseId: config.databaseId?.trim() || undefined,
  }
  const token = config.token?.trim() ?? ''
  if (token) {
    raw.tokenEncrypted = encryptSecret(token)
  }
  writeFileSync(getFeedbackConfigPath(), JSON.stringify(raw, null, 2), 'utf-8')
}

/** 面向 renderer 的公开配置（不泄露 token） */
export function getFeedbackConfigPublic(): { configured: boolean; databaseId: string } {
  const config = getFeedbackConfig()
  return {
    configured: Boolean(config.token && config.databaseId),
    databaseId: config.databaseId ?? '',
  }
}

// ===== 连接测试 =====

/** 测试 token + databaseId 是否可用（GET 数据库，顺带校验存在性与授权）；留空的字段回退到已保存配置 */
export async function testFeedbackConnection(config: FeedbackNotionConfig): Promise<FeedbackTestConnectionResult> {
  const saved = getFeedbackConfig()
  const token = (config.token?.trim() || saved.token || '').trim()
  const databaseId = (config.databaseId?.trim() || saved.databaseId || '').trim()
  if (!token || !databaseId) {
    return { success: false, message: '请先填写 Notion Token 和数据库 ID' }
  }
  try {
    const fetchFn = getFetchFn(await getEffectiveProxyUrl())
    const response = await fetchFn(`${NOTION_API_BASE}/v1/databases/${databaseId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': NOTION_API_VERSION,
      },
    })
    if (response.ok) {
      return { success: true, message: '连接成功，反馈将提交到该数据库' }
    }
    const body = (await response.text()).slice(0, 300)
    if (response.status === 401) {
      return { success: false, message: 'Token 无效或已失效，请到 Notion Connections 页面检查' }
    }
    if (response.status === 404) {
      return { success: false, message: '找不到该数据库：ID 不正确，或连接未授权访问该页面' }
    }
    return { success: false, message: `Notion 返回错误（${response.status}）` }
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

// ===== Notion 提交 =====

/** 上传单个文件到 Notion，返回 file_upload id */
async function uploadNotionFile(filePath: string, token: string, fetchFn: typeof fetch): Promise<string> {
  const filename = basename(filePath)
  const ext = extname(filePath).toLowerCase()
  const contentType = ext === '.png' ? 'image/png' : 'image/jpeg'

  const createResponse = await fetchFn(`${NOTION_API_BASE}/v1/file_uploads`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_API_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ mode: 'single_part', filename, content_type: contentType }),
  })
  if (!createResponse.ok) {
    throw new Error(`创建上传对象失败（${createResponse.status}）`)
  }
  const created = (await createResponse.json()) as { id: string; upload_url: string }

  const buffer = readFileSync(filePath)
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(buffer)], { type: contentType }), filename)

  const sendResponse = await fetchFn(created.upload_url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_API_VERSION },
    body: form,
  })
  if (!sendResponse.ok) {
    throw new Error(`上传文件内容失败（${sendResponse.status}）`)
  }
  return created.id
}

/** 把描述按 rich_text 限制切成段落块 */
function buildParagraphBlocks(description: string): Array<Record<string, unknown>> {
  const paragraphs = description.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  const blocks: Array<Record<string, unknown>> = []
  for (const paragraph of paragraphs) {
    let remaining = paragraph
    while (remaining.length > 0) {
      const chunk = remaining.slice(0, RICH_TEXT_CHUNK_LIMIT)
      remaining = remaining.slice(RICH_TEXT_CHUNK_LIMIT)
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: [{ type: 'text', text: { content: chunk } }] },
      })
    }
  }
  return blocks
}

/** 生成条目标题：[类型] 描述前 N 字 */
function buildTitle(type: FeedbackSubmitInput['type'], description: string): string {
  const prefix = description.trim().slice(0, TITLE_PREFIX_LIMIT)
  const typeLabel = FEEDBACK_TYPE_NOTION_VALUE[type]
  return prefix ? `[${typeLabel}] ${prefix}` : `[${typeLabel}] 无描述`
}

/** 提交反馈到 Notion 数据库 */
export async function submitFeedback(
  input: FeedbackSubmitInput,
  appVersion: string,
  platform: string,
): Promise<FeedbackSubmitResult> {
  const config = getFeedbackConfig()
  if (!config.token || !config.databaseId) {
    const draftPath = saveFeedbackDraft(input, appVersion, platform)
    return { success: false, error: '尚未配置 Notion 提交渠道', draftSaved: true, draftPath }
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

  try {
    const fetchFn = getFetchFn(await getEffectiveProxyUrl())

    // 1. 上传截图，收集 file_upload id
    const fileUploadIds: string[] = []
    for (const shotPath of input.screenshots) {
      if (!existsSync(shotPath)) continue
      try {
        fileUploadIds.push(await uploadNotionFile(shotPath, config.token, fetchFn))
      } catch (error) {
        console.warn('[反馈] 单张截图上传失败，跳过:', error instanceof Error ? error.message : String(error))
      }
    }

    // 2. 组装页面
    const title = buildTitle(input.type, description)
    const properties: Record<string, unknown> = {
      标题: { title: [{ text: { content: title } }] },
      类型: { select: { name: FEEDBACK_TYPE_NOTION_VALUE[input.type] } },
      状态: { select: { name: '待处理' } },
      版本: { rich_text: [{ text: { content: appVersion || '未知版本' } }] },
      平台信息: { rich_text: [{ text: { content: platform || 'unknown' } }] },
    }
    if (input.contactEmail?.trim()) {
      properties['联系方式'] = { email: input.contactEmail.trim() }
    }

    const children: Array<Record<string, unknown>> = buildParagraphBlocks(description)
    for (const fileUploadId of fileUploadIds) {
      children.push({
        object: 'block',
        type: 'image',
        image: { type: 'file_upload', file_upload: { id: fileUploadId } },
      })
    }

    const createResponse = await fetchFn(`${NOTION_API_BASE}/v1/pages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Notion-Version': NOTION_API_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        parent: { type: 'database_id', database_id: config.databaseId },
        properties,
        children,
      }),
    })

    if (!createResponse.ok) {
      const body = (await createResponse.text()).slice(0, 300)
      let error = `Notion 返回错误（${createResponse.status}）`
      if (createResponse.status === 401) error = 'Token 无效或已失效，请到设置中重新配置'
      if (createResponse.status === 404) error = '找不到数据库或未授权，请到设置中检查数据库 ID'
      console.warn('[反馈] 创建页面失败:', error, body)
      const draftPath = saveFeedbackDraft(input, appVersion, platform)
      return { success: false, error, draftSaved: true, draftPath }
    }

    const created = (await createResponse.json()) as { url?: string }
    // 清理临时截图（截图/上传产生的临时文件都落在 feedback-drafts 目录）
    cleanupTempScreenshots(input.screenshots)
    return { success: true, pageUrl: created.url }
  } catch {
    const draftPath = saveFeedbackDraft(input, appVersion, platform)
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

function saveFeedbackDraft(input: FeedbackSubmitInput, appVersion: string, platform: string): string {
  const draftsDir = getFeedbackDraftsDir()
  if (!existsSync(draftsDir)) mkdirSync(draftsDir, { recursive: true })
  const draft: FeedbackDraft = {
    version: 1,
    createdAt: new Date().toISOString(),
    input,
    appVersion,
    platform,
  }
  const draftPath = join(draftsDir, `draft-${Date.now()}.json`)
  writeFileSync(draftPath, JSON.stringify(draft, null, 2), 'utf-8')
  return draftPath
}
