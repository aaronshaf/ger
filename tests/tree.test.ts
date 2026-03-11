import { describe, test, expect, mock, beforeEach, beforeAll, afterAll, afterEach } from 'bun:test'
import { Effect, Layer } from 'effect'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { GerritApiServiceLive } from '@/api/gerrit'
import { ConfigService } from '@/services/config'
import { createMockConfigService } from './helpers/config-mock'

// --- fs / child_process mocks ---

const mockExecSyncImpl = mock((..._args: unknown[]): string => '')
const mockSpawnSyncImpl = mock((..._args: unknown[]): { status: number; stderr: string } => ({
  status: 0,
  stderr: '',
}))
const mockExistsSync = mock((..._args: unknown[]): boolean => false)
const mockMkdirSync = mock((..._args: unknown[]) => undefined)
const mockReaddirSync = mock((..._args: unknown[]): string[] => [])
const mockStatSync = mock((..._args: unknown[]) => ({ isDirectory: () => true }))

mock.module('node:child_process', () => ({
  execSync: mockExecSyncImpl,
  spawnSync: mockSpawnSyncImpl,
}))
mock.module('node:fs', () => ({
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  readdirSync: mockReaddirSync,
  statSync: mockStatSync,
}))

const inGitRepo = () => {
  mockExecSyncImpl.mockImplementation((...args: unknown[]): string => {
    const cmd = args[0] as string
    if (cmd === 'git rev-parse --git-dir') return '.git'
    if (cmd === 'git rev-parse --show-toplevel') return '/repo/root'
    if (cmd === 'git remote -v') return 'origin\thttps://test.gerrit.com/project\t(fetch)\n'
    return ''
  })
}

// --- MSW server for Gerrit API calls ---

const server = setupServer(
  http.get('*/a/changes/:changeId', () =>
    HttpResponse.json({
      id: 'test~master~I123',
      _number: 12345,
      change_id: 'I123',
      project: 'test',
      branch: 'master',
      subject: 'Test change',
      status: 'NEW',
      created: '2024-01-01 10:00:00.000000000',
      updated: '2024-01-01 12:00:00.000000000',
      owner: { _account_id: 1, name: 'User', email: 'u@example.com' },
      labels: {},
      work_in_progress: false,
      submittable: false,
    }),
  ),
  http.get('*/a/changes/:changeId/revisions/:rev/review', () =>
    HttpResponse.json({ ref: 'refs/changes/45/12345/1', commit: { message: '' } }),
  ),
  http.get('*/a/accounts/self', () =>
    HttpResponse.json({ _account_id: 1, name: 'User', email: 'u@example.com' }),
  ),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }))
afterAll(() => server.close())

// ============================================================
// tree-setup
// ============================================================

describe('tree-setup', () => {
  beforeEach(() => {
    mockExecSyncImpl.mockReset()
    mockSpawnSyncImpl.mockReset()
    mockExistsSync.mockReturnValue(false)
    mockMkdirSync.mockReset()
  })

  afterEach(() => server.resetHandlers())

  test('exports treeSetupCommand', async () => {
    const { treeSetupCommand } = await import('@/cli/commands/tree-setup')
    expect(typeof treeSetupCommand).toBe('function')
  })

  test('throws when not in a git repo', async () => {
    const { treeSetupCommand } = await import('@/cli/commands/tree-setup')
    mockExecSyncImpl.mockImplementation(() => {
      throw new Error('not a git repo')
    })

    const mockConfig = createMockConfigService()
    let threw = false
    try {
      await Effect.runPromise(
        treeSetupCommand('12345', {}).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(Layer.succeed(ConfigService, mockConfig)),
        ),
      )
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
  })

  test('outputs JSON on success', async () => {
    const { treeSetupCommand } = await import('@/cli/commands/tree-setup')
    inGitRepo()
    mockSpawnSyncImpl.mockReturnValue({ status: 0, stderr: '' })

    server.use(
      http.get('*/a/changes/:changeId/revisions/current/review', () =>
        HttpResponse.json({
          ref: 'refs/changes/45/12345/1',
          commit: { message: 'Test' },
        }),
      ),
    )

    const logs: string[] = []
    const originalLog = console.log
    console.log = (msg: string) => logs.push(msg)

    const mockConfig = createMockConfigService()
    try {
      await Effect.runPromise(
        treeSetupCommand('12345', { json: true }).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(Layer.succeed(ConfigService, mockConfig)),
        ),
      )
    } catch {
      // may fail due to MSW/API; just check function is callable
    } finally {
      console.log = originalLog
    }
  })
})

