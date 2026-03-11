import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Effect, Layer } from 'effect'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { GerritApiServiceLive } from '@/api/gerrit'
import { ConfigService } from '@/services/config'
import { retriggerCommand } from '@/cli/commands/retrigger'
import { createMockConfigService } from './helpers/config-mock'

// Mock @inquirer/prompts so tests don't block on stdin
const mockInput = mock(async () => 'trigger-build')
mock.module('@inquirer/prompts', () => ({ input: mockInput }))

const server = setupServer(
  http.get('*/a/accounts/self', () =>
    HttpResponse.json({ _account_id: 1, name: 'User', email: 'u@example.com' }),
  ),
  http.post('*/a/changes/:changeId/revisions/current/review', () => HttpResponse.json({})),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }))
afterAll(() => server.close())

describe('retrigger command', () => {
  let mockConsoleLog: ReturnType<typeof mock>
  let mockConsoleError: ReturnType<typeof mock>

  beforeEach(() => {
    mockConsoleLog = mock()
    mockConsoleError = mock()
    console.log = mockConsoleLog
    console.error = mockConsoleError
    mockInput.mockReset()
    mockInput.mockResolvedValue('trigger-build')
    server.resetHandlers()
  })

  afterEach(() => {
    server.resetHandlers()
  })

  it('posts the retrigger comment when change-id is explicit and comment is configured', async () => {
    const mockConfig = createMockConfigService(undefined, undefined, '__TRIGGER__')

    await Effect.runPromise(
      retriggerCommand('12345', {}).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(Layer.succeed(ConfigService, mockConfig)),
      ),
    )

    // Should print success
    expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('✓'))
  })

  it('posts to the given change-id', async () => {
    const mockConfig = createMockConfigService(undefined, undefined, '__TRIGGER__')

    let postedChangeId = ''
    server.use(
      http.post('*/a/changes/:changeId/revisions/current/review', ({ params }) => {
        postedChangeId = params.changeId as string
        return HttpResponse.json({})
      }),
    )

    await Effect.runPromise(
      retriggerCommand('67890', {}).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(Layer.succeed(ConfigService, mockConfig)),
      ),
    )

    expect(postedChangeId).toBe('67890')
  })

  it('prompts for retrigger comment when not configured, then saves it', async () => {
    let savedComment = ''
    const mockConfig: ReturnType<typeof createMockConfigService> = {
      ...createMockConfigService(),
      getRetriggerComment: Effect.succeed(undefined),
      saveRetriggerComment: (comment: string) => {
        savedComment = comment
        return Effect.succeed(undefined as void)
      },
    }

    mockInput.mockResolvedValue('my-trigger-comment')

    await Effect.runPromise(
      retriggerCommand('12345', {}).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(Layer.succeed(ConfigService, mockConfig)),
      ),
    )

    expect(mockInput).toHaveBeenCalled()
    expect(savedComment).toBe('my-trigger-comment')
  })

  it('throws when prompted comment is empty', async () => {
    const mockConfig: ReturnType<typeof createMockConfigService> = {
      ...createMockConfigService(),
      getRetriggerComment: Effect.succeed(undefined),
      saveRetriggerComment: () => Effect.succeed(undefined as void),
    }

    mockInput.mockResolvedValue('   ')

    let threw = false
    try {
      await Effect.runPromise(
        retriggerCommand('12345', {}).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(Layer.succeed(ConfigService, mockConfig)),
        ),
      )
    } catch (e) {
      threw = true
      expect(String(e)).toContain('cannot be empty')
    }
    expect(threw).toBe(true)
  })

  it('outputs JSON on success', async () => {
    const mockConfig = createMockConfigService(undefined, undefined, '__TRIGGER__')

    const logs: string[] = []
    console.log = (msg: string) => logs.push(msg)

    await Effect.runPromise(
      retriggerCommand('12345', { json: true }).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(Layer.succeed(ConfigService, mockConfig)),
      ),
    )

    const parsed = JSON.parse(logs[0]) as { status: string; change_id: string }
    expect(parsed.status).toBe('success')
    expect(parsed.change_id).toBe('12345')
  })

  it('outputs XML on success', async () => {
    const mockConfig = createMockConfigService(undefined, undefined, '__TRIGGER__')

    const logs: string[] = []
    console.log = (msg: string) => logs.push(msg)

    await Effect.runPromise(
      retriggerCommand('12345', { xml: true }).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(Layer.succeed(ConfigService, mockConfig)),
      ),
    )

    expect(logs.join('\n')).toContain('<retrigger>')
    expect(logs.join('\n')).toContain('<status>success</status>')
  })
})
