/**
 * community-skill-submit-service 测试
 *
 * - buildSourcesYamlEntry：sources.yaml 追加条目的格式化
 * - buildBranchName / buildPrTitleAndBody：分支名与 PR 文案
 */

import { describe, expect, test } from 'bun:test'
import { buildBranchName, buildPrTitleAndBody, buildSourcesYamlEntry } from './community-skill-submit-service'

describe('buildSourcesYamlEntry', () => {
  test('普通描述使用明文标量，2 空格缩进', () => {
    const entry = buildSourcesYamlEntry({
      name: 'my-skill',
      description: 'A simple skill for testing',
      category: 'community',
      path: 'skills/my-skill',
      license: 'MIT',
      homepage: 'https://github.com/example/my-skill',
    })
    expect(entry).toBe(
      '  - name: my-skill\n' +
      '    description: A simple skill for testing\n' +
      '    target:\n' +
      '      category: community\n' +
      '      path: skills/my-skill\n' +
      '    license: MIT\n' +
      '    homepage: https://github.com/example/my-skill\n',
    )
  })

  test('省略 homepage 时不输出该行', () => {
    const entry = buildSourcesYamlEntry({
      name: 'my-skill',
      description: 'desc',
      category: 'tools',
      path: 'skills/my-skill',
      license: 'MIT',
    })
    expect(entry).not.toContain('homepage')
  })

  test('含冒号+空格 / 引号等特殊字符的描述会加双引号并转义', () => {
    const entry = buildSourcesYamlEntry({
      name: 'my-skill',
      description: 'Search: find "things" fast',
      category: 'tools',
      path: 'skills/my-skill',
      license: 'MIT',
    })
    expect(entry).toContain('description: "Search: find \\"things\\" fast"')
  })
})

describe('buildBranchName', () => {
  test('分支名带 add-skill- 前缀与时间戳，非法字符被替换', () => {
    const branch = buildBranchName('my_skill/v2')
    expect(branch).toMatch(/^add-skill-my-skill-v2-\d+$/)
  })
})

describe('buildPrTitleAndBody', () => {
  test('标题包含 slug，正文包含描述与来源说明', () => {
    const { title, body } = buildPrTitleAndBody({ name: 'My Skill', slug: 'my-skill', description: 'Does things' })
    expect(title).toBe('feat(skills): add my-skill')
    expect(body).toContain('My Skill')
    expect(body).toContain('Does things')
    expect(body).toContain('MyYoda 客户端')
  })
})
