import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Effect, Layer } from 'effect'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { GerritApiServiceLive } from '@/api/gerrit'
import { voteCommand } from '@/cli/commands/vote'
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

describe('vote command', () => {
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

  it('should vote with Code-Review only', async () => {
    server.use(
      http.post('*/a/changes/12345/revisions/current/review', async ({ request }) => {
        const body = (await request.json()) as { labels?: Record<string, number>; message?: string }
        expect(body.labels).toEqual({ 'Code-Review': 2 })
        expect(body.message).toBeUndefined()
        return HttpResponse.text(")]}'\n{}")
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = voteCommand('12345', {
      codeReview: 2,
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Voted on change 12345')
    expect(output).toContain('Code-Review: +2')
  })

  it('should vote with Code-Review and Verified', async () => {
    server.use(
      http.post('*/a/changes/12345/revisions/current/review', async ({ request }) => {
        const body = (await request.json()) as { labels?: Record<string, number>; message?: string }
        expect(body.labels).toEqual({ 'Code-Review': 1, Verified: 1 })
        return HttpResponse.text(")]}'\n{}")
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = voteCommand('12345', {
      codeReview: 1,
      verified: 1,
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Code-Review: +1')
    expect(output).toContain('Verified: +1')
  })

  it('should vote with negative values', async () => {
    server.use(
      http.post('*/a/changes/12345/revisions/current/review', async ({ request }) => {
        const body = (await request.json()) as { labels?: Record<string, number>; message?: string }
        expect(body.labels).toEqual({ 'Code-Review': -2, Verified: -1 })
        return HttpResponse.text(")]}'\n{}")
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = voteCommand('12345', {
      codeReview: -2,
      verified: -1,
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Code-Review: -2')
    expect(output).toContain('Verified: -1')
  })

  it('should vote with message', async () => {
    server.use(
      http.post('*/a/changes/12345/revisions/current/review', async ({ request }) => {
        const body = (await request.json()) as { labels?: Record<string, number>; message?: string }
        expect(body.labels).toEqual({ 'Code-Review': 2 })
        expect(body.message).toBe('Looks good to me!')
        return HttpResponse.text(")]}'\n{}")
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = voteCommand('12345', {
      codeReview: 2,
      message: 'Looks good to me!',
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Code-Review: +2')
    expect(output).toContain('Message: Looks good to me!')
  })

  it('should vote with custom labels', async () => {
    server.use(
      http.post('*/a/changes/12345/revisions/current/review', async ({ request }) => {
        const body = (await request.json()) as { labels?: Record<string, number>; message?: string }
        expect(body.labels).toEqual({ 'Code-Review': 2, 'Custom-Label': 1 })
        return HttpResponse.text(")]}'\n{}")
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = voteCommand('12345', {
      codeReview: 2,
      label: ['Custom-Label', '1'],
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Code-Review: +2')
    expect(output).toContain('Custom-Label: +1')
  })

  it('should vote with multiple custom labels', async () => {
    server.use(
      http.post('*/a/changes/12345/revisions/current/review', async ({ request }) => {
        const body = (await request.json()) as { labels?: Record<string, number>; message?: string }
        expect(body.labels).toEqual({ 'Label-A': 1, 'Label-B': -1 })
        return HttpResponse.text(")]}'\n{}")
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = voteCommand('12345', {
      label: ['Label-A', '1', 'Label-B', '-1'],
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Label-A: +1')
    expect(output).toContain('Label-B: -1')
  })

  it('should output XML format when --xml flag is used', async () => {
    server.use(
      http.post('*/a/changes/12345/revisions/current/review', async ({ request }) => {
        const body = (await request.json()) as { labels?: Record<string, number>; message?: string }
        expect(body.labels).toEqual({ 'Code-Review': 2, Verified: 1 })
        expect(body.message).toBe('LGTM')
        return HttpResponse.text(")]}'\n{}")
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = voteCommand('12345', {
      xml: true,
      codeReview: 2,
      verified: 1,
      message: 'LGTM',
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(output).toContain('<vote_result>')
    expect(output).toContain('<status>success</status>')
    expect(output).toContain('<change_id>12345</change_id>')
    expect(output).toContain('<label name="Code-Review">2</label>')
    expect(output).toContain('<label name="Verified">1</label>')
    expect(output).toContain('<message><![CDATA[LGTM]]></message>')
    expect(output).toContain('</vote_result>')
  })

  it('should output XML format without message when no message provided', async () => {
    server.use(
      http.post('*/a/changes/12345/revisions/current/review', async () => {
        return HttpResponse.text(")]}'\n{}")
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = voteCommand('12345', {
      xml: true,
      codeReview: 1,
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('<vote_result>')
    expect(output).toContain('<status>success</status>')
    expect(output).not.toContain('<message>')
  })

  it('should show error when change ID is not provided', async () => {
    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = voteCommand(undefined, { codeReview: 2 }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const errorOutput = mockConsoleError.mock.calls.map((call) => call[0]).join('\n')
    expect(errorOutput).toContain('Change ID is required')
    expect(errorOutput).toContain('Usage: ger vote <change-id>')
  })

  it('should show error when no labels are provided', async () => {
    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = voteCommand('12345', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const errorOutput = mockConsoleError.mock.calls.map((call) => call[0]).join('\n')
    expect(errorOutput).toContain('At least one label is required')
  })

  it('should handle vote API failure', async () => {
    server.use(
      http.post('*/a/changes/12345/revisions/current/review', () => {
        return HttpResponse.text('Forbidden', { status: 403 })
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = voteCommand('12345', {
      codeReview: 2,
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    // Should throw/fail
    await expect(Effect.runPromise(program)).rejects.toThrow()
  })

  it('should handle not found errors gracefully', async () => {
    server.use(
      http.post('*/a/changes/99999/revisions/current/review', () => {
        return HttpResponse.text('Change not found', { status: 404 })
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = voteCommand('99999', {
      codeReview: 2,
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    // Should fail when change is not found
    await expect(Effect.runPromise(program)).rejects.toThrow()
  })

  it('should reject invalid custom label value', async () => {
    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = voteCommand('12345', {
      label: ['Custom-Label', 'not-a-number'],
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await Effect.runPromise(program)

    const errorOutput = mockConsoleError.mock.calls.map((call) => call[0]).join('\n')
    expect(errorOutput).toContain('Invalid label value')
    expect(errorOutput).toContain('Label values must be integers')
  })

  it('should reject odd number of label arguments', async () => {
    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = voteCommand('12345', {
      label: ['Custom-Label', '1', 'Another-Label'],
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await Effect.runPromise(program)

    const errorOutput = mockConsoleError.mock.calls.map((call) => call[0]).join('\n')
    expect(errorOutput).toContain('Invalid label format')
    expect(errorOutput).toContain('name-value pairs')
  })
})
