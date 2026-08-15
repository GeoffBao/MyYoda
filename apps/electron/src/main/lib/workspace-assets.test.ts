import { describe, expect, test } from 'bun:test'
import { inferWorkspaceAssetMimeType } from './workspace-assets'

describe('inferWorkspaceAssetMimeType（workspace 资产注入用 mimeType 推断）', () => {
  test('Given 常见文档/图片扩展名 When 推断 Then 返回对应 mimeType', () => {
    expect(inferWorkspaceAssetMimeType('spec.pdf')).toBe('application/pdf')
    expect(inferWorkspaceAssetMimeType('diagram.png')).toBe('image/png')
    expect(inferWorkspaceAssetMimeType('notes.MD')).toBe('text/markdown')
    expect(inferWorkspaceAssetMimeType('data.csv')).toBe('text/csv')
    expect(inferWorkspaceAssetMimeType('conf.yml')).toBe('application/x-yaml')
  })

  test('Given 未知扩展名或无扩展名 When 推断 Then 回退 octet-stream', () => {
    expect(inferWorkspaceAssetMimeType('binary.xyz')).toBe('application/octet-stream')
    expect(inferWorkspaceAssetMimeType('Makefile')).toBe('application/octet-stream')
  })

  test('Given 带路径的文件名 When 推断 Then 只看扩展名', () => {
    expect(inferWorkspaceAssetMimeType('/a/b/photo.JPG')).toBe('image/jpeg')
  })
})
