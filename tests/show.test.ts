import { describe, test, expect, beforeAll, afterAll, afterEach, mock } from 'bun:test'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { Effect, Layer } from 'effect'
import { showCommand } from '@/cli/commands/show'
import { GerritApiServiceLive } from '@/api/gerrit'
import { ConfigService } from '@/services/config'
import { generateMockChange } from '@/test-utils/mock-generator'
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

describe('show command', () => {
  const mockChange = generateMockChange({
    _number: 12345,
    change_id: 'I123abc456def',
    subject: 'Fix authentication bug',
    status: 'NEW',
    project: 'test-project',
    branch: 'main',
    created: '2024-01-15 10:00:00.000000000',
    updated: '2024-01-15 12:00:00.000000000',
    owner: {
      _account_id: 1001,
      name: 'John Doe',
      email: 'john@example.com',
    },
  })

  const mockDiff = `--- a/src/auth.js
+++ b/src/auth.js
@@ -10,7 +10,8 @@ function authenticate(user) {
   if (!user) {
-    return false
+    throw new Error('User required')
   }
+  // Added validation
   return validateUser(user)
 }`

  const mockComments = {
    'src/auth.js': [
      {
        id: 'comment1',
        path: 'src/auth.js',
        line: 12,
        message: 'Good improvement!',
        author: {
          name: 'Jane Reviewer',
          email: 'jane@example.com',
        },
        updated: '2024-01-15 11:30:00.000000000',
        unresolved: false,
      },
      {
        id: 'comment2',
        path: 'src/auth.js',
        line: 14,
        message: 'Consider adding JSDoc',
        author: {
          name: 'Bob Reviewer',
          email: 'bob@example.com',
        },
        updated: '2024-01-15 11:45:00.000000000',
        unresolved: true,
      },
    ],
    '/COMMIT_MSG': [
      {
        id: 'comment3',
        path: '/COMMIT_MSG',
        line: 1,
        message: 'Clear commit message',
        author: {
          name: 'Alice Lead',
          email: 'alice@example.com',
        },
        updated: '2024-01-15 11:00:00.000000000',
        unresolved: false,
      },
    ],
  }

  const setupMockHandlers = () => {
    server.use(
      // Get change details
      http.get('*/a/changes/:changeId', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockChange)}`)
      }),
      // Get diff (returns base64-encoded content)
      http.get('*/a/changes/:changeId/revisions/current/patch', () => {
        return HttpResponse.text(btoa(mockDiff))
      }),
      // Get comments
      http.get('*/a/changes/:changeId/revisions/current/comments', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockComments)}`)
      }),
      // Get file diff for context (optional, may fail gracefully)
      http.get('*/a/changes/:changeId/revisions/current/files/:fileName/diff', () => {
        return HttpResponse.text(mockDiff)
      }),
    )
  }

  const createMockConfigLayer = () => Layer.succeed(ConfigService, createMockConfigService())

  test('should display comprehensive change information in pretty format', async () => {
    setupMockHandlers()

    const mockConfigLayer = createMockConfigLayer()
    const program = showCommand('12345', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = capturedLogs.join('\n')

    // Check that all sections are present
    expect(output).toContain('📋 Change 12345: Fix authentication bug')
    expect(output).toContain('📝 Details:')
    expect(output).toContain('Project: test-project')
    expect(output).toContain('Branch: main')
    expect(output).toContain('Status: NEW')
    expect(output).toContain('Owner: John Doe')
    expect(output).toContain('Change-Id: I123abc456def')
    expect(output).toContain('🔍 Diff:')
    expect(output).toContain('💬 Inline Comments:')

    // Check diff content is included
    expect(output).toContain('src/auth.js')
    expect(output).toContain('authenticate(user)')

    // Check comments are included
    expect(output).toContain('Good improvement!')
    expect(output).toContain('Consider adding JSDoc')
    expect(output).toContain('Clear commit message')
  })

  test('should output XML format when --xml flag is used', async () => {
    setupMockHandlers()

    const mockConfigLayer = createMockConfigLayer()
    const program = showCommand('12345', { xml: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = capturedLogs.join('\n')

    expect(output).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(output).toContain('<show_result>')
    expect(output).toContain('<status>success</status>')
    expect(output).toContain('<change>')
    expect(output).toContain('<id>I123abc456def</id>')
    expect(output).toContain('<number>12345</number>')
    expect(output).toContain('<subject><![CDATA[Fix authentication bug]]></subject>')
    expect(output).toContain('<status>NEW</status>')
    expect(output).toContain('<project>test-project</project>')
    expect(output).toContain('<branch>main</branch>')
    expect(output).toContain('<owner>')
    expect(output).toContain('<name><![CDATA[John Doe]]></name>')
    expect(output).toContain('<email>john@example.com</email>')
    expect(output).toContain('<diff><![CDATA[')
    expect(output).toContain('<comments>')
    expect(output).toContain('<count>3</count>')
    expect(output).toContain('</show_result>')
  })

  test('should handle API errors gracefully in pretty format', async () => {
    server.use(
      http.get('*/a/changes/:changeId', () => {
        return HttpResponse.json({ error: 'Change not found' }, { status: 404 })
      }),
    )

    const mockConfigLayer = createMockConfigLayer()
    const program = showCommand('12345', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = capturedErrors.join('\n')
    expect(output).toContain('✗ Error:')
    // The error message will be from the network layer
    expect(output.length).toBeGreaterThan(0)
  })

  test('should handle API errors gracefully in XML format', async () => {
    server.use(
      http.get('*/a/changes/:changeId', () => {
        return HttpResponse.json({ error: 'Change not found' }, { status: 404 })
      }),
    )

    const mockConfigLayer = createMockConfigLayer()
    const program = showCommand('12345', { xml: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = capturedLogs.join('\n')

    expect(output).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(output).toContain('<show_result>')
    expect(output).toContain('<status>error</status>')
    expect(output).toContain('<error><![CDATA[')
    expect(output).toContain('</show_result>')
  })

  test('should properly escape XML special characters', async () => {
    const changeWithSpecialChars = generateMockChange({
      _number: 12345,
      change_id: 'I123abc456def',
      subject: 'Fix "quotes" & <tags> in auth',
      project: 'test-project',
      branch: 'feature/fix&improve',
      owner: {
        _account_id: 1002,
        name: 'User <with> & "special" chars',
        email: 'user@example.com',
      },
    })

    server.use(
      http.get('*/a/changes/:changeId', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(changeWithSpecialChars)}`)
      }),
      http.get('*/a/changes/:changeId/revisions/current/patch', () => {
        return HttpResponse.text('diff content')
      }),
      http.get('*/a/changes/:changeId/revisions/current/comments', () => {
        return HttpResponse.text(`)]}'\n{}`)
      }),
    )

    const mockConfigLayer = createMockConfigLayer()
    const program = showCommand('12345', { xml: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = capturedLogs.join('\n')

    expect(output).toContain('<subject><![CDATA[Fix "quotes" & <tags> in auth]]></subject>')
    expect(output).toContain('<branch>feature/fix&amp;improve</branch>')
    expect(output).toContain('<name><![CDATA[User <with> & "special" chars]]></name>')
  })

  test('should handle mixed file and commit message comments', async () => {
    setupMockHandlers()

    const mockConfigLayer = createMockConfigLayer()
    const program = showCommand('12345', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = capturedLogs.join('\n')

    // Should show comments from both files and commit message
    expect(output).toContain('Good improvement!')
    expect(output).toContain('Consider adding JSDoc')
    expect(output).toContain('Clear commit message')

    // Commit message path should be renamed
    expect(output).toContain('Commit Message')
    expect(output).not.toContain('/COMMIT_MSG')
  })

  test('should handle changes with missing optional fields', async () => {
    const minimalChange = generateMockChange({
      _number: 12345,
      change_id: 'I123abc456def',
      subject: 'Minimal change',
      status: 'NEW',
      project: 'test-project',
      branch: 'main',
      owner: {
        _account_id: 1003,
        email: 'user@example.com',
      },
    })

    server.use(
      http.get('*/a/changes/:changeId', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(minimalChange)}`)
      }),
      http.get('*/a/changes/:changeId/revisions/current/patch', () => {
        return HttpResponse.text('minimal diff')
      }),
      http.get('*/a/changes/:changeId/revisions/current/comments', () => {
        return HttpResponse.text(`)]}'\n{}`)
      }),
    )

    const mockConfigLayer = createMockConfigLayer()
    const program = showCommand('12345', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = capturedLogs.join('\n')

    expect(output).toContain('📋 Change 12345: Minimal change')
    expect(output).toContain('Owner: user@example.com') // Should fallback to email
  })

  test('should display review activity messages', async () => {
    const mockChange = generateMockChange({
      _number: 12345,
      subject: 'Fix authentication bug',
    })

    const mockMessages: MessageInfo[] = [
      {
        id: 'msg1',
        message: 'Patch Set 2: Code-Review+2',
        author: { _account_id: 1001, name: 'Jane Reviewer' },
        date: '2024-01-15 11:30:00.000000000',
        _revision_number: 2,
      },
      {
        id: 'msg2',
        message: 'Patch Set 2: Verified+1\\n\\nBuild Successful',
        author: { _account_id: 1002, name: 'Jenkins Bot' },
        date: '2024-01-15 11:31:00.000000000',
        _revision_number: 2,
      },
      {
        id: 'msg3',
        message: 'Uploaded patch set 1.',
        author: { _account_id: 1000, name: 'Author' },
        date: '2024-01-15 11:29:00.000000000',
        tag: 'autogenerated:gerrit:newPatchSet',
        _revision_number: 1,
      },
    ]

    server.use(
      http.get('*/a/changes/:changeId', ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('o') === 'MESSAGES') {
          return HttpResponse.text(`)]}'\n${JSON.stringify({ messages: mockMessages })}`)
        }
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockChange)}`)
      }),
      http.get('*/a/changes/:changeId/revisions/current/patch', () => {
        return HttpResponse.text('diff content')
      }),
      http.get('*/a/changes/:changeId/revisions/current/comments', () => {
        return HttpResponse.text(`)]}'\n{}`)
      }),
    )

    const mockConfigLayer = createMockConfigLayer()
    const program = showCommand('12345', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = capturedLogs.join('\n')

    // Should display review activity section
    expect(output).toContain('📝 Review Activity:')
    expect(output).toContain('Jane Reviewer')
    expect(output).toContain('Code-Review+2')
    expect(output).toContain('Jenkins Bot')
    expect(output).toContain('Build Successful')

    // Should filter out autogenerated messages
    expect(output).not.toContain('Uploaded patch set')
  })

  test('should output JSON format when --json flag is used', async () => {
    setupMockHandlers()

    const mockConfigLayer = createMockConfigLayer()
    const program = showCommand('12345', { json: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = capturedLogs.join('\n')

    // Parse JSON to verify it's valid
    const parsed = JSON.parse(output)

    expect(parsed.status).toBe('success')
    expect(parsed.change.id).toBe('I123abc456def')
    expect(parsed.change.number).toBe(12345)
    expect(parsed.change.subject).toBe('Fix authentication bug')
    expect(parsed.change.status).toBe('NEW')
    expect(parsed.change.project).toBe('test-project')
    expect(parsed.change.branch).toBe('main')
    expect(parsed.change.owner.name).toBe('John Doe')
    expect(parsed.change.owner.email).toBe('john@example.com')

    // Check diff is present
    expect(parsed.diff).toContain('src/auth.js')
    expect(parsed.diff).toContain('authenticate(user)')

    // Check comments array
    expect(Array.isArray(parsed.comments)).toBe(true)
    expect(parsed.comments.length).toBe(3)
    expect(parsed.comments[0].message).toContain('Clear commit message')
    expect(parsed.comments[1].message).toBe('Good improvement!')
    expect(parsed.comments[2].message).toBe('Consider adding JSDoc')

    // Check messages array (should be empty for this test)
    expect(Array.isArray(parsed.messages)).toBe(true)
  })

  test('should handle API errors gracefully in JSON format', async () => {
    server.use(
      http.get('*/a/changes/:changeId', () => {
        return HttpResponse.json({ error: 'Change not found' }, { status: 404 })
      }),
    )

    const mockConfigLayer = createMockConfigLayer()
    const program = showCommand('12345', { json: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = capturedLogs.join('\n')

    // Parse JSON to verify it's valid
    const parsed = JSON.parse(output)

    expect(parsed.status).toBe('error')
    expect(parsed.error).toBeDefined()
    expect(typeof parsed.error).toBe('string')
  })

  test('should include messages in JSON output', async () => {
    const mockChange = generateMockChange({
      _number: 12345,
      subject: 'Fix authentication bug',
    })

    const mockMessages: MessageInfo[] = [
      {
        id: 'msg1',
        message: 'Patch Set 2: Verified-1\\n\\nBuild Failed https://jenkins.example.com/job/123',
        author: { _account_id: 1001, name: 'Jenkins Bot' },
        date: '2024-01-15 11:30:00.000000000',
        _revision_number: 2,
      },
    ]

    server.use(
      http.get('*/a/changes/:changeId', ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('o') === 'MESSAGES') {
          return HttpResponse.text(`)]}'\n${JSON.stringify({ messages: mockMessages })}`)
        }
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockChange)}`)
      }),
      http.get('*/a/changes/:changeId/revisions/current/patch', () => {
        return HttpResponse.text('diff content')
      }),
      http.get('*/a/changes/:changeId/revisions/current/comments', () => {
        return HttpResponse.text(`)]}'\n{}`)
      }),
    )

    const mockConfigLayer = createMockConfigLayer()
    const program = showCommand('12345', { json: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = capturedLogs.join('\n')
    const parsed = JSON.parse(output)

    expect(parsed.messages).toBeDefined()
    expect(Array.isArray(parsed.messages)).toBe(true)
    expect(parsed.messages.length).toBe(1)
    expect(parsed.messages[0].message).toContain('Build Failed')
    expect(parsed.messages[0].message).toContain('https://jenkins.example.com')
    expect(parsed.messages[0].author.name).toBe('Jenkins Bot')
    expect(parsed.messages[0].revision).toBe(2)
  })
})
