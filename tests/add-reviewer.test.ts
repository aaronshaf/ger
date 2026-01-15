import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Effect, Layer } from 'effect'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { GerritApiServiceLive } from '@/api/gerrit'
import { addReviewerCommand } from '@/cli/commands/add-reviewer'
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

describe('add-reviewer command', () => {
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

  it('should add a single reviewer successfully', async () => {
    server.use(
      http.post('*/a/changes/12345/reviewers', async ({ request }) => {
        const body = (await request.json()) as { reviewer: string; state?: string }
        expect(body.reviewer).toBe('reviewer@example.com')
        expect(body.state).toBe('REVIEWER')
        return HttpResponse.text(
          `)]}'\n${JSON.stringify({
            input: 'reviewer@example.com',
            reviewers: [
              {
                _account_id: 2000,
                name: 'Reviewer User',
                email: 'reviewer@example.com',
              },
            ],
          })}`,
        )
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = addReviewerCommand(['reviewer@example.com'], {
      change: '12345',
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Added Reviewer User as reviewer')
  })

  it('should add multiple reviewers successfully', async () => {
    let callCount = 0
    server.use(
      http.post('*/a/changes/12345/reviewers', async ({ request }) => {
        const body = (await request.json()) as { reviewer: string }
        callCount++
        const reviewerName = callCount === 1 ? 'User One' : 'User Two'
        return HttpResponse.text(
          `)]}'\n${JSON.stringify({
            input: body.reviewer,
            reviewers: [
              {
                _account_id: 2000 + callCount,
                name: reviewerName,
                email: body.reviewer,
              },
            ],
          })}`,
        )
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = addReviewerCommand(['user1@example.com', 'user2@example.com'], {
      change: '12345',
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Added User One as reviewer')
    expect(output).toContain('Added User Two as reviewer')
    expect(callCount).toBe(2)
  })

  it('should add as CC when --cc flag is used', async () => {
    server.use(
      http.post('*/a/changes/12345/reviewers', async ({ request }) => {
        const body = (await request.json()) as { reviewer: string; state?: string }
        expect(body.reviewer).toBe('cc@example.com')
        expect(body.state).toBe('CC')
        return HttpResponse.text(
          `)]}'\n${JSON.stringify({
            input: 'cc@example.com',
            ccs: [
              {
                _account_id: 2000,
                name: 'CC User',
                email: 'cc@example.com',
              },
            ],
          })}`,
        )
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = addReviewerCommand(['cc@example.com'], {
      change: '12345',
      cc: true,
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Added CC User as cc')
  })

  it('should pass notify option to API', async () => {
    server.use(
      http.post('*/a/changes/12345/reviewers', async ({ request }) => {
        const body = (await request.json()) as { reviewer: string; notify?: string }
        expect(body.notify).toBe('NONE')
        return HttpResponse.text(
          `)]}'\n${JSON.stringify({
            input: 'reviewer@example.com',
            reviewers: [
              {
                _account_id: 2000,
                name: 'Reviewer',
                email: 'reviewer@example.com',
              },
            ],
          })}`,
        )
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = addReviewerCommand(['reviewer@example.com'], {
      change: '12345',
      notify: 'none',
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Added Reviewer as reviewer')
  })

  it('should handle API error in result', async () => {
    server.use(
      http.post('*/a/changes/12345/reviewers', async () => {
        return HttpResponse.text(
          `)]}'\n${JSON.stringify({
            input: 'nonexistent@example.com',
            error: 'Account not found: nonexistent@example.com',
          })}`,
        )
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = addReviewerCommand(['nonexistent@example.com'], {
      change: '12345',
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await Effect.runPromise(program)

    const errorOutput = mockConsoleError.mock.calls.map((call) => call[0]).join('\n')
    expect(errorOutput).toContain('Failed to add nonexistent@example.com')
    expect(errorOutput).toContain('Account not found')
  })

  it('should show error when change ID is not provided', async () => {
    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = addReviewerCommand(['reviewer@example.com'], {}).pipe(
      Effect.provide(GerritApiServiceLive),
      Effect.provide(mockConfigLayer),
    )

    const result = await Effect.runPromiseExit(program)
    expect(result._tag).toBe('Failure')

    const errorOutput = mockConsoleError.mock.calls.map((call) => call[0]).join('\n')
    expect(errorOutput).toContain('Change ID is required')
  })

  it('should show error when no reviewers are provided', async () => {
    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = addReviewerCommand([], {
      change: '12345',
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    const result = await Effect.runPromiseExit(program)
    expect(result._tag).toBe('Failure')

    const errorOutput = mockConsoleError.mock.calls.map((call) => call[0]).join('\n')
    expect(errorOutput).toContain('At least one reviewer is required')
  })

  it('should output XML format when --xml flag is used', async () => {
    server.use(
      http.post('*/a/changes/12345/reviewers', async () => {
        return HttpResponse.text(
          `)]}'\n${JSON.stringify({
            input: 'reviewer@example.com',
            reviewers: [
              {
                _account_id: 2000,
                name: 'Reviewer User',
                email: 'reviewer@example.com',
              },
            ],
          })}`,
        )
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = addReviewerCommand(['reviewer@example.com'], {
      change: '12345',
      xml: true,
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(output).toContain('<add_reviewer_result>')
    expect(output).toContain('<change_id>12345</change_id>')
    expect(output).toContain('<state>REVIEWER</state>')
    expect(output).toContain('<entity_type>individual</entity_type>')
    expect(output).toContain('<reviewer status="added">')
    expect(output).toContain('<input>reviewer@example.com</input>')
    expect(output).toContain('<name><![CDATA[Reviewer User]]></name>')
    expect(output).toContain('<status>success</status>')
    expect(output).toContain('</add_reviewer_result>')
  })

  it('should output XML format for errors when --xml flag is used', async () => {
    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = addReviewerCommand(['reviewer@example.com'], {
      xml: true,
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    const result = await Effect.runPromiseExit(program)
    expect(result._tag).toBe('Failure')

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(output).toContain('<add_reviewer_result>')
    expect(output).toContain('<status>error</status>')
    expect(output).toContain('<error><![CDATA[Change ID is required')
    expect(output).toContain('</add_reviewer_result>')
  })

  it('should handle network errors gracefully', async () => {
    server.use(
      http.post('*/a/changes/12345/reviewers', () => {
        return HttpResponse.text('Internal Server Error', { status: 500 })
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = addReviewerCommand(['reviewer@example.com'], {
      change: '12345',
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await Effect.runPromise(program)

    const errorOutput = mockConsoleError.mock.calls.map((call) => call[0]).join('\n')
    expect(errorOutput).toContain('Failed to add reviewer@example.com')
  })

  it('should handle partial success with multiple reviewers', async () => {
    let callCount = 0
    server.use(
      http.post('*/a/changes/12345/reviewers', async ({ request }) => {
        const body = (await request.json()) as { reviewer: string }
        callCount++
        if (callCount === 1) {
          return HttpResponse.text(
            `)]}'\n${JSON.stringify({
              input: body.reviewer,
              reviewers: [
                {
                  _account_id: 2001,
                  name: 'Valid User',
                  email: body.reviewer,
                },
              ],
            })}`,
          )
        }
        return HttpResponse.text(
          `)]}'\n${JSON.stringify({
            input: body.reviewer,
            error: 'Account not found',
          })}`,
        )
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = addReviewerCommand(['valid@example.com', 'invalid@example.com'], {
      change: '12345',
      xml: true,
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('<status>partial_failure</status>')
    expect(output).toContain('<reviewer status="added">')
    expect(output).toContain('<reviewer status="failed">')
  })

  it('should reject invalid notify option', async () => {
    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = addReviewerCommand(['reviewer@example.com'], {
      change: '12345',
      notify: 'invalid',
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    const result = await Effect.runPromiseExit(program)
    expect(result._tag).toBe('Failure')

    const errorOutput = mockConsoleError.mock.calls.map((call) => call[0]).join('\n')
    expect(errorOutput).toContain('Invalid notify level: invalid')
    expect(errorOutput).toContain('Valid values: none, owner, owner_reviewers, all')
  })

  it('should pass REVIEWER state by default (not CC)', async () => {
    let receivedState: string | undefined
    server.use(
      http.post('*/a/changes/12345/reviewers', async ({ request }) => {
        const body = (await request.json()) as { reviewer: string; state?: string }
        receivedState = body.state
        return HttpResponse.text(
          `)]}'\n${JSON.stringify({
            input: body.reviewer,
            reviewers: [
              {
                _account_id: 2000,
                name: 'Reviewer',
                email: body.reviewer,
              },
            ],
          })}`,
        )
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = addReviewerCommand(['reviewer@example.com'], {
      change: '12345',
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await Effect.runPromise(program)

    expect(receivedState).toBe('REVIEWER')
  })

  it('should add a group as reviewer with --group flag', async () => {
    server.use(
      http.post('*/a/changes/12345/reviewers', async ({ request }) => {
        const body = (await request.json()) as { reviewer: string; state?: string }
        expect(body.reviewer).toBe('project-reviewers')
        expect(body.state).toBe('REVIEWER')
        return HttpResponse.text(
          `)]}'\n${JSON.stringify({
            input: 'project-reviewers',
            reviewers: [
              {
                _account_id: 3001,
                name: 'Alice Developer',
                email: 'alice@example.com',
              },
              {
                _account_id: 3002,
                name: 'Bob Developer',
                email: 'bob@example.com',
              },
            ],
          })}`,
        )
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = addReviewerCommand(['project-reviewers'], {
      change: '12345',
      group: true,
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Added Alice Developer as group')
  })

  it('should add a group as CC with --group and --cc flags', async () => {
    server.use(
      http.post('*/a/changes/12345/reviewers', async ({ request }) => {
        const body = (await request.json()) as { reviewer: string; state?: string }
        expect(body.reviewer).toBe('administrators')
        expect(body.state).toBe('CC')
        return HttpResponse.text(
          `)]}'\n${JSON.stringify({
            input: 'administrators',
            ccs: [
              {
                _account_id: 4001,
                name: 'Admin User',
                email: 'admin@example.com',
              },
            ],
          })}`,
        )
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = addReviewerCommand(['administrators'], {
      change: '12345',
      group: true,
      cc: true,
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('Added Admin User as cc')
  })

  it('should show error when no groups provided with --group flag', async () => {
    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = addReviewerCommand([], {
      change: '12345',
      group: true,
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    const result = await Effect.runPromiseExit(program)
    expect(result._tag).toBe('Failure')

    const errorOutput = mockConsoleError.mock.calls.map((call) => call[0]).join('\n')
    expect(errorOutput).toContain('At least one group is required')
  })

  it('should output XML format with --group flag', async () => {
    server.use(
      http.post('*/a/changes/12345/reviewers', async () => {
        return HttpResponse.text(
          `)]}'\n${JSON.stringify({
            input: 'project-reviewers',
            reviewers: [
              {
                _account_id: 3001,
                name: 'Alice Developer',
                email: 'alice@example.com',
              },
            ],
          })}`,
        )
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = addReviewerCommand(['project-reviewers'], {
      change: '12345',
      group: true,
      xml: true,
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await Effect.runPromise(program)

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(output).toContain('<add_reviewer_result>')
    expect(output).toContain('<change_id>12345</change_id>')
    expect(output).toContain('<state>REVIEWER</state>')
    expect(output).toContain('<entity_type>group</entity_type>')
    expect(output).toContain('<reviewer status="added">')
    expect(output).toContain('<input>project-reviewers</input>')
    expect(output).toContain('<name><![CDATA[Alice Developer]]></name>')
    expect(output).toContain('<status>success</status>')
  })

  it('should handle group not found error', async () => {
    server.use(
      http.post('*/a/changes/12345/reviewers', async () => {
        return HttpResponse.text(
          `)]}'\n${JSON.stringify({
            input: 'nonexistent-group',
            error: 'Group nonexistent-group not found',
          })}`,
        )
      }),
    )

    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = addReviewerCommand(['nonexistent-group'], {
      change: '12345',
      group: true,
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    await Effect.runPromise(program)

    const errorOutput = mockConsoleError.mock.calls.map((call) => call[0]).join('\n')
    expect(errorOutput).toContain('Failed to add nonexistent-group')
    expect(errorOutput).toContain('Group nonexistent-group not found')
  })

  it('should reject email-like input when --group flag is used', async () => {
    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = addReviewerCommand(['user@example.com'], {
      change: '12345',
      group: true,
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    const result = await Effect.runPromiseExit(program)
    expect(result._tag).toBe('Failure')

    const errorOutput = mockConsoleError.mock.calls.map((call) => call[0]).join('\n')
    expect(errorOutput).toContain('The --group flag expects group identifiers')
    expect(errorOutput).toContain('user@example.com')
    expect(errorOutput).toContain('Did you mean to omit --group?')
  })

  it('should reject email-like input in XML mode when --group flag is used', async () => {
    const mockConfigLayer = Layer.succeed(ConfigService, createMockConfigService())
    const program = addReviewerCommand(['admin@example.com', 'test@example.com'], {
      change: '12345',
      group: true,
      xml: true,
    }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(mockConfigLayer))

    const result = await Effect.runPromiseExit(program)
    expect(result._tag).toBe('Failure')

    const output = mockConsoleLog.mock.calls.map((call) => call[0]).join('\n')
    expect(output).toContain('<add_reviewer_result>')
    expect(output).toContain('<status>error</status>')
    expect(output).toContain('<error><![CDATA[')
    expect(output).toContain('admin@example.com')
    expect(output).toContain('test@example.com')
  })
})
