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
let capturedStdout: string[] = []

// Mock console.log and console.error
const mockConsoleLog = mock((...args: any[]) => {
  capturedLogs.push(args.join(' '))
})
const mockConsoleError = mock((...args: any[]) => {
  capturedErrors.push(args.join(' '))
})

// Mock process.stdout.write to capture JSON output and handle callbacks
const mockStdoutWrite = mock((chunk: any, callback?: any) => {
  capturedStdout.push(String(chunk))
  // Call the callback synchronously if provided
  if (typeof callback === 'function') {
    callback()
  }
  return true
})

// Store original methods
const originalConsoleLog = console.log
const originalConsoleError = console.error
const originalStdoutWrite = process.stdout.write

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' })
  // @ts-ignore
  console.log = mockConsoleLog
  // @ts-ignore
  console.error = mockConsoleError
  // @ts-ignore
  process.stdout.write = mockStdoutWrite
})

afterAll(() => {
  server.close()
  console.log = originalConsoleLog
  console.error = originalConsoleError
  // @ts-ignore
  process.stdout.write = originalStdoutWrite
})

afterEach(() => {
  server.resetHandlers()
  mockConsoleLog.mockClear()
  mockConsoleError.mockClear()
  mockStdoutWrite.mockClear()
  capturedLogs = []
  capturedErrors = []
  capturedStdout = []
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
    reviewers: {
      REVIEWER: [
        {
          _account_id: 2001,
          name: 'Jane Reviewer',
          email: 'jane.reviewer@example.com',
          username: 'jreviewer',
        },
        {
          email: 'second.reviewer@example.com',
          username: 'sreviewer',
        },
      ],
      CC: [
        {
          _account_id: 2003,
          name: 'Team Observer',
          email: 'observer@example.com',
        },
      ],
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
    expect(output).toContain('Reviewers: Jane Reviewer <jane.reviewer@example.com>')
    expect(output).toContain('second.reviewer@example.com')
    expect(output).toContain('CCs: Team Observer <observer@example.com>')
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

    const output = capturedStdout.join('')

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
    expect(output).toContain('<reviewers>')
    expect(output).toContain('<count>2</count>')
    expect(output).toContain('<name><![CDATA[Jane Reviewer]]></name>')
    expect(output).toContain('<ccs>')
    expect(output).toContain('<count>1</count>')
    expect(output).toContain('<name><![CDATA[Team Observer]]></name>')
    expect(output).not.toContain('<account_id>undefined</account_id>')
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

    const output = capturedStdout.join('')

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

    const output = capturedStdout.join('')

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

    const output = capturedStdout.join('')

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
    expect(Array.isArray(parsed.change.reviewers)).toBe(true)
    expect(parsed.change.reviewers.length).toBe(2)
    expect(parsed.change.reviewers[0].name).toBe('Jane Reviewer')
    expect(parsed.change.reviewers[1].email).toBe('second.reviewer@example.com')
    expect(parsed.change.reviewers[1].account_id).toBeUndefined()
    expect(Array.isArray(parsed.change.ccs)).toBe(true)
    expect(parsed.change.ccs.length).toBe(1)
    expect(parsed.change.ccs[0].name).toBe('Team Observer')

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

    const output = capturedStdout.join('')

    // Parse JSON to verify it's valid
    const parsed = JSON.parse(output)

    expect(parsed.status).toBe('error')
    expect(parsed.error).toBeDefined()
    expect(typeof parsed.error).toBe('string')
  })

  test('should sort comments by date in ascending order in XML output', async () => {
    setupMockHandlers()

    const mockConfigLayer = createMockConfigLayer()
    const program = showCommand('12345', { xml: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = capturedStdout.join('')

    // Extract comment sections to verify order
    const commentMatches = output.matchAll(
      /<comment>[\s\S]*?<updated>(.*?)<\/updated>[\s\S]*?<message><!\[CDATA\[(.*?)\]\]><\/message>[\s\S]*?<\/comment>/g,
    )
    const comments = Array.from(commentMatches).map((match) => ({
      updated: match[1],
      message: match[2],
    }))

    // Should have 3 comments
    expect(comments.length).toBe(3)

    // Comments should be in ascending date order (oldest first)
    expect(comments[0].updated).toBe('2024-01-15 11:00:00.000000000')
    expect(comments[0].message).toBe('Clear commit message')

    expect(comments[1].updated).toBe('2024-01-15 11:30:00.000000000')
    expect(comments[1].message).toBe('Good improvement!')

    expect(comments[2].updated).toBe('2024-01-15 11:45:00.000000000')
    expect(comments[2].message).toBe('Consider adding JSDoc')
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

    const output = capturedStdout.join('')
    const parsed = JSON.parse(output)

    expect(parsed.messages).toBeDefined()
    expect(Array.isArray(parsed.messages)).toBe(true)
    expect(parsed.messages.length).toBe(1)
    expect(parsed.messages[0].message).toContain('Build Failed')
    expect(parsed.messages[0].message).toContain('https://jenkins.example.com')
    expect(parsed.messages[0].author.name).toBe('Jenkins Bot')
    expect(parsed.messages[0].revision).toBe(2)
  })

  test('should fetch reviewers from listChanges when getChange lacks reviewer data', async () => {
    let listChangesOptions: string[] = []
    let listChangesQuery = ''

    const changeWithoutReviewers = {
      ...mockChange,
      reviewers: undefined,
    }

    server.use(
      http.get('*/a/changes/:changeId', ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('o') === 'MESSAGES') {
          return HttpResponse.text(`)]}'\n${JSON.stringify({ messages: [] })}`)
        }
        return HttpResponse.text(`)]}'\n${JSON.stringify(changeWithoutReviewers)}`)
      }),
      http.get('*/a/changes/', ({ request }) => {
        const url = new URL(request.url)
        listChangesOptions = url.searchParams.getAll('o')
        listChangesQuery = url.searchParams.get('q') || ''
        return HttpResponse.text(`)]}'\n${JSON.stringify([mockChange])}`)
      }),
      http.get('*/a/changes/:changeId/revisions/current/patch', () => {
        return HttpResponse.text(btoa(mockDiff))
      }),
      http.get('*/a/changes/:changeId/revisions/current/comments', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockComments)}`)
      }),
    )

    const mockConfigLayer = createMockConfigLayer()
    const program = showCommand('12345', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    expect(listChangesQuery).toBe('change:I123abc456def')
    expect(listChangesOptions).toContain('LABELS')
    expect(listChangesOptions).toContain('DETAILED_LABELS')
    expect(listChangesOptions).toContain('DETAILED_ACCOUNTS')
  })

  test('should handle large JSON output without truncation', async () => {
    // Create a large diff to simulate output > 64KB
    const largeDiff = '--- a/large-file.js\n+++ b/large-file.js\n' + 'x'.repeat(100000)

    const mockChange = generateMockChange({
      _number: 12345,
      subject: 'Large change with extensive diff',
    })

    // Create many comments to increase JSON size
    const manyComments: Record<string, any[]> = {
      'src/file.js': Array.from({ length: 100 }, (_, i) => ({
        id: `comment${i}`,
        path: 'src/file.js',
        line: i + 1,
        message: `Comment ${i}: ${'a'.repeat(500)}`, // Make comments substantial
        author: {
          name: 'Reviewer',
          email: 'reviewer@example.com',
        },
        updated: '2024-01-15 11:30:00.000000000',
        unresolved: false,
      })),
    }

    server.use(
      http.get('*/a/changes/:changeId', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockChange)}`)
      }),
      http.get('*/a/changes/:changeId/revisions/current/patch', () => {
        return HttpResponse.text(btoa(largeDiff))
      }),
      http.get('*/a/changes/:changeId/revisions/current/comments', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(manyComments)}`)
      }),
      http.get('*/a/changes/:changeId/revisions/current/files/:fileName/diff', () => {
        return HttpResponse.text('context')
      }),
    )

    const mockConfigLayer = createMockConfigLayer()
    const program = showCommand('12345', { json: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = capturedStdout.join('')

    // Verify output is larger than 64KB (the previous truncation point)
    expect(output.length).toBeGreaterThan(65536)

    // Verify JSON is valid and complete
    const parsed = JSON.parse(output)
    expect(parsed.status).toBe('success')
    expect(parsed.diff).toContain('x'.repeat(100000))
    expect(parsed.comments.length).toBe(100)

    // Verify last comment is present (proves no truncation)
    const lastComment = parsed.comments[parsed.comments.length - 1]
    expect(lastComment.message).toContain('Comment 99')
  })

  test('should handle stdout drain event when buffer is full', async () => {
    setupMockHandlers()

    // Store original stdout.write
    const originalStdoutWrite = process.stdout.write

    let drainCallback: (() => void) | null = null
    let errorCallback: ((err: Error) => void) | null = null
    let writeCallbackFn: ((err?: Error) => void) | null = null

    // Mock stdout.write to simulate full buffer
    const mockWrite = mock((chunk: any, callback?: any) => {
      capturedStdout.push(String(chunk))
      writeCallbackFn = callback
      // Return false to simulate full buffer
      return false
    })

    // Mock stdout.once to capture drain and error listeners
    const mockOnce = mock((event: string, callback: any) => {
      if (event === 'drain') {
        drainCallback = callback
        // Simulate drain event after a short delay
        setTimeout(() => {
          if (drainCallback) {
            drainCallback()
            if (writeCallbackFn) {
              writeCallbackFn()
            }
          }
        }, 10)
      } else if (event === 'error') {
        errorCallback = callback
      }
      return process.stdout
    })

    // Apply mocks
    // @ts-ignore
    process.stdout.write = mockWrite
    // @ts-ignore
    process.stdout.once = mockOnce

    const mockConfigLayer = createMockConfigLayer()
    const program = showCommand('12345', { json: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    // Restore original stdout.write
    // @ts-ignore
    process.stdout.write = originalStdoutWrite

    // Verify that write returned false (buffer full)
    expect(mockWrite).toHaveBeenCalled()

    // Verify that drain listener was registered
    expect(mockOnce).toHaveBeenCalledWith('drain', expect.any(Function))

    // Verify that error listener was registered for robustness
    expect(mockOnce).toHaveBeenCalledWith('error', expect.any(Function))

    // Verify output is still valid JSON despite drain handling
    const output = capturedStdout.join('')
    const parsed = JSON.parse(output)
    expect(parsed.status).toBe('success')
    expect(parsed.change.id).toBe('I123abc456def')
  })

  test('should handle large XML output without truncation', async () => {
    // Create a large diff to simulate output > 64KB
    const largeDiff = '--- a/large-file.js\n+++ b/large-file.js\n' + 'x'.repeat(100000)

    const mockChange = generateMockChange({
      _number: 12345,
      subject: 'Large change with extensive diff',
    })

    // Create many comments to increase XML size
    const manyComments: Record<string, any[]> = {
      'src/file.js': Array.from({ length: 100 }, (_, i) => ({
        id: `comment${i}`,
        path: 'src/file.js',
        line: i + 1,
        message: `Comment ${i}: ${'a'.repeat(500)}`,
        author: {
          name: 'Reviewer',
          email: 'reviewer@example.com',
        },
        updated: '2024-01-15 11:30:00.000000000',
        unresolved: false,
      })),
    }

    server.use(
      http.get('*/a/changes/:changeId', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockChange)}`)
      }),
      http.get('*/a/changes/:changeId/revisions/current/patch', () => {
        return HttpResponse.text(btoa(largeDiff))
      }),
      http.get('*/a/changes/:changeId/revisions/current/comments', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(manyComments)}`)
      }),
      http.get('*/a/changes/:changeId/revisions/current/files/:fileName/diff', () => {
        return HttpResponse.text('context')
      }),
    )

    const mockConfigLayer = createMockConfigLayer()
    const program = showCommand('12345', { xml: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = capturedStdout.join('')

    // Verify output is larger than 64KB
    expect(output.length).toBeGreaterThan(65536)

    // Verify XML is valid and complete
    expect(output).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(output).toContain('<show_result>')
    expect(output).toContain('<status>success</status>')
    expect(output).toContain('x'.repeat(100000))
    expect(output).toContain('<count>100</count>')
    expect(output).toContain('</show_result>')

    // Verify last comment is present (proves no truncation)
    expect(output).toContain('Comment 99')
  })
})
