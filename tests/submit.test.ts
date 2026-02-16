import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Effect, Layer } from 'effect'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { GerritApiServiceLive } from '@/api/gerrit'
import { submitCommand } from '@/cli/commands/submit'
import { ConfigService } from '@/services/config'
import { createMockConfigService } from './helpers/config-mock'
import type { ChangeInfo } from '@/schemas/gerrit'

const mockSubmittableChange: ChangeInfo = {
  id: 'test-project~master~I123',
  _number: 12345,
  change_id: 'I123',
  project: 'test-project',
  branch: 'master',
  subject: 'Test change ready to submit',
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
      value: 2,
      approved: {
        _account_id: 1001,
        name: 'Reviewer',
        email: 'reviewer@example.com',
      },
    },
    Verified: {
      value: 1,
      approved: {
        _account_id: 1002,
        name: 'CI Bot',
        email: 'ci@example.com',
      },
    },
  },
  work_in_progress: false,
  submittable: true,
}

const mockNotSubmittableChange: ChangeInfo = {
  ...mockSubmittableChange,
  submittable: false,
  labels: {
    'Code-Review': {
      value: 0,
    },
    Verified: {
      value: 0,
    },
  },
}

const mockWipChange: ChangeInfo = {
  ...mockSubmittableChange,
  submittable: false,
  work_in_progress: true,
}

const mockSubmitResponse = {
  status: 'MERGED' as const,
  change_id: 'I123',
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

describe('submit command', () => {
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

  it('should submit a submittable change', async () => {
    server.use(
      http.get('*/a/changes/12345', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockSubmittableChange)}`)
      }),
      http.post('*/a/changes/12345/submit', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockSubmitResponse)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = submitCommand('12345', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Submitted change 12345')
    expect(output).toContain('Test change ready to submit')
    expect(output).toContain('Status: MERGED')
  })

  it('should fetch change without detailed reviewer options', async () => {
    let requestedOptions: string[] = []

    server.use(
      http.get('*/a/changes/12345', ({ request }) => {
        const url = new URL(request.url)
        requestedOptions = url.searchParams.getAll('o')
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockSubmittableChange)}`)
      }),
      http.post('*/a/changes/12345/submit', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockSubmitResponse)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = submitCommand('12345', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    expect(requestedOptions).toContain('CURRENT_REVISION')
    expect(requestedOptions).toContain('CURRENT_COMMIT')
    expect(requestedOptions).not.toContain('DETAILED_LABELS')
    expect(requestedOptions).not.toContain('DETAILED_ACCOUNTS')
  })

  it('should output XML format when --xml flag is used', async () => {
    server.use(
      http.get('*/a/changes/12345', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockSubmittableChange)}`)
      }),
      http.post('*/a/changes/12345/submit', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockSubmitResponse)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = submitCommand('12345', { xml: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(output).toContain('<submit_result>')
    expect(output).toContain('<status>success</status>')
    expect(output).toContain('<change_number>12345</change_number>')
    expect(output).toContain('<subject><![CDATA[Test change ready to submit]]></subject>')
    expect(output).toContain('<submit_status>MERGED</submit_status>')
    expect(output).toContain('</submit_result>')
  })

  it('should reject change that is not submittable', async () => {
    server.use(
      http.get('*/a/changes/12345', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockNotSubmittableChange)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = submitCommand('12345', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const errorOutput = mockConsoleError.mock.calls.map((call) => call[0]).join('\n')
    expect(errorOutput).toContain('Change 12345 cannot be submitted')
    expect(errorOutput).toContain('Reasons:')
    expect(errorOutput).toContain('Missing Code-Review+2 approval')
    expect(errorOutput).toContain('Missing Verified+1 approval')
  })

  it('should reject change that is work in progress', async () => {
    server.use(
      http.get('*/a/changes/12345', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockWipChange)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = submitCommand('12345', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const errorOutput = mockConsoleError.mock.calls.map((call) => call[0]).join('\n')
    expect(errorOutput).toContain('Change 12345 cannot be submitted')
    expect(errorOutput).toContain('work-in-progress')
  })

  it('should output XML format for non-submittable change', async () => {
    server.use(
      http.get('*/a/changes/12345', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockNotSubmittableChange)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = submitCommand('12345', { xml: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('<submit_result>')
    expect(output).toContain('<status>error</status>')
    expect(output).toContain('<submittable>false</submittable>')
    expect(output).toContain('<reasons>')
    expect(output).toContain('<reason><![CDATA[Missing Code-Review+2 approval]]></reason>')
    expect(output).toContain('</reasons>')
  })

  it('should handle not found errors gracefully', async () => {
    server.use(
      http.get('*/a/changes/99999', () => {
        return HttpResponse.text('Change not found', { status: 404 })
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = submitCommand('99999', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    // Should fail when change is not found
    await expect(Effect.runPromise(program)).rejects.toThrow()
  })

  it('should show error when change ID is not provided', async () => {
    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = submitCommand(undefined, {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const errorOutput = mockConsoleError.mock.calls.map((call) => call[0]).join('\n')
    expect(errorOutput).toContain('Change ID is required')
    expect(errorOutput).toContain('Usage: ger submit <change-id>')
  })

  it('should handle submit API failure', async () => {
    server.use(
      http.get('*/a/changes/12345', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockSubmittableChange)}`)
      }),
      http.post('*/a/changes/12345/submit', () => {
        return HttpResponse.text('Merge conflict detected', { status: 409 })
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = submitCommand('12345', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    // Should throw/fail
    await expect(Effect.runPromise(program)).rejects.toThrow()
  })

  it('should handle network errors', async () => {
    server.use(
      http.get('*/a/changes/12345', () => {
        return HttpResponse.error()
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = submitCommand('12345', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    // Should throw/fail
    await expect(Effect.runPromise(program)).rejects.toThrow()
  })

  it('should handle API permission errors', async () => {
    server.use(
      http.get('*/a/changes/12345', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockSubmittableChange)}`)
      }),
      http.post('*/a/changes/12345/submit', () => {
        return HttpResponse.text('Forbidden', { status: 403 })
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = submitCommand('12345', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    // Should throw/fail
    await expect(Effect.runPromise(program)).rejects.toThrow()
  })
})
