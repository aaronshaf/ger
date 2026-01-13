import { test, expect, describe } from 'bun:test'
import { buildPushRefspec, validateEmails, PushError } from '@/cli/commands/push'

describe('Push Command', () => {
  describe('buildPushRefspec', () => {
    test('should build basic refspec without options', () => {
      const refspec = buildPushRefspec('master', {})
      expect(refspec).toBe('refs/for/master')
    })

    test('should build refspec with topic', () => {
      const refspec = buildPushRefspec('master', { topic: 'my-feature' })
      expect(refspec).toBe('refs/for/master%topic=my-feature')
    })

    test('should URL-encode topic with special characters', () => {
      const refspec = buildPushRefspec('master', { topic: 'feature/auth-fix' })
      expect(refspec).toBe('refs/for/master%topic=feature%2Fauth-fix')
    })

    test('should build refspec with wip flag', () => {
      const refspec = buildPushRefspec('master', { wip: true })
      expect(refspec).toBe('refs/for/master%wip')
    })

    test('should build refspec with draft flag (alias for wip)', () => {
      const refspec = buildPushRefspec('master', { draft: true })
      expect(refspec).toBe('refs/for/master%wip')
    })

    test('should build refspec with ready flag', () => {
      const refspec = buildPushRefspec('master', { ready: true })
      expect(refspec).toBe('refs/for/master%ready')
    })

    test('should build refspec with private flag', () => {
      const refspec = buildPushRefspec('master', { private: true })
      expect(refspec).toBe('refs/for/master%private')
    })

    test('should build refspec with single reviewer', () => {
      const refspec = buildPushRefspec('master', { reviewer: ['alice@example.com'] })
      expect(refspec).toBe('refs/for/master%r=alice@example.com')
    })

    test('should build refspec with multiple reviewers', () => {
      const refspec = buildPushRefspec('master', {
        reviewer: ['alice@example.com', 'bob@example.com'],
      })
      expect(refspec).toBe('refs/for/master%r=alice@example.com,r=bob@example.com')
    })

    test('should build refspec with single cc', () => {
      const refspec = buildPushRefspec('master', { cc: ['manager@example.com'] })
      expect(refspec).toBe('refs/for/master%cc=manager@example.com')
    })

    test('should build refspec with multiple ccs', () => {
      const refspec = buildPushRefspec('master', {
        cc: ['manager@example.com', 'lead@example.com'],
      })
      expect(refspec).toBe('refs/for/master%cc=manager@example.com,cc=lead@example.com')
    })

    test('should build refspec with single hashtag', () => {
      const refspec = buildPushRefspec('master', { hashtag: ['bugfix'] })
      expect(refspec).toBe('refs/for/master%hashtag=bugfix')
    })

    test('should build refspec with multiple hashtags', () => {
      const refspec = buildPushRefspec('master', { hashtag: ['bugfix', 'urgent'] })
      expect(refspec).toBe('refs/for/master%hashtag=bugfix,hashtag=urgent')
    })

    test('should URL-encode hashtags with special characters', () => {
      const refspec = buildPushRefspec('master', { hashtag: ['release/v1.0'] })
      expect(refspec).toBe('refs/for/master%hashtag=release%2Fv1.0')
    })

    test('should build refspec with multiple options combined', () => {
      const refspec = buildPushRefspec('main', {
        topic: 'auth-refactor',
        reviewer: ['alice@example.com'],
        cc: ['manager@example.com'],
        wip: true,
        hashtag: ['security'],
      })
      expect(refspec).toBe(
        'refs/for/main%topic=auth-refactor,wip,r=alice@example.com,cc=manager@example.com,hashtag=security',
      )
    })

    test('should handle different branch names', () => {
      expect(buildPushRefspec('main', {})).toBe('refs/for/main')
      expect(buildPushRefspec('develop', {})).toBe('refs/for/develop')
      expect(buildPushRefspec('feature/my-branch', {})).toBe('refs/for/feature/my-branch')
      expect(buildPushRefspec('release/v1.0', {})).toBe('refs/for/release/v1.0')
    })

    test('should preserve order of parameters', () => {
      // The order should be: topic, wip, ready, private, reviewers, ccs, hashtags
      const refspec = buildPushRefspec('master', {
        hashtag: ['tag1'],
        reviewer: ['r@example.com'],
        topic: 'topic1',
        wip: true,
        cc: ['cc@example.com'],
        private: true,
      })
      // Order in the code: topic, wip, ready, private, reviewer, cc, hashtag
      expect(refspec).toBe(
        'refs/for/master%topic=topic1,wip,private,r=r@example.com,cc=cc@example.com,hashtag=tag1',
      )
    })

    test('should handle empty arrays gracefully', () => {
      const refspec = buildPushRefspec('master', {
        reviewer: [],
        cc: [],
        hashtag: [],
      })
      expect(refspec).toBe('refs/for/master')
    })

    test('should not add wip twice when both wip and draft are true', () => {
      const refspec = buildPushRefspec('master', { wip: true, draft: true })
      // Both wip and draft set the wip flag, but we check wip first, so only one 'wip' should appear
      expect(refspec).toBe('refs/for/master%wip')
    })
  })

  describe('validateEmails', () => {
    test('should accept valid email addresses', () => {
      expect(() => validateEmails(['user@example.com'], 'reviewer')).not.toThrow()
      expect(() => validateEmails(['alice@company.org'], 'cc')).not.toThrow()
      expect(() => validateEmails(['test.user@sub.domain.com'], 'reviewer')).not.toThrow()
    })

    test('should accept multiple valid emails', () => {
      expect(() =>
        validateEmails(['user1@example.com', 'user2@example.com'], 'reviewer'),
      ).not.toThrow()
    })

    test('should accept undefined', () => {
      expect(() => validateEmails(undefined, 'reviewer')).not.toThrow()
    })

    test('should accept empty array', () => {
      expect(() => validateEmails([], 'reviewer')).not.toThrow()
    })

    test('should reject email without @', () => {
      expect(() => validateEmails(['userexample.com'], 'reviewer')).toThrow(PushError)
    })

    test('should reject email without domain', () => {
      expect(() => validateEmails(['user@'], 'reviewer')).toThrow(PushError)
    })

    test('should reject email without user', () => {
      expect(() => validateEmails(['@example.com'], 'reviewer')).toThrow(PushError)
    })

    test('should reject email with spaces', () => {
      expect(() => validateEmails(['user @example.com'], 'reviewer')).toThrow(PushError)
    })

    test('should reject plain username', () => {
      expect(() => validateEmails(['username'], 'reviewer')).toThrow(PushError)
    })

    test('should include field name in error message', () => {
      try {
        validateEmails(['invalid'], 'reviewer')
        expect(true).toBe(false) // Should not reach here
      } catch (e) {
        expect(e).toBeInstanceOf(PushError)
        expect((e as PushError).message).toContain('reviewer')
        expect((e as PushError).message).toContain('invalid')
      }
    })

    test('should fail on first invalid email in array', () => {
      try {
        validateEmails(['valid@example.com', 'invalid', 'another@example.com'], 'cc')
        expect(true).toBe(false)
      } catch (e) {
        expect(e).toBeInstanceOf(PushError)
        expect((e as PushError).message).toContain('invalid')
      }
    })
  })
})
