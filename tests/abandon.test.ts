import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Effect, Layer } from 'effect'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { GerritApiServiceLive } from '@/api/gerrit'
import { abandonCommand } from '@/cli/commands/abandon'
import { ConfigService } from '@/services/config'
import { createMockConfigService } from './helpers/config-mock'
import type { ChangeInfo } from '@/schemas/gerrit'

const mockChange: ChangeInfo = {
  id: 'test-project~master~I123',
  _number: 12345,
  change_id: 'I123',
  project: 'test-project',
  branch: 'master',
  subject: 'Test change to abandon',
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

describe('abandon command', () => {
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

  it('should abandon a change with a message', async () => {
    server.use(
      http.get('*/a/changes/12345', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockChange)}`)
      }),
      http.post('*/a/changes/12345/abandon', async ({ request }) => {
        const body = (await request.json()) as { message?: string }
        expect(body.message).toBe('No longer needed')
        return HttpResponse.text(")]}'\n{}")
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = abandonCommand('12345', {
      message: 'No longer needed',
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Abandoned change 12345')
    expect(output).toContain('Test change to abandon')
    expect(output).toContain('Message: No longer needed')
  })

  it('should abandon a change without a message', async () => {
    server.use(
      http.get('*/a/changes/12345', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockChange)}`)
      }),
      http.post('*/a/changes/12345/abandon', async ({ request }) => {
        const body = (await request.json()) as { message?: string }
        expect(body.message).toBeUndefined()
        return HttpResponse.text(")]}'\n{}")
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = abandonCommand('12345', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Abandoned change 12345')
    expect(output).toContain('Test change to abandon')
    expect(output).not.toContain('Message:')
  })

  it('should output XML format when --xml flag is used', async () => {
    server.use(
      http.get('*/a/changes/12345', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockChange)}`)
      }),
      http.post('*/a/changes/12345/abandon', async ({ request }) => {
        const body = (await request.json()) as { message?: string }
        expect(body.message).toBe('Abandoning for testing')
        return HttpResponse.text(")]}'\n{}")
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = abandonCommand('12345', {
      xml: true,
      message: 'Abandoning for testing',
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(output).toContain('<abandon_result>')
    expect(output).toContain('<status>success</status>')
    expect(output).toContain('<change_number>12345</change_number>')
    expect(output).toContain('<subject><![CDATA[Test change to abandon]]></subject>')
    expect(output).toContain('<message><![CDATA[Abandoning for testing]]></message>')
    expect(output).toContain('</abandon_result>')
  })

  it('should output XML format without message when no message provided', async () => {
    server.use(
      http.get('*/a/changes/12345', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockChange)}`)
      }),
      http.post('*/a/changes/12345/abandon', async () => {
        return HttpResponse.text(")]}'\n{}")
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = abandonCommand('12345', { xml: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('<abandon_result>')
    expect(output).toContain('<status>success</status>')
    expect(output).not.toContain('<message>')
  })

  it('should handle not found errors gracefully', async () => {
    server.use(
      http.get('*/a/changes/99999', () => {
        return HttpResponse.text('Change not found', { status: 404 })
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = abandonCommand('99999', {
      message: 'Test message',
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    // Should fail when change is not found
    await expect(Effect.runPromise(program)).rejects.toThrow()
  })

  it('should show error when change ID is not provided', async () => {
    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = abandonCommand(undefined, {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const errorOutput = mockConsoleError.mock.calls.map((call) => call[0]).join('\n')
    expect(errorOutput).toContain('Change ID is required')
    expect(errorOutput).toContain('Usage: ger abandon <change-id>')
  })

  it('should handle abandon API failure', async () => {
    server.use(
      http.get('*/a/changes/12345', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockChange)}`)
      }),
      http.post('*/a/changes/12345/abandon', () => {
        return HttpResponse.text('Forbidden', { status: 403 })
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = abandonCommand('12345', {
      message: 'Test',
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    // Should throw/fail
    await expect(Effect.runPromise(program)).rejects.toThrow()
  })
})
