import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Effect, Layer } from 'effect'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { GerritApiServiceLive } from '@/api/gerrit'
import { reviewersCommand } from '@/cli/commands/reviewers'
import { ConfigService } from '@/services/config'
import { createMockConfigService } from './helpers/config-mock'

const mockReviewersResponse = [
  {
    _account_id: 1001,
    name: 'Alice Smith',
    email: 'alice@example.com',
    username: 'alice',
    approvals: { 'Code-Review': '0' },
  },
  {
    _account_id: 1002,
    name: 'Bob Jones',
    email: 'bob@example.com',
    username: 'bob',
    approvals: { 'Code-Review': '+1' },
  },
]

const server = setupServer(
  http.get('*/a/accounts/self', ({ request }) => {
    const auth = request.headers.get('Authorization')
    if (!auth || !auth.startsWith('Basic ')) {
      return HttpResponse.text('Unauthorized', { status: 401 })
    }
    return HttpResponse.json({ _account_id: 1000, name: 'Test User', email: 'test@example.com' })
  }),
)

describe('reviewers command', () => {
  let mockConsoleLog: ReturnType<typeof mock>
  let mockConsoleError: ReturnType<typeof mock>
  let mockProcessExit: ReturnType<typeof mock>

  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'bypass' })
  })

  afterAll(() => {
    server.close()
  })

  beforeEach(() => {
    mockConsoleLog = mock(() => {})
    mockConsoleError = mock(() => {})
    mockProcessExit = mock(() => {})
    console.log = mockConsoleLog
    console.error = mockConsoleError
    process.exit = mockProcessExit as unknown as typeof process.exit
  })

  afterEach(() => {
    server.resetHandlers()
  })

  it('should list reviewers with plain output', async () => {
    server.use(
      http.get('*/a/changes/12345/reviewers', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockReviewersResponse)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = reviewersCommand('12345', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Alice Smith')
    expect(output).toContain('alice@example.com')
    expect(output).toContain('Bob Jones')
    expect(output).toContain('bob@example.com')
  })

  it('should handle email-only reviewer (no _account_id, no name)', async () => {
    const emailOnlyReviewer = [{ email: 'ext@external.com', approvals: {} }]
    server.use(
      http.get('*/a/changes/12345/reviewers', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(emailOnlyReviewer)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = reviewersCommand('12345', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const lines = mockConsoleLog.mock.calls.map((call) => call[0] as string)
    expect(lines).toContain('ext@external.com')
    // Must not produce "ext@external.com <ext@external.com>"
    expect(lines.join('\n')).not.toContain('ext@external.com <ext@external.com>')
  })

  it('should output JSON format', async () => {
    server.use(
      http.get('*/a/changes/12345/reviewers', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockReviewersResponse)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = reviewersCommand('12345', { json: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    const parsed = JSON.parse(output) as {
      status: string
      change_id: string
      reviewers: Array<{ account_id?: number; name?: string; email?: string }>
    }
    expect(parsed.status).toBe('success')
    expect(parsed.change_id).toBe('12345')
    expect(parsed.reviewers).toBeArray()
    expect(parsed.reviewers.length).toBe(2)
    expect(parsed.reviewers[0].name).toBe('Alice Smith')
    expect(parsed.reviewers[1].email).toBe('bob@example.com')
  })

  it('should output XML format', async () => {
    server.use(
      http.get('*/a/changes/12345/reviewers', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockReviewersResponse)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = reviewersCommand('12345', { xml: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(output).toContain('<reviewers_result>')
    expect(output).toContain('<status>success</status>')
    expect(output).toContain('<change_id><![CDATA[12345]]></change_id>')
    expect(output).toContain('<name><![CDATA[Alice Smith]]></name>')
    expect(output).toContain('<email><![CDATA[bob@example.com]]></email>')
    expect(output).toContain('</reviewers_result>')
  })

  it('should handle empty reviewers list', async () => {
    server.use(
      http.get('*/a/changes/12345/reviewers', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify([])}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = reviewersCommand('12345', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('No reviewers')
  })

  it('should exit 1 on API error', async () => {
    server.use(
      http.get('*/a/changes/99999/reviewers', () => {
        return HttpResponse.text('Not Found', { status: 404 })
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = reviewersCommand('99999', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const errorOutput = mockConsoleError.mock.calls.map((call) => call[0]).join('\n')
    expect(errorOutput).toContain('Error:')
    expect(mockProcessExit.mock.calls[0][0]).toBe(1)
  })

  it('should exit 1 and output XML on API error with --xml', async () => {
    server.use(
      http.get('*/a/changes/99999/reviewers', () => {
        return HttpResponse.text('Forbidden', { status: 403 })
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = reviewersCommand('99999', { xml: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('<reviewers_result>')
    expect(output).toContain('<status>error</status>')
    expect(output).toContain('</reviewers_result>')
    expect(mockProcessExit.mock.calls[0][0]).toBe(1)
  })

  it('should exit 1 and output JSON on API error with --json', async () => {
    server.use(
      http.get('*/a/changes/99999/reviewers', () => {
        return HttpResponse.text('Not Found', { status: 404 })
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = reviewersCommand('99999', { json: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    const parsed = JSON.parse(output) as { status: string; error: string }
    expect(parsed.status).toBe('error')
    expect(typeof parsed.error).toBe('string')
    expect(parsed.error.length).toBeGreaterThan(0)
    expect(mockProcessExit.mock.calls[0][0]).toBe(1)
  })

  it('should exit 1 when no change-id and HEAD has no Change-Id', async () => {
    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = reviewersCommand(undefined, {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const errorOutput = mockConsoleError.mock.calls.map((call) => call[0]).join('\n')
    expect(errorOutput).toContain('Error:')
    expect(errorOutput).toContain('No Change-ID found in HEAD commit')
    expect(mockProcessExit.mock.calls[0][0]).toBe(1)
  })
})