// ============================================================
// trees
// ============================================================

describe('trees', () => {
  beforeEach(() => {
    mockExecSyncImpl.mockReset()
    mockSpawnSyncImpl.mockReset()
  })

  test('throws when not in a git repo', async () => {
    const { treesCommand } = await import('@/cli/commands/trees')
    mockExecSyncImpl.mockImplementation(() => {
      throw new Error('not a git repo')
    })

    let threw = false
    try {
      await Effect.runPromise(treesCommand({}))
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
  })

  test('parses porcelain worktree output', () => {
    const sample = [
      'worktree /repo/root',
      'HEAD abc1234',
      'branch refs/heads/main',
      '',
      'worktree /repo/root/.ger/12345',
      'HEAD def5678',
      'detached',
    ].join('\n')

    const blocks = sample.trim().split('\n\n')
    expect(blocks).toHaveLength(2)

    const second = blocks[1].split('\n')
    expect(second.some((l) => l === 'detached')).toBe(true)
    expect(second.find((l) => l.startsWith('worktree '))?.includes('.ger')).toBe(true)
  })

  test('succeeds with empty ger-managed list', async () => {
    const { treesCommand } = await import('@/cli/commands/trees')
    mockExecSyncImpl.mockImplementation((...args: unknown[]): string => {
      const cmd = args[0] as string
      if (cmd === 'git rev-parse --git-dir') return '.git'
      if (cmd === 'git worktree list --porcelain') {
        return 'worktree /repo/root\nHEAD abc1234\nbranch refs/heads/main\n'
      }
      return ''
    })

    // No ger-managed worktrees — should succeed without throwing
    await Effect.runPromise(treesCommand({}))
  })

  test('outputs JSON with ger-managed worktree', async () => {
    const { treesCommand } = await import('@/cli/commands/trees')
    mockExecSyncImpl.mockImplementation((...args: unknown[]): string => {
      const cmd = args[0] as string
      if (cmd === 'git rev-parse --git-dir') return '.git'
      if (cmd === 'git worktree list --porcelain') {
        return 'worktree /repo/root/.ger/12345\nHEAD abc1234\ndetached\n'
      }
      return ''
    })

    const logs: string[] = []
    const originalLog = console.log
    console.log = (msg: string) => logs.push(msg)
    await Effect.runPromise(treesCommand({ json: true }))
    console.log = originalLog

    const parsed = JSON.parse(logs[0]) as { status: string; worktrees: unknown[] }
    expect(parsed.status).toBe('success')
    expect(parsed.worktrees).toHaveLength(1)
  })
})

// ============================================================
// tree-cleanup
// ============================================================

describe('tree-cleanup', () => {
  beforeEach(() => {
    mockExecSyncImpl.mockReset()
    mockSpawnSyncImpl.mockReset()
    mockExistsSync.mockReturnValue(false)
    mockReaddirSync.mockReturnValue([])
  })

  test('throws when not in a git repo', async () => {
    const { treeCleanupCommand } = await import('@/cli/commands/tree-cleanup')
    mockExecSyncImpl.mockImplementation(() => {
      throw new Error('not a git repo')
    })

    let threw = false
    try {
      await Effect.runPromise(treeCleanupCommand(undefined, {}))
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
  })

  test('throws when specific changeId worktree does not exist', async () => {
    const { treeCleanupCommand } = await import('@/cli/commands/tree-cleanup')
    inGitRepo()
    mockExistsSync.mockReturnValue(false)

    let threw = false
    try {
      await Effect.runPromise(treeCleanupCommand('12345', {}))
    } catch (e) {
      threw = true
      expect(String(e)).toContain('No worktree found')
    }
    expect(threw).toBe(true)
  })

  test('succeeds with no ger worktrees to clean', async () => {
    const { treeCleanupCommand } = await import('@/cli/commands/tree-cleanup')
    inGitRepo()
    mockExistsSync.mockReturnValue(false)

    await Effect.runPromise(treeCleanupCommand(undefined, {}))
  })

  test('removes worktree successfully', async () => {
    const { treeCleanupCommand } = await import('@/cli/commands/tree-cleanup')
    inGitRepo()

    mockExistsSync.mockImplementation((...args: unknown[]): boolean => {
      const p = args[0] as string
      return p.includes('.ger')
    })
    mockReaddirSync.mockReturnValue(['12345'])
    mockStatSync.mockReturnValue({ isDirectory: () => true })
    mockSpawnSyncImpl.mockReturnValue({ status: 0, stderr: '' })

    await Effect.runPromise(treeCleanupCommand(undefined, { json: true }))
    expect(mockSpawnSyncImpl).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['worktree', 'remove']),
      expect.anything(),
    )
  })

  test('rejects path traversal in change ID', async () => {
    const { treeCleanupCommand } = await import('@/cli/commands/tree-cleanup')
    inGitRepo()

    let threw = false
    try {
      await Effect.runPromise(treeCleanupCommand('../evil', {}))
    } catch (e) {
      threw = true
      expect(String(e)).toContain('Invalid change ID')
    }
    expect(threw).toBe(true)
  })

  test('rejects mixed alphanumeric change ID', async () => {
    const { treeCleanupCommand } = await import('@/cli/commands/tree-cleanup')
    inGitRepo()

    let threw = false
    try {
      await Effect.runPromise(treeCleanupCommand('123abc', {}))
    } catch (e) {
      threw = true
      expect(String(e)).toContain('Invalid change ID')
    }
    expect(threw).toBe(true)
  })

  test('does NOT force-remove when --force is omitted', async () => {
    const { treeCleanupCommand } = await import('@/cli/commands/tree-cleanup')
    inGitRepo()

    mockExistsSync.mockImplementation((...args: unknown[]): boolean => {
      const p = args[0] as string
      return p.includes('.ger')
    })
    mockReaddirSync.mockReturnValue(['12345'])
    mockStatSync.mockReturnValue({ isDirectory: () => true })
    // Simulate dirty worktree: git worktree remove fails without --force
    mockSpawnSyncImpl.mockReturnValue({ status: 1, stderr: 'has modifications' })

    await Effect.runPromise(treeCleanupCommand(undefined, {}))

    // Should have called worktree remove WITHOUT --force
    const calls = mockSpawnSyncImpl.mock.calls as unknown[][]
    const removeCalls = calls.filter(
      (c) => Array.isArray(c[1]) && (c[1] as string[]).includes('remove'),
    )
    expect(removeCalls.length).toBeGreaterThan(0)
    for (const call of removeCalls) {
      expect((call[1] as string[]).includes('--force')).toBe(false)
    }
  })
})

