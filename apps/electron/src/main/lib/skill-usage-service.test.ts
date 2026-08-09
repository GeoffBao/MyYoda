/**
 * skill-usage-service 测试
 *
 * - extractSkillSlugFromToolUse：从 tool_use 里识别被调用的 Skill slug
 */

import { describe, expect, test } from 'bun:test'
import { extractSkillSlugFromToolUse } from './skill-usage-service'

describe('extractSkillSlugFromToolUse', () => {
  test('Skill 工具：无限定名前缀', () => {
    expect(extractSkillSlugFromToolUse('Skill', { skill: 'figma' })).toBe('figma')
  })

  test('Skill 工具：带 SDK 附加目录限定名前缀', () => {
    expect(extractSkillSlugFromToolUse('Skill', { skill: 'proma-workspace-default:knowledge-maintenance' }))
      .toBe('knowledge-maintenance')
  })

  test('Skill 工具：input.skill 缺失或非字符串返回 null', () => {
    expect(extractSkillSlugFromToolUse('Skill', {})).toBeNull()
    expect(extractSkillSlugFromToolUse('Skill', { skill: 123 })).toBeNull()
    expect(extractSkillSlugFromToolUse('Skill', { skill: '   ' })).toBeNull()
  })

  test('Read 工具：命中 skills/<slug>/SKILL.md 路径', () => {
    expect(extractSkillSlugFromToolUse('Read', { file_path: '/Users/x/.myyoda/agent-workspaces/default/skills/docx/SKILL.md' }))
      .toBe('docx')
    expect(extractSkillSlugFromToolUse('Read', { filePath: 'C:\\workspace\\skills\\hyperframes-cli\\SKILL.md' }))
      .toBe('hyperframes-cli')
  })

  test('Read 工具：非 SKILL.md 路径返回 null', () => {
    expect(extractSkillSlugFromToolUse('Read', { file_path: '/Users/x/project/README.md' })).toBeNull()
    expect(extractSkillSlugFromToolUse('Read', { file_path: '/Users/x/skills/docx/reference.md' })).toBeNull()
  })

  test('无关工具返回 null', () => {
    expect(extractSkillSlugFromToolUse('Bash', { command: 'ls' })).toBeNull()
    expect(extractSkillSlugFromToolUse('Write', { file_path: 'skills/docx/SKILL.md' })).toBeNull()
  })
})
