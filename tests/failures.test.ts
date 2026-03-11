import { describe, test, expect, beforeAll, afterAll, afterEach } from 'bun:test'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { Effect, Layer } from 'effect'
import { failuresCommand } from '@/cli/commands/failures'
import { GerritApiServiceLive } from '@/api/gerrit'
import { ConfigService } from '@/services/config'
import { createMockConfigService } from './helpers/config-mock'

const JENKINS_URL = 'https://jenkins.inst-ci.net/job/Canvas/job/main/123//build-summary-report/'

const makeMessage = (id: string, message: string, authorName = 'Test User') => ({
  id,
  message,
  date: '2025-01-15 10:00:00.000000000',
  author: { _account_id: 1, name: authorName, email: 'test@example.com' },
})

const makeMessagesResponse = (messages: ReturnType<typeof makeMessage>[]) => ({
  messages,
})

const defaultMessages = [
  makeMessage('m1', 'Build started', 'Service Cloud Jenkins'),
  makeMessage(
    'm2',
    `Patch Set 1: Verified-1\n\nBuild failed. See ${JENKINS_URL}`,
    'Service Cloud Jenkins',
  ),
]

const server = setupServer(
  http.get('*/a/accounts/self', () =>
    HttpResponse.json({ _account_id: 1, name: 'User', email: 'u@example.com' }),
  ),
  http.get('*/a/changes/12345', () => HttpResponse.json(makeMessagesResponse(defaultMessages))),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }))
afterAll(() => server.close())
afterEach(() => server.resetHandlers())

const mockConfig = createMockConfigService()

describe('failures command', () => {
  test('outputs the Jenkins failure URL', async () => {
    const logs: string[] = []
    const origLog = console.log
    console.log = (...args: unknown[]) => logs.push(String(args[0]))

    try {
      await Effect.runPromise(
        failuresCommand('12345', {}).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(Layer.succeed(ConfigService, mockConfig)),
        ),
      )
    } finally {
      console.log = origLog
    }

    expect(logs.join('\n')).toContain(JENKINS_URL)
  })

  test('outputs JSON with url field', async () => {
    const logs: string[] = []
    const origLog = console.log
    console.log = (...args: unknown[]) => logs.push(String(args[0]))

    try {
      await Effect.runPromise(
        failuresCommand('12345', { json: true }).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(Layer.succeed(ConfigService, mockConfig)),
        ),
      )
    } finally {
      console.log = origLog
    }

    const parsed = JSON.parse(logs.join('')) as { status: string; url: string }
    expect(parsed.status).toBe('found')
    expect(parsed.url).toBe(JENKINS_URL)
  })

  test('outputs XML with url element', async () => {
    const logs: string[] = []
    const origLog = console.log
    console.log = (...args: unknown[]) => logs.push(String(args[0]))

    try {
      await Effect.runPromise(
        failuresCommand('12345', { xml: true }).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(Layer.succeed(ConfigService, mockConfig)),
        ),
      )
    } finally {
      console.log = origLog
    }

    const output = logs.join('\n')
    expect(output).toContain('<failures>')
    expect(output).toContain(`<url>${JENKINS_URL}</url>`)
  })

  test('ignores messages not from Service Cloud Jenkins', async () => {
    server.use(
      http.get('*/a/changes/12345', () =>
        HttpResponse.json(
          makeMessagesResponse([
            makeMessage('m1', `Verified-1\n\nFailed: ${JENKINS_URL}`, 'Some Other Bot'),
          ]),
        ),
      ),
    )

    const logs: string[] = []
    const origLog = console.log
    console.log = (...args: unknown[]) => logs.push(String(args[0]))

    try {
      await Effect.runPromise(
        failuresCommand('12345', {}).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(Layer.succeed(ConfigService, mockConfig)),
        ),
      )
    } finally {
      console.log = origLog
    }

    expect(logs.join('\n')).not.toContain(JENKINS_URL)
    expect(logs.join('\n')).toContain('No build failure links found')
  })

  test('ignores Service Cloud Jenkins messages without Verified-1', async () => {
    server.use(
      http.get('*/a/changes/12345', () =>
        HttpResponse.json(
          makeMessagesResponse([
            makeMessage('m1', `Build started: ${JENKINS_URL}`, 'Service Cloud Jenkins'),
          ]),
        ),
      ),
    )

    const logs: string[] = []
    const origLog = console.log
    console.log = (...args: unknown[]) => logs.push(String(args[0]))

    try {
      await Effect.runPromise(
        failuresCommand('12345', {}).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(Layer.succeed(ConfigService, mockConfig)),
        ),
      )
    } finally {
      console.log = origLog
    }

    expect(logs.join('\n')).not.toContain(JENKINS_URL)
    expect(logs.join('\n')).toContain('No build failure links found')
  })

  test('returns most recent failure when multiple exist', async () => {
    const NEWER_URL = 'https://jenkins.inst-ci.net/job/Canvas/job/main/456//build-summary-report/'
    server.use(
      http.get('*/a/changes/12345', () =>
        HttpResponse.json(
          makeMessagesResponse([
            makeMessage('m1', `Verified-1\n\nFailed: ${JENKINS_URL}`, 'Service Cloud Jenkins'),
            makeMessage('m2', `Verified-1\n\nFailed: ${NEWER_URL}`, 'Service Cloud Jenkins'),
          ]),
        ),
      ),
    )

    const logs: string[] = []
    const origLog = console.log
    console.log = (...args: unknown[]) => logs.push(String(args[0]))

    try {
      await Effect.runPromise(
        failuresCommand('12345', {}).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(Layer.succeed(ConfigService, mockConfig)),
        ),
      )
    } finally {
      console.log = origLog
    }

    expect(logs.join('\n')).toContain(NEWER_URL)
    expect(logs.join('\n')).not.toContain(JENKINS_URL)
  })

  test('fails when change not found', async () => {
    server.use(http.get('*/a/changes/99999', () => HttpResponse.json({}, { status: 404 })))

    const result = await Effect.runPromise(
      failuresCommand('99999', {}).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(Layer.succeed(ConfigService, mockConfig)),
        Effect.either,
      ),
    )

    expect(result._tag).toBe('Left')
  })
})
