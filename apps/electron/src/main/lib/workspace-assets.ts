/**
 * workspace-assets — 工作区资产（项目=工作区模型下的资产库）
 *
 * 对齐 craft-agents-oss 的项目资产：资产目录 = {workspaceRoot}/workspace-files/assets/，
 * 支持列出 / 上传（base64）/ 删除。迁移服务已把存量 KanbanProject 资产迁入此目录。
 * 文件名做路径穿越脱敏（仅保留 basename，分隔符替换为下划线）。
 */

import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { getWorkspaceFilesDir } from './config-paths'

export interface WorkspaceAssetInfo {
  filename: string
  sizeBytes: number
}

/** 工作区资产目录（不存在时按需创建） */
export function getWorkspaceAssetsDir(workspaceSlug: string): string {
  return join(getWorkspaceFilesDir(workspaceSlug), 'assets')
}

/** 列出工作区资产（按文件名排序，稳定输出） */
export function listWorkspaceAssets(workspaceSlug: string): WorkspaceAssetInfo[] {
  const dir = getWorkspaceAssetsDir(workspaceSlug)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .sort((a, b) => a.localeCompare(b))
    .map((filename) => {
      try {
        return { filename, sizeBytes: statSync(join(dir, filename)).size }
      } catch {
        return { filename, sizeBytes: 0 }
      }
    })
}

/** 上传工作区资产（base64）；文件名脱敏防路径穿越 */
export function uploadWorkspaceAsset(workspaceSlug: string, filename: string, base64: string): WorkspaceAssetInfo {
  const safe = sanitizeAssetFilename(filename)
  const dir = getWorkspaceAssetsDir(workspaceSlug)
  mkdirSync(dir, { recursive: true })
  const buffer = Buffer.from(base64, 'base64')
  writeFileSync(join(dir, safe), buffer)
  return { filename: safe, sizeBytes: buffer.length }
}

/** 删除工作区资产（不存在时静默返回） */
export function deleteWorkspaceAsset(workspaceSlug: string, filename: string): void {
  const safe = sanitizeAssetFilename(filename)
  const full = join(getWorkspaceAssetsDir(workspaceSlug), safe)
  if (!existsSync(full)) return
  rmSync(full, { force: true })
}

const WORKSPACE_ASSET_MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.yaml': 'application/x-yaml',
  '.yml': 'application/x-yaml',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.xml': 'application/xml',
}

/** 资产 mimeType 推断（与 craft Project 资产注入同一口径，未知扩展名回退 octet-stream） */
export function inferWorkspaceAssetMimeType(filename: string): string {
  return WORKSPACE_ASSET_MIME_MAP[extname(filename).toLowerCase()] ?? 'application/octet-stream'
}

export interface WorkspaceAssetPromptInfo {
  filename: string
  mimeType: string
  sizeBytes: number
}

/**
 * 列出工作区资产供 prompt 注入（带 mimeType 推断）。
 * 独立于 listWorkspaceAssets：既有 UI 调用方只消费 filename/sizeBytes，
 * 不需要为它们引入 mimeType 字段。
 */
export function listWorkspaceAssetsForPrompt(workspaceSlug: string): WorkspaceAssetPromptInfo[] {
  return listWorkspaceAssets(workspaceSlug).map((asset) => ({
    filename: asset.filename,
    sizeBytes: asset.sizeBytes,
    mimeType: inferWorkspaceAssetMimeType(asset.filename),
  }))
}

function sanitizeAssetFilename(filename: string): string {
  const base = filename.split(/[\\/]/).filter(Boolean).pop() ?? 'asset'
  return base.replace(/[\\/]/g, '_')
}