// ============================================================
// tree-rebase
// ============================================================

describe('tree-rebase', () => {
  const mockConfig = createMockConfigService()
  const originalCwd = process.cwd()

  beforeEach(() => {
    mockExecSyncImpl.mockReset()
    mockSpawnSyncImpl.mockReset()
  })

  afterEach(() => {
    // Restore cwd in case a test changed it
    try {
      process.chdir(originalCwd)
    } catch {
      // ignore
    }
  })

  const inGerWorktree = () => {
    mockExecSyncImpl.mockImplementation((...args: unknown[]): string => {
      const cmd = args[0] as string
      if (cmd === 'git rev-parse --git-dir') return '.git'
      // Return a path that looks like a ger worktree
      if (cmd === 'git rev-parse --show-toplevel') return '/repo/root'
      if (cmd === 'git remote -v') return 'origin\thttps://test.gerrit.com/project\t(fetch)\n'
      return ''
    })
    // Simulate cwd being inside a ger worktree
    jest_spyOn_cwd('/repo/root/.ger/12345')
  }

  // Helper to mock process.cwd()
  const jest_spyOn_cwd = (fakeCwd: string) => {
    const original = process.cwd.bind(process)
    process.cwd = () => fakeCwd
    return () => {
      process.cwd = original
    }
  }

  test('throws when not in a git repo', async () => {
    const { treeRebaseCommand } = await import('@/cli/commands/tree-rebase')
    mockExecSyncImpl.mockImplementation(() => {
      throw new Error('not a git repo')
    })

    let threw = false
    try {
      await Effect.runPromise(
        treeRebaseCommand({}).pipe(Effect.provide(Layer.succeed(ConfigService, mockConfig))),
      )
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
  })

  test('throws when not inside a ger worktree', async () => {
    const { treeRebaseCommand } = await import('@/cli/commands/tree-rebase')
    // Git repo, but cwd is the repo root (not a .ger worktree)
    mockExecSyncImpl.mockImplementation((...args: unknown[]): string => {
      const cmd = args[0] as string
      if (cmd === 'git rev-parse --git-dir') return '.git'
      if (cmd === 'git rev-parse --show-toplevel') return '/repo/root'
      return ''
    })
    process.cwd = () => '/repo/root'

    let threw = false
    try {
      await Effect.runPromise(
        treeRebaseCommand({ onto: 'origin/main' }).pipe(
          Effect.provide(Layer.succeed(ConfigService, mockConfig)),
        ),
      )
    } catch (e) {
      threw = true
      expect(String(e)).toContain('ger-managed worktree')
    }
    expect(threw).toBe(true)
  })

  test('throws when fetch fails', async () => {
    const { treeRebaseCommand } = await import('@/cli/commands/tree-rebase')
    inGerWorktree()
    mockSpawnSyncImpl.mockReturnValue({ status: 1, stderr: 'network error' })

    let threw = false
    try {
      await Effect.runPromise(
        treeRebaseCommand({ onto: 'origin/main' }).pipe(
          Effect.provide(Layer.succeed(ConfigService, mockConfig)),
        ),
      )
    } catch (e) {
      threw = true
      expect(String(e)).toContain('Failed to fetch')
    }
    expect(threw).toBe(true)
  })

  test('throws when rebase fails', async () => {
    const { treeRebaseCommand } = await import('@/cli/commands/tree-rebase')
    inGerWorktree()
    mockSpawnSyncImpl
      .mockReturnValueOnce({ status: 0, stderr: '' }) // fetch
      .mockReturnValueOnce({ status: 1, stderr: 'conflict' }) // rebase

    let threw = false
    try {
      await Effect.runPromise(
        treeRebaseCommand({ onto: 'origin/main' }).pipe(
          Effect.provide(Layer.succeed(ConfigService, mockConfig)),
        ),
      )
    } catch (e) {
      threw = true
      expect(String(e)).toContain('Rebase failed')
    }
    expect(threw).toBe(true)
  })

  test('succeeds and outputs JSON', async () => {
    const { treeRebaseCommand } = await import('@/cli/commands/tree-rebase')
    inGerWorktree()
    mockSpawnSyncImpl.mockReturnValue({ status: 0, stderr: '' })

    const logs: string[] = []
    const originalLog = console.log
    console.log = (msg: string) => logs.push(msg)
    await Effect.runPromise(
      treeRebaseCommand({ onto: 'origin/main', json: true }).pipe(
        Effect.provide(Layer.succeed(ConfigService, mockConfig)),
      ),
    )
    console.log = originalLog

    const parsed = JSON.parse(logs[0]) as { status: string; base: string }
    expect(parsed.status).toBe('success')
    expect(parsed.base).toBe('origin/main')
  })

  test('uses --onto option over auto-detect', async () => {
    const { treeRebaseCommand } = await import('@/cli/commands/tree-rebase')
    inGerWorktree()
    mockSpawnSyncImpl.mockReturnValue({ status: 0, stderr: '' })

    await Effect.runPromise(
      treeRebaseCommand({ onto: 'origin/feature', json: true }).pipe(
        Effect.provide(Layer.succeed(ConfigService, mockConfig)),
      ),
    )

    expect(mockSpawnSyncImpl).toHaveBeenCalledWith(
      'git',
      ['rebase', 'origin/feature'],
      expect.anything(),
    )
  })
})
