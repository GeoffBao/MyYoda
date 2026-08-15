/**
 * 「发现」内容清单纯逻辑：校验 + 更新标记（无 IO，便于单测）
 */
import type {
  DiscoverContentItem,
  DiscoverContentState,
  DiscoverFeedItem,
  DiscoverManifest,
} from '@myyoda/shared'

export type ManifestValidation =
  | { ok: true; manifest: DiscoverManifest }
  | { ok: false; error: string }

const CONTENT_TYPES = new Set(['video', 'article', 'announcement', 'link'])

/** 校验 content.json 原始 JSON，返回规范化清单或错误 */
export function validateManifest(raw: unknown): ManifestValidation {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: '清单格式错误：不是 JSON 对象' }
  }
  const candidate = raw as Record<string, unknown>
  if (!Array.isArray(candidate.items)) {
    return { ok: false, error: '清单格式错误：缺少 items 数组' }
  }
  const items: DiscoverContentItem[] = []
  for (const entry of candidate.items) {
    if (typeof entry !== 'object' || entry === null) {
      return { ok: false, error: '清单条目格式错误' }
    }
    const item = entry as Record<string, unknown>
    if (
      typeof item.id !== 'string' ||
      typeof item.title !== 'string' ||
      typeof item.version !== 'string' ||
      typeof item.publishedAt !== 'string'
    ) {
      return { ok: false, error: `条目字段缺失：${String(item.id ?? '?')}` }
    }
    const type = item.type as DiscoverContentItem['type']
    if (!CONTENT_TYPES.has(type)) {
      return { ok: false, error: `未知内容类型：${String(type)}` }
    }
    if (type === 'video' && (typeof item.video !== 'object' || item.video === null)) {
      return { ok: false, error: `视频条目缺少 video 字段：${String(item.id)}` }
    }
    items.push(item as unknown as DiscoverContentItem)
  }
  return {
    ok: true,
    manifest: {
      version: typeof candidate.version === 'number' ? candidate.version : 1,
      items,
    },
  }
}

/** 合并已读状态，产出带 hasUpdate 标记的流条目 */
export function computeUpdateFlags(
  items: DiscoverContentItem[],
  state: DiscoverContentState,
): DiscoverFeedItem[] {
  return items.map((item) => ({
    ...item,
    hasUpdate: state[item.id] !== item.version,
  }))
}
