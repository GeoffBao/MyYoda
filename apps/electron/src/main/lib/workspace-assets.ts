/**
 * workspace-assets — 工作区资产（项目=工作区模型下的资产库）
 *
 * 对齐 craft-agents-oss 的项目资产：资产目录 = {workspaceRoot}/workspace-files/assets/，
 * 支持列出 / 上传（base64）/ 删除。迁移服务已把存量 KanbanProject 资产迁入此目录。
 * 文件名做路径穿越脱敏（仅保留 basename，分隔符替换为下划线）。
 */

import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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

function sanitizeAssetFilename(filename: string): string {
  const base = filename.split(/[\\/]/).filter(Boolean).pop() ?? 'asset'
  return base.replace(/[\\/]/g, '_')
}
