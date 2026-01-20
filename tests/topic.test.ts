import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Effect, Layer } from 'effect'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { GerritApiServiceLive } from '@/api/gerrit'
import { topicCommand } from '@/cli/commands/topic'
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

describe('topic command', () => {
  let mockConsoleLog: ReturnType<typeof mock>
  let mockConsoleError: ReturnType<typeof mock>

  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'bypass' })
  })

  afterAll(() => {
    server.close()
  })

  beforeEach(() => {
    mockConsoleLog = mock(() => {})
    mockConsoleError = mock(() => {})
    console.log = mockConsoleLog
    console.error = mockConsoleError
  })

  afterEach(() => {
    server.resetHandlers()
  })

  describe('get topic', () => {
    it('should get topic when one is set', async () => {
      server.use(
        http.get('*/a/changes/12345/topic', () => {
          return HttpResponse.text(`)]}'\n"my-feature"`)
        }),
      )

      const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
      const program = topicCommand('12345', undefined, {}).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(mockConfigLayer),
      )

      await Effect.runPromise(program)

      const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
      expect(output).toBe('my-feature')
    })

    it('should show message when no topic is set', async () => {
      server.use(
        http.get('*/a/changes/12345/topic', () => {
          return HttpResponse.text(`)]}'\n""`)
        }),
      )

      const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
      const program = topicCommand('12345', undefined, {}).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(mockConfigLayer),
      )

      await Effect.runPromise(program)

      const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
      expect(output).toContain('No topic set')
    })

    it('should output XML format for get topic', async () => {
      server.use(
        http.get('*/a/changes/12345/topic', () => {
          return HttpResponse.text(`)]}'\n"my-feature"`)
        }),
      )

      const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
      const program = topicCommand('12345', undefined, { xml: true }).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(mockConfigLayer),
      )

      await Effect.runPromise(program)

      const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
      expect(output).toContain('<?xml version="1.0" encoding="UTF-8"?>')
      expect(output).toContain('<topic_result>')
      expect(output).toContain('<status>success</status>')
      expect(output).toContain('<action>get</action>')
      expect(output).toContain('<change_id><![CDATA[12345]]></change_id>')
      expect(output).toContain('<topic><![CDATA[my-feature]]></topic>')
      expect(output).toContain('</topic_result>')
    })

    it('should output XML format when no topic is set', async () => {
      server.use(
        http.get('*/a/changes/12345/topic', () => {
          return HttpResponse.text(`)]}'\n""`)
        }),
      )

      const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
      const program = topicCommand('12345', undefined, { xml: true }).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(mockConfigLayer),
      )

      await Effect.runPromise(program)

      const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
      expect(output).toContain('<topic />')
    })
  })

  describe('set topic', () => {
    it('should set topic on a change', async () => {
      server.use(
        http.put('*/a/changes/12345/topic', async ({ request }) => {
          const body = await request.json()
          expect(body).toEqual({ topic: 'my-feature' })
          return HttpResponse.text(`)]}'\n"my-feature"`)
        }),
      )

      const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
      const program = topicCommand('12345', 'my-feature', {}).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(mockConfigLayer),
      )

      await Effect.runPromise(program)

      const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
      expect(output).toContain('Set topic on change 12345: my-feature')
    })

    it('should output XML format for set topic', async () => {
      server.use(
        http.put('*/a/changes/12345/topic', () => {
          return HttpResponse.text(`)]}'\n"release-v2"`)
        }),
      )

      const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
      const program = topicCommand('12345', 'release-v2', { xml: true }).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(mockConfigLayer),
      )

      await Effect.runPromise(program)

      const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
      expect(output).toContain('<?xml version="1.0" encoding="UTF-8"?>')
      expect(output).toContain('<topic_result>')
      expect(output).toContain('<status>success</status>')
      expect(output).toContain('<action>set</action>')
      expect(output).toContain('<change_id><![CDATA[12345]]></change_id>')
      expect(output).toContain('<topic><![CDATA[release-v2]]></topic>')
      expect(output).toContain('</topic_result>')
    })

    it('should handle topic with special XML characters', async () => {
      // Use a topic with XML special chars but no quotes to avoid JSON parsing issues
      const specialTopic = '<script>alert(1)</script>'
      server.use(
        http.put('*/a/changes/12345/topic', () => {
          // The server echoes the topic back as a quoted JSON string
          return HttpResponse.text(`)]}'\n"<script>alert(1)</script>"`)
        }),
      )

      const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
      const program = topicCommand('12345', specialTopic, { xml: true }).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(mockConfigLayer),
      )

      await Effect.runPromise(program)

      const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
      // Should be properly wrapped in CDATA
      expect(output).toContain('<topic><![CDATA[')
      expect(output).toContain('<script>alert(1)</script>')
      expect(output).toContain('</topic_result>')
    })

    it('should handle topic containing CDATA end sequence', async () => {
      const cdataEndTopic = 'my-feature]]>injection'
      server.use(
        http.put('*/a/changes/12345/topic', () => {
          // Server returns the topic with the CDATA end sequence
          return HttpResponse.text(`)]}'\n"my-feature]]>injection"`)
        }),
      )

      const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
      const program = topicCommand('12345', cdataEndTopic, { xml: true }).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(mockConfigLayer),
      )

      await Effect.runPromise(program)

      const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
      // The CDATA end sequence should be sanitized by replacing ]]> with ]]&gt;
      expect(output).toContain('<status>success</status>')
      // sanitizeCDATA replaces ]]> with ]]&gt; to prevent CDATA injection
      expect(output).toContain(']]&gt;')
      // The raw ]]> in the topic content should NOT appear (only the escaped version)
      expect(output).not.toContain('my-feature]]>injection')
    })
  })

  describe('delete topic', () => {
    it('should delete topic from a change', async () => {
      server.use(
        http.delete('*/a/changes/12345/topic', () => {
          return new HttpResponse(null, { status: 204 })
        }),
      )

      const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
      const program = topicCommand('12345', undefined, { delete: true }).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(mockConfigLayer),
      )

      await Effect.runPromise(program)

      const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
      expect(output).toContain('Removed topic from change 12345')
    })

    it('should output XML format for delete topic', async () => {
      server.use(
        http.delete('*/a/changes/12345/topic', () => {
          return new HttpResponse(null, { status: 204 })
        }),
      )

      const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
      const program = topicCommand('12345', undefined, { delete: true, xml: true }).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(mockConfigLayer),
      )

      await Effect.runPromise(program)

      const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
      expect(output).toContain('<?xml version="1.0" encoding="UTF-8"?>')
      expect(output).toContain('<topic_result>')
      expect(output).toContain('<status>success</status>')
      expect(output).toContain('<action>deleted</action>')
      expect(output).toContain('<change_id><![CDATA[12345]]></change_id>')
      expect(output).toContain('</topic_result>')
    })

    it('should handle deleting non-existent topic', async () => {
      // Gerrit returns 204 even if there was no topic
      server.use(
        http.delete('*/a/changes/12345/topic', () => {
          return new HttpResponse(null, { status: 204 })
        }),
      )

      const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
      const program = topicCommand('12345', undefined, { delete: true }).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(mockConfigLayer),
      )

      await Effect.runPromise(program)

      const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
      expect(output).toContain('Removed topic from change 12345')
    })

    it('should prioritize --delete over topic argument', async () => {
      // When both --delete and topic are provided, delete should take precedence
      server.use(
        http.delete('*/a/changes/12345/topic', () => {
          return new HttpResponse(null, { status: 204 })
        }),
      )

      const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
      const program = topicCommand('12345', 'ignored-topic', { delete: true }).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(mockConfigLayer),
      )

      await Effect.runPromise(program)

      const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
      expect(output).toContain('Removed topic from change 12345')
    })
  })

  describe('error handling', () => {
    it('should fail when change ID is not provided and not in git repo', async () => {
      const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
      const program = topicCommand(undefined, undefined, {}).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(mockConfigLayer),
      )

      // Should throw because we can't auto-detect from HEAD outside a git repo
      await expect(Effect.runPromise(program)).rejects.toThrow()
    })

    it('should fail when empty string change ID is provided and not in git repo', async () => {
      const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
      const program = topicCommand('', undefined, {}).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(mockConfigLayer),
      )

      // Should throw because empty string triggers auto-detect which fails outside git repo
      await expect(Effect.runPromise(program)).rejects.toThrow()
    })

    it('should fail when whitespace-only change ID is provided and not in git repo', async () => {
      const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
      const program = topicCommand('   ', undefined, {}).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(mockConfigLayer),
      )

      // Should throw because whitespace-only triggers auto-detect which fails outside git repo
      await expect(Effect.runPromise(program)).rejects.toThrow()
    })

    it('should handle 404 not found error', async () => {
      server.use(
        http.get('*/a/changes/99999/topic', () => {
          return HttpResponse.text('Change not found', { status: 404 })
        }),
      )

      const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
      const program = topicCommand('99999', undefined, {}).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(mockConfigLayer),
      )

      await Effect.runPromise(program)

      // 404 for topic endpoint means no topic set, not an error
      const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
      expect(output).toContain('No topic set')
    })

    it('should handle 403 forbidden error for set', async () => {
      server.use(
        http.put('*/a/changes/12345/topic', () => {
          return HttpResponse.text('Forbidden', { status: 403 })
        }),
      )

      const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
      const program = topicCommand('12345', 'my-topic', {}).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(mockConfigLayer),
      )

      // Should throw/fail
      await expect(Effect.runPromise(program)).rejects.toThrow()
    })

    it('should handle 403 forbidden error for delete', async () => {
      server.use(
        http.delete('*/a/changes/12345/topic', () => {
          return HttpResponse.text('Forbidden', { status: 403 })
        }),
      )

      const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
      const program = topicCommand('12345', undefined, { delete: true }).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(mockConfigLayer),
      )

      // Should throw/fail
      await expect(Effect.runPromise(program)).rejects.toThrow()
    })

    it('should handle network errors', async () => {
      server.use(
        http.get('*/a/changes/12345/topic', () => {
          return HttpResponse.error()
        }),
      )

      const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
      const program = topicCommand('12345', undefined, {}).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(mockConfigLayer),
      )

      // Should throw/fail
      await expect(Effect.runPromise(program)).rejects.toThrow()
    })
  })

  describe('Change-ID format support', () => {
    it('should work with Change-ID format', async () => {
      server.use(
        http.get('*/a/changes/If5a3ae8cb5a107e187447802358417f311d0c4b1/topic', () => {
          return HttpResponse.text(`)]}'\n"feature-branch"`)
        }),
      )

      const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
      const program = topicCommand('If5a3ae8cb5a107e187447802358417f311d0c4b1', undefined, {}).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(mockConfigLayer),
      )

      await Effect.runPromise(program)

      const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
      expect(output).toBe('feature-branch')
    })
  })
})
