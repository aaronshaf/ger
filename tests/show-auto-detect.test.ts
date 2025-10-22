import { describe, test, expect, beforeAll, afterAll, afterEach, mock, spyOn } from 'bun:test'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { Effect, Layer } from 'effect'
import { showCommand } from '@/cli/commands/show'
import { GerritApiServiceLive } from '@/api/gerrit'
import { ConfigService } from '@/services/config'
import { generateMockChange } from '@/test-utils/mock-generator'
import { createMockConfigService } from './helpers/config-mock'
import * as childProcess from 'node:child_process'
import { EventEmitter } from 'node:events'

/**
 * Integration tests for auto-detecting Change-ID from HEAD commit
 */

const mockChange = generateMockChange({
  _number: 392385,
  change_id: 'If5a3ae8cb5a107e187447802358417f311d0c4b1',
  subject: 'WIP: test',
  status: 'NEW',
  project: 'canvas-lms',
  branch: 'master',
  created: '2024-01-15 10:00:00.000000000',
  updated: '2024-01-15 12:00:00.000000000',
  owner: {
    _account_id: 1001,
    name: 'Test User',
    email: 'test@example.com',
  },
})

const mockDiff = `--- a/test.txt
+++ b/test.txt
@@ -1,1 +1,2 @@
 original line
+new line`

const server = setupServer(
  http.get('*/a/accounts/self', () => {
    return HttpResponse.json({
      _account_id: 1000,
      name: 'Test User',
      email: 'test@example.com',
    })
  }),

  // Handler that matches the auto-detected Change-ID
  http.get('*/a/changes/:changeId', ({ params }) => {
    const { changeId } = params
    if (changeId === 'If5a3ae8cb5a107e187447802358417f311d0c4b1') {
      return HttpResponse.text(`)]}'
${JSON.stringify(mockChange)}`)
    }
    return HttpResponse.text('Not Found', { status: 404 })
  }),

  http.get('*/a/changes/:changeId/revisions/current/patch', ({ params }) => {
    const { changeId } = params
    if (changeId === 'If5a3ae8cb5a107e187447802358417f311d0c4b1') {
      return HttpResponse.text(btoa(mockDiff))
    }
    return HttpResponse.text('Not Found', { status: 404 })
  }),

  http.get('*/a/changes/:changeId/revisions/current/comments', ({ params }) => {
    const { changeId } = params
    if (changeId === 'If5a3ae8cb5a107e187447802358417f311d0c4b1') {
      return HttpResponse.text(`)]}'
{}`)
    }
    return HttpResponse.text('Not Found', { status: 404 })
  }),
)

let capturedLogs: string[] = []
let capturedErrors: string[] = []

const mockConsoleLog = mock((...args: any[]) => {
  capturedLogs.push(args.join(' '))
})
const mockConsoleError = mock((...args: any[]) => {
  capturedErrors.push(args.join(' '))
})

const originalConsoleLog = console.log
const originalConsoleError = console.error

let spawnSpy: ReturnType<typeof spyOn>

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' })
  // @ts-ignore
  console.log = mockConsoleLog
  // @ts-ignore
  console.error = mockConsoleError
})

afterAll(() => {
  server.close()
  console.log = originalConsoleLog
  console.error = originalConsoleError
})

afterEach(() => {
  server.resetHandlers()
  mockConsoleLog.mockClear()
  mockConsoleError.mockClear()
  capturedLogs = []
  capturedErrors = []

  if (spawnSpy) {
    spawnSpy.mockRestore()
  }
})

const createMockConfigLayer = (): Layer.Layer<ConfigService, never, never> =>
  Layer.succeed(ConfigService, createMockConfigService())

