import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Effect, Layer } from 'effect'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { GerritApiServiceLive } from '@/api/gerrit'
import { projectsCommand } from '@/cli/commands/projects'
import { ConfigService } from '@/services/config'
import { createMockConfigService } from './helpers/config-mock'

const mockProjects = {
  'project-a': {
    id: 'project-a',
    name: 'project-a',
    parent: 'All-Projects',
    state: 'ACTIVE' as const,
  },
  'project-b': {
    id: 'project-b',
    name: 'project-b',
    parent: 'All-Projects',
    state: 'ACTIVE' as const,
  },
  'test-project': {
    id: 'test-project',
    name: 'test-project',
    parent: 'All-Projects',
    state: 'ACTIVE' as const,
  },
}

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

describe('projects command', () => {
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

  it('should list all projects', async () => {
    server.use(
      http.get('*/a/projects/', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockProjects)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = projectsCommand({}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    // Projects should be sorted alphabetically
    expect(output).toContain('project-a')
    expect(output).toContain('project-b')
    expect(output).toContain('test-project')

    // Check that they appear in alphabetical order
    const lines = output.split('\n').filter((line) => line.trim())
    expect(lines[0]).toBe('project-a')
    expect(lines[1]).toBe('project-b')
    expect(lines[2]).toBe('test-project')
  })

  it('should list projects with pattern filter', async () => {
    server.use(
      http.get('*/a/projects/', ({ request }) => {
        const url = new URL(request.url)
        const pattern = url.searchParams.get('p')
        expect(pattern).toBe('test-*')

        // Return filtered projects
        const filtered = {
          'test-project': mockProjects['test-project'],
        }
        return HttpResponse.text(`)]}'\n${JSON.stringify(filtered)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = projectsCommand({ pattern: 'test-*' }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('test-project')
    expect(output).not.toContain('project-a')
    expect(output).not.toContain('project-b')
  })

  it('should output XML format when --xml flag is used', async () => {
    server.use(
      http.get('*/a/projects/', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockProjects)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = projectsCommand({ xml: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(output).toContain('<projects_result>')
    expect(output).toContain('<status>success</status>')
    expect(output).toContain('<projects>')
    expect(output).toContain('<project>')
    expect(output).toContain('<id>project-a</id>')
    expect(output).toContain('<name>project-a</name>')
    expect(output).toContain('<parent>All-Projects</parent>')
    expect(output).toContain('<state>ACTIVE</state>')
    expect(output).toContain('</project>')
    expect(output).toContain('</projects>')
    expect(output).toContain('</projects_result>')
  })

  it('should handle empty results', async () => {
    server.use(
      http.get('*/a/projects/', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify({})}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = projectsCommand({}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('No projects found')
  })

  it('should handle empty results with XML format', async () => {
    server.use(
      http.get('*/a/projects/', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify({})}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = projectsCommand({ xml: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('<projects_result>')
    expect(output).toContain('<status>success</status>')
    expect(output).toContain('<projects />')
  })

  it('should handle network errors gracefully', async () => {
    server.use(
      http.get('*/a/projects/', () => {
        return HttpResponse.error()
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = projectsCommand({}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    // Should throw/fail
    await expect(Effect.runPromise(program)).rejects.toThrow()
  })

  it('should handle API errors', async () => {
    server.use(
      http.get('*/a/projects/', () => {
        return HttpResponse.text('Forbidden', { status: 403 })
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = projectsCommand({}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    // Should throw/fail
    await expect(Effect.runPromise(program)).rejects.toThrow()
  })

  it('should handle projects without parent or state', async () => {
    const minimalProjects = {
      'minimal-project': {
        id: 'minimal-project',
        name: 'minimal-project',
      },
    }

    server.use(
      http.get('*/a/projects/', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(minimalProjects)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = projectsCommand({ xml: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('<id>minimal-project</id>')
    expect(output).toContain('<name>minimal-project</name>')
    expect(output).not.toContain('<parent>')
    expect(output).not.toContain('<state>')
  })
})
