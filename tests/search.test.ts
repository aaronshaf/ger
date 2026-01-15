import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Effect, Layer } from 'effect'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { GerritApiServiceLive } from '@/api/gerrit'
import { searchCommand } from '@/cli/commands/search'
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

describe('search command', () => {
  let mockConsoleLog: ReturnType<typeof mock>
  let originalConsoleLog: typeof console.log

  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'bypass' })
    originalConsoleLog = console.log
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
    console.log = originalConsoleLog
  })

  it('should use default query "is:open" when no query provided', async () => {
    const mockChanges: ChangeInfo[] = [
      generateMockChange({
        _number: 12345,
        subject: 'Default query change',
        project: 'test-project',
        status: 'NEW',
      }),
    ]

    server.use(
      http.get('*/a/changes/', ({ request }) => {
        const url = new URL(request.url)
        const query = url.searchParams.get('q')
        // Default query with limit
        expect(query).toBe('is:open limit:25')
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockChanges)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    await Effect.runPromise(
      searchCommand(undefined, {}).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(mockConfigLayer),
      ),
    )

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Default query change')
  })

  it('should pass custom query to Gerrit API', async () => {
    const mockChanges: ChangeInfo[] = [
      generateMockChange({
        _number: 12345,
        subject: "John's change",
        project: 'my-project',
        status: 'NEW',
        owner: {
          _account_id: 2000,
          name: 'John Doe',
          email: 'john@example.com',
        },
      }),
    ]

    server.use(
      http.get('*/a/changes/', ({ request }) => {
        const url = new URL(request.url)
        const query = url.searchParams.get('q')
        expect(query).toBe('owner:john@example.com status:open limit:25')
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockChanges)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    await Effect.runPromise(
      searchCommand('owner:john@example.com status:open', {}).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(mockConfigLayer),
      ),
    )

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain("John's change")
    expect(output).toContain('by John Doe')
  })

  it('should respect --limit option', async () => {
    const mockChanges: ChangeInfo[] = [
      generateMockChange({
        _number: 12345,
        subject: 'Limited change',
        project: 'test-project',
        status: 'NEW',
      }),
    ]

    server.use(
      http.get('*/a/changes/', ({ request }) => {
        const url = new URL(request.url)
        const query = url.searchParams.get('q')
        expect(query).toBe('is:open limit:10')
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockChanges)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    await Effect.runPromise(
      searchCommand(undefined, { limit: '10' }).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(mockConfigLayer),
      ),
    )

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Limited change')
  })

  it('should not add limit if query already contains limit', async () => {
    const mockChanges: ChangeInfo[] = [
      generateMockChange({
        _number: 12345,
        subject: 'Custom limit change',
        project: 'test-project',
        status: 'NEW',
      }),
    ]

    server.use(
      http.get('*/a/changes/', ({ request }) => {
        const url = new URL(request.url)
        const query = url.searchParams.get('q')
        // Should not add another limit
        expect(query).toBe('is:open limit:5')
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockChanges)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    await Effect.runPromise(
      searchCommand('is:open limit:5', {}).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(mockConfigLayer),
      ),
    )
  })

  it('should use default limit when --limit is non-numeric', async () => {
    const mockChanges: ChangeInfo[] = [
      generateMockChange({
        _number: 12345,
        subject: 'Invalid limit change',
        project: 'test-project',
        status: 'NEW',
      }),
    ]

    server.use(
      http.get('*/a/changes/', ({ request }) => {
        const url = new URL(request.url)
        const query = url.searchParams.get('q')
        // Should fall back to default limit of 25
        expect(query).toBe('is:open limit:25')
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockChanges)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    await Effect.runPromise(
      searchCommand(undefined, { limit: 'abc' }).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(mockConfigLayer),
      ),
    )
  })

  it('should use default limit when --limit is negative', async () => {
    const mockChanges: ChangeInfo[] = [
      generateMockChange({
        _number: 12345,
        subject: 'Negative limit change',
        project: 'test-project',
        status: 'NEW',
      }),
    ]

    server.use(
      http.get('*/a/changes/', ({ request }) => {
        const url = new URL(request.url)
        const query = url.searchParams.get('q')
        // Should fall back to default limit of 25
        expect(query).toBe('is:open limit:25')
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockChanges)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    await Effect.runPromise(
      searchCommand(undefined, { limit: '-5' }).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(mockConfigLayer),
      ),
    )
  })

  it('should display changes grouped by project', async () => {
    const mockChanges: ChangeInfo[] = [
      generateMockChange({
        _number: 12345,
        subject: 'Change in project A',
        project: 'project-a',
        status: 'NEW',
        owner: { _account_id: 1, name: 'Alice' },
      }),
      generateMockChange({
        _number: 12346,
        subject: 'Change in project B',
        project: 'project-b',
        status: 'NEW',
        owner: { _account_id: 2, name: 'Bob' },
      }),
      generateMockChange({
        _number: 12347,
        subject: 'Another change in project A',
        project: 'project-a',
        status: 'MERGED',
        owner: { _account_id: 3, name: 'Charlie' },
      }),
    ]

    server.use(
      http.get('*/a/changes/', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockChanges)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    await Effect.runPromise(
      searchCommand('is:open', {}).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(mockConfigLayer),
      ),
    )

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')

    // Verify project headers appear
    expect(output).toContain('project-a')
    expect(output).toContain('project-b')

    // Verify changes are shown
    expect(output).toContain('Change in project A')
    expect(output).toContain('Change in project B')
    expect(output).toContain('Another change in project A')

    // Verify owners are shown
    expect(output).toContain('by Alice')
    expect(output).toContain('by Bob')
    expect(output).toContain('by Charlie')

    // Verify alphabetical ordering of projects
    const projectAPos = output.indexOf('project-a')
    const projectBPos = output.indexOf('project-b')
    expect(projectAPos).toBeLessThan(projectBPos)
  })

  it('should output XML format when --xml flag is used', async () => {
    const mockChanges: ChangeInfo[] = [
      generateMockChange({
        _number: 12345,
        subject: 'XML test change',
        project: 'test-project',
        branch: 'main',
        status: 'NEW',
        owner: { _account_id: 1, name: 'Test User', email: 'test@example.com' },
        updated: '2025-01-15 10:30:00.000000000',
      }),
    ]

    server.use(
      http.get('*/a/changes/', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockChanges)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    await Effect.runPromise(
      searchCommand('owner:self', { xml: true }).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(mockConfigLayer),
      ),
    )

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(output).toContain('<search_results>')
    expect(output).toContain('<query><![CDATA[owner:self limit:25]]></query>')
    expect(output).toContain('<count>1</count>')
    expect(output).toContain('<changes>')
    expect(output).toContain('<project name="test-project">')
    expect(output).toContain('<change>')
    expect(output).toContain('<number>12345</number>')
    expect(output).toContain('<subject><![CDATA[XML test change]]></subject>')
    expect(output).toContain('<status>NEW</status>')
    expect(output).toContain('<owner>Test User</owner>')
    expect(output).toContain('<branch>main</branch>')
    expect(output).toContain('<owner_email>test@example.com</owner_email>')
    expect(output).toContain('</change>')
    expect(output).toContain('</project>')
    expect(output).toContain('</changes>')
    expect(output).toContain('</search_results>')
  })

  it('should respect --limit option with --xml flag', async () => {
    const mockChanges: ChangeInfo[] = [
      generateMockChange({
        _number: 12345,
        subject: 'Limited XML change',
        project: 'test-project',
        status: 'NEW',
        owner: { _account_id: 1, name: 'Test User', email: 'test@example.com' },
      }),
    ]

    server.use(
      http.get('*/a/changes/', ({ request }) => {
        const url = new URL(request.url)
        const query = url.searchParams.get('q')
        expect(query).toBe('owner:self limit:5')
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockChanges)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    await Effect.runPromise(
      searchCommand('owner:self', { xml: true, limit: '5' }).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(mockConfigLayer),
      ),
    )

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(output).toContain('<query><![CDATA[owner:self limit:5]]></query>')
    expect(output).toContain('<number>12345</number>')
    expect(output).toContain('<subject><![CDATA[Limited XML change]]></subject>')
  })

  it('should handle no results gracefully', async () => {
    server.use(
      http.get('*/a/changes/', () => {
        return HttpResponse.text(")]}'\n[]")
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    await Effect.runPromise(
      searchCommand('owner:nonexistent@example.com', {}).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(mockConfigLayer),
      ),
    )

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('No changes found')
  })

  it('should handle no results in XML format', async () => {
    server.use(
      http.get('*/a/changes/', () => {
        return HttpResponse.text(")]}'\n[]")
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    await Effect.runPromise(
      searchCommand('owner:nonexistent@example.com', { xml: true }).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(mockConfigLayer),
      ),
    )

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(output).toContain('<search_results>')
    expect(output).toContain('<count>0</count>')
    expect(output).toContain('</search_results>')
  })

  it('should handle network failures gracefully', async () => {
    server.use(
      http.get('*/a/changes/', () => {
        return HttpResponse.text('Network error', { status: 500 })
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const result = await Effect.runPromise(
      Effect.either(
        searchCommand('is:open', {}).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(mockConfigLayer),
        ),
      ),
    )

    expect(result._tag).toBe('Left')
  })

  it('should handle authentication failures', async () => {
    server.use(
      http.get('*/a/changes/', () => {
        return HttpResponse.text('Unauthorized', { status: 401 })
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const result = await Effect.runPromise(
      Effect.either(
        searchCommand('is:open', {}).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(mockConfigLayer),
        ),
      ),
    )

    expect(result._tag).toBe('Left')
  })

  it('should properly escape XML special characters', async () => {
    const mockChanges: ChangeInfo[] = [
      generateMockChange({
        _number: 12345,
        subject: 'Fix <script>alert("XSS")</script> & entities',
        project: 'test<project>',
        status: 'NEW',
        owner: { _account_id: 1, name: 'User <>&"\'' },
      }),
    ]

    server.use(
      http.get('*/a/changes/', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockChanges)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    await Effect.runPromise(
      searchCommand('is:open', { xml: true }).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(mockConfigLayer),
      ),
    )

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    // Subject should be in CDATA (special chars preserved)
    expect(output).toContain(
      '<subject><![CDATA[Fix <script>alert("XSS")</script> & entities]]></subject>',
    )
    // Project name attribute should be escaped
    expect(output).toContain('<project name="test&lt;project&gt;">')
    // Owner should be escaped (not CDATA)
    expect(output).toContain('<owner>User &lt;&gt;&amp;&quot;&apos;</owner>')
  })

  it('should sanitize CDATA content with ]]> sequences', async () => {
    const mockChanges: ChangeInfo[] = [
      generateMockChange({
        _number: 12345,
        subject: 'Subject with ]]> CDATA breaker',
        project: 'test-project',
        status: 'NEW',
        owner: { _account_id: 1, name: 'Test User' },
      }),
    ]

    server.use(
      http.get('*/a/changes/', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockChanges)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    await Effect.runPromise(
      searchCommand('is:open', { xml: true }).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(mockConfigLayer),
      ),
    )

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    // ]]> should be escaped to ]]&gt; to prevent CDATA injection
    expect(output).toContain('<subject><![CDATA[Subject with ]]&gt; CDATA breaker]]></subject>')
  })

  it('should display status indicators for changes with labels', async () => {
    const mockChanges: ChangeInfo[] = [
      generateMockChange({
        _number: 12345,
        subject: 'Approved change',
        project: 'test-project',
        status: 'NEW',
        owner: { _account_id: 1, name: 'Test User' },
        labels: {
          'Code-Review': {
            approved: { _account_id: 2 },
            value: 2,
          },
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
      searchCommand('is:open', {}).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(mockConfigLayer),
      ),
    )

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    // Should contain the checkmark indicator for approved
    expect(output).toContain('✓')
    expect(output).toContain('Approved change')
  })

  it('should not include owner_email when email is not present', async () => {
    const mockChanges: ChangeInfo[] = [
      generateMockChange({
        _number: 12345,
        subject: 'No email change',
        project: 'test-project',
        status: 'NEW',
        owner: { _account_id: 1, name: 'Test User' }, // No email
      }),
    ]

    server.use(
      http.get('*/a/changes/', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockChanges)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    await Effect.runPromise(
      searchCommand('is:open', { xml: true }).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(mockConfigLayer),
      ),
    )

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('<owner>Test User</owner>')
    expect(output).not.toContain('<owner_email>')
  })

  it('should not include updated when it is empty string', async () => {
    const mockChanges: ChangeInfo[] = [
      generateMockChange({
        _number: 12345,
        subject: 'Empty updated change',
        project: 'test-project',
        status: 'NEW',
        owner: { _account_id: 1, name: 'Test User' },
        updated: '   ', // Empty/whitespace
      }),
    ]

    server.use(
      http.get('*/a/changes/', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockChanges)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    await Effect.runPromise(
      searchCommand('is:open', { xml: true }).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(mockConfigLayer),
      ),
    )

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('<number>12345</number>')
    expect(output).not.toContain('<updated>')
  })

  it('should display search results header with count', async () => {
    const mockChanges: ChangeInfo[] = [
      generateMockChange({ _number: 1, subject: 'Change 1', project: 'p1' }),
      generateMockChange({ _number: 2, subject: 'Change 2', project: 'p2' }),
      generateMockChange({ _number: 3, subject: 'Change 3', project: 'p3' }),
    ]

    server.use(
      http.get('*/a/changes/', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockChanges)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    await Effect.runPromise(
      searchCommand('is:open', {}).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(mockConfigLayer),
      ),
    )

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Search results (3)')
  })
})

describe('search command CLI integration', () => {
  it('should output XML error format when --xml flag is used and request fails', async () => {
    // Use environment variables to configure an invalid host that will fail to connect
    const proc = Bun.spawn(['bun', 'run', 'src/cli/index.ts', 'search', '--xml'], {
      env: {
        // Preserve PATH for bun to be found
        PATH: process.env.PATH,
        // Override with invalid host - connection will fail
        GERRIT_HOST: 'http://localhost:59999',
        GERRIT_USERNAME: 'test',
        GERRIT_PASSWORD: 'test',
        // Set HOME to temp dir to prevent reading real config
        HOME: '/tmp',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const stdout = await new Response(proc.stdout).text()
    const exitCode = await proc.exited

    // Should exit with error code
    expect(exitCode).toBe(1)

    // Should output XML error format
    expect(stdout).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(stdout).toContain('<search_result>')
    expect(stdout).toContain('<status>error</status>')
    expect(stdout).toContain('<error><![CDATA[')
    expect(stdout).toContain(']]></error>')
    expect(stdout).toContain('</search_result>')
  })

  it('should output plain error format when request fails without --xml', async () => {
    // Use environment variables to configure an invalid host that will fail to connect
    const proc = Bun.spawn(['bun', 'run', 'src/cli/index.ts', 'search'], {
      env: {
        // Preserve PATH for bun to be found
        PATH: process.env.PATH,
        // Override with invalid host - connection will fail
        GERRIT_HOST: 'http://localhost:59999',
        GERRIT_USERNAME: 'test',
        GERRIT_PASSWORD: 'test',
        // Set HOME to temp dir to prevent reading real config
        HOME: '/tmp',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited

    // Should exit with error code
    expect(exitCode).toBe(1)

    // Should output plain error (not XML)
    expect(stderr).toContain('✗ Error:')
    expect(stderr).not.toContain('<?xml')
  })
})
