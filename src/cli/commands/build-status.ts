import { Effect, Schema } from 'effect'
import { type ApiError, GerritApiService } from '@/api/gerrit'
import type { MessageInfo } from '@/schemas/gerrit'
import { getChangeIdFromHead, GitError, NoChangeIdError } from '@/utils/git-commit'

// Export types for external use
export type BuildState = 'pending' | 'running' | 'success' | 'failure' | 'not_found'

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
 * Build status command - determines build status from Gerrit messages
 */
export const buildStatusCommand = (
  changeId: string | undefined,
): Effect.Effect<void, ApiError | Error | GitError | NoChangeIdError, GerritApiService> =>
  Effect.gen(function* () {
    // Auto-detect Change-ID from HEAD commit if not provided
    const resolvedChangeId = changeId || (yield* getChangeIdFromHead())

    // Fetch messages
    const messages = yield* getMessagesForChange(resolvedChangeId)

    // Parse build status
    const status = parseBuildStatus(messages)

    // Output JSON to stdout
    const jsonOutput = JSON.stringify(status) + '\n'
    yield* Effect.sync(() => {
      process.stdout.write(jsonOutput)
    })
  }).pipe(
    // Error handling - return not_found for API errors (e.g., change not found)
    Effect.catchAll((error) => {
      if (error && typeof error === 'object' && 'status' in error && error.status === 404) {
        // Change not found - output not_found state and exit successfully
        const status: BuildStatus = { state: 'not_found' }
        return Effect.sync(() => {
          process.stdout.write(JSON.stringify(status) + '\n')
        })
      }

      // For other errors, write to stderr and exit with error
      const errorMessage =
        error instanceof GitError || error instanceof NoChangeIdError || error instanceof Error
          ? error.message
          : String(error)

      return Effect.sync(() => {
        console.error(`Error: ${errorMessage}`)
        process.exit(1)
      })
    }),
  )
