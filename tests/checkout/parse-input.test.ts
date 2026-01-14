import { describe, test, expect } from 'bun:test'
import { parseChangeInput } from '@/cli/commands/checkout'

/**
 * Tests for parseChangeInput function
 *
 * Validates parsing of various input formats:
 * - Plain change numbers
 * - Change numbers with patchsets (12345/3)
 * - Change-IDs (Iabc123...)
 * - URLs with/without patchsets
 */

describe('parseChangeInput', () => {
  test('should parse plain change number', () => {
    const result = parseChangeInput('12345')
    expect(result).toEqual({ changeId: '12345' })
  })

  test('should parse change number with patchset', () => {
    const result = parseChangeInput('12345/3')
    expect(result).toEqual({ changeId: '12345', patchset: 3 })
  })

  test('should parse Change-ID', () => {
    const result = parseChangeInput('Iabc123def456')
    expect(result).toEqual({ changeId: 'Iabc123def456' })
  })

  test('should parse URL with change number', () => {
    const result = parseChangeInput('https://gerrit.example.com/c/project/+/12345')
    expect(result).toEqual({ changeId: '12345' })
  })

  test('should parse URL with change number and patchset', () => {
    const result = parseChangeInput('https://gerrit.example.com/c/project/+/12345/3')
    expect(result).toEqual({ changeId: '12345', patchset: 3 })
  })

  test('should parse URL with hash format', () => {
    const result = parseChangeInput('https://gerrit.example.com/#/c/project/+/12345')
    expect(result).toEqual({ changeId: '12345' })
  })

  test('should handle whitespace', () => {
    const result = parseChangeInput('  12345/2  ')
    expect(result).toEqual({ changeId: '12345', patchset: 2 })
  })

  test('should handle invalid patchset gracefully', () => {
    const result = parseChangeInput('12345/abc')
    expect(result.changeId).toBe('12345')
    expect(result.patchset).toBeUndefined()
  })
})
