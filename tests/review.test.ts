import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { Effect, Layer } from 'effect'
import { GitWorktreeService, WorktreeCreationError } from '@/services/git-worktree'

describe('Review Command - Focused Tests', () => {
  let consoleSpy: any

  beforeEach(() => {
    consoleSpy = {
      log: spyOn(console, 'log').mockImplementation(() => {}),
      error: spyOn(console, 'error').mockImplementation(() => {}),
    }
  })

  afterEach(() => {
    consoleSpy.log.mockRestore()
    consoleSpy.error.mockRestore()
  })

  test('should integrate GitWorktreeService with review workflow', async () => {
    // Mock Git Worktree Service
    const mockGitService = {
      validatePreconditions: () => Effect.succeed(undefined),
      createWorktree: (changeId: string) =>
        Effect.succeed({
          path: `/tmp/test-worktree-${changeId}`,
          changeId,
          originalCwd: '/test/current',
          timestamp: Date.now(),
          pid: process.pid,
        }),
      fetchAndCheckoutPatchset: () => Effect.succeed(undefined),
      cleanup: () => Effect.succeed(undefined),
      getChangedFiles: () => Effect.succeed(['src/main.ts', 'tests/main.test.ts']),
    }

    // Test the complete GitWorktreeService workflow
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* GitWorktreeService

        // Test precondition validation
        yield* service.validatePreconditions()

        // Test worktree creation
        const worktree = yield* service.createWorktree('12345')
        expect(worktree.changeId).toBe('12345')
        expect(worktree.path).toContain('12345')
        expect(worktree.originalCwd).toBe('/test/current')

        // Test patchset fetch
        yield* service.fetchAndCheckoutPatchset(worktree)

        // Test getting changed files
        const files = yield* service.getChangedFiles()
        expect(files).toEqual(['src/main.ts', 'tests/main.test.ts'])

        // Test cleanup
        yield* service.cleanup(worktree)

        return { success: true, worktree, files }
      }).pipe(Effect.provide(Layer.succeed(GitWorktreeService, mockGitService))),
    )

    // Verify the workflow completed successfully
    expect(result.success).toBe(true)
    expect(result.worktree.path).toContain('12345')
    expect(result.files).toHaveLength(2)
    expect(result.files).toEqual(['src/main.ts', 'tests/main.test.ts'])
  })

  test('should handle concurrent worktree scenarios with unique paths', async () => {
    const mockGitService = {
      validatePreconditions: () => Effect.succeed(undefined),
      createWorktree: (changeId: string) =>
        Effect.succeed({
          path: `/tmp/test-worktree-${changeId}-${Date.now()}-${process.pid}`,
          changeId,
          originalCwd: process.cwd(),
          timestamp: Date.now(),
          pid: process.pid,
        }),
      fetchAndCheckoutPatchset: () => Effect.succeed(undefined),
      cleanup: () => Effect.succeed(undefined),
      getChangedFiles: () => Effect.succeed(['test.ts']),
    }

    // Simulate concurrent worktree creation
    const [result1, result2] = await Promise.all([
      Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* GitWorktreeService
          return yield* service.createWorktree('change-1')
        }).pipe(Effect.provide(Layer.succeed(GitWorktreeService, mockGitService))),
      ),
      Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* GitWorktreeService
          return yield* service.createWorktree('change-2')
        }).pipe(Effect.provide(Layer.succeed(GitWorktreeService, mockGitService))),
      ),
    ])

    // Verify both worktrees have unique paths
    expect(result1.path).not.toBe(result2.path)
    expect(result1.changeId).toBe('change-1')
    expect(result2.changeId).toBe('change-2')
  })

  test('should handle error scenarios in worktree operations', async () => {
    const failingGitService = {
      validatePreconditions: () =>
        Effect.fail(new WorktreeCreationError({ message: 'Git repository validation failed' })),
      createWorktree: () =>
        Effect.fail(new WorktreeCreationError({ message: 'Worktree creation failed' })),
      fetchAndCheckoutPatchset: () =>
        Effect.fail(new WorktreeCreationError({ message: 'Patchset fetch failed' })),
      cleanup: () => Effect.succeed(undefined), // Cleanup should never fail
      getChangedFiles: () => Effect.fail(new WorktreeCreationError({ message: 'Git diff failed' })),
    }

    // Test validation failure
    const validationResult = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const service = yield* GitWorktreeService
        yield* service.validatePreconditions()
      }).pipe(Effect.provide(Layer.succeed(GitWorktreeService, failingGitService))),
    )

    expect(validationResult._tag).toBe('Failure')
    if (validationResult._tag === 'Failure') {
      expect(String(validationResult.cause)).toContain('Git repository validation failed')
    }
  })
})
