import { describe, it, expect } from 'vitest'
import { extractLastResponse } from '../utils/responseParser'

describe('extractLastResponse', () => {
  it('returns full content when no separator found', () => {
    const content = 'This is a simple response with no separators.'
    expect(extractLastResponse(content)).toBe(content)
  })

  it('returns the last section after a --- separator', () => {
    const content = [
      '[tool_call] list_files',
      '[tool_result] main.rs lib.rs',
      '---',
      'Here is my analysis of the codebase.',
    ].join('\n')
    expect(extractLastResponse(content)).toBe('Here is my analysis of the codebase.')
  })

  it('returns the last section when multiple --- separators exist', () => {
    const content = [
      'First section',
      '---',
      'Second section',
      '---',
      'Final response text',
    ].join('\n')
    expect(extractLastResponse(content)).toBe('Final response text')
  })

  it('returns the last section after a ## Response header', () => {
    const content = [
      'Tool output goes here',
      '## Response',
      'The actual LLM response.',
    ].join('\n')
    expect(extractLastResponse(content)).toBe('The actual LLM response.')
  })

  it('trims leading/trailing whitespace from the extracted section', () => {
    const content = 'First\n---\n\n  Trimmed response  \n\n'
    expect(extractLastResponse(content)).toBe('Trimmed response')
  })

  it('returns empty string unchanged (no crash)', () => {
    expect(extractLastResponse('')).toBe('')
  })

  it('handles content with only a separator (returns empty string)', () => {
    const content = '---\n'
    // last section after separator is empty — fall back to full content
    expect(extractLastResponse(content)).toBe('')
  })
})
