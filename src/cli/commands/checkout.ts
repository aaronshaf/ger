import { execSync } from 'node:child_process'
import { Console, Effect, Schema } from 'effect'
import chalk from 'chalk'
import { ConfigService, type ConfigError, type ConfigServiceImpl } from '@/services/config'
import { GerritApiService, type ApiError, type GerritApiServiceImpl } from '@/api/gerrit'
import { extractChangeNumber } from '@/utils/url-parser'

/** Help text for checkout command */
export const CHECKOUT_HELP_TEXT = `
Examples:
  # Checkout latest patchset
  $ ger checkout 12345

  # Checkout specific patchset
  $ ger checkout 12345/3

  # Checkout by Change-ID
  $ ger checkout If5a3ae8cb5a107e187447802358417f311d0c4b1

  # Checkout from URL
  $ ger checkout https://gerrit.example.com/c/my-project/+/392385

  # Detached HEAD mode (for quick review)
  $ ger checkout 12345 --detach

  # Use specific remote
  $ ger checkout 12345 --remote upstream

Notes:
  - Creates/updates branch named review/<change-number>
  - Sets upstream tracking to target branch
  - Updates existing review branch if it exists`

export interface CheckoutOptions {
  detach?: boolean
  remote?: string
}

// Custom error for checkout-specific failures
export class CheckoutError extends Error {
  readonly _tag = 'CheckoutError'
  constructor(message: string) {
    super(message)
    this.name = 'CheckoutError'
  }
}

export class NotGitRepoError extends Error {
  readonly _tag = 'NotGitRepoError'
  constructor(message: string) {
    super(message)
    this.name = 'NotGitRepoError'
  }
}

export class PatchsetNotFoundError extends Error {
  readonly _tag = 'PatchsetNotFoundError'
  constructor(public readonly patchset: number) {
    super(`Patchset ${patchset} not found`)
    this.name = 'PatchsetNotFoundError'
  }
}

export class InvalidInputError extends Error {
  readonly _tag = 'InvalidInputError'
  constructor(message: string) {
    super(message)
    this.name = 'InvalidInputError'
  }
}

export type CheckoutErrors =
  | ConfigError
  | CheckoutError
  | NotGitRepoError
  | PatchsetNotFoundError
  | ApiError
  | InvalidInputError

// Git-safe string validation - prevents command injection
// Allows alphanumeric, hyphens, underscores, slashes, and dots
const GitSafeString = Schema.String.pipe(
  Schema.pattern(/^[a-zA-Z0-9_\-/.]+$/),
  Schema.annotations({ message: () => 'Invalid characters in git identifier' }),
)

// Gerrit ref validation (refs/changes/xx/xxxxx/x)
const GerritRef = Schema.String.pipe(
  Schema.pattern(/^refs\/changes\/\d{2}\/\d+\/\d+$/),
  Schema.annotations({ message: () => 'Invalid Gerrit ref format' }),
)

// Validate git-safe strings to prevent command injection
const validateGitSafe = (
  value: string,
  fieldName: string,
): Effect.Effect<string, InvalidInputError> =>
  Schema.decodeUnknown(GitSafeString)(value).pipe(
    Effect.mapError(() => {
      // Sanitize error message to avoid exposing potentially sensitive data
      const sanitized = value.length > 20 ? `${value.substring(0, 20)}...` : value
      return new InvalidInputError(`${fieldName} contains invalid characters: ${sanitized}`)
    }),
  )

const validateGerritRef = (value: string): Effect.Effect<string, InvalidInputError> =>
  Schema.decodeUnknown(GerritRef)(value).pipe(
    Effect.mapError(() => {
      // Sanitize error message to avoid exposing potentially sensitive data
      const sanitized = value.length > 30 ? `${value.substring(0, 30)}...` : value
      return new InvalidInputError(`Invalid Gerrit ref format: ${sanitized}`)
    }),
  )

/** Parse change input to extract change ID and optional patchset */
interface ParsedChange {
  changeId: string
  patchset?: number
}

