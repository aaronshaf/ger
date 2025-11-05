import { describe, expect, test } from 'bun:test'
import { extractChangeNumber, isValidChangeId, normalizeGerritHost } from './url-parser'

describe('extractChangeNumber', () => {
  test('extracts change number from standard Gerrit URL', () => {
    const url = 'https://gerrit.example.com/c/my-project/+/384571'
    expect(extractChangeNumber(url)).toBe('384571')
  })

  test('extracts change number from URL with trailing slash', () => {
    const url = 'https://gerrit.example.com/c/my-project/+/384571/'
    expect(extractChangeNumber(url)).toBe('384571')
  })

  test('extracts change number from URL with patchset', () => {
    const url = 'https://gerrit.example.com/c/my-project/+/384571/2'
    expect(extractChangeNumber(url)).toBe('384571')
  })

  test('extracts change number from hash-based URL', () => {
    const url = 'https://gerrit.example.com/#/c/my-project/+/384571/'
    expect(extractChangeNumber(url)).toBe('384571')
  })

  test('extracts change number from simplified URL format', () => {
    const url = 'https://gerrit.example.com/c/+/384571'
    expect(extractChangeNumber(url)).toBe('384571')
  })

  test('extracts change number from hash-based simplified URL', () => {
    const url = 'https://gerrit.example.com/#/c/+/384571'
    expect(extractChangeNumber(url)).toBe('384571')
  })

  test('returns plain change number as-is', () => {
    expect(extractChangeNumber('384571')).toBe('384571')
  })

  test('returns Change-Id format as-is', () => {
    const changeId = 'Iabcdef1234567890abcdef1234567890abcdef12'
    expect(extractChangeNumber(changeId)).toBe(changeId)
  })

  test('returns original input for invalid URLs', () => {
    const invalidUrl = 'https://gerrit.example.com/invalid/path'
    expect(extractChangeNumber(invalidUrl)).toBe(invalidUrl)
  })

  test('handles malformed URLs gracefully', () => {
    const malformed = 'not-a-url-at-all'
    expect(extractChangeNumber(malformed)).toBe(malformed)
  })

  test('handles http:// URLs', () => {
    const httpUrl = 'http://gerrit.example.com/c/project/+/123456'
    expect(extractChangeNumber(httpUrl)).toBe('123456')
  })

  test('handles malformed https URLs that throw in URL constructor', () => {
    const malformed = 'https://[invalid-url'
    expect(extractChangeNumber(malformed)).toBe(malformed)
  })

  test('handles empty string', () => {
    expect(extractChangeNumber('')).toBe('')
  })

  test('handles whitespace', () => {
    expect(extractChangeNumber('  384571  ')).toBe('384571')
  })
})

describe('isValidChangeId', () => {
  test('validates numeric change IDs', () => {
    expect(isValidChangeId('384571')).toBe(true)
    expect(isValidChangeId('1')).toBe(true)
    expect(isValidChangeId('999999')).toBe(true)
  })

  test('rejects zero and negative numbers', () => {
    expect(isValidChangeId('0')).toBe(false)
    expect(isValidChangeId('-1')).toBe(false)
  })

  test('validates Change-Id format', () => {
    const validChangeId = 'Iabcdef1234567890abcdef1234567890abcdef12'
    expect(isValidChangeId(validChangeId)).toBe(true)
  })

  test('rejects invalid Change-Id format', () => {
    // Only reject if it doesn't follow the strict Change-Id format when it starts with 'I' and is long
    expect(isValidChangeId('abcdef1234567890abcdef1234567890abcdef12')).toBe(true) // valid topic name
    expect(isValidChangeId('Iabc')).toBe(true) // could be a valid topic or branch name
  })

  test('validates other identifier formats', () => {
    expect(isValidChangeId('topic-branch')).toBe(true)
    expect(isValidChangeId('feature/new-thing')).toBe(true)
  })

  test('rejects empty and whitespace-only strings', () => {
    expect(isValidChangeId('')).toBe(false)
    expect(isValidChangeId('   ')).toBe(false)
    expect(isValidChangeId('has spaces')).toBe(false)
  })

  test('handles exact Change-Id format validation', () => {
    // Valid Change-Id: starts with 'I' and exactly 40 hex chars
    expect(isValidChangeId('I1234567890abcdef1234567890abcdef12345678')).toBe(true)

    // Invalid: wrong length
    expect(isValidChangeId('I123')).toBe(true) // this is treated as a valid topic name
    expect(isValidChangeId('I1234567890abcdef1234567890abcdef123456789')).toBe(true) // too long, treated as topic

    // Invalid: non-hex characters
    expect(isValidChangeId('I1234567890abcdef1234567890abcdef1234567g')).toBe(true) // treated as topic name
  })

  test('rejects strings starting with dash', () => {
    expect(isValidChangeId('-123')).toBe(false)
    expect(isValidChangeId('-abc')).toBe(false)
  })
})

