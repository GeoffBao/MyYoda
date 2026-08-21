import { toast } from 'sonner'
import type { CapabilityChange } from '@myyoda/shared'

/** 变化类型 → 中文描述 */
const CHANGE_LABELS: Record<CapabilityChange['type'], string> = {
  mcp_added: '连接器已添加',
  mcp_removed: '连接器已移除',
  mcp_enabled: '连接器已启用',
  mcp_disabled: '连接器已禁用',
  skill_added: '技能已添加',
  skill_removed: '技能已移除',
  skill_enabled: '技能已启用',
  skill_disabled: '技能已禁用',
}

/**
 * 显示能力变化 toast 通知。
 *
 * - 1-3 条变化：每条单独 toast
 * - 4+ 条变化：合并为一条摘要 toast
 */
export function showCapabilityChangeToasts(changes: CapabilityChange[]): void {
  if (changes.length === 0) return

  if (changes.length <= 3) {
    for (const change of changes) {
      const label = CHANGE_LABELS[change.type]
      const isPositive = change.type.endsWith('_added') || change.type.endsWith('_enabled')
      if (isPositive) {
        toast.success(`${label}: ${change.name}`)
      } else {
        toast.info(`${label}: ${change.name}`)
      }
    }
  } else {
    // 批量变化：合并为一条摘要
    const mcpCount = changes.filter((c) => c.type.startsWith('mcp_')).length
    const skillCount = changes.filter((c) => c.type.startsWith('skill_')).length
    const parts: string[] = []
    if (mcpCount > 0) parts.push(`${mcpCount} 个连接器`)
    if (skillCount > 0) parts.push(`${skillCount} 个技能`)
    toast.info(`工作区配置已更新：${parts.join('、')}`)
  }
}
