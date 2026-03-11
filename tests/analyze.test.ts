import { describe, test, expect, beforeAll, afterAll, afterEach } from 'bun:test'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { Effect, Layer } from 'effect'
import { analyzeCommand } from '@/cli/commands/analyze'
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
  subject: 'Test change',
  status: 'MERGED',
  created: '2025-01-15 10:00:00.000000000',
  updated: '2025-01-15 12:00:00.000000000',
  submitted: '2025-01-15 12:00:00.000000000',
  owner: { _account_id: 1001, name: 'Alice Smith', email: 'alice@example.com' },
  ...overrides,
})

const mockChanges: ChangeInfo[] = [
  makeChange({
    _number: 1,
    project: 'repo-a',
    owner: { _account_id: 1, name: 'Alice', email: 'alice@x.com' },
  }),
  makeChange({
    _number: 2,
    project: 'repo-a',
    owner: { _account_id: 1, name: 'Alice', email: 'alice@x.com' },
  }),
  makeChange({
    _number: 3,
    project: 'repo-b',
    owner: { _account_id: 2, name: 'Bob', email: 'bob@x.com' },
    submitted: '2025-02-10 10:00:00.000000000',
  }),
]

const server = setupServer(
  http.get('*/a/accounts/self', () =>
    HttpResponse.json({ _account_id: 1, name: 'User', email: 'u@example.com' }),
  ),
  http.get('*/a/changes/', () => HttpResponse.json(mockChanges)),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }))
afterAll(() => server.close())
afterEach(() => server.resetHandlers())

const mockConfig = createMockConfigService()

describe('analyze command', () => {
  test('runs without error and outputs terminal UI', async () => {
    const logs: string[] = []
    const origLog = console.log
    console.log = (...args: unknown[]) => logs.push(args.join(' '))

    try {
      await Effect.runPromise(
        analyzeCommand({}).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(Layer.succeed(ConfigService, mockConfig)),
        ),
      )
    } finally {
      console.log = origLog
    }

    const output = logs.join('\n')
    expect(output).toContain('repo-a')
    expect(output).toContain('Alice')
  })

  test('outputs JSON', async () => {
    const logs: string[] = []
    const origLog = console.log
    console.log = (...args: unknown[]) => logs.push(args.join(' '))

    try {
      await Effect.runPromise(
        analyzeCommand({ json: true }).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(Layer.succeed(ConfigService, mockConfig)),
        ),
      )
    } finally {
      console.log = origLog
    }

    const jsonStr = logs.find((l) => l.startsWith('{'))
    expect(jsonStr).toBeDefined()
    const parsed = JSON.parse(jsonStr as string) as { totalMerged: number }
    expect(parsed.totalMerged).toBe(3)
  })

  test('outputs XML', async () => {
    const logs: string[] = []
    const origLog = console.log
    console.log = (...args: unknown[]) => logs.push(args.join(' '))

    try {
      await Effect.runPromise(
        analyzeCommand({ xml: true }).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(Layer.succeed(ConfigService, mockConfig)),
        ),
      )
    } finally {
      console.log = origLog
    }

    const output = logs.join('\n')
    expect(output).toContain('<analytics>')
    expect(output).toContain('<total_merged>3</total_merged>')
  })

  test('outputs markdown', async () => {
    const logs: string[] = []
    const origLog = console.log
    console.log = (...args: unknown[]) => logs.push(args.join(' '))

    try {
      await Effect.runPromise(
        analyzeCommand({ markdown: true }).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(Layer.succeed(ConfigService, mockConfig)),
        ),
      )
    } finally {
      console.log = origLog
    }

    const output = logs.join('\n')
    expect(output).toContain('# Contribution Analytics')
    expect(output).toContain('| Repository | Count |')
  })

  test('outputs CSV', async () => {
    const logs: string[] = []
    const origLog = console.log
    console.log = (...args: unknown[]) => logs.push(args.join(' '))

    try {
      await Effect.runPromise(
        analyzeCommand({ csv: true }).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(Layer.succeed(ConfigService, mockConfig)),
        ),
      )
    } finally {
      console.log = origLog
    }

    const output = logs.join('\n')
    expect(output).toContain('section,key,count')
    expect(output).toContain('repo,"repo-a",2')
  })

  test('filters by repo via query', async () => {
    let capturedUrl = ''
    server.use(
      http.get('*/a/changes/', ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json([mockChanges[0]])
      }),
    )

    await Effect.runPromise(
      analyzeCommand({ repo: 'my-repo', json: true }).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(Layer.succeed(ConfigService, mockConfig)),
      ),
    )

    expect(capturedUrl).toContain('project%3Amy-repo')
  })

  test('fails gracefully when API returns error', async () => {
    server.use(http.get('*/a/changes/', () => HttpResponse.json({}, { status: 500 })))

    const result = await Effect.runPromise(
      analyzeCommand({}).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(Layer.succeed(ConfigService, mockConfig)),
        Effect.either,
      ),
    )

    expect(result._tag).toBe('Left')
  })
})
