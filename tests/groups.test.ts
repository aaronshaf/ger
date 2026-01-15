import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Effect, Layer } from 'effect'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { GerritApiServiceLive } from '@/api/gerrit'
import { groupsCommand } from '@/cli/commands/groups'
import { ConfigService } from '@/services/config'
import { createMockConfigService } from './helpers/config-mock'

const mockGroups = {
  administrators: {
    id: 'administrators',
    name: 'Administrators',
    description: 'Site administrators with full access',
    owner: 'Administrators',
    owner_id: 'administrators',
    group_id: 1,
    options: { visible_to_all: true },
    created_on: '2024-01-01 10:00:00.000000000',
  },
  'project-reviewers': {
    id: 'project-reviewers',
    name: 'Project Reviewers',
    description: 'Code reviewers for the project',
    owner: 'Project Owners',
    owner_id: 'project-owners',
    group_id: 2,
    options: { visible_to_all: false },
  },
  developers: {
    id: 'developers',
    name: 'Developers',
    description: 'Development team members',
    owner: 'Administrators',
    owner_id: 'administrators',
    group_id: 3,
  },
}

const server = setupServer(
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

describe('groups command', () => {
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

  it('should list all groups', async () => {
    server.use(
      http.get('*/a/groups/', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockGroups)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = groupsCommand({}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Available groups (3)')
    expect(output).toContain('Administrators')
    expect(output).toContain('Site administrators with full access')
    expect(output).toContain('Project Reviewers')
    expect(output).toContain('Developers')
  })

  it('should list groups with pattern filter', async () => {
    server.use(
      http.get('*/a/groups/', ({ request }) => {
        const url = new URL(request.url)
        const pattern = url.searchParams.get('r')
        expect(pattern).toBe('project-.*')

        const filtered = {
          'project-reviewers': mockGroups['project-reviewers'],
        }
        return HttpResponse.text(`)]}'\n${JSON.stringify(filtered)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = groupsCommand({ pattern: 'project-.*' }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Project Reviewers')
    expect(output).not.toContain('Administrators')
    expect(output).not.toContain('Developers')
  })

  it('should list owned groups only', async () => {
    server.use(
      http.get('*/a/groups/', ({ request }) => {
        const url = new URL(request.url)
        expect(url.searchParams.has('owned')).toBe(true)

        const filtered = {
          administrators: mockGroups['administrators'],
        }
        return HttpResponse.text(`)]}'\n${JSON.stringify(filtered)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = groupsCommand({ owned: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Administrators')
  })

  it('should list groups for specific project', async () => {
    server.use(
      http.get('*/a/groups/', ({ request }) => {
        const url = new URL(request.url)
        const project = url.searchParams.get('p')
        expect(project).toBe('my-project')

        return HttpResponse.text(`)]}'\n${JSON.stringify(mockGroups)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = groupsCommand({ project: 'my-project' }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Available groups')
  })

  it('should output XML format when --xml flag is used', async () => {
    server.use(
      http.get('*/a/groups/', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockGroups)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = groupsCommand({ xml: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(output).toContain('<groups_result>')
    expect(output).toContain('<status>success</status>')
    expect(output).toContain('<count>3</count>')
    expect(output).toContain('<groups>')
    expect(output).toContain('<group>')
    expect(output).toContain('<id><![CDATA[administrators]]></id>')
    expect(output).toContain('<name><![CDATA[Administrators]]></name>')
    expect(output).toContain(
      '<description><![CDATA[Site administrators with full access]]></description>',
    )
    expect(output).toContain('<owner><![CDATA[Administrators]]></owner>')
    expect(output).toContain('<visible_to_all>true</visible_to_all>')
    expect(output).toContain('</group>')
    expect(output).toContain('</groups>')
    expect(output).toContain('</groups_result>')
  })

  it('should handle empty results', async () => {
    server.use(
      http.get('*/a/groups/', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify({})}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = groupsCommand({}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('No groups found')
  })

  it('should handle empty results with XML format', async () => {
    server.use(
      http.get('*/a/groups/', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify({})}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = groupsCommand({ xml: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('<groups_result>')
    expect(output).toContain('<status>success</status>')
    expect(output).toContain('<count>0</count>')
    expect(output).toContain('<groups />')
  })

  it('should handle network errors gracefully', async () => {
    server.use(
      http.get('*/a/groups/', () => {
        return HttpResponse.error()
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = groupsCommand({}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await expect(Effect.runPromise(program)).rejects.toThrow()
  })

  it('should handle API errors (403)', async () => {
    server.use(
      http.get('*/a/groups/', () => {
        return HttpResponse.text('Forbidden', { status: 403 })
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = groupsCommand({}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await expect(Effect.runPromise(program)).rejects.toThrow()
  })

  it('should handle groups without optional fields', async () => {
    const minimalGroups = {
      'minimal-group': {
        id: 'minimal-group',
        name: 'Minimal Group',
      },
    }

    server.use(
      http.get('*/a/groups/', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(minimalGroups)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = groupsCommand({ xml: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('<id><![CDATA[minimal-group]]></id>')
    expect(output).toContain('<name><![CDATA[Minimal Group]]></name>')
    expect(output).not.toContain('<description>')
    expect(output).not.toContain('<owner>')
  })

  it('should respect limit parameter', async () => {
    server.use(
      http.get('*/a/groups/', ({ request }) => {
        const url = new URL(request.url)
        const limit = url.searchParams.get('n')
        expect(limit).toBe('10')

        return HttpResponse.text(`)]}'\n${JSON.stringify(mockGroups)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = groupsCommand({ limit: '10' }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Available groups')
  })
})
