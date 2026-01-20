import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { Effect, Layer, Exit } from 'effect'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { installHookCommand } from '@/cli/commands/install-hook'
import { ConfigService } from '@/services/config'
import { CommitHookService, CommitHookServiceLive } from '@/services/commit-hook'
import { createMockConfigService } from '../../helpers/config-mock'

// Create MSW server for hook download tests
const server = setupServer()

// Helper to create mock commit hook service with configurable hasHook
const createMockCommitHookService = (hookExists: boolean) => ({
  hasHook: () => Effect.succeed(hookExists),
  hasChangeId: () => Effect.succeed(true),
  installHook: () => Effect.void,
  ensureChangeId: () => Effect.void,
  amendWithChangeId: () => Effect.void,
})

describe('install-hook Command', () => {
  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'bypass' })
  })

  afterAll(() => {
    server.close()
  })

  afterEach(() => {
    server.resetHandlers()
  })

  describe('when hook does not exist', () => {
    test('should call installHook when no hook exists', async () => {
      let installHookCalled = false
      const mockService = {
        hasHook: () => Effect.succeed(false),
        hasChangeId: () => Effect.succeed(true),
        installHook: () => {
          installHookCalled = true
          return Effect.void
        },
        ensureChangeId: () => Effect.void,
        amendWithChangeId: () => Effect.void,
      }

      const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
      const mockHookLayer = Layer.succeed(CommitHookService, mockService)

      const effect = installHookCommand({}).pipe(
        Effect.provide(mockHookLayer),
        Effect.provide(mockConfigLayer),
      )

      const exit = await Effect.runPromiseExit(effect)

      expect(Exit.isSuccess(exit)).toBe(true)
      expect(installHookCalled).toBe(true)
    })

    test('should succeed with XML output when no hook exists', async () => {
      const mockService = createMockCommitHookService(false)
      const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
      const mockHookLayer = Layer.succeed(CommitHookService, mockService)

      const effect = installHookCommand({ xml: true }).pipe(
        Effect.provide(mockHookLayer),
        Effect.provide(mockConfigLayer),
      )

      const exit = await Effect.runPromiseExit(effect)

      expect(Exit.isSuccess(exit)).toBe(true)
    })
  })

  describe('when hook already exists', () => {
    test('should skip installation without --force and return success', async () => {
      let installHookCalled = false
      const mockService = {
        hasHook: () => Effect.succeed(true),
        hasChangeId: () => Effect.succeed(true),
        installHook: () => {
          installHookCalled = true
          return Effect.void
        },
        ensureChangeId: () => Effect.void,
        amendWithChangeId: () => Effect.void,
      }

      const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
      const mockHookLayer = Layer.succeed(CommitHookService, mockService)

      const effect = installHookCommand({}).pipe(
        Effect.provide(mockHookLayer),
        Effect.provide(mockConfigLayer),
      )

      const exit = await Effect.runPromiseExit(effect)

      expect(Exit.isSuccess(exit)).toBe(true)
      expect(installHookCalled).toBe(false) // Should NOT call installHook
    })

    test('should skip installation and succeed with XML output', async () => {
      const mockService = createMockCommitHookService(true)
      const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
      const mockHookLayer = Layer.succeed(CommitHookService, mockService)

      const effect = installHookCommand({ xml: true }).pipe(
        Effect.provide(mockHookLayer),
        Effect.provide(mockConfigLayer),
      )

      const exit = await Effect.runPromiseExit(effect)

      expect(Exit.isSuccess(exit)).toBe(true)
    })

    test('should reinstall with --force flag', async () => {
      let installHookCalled = false
      const mockService = {
        hasHook: () => Effect.succeed(true),
        hasChangeId: () => Effect.succeed(true),
        installHook: () => {
          installHookCalled = true
          return Effect.void
        },
        ensureChangeId: () => Effect.void,
        amendWithChangeId: () => Effect.void,
      }

      const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
      const mockHookLayer = Layer.succeed(CommitHookService, mockService)

      const effect = installHookCommand({ force: true }).pipe(
        Effect.provide(mockHookLayer),
        Effect.provide(mockConfigLayer),
      )

      const exit = await Effect.runPromiseExit(effect)

      expect(Exit.isSuccess(exit)).toBe(true)
      expect(installHookCalled).toBe(true) // Should call installHook with --force
    })
  })

  describe('error handling with real service', () => {
    test('should handle HTTP 404 error', async () => {
      server.use(
        http.get('https://test.gerrit.com/tools/hooks/commit-msg', () => {
          return HttpResponse.text('Not Found', { status: 404 })
        }),
      )

      const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())

      const effect = installHookCommand({ force: true }).pipe(
        Effect.provide(CommitHookServiceLive),
        Effect.provide(mockConfigLayer),
      )

      const result = await Effect.runPromise(effect).catch((e) => e)

      expect(result).toBeInstanceOf(Error)
      expect(String(result)).toContain('Failed to download')
    })

    test('should handle HTTP 500 error', async () => {
      server.use(
        http.get('https://test.gerrit.com/tools/hooks/commit-msg', () => {
          return HttpResponse.text('Internal Server Error', { status: 500 })
        }),
      )

      const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())

      const effect = installHookCommand({ force: true }).pipe(
        Effect.provide(CommitHookServiceLive),
        Effect.provide(mockConfigLayer),
      )

      const result = await Effect.runPromise(effect).catch((e) => e)

      expect(result).toBeInstanceOf(Error)
      expect(String(result)).toContain('Failed to download')
    })

    test('should handle invalid script content', async () => {
      server.use(
        http.get('https://test.gerrit.com/tools/hooks/commit-msg', () => {
          return HttpResponse.text('<html>Error</html>', { status: 200 })
        }),
      )

      const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())

      const effect = installHookCommand({ force: true }).pipe(
        Effect.provide(CommitHookServiceLive),
        Effect.provide(mockConfigLayer),
      )

      const result = await Effect.runPromise(effect).catch((e) => e)

      expect(result).toBeInstanceOf(Error)
      expect(String(result)).toContain('valid script')
    })

    test('should handle network error', async () => {
      server.use(
        http.get('https://test.gerrit.com/tools/hooks/commit-msg', () => {
          return HttpResponse.error()
        }),
      )

      const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())

      const effect = installHookCommand({ force: true }).pipe(
        Effect.provide(CommitHookServiceLive),
        Effect.provide(mockConfigLayer),
      )

      const result = await Effect.runPromise(effect).catch((e) => e)

      expect(result).toBeInstanceOf(Error)
    })
  })

  describe('service integration', () => {
    test('should use hasHook from service, not direct function call', async () => {
      let hasHookCalled = false
      const mockService = {
        hasHook: () => {
          hasHookCalled = true
          return Effect.succeed(false)
        },
        hasChangeId: () => Effect.succeed(true),
        installHook: () => Effect.void,
        ensureChangeId: () => Effect.void,
        amendWithChangeId: () => Effect.void,
      }

      const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
      const mockHookLayer = Layer.succeed(CommitHookService, mockService)

      const effect = installHookCommand({}).pipe(
        Effect.provide(mockHookLayer),
        Effect.provide(mockConfigLayer),
      )

      await Effect.runPromiseExit(effect)

      expect(hasHookCalled).toBe(true)
    })
  })
})
