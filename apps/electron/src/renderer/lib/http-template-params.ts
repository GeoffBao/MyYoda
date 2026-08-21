import type { ChatToolParam } from '@myyoda/shared'

export function extractHttpTemplateParams(template: string): ChatToolParam[] {
  const names = new Set<string>()
  for (const match of template.matchAll(/\{\{\s*([A-Za-z_][\w]*)\s*\}\}/g)) {
    // noUncheckedIndexedAccess 下 match[1] 为 string | undefined，需收窄
    const name = match[1]
    if (!name) continue
    names.add(name)
  }
  return [...names].map((name) => ({
    name,
    type: 'string',
    description: name,
    required: true,
  }))
}
