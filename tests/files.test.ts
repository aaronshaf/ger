import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Effect, Layer } from 'effect'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { GerritApiServiceLive } from '@/api/gerrit'
import { filesCommand } from '@/cli/commands/files'
import { ConfigService } from '@/services/config'
import { createMockConfigService } from './helpers/config-mock'

const mockFilesResponse = {
  '/COMMIT_MSG': { status: 'A' as const, lines_inserted: 10 },
  'src/foo.ts': { status: 'M' as const, lines_inserted: 5, lines_deleted: 2 },
  'src/bar.ts': { status: 'A' as const, lines_inserted: 20 },
  'src/old.ts': { status: 'D' as const, lines_deleted: 30 },
}

const server = setupServer(
  http.get('*/a/accounts/self', ({ request }) => {
    const auth = request.headers.get('Authorization')
    if (!auth || !auth.startsWith('Basic ')) {
      return HttpResponse.text('Unauthorized', { status: 401 })
    }
    return HttpResponse.json({ _account_id: 1000, name: 'Test User', email: 'test@example.com' })
  }),
)

describe('files command', () => {
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

  it('should list changed files with plain output', async () => {
    server.use(
      http.get('*/a/changes/12345/revisions/current/files', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockFilesResponse)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = filesCommand('12345', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).not.toContain('/COMMIT_MSG')
    expect(output).toContain('M src/foo.ts')
    expect(output).toContain('A src/bar.ts')
    expect(output).toContain('D src/old.ts')
  })

  it('should output JSON format', async () => {
    server.use(
      http.get('*/a/changes/12345/revisions/current/files', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockFilesResponse)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = filesCommand('12345', { json: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    const parsed = JSON.parse(output) as { status: string; change_id: string; files: unknown[] }
    expect(parsed.status).toBe('success')
    expect(parsed.change_id).toBe('12345')
    expect(parsed.files).toBeArray()
    const paths = (parsed.files as Array<{ path: string }>).map((f) => f.path)
    expect(paths).not.toContain('/COMMIT_MSG')
    expect(paths).toContain('src/foo.ts')
  })

  it('should output XML format', async () => {
    server.use(
      http.get('*/a/changes/12345/revisions/current/files', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockFilesResponse)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = filesCommand('12345', { xml: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(output).toContain('<files_result>')
    expect(output).toContain('<status>success</status>')
    expect(output).toContain('<change_id><![CDATA[12345]]></change_id>')
    expect(output).toContain('<path><![CDATA[src/foo.ts]]></path>')
    expect(output).not.toContain('/COMMIT_MSG')
    expect(output).toContain('</files_result>')
  })

  it('should handle empty files response (only magic files)', async () => {
    server.use(
      http.get('*/a/changes/12345/revisions/current/files', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify({ '/COMMIT_MSG': { status: 'A' } })}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = filesCommand('12345', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).not.toContain('/COMMIT_MSG')
  })

  it('should exit 1 on API error', async () => {
    server.use(
      http.get('*/a/changes/99999/revisions/current/files', () => {
        return HttpResponse.text('Not Found', { status: 404 })
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = filesCommand('99999', {}).pipe(
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
      http.get('*/a/changes/99999/revisions/current/files', () => {
        return HttpResponse.text('Not Found', { status: 404 })
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = filesCommand('99999', { xml: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('<files_result>')
    expect(output).toContain('<status>error</status>')
    expect(output).toContain('</files_result>')
    expect(mockProcessExit.mock.calls[0][0]).toBe(1)
  })

  it('should exit 1 and output JSON on API error with --json', async () => {
    server.use(
      http.get('*/a/changes/99999/revisions/current/files', () => {
        return HttpResponse.text('Not Found', { status: 404 })
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = filesCommand('99999', { json: true }).pipe(
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
    const program = filesCommand(undefined, {}).pipe(
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
