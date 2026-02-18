import { Effect, Context, Layer, Console, pipe } from 'effect'
import { Schema } from 'effect'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execSync, spawnSync } from 'node:child_process'
import { ConfigService, type ConfigServiceImpl } from '@/services/config'

// Error types
//
// NOTE: The `as unknown` casts below are a workaround for Effect Schema's TaggedError
// type inference limitations. Schema.TaggedError returns a complex union type that
// doesn't directly satisfy the class extension pattern we need. The cast allows us
// to extend the schema as a class while maintaining the tagged error behavior.
// This pattern is used consistently across the codebase for Effect Schema errors.
// See: https://effect.website/docs/schema/basic-usage#tagged-errors

export interface HookInstallErrorFields {
  readonly message: string
  readonly cause?: unknown
}

const HookInstallErrorSchema = Schema.TaggedError<HookInstallErrorFields>()('HookInstallError', {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) as unknown

export class HookInstallError
  extends (HookInstallErrorSchema as new (
    args: HookInstallErrorFields,
  ) => HookInstallErrorFields & Error & { readonly _tag: 'HookInstallError' })
  implements Error
{
  readonly name = 'HookInstallError'
}

export interface MissingChangeIdErrorFields {
  readonly message: string
}

const MissingChangeIdErrorSchema = Schema.TaggedError<MissingChangeIdErrorFields>()(
  'MissingChangeIdError',
  {
    message: Schema.String,
  },
) as unknown

export class MissingChangeIdError
  extends (MissingChangeIdErrorSchema as new (
    args: MissingChangeIdErrorFields,
  ) => MissingChangeIdErrorFields & Error & { readonly _tag: 'MissingChangeIdError' })
  implements Error
{
  readonly name = 'MissingChangeIdError'
}

export interface NotGitRepoErrorFields {
  readonly message: string
}

const NotGitRepoErrorSchema = Schema.TaggedError<NotGitRepoErrorFields>()('NotGitRepoError', {
  message: Schema.String,
}) as unknown

export class NotGitRepoError
  extends (NotGitRepoErrorSchema as new (
    args: NotGitRepoErrorFields,
  ) => NotGitRepoErrorFields & Error & { readonly _tag: 'NotGitRepoError' })
  implements Error
{
  readonly name = 'NotGitRepoError'
}

export type CommitHookError = HookInstallError | MissingChangeIdError | NotGitRepoError

/** Regex pattern to match Gerrit Change-Id in commit messages */
export const CHANGE_ID_PATTERN: RegExp = /^Change-Id: I[0-9a-f]{40}$/m

// Get .git directory path (handles both regular repos and worktrees)
export const getGitDir = (): string => {
  try {
    return execSync('git rev-parse --git-dir', { encoding: 'utf8' }).trim()
  } catch {
    throw new Error('Not in a git repository')
  }
}

// Get absolute .git directory path
export const getGitDirAbsolute = (): string => {
  try {
    return execSync('git rev-parse --absolute-git-dir', { encoding: 'utf8' }).trim()
  } catch {
    throw new Error('Not in a git repository')
  }
}

// Check if commit-msg hook exists and is executable
export const hasCommitMsgHook = (): boolean => {
  try {
    const gitDir = getGitDir()
    const hookPath = path.join(gitDir, 'hooks', 'commit-msg')

    if (!fs.existsSync(hookPath)) {
      return false
    }

    // Check if file is executable
    const stats = fs.statSync(hookPath)
    // Check owner execute bit (0o100)
    return (stats.mode & 0o100) !== 0
  } catch {
    return false
  }
}

// Check if a commit has a Change-Id in its message
export const commitHasChangeId = (commit: string = 'HEAD'): boolean => {
  try {
    const result = spawnSync('git', ['log', '-1', '--format=%B', commit], { encoding: 'utf8' })
    if (result.status !== 0) {
      return false
    }
    return CHANGE_ID_PATTERN.test(result.stdout)
  } catch {
    return false
  }
}

// Get the hooks directory path
export const getHooksDir = (): string => {
  const gitDir = getGitDir()
  return path.join(gitDir, 'hooks')
}

// Service interface
export interface CommitHookServiceImpl {
  readonly hasHook: () => Effect.Effect<boolean, NotGitRepoError>
  readonly hasChangeId: (commit?: string) => Effect.Effect<boolean, NotGitRepoError>
  readonly installHook: (
    quiet?: boolean,
  ) => Effect.Effect<void, HookInstallError | NotGitRepoError, ConfigServiceImpl>
  readonly ensureChangeId: () => Effect.Effect<
    void,
    HookInstallError | MissingChangeIdError | NotGitRepoError,
    ConfigServiceImpl
  >
  readonly amendWithChangeId: () => Effect.Effect<void, HookInstallError | NotGitRepoError>
}

const CommitHookServiceImplLive: CommitHookServiceImpl = {
  hasHook: () =>
    Effect.try({
      try: () => hasCommitMsgHook(),
      catch: () => new NotGitRepoError({ message: 'Not in a git repository' }),
    }),

  hasChangeId: (commit = 'HEAD') =>
    Effect.try({
      try: () => commitHasChangeId(commit),
      catch: () => new NotGitRepoError({ message: 'Not in a git repository' }),
    }),

  installHook: (quiet = false) =>
    Effect.gen(function* () {
      const configService = yield* ConfigService

      // Get config to find Gerrit host
      const config = yield* pipe(
        configService.getCredentials,
        Effect.mapError(
          (e) => new HookInstallError({ message: `Failed to get config: ${e.message}` }),
        ),
      )

      // Try to get hook via HTTP first (most reliable)
      const normalizedHost = config.host.replace(/\/$/, '')
      const hookUrl = `${normalizedHost}/tools/hooks/commit-msg`

      if (!quiet) yield* Console.log(`Installing commit-msg hook from ${config.host}...`)

      const hookContent = yield* Effect.tryPromise({
        try: async () => {
          const response = await fetch(hookUrl)
          if (!response.ok) {
            throw new Error(`Failed to fetch hook: ${response.status} ${response.statusText}`)
          }
          return response.text()
        },
        catch: (error) =>
          new HookInstallError({
            message: `Failed to download commit-msg hook from ${hookUrl}: ${error}`,
            cause: error,
          }),
      })

      // Validate hook content (should be a shell script)
      if (!hookContent.startsWith('#!')) {
        yield* Effect.fail(
          new HookInstallError({
            message: 'Downloaded hook does not appear to be a valid script',
          }),
        )
      }

      // Get hooks directory and ensure it exists
      const hooksDir = yield* Effect.try({
        try: () => getHooksDir(),
        catch: () => new NotGitRepoError({ message: 'Not in a git repository' }),
      })

      yield* Effect.try({
        try: () => {
          if (!fs.existsSync(hooksDir)) {
            fs.mkdirSync(hooksDir, { recursive: true })
          }
        },
        catch: (error) =>
          new HookInstallError({
            message: `Failed to create hooks directory: ${error}`,
            cause: error,
          }),
      })

      // Write hook file
      const hookPath = path.join(hooksDir, 'commit-msg')

      yield* Effect.try({
        try: () => {
          fs.writeFileSync(hookPath, hookContent, { mode: 0o755 })
        },
        catch: (error) =>
          new HookInstallError({
            message: `Failed to write commit-msg hook: ${error}`,
            cause: error,
          }),
      })

      if (!quiet) yield* Console.log('commit-msg hook installed successfully')
    }),

  ensureChangeId: () =>
    Effect.gen(function* () {
      // Check if HEAD already has a Change-Id (using pure function directly)
      if (commitHasChangeId()) {
        return
      }

      // Check if hook is installed (using pure function directly)
      if (!hasCommitMsgHook()) {
        // Install hook and amend commit
        yield* CommitHookServiceImplLive.installHook()
        yield* CommitHookServiceImplLive.amendWithChangeId()
      } else {
        // Hook exists but commit doesn't have Change-Id
        // This means the commit was created without the hook or hook failed
        yield* Effect.fail(
          new MissingChangeIdError({
            message:
              'Commit is missing Change-Id. The commit-msg hook is installed but did not run.\n' +
              'Please amend your commit: git commit --amend',
          }),
        )
      }
    }),

  amendWithChangeId: () =>
    Effect.gen(function* () {
      yield* Console.log('Amending commit to add Change-Id...')

      yield* Effect.try({
        try: () => {
          // Use --no-edit to keep the same message, hook will add Change-Id
          const result = spawnSync('git', ['commit', '--amend', '--no-edit'], {
            encoding: 'utf8',
            stdio: ['inherit', 'pipe', 'pipe'],
          })

          if (result.status !== 0) {
            throw new Error(result.stderr || 'git commit --amend failed')
          }
        },
        catch: (error) =>
          new HookInstallError({
            message: `Failed to amend commit: ${error}`,
            cause: error,
          }),
      })

      // Verify Change-Id was added
      const hasId = commitHasChangeId()
      if (!hasId) {
        yield* Effect.fail(
          new HookInstallError({
            message: 'Failed to add Change-Id to commit. Hook may not be working correctly.',
          }),
        )
      }

      yield* Console.log('Change-Id added to commit')
    }),
}

// Export service tag
export const CommitHookService: Context.Tag<CommitHookServiceImpl, CommitHookServiceImpl> =
  Context.GenericTag<CommitHookServiceImpl>('CommitHookService')

export type CommitHookService = Context.Tag.Identifier<typeof CommitHookService>

// Export service layer
export const CommitHookServiceLive: Layer.Layer<CommitHookServiceImpl> = Layer.succeed(
  CommitHookService,
  CommitHookServiceImplLive,
)
