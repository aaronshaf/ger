import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Effect, Layer } from 'effect'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { GerritApiServiceLive } from '@/api/gerrit'
import { restoreCommand } from '@/cli/commands/restore'
import { ConfigService } from '@/services/config'
import { createMockConfigService } from './helpers/config-mock'
import type { ChangeInfo } from '@/schemas/gerrit'

const mockChange: ChangeInfo = {
  id: 'test-project~master~I123',
  _number: 12345,
  change_id: 'I123',
  project: 'test-project',
  branch: 'master',
  subject: 'Test change to restore',
  status: 'ABANDONED',
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

const mockRestoredChange: ChangeInfo = {
  ...mockChange,
  status: 'NEW',
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

describe('restore command', () => {
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

  it('should restore a change with a message', async () => {
    server.use(
      http.post('*/a/changes/12345/restore', async ({ request }) => {
        const body = (await request.json()) as { message?: string }
        expect(body.message).toBe('Restoring this change')
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockRestoredChange)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = restoreCommand('12345', {
      message: 'Restoring this change',
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Restored change 12345')
    expect(output).toContain('Test change to restore')
    expect(output).toContain('Message: Restoring this change')
  })

  it('should restore a change without a message', async () => {
    server.use(
      http.post('*/a/changes/12345/restore', async ({ request }) => {
        const body = (await request.json()) as { message?: string }
        expect(body.message).toBeUndefined()
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockRestoredChange)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = restoreCommand('12345', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Restored change 12345')
    expect(output).toContain('Test change to restore')
    expect(output).not.toContain('Message:')
  })

  it('should output XML format when --xml flag is used', async () => {
    server.use(
      http.post('*/a/changes/12345/restore', async ({ request }) => {
        const body = (await request.json()) as { message?: string }
        expect(body.message).toBe('Restoring for testing')
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockRestoredChange)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = restoreCommand('12345', {
      xml: true,
      message: 'Restoring for testing',
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(output).toContain('<restore_result>')
    expect(output).toContain('<status>success</status>')
    expect(output).toContain('<change_number>12345</change_number>')
    expect(output).toContain('<subject><![CDATA[Test change to restore]]></subject>')
    expect(output).toContain('<message><![CDATA[Restoring for testing]]></message>')
    expect(output).toContain('</restore_result>')
  })

  it('should output XML format without message when no message provided', async () => {
    server.use(
      http.post('*/a/changes/12345/restore', async () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockRestoredChange)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = restoreCommand('12345', { xml: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('<restore_result>')
    expect(output).toContain('<status>success</status>')
    expect(output).not.toContain('<message>')
  })

  it('should handle not found errors gracefully', async () => {
    server.use(
      http.post('*/a/changes/99999/restore', () => {
        return HttpResponse.text('Change not found', { status: 404 })
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = restoreCommand('99999', {
      message: 'Test message',
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    // Should fail when change is not found
    await expect(Effect.runPromise(program)).rejects.toThrow()
  })

  it('should show error when change ID is not provided', async () => {
    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = restoreCommand(undefined, {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const errorOutput = mockConsoleError.mock.calls.map((call) => call[0]).join('\n')
    expect(errorOutput).toContain('Change ID is required')
    expect(errorOutput).toContain('Usage: ger restore <change-id>')
  })

  it('should handle restore API failure', async () => {
    server.use(
      http.post('*/a/changes/12345/restore', () => {
        return HttpResponse.text('Forbidden', { status: 403 })
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = restoreCommand('12345', {
      message: 'Test',
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    // Should throw/fail
    await expect(Effect.runPromise(program)).rejects.toThrow()
  })

  it('should handle changes that are already active', async () => {
    server.use(
      http.post('*/a/changes/12345/restore', () => {
        return HttpResponse.text('Change is already active', { status: 409 })
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = restoreCommand('12345', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    // Should throw/fail
    await expect(Effect.runPromise(program)).rejects.toThrow()
  })
})
