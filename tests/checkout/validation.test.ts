import { describe, test, expect, beforeAll, afterAll, afterEach, mock, spyOn } from 'bun:test'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { Effect, Layer } from 'effect'
import { checkoutCommand, InvalidInputError } from '@/cli/commands/checkout'
import { GerritApiServiceLive } from '@/api/gerrit'
import { ConfigService } from '@/services/config'
import { createMockConfigService } from '../helpers/config-mock'
import type { ChangeInfo, RevisionInfo } from '@/schemas/gerrit'
import * as childProcess from 'node:child_process'

/**
 * Input validation and security tests
 *
 * Tests cover:
 * - Shell injection prevention
 * - Invalid input format rejection
 * - Malicious remote/ref validation
 */

const server = setupServer(
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

describe('Checkout Command - Input Validation', () => {
  let mockConsoleLog: ReturnType<typeof mock>
  let mockConsoleError: ReturnType<typeof mock>
  let mockExecSync: ReturnType<typeof spyOn>

  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'bypass' })
    mockConsoleLog = mock(() => {})
    mockConsoleError = mock(() => {})
    console.log = mockConsoleLog
    console.error = mockConsoleError
  })

  afterAll(() => {
    server.close()
  })

  afterEach(() => {
    server.resetHandlers()
    mockConsoleLog.mockClear()
    mockConsoleError.mockClear()
    mockExecSync?.mockRestore()
  })

  test('should reject malicious remote name with shell injection', async () => {
    mockExecSync = spyOn(childProcess, 'execSync').mockImplementation(((
      command: string,
      _options?: unknown,
    ) => {
      if (command === 'git rev-parse --git-dir') return Buffer.from('.git\n')
      if (command === 'git symbolic-ref --short HEAD') return Buffer.from('main\n')
      if (command === 'git remote -v') {
        return Buffer.from('origin\thttps://test.gerrit.com/repo.git\t(push)\n')
      }
      return Buffer.from('')
    }) as typeof childProcess.execSync)

    const mockChange: ChangeInfo = {
      id: 'test-project~main~Iabc123',
      _number: 12345,
      project: 'test-project',
      branch: 'main',
      change_id: 'Iabc123',
      subject: 'Test change',
      status: 'NEW',
      created: '2024-01-15 10:00:00.000000000',
      updated: '2024-01-15 10:00:00.000000000',
    }

    const mockRevision: RevisionInfo = {
      _number: 1,
      ref: 'refs/changes/45/12345/1',
      created: '2024-01-15 10:00:00.000000000',
      uploader: {
        _account_id: 1000,
        name: 'Test User',
        email: 'test@example.com',
      },
    }

    server.use(
      http.get('*/a/changes/12345', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockChange)}`)
      }),
      http.get('*/a/changes/12345/revisions/current', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockRevision)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())

    // Try to inject shell command in remote option
    const program = checkoutCommand('12345', { remote: 'origin; rm -rf /' }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    const result = await Effect.runPromise(program.pipe(Effect.either))

    // Should fail with InvalidInputError
    expect(result._tag).toBe('Left')
    if (result._tag === 'Left') {
      expect(result.left).toBeInstanceOf(InvalidInputError)
    }
  })

  test('should reject malicious ref with invalid format', async () => {
    mockExecSync = spyOn(childProcess, 'execSync').mockImplementation(((
      command: string,
      _options?: unknown,
    ) => {
      if (command === 'git rev-parse --git-dir') return Buffer.from('.git\n')
      return Buffer.from('')
    }) as typeof childProcess.execSync)

    const mockChange: ChangeInfo = {
      id: 'test-project~main~Iabc123',
      _number: 12345,
      project: 'test-project',
      branch: 'main',
      change_id: 'Iabc123',
      subject: 'Test change',
      status: 'NEW',
      created: '2024-01-15 10:00:00.000000000',
      updated: '2024-01-15 10:00:00.000000000',
    }

    // Malicious ref that doesn't match Gerrit format
    const mockRevision: RevisionInfo = {
      _number: 1,
      ref: '$(malicious command)',
      created: '2024-01-15 10:00:00.000000000',
      uploader: {
        _account_id: 1000,
        name: 'Test User',
        email: 'test@example.com',
      },
    }

    server.use(
      http.get('*/a/changes/12345', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockChange)}`)
      }),
      http.get('*/a/changes/12345/revisions/current', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockRevision)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())

    const program = checkoutCommand('12345', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    const result = await Effect.runPromise(program.pipe(Effect.either))

    // Should fail with InvalidInputError due to invalid ref format
    expect(result._tag).toBe('Left')
    if (result._tag === 'Left') {
      expect(result.left).toBeInstanceOf(InvalidInputError)
    }
  })
})