export const parseChangeInput = (input: string): ParsedChange => {
  const trimmed = input.trim()

  // 1. If it's a URL, extract change number and check for patchset
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    const changeId = extractChangeNumber(trimmed)

    // Try to extract patchset from URL path: /c/project/+/12345/3
    const patchsetMatch = trimmed.match(/\/(\d+)\/(\d+)(?:\/|$)/)
    if (patchsetMatch?.[2]) {
      return {
        changeId: patchsetMatch[1],
        patchset: parseInt(patchsetMatch[2], 10),
      }
    }

    return { changeId }
  }

  // 2. Check for change/patchset format: 12345/3
  if (trimmed.includes('/') && !trimmed.startsWith('http')) {
    const parts = trimmed.split('/')
    if (parts.length === 2) {
      const [changeId, patchsetStr] = parts
      const patchset = parseInt(patchsetStr, 10)

      if (!Number.isNaN(patchset) && patchset > 0) {
        return { changeId, patchset }
      }
      // If patchset is invalid, just return the changeId part
      return { changeId }
    }
  }

  // 3. Plain change number or Change-ID
  return { changeId: trimmed }
}

// Get git remotes
const getGitRemotes = (): Record<string, string> => {
  try {
    const output = execSync('git remote -v', { encoding: 'utf8', timeout: 5000 })
    const remotes: Record<string, string> = {}

    for (const line of output.split('\n')) {
      const match = line.match(/^(\S+)\s+(\S+)\s+\(push\)$/)
      if (match) {
        remotes[match[1]] = match[2]
      }
    }

    return remotes
  } catch {
    // Silently return empty object - remote detection is optional
    return {}
  }
}

// Find remote matching Gerrit host
const findMatchingRemote = (gerritHost: string): string | null => {
  const remotes = getGitRemotes()

  // Parse gerrit host
  const gerritUrl = new URL(gerritHost)
  const gerritHostname = gerritUrl.hostname

  // Check each remote
  for (const [name, url] of Object.entries(remotes)) {
    try {
      let remoteHostname: string

      if (url.startsWith('git@') || url.includes('://')) {
        if (url.startsWith('git@')) {
          // SSH format: git@hostname:project
          remoteHostname = url.split('@')[1].split(':')[0]
        } else {
          // HTTP format
          const remoteUrl = new URL(url)
          remoteHostname = remoteUrl.hostname
        }

        if (remoteHostname === gerritHostname) {
          return name
        }
      }
    } catch {
      // Ignore malformed URLs
    }
  }

  return null
}

// Check if we're in a git repo
const isInGitRepo = (): boolean => {
  try {
    execSync('git rev-parse --git-dir', { encoding: 'utf8', timeout: 5000 })
    return true
  } catch {
    return false
  }
}

// Get current branch name
const getCurrentBranch = (): string | null => {
  try {
    const branch = execSync('git symbolic-ref --short HEAD', {
      encoding: 'utf8',
      timeout: 5000,
    }).trim()
    return branch || null
  } catch {
    return null
  }
}

// Check if a local branch exists (internal helper using Effect pattern)
const localBranchExists = (branchName: string): Effect.Effect<boolean, InvalidInputError> =>
  validateGitSafe(branchName, 'branch name').pipe(
    Effect.flatMap((validated) =>
      Effect.sync(() => {
        try {
          execSync(`git rev-parse --verify ${validated}`, {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 5000,
          })
          return true
        } catch {
          // Branch doesn't exist is expected, return false
          return false
        }
      }),
    ),
  )

