import { describe, expect, test } from 'bun:test'
import { mergeReferenceOptions, toggleReferenceId } from '../ReferenceMultiSelect'

describe('ReferenceMultiSelect helpers', () => {
  test('toggle 增删 id', () => {
    expect(toggleReferenceId(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggleReferenceId(['a', 'b'], 'a')).toEqual(['b'])
  })

  test('merge 保留目录外已选项为 orphan', () => {
    const merged = mergeReferenceOptions(
      [{ id: 'pdf', label: 'PDF' }],
      ['pdf', 'legacy'],
    )
    expect(merged).toEqual([
      { id: 'pdf', label: 'PDF' },
      { id: 'legacy', label: 'legacy', orphan: true, hint: '不在当前工作区' },
    ])
  })
})
