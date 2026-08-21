import type { ChatToolParam } from '@myyoda/shared'

export function extractHttpTemplateParams(template: string): ChatToolParam[] {
  const names = new Set<string>()
  for (const match of template.matchAll(/\{\{\s*([A-Za-z_][\w]*)\s*\}\}/g)) {
    const name = match[1]
    if (name) names.add(name)
  }
  return [...names].map((name) => ({
    name,
    type: 'string',
    description: name,
    required: true,
  }))
}
