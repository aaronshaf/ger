import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Effect, Layer } from 'effect'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { GerritApiServiceLive } from '@/api/gerrit'
import { removeReviewerCommand } from '@/cli/commands/remove-reviewer'
import { ConfigService } from '@/services/config'
import { createMockConfigService } from './helpers/config-mock'

// Create MSW server
const server = setupServer(
  // Default handler for auth check
  http.get('*/a/accounts/self', ({ request }) => {
    const auth = request.headers.get('Authorization')
    if (!auth || !auth.startsWith('Basic ')) {
      return HttpResponse.text('Unauthorized', { status: 401 })
    }
    return HttpResponse.json({
      _account_id: 1000,
      name: 'Test User',
      email: 'test@example.com',
    })
  }),
)

describe('remove-reviewer command', () => {
  let mockConsoleLog: ReturnType<typeof mock>
  let mockConsoleError: ReturnType<typeof mock>

  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'bypass' })
  })

  afterAll(() => {
    server.close()
  })

  beforeEach(() => {
    mockConsoleLog = mock(() => {})
    mockConsoleError = mock(() => {})
    console.log = mockConsoleLog
    console.error = mockConsoleError
  })

  afterEach(() => {
    server.resetHandlers()
  })

  it('should remove a single reviewer successfully', async () => {
    server.use(
      http.post('*/a/changes/12345/reviewers/reviewer%40example.com/delete', async () => {
        // Gerrit returns 204 No Content on success, which translates to empty response
        return HttpResponse.text(`)]}'\n{}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = removeReviewerCommand(['reviewer@example.com'], {
      change: '12345',
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Removed reviewer@example.com')
  })

  it('should remove multiple reviewers successfully', async () => {
    let callCount = 0
    server.use(
      http.post('*/a/changes/12345/reviewers/*/delete', async () => {
        callCount++
        return HttpResponse.text(`)]}'\n{}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = removeReviewerCommand(['user1@example.com', 'user2@example.com'], {
      change: '12345',
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Removed user1@example.com')
    expect(output).toContain('Removed user2@example.com')
    expect(callCount).toBe(2)
  })

  it('should pass notify option to API', async () => {
    let receivedNotify: string | undefined
    server.use(
      http.post(
        '*/a/changes/12345/reviewers/reviewer%40example.com/delete',
        async ({ request }) => {
          const body = (await request.json()) as { notify?: string }
          receivedNotify = body.notify
          return HttpResponse.text(`)]}'\n{}`)
        },
      ),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = removeReviewerCommand(['reviewer@example.com'], {
      change: '12345',
      notify: 'none',
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await Effect.runPromise(program)

    expect(receivedNotify).toBe('NONE')
  })

  it('should handle not found errors gracefully', async () => {
    server.use(
      http.post('*/a/changes/12345/reviewers/*/delete', async () => {
        return HttpResponse.text('Not Found', { status: 404 })
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = removeReviewerCommand(['nonexistent@example.com'], {
      change: '12345',
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await Effect.runPromise(program)

    const errorOutput = mockConsoleError.mock.calls.map((call) => call[0]).join('\n')
    expect(errorOutput).toContain('Failed to remove nonexistent@example.com')
  })

  it('should show error when change ID is not provided', async () => {
    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = removeReviewerCommand(['reviewer@example.com'], {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    const result = await Effect.runPromiseExit(program)
    expect(result._tag).toBe('Failure')

    const errorOutput = mockConsoleError.mock.calls.map((call) => call[0]).join('\n')
    expect(errorOutput).toContain('Change ID is required')
  })

  it('should show error when no reviewers are provided', async () => {
    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = removeReviewerCommand([], {
      change: '12345',
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    const result = await Effect.runPromiseExit(program)
    expect(result._tag).toBe('Failure')

    const errorOutput = mockConsoleError.mock.calls.map((call) => call[0]).join('\n')
    expect(errorOutput).toContain('At least one reviewer is required')
  })

  it('should output XML format when --xml flag is used', async () => {
    server.use(
      http.post('*/a/changes/12345/reviewers/reviewer%40example.com/delete', async () => {
        return HttpResponse.text(`)]}'\n{}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = removeReviewerCommand(['reviewer@example.com'], {
      change: '12345',
      xml: true,
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(output).toContain('<remove_reviewer_result>')
    expect(output).toContain('<change_id>12345</change_id>')
    expect(output).toContain('<reviewer status="removed">')
    expect(output).toContain('<input>reviewer@example.com</input>')
    expect(output).toContain('<status>success</status>')
    expect(output).toContain('</remove_reviewer_result>')
  })

  it('should output XML format for errors when --xml flag is used', async () => {
    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = removeReviewerCommand(['reviewer@example.com'], {
      xml: true,
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    const result = await Effect.runPromiseExit(program)
    expect(result._tag).toBe('Failure')

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(output).toContain('<remove_reviewer_result>')
    expect(output).toContain('<status>error</status>')
    expect(output).toContain('<error><![CDATA[Change ID is required')
    expect(output).toContain('</remove_reviewer_result>')
  })

  it('should handle network errors gracefully', async () => {
    server.use(
      http.post('*/a/changes/12345/reviewers/*/delete', () => {
        return HttpResponse.text('Internal Server Error', { status: 500 })
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = removeReviewerCommand(['reviewer@example.com'], {
      change: '12345',
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await Effect.runPromise(program)

    const errorOutput = mockConsoleError.mock.calls.map((call) => call[0]).join('\n')
    expect(errorOutput).toContain('Failed to remove reviewer@example.com')
  })

  it('should handle partial success with multiple reviewers', async () => {
    let callCount = 0
    server.use(
      http.post('*/a/changes/12345/reviewers/*/delete', async ({ request }) => {
        callCount++
        const url = new URL(request.url)
        if (url.pathname.includes('invalid')) {
          return HttpResponse.text('Not Found', { status: 404 })
        }
        return HttpResponse.text(`)]}'\n{}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = removeReviewerCommand(['valid@example.com', 'invalid@example.com'], {
      change: '12345',
      xml: true,
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('<status>partial_failure</status>')
    expect(output).toContain('<reviewer status="removed">')
    expect(output).toContain('<reviewer status="failed">')
  })

  it('should reject invalid notify option', async () => {
    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = removeReviewerCommand(['reviewer@example.com'], {
      change: '12345',
      notify: 'invalid',
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    const result = await Effect.runPromiseExit(program)
    expect(result._tag).toBe('Failure')

    const errorOutput = mockConsoleError.mock.calls.map((call) => call[0]).join('\n')
    expect(errorOutput).toContain('Invalid notify level: invalid')
    expect(errorOutput).toContain('Valid values: none, owner, owner_reviewers, all')
  })

  it('should support account ID format', async () => {
    server.use(
      http.post('*/a/changes/12345/reviewers/1001/delete', async () => {
        return HttpResponse.text(`)]}'\n{}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = removeReviewerCommand(['1001'], {
      change: '12345',
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Removed 1001')
  })

  it('should support username format', async () => {
    server.use(
      http.post('*/a/changes/12345/reviewers/johndoe/delete', async () => {
        return HttpResponse.text(`)]}'\n{}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = removeReviewerCommand(['johndoe'], {
      change: '12345',
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Removed johndoe')
  })

  it('should support Change-ID format', async () => {
    server.use(
      http.post(
        '*/a/changes/If5a3ae8cb5a107e187447802358417f311d0c4b1/reviewers/*/delete',
        async () => {
          return HttpResponse.text(`)]}'\n{}`)
        },
      ),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = removeReviewerCommand(['reviewer@example.com'], {
      change: 'If5a3ae8cb5a107e187447802358417f311d0c4b1',
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Removed reviewer@example.com')
  })

  it('should handle special characters in reviewer name with proper URL encoding', async () => {
    server.use(
      http.post('*/a/changes/12345/reviewers/user%2Btest%40example.com/delete', async () => {
        return HttpResponse.text(`)]}'\n{}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = removeReviewerCommand(['user+test@example.com'], {
      change: '12345',
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Removed user+test@example.com')
  })

  it('should sanitize CDATA content in XML error output', async () => {
    server.use(
      http.post('*/a/changes/12345/reviewers/*/delete', async () => {
        return HttpResponse.text('Error with ]]> CDATA breaker', { status: 500 })
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = removeReviewerCommand(['reviewer@example.com'], {
      change: '12345',
      xml: true,
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    // The ]]> in the error message should be escaped to ]]&gt; to prevent CDATA injection
    expect(output).toContain(']]&gt; CDATA breaker')
    // Ensure the actual CDATA closing sequence is not in the content (only as valid XML tag closing)
    expect(output).not.toContain(']]> CDATA')
  })
})
