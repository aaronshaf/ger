import { describe, test, expect, beforeAll, afterAll, afterEach, mock } from 'bun:test'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { Effect, Layer } from 'effect'
import { showCommand } from '@/cli/commands/show'
import { commentCommand } from '@/cli/commands/comment'
import { diffCommand } from '@/cli/commands/diff'
import { GerritApiServiceLive } from '@/api/gerrit'
import { ConfigService } from '@/services/config'
import { generateMockChange } from '@/test-utils/mock-generator'
import { createMockConfigService } from './helpers/config-mock'

/**
 * Integration tests to verify that commands accept both change number and Change-ID formats
 */

const CHANGE_NUMBER = '392385'
const CHANGE_ID = 'If5a3ae8cb5a107e187447802358417f311d0c4b1'

const mockChange = generateMockChange({
  _number: 392385,
  change_id: CHANGE_ID,
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

  // Handler that matches both change number and Change-ID
  http.get('*/a/changes/:changeId', ({ params }) => {
    const { changeId } = params
    // Accept both formats
    if (changeId === CHANGE_NUMBER || changeId === CHANGE_ID) {
      return HttpResponse.text(`)]}'
${JSON.stringify(mockChange)}`)
    }
    return HttpResponse.text('Not Found', { status: 404 })
  }),

  http.get('*/a/changes/:changeId/revisions/current/patch', ({ params }) => {
    const { changeId } = params
    if (changeId === CHANGE_NUMBER || changeId === CHANGE_ID) {
      return HttpResponse.text(btoa(mockDiff))
    }
    return HttpResponse.text('Not Found', { status: 404 })
  }),

  http.get('*/a/changes/:changeId/revisions/current/comments', ({ params }) => {
    const { changeId } = params
    if (changeId === CHANGE_NUMBER || changeId === CHANGE_ID) {
      return HttpResponse.text(`)]}'
{}`)
    }
    return HttpResponse.text('Not Found', { status: 404 })
  }),

  http.post('*/a/changes/:changeId/revisions/current/review', async ({ params }) => {
    const { changeId } = params
    if (changeId === CHANGE_NUMBER || changeId === CHANGE_ID) {
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
})

const createMockConfigLayer = (): Layer.Layer<ConfigService, never, never> =>
  Layer.succeed(ConfigService, createMockConfigService())

describe('Change ID format support', () => {
  describe('show command', () => {
    test('accepts numeric change number', async () => {
      const effect = showCommand(CHANGE_NUMBER, {}).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(createMockConfigLayer()),
      )

      await Effect.runPromise(effect)

      const output = capturedLogs.join('\n')
      expect(output).toContain('Change 392385')
      expect(output).toContain('WIP: test')
      expect(capturedErrors.length).toBe(0)
    })

    test('accepts Change-ID format', async () => {
      const effect = showCommand(CHANGE_ID, {}).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(createMockConfigLayer()),
      )

      await Effect.runPromise(effect)

      const output = capturedLogs.join('\n')
      expect(output).toContain('Change 392385')
      expect(output).toContain('WIP: test')
      expect(capturedErrors.length).toBe(0)
    })

    test('rejects invalid change identifier', async () => {
      const effect = showCommand('invalid-id', {}).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(createMockConfigLayer()),
      )

      await Effect.runPromise(effect)

      const output = capturedErrors.join('\n')
      expect(output).toContain('Invalid change identifier')
    })
  })

  describe('diff command', () => {
    test('accepts numeric change number', async () => {
      const effect = diffCommand(CHANGE_NUMBER, {}).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(createMockConfigLayer()),
      )

      await Effect.runPromise(effect)

      const output = capturedLogs.join('\n')
      expect(output).toContain('--- a/test.txt')
      expect(output).toContain('+++ b/test.txt')
      expect(capturedErrors.length).toBe(0)
    })

    test('accepts Change-ID format', async () => {
      const effect = diffCommand(CHANGE_ID, {}).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(createMockConfigLayer()),
      )

      await Effect.runPromise(effect)

      const output = capturedLogs.join('\n')
      expect(output).toContain('--- a/test.txt')
      expect(output).toContain('+++ b/test.txt')
      expect(capturedErrors.length).toBe(0)
    })
  })

  describe('comment command', () => {
    test('accepts numeric change number', async () => {
      const effect = commentCommand(CHANGE_NUMBER, { message: 'LGTM' }).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(createMockConfigLayer()),
      )

      await Effect.runPromise(effect)

      const output = capturedLogs.join('\n')
      expect(output).toContain('Comment posted successfully')
      expect(capturedErrors.length).toBe(0)
    })

    test('accepts Change-ID format', async () => {
      const effect = commentCommand(CHANGE_ID, { message: 'LGTM' }).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(createMockConfigLayer()),
      )

      await Effect.runPromise(effect)

      const output = capturedLogs.join('\n')
      expect(output).toContain('Comment posted successfully')
      expect(capturedErrors.length).toBe(0)
    })
  })

  describe('edge cases', () => {
    test('trims whitespace from change identifiers', async () => {
      const effect = showCommand(`  ${CHANGE_NUMBER}  `, {}).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(createMockConfigLayer()),
      )

      await Effect.runPromise(effect)

      const output = capturedLogs.join('\n')
      expect(output).toContain('Change 392385')
      expect(capturedErrors.length).toBe(0)
    })

    test('validates Change-ID format strictly (uppercase I)', async () => {
      const lowercaseChangeId = 'if5a3ae8cb5a107e187447802358417f311d0c4b1'
      const effect = showCommand(lowercaseChangeId, {}).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(createMockConfigLayer()),
      )

      await Effect.runPromise(effect)

      const output = capturedErrors.join('\n')
      expect(output).toContain('Invalid change identifier')
    })

    test('rejects Change-ID with incorrect length', async () => {
      const shortChangeId = 'If5a3ae8cb5a107e18744780235841'
      const effect = showCommand(shortChangeId, {}).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(createMockConfigLayer()),
      )

      await Effect.runPromise(effect)

      const output = capturedErrors.join('\n')
      expect(output).toContain('Invalid change identifier')
    })
  })
})