describe('show command with auto-detection', () => {
  test('auto-detects Change-ID from HEAD commit when no argument provided', async () => {
    const commitMessage = `feat: add feature

Change-Id: If5a3ae8cb5a107e187447802358417f311d0c4b1`

    // Mock git log command
    const mockChildProcess = new EventEmitter()
    // @ts-ignore
    mockChildProcess.stdout = new EventEmitter()
    // @ts-ignore
    mockChildProcess.stderr = new EventEmitter()

    spawnSpy = spyOn(childProcess, 'spawn')
    spawnSpy.mockReturnValue(mockChildProcess as any)

    const effect = showCommand(undefined, {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(createMockConfigLayer()),
    )

    const resultPromise = Effect.runPromise(effect)

    // Simulate git log success
    setImmediate(() => {
      // @ts-ignore
      mockChildProcess.stdout.emit('data', Buffer.from(commitMessage))
      mockChildProcess.emit('close', 0)
    })

    await resultPromise

    const output = capturedLogs.join('\n')
    expect(output).toContain('Change 392385')
    expect(output).toContain('WIP: test')
    expect(capturedErrors.length).toBe(0)
  })

  test('auto-detects Change-ID with --xml flag', async () => {
    const commitMessage = `feat: add feature

Change-Id: If5a3ae8cb5a107e187447802358417f311d0c4b1`

    const mockChildProcess = new EventEmitter()
    // @ts-ignore
    mockChildProcess.stdout = new EventEmitter()
    // @ts-ignore
    mockChildProcess.stderr = new EventEmitter()

    spawnSpy = spyOn(childProcess, 'spawn')
    spawnSpy.mockReturnValue(mockChildProcess as any)

    const effect = showCommand(undefined, { xml: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(createMockConfigLayer()),
    )

    const resultPromise = Effect.runPromise(effect)

    setImmediate(() => {
      // @ts-ignore
      mockChildProcess.stdout.emit('data', Buffer.from(commitMessage))
      mockChildProcess.emit('close', 0)
    })

    await resultPromise

    const output = capturedLogs.join('\n')
    expect(output).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(output).toContain('<show_result>')
    expect(output).toContain('<status>success</status>')
    expect(output).toContain('392385')
    expect(capturedErrors.length).toBe(0)
  })

  test('shows error when no Change-ID in HEAD commit', async () => {
    const commitMessage = `feat: add feature without Change-ID

This commit has no Change-ID footer.`

    const mockChildProcess = new EventEmitter()
    // @ts-ignore
    mockChildProcess.stdout = new EventEmitter()
    // @ts-ignore
    mockChildProcess.stderr = new EventEmitter()

    spawnSpy = spyOn(childProcess, 'spawn')
    spawnSpy.mockReturnValue(mockChildProcess as any)

    const effect = showCommand(undefined, {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(createMockConfigLayer()),
    )

    const resultPromise = Effect.runPromise(effect)

    setImmediate(() => {
      // @ts-ignore
      mockChildProcess.stdout.emit('data', Buffer.from(commitMessage))
      mockChildProcess.emit('close', 0)
    })

    await resultPromise

    const output = capturedErrors.join('\n')
    expect(output).toContain('No Change-ID found in HEAD commit')
    expect(capturedLogs.length).toBe(0)
  })

  test('shows error when not in git repository', async () => {
    const mockChildProcess = new EventEmitter()
    // @ts-ignore
    mockChildProcess.stdout = new EventEmitter()
    // @ts-ignore
    mockChildProcess.stderr = new EventEmitter()

    spawnSpy = spyOn(childProcess, 'spawn')
    spawnSpy.mockReturnValue(mockChildProcess as any)

    const effect = showCommand(undefined, {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(createMockConfigLayer()),
    )

    const resultPromise = Effect.runPromise(effect)

    setImmediate(() => {
      // @ts-ignore
      mockChildProcess.stderr.emit('data', Buffer.from('fatal: not a git repository'))
      mockChildProcess.emit('close', 128)
    })

    await resultPromise

    const output = capturedErrors.join('\n')
    expect(output).toContain('fatal: not a git repository')
  })

  test('still works with explicit change-id argument', async () => {
    // Don't mock git - should not be called when changeId is provided
    const effect = showCommand('If5a3ae8cb5a107e187447802358417f311d0c4b1', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(createMockConfigLayer()),
    )

    await Effect.runPromise(effect)

    const output = capturedLogs.join('\n')
    expect(output).toContain('Change 392385')
    expect(output).toContain('WIP: test')
    expect(capturedErrors.length).toBe(0)
  })

  test('shows XML error when no Change-ID in commit with --xml flag', async () => {
    const commitMessage = `feat: no change id`

    const mockChildProcess = new EventEmitter()
    // @ts-ignore
    mockChildProcess.stdout = new EventEmitter()
    // @ts-ignore
    mockChildProcess.stderr = new EventEmitter()

    spawnSpy = spyOn(childProcess, 'spawn')
    spawnSpy.mockReturnValue(mockChildProcess as any)

    const effect = showCommand(undefined, { xml: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(createMockConfigLayer()),
    )

    const resultPromise = Effect.runPromise(effect)

    setImmediate(() => {
      // @ts-ignore
      mockChildProcess.stdout.emit('data', Buffer.from(commitMessage))
      mockChildProcess.emit('close', 0)
    })

    await resultPromise

    const output = capturedLogs.join('\n')
    expect(output).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(output).toContain('<show_result>')
    expect(output).toContain('<status>error</status>')
    expect(output).toContain('No Change-ID found in HEAD commit')
  })
})
