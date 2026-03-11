import { describe, test, expect, beforeAll, afterAll, afterEach, mock, spyOn } from 'bun:test'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { Effect, Layer } from 'effect'
import { cherryCommand } from '@/cli/commands/cherry'
import { GerritApiServiceLive } from '@/api/gerrit'
import { ConfigService } from '@/services/config'
import { createMockConfigService } from './helpers/config-mock'
import type { ChangeInfo, RevisionInfo } from '@/schemas/gerrit'
import * as childProcess from 'node:child_process'
import type { SpawnSyncReturns } from 'node:child_process'

const mockChange: ChangeInfo = {
  id: 'test-project~main~I123',
  _number: 12345,
  project: 'test-project',
  branch: 'main',
  change_id: 'I123',
  subject: 'Test cherry-pick change',
  status: 'NEW',
  created: '2024-01-15 10:00:00.000000000',
  updated: '2024-01-15 10:00:00.000000000',
}

const mockRevision: RevisionInfo = {
  _number: 1,
  ref: 'refs/changes/45/12345/1',
  created: '2024-01-15 10:00:00.000000000',
  uploader: { _account_id: 1000, name: 'Test User', email: 'test@example.com' },
}

const server = setupServer(
  http.get('*/a/accounts/self', ({ request }) => {
    const auth = request.headers.get('Authorization')
    if (!auth?.startsWith('Basic ')) return HttpResponse.text('Unauthorized', { status: 401 })
    return HttpResponse.json({ _account_id: 1000, name: 'Test User', email: 'test@example.com' })
  }),
  http.get('*/a/changes/12345', () => HttpResponse.json(mockChange)),
  http.get('*/a/changes/12345/revisions/current', () => HttpResponse.json(mockRevision)),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }))
afterAll(() => server.close())

const mockConfig = createMockConfigService({
  host: 'https://test.gerrit.com',
  username: 'testuser',
  password: 'testpass',
})

describe('cherry command', () => {
  let mockExecSync: ReturnType<typeof spyOn>
  let mockSpawnSync: ReturnType<typeof spyOn>

  afterEach(() => {
    server.resetHandlers()
    mockExecSync?.mockRestore()
    mockSpawnSync?.mockRestore()
  })

  const setupGitMocks = (spawnOverrides: { failFetch?: boolean; failCherry?: boolean } = {}) => {
    mockExecSync = spyOn(childProcess, 'execSync').mockImplementation(((command: string) => {
      if (command.includes('rev-parse --git-dir')) return Buffer.from('.git')
      if (command.includes('remote -v'))
        return Buffer.from('origin\thttps://test.gerrit.com/project\t(fetch)\n')
      return Buffer.from('')
    }) as typeof childProcess.execSync)

    mockSpawnSync = spyOn(childProcess, 'spawnSync').mockImplementation(((
      _cmd: string,
      args: string[],
    ) => {
      const isCherry = args.includes('cherry-pick')
      if (isCherry && spawnOverrides.failCherry) {
        return {
          status: 1,
          stderr: Buffer.from('conflict during cherry-pick'),
        } as unknown as SpawnSyncReturns<Buffer>
      }
      if (!isCherry && spawnOverrides.failFetch) {
        return {
          status: 1,
          stderr: Buffer.from('fetch failed'),
        } as unknown as SpawnSyncReturns<Buffer>
      }
      return { status: 0, stderr: Buffer.from('') } as unknown as SpawnSyncReturns<Buffer>
    }) as typeof childProcess.spawnSync)
  }

  test('cherry-picks a change successfully', async () => {
    setupGitMocks()

    await Effect.runPromise(
      cherryCommand('12345', {}).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(Layer.succeed(ConfigService, mockConfig)),
      ),
    )

    const spawnCalls = mockSpawnSync.mock.calls as unknown as [string, string[]][]
    expect(spawnCalls.some(([, args]) => args.includes('fetch'))).toBe(true)
    expect(
      spawnCalls.some(([, args]) => args.includes('cherry-pick') && args.includes('FETCH_HEAD')),
    ).toBe(true)
    expect(spawnCalls.some(([, args]) => args.includes('cherry-pick') && args.includes('-n'))).toBe(
      false,
    )
  })

  test('cherry-picks with --no-commit flag', async () => {
    setupGitMocks()

    await Effect.runPromise(
      cherryCommand('12345', { noCommit: true }).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(Layer.succeed(ConfigService, mockConfig)),
      ),
    )

    const spawnCalls = mockSpawnSync.mock.calls as unknown as [string, string[]][]
    expect(spawnCalls.some(([, args]) => args.includes('cherry-pick') && args.includes('-n'))).toBe(
      true,
    )
  })

  test('parses 12345/3 patchset syntax', async () => {
    setupGitMocks()

    server.use(
      http.get('*/a/changes/12345/revisions/3', () =>
        HttpResponse.json({ ...mockRevision, _number: 3, ref: 'refs/changes/45/12345/3' }),
      ),
    )

    await Effect.runPromise(
      cherryCommand('12345/3', {}).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(Layer.succeed(ConfigService, mockConfig)),
      ),
    )

    const spawnCalls = mockSpawnSync.mock.calls as unknown as [string, string[]][]
    expect(spawnCalls.some(([, args]) => args.includes('refs/changes/45/12345/3'))).toBe(true)
  })

  test('fails when not in a git repo', async () => {
    mockExecSync = spyOn(childProcess, 'execSync').mockImplementation((() => {
      throw new Error('not a git repo')
    }) as typeof childProcess.execSync)

    const result = await Effect.runPromise(
      cherryCommand('12345', {}).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(Layer.succeed(ConfigService, mockConfig)),
        Effect.either,
      ),
    )
    expect(result._tag).toBe('Left')
  })

  test('fails when change not found', async () => {
    setupGitMocks()
    server.use(http.get('*/a/changes/99999', () => HttpResponse.json({}, { status: 404 })))

    const result = await Effect.runPromise(
      cherryCommand('99999', {}).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(Layer.succeed(ConfigService, mockConfig)),
        Effect.either,
      ),
    )
    expect(result._tag).toBe('Left')
  })

  test('fails when git cherry-pick fails', async () => {
    setupGitMocks({ failCherry: true })

    let threw = false
    try {
      await Effect.runPromise(
        cherryCommand('12345', {}).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(Layer.succeed(ConfigService, mockConfig)),
        ),
      )
    } catch (e) {
      threw = true
      expect(String(e)).toContain('Cherry-pick failed')
    }
    expect(threw).toBe(true)
  })

  test('uses --remote option when provided', async () => {
    setupGitMocks()

    await Effect.runPromise(
      cherryCommand('12345', { remote: 'upstream' }).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(Layer.succeed(ConfigService, mockConfig)),
      ),
    )

    const spawnCalls = mockSpawnSync.mock.calls as unknown as [string, string[]][]
    expect(spawnCalls.some(([, args]) => args.includes('fetch') && args.includes('upstream'))).toBe(
      true,
    )
  })
})
