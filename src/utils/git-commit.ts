import { Effect } from 'effect'
import { spawn } from 'node:child_process'

/**
 * Error thrown when git operations fail
 */
export class GitError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'GitError'
  }
}

/**
 * Error thrown when no Change-ID is found in commit message
 */
export class NoChangeIdError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NoChangeIdError'
  }
}

/**
 * Extracts the Change-ID from a git commit message.
 * Gerrit adds Change-ID as a footer line in the format: "Change-Id: I<40-char-hash>"
 *
 * @param message - The full commit message
 * @returns The Change-ID if found, null otherwise
 *
 * @example
 * ```ts
 * const msg = "feat: add feature\n\nChange-Id: If5a3ae8cb5a107e187447802358417f311d0c4b1"
 * extractChangeIdFromCommitMessage(msg) // "If5a3ae8cb5a107e187447802358417f311d0c4b1"
 * ```
 */
export function extractChangeIdFromCommitMessage(message: string): string | null {
  // Match "Change-Id: I<40-hex-chars>" in commit footer
  // Case-insensitive, allows whitespace, multiline mode
  const changeIdRegex = /^Change-Id:\s*(I[0-9a-f]{40})\s*$/im

  const match = message.match(changeIdRegex)
  return match ? match[1] : null
}

/**
 * Runs a git command and returns the output
 */
const runGitCommand = (args: readonly string[]): Effect.Effect<string, GitError> =>
  Effect.async<string, GitError>((resume) => {
    const child = spawn('git', [...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    child.on('error', (error: Error) => {
      resume(Effect.fail(new GitError('Failed to execute git command', error)))
    })

    child.on('close', (code: number | null) => {
      if (code === 0) {
        resume(Effect.succeed(stdout.trim()))
      } else {
        const errorMessage =
          stderr.trim() || `Git command failed with exit code ${code ?? 'unknown'}`
        resume(Effect.fail(new GitError(errorMessage)))
      }
    })
  })

/**
 * Gets the commit message of the HEAD commit
 *
 * @returns Effect that resolves to the commit message
 * @throws GitError if not in a git repository or git command fails
 */
export const getLastCommitMessage = (): Effect.Effect<string, GitError> =>
  runGitCommand(['log', '-1', '--pretty=format:%B'])

/**
 * Extracts the Change-ID from the HEAD commit message
 *
 * @returns Effect that resolves to the Change-ID
 * @throws GitError if not in a git repository or git command fails
 * @throws NoChangeIdError if no Change-ID is found in the commit message
 *
 * @example
 * ```ts
 * const effect = getChangeIdFromHead()
 * const changeId = await Effect.runPromise(effect)
 * console.log(changeId) // "If5a3ae8cb5a107e187447802358417f311d0c4b1"
 * ```
 */
export const getChangeIdFromHead = (): Effect.Effect<string, GitError | NoChangeIdError> =>
  Effect.gen(function* () {
    const message = yield* getLastCommitMessage()

    const changeId = extractChangeIdFromCommitMessage(message)

    if (!changeId) {
      return yield* Effect.fail(
        new NoChangeIdError(
          'No Change-ID found in HEAD commit. Please provide a change number or Change-ID explicitly.',
        ),
      )
    }

    return changeId
  })