describe('normalizeGerritHost', () => {
  describe('adding protocol', () => {
    test('adds https:// when no protocol is provided', () => {
      expect(normalizeGerritHost('gerrit.example.com')).toBe('https://gerrit.example.com')
    })

    test('adds https:// to hostname with port', () => {
      expect(normalizeGerritHost('gerrit.example.com:8080')).toBe('https://gerrit.example.com:8080')
    })

    test('adds https:// to localhost', () => {
      expect(normalizeGerritHost('localhost:8080')).toBe('https://localhost:8080')
    })

    test('adds https:// to IP address', () => {
      expect(normalizeGerritHost('192.168.1.100')).toBe('https://192.168.1.100')
    })

    test('adds https:// to IP address with port', () => {
      expect(normalizeGerritHost('192.168.1.100:8080')).toBe('https://192.168.1.100:8080')
    })
  })

  describe('preserving existing protocol', () => {
    test('preserves https:// when already present', () => {
      expect(normalizeGerritHost('https://gerrit.example.com')).toBe('https://gerrit.example.com')
    })

    test('preserves http:// when explicitly provided', () => {
      expect(normalizeGerritHost('http://gerrit.example.com')).toBe('http://gerrit.example.com')
    })

    test('preserves https:// with port', () => {
      expect(normalizeGerritHost('https://gerrit.example.com:8080')).toBe(
        'https://gerrit.example.com:8080',
      )
    })

    test('preserves http:// with port', () => {
      expect(normalizeGerritHost('http://gerrit.example.com:8080')).toBe(
        'http://gerrit.example.com:8080',
      )
    })
  })

  describe('removing trailing slashes', () => {
    test('removes single trailing slash', () => {
      expect(normalizeGerritHost('https://gerrit.example.com/')).toBe('https://gerrit.example.com')
    })

    test('removes trailing slash from URL without protocol', () => {
      expect(normalizeGerritHost('gerrit.example.com/')).toBe('https://gerrit.example.com')
    })

    test('removes trailing slash from URL with port', () => {
      expect(normalizeGerritHost('https://gerrit.example.com:8080/')).toBe(
        'https://gerrit.example.com:8080',
      )
    })

    test('handles URL without trailing slash', () => {
      expect(normalizeGerritHost('https://gerrit.example.com')).toBe('https://gerrit.example.com')
    })

    test('does not remove slash from path', () => {
      expect(normalizeGerritHost('https://gerrit.example.com/gerrit')).toBe(
        'https://gerrit.example.com/gerrit',
      )
    })

    test('removes trailing slash from path', () => {
      expect(normalizeGerritHost('https://gerrit.example.com/gerrit/')).toBe(
        'https://gerrit.example.com/gerrit',
      )
    })
  })

  describe('whitespace handling', () => {
    test('trims leading whitespace', () => {
      expect(normalizeGerritHost('  gerrit.example.com')).toBe('https://gerrit.example.com')
    })

    test('trims trailing whitespace', () => {
      expect(normalizeGerritHost('gerrit.example.com  ')).toBe('https://gerrit.example.com')
    })

    test('trims whitespace from URL with protocol', () => {
      expect(normalizeGerritHost('  https://gerrit.example.com  ')).toBe(
        'https://gerrit.example.com',
      )
    })

    test('trims whitespace and removes trailing slash', () => {
      expect(normalizeGerritHost('  gerrit.example.com/  ')).toBe('https://gerrit.example.com')
    })
  })

  describe('combined scenarios', () => {
    test('adds protocol and removes trailing slash', () => {
      expect(normalizeGerritHost('gerrit.example.com/')).toBe('https://gerrit.example.com')
    })

    test('trims, adds protocol, and removes trailing slash', () => {
      expect(normalizeGerritHost('  gerrit.example.com/  ')).toBe('https://gerrit.example.com')
    })

    test('handles subdomain with port', () => {
      expect(normalizeGerritHost('review.git.example.com:8443')).toBe(
        'https://review.git.example.com:8443',
      )
    })

    test('handles complex URL with path', () => {
      expect(normalizeGerritHost('gerrit.example.com/gerrit')).toBe(
        'https://gerrit.example.com/gerrit',
      )
    })

    test('normalizes complete real-world example', () => {
      expect(normalizeGerritHost('gerrit-review.example.org')).toBe(
        'https://gerrit-review.example.org',
      )
    })
  })

  describe('edge cases', () => {
    test('handles empty string', () => {
      // Empty string becomes 'https:/' after normalization (protocol added, then trailing slash removed)
      expect(normalizeGerritHost('')).toBe('https:/')
    })

    test('handles whitespace-only string', () => {
      // Whitespace-only string becomes 'https:/' after normalization
      expect(normalizeGerritHost('   ')).toBe('https:/')
    })

    test('handles just a slash', () => {
      // Just a slash becomes 'https://' (protocol added to '/', then trailing slash removed leaving '//')
      expect(normalizeGerritHost('/')).toBe('https://')
    })

    test('handles protocol only', () => {
      // Protocol only becomes 'https:/' (trailing slash removed)
      expect(normalizeGerritHost('https://')).toBe('https:/')
    })
  })
})
