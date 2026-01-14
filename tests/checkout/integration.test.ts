import { describe, test, expect, beforeAll, afterAll, afterEach, mock, spyOn } from 'bun:test'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { Effect, Layer } from 'effect'
import { checkoutCommand } from '@/cli/commands/checkout'
import { GerritApiServiceLive } from '@/api/gerrit'
import { ConfigService } from '@/services/config'
import { createMockConfigService } from '../helpers/config-mock'
import type { ChangeInfo, RevisionInfo } from '@/schemas/gerrit'
import * as childProcess from 'node:child_process'

/**
 * Integration tests for checkout command
 *
 * Tests complete command workflows including:
 * - API interactions (change details, revisions)
 * - Git operations (fetch, checkout, branch management)
 * - Error handling (network errors, not found, etc.)
 * - Various input formats and options
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

describe('Checkout Command - Integration Tests', () => {
  let mockConsoleLog: ReturnType<typeof mock>
  let mockConsoleError: ReturnType<typeof mock>
  let mockExecSync: ReturnType<typeof spyOn>

  const validChangeId = 'If5a3ae8cb5a107e187447802358417f311d0c4b1'

  const mockChange: ChangeInfo = {
    id: `test-project~main~${validChangeId}`,
    _number: 12345,
    project: 'test-project',
    branch: 'main',
    change_id: validChangeId,
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

  test('should handle change not found error', async () => {
    server.use(
      http.get('*/a/changes/:changeId', () => {
        return HttpResponse.text('Not Found', { status: 404 })
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())

    const program = checkoutCommand('99999', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    // Expect the effect to fail with an ApiError
    const result = await Effect.runPromise(program.pipe(Effect.either))
    expect(result._tag).toBe('Left')
  })

  test('should fetch change details successfully', async () => {
    // Mock git operations to simulate being in a git repo
    mockExecSync = spyOn(childProcess, 'execSync').mockImplementation(((
      command: string,
      _options?: unknown,
    ) => {
      if (command === 'git rev-parse --git-dir') return Buffer.from('.git\n')
      if (command === 'git symbolic-ref --short HEAD') return Buffer.from('main\n')
      if (command === 'git remote -v') {
        return Buffer.from('origin\thttps://test.gerrit.com/repo.git\t(push)\n')
      }
      if (command.startsWith('git rev-parse --verify review/12345')) {
        throw new Error('branch does not exist')
      }
      if (command.startsWith('git fetch')) return Buffer.from('')
      if (command.startsWith('git checkout -b')) return Buffer.from('')
      if (command.startsWith('git branch --set-upstream-to')) return Buffer.from('')
      return Buffer.from('')
    }) as typeof childProcess.execSync)

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

    // Check that we made the API calls and got change details
    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Checking out Gerrit change')
    expect(output).toContain('12345')
    expect(output).toContain('Test change')
    expect(output).toContain('Created and checked out review/12345')

    // Should succeed now with mocked git operations
    expect(result._tag).toBe('Right')
  })

  test('should parse URL input correctly', async () => {
    mockExecSync = spyOn(childProcess, 'execSync').mockImplementation(((
      command: string,
      _options?: unknown,
    ) => {
      if (command === 'git rev-parse --git-dir') return Buffer.from('.git\n')
      if (command === 'git symbolic-ref --short HEAD') return Buffer.from('main\n')
      if (command === 'git remote -v') {
        return Buffer.from('origin\thttps://test.gerrit.com/repo.git\t(push)\n')
      }
      if (command.startsWith('git rev-parse --verify review/12345')) {
        throw new Error('branch does not exist')
      }
      return Buffer.from('')
    }) as typeof childProcess.execSync)

    server.use(
      http.get('*/a/changes/12345', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockChange)}`)
      }),
      http.get('*/a/changes/12345/revisions/current', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockRevision)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())

    const program = checkoutCommand('https://test.gerrit.com/c/test-project/+/12345', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    const result = await Effect.runPromise(program.pipe(Effect.either))

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Checking out Gerrit change')
    expect(output).toContain('12345')
    expect(result._tag).toBe('Right')
  })

  test('should handle specific patchset request', async () => {
    mockExecSync = spyOn(childProcess, 'execSync').mockImplementation(((
      command: string,
      _options?: unknown,
    ) => {
      if (command === 'git rev-parse --git-dir') return Buffer.from('.git\n')
      if (command === 'git symbolic-ref --short HEAD') return Buffer.from('main\n')
      if (command === 'git remote -v') {
        return Buffer.from('origin\thttps://test.gerrit.com/repo.git\t(push)\n')
      }
      if (command.startsWith('git rev-parse --verify review/12345')) {
        throw new Error('branch does not exist')
      }
      if (command.startsWith('git fetch')) return Buffer.from('')
      if (command.startsWith('git checkout -b')) return Buffer.from('')
      if (command.startsWith('git branch --set-upstream-to')) return Buffer.from('')
      return Buffer.from('')
    }) as typeof childProcess.execSync)

    const mockRevision2: RevisionInfo = {
      _number: 2,
      ref: 'refs/changes/45/12345/2',
      created: '2024-01-15 11:00:00.000000000',
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
      http.get('*/a/changes/12345/revisions/2', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockRevision2)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())

    const program = checkoutCommand('12345/2', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program.pipe(Effect.either))

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Patchset: 2')
  })

  test('should handle detach mode', async () => {
    mockExecSync = spyOn(childProcess, 'execSync').mockImplementation(((
      command: string,
      _options?: unknown,
    ) => {
      if (command === 'git rev-parse --git-dir') return Buffer.from('.git\n')
      if (command === 'git remote -v') {
        return Buffer.from('origin\thttps://test.gerrit.com/repo.git\t(push)\n')
      }
      return Buffer.from('')
    }) as typeof childProcess.execSync)

    server.use(
      http.get('*/a/changes/12345', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockChange)}`)
      }),
      http.get('*/a/changes/12345/revisions/current', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockRevision)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())

    const program = checkoutCommand('12345', { detach: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    const result = await Effect.runPromise(program.pipe(Effect.either))

    // Verify detach mode was indicated in output
    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Checking out Gerrit change')
    expect(output).toContain('12345')
    expect(output).toContain('detached HEAD mode')
    expect(result._tag).toBe('Right')
  })

  test('should handle network errors gracefully', async () => {
    server.use(
      http.get('*/a/changes/12345', () => {
        return HttpResponse.error()
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())

    const program = checkoutCommand('12345', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    // Expect the effect to fail with a network error
    const result = await Effect.runPromise(program.pipe(Effect.either))
    expect(result._tag).toBe('Left')
  })

  test('should handle Change-ID input', async () => {
    mockExecSync = spyOn(childProcess, 'execSync').mockImplementation(((
      command: string,
      _options?: unknown,
    ) => {
      if (command === 'git rev-parse --git-dir') return Buffer.from('.git\n')
      if (command === 'git symbolic-ref --short HEAD') return Buffer.from('main\n')
      if (command === 'git remote -v') {
        return Buffer.from('origin\thttps://test.gerrit.com/repo.git\t(push)\n')
      }
      if (command.startsWith('git rev-parse --verify review/12345')) {
        throw new Error('branch does not exist')
      }
      if (command.startsWith('git fetch')) return Buffer.from('')
      if (command.startsWith('git checkout -b')) return Buffer.from('')
      if (command.startsWith('git branch --set-upstream-to')) return Buffer.from('')
      return Buffer.from('')
    }) as typeof childProcess.execSync)

    server.use(
      http.get(`*/a/changes/${validChangeId}`, () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockChange)}`)
      }),
      http.get(`*/a/changes/${validChangeId}/revisions/current`, () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockRevision)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())

    const program = checkoutCommand(validChangeId, {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program.pipe(Effect.either))

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')

    // Should see the change number in the output
    expect(output).toContain('12345')
  })

  test('should display change information', async () => {
    mockExecSync = spyOn(childProcess, 'execSync').mockImplementation(((
      command: string,
      _options?: unknown,
    ) => {
      if (command === 'git rev-parse --git-dir') return Buffer.from('.git\n')
      if (command === 'git symbolic-ref --short HEAD') return Buffer.from('main\n')
      if (command === 'git remote -v') {
        return Buffer.from('origin\thttps://test.gerrit.com/repo.git\t(push)\n')
      }
      if (command.startsWith('git rev-parse --verify review/12345')) {
        throw new Error('branch does not exist')
      }
      if (command.startsWith('git fetch')) return Buffer.from('')
      if (command.startsWith('git checkout -b')) return Buffer.from('')
      if (command.startsWith('git branch --set-upstream-to')) return Buffer.from('')
      return Buffer.from('')
    }) as typeof childProcess.execSync)

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

    await Effect.runPromise(program.pipe(Effect.either))

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Test change')
    expect(output).toContain('12345')
  })

  test('should handle abandoned change', async () => {
    mockExecSync = spyOn(childProcess, 'execSync').mockImplementation(((
      command: string,
      _options?: unknown,
    ) => {
      if (command === 'git rev-parse --git-dir') return Buffer.from('.git\n')
      if (command === 'git symbolic-ref --short HEAD') return Buffer.from('main\n')
      if (command === 'git remote -v') {
        return Buffer.from('origin\thttps://test.gerrit.com/repo.git\t(push)\n')
      }
      if (command.startsWith('git rev-parse --verify review/12345')) {
        throw new Error('branch does not exist')
      }
      if (command.startsWith('git fetch')) return Buffer.from('')
      if (command.startsWith('git checkout -b')) return Buffer.from('')
      if (command.startsWith('git branch --set-upstream-to')) return Buffer.from('')
      return Buffer.from('')
    }) as typeof childProcess.execSync)

    const abandonedChange: ChangeInfo = {
      ...mockChange,
      status: 'ABANDONED',
    }

    server.use(
      http.get('*/a/changes/12345', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(abandonedChange)}`)
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

    await Effect.runPromise(program.pipe(Effect.either))

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('ABANDONED')
  })

  test('should handle merged change', async () => {
    mockExecSync = spyOn(childProcess, 'execSync').mockImplementation(((
      command: string,
      _options?: unknown,
    ) => {
      if (command === 'git rev-parse --git-dir') return Buffer.from('.git\n')
      if (command === 'git symbolic-ref --short HEAD') return Buffer.from('main\n')
      if (command === 'git remote -v') {
        return Buffer.from('origin\thttps://test.gerrit.com/repo.git\t(push)\n')
      }
      if (command.startsWith('git rev-parse --verify review/12345')) {
        throw new Error('branch does not exist')
      }
      if (command.startsWith('git fetch')) return Buffer.from('')
      if (command.startsWith('git checkout -b')) return Buffer.from('')
      if (command.startsWith('git branch --set-upstream-to')) return Buffer.from('')
      return Buffer.from('')
    }) as typeof childProcess.execSync)

    const mergedChange: ChangeInfo = {
      ...mockChange,
      status: 'MERGED',
    }

    server.use(
      http.get('*/a/changes/12345', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mergedChange)}`)
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

    await Effect.runPromise(program.pipe(Effect.either))

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('MERGED')
  })

  test('should update existing branch when branch already exists', async () => {
    mockExecSync = spyOn(childProcess, 'execSync').mockImplementation(((
      command: string,
      _options?: unknown,
    ) => {
      if (command === 'git rev-parse --git-dir') return Buffer.from('.git\n')
      if (command === 'git symbolic-ref --short HEAD') return Buffer.from('main\n')
      if (command === 'git remote -v') {
        return Buffer.from('origin\thttps://test.gerrit.com/repo.git\t(push)\n')
      }
      if (command.startsWith('git rev-parse --verify review/12345')) {
        // Branch exists
        return Buffer.from('abc123\n')
      }
      if (command.startsWith('git fetch')) return Buffer.from('')
      if (command.startsWith('git checkout review/12345')) return Buffer.from('')
      if (command.startsWith('git reset --hard FETCH_HEAD')) return Buffer.from('')
      if (command.startsWith('git branch --set-upstream-to')) return Buffer.from('')
      return Buffer.from('')
    }) as typeof childProcess.execSync)

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

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Updated and checked out review/12345')
    expect(result._tag).toBe('Right')
  })

  test('should handle when branch exists and is currently checked out', async () => {
    mockExecSync = spyOn(childProcess, 'execSync').mockImplementation(((
      command: string,
      _options?: unknown,
    ) => {
      if (command === 'git rev-parse --git-dir') return Buffer.from('.git\n')
      if (command === 'git symbolic-ref --short HEAD') return Buffer.from('review/12345\n')
      if (command === 'git remote -v') {
        return Buffer.from('origin\thttps://test.gerrit.com/repo.git\t(push)\n')
      }
      if (command.startsWith('git rev-parse --verify review/12345')) {
        // Branch exists
        return Buffer.from('abc123\n')
      }
      if (command.startsWith('git fetch')) return Buffer.from('')
      if (command.startsWith('git reset --hard FETCH_HEAD')) return Buffer.from('')
      if (command.startsWith('git branch --set-upstream-to')) return Buffer.from('')
      return Buffer.from('')
    }) as typeof childProcess.execSync)

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

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Updated and checked out review/12345')
    // Should not try to switch branches since already on it
    expect(result._tag).toBe('Right')
  })

  test('should fallback to origin when no remote matches Gerrit host', async () => {
    mockExecSync = spyOn(childProcess, 'execSync').mockImplementation(((
      command: string,
      _options?: unknown,
    ) => {
      if (command === 'git rev-parse --git-dir') return Buffer.from('.git\n')
      if (command === 'git symbolic-ref --short HEAD') return Buffer.from('main\n')
      if (command === 'git remote -v') {
        // Remote with different hostname
        return Buffer.from('origin\thttps://different.gerrit.com/repo.git\t(push)\n')
      }
      if (command.startsWith('git rev-parse --verify')) {
        throw new Error('branch does not exist')
      }
      if (command.startsWith('git fetch')) return Buffer.from('')
      if (command.startsWith('git checkout -b')) return Buffer.from('')
      if (command.startsWith('git branch --set-upstream-to')) return Buffer.from('')
      return Buffer.from('')
    }) as typeof childProcess.execSync)

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

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    // Should use 'origin' as fallback
    expect(output).toContain('Remote: origin')
    expect(result._tag).toBe('Right')
  })

  test('should use custom remote when specified', async () => {
    mockExecSync = spyOn(childProcess, 'execSync').mockImplementation(((
      command: string,
      _options?: unknown,
    ) => {
      if (command === 'git rev-parse --git-dir') return Buffer.from('.git\n')
      if (command === 'git symbolic-ref --short HEAD') return Buffer.from('main\n')
      if (command === 'git remote -v') {
        return Buffer.from('upstream\thttps://test.gerrit.com/repo.git\t(push)\n')
      }
      if (command.startsWith('git rev-parse --verify')) {
        throw new Error('branch does not exist')
      }
      if (command.startsWith('git fetch')) return Buffer.from('')
      if (command.startsWith('git checkout -b')) return Buffer.from('')
      if (command.startsWith('git branch --set-upstream-to')) return Buffer.from('')
      return Buffer.from('')
    }) as typeof childProcess.execSync)

    server.use(
      http.get('*/a/changes/12345', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockChange)}`)
      }),
      http.get('*/a/changes/12345/revisions/current', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockRevision)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())

    const program = checkoutCommand('12345', { remote: 'upstream' }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    const result = await Effect.runPromise(program.pipe(Effect.either))

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    // Should use specified remote
    expect(output).toContain('Remote: upstream')
    expect(result._tag).toBe('Right')
  })
})
