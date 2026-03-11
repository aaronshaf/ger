import { execSync, spawnSync } from 'node:child_process'
import { Console, Effect, Schema } from 'effect'
import chalk from 'chalk'
import { ConfigService, type ConfigError, type ConfigServiceImpl } from '@/services/config'
import { GerritApiService, type ApiError, type GerritApiServiceImpl } from '@/api/gerrit'
import { extractChangeNumber } from '@/utils/url-parser'

export const CHERRY_HELP_TEXT = `
Examples:
  # Cherry-pick latest patchset
  $ ger cherry 12345

  # Cherry-pick a specific patchset
  $ ger cherry 12345/3

  # Cherry-pick by Change-ID
  $ ger cherry If5a3ae8cb5a107e187447802358417f311d0c4b1

  # Cherry-pick from URL
  $ ger cherry https://gerrit.example.com/c/my-project/+/12345

  # Stage changes without committing
  $ ger cherry 12345 --no-commit

  # Use a specific remote
  $ ger cherry 12345 --remote upstream

Notes:
  - Fetches the change then runs git cherry-pick FETCH_HEAD
  - Use --no-commit to stage without committing (git cherry-pick -n)`

export interface CherryOptions {
  noCommit?: boolean
  remote?: string
  noVerify?: boolean
}

class CherryError extends Error {
  readonly _tag = 'CherryError' as const
  constructor(message: string) {
    super(message)
    this.name = 'CherryError'
  }
}

class NotGitRepoError extends Error {
  readonly _tag = 'NotGitRepoError' as const
  constructor(message: string) {
    super(message)
    this.name = 'NotGitRepoError'
  }
}

class PatchsetNotFoundError extends Error {
  readonly _tag = 'PatchsetNotFoundError' as const
  constructor(public readonly patchset: number) {
    super(`Patchset ${patchset} not found`)
    this.name = 'PatchsetNotFoundError'
  }
}

class InvalidInputError extends Error {
  readonly _tag = 'InvalidInputError' as const
  constructor(message: string) {
    super(message)
    this.name = 'InvalidInputError'
  }
}

export type CherryErrors =
  | ConfigError
  | ApiError
  | CherryError
  | NotGitRepoError
  | PatchsetNotFoundError
  | InvalidInputError

// Git-safe string validation — prevents command injection
const GitSafeString = Schema.String.pipe(
  Schema.pattern(/^[a-zA-Z0-9_\-/.]+$/),
  Schema.annotations({ message: () => 'Invalid characters in git identifier' }),
)

// Gerrit ref validation (refs/changes/xx/xxxxx/x)
const GerritRef = Schema.String.pipe(
  Schema.pattern(/^refs\/changes\/\d{2}\/\d+\/\d+$/),
  Schema.annotations({ message: () => 'Invalid Gerrit ref format' }),
)

const validateGitSafe = (
  value: string,
  fieldName: string,
): Effect.Effect<string, InvalidInputError> =>
  Schema.decodeUnknown(GitSafeString)(value).pipe(
    Effect.mapError(() => {
      const sanitized = value.length > 20 ? `${value.substring(0, 20)}...` : value
      return new InvalidInputError(`${fieldName} contains invalid characters: ${sanitized}`)
    }),
  )

const validateGerritRef = (value: string): Effect.Effect<string, InvalidInputError> =>
  Schema.decodeUnknown(GerritRef)(value).pipe(
    Effect.mapError(() => {
      const sanitized = value.length > 30 ? `${value.substring(0, 30)}...` : value
      return new InvalidInputError(`Invalid Gerrit ref format: ${sanitized}`)
    }),
  )

interface ParsedChange {
  changeId: string
  patchset?: number
}

const parseChangeInput = (input: string): ParsedChange => {
  const trimmed = input.trim()

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    const changeId = extractChangeNumber(trimmed)
    const patchsetMatch = trimmed.match(/\/\d+\/(\d+)(?:\/|$)/)
    if (patchsetMatch?.[1]) {
      return { changeId, patchset: parseInt(patchsetMatch[1], 10) }
    }
    return { changeId }
  }

  if (trimmed.includes('/') && !trimmed.startsWith('http')) {
    const parts = trimmed.split('/')
    if (parts.length === 2) {
      const [changeId, patchsetStr] = parts
      const patchset = parseInt(patchsetStr, 10)
      if (!Number.isNaN(patchset) && patchset > 0) {
        return { changeId, patchset }
      }
      return { changeId }
    }
  }

  return { changeId: trimmed }
}

