import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Effect, Layer } from 'effect'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { GerritApiServiceLive } from '@/api/gerrit'
import { commentCommand } from '@/cli/commands/comment'
import { ConfigService } from '@/services/config'

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

describe('comment command', () => {
  let mockConsoleLog: ReturnType<typeof mock>
  let mockConsoleError: ReturnType<typeof mock>
  let mockProcessStdin: {
    on: ReturnType<typeof mock>
    emit: (data: string) => void
    dataCallback?: (...args: unknown[]) => void
    endCallback?: (...args: unknown[]) => void
  }

  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'bypass' })
  })

  afterAll(() => {
    server.close()
  })

  beforeEach(() => {
    server.resetHandlers()

    mockConsoleLog = mock(() => {})
    mockConsoleError = mock(() => {})
    console.log = mockConsoleLog
    console.error = mockConsoleError

    // Mock process.stdin for batch tests
    mockProcessStdin = {
      on: mock((event: string, callback: (...args: unknown[]) => void) => {
        if (event === 'data') {
          mockProcessStdin.dataCallback = callback
        } else if (event === 'end') {
          mockProcessStdin.endCallback = callback
        }
      }),
      emit: (data: string) => {
        if (mockProcessStdin.dataCallback) {
          mockProcessStdin.dataCallback(data)
        }
        if (mockProcessStdin.endCallback) {
          mockProcessStdin.endCallback()
        }
      },
    }
  })

  afterEach(() => {
    server.resetHandlers()
  })

  it('should post an overall comment', async () => {
    server.use(
      http.get('*/a/changes/:changeId', () => {
        return HttpResponse.text(`)]}'\n{
          "id": "test-project~main~I123abc",
          "_number": 12345,
          "project": "test-project",
          "branch": "main",
          "change_id": "I123abc",
          "subject": "Test change",
          "status": "NEW",
          "created": "2024-01-15 10:00:00.000000000",
          "updated": "2024-01-15 10:00:00.000000000"
        }`)
      }),
      http.post('*/a/changes/:changeId/revisions/current/review', async ({ request }) => {
        const body = (await request.json()) as { message?: string; comments?: unknown }
        expect(body.message).toBe('This is a test comment')
        expect(body.comments).toBeUndefined()
        return HttpResponse.json({})
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())

    const program = commentCommand('12345', {
      message: 'This is a test comment',
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('✓ Comment posted successfully!')
    expect(output).toContain('Test change')
  })

  it('should post a line-specific comment', async () => {
    server.use(
      http.get('*/a/changes/:changeId', () => {
        return HttpResponse.text(`)]}'\n{
          "id": "test-project~main~I123abc",
          "_number": 12345,
          "project": "test-project",
          "branch": "main",
          "change_id": "I123abc",
          "subject": "Test change",
          "status": "NEW",
          "created": "2024-01-15 10:00:00.000000000",
          "updated": "2024-01-15 10:00:00.000000000"
        }`)
      }),
      http.post('*/a/changes/:changeId/revisions/current/review', async ({ request }) => {
        const body = (await request.json()) as {
          message?: string
          comments?: Record<string, Array<{ line: number; message: string; unresolved?: boolean }>>
        }
        expect(body.message).toBeUndefined()
        expect(body.comments).toBeDefined()
        expect(body.comments?.['src/main.js']).toBeDefined()
        expect(body.comments?.['src/main.js']?.[0].line).toBe(42)
        expect(body.comments?.['src/main.js']?.[0].message).toBe('Fix this issue')
        expect(body.comments?.['src/main.js']?.[0].unresolved).toBe(true)
        return HttpResponse.json({})
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())

    const program = commentCommand('12345', {
      message: 'Fix this issue',
      file: 'src/main.js',
      line: 42,
      unresolved: true,
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('✓ Comment posted successfully!')
    expect(output).toContain('File: src/main.js, Line: 42')
    expect(output).toContain('Status: Unresolved')
  })

  it('should handle batch comments', async () => {
    // Override process.stdin temporarily
    const originalStdin = process.stdin
    Object.defineProperty(process, 'stdin', {
      value: mockProcessStdin,
      configurable: true,
    })

    server.use(
      http.get('*/a/changes/:changeId', () => {
        return HttpResponse.text(`)]}'\n{
          "id": "test-project~main~I123abc",
          "_number": 12345,
          "project": "test-project",
          "branch": "main",
          "change_id": "I123abc",
          "subject": "Test change",
          "status": "NEW",
          "created": "2024-01-15 10:00:00.000000000",
          "updated": "2024-01-15 10:00:00.000000000"
        }`)
      }),
      http.post('*/a/changes/:changeId/revisions/current/review', async ({ request }) => {
        const body = (await request.json()) as {
          message?: string
          comments?: Record<string, unknown[]>
        }
        // Array format doesn't include overall message
        expect(body.message).toBeUndefined()
        expect(body.comments).toBeDefined()
        expect(body.comments?.['src/main.js']?.length).toBe(2)
        expect(body.comments?.['src/utils.js']?.length).toBe(1)
        return HttpResponse.json({})
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())

    const program = commentCommand('12345', { batch: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    // Simulate stdin data (array format)
    setTimeout(() => {
      mockProcessStdin.emit(
        JSON.stringify([
          { file: 'src/main.js', line: 10, message: 'First comment' },
          { file: 'src/main.js', line: 20, message: 'Second comment', unresolved: true },
          { file: 'src/utils.js', line: 5, message: 'Utils comment' },
        ]),
      )
    }, 10)

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('✓ Comment posted successfully!')
    expect(output).toContain('Posted 3 line comment(s)')

    // Restore process.stdin
    Object.defineProperty(process, 'stdin', {
      value: originalStdin,
      configurable: true,
    })
  })

  it('should output XML format for line comments', async () => {
    server.use(
      http.get('*/a/changes/:changeId', () => {
        return HttpResponse.text(`)]}'\n{
          "id": "test-project~main~I123abc",
          "_number": 12345,
          "project": "test-project",
          "branch": "main",
          "change_id": "I123abc",
          "subject": "Test change",
          "status": "NEW",
          "created": "2024-01-15 10:00:00.000000000",
          "updated": "2024-01-15 10:00:00.000000000"
        }`)
      }),
      http.post('*/a/changes/:changeId/revisions/current/review', async () => {
        return HttpResponse.json({})
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())

    const program = commentCommand('12345', {
      message: 'Fix this',
      file: 'test.js',
      line: 10,
      xml: true,
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(output).toContain('<comment_result>')
    expect(output).toContain('<status>success</status>')
    expect(output).toContain('<file>test.js</file>')
    expect(output).toContain('<line>10</line>')
    expect(output).toContain('<message><![CDATA[Fix this]]></message>')
  })

  it('should provide detailed error for invalid JSON with input preview', async () => {
    const originalStdin = process.stdin
    Object.defineProperty(process, 'stdin', {
      value: mockProcessStdin,
      configurable: true,
    })

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())

    const program = commentCommand('12345', { batch: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    const malformedJson = `[
      {
        "file": "src/main.js",
        "line": 10,
        "message": "This is an unterminated string
      }
    ]`

    // Simulate invalid JSON input
    setTimeout(() => {
      mockProcessStdin.emit(malformedJson)
    }, 10)

    await expect(Effect.runPromise(program)).rejects.toThrow(
      /Invalid JSON input: .*Unterminated string.*\nInput \(\d+ chars, \d+ lines\):\n.*src\/main\.js.*\nExpected format:/s,
    )

    // Restore process.stdin
    Object.defineProperty(process, 'stdin', {
      value: originalStdin,
      configurable: true,
    })
  })

  it('should reject invalid batch JSON', async () => {
    const originalStdin = process.stdin
    Object.defineProperty(process, 'stdin', {
      value: mockProcessStdin,
      configurable: true,
    })

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())

    const program = commentCommand('12345', { batch: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    // Simulate invalid JSON
    setTimeout(() => {
      mockProcessStdin.emit('not valid json')
    }, 10)

    await expect(Effect.runPromise(program)).rejects.toThrow('Invalid batch input format')

    // Restore process.stdin
    Object.defineProperty(process, 'stdin', {
      value: originalStdin,
      configurable: true,
    })
  })

  it('should reject invalid batch schema', async () => {
    const originalStdin = process.stdin
    Object.defineProperty(process, 'stdin', {
      value: mockProcessStdin,
      configurable: true,
    })

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())

    const program = commentCommand('12345', { batch: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    // Simulate invalid schema (array format)
    setTimeout(() => {
      mockProcessStdin.emit(
        JSON.stringify([
          { message: 'Missing file path' }, // Invalid: missing file
        ]),
      )
    }, 10)

    await expect(Effect.runPromise(program)).rejects.toThrow('Invalid batch input format')

    // Restore process.stdin
    Object.defineProperty(process, 'stdin', {
      value: originalStdin,
      configurable: true,
    })
  })

  it('should require message for line comments', async () => {
    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())

    const program = commentCommand('12345', {
      file: 'test.js',
      line: 10,
      // Missing message
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await expect(Effect.runPromise(program)).rejects.toThrow(
      'Message is required for line comments',
    )
  })

  it('should require message for overall comments when stdin is empty', async () => {
    const originalStdin = process.stdin
    Object.defineProperty(process, 'stdin', {
      value: mockProcessStdin,
      configurable: true,
    })

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())

    const program = commentCommand('12345', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    // Simulate empty stdin
    setTimeout(() => {
      mockProcessStdin.emit('')
    }, 10)

    await expect(Effect.runPromise(program)).rejects.toThrow(
      'Message is required. Use -m "your message" or pipe content to stdin',
    )

    // Restore process.stdin
    Object.defineProperty(process, 'stdin', {
      value: originalStdin,
      configurable: true,
    })
  })

  it('should handle API errors gracefully', async () => {
    server.use(
      http.get('*/a/changes/:changeId', () => {
        return HttpResponse.text('Not found', { status: 404 })
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())

    const program = commentCommand('12345', {
      message: 'Test comment',
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await expect(Effect.runPromise(program)).rejects.toThrow('Failed to get change')
  })

  it('should handle post review API errors', async () => {
    server.use(
      http.get('*/a/changes/:changeId', () => {
        return HttpResponse.text(`)]}'\n{
          "id": "test-project~main~I123abc",
          "_number": 12345,
          "project": "test-project",
          "branch": "main",
          "change_id": "I123abc",
          "subject": "Test change",
          "status": "NEW",
          "created": "2024-01-15 10:00:00.000000000",
          "updated": "2024-01-15 10:00:00.000000000"
        }`)
      }),
      http.post('*/a/changes/:changeId/revisions/current/review', () => {
        return HttpResponse.text('Forbidden', { status: 403 })
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())

    const program = commentCommand('12345', {
      message: 'Test comment',
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await expect(Effect.runPromise(program)).rejects.toThrow('Failed to post comment')
  })

  it('should output XML for batch comments', async () => {
    const originalStdin = process.stdin
    Object.defineProperty(process, 'stdin', {
      value: mockProcessStdin,
      configurable: true,
    })

    server.use(
      http.get('*/a/changes/:changeId', () => {
        return HttpResponse.text(`)]}'\n{
          "id": "test-project~main~I123abc",
          "_number": 12345,
          "project": "test-project",
          "branch": "main",
          "change_id": "I123abc",
          "subject": "Test change",
          "status": "NEW",
          "created": "2024-01-15 10:00:00.000000000",
          "updated": "2024-01-15 10:00:00.000000000"
        }`)
      }),
      http.post('*/a/changes/:changeId/revisions/current/review', async () => {
        return HttpResponse.json({})
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())

    const program = commentCommand('12345', { batch: true, xml: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    // Simulate stdin data (array format)
    setTimeout(() => {
      mockProcessStdin.emit(
        JSON.stringify([
          { file: 'src/main.js', line: 10, message: 'First comment' },
          { file: 'src/main.js', line: 20, message: 'Second comment', unresolved: true },
        ]),
      )
    }, 10)

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(output).toContain('<comments>')
    expect(output).toContain('<file>src/main.js</file>')
    expect(output).toContain('<line>10</line>')
    expect(output).toContain('<line>20</line>')
    expect(output).toContain('<unresolved>true</unresolved>')
    expect(output).toContain('</comments>')

    // Restore process.stdin
    Object.defineProperty(process, 'stdin', {
      value: originalStdin,
      configurable: true,
    })
  })

  it('should accept piped input for overall comments', async () => {
    const originalStdin = process.stdin
    Object.defineProperty(process, 'stdin', {
      value: mockProcessStdin,
      configurable: true,
    })

    server.use(
      http.get('*/a/changes/:changeId', () => {
        return HttpResponse.text(`)]}'\n{
          "id": "test-project~main~I123abc",
          "_number": 12345,
          "project": "test-project",
          "branch": "main",
          "change_id": "I123abc",
          "subject": "Test change",
          "status": "NEW",
          "created": "2024-01-15 10:00:00.000000000",
          "updated": "2024-01-15 10:00:00.000000000"
        }`)
      }),
      http.post('*/a/changes/:changeId/revisions/current/review', async ({ request }) => {
        const body = (await request.json()) as { message?: string }
        expect(body.message).toBe('Piped comment message')
        return HttpResponse.json({})
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())

    // Test comment without message option (should read from stdin)
    const program = commentCommand('12345', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    // Simulate piped input
    setTimeout(() => {
      mockProcessStdin.emit('Piped comment message')
    }, 10)

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('✓ Comment posted successfully!')
    // Note: The message content is no longer displayed after successful posting
    // to avoid duplication with the review preview section

    // Restore process.stdin
    Object.defineProperty(process, 'stdin', {
      value: originalStdin,
      configurable: true,
    })
  })

  it('should trim whitespace from piped input', async () => {
    const originalStdin = process.stdin
    Object.defineProperty(process, 'stdin', {
      value: mockProcessStdin,
      configurable: true,
    })

    server.use(
      http.get('*/a/changes/:changeId', () => {
        return HttpResponse.text(`)]}'\n{
          "id": "test-project~main~I123abc",
          "_number": 12345,
          "project": "test-project",
          "branch": "main",
          "change_id": "I123abc",
          "subject": "Test change",
          "status": "NEW",
          "created": "2024-01-15 10:00:00.000000000",
          "updated": "2024-01-15 10:00:00.000000000"
        }`)
      }),
      http.post('*/a/changes/:changeId/revisions/current/review', async ({ request }) => {
        const body = (await request.json()) as { message?: string }
        expect(body.message).toBe('Trimmed message')
        return HttpResponse.json({})
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())

    const program = commentCommand('12345', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    // Simulate piped input with whitespace
    setTimeout(() => {
      mockProcessStdin.emit('  \n  Trimmed message  \n  ')
    }, 10)

    await Effect.runPromise(program)

    // Restore process.stdin
    Object.defineProperty(process, 'stdin', {
      value: originalStdin,
      configurable: true,
    })
  })

  it('should provide detailed error context for batch comment failures', async () => {
    const originalStdin = process.stdin
    Object.defineProperty(process, 'stdin', {
      value: mockProcessStdin,
      configurable: true,
    })

    server.use(
      http.get('*/a/changes/:changeId', () => {
        return HttpResponse.text(`)]}'\n{
          "id": "test-project~main~I123abc",
          "_number": 12345,
          "project": "test-project",
          "branch": "main",
          "change_id": "I123abc",
          "subject": "Test change",
          "status": "NEW"
        }`)
      }),
      http.post('*/a/changes/:changeId/revisions/current/review', () => {
        return HttpResponse.text(
          'file app/models/auto_grade_result.rb not found in revision 386823,6',
          { status: 400 },
        )
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())

    const program = commentCommand('12345', { batch: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    // Simulate batch input
    setTimeout(() => {
      mockProcessStdin.emit(
        JSON.stringify([
          { file: 'app/models/auto_grade_result.rb', line: 23, message: 'This needs improvement' },
          {
            file: 'src/utils.js',
            line: 45,
            message:
              'This is a very long comment message that should be truncated in the error output to keep it readable',
          },
        ]),
      )
    }, 10)

    await expect(Effect.runPromise(program)).rejects.toThrow(
      /Failed to post comment: file app\/models\/auto_grade_result\.rb not found in revision 386823,6\nTried to post: app\/models\/auto_grade_result\.rb:23 "This needs improvement", src\/utils\.js:45 "This is a very long comment message that should be\.\.\."/,
    )

    // Restore process.stdin
    Object.defineProperty(process, 'stdin', {
      value: originalStdin,
      configurable: true,
    })
  })

  it('should provide detailed error context for line comment failures', async () => {
    server.use(
      http.get('*/a/changes/:changeId', () => {
        return HttpResponse.text(`)]}'\n{
          "id": "test-project~main~I123abc",
          "_number": 12345,
          "project": "test-project",
          "branch": "main",
          "change_id": "I123abc",
          "subject": "Test change",
          "status": "NEW"
        }`)
      }),
      http.post('*/a/changes/:changeId/revisions/current/review', () => {
        return HttpResponse.text('file not found', { status: 400 })
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())

    const program = commentCommand('12345', {
      file: 'missing-file.rb',
      line: 42,
      message: 'Test comment on missing file',
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await expect(Effect.runPromise(program)).rejects.toThrow(
      'Failed to post comment: file not found\nTried to post to missing-file.rb:42: "Test comment on missing file"',
    )
  })
})
