import { describe, expect, test } from 'bun:test'
import { OPTIMIZED_CODING_GATED_SKILLS, isOptimizedCodingGatedSkill } from './agent-workspace-manager'
import { createMyYodaSkillsOverride } from './adapters/pi-agent-adapter'

function fakeSkill(name: string, baseDir = `/ws/skills/${name}`) {
  return { name, baseDir, filePath: `${baseDir}/SKILL.md`, description: 'test', version: '1.0.0' }
}

describe('OPTIMIZED_CODING_GATED_SKILLS', () => {
  test('包含 4 个跟随总开关的预置 skill', () => {
    expect([...OPTIMIZED_CODING_GATED_SKILLS].sort()).toEqual(
      ['code-review', 'ultraqa', 'deep-interview', 'ai-slop-cleaner'].sort(),
    )
  })

  test('isOptimizedCodingGatedSkill 判定正确', () => {
    expect(isOptimizedCodingGatedSkill('code-review')).toBe(true)
    expect(isOptimizedCodingGatedSkill('pdf')).toBe(false)
  })
})

describe('createMyYodaSkillsOverride 开关联动', () => {
  const workspaceRoot = '/ws/skills'
  const skills = [
    fakeSkill('pdf', `${workspaceRoot}/pdf`),
    fakeSkill('code-review', `${workspaceRoot}/code-review`),
    fakeSkill('ultraqa', `${workspaceRoot}/ultraqa`),
    fakeSkill('docx', `${workspaceRoot}/docx`),
  ]

  test('开关关闭（默认）：gated skill 被过滤，普通 skill 保留', () => {
    const override = createMyYodaSkillsOverride([workspaceRoot], OPTIMIZED_CODING_GATED_SKILLS)
    const result = override({ skills, diagnostics: [] } as never)
    const names = result.skills.map((s) => s.name).sort()
    expect(names).toEqual(['docx', 'pdf'])
  })

  test('开关开启：gated skill 放行', () => {
    const override = createMyYodaSkillsOverride([workspaceRoot], [])
    const result = override({ skills, diagnostics: [] } as never)
    expect(result.skills.length).toBe(4)
  })

  test('非工作区 skill（SDK 内置）始终不暴露', () => {
    const override = createMyYodaSkillsOverride([workspaceRoot], [])
    const result = override({ skills: [...skills, fakeSkill('builtin', '/agent-dir/skills/builtin')], diagnostics: [] } as never)
    expect(result.skills.some((s) => s.name === 'builtin')).toBe(false)
  })
})
