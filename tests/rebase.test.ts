import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Effect, Layer } from 'effect'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { GerritApiServiceLive } from '@/api/gerrit'
import { rebaseCommand } from '@/cli/commands/rebase'
import { ConfigService } from '@/services/config'
import { createMockConfigService } from './helpers/config-mock'
import type { ChangeInfo } from '@/schemas/gerrit'

const mockChange: ChangeInfo = {
  id: 'test-project~master~I123',
  _number: 12345,
  change_id: 'I123',
  project: 'test-project',
  branch: 'master',
  subject: 'Test change to rebase',
  status: 'NEW',
  created: '2024-01-01 10:00:00.000000000',
  updated: '2024-01-01 12:00:00.000000000',
  owner: {
    _account_id: 1000,
    name: 'Test User',
    email: 'test@example.com',
  },
  labels: {
    'Code-Review': {
      value: 0,
    },
    Verified: {
      value: 0,
    },
  },
  work_in_progress: false,
  submittable: false,
}

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

describe('rebase command', () => {
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

  it('should rebase a change without a base', async () => {
    server.use(
      http.post('*/a/changes/12345/revisions/current/rebase', async ({ request }) => {
        const body = (await request.json()) as { base?: string }
        expect(body.base).toBeUndefined()
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockChange)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = rebaseCommand('12345', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Rebased change 12345')
    expect(output).toContain('Test change to rebase')
    expect(output).toContain('Branch: master')
    expect(output).not.toContain('Base:')
  })

  it('should rebase a change with a specified base', async () => {
    server.use(
      http.post('*/a/changes/12345/revisions/current/rebase', async ({ request }) => {
        const body = (await request.json()) as { base?: string }
        expect(body.base).toBe('refs/heads/main')
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockChange)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = rebaseCommand('12345', {
      base: 'refs/heads/main',
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Rebased change 12345')
    expect(output).toContain('Test change to rebase')
    expect(output).toContain('Branch: master')
    expect(output).toContain('Base: refs/heads/main')
  })

  it('should output XML format when --xml flag is used', async () => {
    server.use(
      http.post('*/a/changes/12345/revisions/current/rebase', async () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockChange)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = rebaseCommand('12345', { xml: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(output).toContain('<rebase_result>')
    expect(output).toContain('<status>success</status>')
    expect(output).toContain('<change_number>12345</change_number>')
    expect(output).toContain('<subject><![CDATA[Test change to rebase]]></subject>')
    expect(output).toContain('<branch>master</branch>')
    expect(output).toContain('</rebase_result>')
  })

  it('should output XML format with base when --base is provided', async () => {
    server.use(
      http.post('*/a/changes/12345/revisions/current/rebase', async ({ request }) => {
        const body = (await request.json()) as { base?: string }
        expect(body.base).toBe('refs/heads/develop')
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockChange)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = rebaseCommand('12345', {
      xml: true,
      base: 'refs/heads/develop',
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('<rebase_result>')
    expect(output).toContain('<status>success</status>')
    expect(output).toContain('<base><![CDATA[refs/heads/develop]]></base>')
    expect(output).toContain('</rebase_result>')
  })

  it('should handle not found errors gracefully with pretty output', async () => {
    server.use(
      http.post('*/a/changes/99999/revisions/current/rebase', () => {
        return HttpResponse.text('Change not found', { status: 404 })
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = rebaseCommand('99999', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    // Error boundary catches and outputs to console.error
    await Effect.runPromise(program)

    const errorOutput = mockConsoleError.mock.calls.map((call) => call[0]).join('\n')
    expect(errorOutput).toContain('Error:')
  })

  it('should handle not found errors with XML output when --xml flag is used', async () => {
    server.use(
      http.post('*/a/changes/99999/revisions/current/rebase', () => {
        return HttpResponse.text('Change not found', { status: 404 })
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = rebaseCommand('99999', { xml: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    // Error boundary catches and outputs XML error
    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(output).toContain('<rebase_result>')
    expect(output).toContain('<status>error</status>')
    expect(output).toContain('<error><![CDATA[')
    expect(output).toContain('</rebase_result>')
  })

  it('should output error to console.error when no change ID and HEAD has no Change-Id', async () => {
    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = rebaseCommand(undefined, {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    // Error boundary catches NoChangeIdError and outputs to console.error
    await Effect.runPromise(program)

    const errorOutput = mockConsoleError.mock.calls.map((call) => call[0]).join('\n')
    expect(errorOutput).toContain('Error:')
    expect(errorOutput).toContain('No Change-ID found in HEAD commit')
  })

  it('should output XML error when no change ID and HEAD has no Change-Id with --xml flag', async () => {
    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = rebaseCommand(undefined, { xml: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    // Error boundary catches NoChangeIdError and outputs XML error
    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(output).toContain('<rebase_result>')
    expect(output).toContain('<status>error</status>')
    expect(output).toContain('No Change-ID found in HEAD commit')
    expect(output).toContain('</rebase_result>')
  })

  it('should treat empty string as missing change ID and auto-detect', async () => {
    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = rebaseCommand('', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    // Empty string triggers auto-detection, which fails with NoChangeIdError
    await Effect.runPromise(program)

    const errorOutput = mockConsoleError.mock.calls.map((call) => call[0]).join('\n')
    expect(errorOutput).toContain('Error:')
    expect(errorOutput).toContain('No Change-ID found in HEAD commit')
  })

  it('should handle rebase conflicts gracefully', async () => {
    server.use(
      http.post('*/a/changes/12345/revisions/current/rebase', () => {
        return HttpResponse.text('Rebase conflict detected', { status: 409 })
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = rebaseCommand('12345', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    // Error boundary catches and outputs to console.error
    await Effect.runPromise(program)

    const errorOutput = mockConsoleError.mock.calls.map((call) => call[0]).join('\n')
    expect(errorOutput).toContain('Error:')
  })

  it('should handle API errors gracefully', async () => {
    server.use(
      http.post('*/a/changes/12345/revisions/current/rebase', () => {
        return HttpResponse.text('Forbidden', { status: 403 })
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = rebaseCommand('12345', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    // Error boundary catches and outputs to console.error
    await Effect.runPromise(program)

    const errorOutput = mockConsoleError.mock.calls.map((call) => call[0]).join('\n')
    expect(errorOutput).toContain('Error:')
  })

  it('should handle changes that are already up to date', async () => {
    server.use(
      http.post('*/a/changes/12345/revisions/current/rebase', () => {
        return HttpResponse.text('Change is already up to date', { status: 409 })
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = rebaseCommand('12345', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    // Error boundary catches and outputs to console.error
    await Effect.runPromise(program)

    const errorOutput = mockConsoleError.mock.calls.map((call) => call[0]).join('\n')
    expect(errorOutput).toContain('Error:')
  })

  it('should handle network errors gracefully', async () => {
    server.use(
      http.post('*/a/changes/12345/revisions/current/rebase', () => {
        return HttpResponse.error()
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = rebaseCommand('12345', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    // Error boundary catches and outputs to console.error
    await Effect.runPromise(program)

    const errorOutput = mockConsoleError.mock.calls.map((call) => call[0]).join('\n')
    expect(errorOutput).toContain('Error:')
  })

  it('should handle network errors with XML output', async () => {
    server.use(
      http.post('*/a/changes/12345/revisions/current/rebase', () => {
        return HttpResponse.error()
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = rebaseCommand('12345', { xml: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    // Error boundary catches and outputs XML error
    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(output).toContain('<rebase_result>')
    expect(output).toContain('<status>error</status>')
    expect(output).toContain('<error><![CDATA[')
    expect(output).toContain('</rebase_result>')
  })
})
