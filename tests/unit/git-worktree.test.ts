import { describe, test, expect } from 'bun:test'
import { Effect, Layer } from 'effect'
import { GitWorktreeService, WorktreeInfo } from '@/services/git-worktree'

describe('GitWorktreeService Types and Structure', () => {
  test('should export WorktreeInfo interface with correct structure', () => {
    const mockWorktreeInfo: WorktreeInfo = {
      path: '/tmp/test-worktree',
      changeId: '12345',
      originalCwd: '/test/current',
      timestamp: Date.now(),
      pid: process.pid,
    }

    expect(mockWorktreeInfo.path).toBe('/tmp/test-worktree')
    expect(mockWorktreeInfo.changeId).toBe('12345')
    expect(mockWorktreeInfo.originalCwd).toBe('/test/current')
    expect(typeof mockWorktreeInfo.timestamp).toBe('number')
    expect(typeof mockWorktreeInfo.pid).toBe('number')
  })

  test('should create service tag correctly', () => {
    expect(GitWorktreeService).toBeDefined()
    expect(typeof GitWorktreeService).toBe('object')
    expect(GitWorktreeService.key).toBe('GitWorktreeService')
  })

  test('should be able to create mock service implementation', async () => {
    const mockService = {
      validatePreconditions: () => Effect.succeed(undefined),
      createWorktree: (changeId: string) =>
        Effect.succeed({
          path: `/tmp/test-worktree-${changeId}`,
          changeId,
          originalCwd: process.cwd(),
          timestamp: Date.now(),
          pid: process.pid,
        }),
      fetchAndCheckoutPatchset: () => Effect.succeed(undefined),
      cleanup: () => Effect.succeed(undefined),
      getChangedFiles: () => Effect.succeed(['test.ts']),
    }

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* GitWorktreeService
        const worktree = yield* service.createWorktree('12345')
        return worktree
      }).pipe(Effect.provide(Layer.succeed(GitWorktreeService, mockService))),
    )

    expect(result.changeId).toBe('12345')
    expect(result.path).toContain('12345')
  })
})
