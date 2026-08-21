import { describe, expect, test } from 'bun:test'
import { getSkillKey } from './useAgentSkillsData'

describe('getSkillKey - 三层合并 Skill 列表的唯一标识', () => {
  test('Given 同一 slug 存在于不同 scope When 生成 key Then 结果互不相同（不会串线）', () => {
    // 这正是 shadowedByGlobal 的触发场景：工作区自建了一个和全局同名的 Skill，
    // getAllEffectiveSkills 会同时返回两个 slug 相同、scope 不同的 SkillMeta。
    // 如果只用 slug 做标识，toggle/delete/打开详情都会分不清点的是哪一张卡片。
    const globalOne = { slug: 'code-review', scope: 'global' as const }
    const workspaceOne = { slug: 'code-review', scope: 'workspace' as const }
    const projectOne = { slug: 'code-review', scope: 'project' as const }

    const keys = [globalOne, workspaceOne, projectOne].map(getSkillKey)
    expect(new Set(keys).size).toBe(3)
  })

  test('Given scope 缺失（历史数据/未标注） When 生成 key Then 回退为 workspace，不抛错', () => {
    expect(getSkillKey({ slug: 'legacy-skill', scope: undefined })).toBe('workspace:legacy-skill')
  })

  test('Given 相同 slug 与相同 scope When 生成 key Then 结果稳定一致（可用于 React key / find 匹配）', () => {
    const a = getSkillKey({ slug: 'brainstorming', scope: 'global' })
    const b = getSkillKey({ slug: 'brainstorming', scope: 'global' })
    expect(a).toBe(b)
  })
})
