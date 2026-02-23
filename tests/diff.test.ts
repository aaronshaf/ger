import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Effect, Layer } from 'effect'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { GerritApiServiceLive } from '@/api/gerrit'
import { diffCommand } from '@/cli/commands/diff'
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

describe('diff command', () => {
  let mockConsoleLog: ReturnType<typeof mock>
  let mockConsoleError: ReturnType<typeof mock>

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
  })

  afterEach(() => {
    server.resetHandlers()
  })

  const createMockConfigLayer = () => Layer.succeed(ConfigService, createMockConfigService())

  describe('unified diff output', () => {
    it('should fetch and display unified diff by default', async () => {
      const mockDiff = `ZGlmZiAtLWdpdCBhL3NyYy9tYWluLmpzIGIvc3JjL21haW4uanMKaW5kZXggMTIzNDU2Ny4uYWJjZGVmZyAxMDA2NDQKLS0tIGEvc3JjL21haW4uanMKKysrIGIvc3JjL21haW4uanMKQEAgLTEwLDYgKzEwLDcgQEAgZXhwb3J0IGZ1bmN0aW9uIG1haW4oKSB7CiAgIGNvbnNvbGUubG9nKCdTdGFydGluZyBhcHBsaWNhdGlvbicpCisgIGNvbnNvbGUubG9nKCdEZWJ1ZyBpbmZvJykKICAgcmV0dXJuICdzdWNjZXNzJwogfQ==`

      server.use(
        http.get('*/a/changes/:changeId/revisions/current/patch', () => {
          return HttpResponse.text(mockDiff)
        }),
      )

      const program = diffCommand('12345', {}).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(createMockConfigLayer()),
      )

      await Effect.runPromise(program)

      const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
      expect(output).toContain('diff --git a/src/main.js b/src/main.js')
      expect(output).toContain("+  console.log('Debug info')")
    })

    it('should fetch diff for specific file', async () => {
      const mockDiff = {
        meta_a: {
          name: 'src/utils.js',
          content_type: 'text/plain',
        },
        meta_b: {
          name: 'src/utils.js',
          content_type: 'text/plain',
        },
        content: [
          {
            ab: ['export function helper() {', '  return true'],
          },
          {
            b: ['  // Added comment'],
          },
          {
            ab: ['}'],
          },
        ],
      }

      server.use(
        http.get('*/a/changes/:changeId/revisions/current/files/*/diff', () => {
          return HttpResponse.text(`)]}'\n${JSON.stringify(mockDiff)}`)
        }),
      )

      const program = diffCommand('12345', { file: 'src/utils.js' }).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(createMockConfigLayer()),
      )

      await Effect.runPromise(program)

      const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
      expect(output).toContain('--- a/src/utils.js')
      expect(output).toContain('+++ b/src/utils.js')
      expect(output).toContain('+  // Added comment')
    })

    it('should use specified format', async () => {
      const mockFiles = {
        '/COMMIT_MSG': { status: 'A' },
        'src/main.js': { status: 'M' },
        'src/utils.js': { status: 'A' },
      }

      server.use(
        http.get('*/a/changes/:changeId/revisions/current/files', () => {
          return HttpResponse.text(`)]}'\n${JSON.stringify(mockFiles)}`)
        }),
      )

      const program = diffCommand('12345', { format: 'json' }).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(createMockConfigLayer()),
      )

      await Effect.runPromise(program)

      const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
      expect(output).toContain('"src/main.js"')
      expect(output).toContain('"status": "M"')
    })
  })

  describe('files-only output', () => {
    it('should fetch and display files list when filesOnly is true', async () => {
      const mockFiles = {
        '/COMMIT_MSG': { status: 'A' },
        'src/main.js': { status: 'M' },
        'src/utils.js': { status: 'A' },
        'README.md': { status: 'M' },
      }

      server.use(
        http.get('*/a/changes/:changeId/revisions/current/files', () => {
          return HttpResponse.text(`)]}'\n${JSON.stringify(mockFiles)}`)
        }),
      )

      const program = diffCommand('12345', { filesOnly: true }).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(createMockConfigLayer()),
      )

      await Effect.runPromise(program)

      const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
      expect(output).toContain('Changed files')
      expect(output).toContain('src/main.js')
      expect(output).toContain('src/utils.js')
      expect(output).toContain('README.md')
    })
  })

  describe('XML output', () => {
    it('should output XML format for unified diff', async () => {
      const mockDiff = `Y29uc29sZS5sb2coJ3Rlc3QnKQorY29uc29sZS5sb2coJ25ldyBsaW5lJyk=`

      server.use(
        http.get('*/a/changes/:changeId/revisions/current/patch', () => {
          return HttpResponse.text(mockDiff)
        }),
      )

      const program = diffCommand('12345', { xml: true }).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(createMockConfigLayer()),
      )

      await Effect.runPromise(program)

      const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
      expect(output).toContain('<?xml version="1.0" encoding="UTF-8"?>')
      expect(output).toContain('<diff_result>')
      expect(output).toContain('<status>success</status>')
      expect(output).toContain('<change_id>12345</change_id>')
      expect(output).toContain('<content><![CDATA[')
      expect(output).toContain('console.log')
      expect(output).toContain(']]></content>')
      expect(output).toContain('</diff_result>')
    })

    it('should output XML format for files list', async () => {
      const mockFiles = {
        '/COMMIT_MSG': { status: 'A' },
        'src/main.js': { status: 'M' },
        'test.js': { status: 'A' },
      }

      server.use(
        http.get('*/a/changes/:changeId/revisions/current/files', () => {
          return HttpResponse.text(`)]}'\n${JSON.stringify(mockFiles)}`)
        }),
      )

      const program = diffCommand('12345', { xml: true, filesOnly: true }).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(createMockConfigLayer()),
      )

      await Effect.runPromise(program)

      const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
      expect(output).toContain('<?xml version="1.0" encoding="UTF-8"?>')
      expect(output).toContain('<diff_result>')
      expect(output).toContain('<files>')
      expect(output).toContain('<file>src/main.js</file>')
      expect(output).toContain('<file>test.js</file>')
      expect(output).toContain('</files>')
      expect(output).toContain('</diff_result>')
    })

    it('should output XML format for JSON data', async () => {
      const mockData = {
        '/COMMIT_MSG': { status: 'A' },
        'src/main.js': { status: 'M' },
        'test.js': { status: 'A' },
      }

      server.use(
        http.get('*/a/changes/:changeId/revisions/current/files', () => {
          return HttpResponse.text(`)]}'\n${JSON.stringify(mockData)}`)
        }),
      )

      const program = diffCommand('12345', { xml: true, format: 'json' }).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(createMockConfigLayer()),
      )

      await Effect.runPromise(program)

      const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
      expect(output).toContain('<content><![CDATA[')
      expect(output).toContain('"src/main.js"')
      expect(output).toContain('"status": "M"')
      expect(output).toContain(']]></content>')
    })
  })

  describe('error handling', () => {
    it('should handle 404 change not found', async () => {
      server.use(
        http.get('*/a/changes/:changeId/revisions/current/patch', () => {
          return HttpResponse.text('Change not found', { status: 404 })
        }),
      )

      const program = diffCommand('12345', {}).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(createMockConfigLayer()),
      )

      await expect(Effect.runPromise(program)).rejects.toThrow('Failed to get diff')
    })

    it('should handle 403 access denied', async () => {
      server.use(
        http.get('*/a/changes/:changeId/revisions/current/patch', () => {
          return HttpResponse.text('Access denied', { status: 403 })
        }),
      )

      const program = diffCommand('12345', {}).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(createMockConfigLayer()),
      )

      await expect(Effect.runPromise(program)).rejects.toThrow('Failed to get diff')
    })

    it('should handle network errors', async () => {
      server.use(
        http.get('*/a/changes/:changeId/revisions/current/patch', () => {
          return HttpResponse.error()
        }),
      )

      const program = diffCommand('12345', {}).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(createMockConfigLayer()),
      )

      await expect(Effect.runPromise(program)).rejects.toThrow('Failed to get diff')
    })

    it('should handle invalid options schema', async () => {
      const program = diffCommand('12345', { format: 'invalid' } as never).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(createMockConfigLayer()),
      )

      await expect(Effect.runPromise(program)).rejects.toThrow('Invalid diff command options')
    })
  })

  describe('output formatting', () => {
    it('should apply pretty formatting to unified diff by default', async () => {
      const mockDiff = `ZGlmZiAtLWdpdCBhL3NyYy9tYWluLmpzIGIvc3JjL21haW4uanMKaW5kZXggMTIzNDU2Ny4uYWJjZGVmZyAxMDA2NDQKLS0tIGEvc3JjL21haW4uanMKKysrIGIvc3JjL21haW4uanMKQEAgLTEwLDYgKzEwLDcgQEAgZXhwb3J0IGZ1bmN0aW9uIG1haW4oKSB7CiAgIGNvbnNvbGUubG9nKCdTdGFydGluZyBhcHBsaWNhdGlvbicpCisgIGNvbnNvbGUubG9nKCdEZWJ1ZyBpbmZvJykKICAgcmV0dXJuICdzdWNjZXNzJwogfQ==`

      server.use(
        http.get('*/a/changes/:changeId/revisions/current/patch', () => {
          return HttpResponse.text(mockDiff)
        }),
      )

      const program = diffCommand('12345', {}).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(createMockConfigLayer()),
      )

      await Effect.runPromise(program)

      const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')

      // Check that pretty formatting is applied (colors would be removed in test output,
      // but structure should be preserved)
      expect(output).toContain('diff --git')
      expect(output).toContain('index 1234567..abcdefg')
      expect(output).toContain('--- a/src/main.js')
      expect(output).toContain('+++ b/src/main.js')
    })

    it('should format files list prettily', async () => {
      const mockFiles = {
        '/COMMIT_MSG': { status: 'A' },
        'src/main.js': { status: 'M' },
        'src/utils.js': { status: 'A' },
        'test/test.js': { status: 'M' },
        'README.md': { status: 'M' },
      }

      server.use(
        http.get('*/a/changes/:changeId/revisions/current/files', () => {
          return HttpResponse.text(`)]}'\n${JSON.stringify(mockFiles)}`)
        }),
      )

      const program = diffCommand('12345', { filesOnly: true }).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(createMockConfigLayer()),
      )

      await Effect.runPromise(program)

      const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
      expect(output).toContain('Changed files')
      expect(output).toContain('src/main.js')
      expect(output).toContain('src/utils.js')
      expect(output).toContain('test/test.js')
      expect(output).toContain('README.md')
    })
  })

  describe('option validation', () => {
    beforeEach(() => {
      // Default mock handlers for validation tests
      server.use(
        http.get('*/a/changes/:changeId/revisions/current/patch', () => {
          return HttpResponse.text('bW9jayBkaWZmIGNvbnRlbnQ=') // base64 for "mock diff content"
        }),
        http.get('*/a/changes/:changeId/revisions/current/files', () => {
          return HttpResponse.text(`)]}'\n{"src/test.js": {"status": "M"}}`)
        }),
        http.get('*/a/changes/:changeId/revisions/current/files/*/diff', () => {
          return HttpResponse.text(`)]}'\n{"content": [{"ab": ["test content"]}]}`)
        }),
      )
    })

    it('should accept valid format values', async () => {
      // Test each valid format
      for (const format of ['unified', 'json', 'files'] as const) {
        const program = diffCommand('12345', { format }).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(createMockConfigLayer()),
        )

        await expect(Effect.runPromise(program)).resolves.toBeUndefined()
      }
    })

    it('should accept optional parameters', async () => {
      const program = diffCommand('12345', {
        xml: true,
        file: 'src/test.js',
        filesOnly: false,
        format: 'unified',
      }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(createMockConfigLayer()))

      await expect(Effect.runPromise(program)).resolves.toBeUndefined()
    })

    it('should work with minimal options', async () => {
      const program = diffCommand('12345', {}).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(createMockConfigLayer()),
      )

      await expect(Effect.runPromise(program)).resolves.toBeUndefined()
    })
  })
})
