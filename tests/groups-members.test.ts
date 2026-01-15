import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Effect, Layer } from 'effect'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { GerritApiServiceLive } from '@/api/gerrit'
import { groupsMembersCommand } from '@/cli/commands/groups-members'
import { ConfigService } from '@/services/config'
import { createMockConfigService } from './helpers/config-mock'

const mockMembers = [
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
  {
    _account_id: 1002,
    name: 'Bob Johnson',
    email: 'bob@example.com',
  },
]

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

describe('groups-members command', () => {
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

  it('should list all members of a group', async () => {
    server.use(
      http.get('*/a/groups/administrators/members/', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockMembers)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = groupsMembersCommand('administrators', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Members of "administrators" (3)')
    expect(output).toContain('John Doe')
    expect(output).toContain('Email: john@example.com')
    expect(output).toContain('Username: jdoe')
    expect(output).toContain('Account ID: 1000')
    expect(output).toContain('Jane Smith')
    expect(output).toContain('Bob Johnson')
  })

  it('should handle group with no members', async () => {
    server.use(
      http.get('*/a/groups/empty-group/members/', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify([])}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = groupsMembersCommand('empty-group', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Group "empty-group" has no members')
  })

  it('should output XML format when --xml flag is used', async () => {
    server.use(
      http.get('*/a/groups/administrators/members/', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(mockMembers)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = groupsMembersCommand('administrators', { xml: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(output).toContain('<group_members_result>')
    expect(output).toContain('<status>success</status>')
    expect(output).toContain('<group_id><![CDATA[administrators]]></group_id>')
    expect(output).toContain('<count>3</count>')
    expect(output).toContain('<members>')
    expect(output).toContain('<member>')
    expect(output).toContain('<account_id>1000</account_id>')
    expect(output).toContain('<name><![CDATA[John Doe]]></name>')
    expect(output).toContain('<email><![CDATA[john@example.com]]></email>')
    expect(output).toContain('<username><![CDATA[jdoe]]></username>')
    expect(output).toContain('</member>')
    expect(output).toContain('</members>')
    expect(output).toContain('</group_members_result>')
  })

  it('should handle empty members with XML format', async () => {
    server.use(
      http.get('*/a/groups/empty-group/members/', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify([])}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = groupsMembersCommand('empty-group', { xml: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('<group_members_result>')
    expect(output).toContain('<status>success</status>')
    expect(output).toContain('<count>0</count>')
    expect(output).toContain('<members />')
  })

  it('should handle group not found (404)', async () => {
    server.use(
      http.get('*/a/groups/nonexistent/members/', () => {
        return HttpResponse.text('Not Found', { status: 404 })
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = groupsMembersCommand('nonexistent', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await expect(Effect.runPromise(program)).rejects.toThrow()
  })

  it('should handle network errors gracefully', async () => {
    server.use(
      http.get('*/a/groups/administrators/members/', () => {
        return HttpResponse.error()
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = groupsMembersCommand('administrators', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await expect(Effect.runPromise(program)).rejects.toThrow()
  })

  it('should handle members without optional fields (email, name)', async () => {
    const minimalMembers = [
      {
        _account_id: 1000,
      },
      {
        _account_id: 1001,
        username: 'jsmith',
      },
    ]

    server.use(
      http.get('*/a/groups/minimal-group/members/', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(minimalMembers)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = groupsMembersCommand('minimal-group', {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Account 1000')
    expect(output).toContain('Account ID: 1000')
    expect(output).toContain('jsmith')
    expect(output).toContain('Account ID: 1001')
  })

  it('should handle members without optional fields in XML', async () => {
    const minimalMembers = [
      {
        _account_id: 1000,
      },
    ]

    server.use(
      http.get('*/a/groups/minimal-group/members/', () => {
        return HttpResponse.text(`)]}'\n${JSON.stringify(minimalMembers)}`)
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = groupsMembersCommand('minimal-group', { xml: true }).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('<account_id>1000</account_id>')
    expect(output).not.toContain('<name>')
    expect(output).not.toContain('<email>')
    expect(output).not.toContain('<username>')
  })
})
