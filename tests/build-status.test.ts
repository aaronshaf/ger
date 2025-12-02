import { describe, test, expect, beforeAll, afterAll, afterEach } from 'bun:test'
import { http, HttpResponse } from 'msw'
import { Effect } from 'effect'
import { buildStatusCommand } from '@/cli/commands/build-status'
import { GerritApiServiceLive } from '@/api/gerrit'
import type { MessageInfo } from '@/schemas/gerrit'
import {
  server,
  capturedStdout,
  capturedErrors,
  mockProcessExit,
  setupBuildStatusTests,
  teardownBuildStatusTests,
  resetBuildStatusMocks,
  createMockConfigLayer,
} from './helpers/build-status-test-setup'

beforeAll(() => {
  setupBuildStatusTests()
})

afterAll(() => {
  teardownBuildStatusTests()
})

afterEach(() => {
  resetBuildStatusMocks()
})

describe('build-status command', () => {
  test('returns pending when no Build Started message found', async () => {
    const messages: MessageInfo[] = [
      {
        id: 'msg1',
        message: 'Patch Set 1',
        date: '2024-01-15 10:00:00.000000000',
        author: {
          _account_id: 1001,
          name: 'Test User',
        },
      },
      {
        id: 'msg2',
        message: 'Review comment',
        date: '2024-01-15 10:30:00.000000000',
        author: {
          _account_id: 1002,
          name: 'Reviewer',
        },
      },
    ]

    server.use(
      http.get('*/a/changes/12345', ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('o') === 'MESSAGES') {
          return HttpResponse.json(
            { messages },
            {
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }
        return HttpResponse.text('Not Found', { status: 404 })
      }),
    )

    const effect = buildStatusCommand('12345').pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(createMockConfigLayer()),
    )

    await Effect.runPromise(effect)

    expect(capturedStdout.length).toBe(1)
    const output = JSON.parse(capturedStdout[0])
    expect(output).toEqual({ state: 'pending' })
  })

  test('returns running when Build Started but no verification', async () => {
    const messages: MessageInfo[] = [
      {
        id: 'msg1',
        message: 'Patch Set 1',
        date: '2024-01-15 10:00:00.000000000',
        author: {
          _account_id: 1001,
          name: 'Test User',
        },
      },
      {
        id: 'msg2',
        message: 'Build Started',
        date: '2024-01-15 10:05:00.000000000',
        author: {
          _account_id: 9999,
          name: 'CI Bot',
        },
      },
      {
        id: 'msg3',
        message: 'Some other message',
        date: '2024-01-15 10:10:00.000000000',
        author: {
          _account_id: 1002,
          name: 'Reviewer',
        },
      },
    ]

    server.use(
      http.get('*/a/changes/12345', ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('o') === 'MESSAGES') {
          return HttpResponse.json(
            { messages },
            {
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }
        return HttpResponse.text('Not Found', { status: 404 })
      }),
    )

    const effect = buildStatusCommand('12345').pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(createMockConfigLayer()),
    )

    await Effect.runPromise(effect)

    expect(capturedStdout.length).toBe(1)
    const output = JSON.parse(capturedStdout[0])
    expect(output).toEqual({ state: 'running' })
  })

  test('returns success when Verified+1 after Build Started', async () => {
    const messages: MessageInfo[] = [
      {
        id: 'msg1',
        message: 'Patch Set 1',
        date: '2024-01-15 10:00:00.000000000',
        author: {
          _account_id: 1001,
          name: 'Test User',
        },
      },
      {
        id: 'msg2',
        message: 'Build Started',
        date: '2024-01-15 10:05:00.000000000',
        author: {
          _account_id: 9999,
          name: 'CI Bot',
        },
      },
      {
        id: 'msg3',
        message: 'Patch Set 1: Verified+1',
        date: '2024-01-15 10:15:00.000000000',
        author: {
          _account_id: 9999,
          name: 'CI Bot',
        },
      },
    ]

    server.use(
      http.get('*/a/changes/12345', ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('o') === 'MESSAGES') {
          return HttpResponse.json(
            { messages },
            {
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }
        return HttpResponse.text('Not Found', { status: 404 })
      }),
    )

    const effect = buildStatusCommand('12345').pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(createMockConfigLayer()),
    )

    await Effect.runPromise(effect)

    expect(capturedStdout.length).toBe(1)
    const output = JSON.parse(capturedStdout[0])
    expect(output).toEqual({ state: 'success' })
  })

  test('returns failure when Verified-1 after Build Started', async () => {
    const messages: MessageInfo[] = [
      {
        id: 'msg1',
        message: 'Patch Set 1',
        date: '2024-01-15 10:00:00.000000000',
        author: {
          _account_id: 1001,
          name: 'Test User',
        },
      },
      {
        id: 'msg2',
        message: 'Build Started',
        date: '2024-01-15 10:05:00.000000000',
        author: {
          _account_id: 9999,
          name: 'CI Bot',
        },
      },
      {
        id: 'msg3',
        message: 'Patch Set 1: Verified-1\n\nBuild Failed',
        date: '2024-01-15 10:20:00.000000000',
        author: {
          _account_id: 9999,
          name: 'CI Bot',
        },
      },
    ]

    server.use(
      http.get('*/a/changes/12345', ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('o') === 'MESSAGES') {
          return HttpResponse.json(
            { messages },
            {
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }
        return HttpResponse.text('Not Found', { status: 404 })
      }),
    )

    const effect = buildStatusCommand('12345').pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(createMockConfigLayer()),
    )

    await Effect.runPromise(effect)

    expect(capturedStdout.length).toBe(1)
    const output = JSON.parse(capturedStdout[0])
    expect(output).toEqual({ state: 'failure' })
  })

  test('ignores Verified messages before Build Started', async () => {
    const messages: MessageInfo[] = [
      {
        id: 'msg1',
        message: 'Patch Set 1: Verified+1',
        date: '2024-01-15 09:00:00.000000000',
        author: {
          _account_id: 9999,
          name: 'CI Bot',
        },
      },
      {
        id: 'msg2',
        message: 'Build Started',
        date: '2024-01-15 10:00:00.000000000',
        author: {
          _account_id: 9999,
          name: 'CI Bot',
        },
      },
    ]

    server.use(
      http.get('*/a/changes/12345', ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('o') === 'MESSAGES') {
          return HttpResponse.json(
            { messages },
            {
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }
        return HttpResponse.text('Not Found', { status: 404 })
      }),
    )

    const effect = buildStatusCommand('12345').pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(createMockConfigLayer()),
    )

    await Effect.runPromise(effect)

    expect(capturedStdout.length).toBe(1)
    const output = JSON.parse(capturedStdout[0])
    expect(output).toEqual({ state: 'running' })
  })

  test('uses most recent Build Started message', async () => {
    const messages: MessageInfo[] = [
      {
        id: 'msg1',
        message: 'Build Started',
        date: '2024-01-15 09:00:00.000000000',
        author: {
          _account_id: 9999,
          name: 'CI Bot',
        },
      },
      {
        id: 'msg2',
        message: 'Patch Set 1: Verified-1',
        date: '2024-01-15 09:30:00.000000000',
        author: {
          _account_id: 9999,
          name: 'CI Bot',
        },
      },
      {
        id: 'msg3',
        message: 'Build Started',
        date: '2024-01-15 10:00:00.000000000',
        author: {
          _account_id: 9999,
          name: 'CI Bot',
        },
      },
    ]

    server.use(
      http.get('*/a/changes/12345', ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('o') === 'MESSAGES') {
          return HttpResponse.json(
            { messages },
            {
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }
        return HttpResponse.text('Not Found', { status: 404 })
      }),
    )

    const effect = buildStatusCommand('12345').pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(createMockConfigLayer()),
    )

    await Effect.runPromise(effect)

    expect(capturedStdout.length).toBe(1)
    const output = JSON.parse(capturedStdout[0])
    // Should be running because the most recent Build Started has no verification after it
    expect(output).toEqual({ state: 'running' })
  })

  test('returns not_found when change does not exist', async () => {
    server.use(
      http.get('*/a/changes/99999', () => {
        return HttpResponse.text('Not Found', { status: 404 })
      }),
    )

    const effect = buildStatusCommand('99999').pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(createMockConfigLayer()),
    )

    await Effect.runPromise(effect)

    expect(capturedStdout.length).toBe(1)
    const output = JSON.parse(capturedStdout[0])
    expect(output).toEqual({ state: 'not_found' })
  })

  test('handles empty message list', async () => {
    server.use(
      http.get('*/a/changes/12345', ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('o') === 'MESSAGES') {
          return HttpResponse.json(
            { messages: [] },
            {
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }
        return HttpResponse.text('Not Found', { status: 404 })
      }),
    )

    const effect = buildStatusCommand('12345').pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(createMockConfigLayer()),
    )

    await Effect.runPromise(effect)

    expect(capturedStdout.length).toBe(1)
    const output = JSON.parse(capturedStdout[0])
    // Empty messages means change exists but has no activity - returns pending
    expect(output).toEqual({ state: 'pending' })
  })

  test('returns first match when both Verified+1 and Verified-1 after Build Started', async () => {
    const messages: MessageInfo[] = [
      {
        id: 'msg1',
        message: 'Build Started',
        date: '2024-01-15 10:00:00.000000000',
        author: {
          _account_id: 9999,
          name: 'CI Bot',
        },
      },
      {
        id: 'msg2',
        message: 'Patch Set 1: Verified-1',
        date: '2024-01-15 10:15:00.000000000',
        author: {
          _account_id: 9999,
          name: 'CI Bot',
        },
      },
      {
        id: 'msg3',
        message: 'Patch Set 2: Verified+1',
        date: '2024-01-15 10:30:00.000000000',
        author: {
          _account_id: 9999,
          name: 'CI Bot',
        },
      },
    ]

    server.use(
      http.get('*/a/changes/12345', ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('o') === 'MESSAGES') {
          return HttpResponse.json(
            { messages },
            {
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }
        return HttpResponse.text('Not Found', { status: 404 })
      }),
    )

    const effect = buildStatusCommand('12345').pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(createMockConfigLayer()),
    )

    await Effect.runPromise(effect)

    expect(capturedStdout.length).toBe(1)
    const output = JSON.parse(capturedStdout[0])
    // Should return first verification result (failure)
    expect(output).toEqual({ state: 'failure' })
  })

  test('does not match malformed verification messages', async () => {
    const messages: MessageInfo[] = [
      {
        id: 'msg1',
        message: 'Build Started',
        date: '2024-01-15 10:00:00.000000000',
        author: {
          _account_id: 9999,
          name: 'CI Bot',
        },
      },
      {
        id: 'msg2',
        message: 'Please verify this +1 thanks',
        date: '2024-01-15 10:15:00.000000000',
        author: {
          _account_id: 1001,
          name: 'Reviewer',
        },
      },
      {
        id: 'msg3',
        message: 'We are not verified -1 yet',
        date: '2024-01-15 10:20:00.000000000',
        author: {
          _account_id: 1002,
          name: 'Reviewer',
        },
      },
    ]

    server.use(
      http.get('*/a/changes/12345', ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('o') === 'MESSAGES') {
          return HttpResponse.json(
            { messages },
            {
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }
        return HttpResponse.text('Not Found', { status: 404 })
      }),
    )

    const effect = buildStatusCommand('12345').pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(createMockConfigLayer()),
    )

    await Effect.runPromise(effect)

    expect(capturedStdout.length).toBe(1)
    const output = JSON.parse(capturedStdout[0])
    // Malformed messages should not match, so build is still running
    expect(output).toEqual({ state: 'running' })
  })

  test('handles network error (500)', async () => {
    server.use(
      http.get('*/a/changes/12345', () => {
        return HttpResponse.text('Internal Server Error', { status: 500 })
      }),
    )

    const effect = buildStatusCommand('12345').pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(createMockConfigLayer()),
    )

    try {
      await Effect.runPromise(effect)
    } catch {
      // Should throw error and call process.exit with code 3 for API errors
      expect(mockProcessExit).toHaveBeenCalledWith(3)
      expect(capturedErrors.length).toBeGreaterThan(0)
    }
  })

  test('handles same timestamp for Build Started and Verified', async () => {
    const sameTimestamp = '2024-01-15 10:00:00.000000000'
    const messages: MessageInfo[] = [
      {
        id: 'msg1',
        message: 'Build Started',
        date: sameTimestamp,
        author: {
          _account_id: 9999,
          name: 'CI Bot',
        },
      },
      {
        id: 'msg2',
        message: 'Patch Set 1: Verified+1',
        date: sameTimestamp,
        author: {
          _account_id: 9999,
          name: 'CI Bot',
        },
      },
    ]

    server.use(
      http.get('*/a/changes/12345', ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('o') === 'MESSAGES') {
          return HttpResponse.json(
            { messages },
            {
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }
        return HttpResponse.text('Not Found', { status: 404 })
      }),
    )

    const effect = buildStatusCommand('12345').pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(createMockConfigLayer()),
    )

    await Effect.runPromise(effect)

    expect(capturedStdout.length).toBe(1)
    const output = JSON.parse(capturedStdout[0])
    // Same timestamp means Verified is not after Build Started, so running
    expect(output).toEqual({ state: 'running' })
  })

  test('matches Build Started with different spacing', async () => {
    const messages: MessageInfo[] = [
      {
        id: 'msg1',
        message: 'Build  Started', // Extra space
        date: '2024-01-15 10:00:00.000000000',
        author: {
          _account_id: 9999,
          name: 'CI Bot',
        },
      },
    ]

    server.use(
      http.get('*/a/changes/12345', ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('o') === 'MESSAGES') {
          return HttpResponse.json(
            { messages },
            {
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }
        return HttpResponse.text('Not Found', { status: 404 })
      }),
    )

    const effect = buildStatusCommand('12345').pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(createMockConfigLayer()),
    )

    await Effect.runPromise(effect)

    expect(capturedStdout.length).toBe(1)
    const output = JSON.parse(capturedStdout[0])
    // Regex should handle extra whitespace
    expect(output).toEqual({ state: 'running' })
  })

  test('ignores verification from older patchset when newer patchset build is running', async () => {
    // This test replicates the bug scenario:
    // - PS 3 build started, then PS 4 build started
    // - PS 3 verification (-1) comes AFTER PS 4 build started
    // - Should return "running" because PS 4 has no verification yet
    const messages: MessageInfo[] = [
      {
        id: 'msg1',
        message: 'Build Started https://jenkins.example.com/job/123/',
        date: '2024-01-15 11:12:00.000000000',
        _revision_number: 2,
        author: {
          _account_id: 9999,
          name: 'Service Cloud Jenkins',
        },
      },
      {
        id: 'msg2',
        message: 'Patch Set 2: Verified -1\n\nBuild Failed',
        date: '2024-01-15 11:23:00.000000000',
        _revision_number: 2,
        author: {
          _account_id: 9999,
          name: 'Service Cloud Jenkins',
        },
      },
      {
        id: 'msg3',
        message: 'Build Started https://jenkins.example.com/job/456/',
        date: '2024-01-15 13:57:00.000000000',
        _revision_number: 3,
        author: {
          _account_id: 9999,
          name: 'Service Cloud Jenkins',
        },
      },
      {
        id: 'msg4',
        message: 'Build Started https://jenkins.example.com/job/789/',
        date: '2024-01-15 14:02:00.000000000',
        _revision_number: 4,
        author: {
          _account_id: 9999,
          name: 'Service Cloud Jenkins',
        },
      },
      {
        id: 'msg5',
        message: 'Patch Set 3: Verified -1\n\nBuild Failed : ABORTED',
        date: '2024-01-15 14:03:00.000000000',
        _revision_number: 3,
        author: {
          _account_id: 9999,
          name: 'Service Cloud Jenkins',
        },
      },
    ]

    server.use(
      http.get('*/a/changes/12345', ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('o') === 'MESSAGES') {
          return HttpResponse.json(
            { messages },
            {
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }
        return HttpResponse.text('Not Found', { status: 404 })
      }),
    )

    const effect = buildStatusCommand('12345').pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(createMockConfigLayer()),
    )

    await Effect.runPromise(effect)

    expect(capturedStdout.length).toBe(1)
    const output = JSON.parse(capturedStdout[0])
    // PS 4 build started at 14:02, PS 3 verification at 14:03 should be IGNORED
    // because it's for a different revision. PS 4 build is still running.
    expect(output).toEqual({ state: 'running' })
  })

  test('returns success when verification matches the latest patchset', async () => {
    const messages: MessageInfo[] = [
      {
        id: 'msg1',
        message: 'Build Started',
        date: '2024-01-15 10:00:00.000000000',
        _revision_number: 1,
        author: {
          _account_id: 9999,
          name: 'CI Bot',
        },
      },
      {
        id: 'msg2',
        message: 'Build Started',
        date: '2024-01-15 11:00:00.000000000',
        _revision_number: 2,
        author: {
          _account_id: 9999,
          name: 'CI Bot',
        },
      },
      {
        id: 'msg3',
        message: 'Patch Set 2: Verified+1',
        date: '2024-01-15 11:15:00.000000000',
        _revision_number: 2,
        author: {
          _account_id: 9999,
          name: 'CI Bot',
        },
      },
    ]

    server.use(
      http.get('*/a/changes/12345', ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('o') === 'MESSAGES') {
          return HttpResponse.json(
            { messages },
            {
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }
        return HttpResponse.text('Not Found', { status: 404 })
      }),
    )

    const effect = buildStatusCommand('12345').pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(createMockConfigLayer()),
    )

    await Effect.runPromise(effect)

    expect(capturedStdout.length).toBe(1)
    const output = JSON.parse(capturedStdout[0])
    // PS 2 build started at 11:00, PS 2 verification at 11:15 - same revision, success
    expect(output).toEqual({ state: 'success' })
  })
})
