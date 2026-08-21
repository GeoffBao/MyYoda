import { describe, expect, test } from 'bun:test'
import { extractHttpTemplateParams } from './http-template-params'

describe('extractHttpTemplateParams', () => {
  test('pulls unique {{param}} names from a URL template', () => {
    expect(
      extractHttpTemplateParams('https://api.example.com/{{city}}/{{city}}?q={{query}}').map((param) => param.name),
    ).toEqual(['city', 'query'])
  })
})
