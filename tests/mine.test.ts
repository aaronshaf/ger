import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { Effect, Layer } from 'effect'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { GerritApiServiceLive } from '@/api/gerrit'
import { mineCommand } from '@/cli/commands/mine'
import { ConfigService } from '@/services/config'
import { generateMockChange } from '@/test-utils/mock-generator'
import type { ChangeInfo } from '@/schemas/gerrit'
import { createMockConfigService } from './helpers/config-mock'

// Create MSW server
const server = setupServer(
  // Default handler for auth check
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

describe('mine command', () => {
  let mockConsoleLog: ReturnType<typeof mock>

  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'bypass' })
  })

  afterAll(() => {
    server.close()
  })

  beforeEach(() => {
    mockConsoleLog = mock(() => {})
    console.log = mockConsoleLog
  })

  afterEach(() => {
    server.resetHandlers()
  })

  test('should fetch and display my changes in pretty format', async () => {
    const mockChanges: ChangeInfo[] = [
      generateMockChange({
        _number: 12345,
        subject: 'My test change',
        project: 'test-project',
        branch: 'main',
        status: 'NEW',
      }),
      generateMockChange({
        _number: 12346,
        subject: 'Another change',
        project: 'test-project-2',
        branch: 'develop',
        status: 'MERGED',
      }),
    ]

    server.use(
      http.get('*/a/changes/', ({ request }) => {
        const url = new URL(request.url)
        expect(url.searchParams.get('q')).toBe('owner:self status:open')
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockChanges)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    await Effect.runPromise(
      mineCommand({ xml: false }).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(mockConfigLayer),
      ),
    )

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output.length).toBeGreaterThan(0)
    expect(output).toContain('My test change')
    expect(output).toContain('Another change')
  })

  test('should output XML format when --xml flag is used', async () => {
    const mockChanges: ChangeInfo[] = [
      generateMockChange({
        _number: 12345,
        subject: 'Test change',
        project: 'test-project',
        branch: 'main',
        status: 'NEW',
      }),
    ]

    server.use(
      http.get('*/a/changes/', ({ request }) => {
        const url = new URL(request.url)
        expect(url.searchParams.get('q')).toBe('owner:self status:open')
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockChanges)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    await Effect.runPromise(
      mineCommand({ xml: true }).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(mockConfigLayer),
      ),
    )

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(output).toContain('<changes count="1">')
    expect(output).toContain('<change>')
    expect(output).toContain('<number>12345</number>')
    expect(output).toContain('<subject><![CDATA[Test change]]></subject>')
    expect(output).toContain('<project>test-project</project>')
    expect(output).toContain('<branch>main</branch>')
    expect(output).toContain('<status>NEW</status>')
    expect(output).toContain('</change>')
    expect(output).toContain('</changes>')
  })

  test('should include labels in --json output', async () => {
    const mockChanges: ChangeInfo[] = [
      generateMockChange({
        _number: 12345,
        subject: 'Labeled change',
        labels: {
          'Code-Review': { value: 2, default_value: 0 },
          Verified: { value: -1, default_value: 0 },
        },
      }),
    ]

    server.use(
      http.get('*/a/changes/', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockChanges)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    await Effect.runPromise(
      mineCommand({ json: true }).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(mockConfigLayer),
      ),
    )

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    const parsed = JSON.parse(output)
    const change = parsed.changes[0]
    expect(change.labels).toBeDefined()
    expect(change.labels['Code-Review'].value).toBe(2)
    expect(change.labels['Verified'].value).toBe(-1)
  })

  test('should omit labels key in --json output when change has no labels', async () => {
    const mockChanges: ChangeInfo[] = [generateMockChange({ _number: 12345 })]

    server.use(
      http.get('*/a/changes/', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockChanges)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    await Effect.runPromise(
      mineCommand({ json: true }).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(mockConfigLayer),
      ),
    )

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    const parsed = JSON.parse(output)
    expect(parsed.changes[0].labels).toBeUndefined()
  })

  test('should handle no changes gracefully', async () => {
    server.use(
      http.get('*/a/changes/', () => {
        return HttpResponse.text(")]}'\n[]")
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    await Effect.runPromise(
      mineCommand({ xml: false }).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(mockConfigLayer),
      ),
    )

    // Mine command returns early for empty results, so no output is expected
    expect(mockConsoleLog.mock.calls).toEqual([])
  })

  test('should handle no changes gracefully in XML format', async () => {
    server.use(
      http.get('*/a/changes/', () => {
        return HttpResponse.text(")]}'\n[]")
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    await Effect.runPromise(
      mineCommand({ xml: true }).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(mockConfigLayer),
      ),
    )

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(output).toContain('<changes count="0">')
    expect(output).toContain('</changes>')
  })

  test('should handle network failures gracefully', async () => {
    server.use(
      http.get('*/a/changes/', () => {
        return HttpResponse.text('Network error', { status: 500 })
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const result = await Effect.runPromise(
      Effect.either(
        mineCommand({ xml: false }).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(mockConfigLayer),
        ),
      ),
    )

    expect(result._tag).toBe('Left')
  })

  test('should handle network failures gracefully in XML format', async () => {
    server.use(
      http.get('*/a/changes/', () => {
        return HttpResponse.text('API error', { status: 500 })
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const result = await Effect.runPromise(
      Effect.either(
        mineCommand({ xml: true }).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(mockConfigLayer),
        ),
      ),
    )

    expect(result._tag).toBe('Left')
  })

  test('should properly escape XML special characters', async () => {
    const mockChanges: ChangeInfo[] = [
      generateMockChange({
        _number: 12345,
        subject: 'Test with <special> & "characters"',
        project: 'test-project',
        branch: 'feature/test&update',
        status: 'NEW',
      }),
    ]

    server.use(
      http.get('*/a/changes/', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockChanges)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    await Effect.runPromise(
      mineCommand({ xml: true }).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(mockConfigLayer),
      ),
    )

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    // CDATA sections should preserve special characters
    expect(output).toContain('<![CDATA[Test with <special> & "characters"]]>')
    expect(output).toContain('<branch>feature/test&update</branch>')
  })

  test('should display changes with proper grouping by project', async () => {
    const mockChanges: ChangeInfo[] = [
      generateMockChange({
        _number: 12345,
        subject: 'Change in project A',
        project: 'project-a',
        branch: 'main',
        status: 'NEW',
      }),
      generateMockChange({
        _number: 12346,
        subject: 'Change in project B',
        project: 'project-b',
        branch: 'main',
        status: 'NEW',
      }),
      generateMockChange({
        _number: 12347,
        subject: 'Another change in project A',
        project: 'project-a',
        branch: 'develop',
        status: 'MERGED',
      }),
    ]

    server.use(
      http.get('*/a/changes/', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockChanges)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    await Effect.runPromise(
      mineCommand({ xml: false }).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(mockConfigLayer),
      ),
    )

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Change in project A')
    expect(output).toContain('Change in project B')
    expect(output).toContain('Another change in project A')
    expect(output).toContain('project-a')
    expect(output).toContain('project-b')
  })
})
