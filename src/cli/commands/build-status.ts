import { Effect, Schema } from 'effect'
import { type ApiError, GerritApiService } from '@/api/gerrit'
import type { MessageInfo } from '@/schemas/gerrit'
import { getChangeIdFromHead, GitError, NoChangeIdError } from '@/utils/git-commit'

/** Help text for build-status command - exported to keep index.ts under line limit */
export const BUILD_STATUS_HELP_TEXT = `
This command parses Gerrit change messages to determine build status.
It looks for "Build Started" messages and subsequent verification labels.

Output is JSON with a "state" field that can be:
  - pending: No build has started yet
  - running: Build started but no verification yet
  - success: Build completed with Verified+1
  - failure: Build completed with Verified-1
  - not_found: Change does not exist

Exit codes:
  - 0: Default for all states (like gh run watch)
  - 1: Only when --exit-status is used AND build fails
  - 2: Timeout reached in watch mode
  - 3: API/network errors

Examples:
  # Single check (current behavior)
  $ ger build-status 392385
  {"state":"success"}

  # Watch until completion (outputs JSON on each poll)
  $ ger build-status 392385 --watch
  {"state":"pending"}
  {"state":"running"}
  {"state":"running"}
  {"state":"success"}

  # Watch with custom interval (check every 5 seconds)
  $ ger build-status --watch --interval 5

  # Watch with custom timeout (60 minutes)
  $ ger build-status --watch --timeout 3600

  # Exit with code 1 on failure (for CI/CD pipelines)
  $ ger build-status --watch --exit-status && deploy.sh

  # Trigger notification when done (like gh run watch pattern)
  $ ger build-status --watch && notify-send 'Build is done!'

  # Parse final state in scripts
  $ ger build-status --watch | tail -1 | jq -r '.state'
  success

Note: When no change-id is provided, it will be automatically extracted from the
      Change-ID footer in your HEAD commit.`

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
 * Parse messages to determine build status based on "Build Started" and verification messages.
 * Only considers verification messages for the same patchset as the latest build.
 */
const parseBuildStatus = (messages: readonly MessageInfo[]): BuildStatus => {
  // Empty messages means change exists but has no activity yet - return pending
  if (messages.length === 0) {
    return { state: 'pending' }
  }

  // Find the most recent "Build Started" message and its revision number
  let lastBuildDate: string | null = null
  let lastBuildRevision: number | undefined = undefined
  for (const msg of messages) {
    if (BUILD_STARTED_PATTERN.test(msg.message)) {
      lastBuildDate = msg.date
      lastBuildRevision = msg._revision_number
    }
  }

  // If no build has started, state is "pending"
  if (!lastBuildDate) {
    return { state: 'pending' }
  }

  // Check for verification messages after the build started AND for the same revision
  for (const msg of messages) {
    const date = msg.date
    // Gerrit timestamps are ISO 8601 strings (lexicographically sortable)
    if (date <= lastBuildDate) continue

    // Only consider verification messages for the same patchset
    // If revision numbers are available, they must match
    if (lastBuildRevision !== undefined && msg._revision_number !== undefined) {
      if (msg._revision_number !== lastBuildRevision) continue
    }

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

      // Terminal states - wait for interval before returning to allow logs to be written
      if (status.state === 'success' || status.state === 'not_found') {
        return status
      }

      if (status.state === 'failure') {
        // Wait for interval seconds to allow build failure logs to be fully written
        yield* Effect.sleep(options.interval * 1000)
        return status
      }

      // Non-terminal states - sleep for interval duration
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
