/**
 * 多选引用列表：从当前工作区目录勾选，保留不在目录中的已选项（orphan）。
 */

import * as React from 'react'
import { cn } from '@/lib/utils'

export interface ReferenceOption {
  id: string
  label: string
  hint?: string
}

/** 目录项 + 已选但目录缺失的 orphan，供勾选 UI 使用。 */
export function mergeReferenceOptions(
  catalog: ReferenceOption[],
  selected: readonly string[],
): Array<ReferenceOption & { orphan?: boolean }> {
  const byId = new Map(catalog.map((item) => [item.id, item]))
  const out: Array<ReferenceOption & { orphan?: boolean }> = catalog.map((item) => ({ ...item }))
  for (const id of selected) {
    if (byId.has(id)) continue
    out.push({ id, label: id, orphan: true, hint: '不在当前工作区' })
  }
  return out
}

export function toggleReferenceId(selected: readonly string[], id: string): string[] {
  return selected.includes(id)
    ? selected.filter((item) => item !== id)
    : [...selected, id]
}

interface ReferenceMultiSelectProps {
  options: Array<ReferenceOption & { orphan?: boolean }>
  value: readonly string[]
  onChange: (next: string[]) => void
  emptyHint: string
  className?: string
}

export function ReferenceMultiSelect({
  options,
  value,
  onChange,
  emptyHint,
  className,
}: ReferenceMultiSelectProps): React.ReactElement {
  const selected = new Set(value)

  if (options.length === 0) {
    return (
      <div className={cn('rounded-lg border border-dashed border-border/60 bg-muted/30 px-3 py-2 text-[13px] text-muted-foreground', className)}>
        {emptyHint}
      </div>
    )
  }

  return (
    <div className={cn('max-h-48 space-y-0.5 overflow-y-auto rounded-lg border border-border/60 bg-content-area p-2', className)}>
      {options.map((option) => {
        const checked = selected.has(option.id)
        return (
          <label
            key={option.id}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50"
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onChange(toggleReferenceId(value, option.id))}
              className="size-3.5 rounded border-border accent-primary"
            />
            <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{option.label}</span>
            {(option.hint || option.orphan) && (
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {option.hint ?? '不在当前工作区'}
              </span>
            )}
          </label>
        )
      })}
    </div>
  )
}