export const checkoutCommand = (
  changeInput: string,
  options: CheckoutOptions,
): Effect.Effect<void, CheckoutErrors, ConfigServiceImpl | GerritApiServiceImpl> =>
  Effect.gen(function* () {
    // 1. Parse input
    const parsed = parseChangeInput(changeInput)

    // 2. Verify git repo
    if (!isInGitRepo()) {
      return yield* Effect.fail(new NotGitRepoError('Not in a git repository'))
    }

    // 3. Get config and API service
    const configService = yield* ConfigService
    const apiService = yield* GerritApiService
    const credentials = yield* configService.getCredentials

    // 4. Get change details
    const change = yield* apiService.getChange(parsed.changeId)

    // 5. Get revision details - use from change if available, otherwise fetch separately
    const revision = yield* Effect.gen(function* () {
      // If requesting a specific patchset, always fetch it
      if (parsed.patchset) {
        const patchsetNum = parsed.patchset
        if (patchsetNum === undefined) {
          return yield* Effect.fail(
            new InvalidInputError('Patchset number is required but was undefined'),
          )
        }
        return yield* apiService
          .getRevision(parsed.changeId, patchsetNum.toString())
          .pipe(Effect.catchAll(() => Effect.fail(new PatchsetNotFoundError(patchsetNum))))
      }

      // For current revision, use it from change response if available
      if (change.current_revision && change.revisions) {
        const currentRevision = change.revisions[change.current_revision]
        if (currentRevision) {
          return currentRevision
        }
      }

      // Fallback to fetching revision separately
      return yield* apiService.getRevision(parsed.changeId, 'current')
    })

    // 6. Validate inputs before using in shell commands
    const validatedRef = yield* validateGerritRef(revision.ref)

    // 7. Find matching remote and validate
    const rawRemote = options.remote || findMatchingRemote(credentials.host) || 'origin'
    const remote = yield* validateGitSafe(rawRemote, 'remote')

    // 8. Determine branch name and validate
    const rawBranchName = `review/${change._number}`
    const branchName = yield* validateGitSafe(rawBranchName, 'branch name')
    const currentBranch = getCurrentBranch()
    const branchExists = yield* localBranchExists(branchName)

    // 9. Validate target branch for upstream tracking
    const targetBranch = yield* validateGitSafe(change.branch, 'target branch')

    // 10. Display information
    yield* Console.log(chalk.bold('Checking out Gerrit change'))
    yield* Console.log(`  Change: ${change._number} - ${change.subject}`)
    yield* Console.log(`  Patchset: ${revision._number}`)
    yield* Console.log(`  Status: ${change.status}`)
    yield* Console.log(`  Branch: ${branchName}`)
    yield* Console.log(`  Remote: ${remote}`)
    yield* Console.log('')

    // 11. Fetch the change (using validated inputs)
    yield* Console.log(chalk.cyan(`Fetching ${validatedRef}...`))
    yield* Effect.try({
      try: () => {
        execSync(`git fetch ${remote} ${validatedRef}`, { stdio: 'inherit', timeout: 60000 })
      },
      catch: (e) => {
        const errorMsg = e instanceof Error ? e.message : String(e)
        return new CheckoutError(`Failed to fetch change from remote: ${errorMsg}`)
      },
    })

    // 12. Checkout/update branch
    if (options.detach) {
      // Detached HEAD mode
      yield* Effect.try({
        try: () => {
          execSync('git checkout FETCH_HEAD', { stdio: 'inherit', timeout: 30000 })
        },
        catch: (e) => {
          const errorMsg = e instanceof Error ? e.message : String(e)
          return new CheckoutError(`Failed to checkout in detached HEAD mode: ${errorMsg}`)
        },
      })
      yield* Console.log(chalk.green('Checked out in detached HEAD mode'))
    } else {
      // Named branch mode
      if (branchExists) {
        // Update existing branch
        if (currentBranch !== branchName) {
          yield* Effect.try({
            try: () => {
              execSync(`git checkout ${branchName}`, { stdio: 'inherit', timeout: 30000 })
            },
            catch: (e) => {
              const errorMsg = e instanceof Error ? e.message : String(e)
              return new CheckoutError(`Failed to switch to branch: ${errorMsg}`)
            },
          })
        }
        yield* Effect.try({
          try: () => {
            execSync('git reset --hard FETCH_HEAD', { stdio: 'inherit', timeout: 30000 })
          },
          catch: (e) => {
            const errorMsg = e instanceof Error ? e.message : String(e)
            return new CheckoutError(`Failed to update branch: ${errorMsg}`)
          },
        })
        yield* Console.log(chalk.green(`Updated and checked out ${branchName}`))
      } else {
        // Create new branch
        yield* Effect.try({
          try: () => {
            execSync(`git checkout -b ${branchName} FETCH_HEAD`, {
              stdio: 'inherit',
              timeout: 30000,
            })
          },
          catch: (e) => {
            const errorMsg = e instanceof Error ? e.message : String(e)
            return new CheckoutError(`Failed to create branch: ${errorMsg}`)
          },
        })
        yield* Console.log(chalk.green(`Created and checked out ${branchName}`))
      }

      // 13. Set upstream tracking
      const upstreamRef = `${remote}/${targetBranch}`
      yield* Effect.try({
        try: () => {
          execSync(`git branch --set-upstream-to=${upstreamRef} ${branchName}`, {
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 10000,
          })
        },
        catch: (e) => {
          const errorMsg = e instanceof Error ? e.message : String(e)
          return new CheckoutError(`Failed to set upstream tracking: ${errorMsg}`)
        },
      }).pipe(
        Effect.flatMap(() => Console.log(`Tracking ${upstreamRef}`)),
        Effect.catchAll(() =>
          Console.log(chalk.yellow(`Note: Could not set upstream tracking to ${upstreamRef}`)),
        ),
      )
    }

    yield* Console.log('')
    yield* Console.log(
      chalk.cyan(`Change URL: ${credentials.host}/c/${change.project}/+/${change._number}`),
    )
  })
