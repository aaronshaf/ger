import { describe, expect, test } from 'bun:test'
import { Schema } from '@effect/schema'
import { CommentInput, FileDiffContent, GerritCredentials } from '@/schemas/gerrit'

describe('Gerrit Schemas', () => {
  describe('GerritCredentials', () => {
    test('should validate valid credentials', () => {
      const validCredentials = {
        host: 'https://gerrit.example.com',
        username: 'testuser',
        password: 'testpass123',
      }

      const result = Schema.decodeUnknownSync(GerritCredentials)(validCredentials)
      expect(result).toEqual(validCredentials)
    })

    test('should reject invalid URL', () => {
      const invalidCredentials = {
        host: 'not-a-url',
        username: 'testuser',
        password: 'testpass123',
      }

      expect(() => {
        Schema.decodeUnknownSync(GerritCredentials)(invalidCredentials)
      }).toThrow()
    })

    test('should reject empty username', () => {
      const invalidCredentials = {
        host: 'https://gerrit.example.com',
        username: '',
        password: 'testpass123',
      }

      expect(() => {
        Schema.decodeUnknownSync(GerritCredentials)(invalidCredentials)
      }).toThrow()
    })

    test('should reject empty password', () => {
      const invalidCredentials = {
        host: 'https://gerrit.example.com',
        username: 'testuser',
        password: '',
      }

      expect(() => {
        Schema.decodeUnknownSync(GerritCredentials)(invalidCredentials)
      }).toThrow()
    })
  })

  describe('CommentInput', () => {
    test('should validate valid comment input', () => {
      const validComment = {
        message: 'This is a test comment',
        unresolved: true,
      }

      const result = Schema.decodeUnknownSync(CommentInput)(validComment)
      expect(result).toEqual(validComment)
    })

    test('should validate comment without unresolved flag', () => {
      const validComment = {
        message: 'This is a test comment',
      }

      const result = Schema.decodeUnknownSync(CommentInput)(validComment)
      expect(result).toEqual(validComment)
    })

    test('should reject empty message', () => {
      const invalidComment = {
        message: '',
      }

      expect(() => {
        Schema.decodeUnknownSync(CommentInput)(invalidComment)
      }).toThrow()
    })
  })

  describe('FileDiffContent', () => {
    const baseContent = { content: [] }

    test('should accept change_type REWRITE', () => {
      const result = Schema.decodeUnknownSync(FileDiffContent)({
        ...baseContent,
        change_type: 'REWRITE',
      })
      expect(result.change_type).toBe('REWRITE')
    })

    test('should accept intraline_status ERROR', () => {
      const result = Schema.decodeUnknownSync(FileDiffContent)({
        ...baseContent,
        intraline_status: 'ERROR',
      })
      expect(result.intraline_status).toBe('ERROR')
    })

    test('should accept all valid change_type values', () => {
      const values = ['ADDED', 'MODIFIED', 'DELETED', 'RENAMED', 'COPIED', 'REWRITE'] as const
      for (const change_type of values) {
        const result = Schema.decodeUnknownSync(FileDiffContent)({ ...baseContent, change_type })
        expect(result.change_type).toBe(change_type)
      }
    })

    test('should accept all valid intraline_status values', () => {
      const values = ['OK', 'TIMEOUT', 'ERROR'] as const
      for (const intraline_status of values) {
        const result = Schema.decodeUnknownSync(FileDiffContent)({
          ...baseContent,
          intraline_status,
        })
        expect(result.intraline_status).toBe(intraline_status)
      }
    })

    test('should reject invalid change_type', () => {
      expect(() => {
        Schema.decodeUnknownSync(FileDiffContent)({ ...baseContent, change_type: 'FAILURE' })
      }).toThrow()
    })

    test('should reject invalid intraline_status', () => {
      expect(() => {
        Schema.decodeUnknownSync(FileDiffContent)({ ...baseContent, intraline_status: 'FAILURE' })
      }).toThrow()
    })
  })
})