const getGitRemotes = (): Record<string, string> => {
  try {
    const output = execSync('git remote -v', { encoding: 'utf8', timeout: 5000 })
    const remotes: Record<string, string> = {}
    for (const line of output.split('\n')) {
      const match = line.match(/^(\S+)\s+(\S+)\s+\(fetch\)$/)
      if (match) remotes[match[1]] = match[2]
    }
    return remotes
  } catch {
    return {}
  }
}

const findMatchingRemote = (gerritHost: string): string | null => {
  const remotes = getGitRemotes()
  const gerritHostname = new URL(gerritHost).hostname
  for (const [name, url] of Object.entries(remotes)) {
    try {
      let remoteHostname: string
      if (url.startsWith('git@')) {
        remoteHostname = url.split('@')[1].split(':')[0]
      } else if (url.includes('://')) {
        remoteHostname = new URL(url).hostname
      } else {
        continue
      }
      if (remoteHostname === gerritHostname) return name
    } catch {
      // ignore malformed URLs
    }
  }
  return null
}

const isInGitRepo = (): boolean => {
  try {
    execSync('git rev-parse --git-dir', { encoding: 'utf8', timeout: 5000 })
    return true
  } catch {
    return false
  }
}

export const cherryCommand = (
  changeInput: string,
  options: CherryOptions,
): Effect.Effect<void, CherryErrors, ConfigServiceImpl | GerritApiServiceImpl> =>
  Effect.gen(function* () {
    const parsed = parseChangeInput(changeInput)

    if (!isInGitRepo()) {
      return yield* Effect.fail(new NotGitRepoError('Not in a git repository'))
    }

    const configService = yield* ConfigService
    const apiService = yield* GerritApiService
    const credentials = yield* configService.getCredentials

    const change = yield* apiService.getChange(parsed.changeId)

    const revision = yield* Effect.gen(function* () {
      if (parsed.patchset !== undefined) {
        const patchsetNum = parsed.patchset
        return yield* apiService
          .getRevision(parsed.changeId, patchsetNum.toString())
          .pipe(Effect.catchAll(() => Effect.fail(new PatchsetNotFoundError(patchsetNum))))
      }

      if (change.current_revision && change.revisions) {
        const currentRevision = change.revisions[change.current_revision]
        if (currentRevision) return currentRevision
      }

      return yield* apiService.getRevision(parsed.changeId, 'current')
    })

    const validatedRef = yield* validateGerritRef(revision.ref)
    const rawRemote = options.remote ?? findMatchingRemote(credentials.host) ?? 'origin'
    const remote = yield* validateGitSafe(rawRemote, 'remote')

    yield* Console.log(chalk.bold('Cherry-picking Gerrit change'))
    yield* Console.log(`  Change:   ${chalk.cyan(String(change._number))} — ${change.subject}`)
    yield* Console.log(`  Patchset: ${revision._number}`)
    yield* Console.log(`  Branch:   ${change.branch}`)
    yield* Console.log(`  Remote:   ${remote}`)
    yield* Console.log('')

    yield* Console.log(chalk.dim(`Fetching ${validatedRef}...`))
    yield* Effect.try({
      try: () => {
        const result = spawnSync('git', ['fetch', remote, validatedRef], {
          stdio: 'inherit',
          timeout: 60000,
        })
        if (result.status !== 0) throw new Error(result.stderr?.toString() ?? 'fetch failed')
      },
      catch: (e) =>
        new CherryError(`Failed to fetch: ${e instanceof Error ? e.message : String(e)}`),
    })

    const cherryPickCmd = [
      'cherry-pick',
      ...(options.noCommit ? ['-n'] : []),
      ...(options.noVerify ? ['--no-verify'] : []),
      'FETCH_HEAD',
    ]
    yield* Console.log(
      chalk.dim(`Running git cherry-pick ${options.noCommit ? '-n ' : ''}FETCH_HEAD...`),
    )
    yield* Effect.try({
      try: () => {
        const result = spawnSync('git', cherryPickCmd, { stdio: 'inherit', timeout: 60000 })
        if (result.status !== 0) throw new Error(result.stderr?.toString() ?? 'cherry-pick failed')
      },
      catch: (e) =>
        new CherryError(`Cherry-pick failed: ${e instanceof Error ? e.message : String(e)}`),
    })

    yield* Console.log('')
    if (options.noCommit) {
      yield* Console.log(
        chalk.green('✓ Changes staged (not committed). Review then run git commit.'),
      )
    } else {
      yield* Console.log(chalk.green(`✓ Cherry-picked change ${change._number} successfully`))
    }
  })
