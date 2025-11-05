import { describe, test, expect, beforeAll, afterAll, afterEach, mock } from 'bun:test'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { Effect, Layer } from 'effect'
import { extractUrlCommand } from '@/cli/commands/extract-url'
import { GerritApiServiceLive } from '@/api/gerrit'
import { ConfigService } from '@/services/config'
import type { MessageInfo } from '@/schemas/gerrit'

import { createMockConfigService } from './helpers/config-mock'

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

// Store captured output
let capturedLogs: string[] = []
let capturedErrors: string[] = []

// Mock console.log and console.error
const mockConsoleLog = mock((...args: any[]) => {
  capturedLogs.push(args.join(' '))
})
const mockConsoleError = mock((...args: any[]) => {
  capturedErrors.push(args.join(' '))
})

// Store original console methods
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

describe('extract-url command', () => {
  const mockComments = {
    'src/main.js': [
      {
        id: 'comment1',
        path: 'src/main.js',
        line: 10,
        message: 'Check this out: https://github.com/example/repo/pull/123',
        author: {
          name: 'Alice',
          email: 'alice@example.com',
        },
        updated: '2025-01-15 10:00:00.000000000',
        unresolved: false,
      },
    ],
    '/COMMIT_MSG': [
      {
        id: 'comment2',
        path: '/COMMIT_MSG',
        line: 1,
        message: 'See https://docs.example.com/guide',
        author: {
          name: 'Bob',
          email: 'bob@example.com',
        },
        updated: '2025-01-15 11:00:00.000000000',
        unresolved: false,
      },
    ],
  }

  const mockMessages: MessageInfo[] = [
    {
      id: 'msg1',
      message:
        'Patch Set 1:\n\nBuild Started https://jenkins.inst-ci.net/job/Canvas/job/main/154074/',
      author: { _account_id: 1001, name: 'Jenkins Bot' },
      date: '2025-01-15 09:00:00.000000000',
      _revision_number: 1,
    },
    {
      id: 'msg2',
      message:
        'Patch Set 1: Verified-1\n\nBuild Failed \n\nhttps://jenkins.inst-ci.net/job/Canvas/job/main/154074//build-summary-report/ : FAILURE',
      author: { _account_id: 1001, name: 'Jenkins Bot' },
      date: '2025-01-15 09:15:00.000000000',
      _revision_number: 1,
    },
    {
      id: 'msg3',
      message:
        'Patch Set 2:\n\nBuild Started https://jenkins.inst-ci.net/job/Canvas/job/main/156340/',
      author: { _account_id: 1001, name: 'Jenkins Bot' },
      date: '2025-01-15 10:00:00.000000000',
      _revision_number: 2,
    },
    {
      id: 'msg4',
      message:
        'Patch Set 2: Verified-1\n\nBuild Failed \n\nhttps://jenkins.inst-ci.net/job/Canvas/job/main/156340//build-summary-report/ : FAILURE',
      author: { _account_id: 1001, name: 'Jenkins Bot' },
      date: '2025-01-15 10:15:00.000000000',
      _revision_number: 2,
    },
  ]

  const setupMockHandlers = (
    comments: Record<string, any> = mockComments,
    messages: MessageInfo[] = mockMessages,
  ) => {
    server.use(
      // Get comments
      http.get('*/a/changes/:changeId/revisions/current/comments', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(comments)}`)
      }),
      // Get messages
      http.get('*/a/changes/:changeId', ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('o') === 'MESSAGES') {
          return HttpResponse.text(`)]}'\n${JSON.stringify({ messages })}`)
        }
        return HttpResponse.text(`)]}'\n${JSON.stringify({ messages: [] })}`)
      }),
    )
  }

  const createMockConfigLayer = () => Layer.succeed(ConfigService, createMockConfigService())

  test('should extract URLs matching substring pattern from messages', async () => {
    setupMockHandlers()

    const mockConfigLayer = createMockConfigLayer()
    const program = extractUrlCommand('jenkins', '12345', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = capturedLogs.join('\n')

    // Should contain all Jenkins URLs in chronological order
    expect(output).toContain('https://jenkins.inst-ci.net/job/Canvas/job/main/154074/')
    expect(output).toContain(
      'https://jenkins.inst-ci.net/job/Canvas/job/main/154074//build-summary-report/',
    )
    expect(output).toContain('https://jenkins.inst-ci.net/job/Canvas/job/main/156340/')
    expect(output).toContain(
      'https://jenkins.inst-ci.net/job/Canvas/job/main/156340//build-summary-report/',
    )

    // Check order - should be chronological (oldest first)
    const lines = output.split('\n').filter((line) => line.includes('jenkins'))
    expect(lines[0]).toContain('154074')
    expect(lines[lines.length - 1]).toContain('156340')
  })

  test('should extract URLs matching build-summary-report pattern', async () => {
    setupMockHandlers()

    const mockConfigLayer = createMockConfigLayer()
    const program = extractUrlCommand('build-summary-report', '12345', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = capturedLogs.join('\n')
    const lines = output.split('\n').filter((line) => line.trim())

    // Should only contain build-summary-report URLs
    expect(lines.length).toBe(2)
    expect(lines[0]).toContain('154074//build-summary-report/')
    expect(lines[1]).toContain('156340//build-summary-report/')
  })

  test('should support regex pattern matching', async () => {
    setupMockHandlers()

    const mockConfigLayer = createMockConfigLayer()
    const program = extractUrlCommand('job/Canvas/job/main/\\d+/$', '12345', { regex: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = capturedLogs.join('\n')
    const lines = output.split('\n').filter((line) => line.trim())

    // Should only match URLs ending with job number (not build-summary-report)
    expect(lines.length).toBe(2)
    expect(lines[0]).toBe('https://jenkins.inst-ci.net/job/Canvas/job/main/154074/')
    expect(lines[1]).toBe('https://jenkins.inst-ci.net/job/Canvas/job/main/156340/')
  })

  test('should include URLs from comments when --include-comments is used', async () => {
    setupMockHandlers()

    const mockConfigLayer = createMockConfigLayer()
    const program = extractUrlCommand('github', '12345', { includeComments: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = capturedLogs.join('\n')

    // Should contain URL from comment
    expect(output).toContain('https://github.com/example/repo/pull/123')
  })

  test('should not include comment URLs by default', async () => {
    setupMockHandlers()

    const mockConfigLayer = createMockConfigLayer()
    const program = extractUrlCommand('github', '12345', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = capturedLogs.join('\n')

    // Should not contain URL from comment
    expect(output).not.toContain('https://github.com/example/repo/pull/123')
  })

  test('should output JSON format when --json flag is used', async () => {
    setupMockHandlers()

    const mockConfigLayer = createMockConfigLayer()
    const program = extractUrlCommand('build-summary-report', '12345', { json: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = capturedLogs.join('\n')
    const parsed = JSON.parse(output)

    expect(parsed.status).toBe('success')
    expect(Array.isArray(parsed.urls)).toBe(true)
    expect(parsed.urls.length).toBe(2)
    expect(parsed.urls[0]).toContain('154074//build-summary-report/')
    expect(parsed.urls[1]).toContain('156340//build-summary-report/')
  })

  test('should output XML format when --xml flag is used', async () => {
    setupMockHandlers()

    const mockConfigLayer = createMockConfigLayer()
    const program = extractUrlCommand('build-summary-report', '12345', { xml: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = capturedLogs.join('\n')

    expect(output).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(output).toContain('<extract_url_result>')
    expect(output).toContain('<status>success</status>')
    expect(output).toContain('<urls>')
    expect(output).toContain('<count>2</count>')
    expect(output).toContain('154074//build-summary-report/')
    expect(output).toContain('156340//build-summary-report/')
    expect(output).toContain('</urls>')
    expect(output).toContain('</extract_url_result>')
  })

  test('should handle no matching URLs gracefully', async () => {
    setupMockHandlers()

    const mockConfigLayer = createMockConfigLayer()
    const program = extractUrlCommand('nonexistent-pattern', '12345', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = capturedLogs.join('\n')

    // Should output nothing (empty list)
    expect(output.trim()).toBe('')
  })

  test('should handle no matching URLs in JSON format', async () => {
    setupMockHandlers()

    const mockConfigLayer = createMockConfigLayer()
    const program = extractUrlCommand('nonexistent-pattern', '12345', { json: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = capturedLogs.join('\n')
    const parsed = JSON.parse(output)

    expect(parsed.status).toBe('success')
    expect(parsed.urls).toEqual([])
  })

  test('should handle API errors gracefully', async () => {
    server.use(
      http.get('*/a/changes/:changeId/revisions/current/comments', () => {
        return HttpResponse.json({ error: 'Not found' }, { status: 404 })
      }),
    )

    const mockConfigLayer = createMockConfigLayer()
    const program = extractUrlCommand('jenkins', '12345', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = capturedErrors.join('\n')
    expect(output).toContain('✗ Error:')
  })

  test('should handle API errors gracefully in JSON format', async () => {
    server.use(
      http.get('*/a/changes/:changeId/revisions/current/comments', () => {
        return HttpResponse.json({ error: 'Not found' }, { status: 404 })
      }),
    )

    const mockConfigLayer = createMockConfigLayer()
    const program = extractUrlCommand('jenkins', '12345', { json: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = capturedLogs.join('\n')
    const parsed = JSON.parse(output)

    expect(parsed.status).toBe('error')
    expect(parsed.error).toBeDefined()
  })

  test('should handle API errors gracefully in XML format', async () => {
    server.use(
      http.get('*/a/changes/:changeId/revisions/current/comments', () => {
        return HttpResponse.json({ error: 'Not found' }, { status: 404 })
      }),
    )

    const mockConfigLayer = createMockConfigLayer()
    const program = extractUrlCommand('jenkins', '12345', { xml: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = capturedLogs.join('\n')

    expect(output).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(output).toContain('<extract_url_result>')
    expect(output).toContain('<status>error</status>')
    expect(output).toContain('<error><![CDATA[')
    expect(output).toContain('</extract_url_result>')
  })

  test('should handle case-insensitive substring matching', async () => {
    setupMockHandlers()

    const mockConfigLayer = createMockConfigLayer()
    const program = extractUrlCommand('JENKINS', '12345', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = capturedLogs.join('\n')

    // Should match jenkins URLs (case-insensitive)
    expect(output).toContain('https://jenkins.inst-ci.net')
  })

  test('should extract multiple different URLs from same message', async () => {
    const messagesWithMultipleUrls: MessageInfo[] = [
      {
        id: 'msg1',
        message:
          'See https://docs.example.com/guide and also https://github.com/example/repo for more info',
        author: { _account_id: 1001, name: 'User' },
        date: '2025-01-15 09:00:00.000000000',
        _revision_number: 1,
      },
    ]

    // Setup with no comments, only messages
    const emptyComments: Record<string, never> = {}
    setupMockHandlers(emptyComments, messagesWithMultipleUrls)

    const mockConfigLayer = createMockConfigLayer()
    const program = extractUrlCommand('https', '12345', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = capturedLogs.join('\n')
    const lines = output.split('\n').filter((line) => line.trim())

    expect(lines.length).toBe(2)
    expect(output).toContain('https://docs.example.com/guide')
    expect(output).toContain('https://github.com/example/repo')
  })

  test('should reject dangerous regex patterns (ReDoS protection)', async () => {
    setupMockHandlers()

    const mockConfigLayer = createMockConfigLayer()
    // Use a pattern with nested quantifiers that could cause ReDoS
    const program = extractUrlCommand('(a+)+', '12345', { regex: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = capturedErrors.join('\n')
    expect(output).toContain('✗ Error:')
    expect(output).toContain('dangerous nested quantifiers')
  })

  test('should handle invalid regex syntax gracefully', async () => {
    setupMockHandlers()

    const mockConfigLayer = createMockConfigLayer()
    // Use invalid regex syntax
    const program = extractUrlCommand('[invalid', '12345', { regex: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = capturedErrors.join('\n')
    expect(output).toContain('✗ Error:')
    expect(output).toContain('Invalid regular expression')
  })

  test('should validate pattern is not empty', async () => {
    setupMockHandlers()

    const mockConfigLayer = createMockConfigLayer()
    const program = extractUrlCommand('', '12345', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = capturedErrors.join('\n')
    expect(output).toContain('✗ Error:')
    expect(output).toContain('Pattern cannot be empty')
  })

  test('should validate pattern is not too long', async () => {
    setupMockHandlers()

    const mockConfigLayer = createMockConfigLayer()
    // Create a pattern longer than 500 characters
    const longPattern = 'a'.repeat(501)
    const program = extractUrlCommand(longPattern, '12345', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = capturedErrors.join('\n')
    expect(output).toContain('✗ Error:')
    expect(output).toContain('Pattern is too long')
  })
})
