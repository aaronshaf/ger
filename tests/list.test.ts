import { describe, test, expect, beforeAll, afterAll, afterEach } from 'bun:test'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { Effect, Layer } from 'effect'
import { listCommand } from '@/cli/commands/list'
import { GerritApiServiceLive } from '@/api/gerrit'
import { ConfigService } from '@/services/config'
import { createMockConfigService } from './helpers/config-mock'
import type { ChangeInfo } from '@/schemas/gerrit'

const makeChange = (overrides: Partial<ChangeInfo> = {}): ChangeInfo => ({
  id: 'project~main~I123',
  _number: 12345,
  project: 'my-project',
  branch: 'main',
  change_id: 'I123',
  subject: 'Fix the important thing',
  status: 'NEW',
  created: '2025-01-15 10:00:00.000000000',
  updated: '2025-01-15 12:00:00.000000000',
  owner: { _account_id: 1, name: 'Alice', email: 'alice@x.com' },
  ...overrides,
})

const mockChanges: ChangeInfo[] = [
  makeChange({ _number: 1, subject: 'First change' }),
  makeChange({
    _number: 2,
    subject: 'Second change with Code-Review',
    labels: { 'Code-Review': { approved: { _account_id: 1 }, value: 2 } },
  }),
  makeChange({
    _number: 3,
    subject: 'Third change rejected',
    labels: { 'Code-Review': { rejected: { _account_id: 2 }, value: -2 } },
  }),
]

const server = setupServer(
  http.get('*/a/accounts/self', () =>
    HttpResponse.json({ _account_id: 1, name: 'Alice', email: 'alice@x.com' }),
  ),
  http.get('*/a/changes/', () => HttpResponse.json(mockChanges)),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }))
afterAll(() => server.close())
afterEach(() => server.resetHandlers())

const mockConfig = createMockConfigService()

describe('list command', () => {
  test('renders table with header and rows', async () => {
    const logs: string[] = []
    const origLog = console.log
    console.log = (...args: unknown[]) => logs.push(String(args[0]))

    try {
      await Effect.runPromise(
        listCommand({}).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(Layer.succeed(ConfigService, mockConfig)),
        ),
      )
    } finally {
      console.log = origLog
    }

    const output = logs.join('\n')
    expect(output).toContain('Change')
    expect(output).toContain('Subject')
    expect(output).toContain('CR')
    expect(output).toContain('Verified')
    expect(output).toContain('1')
    expect(output).toContain('First change')
  })

  test('outputs JSON', async () => {
    const logs: string[] = []
    const origLog = console.log
    console.log = (...args: unknown[]) => logs.push(String(args[0]))

    try {
      await Effect.runPromise(
        listCommand({ json: true }).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(Layer.succeed(ConfigService, mockConfig)),
        ),
      )
    } finally {
      console.log = origLog
    }

    const parsed = JSON.parse(logs.join('')) as { status: string; count: number }
    expect(parsed.status).toBe('success')
    expect(parsed.count).toBe(3)
  })

  test('outputs XML', async () => {
    const logs: string[] = []
    const origLog = console.log
    console.log = (...args: unknown[]) => logs.push(String(args[0]))

    try {
      await Effect.runPromise(
        listCommand({ xml: true }).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(Layer.succeed(ConfigService, mockConfig)),
        ),
      )
    } finally {
      console.log = origLog
    }

    const output = logs.join('\n')
    expect(output).toContain('<changes count="3">')
    expect(output).toContain('<number>1</number>')
  })

  test('--detailed shows per-change info', async () => {
    const logs: string[] = []
    const origLog = console.log
    console.log = (...args: unknown[]) => logs.push(String(args[0]))

    try {
      await Effect.runPromise(
        listCommand({ detailed: true }).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(Layer.succeed(ConfigService, mockConfig)),
        ),
      )
    } finally {
      console.log = origLog
    }

    const output = logs.join('\n')
    expect(output).toContain('Change:')
    expect(output).toContain('Subject:')
    expect(output).toContain('Project:')
  })

  test('--limit caps results', async () => {
    const logs: string[] = []
    const origLog = console.log
    console.log = (...args: unknown[]) => logs.push(String(args[0]))

    try {
      await Effect.runPromise(
        listCommand({ limit: 1, json: true }).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(Layer.succeed(ConfigService, mockConfig)),
        ),
      )
    } finally {
      console.log = origLog
    }

    const parsed = JSON.parse(logs.join('')) as { count: number }
    expect(parsed.count).toBe(1)
  })

  test('--status passes query to API', async () => {
    let capturedUrl = ''
    server.use(
      http.get('*/a/changes/', ({ request }) => {
        capturedUrl = decodeURIComponent(request.url)
        return HttpResponse.json([])
      }),
    )

    await Effect.runPromise(
      listCommand({ status: 'merged' }).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(Layer.succeed(ConfigService, mockConfig)),
      ),
    )

    expect(capturedUrl).toContain('status:merged')
  })

  test('--reviewer uses reviewer query', async () => {
    let capturedUrl = ''
    server.use(
      http.get('*/a/changes/', ({ request }) => {
        capturedUrl = decodeURIComponent(request.url)
        return HttpResponse.json([])
      }),
    )

    await Effect.runPromise(
      listCommand({ reviewer: true }).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(Layer.succeed(ConfigService, mockConfig)),
      ),
    )

    expect(capturedUrl).toContain('reviewer:')
  })

  test('shows empty message when no changes', async () => {
    server.use(http.get('*/a/changes/', () => HttpResponse.json([])))

    const logs: string[] = []
    const origLog = console.log
    console.log = (...args: unknown[]) => logs.push(String(args[0]))

    try {
      await Effect.runPromise(
        listCommand({}).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(Layer.succeed(ConfigService, mockConfig)),
        ),
      )
    } finally {
      console.log = origLog
    }

    expect(logs.join('\n')).toContain('No changes found')
  })
})
