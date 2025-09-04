import { Effect, Console, pipe, Layer, Context } from 'effect'
import { Schema } from 'effect'
import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { spawn } from 'node:child_process'

// Error types
export class WorktreeCreationError extends Schema.TaggedError<WorktreeCreationError>()(
  'WorktreeCreationError',
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

export class PatchsetFetchError extends Schema.TaggedError<PatchsetFetchError>()(
  'PatchsetFetchError',
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

export class DirtyRepoError extends Schema.TaggedError<DirtyRepoError>()('DirtyRepoError', {
  message: Schema.String,
}) {}

export class NotGitRepoError extends Schema.TaggedError<NotGitRepoError>()('NotGitRepoError', {
  message: Schema.String,
}) {}

export type GitError = WorktreeCreationError | PatchsetFetchError | DirtyRepoError | NotGitRepoError

// Worktree info
export interface WorktreeInfo {
  path: string
  changeId: string
  originalCwd: string
  timestamp: number
  pid: number
}

// Git command runner with Effect
const runGitCommand = (
  args: string[],
  options: { cwd?: string } = {},
): Effect.Effect<string, GitError, never> =>
  Effect.async<string, GitError, never>((resume) => {
    const child = spawn('git', args, {
      cwd: options.cwd || process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (data) => {
      stdout += data.toString()
    })

    child.stderr?.on('data', (data) => {
      stderr += data.toString()
    })

    child.on('close', (code) => {
      if (code === 0) {
        resume(Effect.succeed(stdout.trim()))
      } else {
        const errorMessage = `Git command failed: git ${args.join(' ')}\nStderr: ${stderr}`

        // Classify error based on command and output
        if (args[0] === 'worktree' && args[1] === 'add') {
          resume(Effect.fail(new WorktreeCreationError({ message: errorMessage })))
        } else if (args[0] === 'fetch' || args[0] === 'checkout') {
          resume(Effect.fail(new PatchsetFetchError({ message: errorMessage })))
        } else {
          resume(Effect.fail(new WorktreeCreationError({ message: errorMessage })))
        }
      }
    })

    child.on('error', (error) => {
      resume(
        Effect.fail(
          new WorktreeCreationError({
            message: `Failed to spawn git: ${error.message}`,
            cause: error,
          }),
        ),
      )
    })
  })

// Check if current directory is a git repository
const validateGitRepo = (): Effect.Effect<void, NotGitRepoError, never> =>
  pipe(
    runGitCommand(['rev-parse', '--git-dir']),
    Effect.mapError(
      () => new NotGitRepoError({ message: 'Current directory is not a git repository' }),
    ),
    Effect.map(() => undefined),
  )

// Check if working directory is clean
const validateCleanRepo = (): Effect.Effect<void, DirtyRepoError, never> =>
  pipe(
    runGitCommand(['status', '--porcelain']),
    Effect.mapError(() => new DirtyRepoError({ message: 'Failed to check repository status' })),
    Effect.flatMap((output) =>
      output.trim() === ''
        ? Effect.succeed(undefined)
        : Effect.fail(
            new DirtyRepoError({
              message:
                'Working directory has uncommitted changes. Please commit or stash changes before review.',
            }),
          ),
    ),
  )

// Generate unique worktree path
const generateWorktreePath = (changeId: string): string => {
  const timestamp = Date.now()
  const pid = process.pid
  const uniqueId = `${changeId}-${timestamp}-${pid}`
  return path.join(os.homedir(), '.ger', 'worktrees', uniqueId)
}

// Ensure .ger directory exists
const ensureGerDirectory = (): Effect.Effect<void, never, never> =>
  Effect.tryPromise({
    try: async () => {
      const gerDir = path.join(os.homedir(), '.ger', 'worktrees')
      await fs.mkdir(gerDir, { recursive: true })
    },
    catch: () => undefined, // Ignore errors, will fail later if directory can't be created
  }).pipe(Effect.catchAll(() => Effect.succeed(undefined)))

// Build Gerrit refspec for change
const buildRefspec = (changeNumber: string, patchsetNumber: number = 1): string => {
  // Extract change number from changeId if it contains non-numeric characters
  const numericChangeNumber = changeNumber.replace(/\D/g, '')
  return `refs/changes/${numericChangeNumber.slice(-2)}/${numericChangeNumber}/${patchsetNumber}`
}

// Get the current HEAD commit hash to avoid branch conflicts
const getCurrentCommit = (): Effect.Effect<string, GitError, never> =>
  pipe(
    runGitCommand(['rev-parse', 'HEAD']),
    Effect.map((output) => output.trim()),
    Effect.catchAll(() =>
      // Fallback: try to get commit from default branch
      pipe(
        runGitCommand(['rev-parse', 'origin/main']),
        Effect.catchAll(() => runGitCommand(['rev-parse', 'origin/master'])),
        Effect.catchAll(() => Effect.succeed('HEAD')),
      ),
    ),
  )

// Get latest patchset number for a change
const getLatestPatchsetNumber = (
  changeId: string,
): Effect.Effect<number, PatchsetFetchError, never> =>
  pipe(
    runGitCommand(['ls-remote', 'origin', `refs/changes/*/${changeId.replace(/\D/g, '')}/*`]),
    Effect.mapError(
      (error) =>
        new PatchsetFetchError({ message: `Failed to get patchset info: ${error.message}` }),
    ),
    Effect.map((output) => {
      const lines = output.split('\n').filter((line) => line.trim())
      if (lines.length === 0) {
        return 1 // Default to patchset 1 if no refs found
      }

      // Extract patchset numbers and return the highest
      const patchsetNumbers = lines
        .map((line) => {
          const match = line.match(/refs\/changes\/\d+\/\d+\/(\d+)$/)
          return match ? parseInt(match[1], 10) : 0
        })
        .filter((num) => num > 0)

      return patchsetNumbers.length > 0 ? Math.max(...patchsetNumbers) : 1
    }),
  )

// GitWorktreeService implementation
export interface GitWorktreeServiceImpl {
  validatePreconditions: () => Effect.Effect<void, GitError, never>
  createWorktree: (changeId: string) => Effect.Effect<WorktreeInfo, GitError, never>
  fetchAndCheckoutPatchset: (worktreeInfo: WorktreeInfo) => Effect.Effect<void, GitError, never>
  cleanup: (worktreeInfo: WorktreeInfo) => Effect.Effect<void, never, never>
  getChangedFiles: () => Effect.Effect<string[], GitError, never>
}

const GitWorktreeServiceImplLive: GitWorktreeServiceImpl = {
  validatePreconditions: () =>
    Effect.gen(function* () {
      yield* validateGitRepo()
      yield* Console.log('✓ Git repository validation passed')
    }),

  createWorktree: (changeId: string) =>
    Effect.gen(function* () {
      yield* Console.log(`→ Creating worktree for change ${changeId}...`)

      // Get current commit hash to avoid branch conflicts
      const currentCommit = yield* getCurrentCommit()
      yield* Console.log(`→ Using base commit: ${currentCommit.substring(0, 7)}`)

      // Ensure .ger directory exists
      yield* ensureGerDirectory()

      // Generate unique path
      const worktreePath = generateWorktreePath(changeId)
      const originalCwd = process.cwd()

      // Create worktree using commit hash (no branch conflicts)
      yield* runGitCommand(['worktree', 'add', '--detach', worktreePath, currentCommit])

      const worktreeInfo: WorktreeInfo = {
        path: worktreePath,
        changeId,
        originalCwd,
        timestamp: Date.now(),
        pid: process.pid,
      }

      yield* Console.log(`✓ Worktree created at ${worktreePath}`)
      return worktreeInfo
    }),

  fetchAndCheckoutPatchset: (worktreeInfo: WorktreeInfo) =>
    Effect.gen(function* () {
      yield* Console.log(`→ Fetching and checking out patchset for ${worktreeInfo.changeId}...`)

      // Get latest patchset number
      const patchsetNumber = yield* getLatestPatchsetNumber(worktreeInfo.changeId)
      const refspec = buildRefspec(worktreeInfo.changeId, patchsetNumber)

      yield* Console.log(`→ Using refspec: ${refspec}`)

      // Fetch the change
      yield* runGitCommand(['fetch', 'origin', refspec], { cwd: worktreeInfo.path })

      // Checkout FETCH_HEAD
      yield* runGitCommand(['checkout', 'FETCH_HEAD'], { cwd: worktreeInfo.path })

      yield* Console.log(`✓ Checked out patchset ${patchsetNumber} for ${worktreeInfo.changeId}`)
    }),

  cleanup: (worktreeInfo: WorktreeInfo) =>
    Effect.gen(function* () {
      yield* Console.log(`→ Cleaning up worktree for ${worktreeInfo.changeId}...`)

      // Always restore original working directory first
      try {
        process.chdir(worktreeInfo.originalCwd)
      } catch (error) {
        yield* Console.warn(`Warning: Could not restore original directory: ${error}`)
      }

      // Attempt to remove worktree (don't fail if this doesn't work)
      yield* pipe(
        runGitCommand(['worktree', 'remove', '--force', worktreeInfo.path]),
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            yield* Console.warn(`Warning: Could not remove worktree: ${error.message}`)
            yield* Console.warn(`Manual cleanup may be required: ${worktreeInfo.path}`)
          }),
        ),
      )

      yield* Console.log(`✓ Cleanup completed for ${worktreeInfo.changeId}`)
    }),

  getChangedFiles: () =>
    Effect.gen(function* () {
      // Get list of changed files in current worktree
      const output = yield* runGitCommand(['diff', '--name-only', 'HEAD~1'])
      const files = output.split('\n').filter((file) => file.trim())
      return files
    }),
}

// Export service tag for dependency injection
export class GitWorktreeService extends Context.Tag('GitWorktreeService')<
  GitWorktreeService,
  GitWorktreeServiceImpl
>() {}

// Export service layer
export const GitWorktreeServiceLive = Layer.succeed(GitWorktreeService, GitWorktreeServiceImplLive)
