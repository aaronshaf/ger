import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { Effect } from 'effect'
import {
  extractChangeIdFromCommitMessage,
  getLastCommitMessage,
  getChangeIdFromHead,
} from './git-commit'
import * as childProcess from 'node:child_process'
import { EventEmitter } from 'node:events'

let spawnSpy: ReturnType<typeof spyOn>

describe('git-commit utilities', () => {
  describe('extractChangeIdFromCommitMessage', () => {
    test('extracts Change-ID from typical commit message', () => {
      const message = `feat: add new feature

This is a longer description of the feature.

Change-Id: If5a3ae8cb5a107e187447802358417f311d0c4b1`

      expect(extractChangeIdFromCommitMessage(message)).toBe(
        'If5a3ae8cb5a107e187447802358417f311d0c4b1',
      )
    })

    test('extracts Change-ID with extra whitespace', () => {
      const message = `fix: bug fix

Change-Id:   If5a3ae8cb5a107e187447802358417f311d0c4b1   `

      expect(extractChangeIdFromCommitMessage(message)).toBe(
        'If5a3ae8cb5a107e187447802358417f311d0c4b1',
      )
    })

    test('extracts Change-ID from minimal commit', () => {
      const message = `Change-Id: I0123456789abcdef0123456789abcdef01234567`

      expect(extractChangeIdFromCommitMessage(message)).toBe(
        'I0123456789abcdef0123456789abcdef01234567',
      )
    })

    test('extracts first Change-ID when multiple exist', () => {
      const message = `feat: feature

Change-Id: If5a3ae8cb5a107e187447802358417f311d0c4b1
Change-Id: I1111111111111111111111111111111111111111`

      expect(extractChangeIdFromCommitMessage(message)).toBe(
        'If5a3ae8cb5a107e187447802358417f311d0c4b1',
      )
    })

    test('returns null when no Change-ID present', () => {
      const message = `feat: add feature

This commit has no Change-ID footer.`

      expect(extractChangeIdFromCommitMessage(message)).toBe(null)
    })

    test('returns null for empty message', () => {
      expect(extractChangeIdFromCommitMessage('')).toBe(null)
    })

    test('ignores Change-ID in commit body (not footer)', () => {
      const message = `feat: update

This mentions Change-Id: If5a3ae8cb5a107e187447802358417f311d0c4b1 in body
but it's not in the footer.

Signed-off-by: User`

      // Should not match because it's not at the start of a line (footer position)
      expect(extractChangeIdFromCommitMessage(message)).toBe(null)
    })

    test('handles Change-ID with lowercase hex digits', () => {
      const message = `Change-Id: Iabcdef0123456789abcdef0123456789abcdef01`

      expect(extractChangeIdFromCommitMessage(message)).toBe(
        'Iabcdef0123456789abcdef0123456789abcdef01',
      )
    })

    test('returns null for malformed Change-ID (too short)', () => {
      const message = `Change-Id: If5a3ae8cb5a107e187447`

      expect(extractChangeIdFromCommitMessage(message)).toBe(null)
    })

    test('returns null for malformed Change-ID (too long)', () => {
      const message = `Change-Id: If5a3ae8cb5a107e187447802358417f311d0c4b11111`

      expect(extractChangeIdFromCommitMessage(message)).toBe(null)
    })

    test('returns null for Change-ID not starting with I', () => {
      const message = `Change-Id: Gf5a3ae8cb5a107e187447802358417f311d0c4b1`

      expect(extractChangeIdFromCommitMessage(message)).toBe(null)
    })

    test('handles CRLF line endings', () => {
      const message = `feat: feature\r\n\r\nChange-Id: If5a3ae8cb5a107e187447802358417f311d0c4b1\r\n`

      expect(extractChangeIdFromCommitMessage(message)).toBe(
        'If5a3ae8cb5a107e187447802358417f311d0c4b1',
      )
    })

    test('is case-insensitive for "Change-Id" label', () => {
      const message = `change-id: If5a3ae8cb5a107e187447802358417f311d0c4b1`

      expect(extractChangeIdFromCommitMessage(message)).toBe(
        'If5a3ae8cb5a107e187447802358417f311d0c4b1',
      )
    })
  })

  describe('getLastCommitMessage', () => {
    let mockChildProcess: EventEmitter

    beforeEach(() => {
      mockChildProcess = new EventEmitter()
      // @ts-ignore - adding missing properties for mock
      mockChildProcess.stdout = new EventEmitter()
      // @ts-ignore
      mockChildProcess.stderr = new EventEmitter()

      spawnSpy = spyOn(childProcess, 'spawn')
      spawnSpy.mockReturnValue(mockChildProcess as any)
    })

    afterEach(() => {
      spawnSpy.mockRestore()
    })

    test('returns commit message on success', async () => {
      const commitMessage = `feat: add feature

Change-Id: If5a3ae8cb5a107e187447802358417f311d0c4b1`

      const effect = getLastCommitMessage()

      const resultPromise = Effect.runPromise(effect)

      // Simulate git command success
      setImmediate(() => {
        // @ts-ignore
        mockChildProcess.stdout.emit('data', Buffer.from(commitMessage))
        mockChildProcess.emit('close', 0)
      })

      const result = await resultPromise
      expect(result).toBe(commitMessage)
    })

    test('throws GitError when not in git repository', async () => {
      const effect = getLastCommitMessage()

      const resultPromise = Effect.runPromise(effect)

      setImmediate(() => {
        // @ts-ignore
        mockChildProcess.stderr.emit('data', Buffer.from('fatal: not a git repository'))
        mockChildProcess.emit('close', 128)
      })

      try {
        await resultPromise
        expect(true).toBe(false) // Should not reach here
      } catch (error: any) {
        expect(error.message).toContain('fatal: not a git repository')
      }
    })

    test('throws GitError on spawn error', async () => {
      const effect = getLastCommitMessage()

      const resultPromise = Effect.runPromise(effect)

      setImmediate(() => {
        mockChildProcess.emit('error', new Error('ENOENT: git not found'))
      })

      try {
        await resultPromise
        expect(true).toBe(false) // Should not reach here
      } catch (error: any) {
        expect(error.message).toContain('Failed to execute git command')
      }
    })
  })

  describe('getChangeIdFromHead', () => {
    let mockChildProcess: EventEmitter

    beforeEach(() => {
      mockChildProcess = new EventEmitter()
      // @ts-ignore
      mockChildProcess.stdout = new EventEmitter()
      // @ts-ignore
      mockChildProcess.stderr = new EventEmitter()

      spawnSpy = spyOn(childProcess, 'spawn')
      spawnSpy.mockReturnValue(mockChildProcess as any)
    })

    afterEach(() => {
      spawnSpy.mockRestore()
    })

    test('returns Change-ID from HEAD commit', async () => {
      const commitMessage = `feat: add feature

Change-Id: If5a3ae8cb5a107e187447802358417f311d0c4b1`

      const effect = getChangeIdFromHead()

      const resultPromise = Effect.runPromise(effect)

      setImmediate(() => {
        // @ts-ignore
        mockChildProcess.stdout.emit('data', Buffer.from(commitMessage))
        mockChildProcess.emit('close', 0)
      })

      const result = await resultPromise
      expect(result).toBe('If5a3ae8cb5a107e187447802358417f311d0c4b1')
    })

    test('throws NoChangeIdError when commit has no Change-ID', async () => {
      const commitMessage = `feat: add feature

This commit has no Change-ID.`

      const effect = getChangeIdFromHead()

      const resultPromise = Effect.runPromise(effect)

      setImmediate(() => {
        // @ts-ignore
        mockChildProcess.stdout.emit('data', Buffer.from(commitMessage))
        mockChildProcess.emit('close', 0)
      })

      try {
        await resultPromise
        expect(true).toBe(false) // Should not reach here
      } catch (error: any) {
        expect(error.message).toContain('No Change-ID found in HEAD commit')
      }
    })

    test('throws GitError when not in git repository', async () => {
      const effect = getChangeIdFromHead()

      const resultPromise = Effect.runPromise(effect)

      setImmediate(() => {
        // @ts-ignore
        mockChildProcess.stderr.emit('data', Buffer.from('fatal: not a git repository'))
        mockChildProcess.emit('close', 128)
      })

      try {
        await resultPromise
        expect(true).toBe(false) // Should not reach here
      } catch (error: any) {
        expect(error.message).toContain('fatal: not a git repository')
      }
    })
  })
})
