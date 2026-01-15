import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Effect, Layer } from 'effect'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { GerritApiServiceLive } from '@/api/gerrit'
import { groupsShowCommand } from '@/cli/commands/groups-show'
import { ConfigService } from '@/services/config'
import { createMockConfigService } from './helpers/config-mock'

const mockGroupDetail = {
  id: 'administrators',
  name: 'Administrators',
  description: 'Site administrators with full access',
  owner: 'Administrators',
  owner_id: 'administrators',
  group_id: 1,
  options: { visible_to_all: true },
  created_on: '2024-01-01 10:00:00.000000000',
  url: 'https://gerrit.example.com/admin/groups/uuid-administrators',
  members: [
    {
      _account_id: 1000,
      name: 'John Doe',
      email: 'john@example.com',
      username: 'jdoe',
    },
    {
      _account_id: 1001,
      name: 'Jane Smith',
      email: 'jane@example.com',
      username: 'jsmith',
    },
  ],
  includes: [
    {
      id: 'project-admins',
      name: 'Project Admins',
    },
    {
      id: 'system-admins',
      name: 'System Admins',
    },
  ],
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

describe('groups-show command', () => {
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

  it('should show group details with members and subgroups', async () => {
    server.use(
      http.get('*/a/groups/administrators/detail', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockGroupDetail)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = groupsShowCommand('administrators', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Group: Administrators')
    expect(output).toContain('ID: administrators')
    expect(output).toContain('Numeric ID: 1')
    expect(output).toContain('Owner: Administrators')
    expect(output).toContain('Description: Site administrators with full access')
    expect(output).toContain('Visible to all: Yes')
    expect(output).toContain('Members (2):')
    expect(output).toContain('John Doe')
    expect(output).toContain('john@example.com')
    expect(output).toContain('Jane Smith')
    expect(output).toContain('Subgroups (2):')
    expect(output).toContain('Project Admins')
    expect(output).toContain('System Admins')
  })

  it('should show group by numeric ID', async () => {
    server.use(
      http.get('*/a/groups/1/detail', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockGroupDetail)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = groupsShowCommand('1', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Group: Administrators')
  })

  it('should show group by UUID', async () => {
    server.use(
      http.get('*/a/groups/uuid-123456/detail', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockGroupDetail)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = groupsShowCommand('uuid-123456', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Group: Administrators')
  })

  it('should output XML format when --xml flag is used', async () => {
    server.use(
      http.get('*/a/groups/administrators/detail', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockGroupDetail)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = groupsShowCommand('administrators', { xml: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(output).toContain('<group_detail_result>')
    expect(output).toContain('<status>success</status>')
    expect(output).toContain('<group>')
    expect(output).toContain('<id><![CDATA[administrators]]></id>')
    expect(output).toContain('<name><![CDATA[Administrators]]></name>')
    expect(output).toContain(
      '<description><![CDATA[Site administrators with full access]]></description>',
    )
    expect(output).toContain('<members>')
    expect(output).toContain('<member>')
    expect(output).toContain('<account_id>1000</account_id>')
    expect(output).toContain('<name><![CDATA[John Doe]]></name>')
    expect(output).toContain('<email><![CDATA[john@example.com]]></email>')
    expect(output).toContain('</member>')
    expect(output).toContain('</members>')
    expect(output).toContain('<subgroups>')
    expect(output).toContain('<subgroup>')
    expect(output).toContain('<id><![CDATA[project-admins]]></id>')
    expect(output).toContain('</subgroup>')
    expect(output).toContain('</subgroups>')
    expect(output).toContain('</group>')
    expect(output).toContain('</group_detail_result>')
  })

  it('should handle group not found (404)', async () => {
    server.use(
      http.get('*/a/groups/nonexistent/detail', () => {
        return HttpResponse.text('Not Found', { status: 404 })
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = groupsShowCommand('nonexistent', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await expect(Effect.runPromise(program)).rejects.toThrow()
  })

  it('should handle permission denied (403)', async () => {
    server.use(
      http.get('*/a/groups/secret-group/detail', () => {
        return HttpResponse.text('Forbidden', { status: 403 })
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = groupsShowCommand('secret-group', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await expect(Effect.runPromise(program)).rejects.toThrow()
  })

  it('should handle network errors gracefully', async () => {
    server.use(
      http.get('*/a/groups/administrators/detail', () => {
        return HttpResponse.error()
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = groupsShowCommand('administrators', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await expect(Effect.runPromise(program)).rejects.toThrow()
  })

  it('should handle groups without members', async () => {
    const groupWithoutMembers = {
      ...mockGroupDetail,
      members: undefined,
    }

    server.use(
      http.get('*/a/groups/empty-group/detail', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(groupWithoutMembers)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = groupsShowCommand('empty-group', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Members: None')
  })

  it('should handle groups without subgroups', async () => {
    const groupWithoutSubgroups = {
      ...mockGroupDetail,
      includes: undefined,
    }

    server.use(
      http.get('*/a/groups/no-subgroups/detail', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(groupWithoutSubgroups)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = groupsShowCommand('no-subgroups', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Subgroups: None')
  })

  it('should handle members without optional fields', async () => {
    const groupWithMinimalMembers = {
      ...mockGroupDetail,
      members: [
        {
          _account_id: 1000,
        },
      ],
    }

    server.use(
      http.get('*/a/groups/minimal-members/detail', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(groupWithMinimalMembers)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = groupsShowCommand('minimal-members', { xml: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('<account_id>1000</account_id>')
    // Extract just the member section to check optional fields aren't present
    const memberMatch = output.match(/<member>[\s\S]*?<\/member>/)
    expect(memberMatch).toBeTruthy()
    const memberSection = memberMatch?.[0] || ''
    expect(memberSection).not.toContain('<name>')
    expect(memberSection).not.toContain('<email>')
    expect(memberSection).not.toContain('<username>')
  })
})
