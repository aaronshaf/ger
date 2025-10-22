import { describe, expect, test } from 'bun:test'
import {
  isChangeId,
  isChangeNumber,
  isValidChangeIdentifier,
  normalizeChangeIdentifier,
  getIdentifierType,
} from './change-id'

describe('change-id utilities', () => {
  describe('isChangeId', () => {
    test('returns true for valid Change-ID format', () => {
      expect(isChangeId('If5a3ae8cb5a107e187447802358417f311d0c4b1')).toBe(true)
      expect(isChangeId('I0123456789abcdef0123456789abcdef01234567')).toBe(true)
    })

    test('returns false for invalid Change-ID format', () => {
      expect(isChangeId('392385')).toBe(false)
      expect(isChangeId('if5a3ae8cb5a107e187447802358417f311d0c4b1')).toBe(false) // lowercase 'i'
      expect(isChangeId('If5a3ae8cb5a107e187447802358417f311d0c4b')).toBe(false) // too short
      expect(isChangeId('If5a3ae8cb5a107e187447802358417f311d0c4b11')).toBe(false) // too long
      expect(isChangeId('Gf5a3ae8cb5a107e187447802358417f311d0c4b1')).toBe(false) // wrong prefix
    })
  })

  describe('isChangeNumber', () => {
    test('returns true for numeric strings', () => {
      expect(isChangeNumber('392385')).toBe(true)
      expect(isChangeNumber('12345')).toBe(true)
      expect(isChangeNumber('1')).toBe(true)
    })

    test('returns false for non-numeric strings', () => {
      expect(isChangeNumber('If5a3ae8cb5a107e187447802358417f311d0c4b1')).toBe(false)
      expect(isChangeNumber('abc')).toBe(false)
      expect(isChangeNumber('123abc')).toBe(false)
      expect(isChangeNumber('')).toBe(false)
    })
  })

  describe('isValidChangeIdentifier', () => {
    test('returns true for valid change numbers', () => {
      expect(isValidChangeIdentifier('392385')).toBe(true)
      expect(isValidChangeIdentifier('12345')).toBe(true)
    })

    test('returns true for valid Change-IDs', () => {
      expect(isValidChangeIdentifier('If5a3ae8cb5a107e187447802358417f311d0c4b1')).toBe(true)
      expect(isValidChangeIdentifier('I0123456789abcdef0123456789abcdef01234567')).toBe(true)
    })

    test('returns false for invalid identifiers', () => {
      expect(isValidChangeIdentifier('abc')).toBe(false)
      expect(isValidChangeIdentifier('I123')).toBe(false)
      expect(isValidChangeIdentifier('')).toBe(false)
    })
  })

  describe('normalizeChangeIdentifier', () => {
    test('returns trimmed change number', () => {
      expect(normalizeChangeIdentifier('392385')).toBe('392385')
      expect(normalizeChangeIdentifier(' 392385 ')).toBe('392385')
    })

    test('returns trimmed Change-ID', () => {
      expect(normalizeChangeIdentifier('If5a3ae8cb5a107e187447802358417f311d0c4b1')).toBe(
        'If5a3ae8cb5a107e187447802358417f311d0c4b1',
      )
      expect(normalizeChangeIdentifier(' If5a3ae8cb5a107e187447802358417f311d0c4b1 ')).toBe(
        'If5a3ae8cb5a107e187447802358417f311d0c4b1',
      )
    })

    test('throws error for invalid identifiers', () => {
      expect(() => normalizeChangeIdentifier('abc')).toThrow(/Invalid change identifier/)
      expect(() => normalizeChangeIdentifier('I123')).toThrow(/Invalid change identifier/)
      expect(() => normalizeChangeIdentifier('')).toThrow(/Invalid change identifier/)
    })
  })

  describe('getIdentifierType', () => {
    test('returns "change-number" for numeric strings', () => {
      expect(getIdentifierType('392385')).toBe('change-number')
      expect(getIdentifierType(' 12345 ')).toBe('change-number')
    })

    test('returns "change-id" for Change-ID format', () => {
      expect(getIdentifierType('If5a3ae8cb5a107e187447802358417f311d0c4b1')).toBe('change-id')
      expect(getIdentifierType(' If5a3ae8cb5a107e187447802358417f311d0c4b1 ')).toBe('change-id')
    })

    test('returns "invalid" for invalid identifiers', () => {
      expect(getIdentifierType('abc')).toBe('invalid')
      expect(getIdentifierType('I123')).toBe('invalid')
      expect(getIdentifierType('')).toBe('invalid')
    })
  })
})
