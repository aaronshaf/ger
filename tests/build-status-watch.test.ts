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

describe('build-status command - watch mode', () => {
  test('polls until success state is reached', async () => {
    let callCount = 0

    server.use(
      http.get('*/a/changes/12345', ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('o') === 'MESSAGES') {
          callCount++

          let messages: MessageInfo[]
          if (callCount === 1) {
            // First call: pending (no build started)
            messages = []
          } else if (callCount === 2) {
            // Second call: running (build started, no verification)
            messages = [
              {
                id: 'msg1',
                message: 'Build Started',
                date: '2024-01-15 10:00:00.000000000',
                author: { _account_id: 9999, name: 'CI Bot' },
              },
            ]
          } else {
            // Third call: success (verified +1)
            messages = [
              {
                id: 'msg1',
                message: 'Build Started',
                date: '2024-01-15 10:00:00.000000000',
                author: { _account_id: 9999, name: 'CI Bot' },
              },
              {
                id: 'msg2',
                message: 'Patch Set 1: Verified+1',
                date: '2024-01-15 10:05:00.000000000',
                author: { _account_id: 9999, name: 'CI Bot' },
              },
            ]
          }

          return HttpResponse.json(
            { messages },
            { headers: { 'Content-Type': 'application/json' } },
          )
        }
        return HttpResponse.text('Not Found', { status: 404 })
      }),
    )

    const effect = buildStatusCommand('12345', {
      watch: true,
      interval: 0.1, // Fast polling for tests
      timeout: 10,
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(createMockConfigLayer()))

    await Effect.runPromise(effect)

    // Should have multiple outputs (one per poll)
    expect(capturedStdout.length).toBeGreaterThanOrEqual(3)
    expect(JSON.parse(capturedStdout[0])).toEqual({ state: 'pending' })
    expect(JSON.parse(capturedStdout[1])).toEqual({ state: 'running' })
    expect(JSON.parse(capturedStdout[2])).toEqual({ state: 'success' })

    // Minimalistic output: no stderr messages except on timeout/error
    expect(capturedErrors.length).toBe(0)
  })

  test('polls until failure state is reached', async () => {
    let callCount = 0

    server.use(
      http.get('*/a/changes/12345', ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('o') === 'MESSAGES') {
          callCount++

          let messages: MessageInfo[]
          if (callCount === 1) {
            messages = [
              {
                id: 'msg1',
                message: 'Build Started',
                date: '2024-01-15 10:00:00.000000000',
                author: { _account_id: 9999, name: 'CI Bot' },
              },
            ]
          } else {
            messages = [
              {
                id: 'msg1',
                message: 'Build Started',
                date: '2024-01-15 10:00:00.000000000',
                author: { _account_id: 9999, name: 'CI Bot' },
              },
              {
                id: 'msg2',
                message: 'Patch Set 1: Verified-1',
                date: '2024-01-15 10:05:00.000000000',
                author: { _account_id: 9999, name: 'CI Bot' },
              },
            ]
          }

          return HttpResponse.json(
            { messages },
            { headers: { 'Content-Type': 'application/json' } },
          )
        }
        return HttpResponse.text('Not Found', { status: 404 })
      }),
    )

    const effect = buildStatusCommand('12345', {
      watch: true,
      interval: 0.1,
      timeout: 10,
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(createMockConfigLayer()))

    await Effect.runPromise(effect)

    expect(capturedStdout.length).toBeGreaterThanOrEqual(2)
    expect(JSON.parse(capturedStdout[capturedStdout.length - 1])).toEqual({ state: 'failure' })

    // Minimalistic output: no stderr messages except on timeout/error
    expect(capturedErrors.length).toBe(0)
  })

  test('times out after specified duration', async () => {
    server.use(
      http.get('*/a/changes/12345', ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('o') === 'MESSAGES') {
          // Always return running state
          return HttpResponse.json(
            {
              messages: [
                {
                  id: 'msg1',
                  message: 'Build Started',
                  date: '2024-01-15 10:00:00.000000000',
                  author: { _account_id: 9999, name: 'CI Bot' },
                },
              ],
            },
            { headers: { 'Content-Type': 'application/json' } },
          )
        }
        return HttpResponse.text('Not Found', { status: 404 })
      }),
    )

    const effect = buildStatusCommand('12345', {
      watch: true,
      interval: 0.1,
      timeout: 0.5, // Very short timeout
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(createMockConfigLayer()))

    try {
      await Effect.runPromise(effect)
    } catch {
      // Should exit with code 2 for timeout
      expect(mockProcessExit).toHaveBeenCalledWith(2)
      expect(capturedErrors.some((e: string) => e.includes('Timeout'))).toBe(true)
    }
  })

  test('exit-status flag causes exit 1 on failure', async () => {
    server.use(
      http.get('*/a/changes/12345', ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('o') === 'MESSAGES') {
          return HttpResponse.json(
            {
              messages: [
                {
                  id: 'msg1',
                  message: 'Build Started',
                  date: '2024-01-15 10:00:00.000000000',
                  author: { _account_id: 9999, name: 'CI Bot' },
                },
                {
                  id: 'msg2',
                  message: 'Patch Set 1: Verified-1',
                  date: '2024-01-15 10:05:00.000000000',
                  author: { _account_id: 9999, name: 'CI Bot' },
                },
              ],
            },
            { headers: { 'Content-Type': 'application/json' } },
          )
        }
        return HttpResponse.text('Not Found', { status: 404 })
      }),
    )

    const effect = buildStatusCommand('12345', {
      watch: true,
      interval: 0.1,
      timeout: 10,
      exitStatus: true,
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(createMockConfigLayer()))

    try {
      await Effect.runPromise(effect)
    } catch {
      // Should exit with code 1 for failure when --exit-status is used
      expect(mockProcessExit).toHaveBeenCalledWith(1)
    }
  })

  test('exit-status flag does not affect success state', async () => {
    server.use(
      http.get('*/a/changes/12345', ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('o') === 'MESSAGES') {
          return HttpResponse.json(
            {
              messages: [
                {
                  id: 'msg1',
                  message: 'Build Started',
                  date: '2024-01-15 10:00:00.000000000',
                  author: { _account_id: 9999, name: 'CI Bot' },
                },
                {
                  id: 'msg2',
                  message: 'Patch Set 1: Verified+1',
                  date: '2024-01-15 10:05:00.000000000',
                  author: { _account_id: 9999, name: 'CI Bot' },
                },
              ],
            },
            { headers: { 'Content-Type': 'application/json' } },
          )
        }
        return HttpResponse.text('Not Found', { status: 404 })
      }),
    )

    const effect = buildStatusCommand('12345', {
      watch: true,
      interval: 0.1,
      timeout: 10,
      exitStatus: true,
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(createMockConfigLayer()))

    await Effect.runPromise(effect)

    // Should not call process.exit for success state
    expect(mockProcessExit).not.toHaveBeenCalled()
    expect(JSON.parse(capturedStdout[0])).toEqual({ state: 'success' })
  })

  test('watch mode handles not_found state', async () => {
    server.use(
      http.get('*/a/changes/99999', () => {
        return HttpResponse.text('Not Found', { status: 404 })
      }),
    )

    const effect = buildStatusCommand('99999', {
      watch: true,
      interval: 0.1,
      timeout: 10,
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(createMockConfigLayer()))

    await Effect.runPromise(effect)

    expect(capturedStdout.length).toBe(1)
    expect(JSON.parse(capturedStdout[0])).toEqual({ state: 'not_found' })

    // 404 errors bypass pollBuildStatus and are handled in error handler
    // Minimalistic output: no stderr messages for not_found state
    expect(capturedErrors.length).toBe(0)
  })

  test('without watch flag, behaves as single check', async () => {
    server.use(
      http.get('*/a/changes/12345', ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('o') === 'MESSAGES') {
          return HttpResponse.json(
            {
              messages: [
                {
                  id: 'msg1',
                  message: 'Build Started',
                  date: '2024-01-15 10:00:00.000000000',
                  author: { _account_id: 9999, name: 'CI Bot' },
                },
              ],
            },
            { headers: { 'Content-Type': 'application/json' } },
          )
        }
        return HttpResponse.text('Not Found', { status: 404 })
      }),
    )

    const effect = buildStatusCommand('12345', {
      watch: false,
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(createMockConfigLayer()))

    await Effect.runPromise(effect)

    // Should only have one output (no polling)
    expect(capturedStdout.length).toBe(1)
    expect(JSON.parse(capturedStdout[0])).toEqual({ state: 'running' })

    // Should not have watch mode messages in stderr
    expect(capturedErrors.some((e: string) => e.includes('Watching build status'))).toBe(false)
  })
})
