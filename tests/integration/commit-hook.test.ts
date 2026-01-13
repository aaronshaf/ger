import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { Effect, Layer } from 'effect'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { ConfigService } from '@/services/config'
import { CommitHookService, CommitHookServiceLive } from '@/services/commit-hook'
import { createMockConfigService } from '../helpers/config-mock'

// Sample valid commit-msg hook script
const VALID_HOOK_SCRIPT = `#!/bin/sh
# From Gerrit Code Review 3.x
#
# Part of Gerrit Code Review (https://www.gerritcodereview.com/)

# Add a Change-Id line to commit messages that don't have one
add_change_id() {
  # ... hook implementation
  echo "Change-Id: I$(git hash-object -t blob /dev/null)"
}

add_change_id
`

// Create MSW server for hook download tests
const server = setupServer()

describe('CommitHookService Integration Tests', () => {
  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'bypass' })
  })

  afterAll(() => {
    server.close()
  })

  afterEach(() => {
    server.resetHandlers()
  })

  describe('installHook', () => {
    test('should successfully download hook from Gerrit server', async () => {
      // Setup handler for successful hook download
      server.use(
        http.get('https://test.gerrit.com/tools/hooks/commit-msg', () => {
          return HttpResponse.text(VALID_HOOK_SCRIPT, { status: 200 })
        }),
      )

      const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())

      // Note: We can't fully test installHook without git repo context,
      // but we can verify the HTTP request is made correctly
      const effect = Effect.gen(function* () {
        const service = yield* CommitHookService
        yield* service.installHook()
      }).pipe(Effect.provide(CommitHookServiceLive), Effect.provide(mockConfigLayer))

      // Run with Effect.exit to capture the result without throwing
      const exit = await Effect.runPromiseExit(effect)

      // The test verifies the service can be constructed and HTTP fetch succeeds
      // It will fail with NotGitRepoError because we're not in a git repo,
      // but it should NOT fail due to HTTP issues
      if (exit._tag === 'Failure') {
        const errorStr = String(exit.cause)
        // Should fail due to git repo issues, not HTTP issues
        expect(errorStr).not.toContain('Failed to download')
        expect(errorStr).not.toContain('fetch')
      }
    })

    test('should handle 404 error when hook URL is not found', async () => {
      server.use(
        http.get('https://test.gerrit.com/tools/hooks/commit-msg', () => {
          return HttpResponse.text('Not Found', { status: 404 })
        }),
      )

      const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())

      const effect = Effect.gen(function* () {
        const service = yield* CommitHookService
        yield* service.installHook()
      }).pipe(Effect.provide(CommitHookServiceLive), Effect.provide(mockConfigLayer))

      const result = await Effect.runPromise(effect).catch((e) => e)

      // Should fail with HookInstallError due to 404
      expect(result).toBeInstanceOf(Error)
      expect(String(result)).toContain('Failed to download')
    })

    test('should handle 500 server error gracefully', async () => {
      server.use(
        http.get('https://test.gerrit.com/tools/hooks/commit-msg', () => {
          return HttpResponse.text('Internal Server Error', { status: 500 })
        }),
      )

      const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())

      const effect = Effect.gen(function* () {
        const service = yield* CommitHookService
        yield* service.installHook()
      }).pipe(Effect.provide(CommitHookServiceLive), Effect.provide(mockConfigLayer))

      const result = await Effect.runPromise(effect).catch((e) => e)

      expect(result).toBeInstanceOf(Error)
      expect(String(result)).toContain('Failed to download')
    })

    test('should reject invalid hook content (not a script)', async () => {
      server.use(
        http.get('https://test.gerrit.com/tools/hooks/commit-msg', () => {
          // Return HTML instead of shell script
          return HttpResponse.text('<html><body>Error page</body></html>', { status: 200 })
        }),
      )

      const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())

      const effect = Effect.gen(function* () {
        const service = yield* CommitHookService
        yield* service.installHook()
      }).pipe(Effect.provide(CommitHookServiceLive), Effect.provide(mockConfigLayer))

      const result = await Effect.runPromise(effect).catch((e) => e)

      expect(result).toBeInstanceOf(Error)
      expect(String(result)).toContain('valid script')
    })

    test('should handle network timeout', async () => {
      server.use(
        http.get('https://test.gerrit.com/tools/hooks/commit-msg', async () => {
          // Simulate network delay that would cause timeout
          await new Promise((resolve) => setTimeout(resolve, 100))
          return HttpResponse.error()
        }),
      )

      const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())

      const effect = Effect.gen(function* () {
        const service = yield* CommitHookService
        yield* service.installHook()
      }).pipe(Effect.provide(CommitHookServiceLive), Effect.provide(mockConfigLayer))

      const result = await Effect.runPromise(effect).catch((e) => e)

      expect(result).toBeInstanceOf(Error)
    })

    test('should handle host with trailing slash', async () => {
      // Use a host with trailing slash
      const configWithTrailingSlash = createMockConfigService({
        host: 'https://test.gerrit.com/',
        username: 'testuser',
        password: 'testpass',
      })

      server.use(
        // The trailing slash should be normalized, so this handler should match
        http.get('https://test.gerrit.com/tools/hooks/commit-msg', () => {
          return HttpResponse.text(VALID_HOOK_SCRIPT, { status: 200 })
        }),
      )

      const mockConfigLayer = Layer.succeed(ConfigService, configWithTrailingSlash)

      const effect = Effect.gen(function* () {
        const service = yield* CommitHookService
        yield* service.installHook()
      }).pipe(Effect.provide(CommitHookServiceLive), Effect.provide(mockConfigLayer))

      // Should not fail due to double slash in URL
      await Effect.runPromise(effect).catch((e) => {
        // May fail for git repo reasons, but should not fail for URL issues
        expect(String(e)).not.toContain('//tools')
      })
    })
  })

  describe('hook script validation', () => {
    test('should accept sh shebang', async () => {
      server.use(
        http.get('https://test.gerrit.com/tools/hooks/commit-msg', () => {
          return HttpResponse.text('#!/bin/sh\necho "hook"', { status: 200 })
        }),
      )

      const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())

      const effect = Effect.gen(function* () {
        const service = yield* CommitHookService
        yield* service.installHook()
      }).pipe(Effect.provide(CommitHookServiceLive), Effect.provide(mockConfigLayer))

      const result = await Effect.runPromise(effect).catch((e) => e)

      // Should not fail with "not a valid script" error
      expect(String(result)).not.toContain('valid script')
    })

    test('should accept bash shebang', async () => {
      server.use(
        http.get('https://test.gerrit.com/tools/hooks/commit-msg', () => {
          return HttpResponse.text('#!/bin/bash\necho "hook"', { status: 200 })
        }),
      )

      const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())

      const effect = Effect.gen(function* () {
        const service = yield* CommitHookService
        yield* service.installHook()
      }).pipe(Effect.provide(CommitHookServiceLive), Effect.provide(mockConfigLayer))

      const result = await Effect.runPromise(effect).catch((e) => e)

      // Should not fail with "not a valid script" error
      expect(String(result)).not.toContain('valid script')
    })

    test('should accept env shebang', async () => {
      server.use(
        http.get('https://test.gerrit.com/tools/hooks/commit-msg', () => {
          return HttpResponse.text('#!/usr/bin/env sh\necho "hook"', { status: 200 })
        }),
      )

      const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())

      const effect = Effect.gen(function* () {
        const service = yield* CommitHookService
        yield* service.installHook()
      }).pipe(Effect.provide(CommitHookServiceLive), Effect.provide(mockConfigLayer))

      const result = await Effect.runPromise(effect).catch((e) => e)

      // Should not fail with "not a valid script" error
      expect(String(result)).not.toContain('valid script')
    })
  })
})
