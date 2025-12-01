import { Effect, Schema } from 'effect'
import { type ApiError, GerritApiService } from '@/api/gerrit'
import type { MessageInfo } from '@/schemas/gerrit'
import { getChangeIdFromHead, GitError, NoChangeIdError } from '@/utils/git-commit'

// Export types for external use
export type BuildState = 'pending' | 'running' | 'success' | 'failure' | 'not_found'

// Watch options (matches gh run watch pattern)
export type WatchOptions = {
  readonly watch: boolean
  readonly interval: number // seconds
  readonly timeout: number // seconds
  readonly exitStatus: boolean
}

// Timeout error for watch mode
export class TimeoutError extends Error {
  readonly _tag = 'TimeoutError'
  constructor(message: string) {
    super(message)
    this.name = 'TimeoutError'
  }
}

// Effect Schema for BuildStatus (follows project patterns)
export const BuildStatus: Schema.Schema<{
  readonly state: 'pending' | 'running' | 'success' | 'failure' | 'not_found'
}> = Schema.Struct({
  state: Schema.Literal('pending', 'running', 'success', 'failure', 'not_found'),
})
export type BuildStatus = Schema.Schema.Type<typeof BuildStatus>

// Message patterns for precise matching
const BUILD_STARTED_PATTERN = /Build\s+Started/i
const VERIFIED_PLUS_PATTERN = /Verified\s*[+]\s*1/
const VERIFIED_MINUS_PATTERN = /Verified\s*[-]\s*1/

/**
 * Parse messages to determine build status based on "Build Started" and verification messages
 */
const parseBuildStatus = (messages: readonly MessageInfo[]): BuildStatus => {
  // Empty messages means change exists but has no activity yet - return pending
  if (messages.length === 0) {
    return { state: 'pending' }
  }

  // Find the most recent "Build Started" message
  let lastBuildDate: string | null = null
  for (const msg of messages) {
    if (BUILD_STARTED_PATTERN.test(msg.message)) {
      lastBuildDate = msg.date
    }
  }

  // If no build has started, state is "pending"
  if (!lastBuildDate) {
    return { state: 'pending' }
  }

  // Check for verification messages after the build started
  for (const msg of messages) {
    const date = msg.date
    // Gerrit timestamps are ISO 8601 strings (lexicographically sortable)
    if (date <= lastBuildDate) continue

    if (VERIFIED_PLUS_PATTERN.test(msg.message)) {
      return { state: 'success' }
    } else if (VERIFIED_MINUS_PATTERN.test(msg.message)) {
      return { state: 'failure' }
    }
  }

  // Build started but no verification yet, state is "running"
  return { state: 'running' }
}

/**
 * Get messages for a change
 */
const getMessagesForChange = (
  changeId: string,
): Effect.Effect<readonly MessageInfo[], ApiError, GerritApiService> =>
  Effect.gen(function* () {
    const gerritApi = yield* GerritApiService
    const messages = yield* gerritApi.getMessages(changeId)
    return messages
  })

/**
 * Poll build status until terminal state or timeout
 * Outputs JSON status on each iteration (mimics gh run watch)
 */
const pollBuildStatus = (
  changeId: string,
  options: WatchOptions,
): Effect.Effect<BuildStatus, ApiError | TimeoutError, GerritApiService> =>
  Effect.gen(function* () {
    const startTime = Date.now()
    const timeoutMs = options.timeout * 1000

    // Initial message to stderr
    yield* Effect.sync(() => {
      console.error(
        `Watching build status (polling every ${options.interval}s, timeout: ${options.timeout}s)...`,
      )
    })

    while (true) {
      // Check timeout
      const elapsed = Date.now() - startTime
      if (elapsed > timeoutMs) {
        yield* Effect.sync(() => {
          console.error(`Timeout: Build status check exceeded ${options.timeout}s`)
        })
        yield* Effect.fail(
          new TimeoutError(`Build status check timed out after ${options.timeout}s`),
        )
      }

      // Fetch and parse status
      const messages = yield* getMessagesForChange(changeId)
      const status = parseBuildStatus(messages)

      // Check timeout again after API call (in case it took longer than expected)
      const elapsedAfterFetch = Date.now() - startTime
      if (elapsedAfterFetch > timeoutMs) {
        yield* Effect.sync(() => {
          console.error(`Timeout: Build status check exceeded ${options.timeout}s`)
        })
        yield* Effect.fail(
          new TimeoutError(`Build status check timed out after ${options.timeout}s`),
        )
      }

      // Output current status to stdout (JSON, like single-check mode)
      yield* Effect.sync(() => {
        process.stdout.write(JSON.stringify(status) + '\n')
      })

      // Terminal states - return immediately
      if (
        status.state === 'success' ||
        status.state === 'failure' ||
        status.state === 'not_found'
      ) {
        yield* Effect.sync(() => {
          console.error(`Build completed with status: ${status.state}`)
        })
        return status
      }

      // Non-terminal states - log progress and wait
      const elapsedSeconds = Math.floor(elapsed / 1000)
      yield* Effect.sync(() => {
        console.error(`[${elapsedSeconds}s elapsed] Build status: ${status.state}`)
      })

      // Sleep for interval duration
      yield* Effect.sleep(options.interval * 1000)
    }
  })

/**
 * Build status command with optional watch mode (mimics gh run watch)
 */
export const buildStatusCommand = (
  changeId: string | undefined,
  options: Partial<WatchOptions> = {},
): Effect.Effect<
  void,
  ApiError | Error | GitError | NoChangeIdError | TimeoutError,
  GerritApiService
> =>
  Effect.gen(function* () {
    // Auto-detect Change-ID from HEAD commit if not provided
    const resolvedChangeId = changeId || (yield* getChangeIdFromHead())

    // Set defaults (matching gh run watch patterns)
    const watchOpts: WatchOptions = {
      watch: options.watch ?? false,
      interval: Math.max(1, options.interval ?? 10), // Min 1 second
      timeout: Math.max(1, options.timeout ?? 1800), // Min 1 second, default 30 minutes
      exitStatus: options.exitStatus ?? false,
    }

    let status: BuildStatus

    if (watchOpts.watch) {
      // Polling mode - outputs JSON on each iteration
      status = yield* pollBuildStatus(resolvedChangeId, watchOpts)
    } else {
      // Single check mode (existing behavior)
      const messages = yield* getMessagesForChange(resolvedChangeId)
      status = parseBuildStatus(messages)

      // Output JSON to stdout
      yield* Effect.sync(() => {
        process.stdout.write(JSON.stringify(status) + '\n')
      })
    }

    // Handle exit codes (only non-zero when explicitly requested)
    if (watchOpts.exitStatus && status.state === 'failure') {
      yield* Effect.sync(() => process.exit(1))
    }

    // Default: exit 0 for all states (success, failure, pending, etc.)
  }).pipe(
    Effect.catchAll((error) => {
      // Timeout error
      if (error instanceof TimeoutError) {
        return Effect.sync(() => {
          console.error(`Error: ${error.message}`)
          process.exit(2)
        })
      }

      // 404 - change not found
      if (error && typeof error === 'object' && 'status' in error && error.status === 404) {
        const status: BuildStatus = { state: 'not_found' }
        return Effect.sync(() => {
          process.stdout.write(JSON.stringify(status) + '\n')
        })
      }

      // Other errors - exit 3
      const errorMessage =
        error instanceof GitError || error instanceof NoChangeIdError || error instanceof Error
          ? error.message
          : String(error)

      return Effect.sync(() => {
        console.error(`Error: ${errorMessage}`)
        process.exit(3)
      })
    }),
  )
