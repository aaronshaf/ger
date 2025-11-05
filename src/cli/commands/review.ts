import { Effect, pipe, Schema } from 'effect'
import { ReviewStrategyService, ReviewStrategyError } from '@/services/review-strategy'
import { commentCommandWithInput } from './comment'
import { Console } from 'effect'
import { GerritApiService } from '@/api/gerrit'
import { buildEnhancedPrompt } from '@/utils/review-prompt-builder'
import * as fs from 'node:fs/promises'
import * as fsSync from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import * as readline from 'node:readline'
import { GitWorktreeService } from '@/services/git-worktree'

// Get the directory of this module
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Effect-based file reading helper
const readFileEffect = (filePath: string): Effect.Effect<string, Error, never> =>
  Effect.tryPromise({
    try: () => fs.readFile(filePath, 'utf8'),
    catch: (error) => new Error(`Failed to read file ${filePath}: ${error}`),
  })

// Load default prompts from .md files using Effect
const loadDefaultPrompts = Effect.gen(function* () {
  const defaultReviewPrompt = yield* readFileEffect(
    path.join(__dirname, '../../prompts/default-review.md'),
  )
  const inlineReviewSystemPrompt = yield* readFileEffect(
    path.join(__dirname, '../../prompts/system-inline-review.md'),
  )
  const overallReviewSystemPrompt = yield* readFileEffect(
    path.join(__dirname, '../../prompts/system-overall-review.md'),
  )

  return {
    defaultReviewPrompt,
    inlineReviewSystemPrompt,
    overallReviewSystemPrompt,
  }
})

// Helper to expand tilde in file paths
const expandTilde = (filePath: string): string => {
  if (filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2))
  }
  return filePath
}

// Helper to read prompt file using Effect
const readPromptFileEffect = (filePath: string): Effect.Effect<string | null, never, never> =>
  Effect.gen(function* () {
    const expanded = expandTilde(filePath)

    // Check if file exists using sync method since Effect doesn't have a convenient async exists check
    const exists = yield* Effect.try(() => fsSync.existsSync(expanded)).pipe(
      Effect.catchAll(() => Effect.succeed(false)),
    )

    if (!exists) {
      return null
    }

    // Read file using async Effect
    const content = yield* readFileEffect(expanded).pipe(
      Effect.catchAll(() => Effect.succeed(null)),
    )

    return content
  })

interface ReviewOptions {
  debug?: boolean
  dryRun?: boolean
  comment?: boolean
  yes?: boolean
  prompt?: string
  tool?: string
  systemPrompt?: string
}

// Schema for validating AI-generated inline comments
const InlineCommentSchema = Schema.Struct({
  file: Schema.String,
  message: Schema.String,
  side: Schema.optional(Schema.String),
  line: Schema.optional(Schema.Number),
  range: Schema.optional(
    Schema.Struct({
      start_line: Schema.Number,
      end_line: Schema.Number,
      start_character: Schema.optional(Schema.Number),
      end_character: Schema.optional(Schema.Number),
    }),
  ),
})

interface InlineComment extends Schema.Schema.Type<typeof InlineCommentSchema> {}

// Helper to validate and fix AI-generated inline comments
const validateAndFixInlineComments = (
  rawComments: unknown[],
  availableFiles: string[],
): Effect.Effect<InlineComment[], never, never> =>
  Effect.gen(function* () {
    const validComments: InlineComment[] = []

    for (const rawComment of rawComments) {
      // Validate comment structure using Effect Schema
      const parseResult = yield* Schema.decodeUnknown(InlineCommentSchema)(rawComment).pipe(
        Effect.catchTag('ParseError', (_parseError) =>
          Effect.gen(function* () {
            yield* Console.warn('Skipping comment with invalid structure')
            return yield* Effect.succeed(null)
          }),
        ),
      )

      if (!parseResult) {
        continue
      }

      const comment = parseResult

      // Skip comments with invalid line formats (like ":range")
      if (!comment.line && !comment.range) {
        yield* Console.warn('Skipping comment with invalid line format')
        continue
      }

      // Try to find the correct file path
      let correctFilePath = comment.file

      // If the file path doesn't exist exactly, try to find a match
      if (!availableFiles.includes(comment.file)) {
        // Look for files that end with the provided path (secure path matching)
        const matchingFiles = availableFiles.filter((file) => {
          const normalizedFile = file.replace(/\\/g, '/')
          const normalizedComment = comment.file.replace(/\\/g, '/')

          // Only match if the comment path is a suffix of the file path with proper boundaries
          return (
            normalizedFile.endsWith(normalizedComment) &&
            (normalizedFile === normalizedComment ||
              normalizedFile.endsWith(`/${normalizedComment}`))
          )
        })

        if (matchingFiles.length === 1) {
          correctFilePath = matchingFiles[0]
          yield* Console.log(`Fixed file path: ${comment.file} -> ${correctFilePath}`)
        } else if (matchingFiles.length > 1) {
          // Multiple matches, try to pick the most likely one (exact suffix match)
          const exactMatch = matchingFiles.find((file) => file.endsWith(`/${comment.file}`))
          if (exactMatch) {
            correctFilePath = exactMatch
            yield* Console.log(
              `Fixed file path (exact match): ${comment.file} -> ${correctFilePath}`,
            )
          } else {
            yield* Console.warn(`Multiple file matches for ${comment.file}. Skipping comment.`)
            continue
          }
        } else {
          yield* Console.warn(`File not found in change: ${comment.file}. Skipping comment.`)
          continue
        }
      }

      // Update the comment with the correct file path and add to valid comments
      validComments.push({ ...comment, file: correctFilePath })
    }

    return validComments
  })

// Helper function to prompt user for confirmation
const promptUser = (message: string): Effect.Effect<boolean, never> =>
  Effect.async<boolean, never>((resume) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    rl.question(`${message} [y/N]: `, (answer: string) => {
      rl.close()
      resume(Effect.succeed(answer.toLowerCase() === 'y'))
    })
  })

export const reviewCommand = (
  changeId: string,
  options: ReviewOptions = {},
): Effect.Effect<
  void,
  Error | ReviewStrategyError,
  GerritApiService | ReviewStrategyService | GitWorktreeService
> =>
  Effect.gen(function* () {
    const reviewStrategy = yield* ReviewStrategyService
    const gitService = yield* GitWorktreeService

    // Load default prompts
    const prompts = yield* loadDefaultPrompts

    // Validate preconditions
    yield* gitService.validatePreconditions()

    // Check for available AI strategies
    yield* Console.log('→ Checking AI tool availability...')
    const availableStrategies = yield* reviewStrategy.getAvailableStrategies()

    if (availableStrategies.length === 0) {
      return yield* Effect.fail(
        new Error('No AI tools available. Please install claude, gemini, or opencode CLI.'),
      )
    }

    // Select strategy based on user preference
    const selectedStrategy = yield* reviewStrategy.selectStrategy(options.tool)
    yield* Console.log(`✓ Using AI tool: ${selectedStrategy.name}`)

    // Load custom review prompt if provided
    let userReviewPrompt = prompts.defaultReviewPrompt

    if (options.prompt) {
      const customPrompt = yield* readPromptFileEffect(options.prompt)
      if (customPrompt) {
        userReviewPrompt = customPrompt
        yield* Console.log(`✓ Using custom review prompt from ${options.prompt}`)
      } else {
        yield* Console.log(`⚠ Could not read custom prompt file: ${options.prompt}`)
        yield* Console.log('→ Using default review prompt')
      }
    }

    // Use Effect's resource management for worktree lifecycle
    yield* Effect.acquireUseRelease(
      // Acquire: Create worktree and setup
      Effect.gen(function* () {
        const worktreeInfo = yield* gitService.createWorktree(changeId)
        yield* gitService.fetchAndCheckoutPatchset(worktreeInfo)
        return worktreeInfo
      }),

      // Use: Run the enhanced review process
      (worktreeInfo) =>
        Effect.gen(function* () {
          // Switch to worktree directory
          const originalCwd = process.cwd()
          process.chdir(worktreeInfo.path)

          try {
            // Get changed files from git
            const changedFiles = yield* gitService.getChangedFiles()

            yield* Console.log(`→ Found ${changedFiles.length} changed files`)
            if (options.debug) {
              yield* Console.log(`[DEBUG] Changed files: ${changedFiles.join(', ')}`)
            }

            // Stage 1: Generate inline comments
            yield* Console.log(`→ Generating inline comments for change ${changeId}...`)

            const inlinePrompt = yield* buildEnhancedPrompt(
              userReviewPrompt,
              prompts.inlineReviewSystemPrompt,
              changeId,
              changedFiles,
            )

            // Run inline review using selected strategy
            if (options.debug) {
              yield* Console.log(`[DEBUG] Running inline review with ${selectedStrategy.name}`)
              yield* Console.log(`[DEBUG] Working directory: ${worktreeInfo.path}`)
            }

            const inlineResponse = yield* reviewStrategy
              .executeWithStrategy(selectedStrategy, inlinePrompt, {
                cwd: worktreeInfo.path,
                systemPrompt: options.systemPrompt || prompts.inlineReviewSystemPrompt,
              })
              .pipe(
                Effect.catchTag('ReviewStrategyError', (error) =>
                  Effect.gen(function* () {
                    yield* Console.error(`✗ Inline review failed: ${error.message}`)
                    return yield* Effect.fail(new Error(error.message))
                  }),
                ),
              )

            if (options.debug) {
              yield* Console.log(`[DEBUG] Inline review completed`)
              yield* Console.log(`[DEBUG] Response length: ${inlineResponse.length} chars`)
            }

            // Response content is ready for parsing
            const extractedInlineResponse = inlineResponse.trim()

            if (options.debug) {
              yield* Console.log(
                `[DEBUG] Extracted response for parsing:\n${extractedInlineResponse}`,
              )
            }

            // Parse JSON array from response
            const inlineCommentsArray = yield* Effect.tryPromise({
              try: () => Promise.resolve(JSON.parse(extractedInlineResponse)),
              catch: (error) => new Error(`Invalid JSON response: ${error}`),
            }).pipe(
              Effect.catchAll((error) =>
                Effect.gen(function* () {
                  yield* Console.error(`✗ Failed to parse inline comments JSON: ${error}`)
                  yield* Console.error(`Raw extracted response: "${extractedInlineResponse}"`)
                  if (!options.debug) {
                    yield* Console.error('Run with --debug to see full AI output')
                  }
                  return yield* Effect.fail(error)
                }),
              ),
            )

            // Validate that the response is an array
            if (!Array.isArray(inlineCommentsArray)) {
              yield* Console.error('✗ AI response is not an array of comments')
              return yield* Effect.fail(new Error('Invalid inline comments format'))
            }

            // Validate and fix inline comments
            const originalCount = inlineCommentsArray.length
            const inlineComments = yield* validateAndFixInlineComments(
              inlineCommentsArray,
              changedFiles,
            )
            const validCount = inlineComments.length

            if (originalCount > validCount) {
              yield* Console.log(
                `→ Filtered ${originalCount - validCount} invalid comments, ${validCount} remain`,
              )
            }

            // Handle inline comments output/posting
            yield* handleInlineComments(inlineComments, changeId, options)

            // Stage 2: Generate overall review comment
            yield* Console.log(`→ Generating overall review comment for change ${changeId}...`)

            const overallPrompt = yield* buildEnhancedPrompt(
              userReviewPrompt,
              prompts.overallReviewSystemPrompt,
              changeId,
              changedFiles,
            )

            // Run overall review using selected strategy
            if (options.debug) {
              yield* Console.log(`[DEBUG] Running overall review with ${selectedStrategy.name}`)
            }

            const overallResponse = yield* reviewStrategy
              .executeWithStrategy(selectedStrategy, overallPrompt, {
                cwd: worktreeInfo.path,
                systemPrompt: options.systemPrompt || prompts.overallReviewSystemPrompt,
              })
              .pipe(
                Effect.catchTag('ReviewStrategyError', (error) =>
                  Effect.gen(function* () {
                    yield* Console.error(`✗ Overall review failed: ${error.message}`)
                    return yield* Effect.fail(new Error(error.message))
                  }),
                ),
              )

            if (options.debug) {
              yield* Console.log(`[DEBUG] Overall review completed`)
              yield* Console.log(`[DEBUG] Response length: ${overallResponse.length} chars`)
            }

            // Response content is ready for use
            const extractedOverallResponse = overallResponse.trim()

            // Handle overall review output/posting
            yield* handleOverallReview(extractedOverallResponse, changeId, options)
          } finally {
            // Always restore original working directory
            process.chdir(originalCwd)
          }

          yield* Console.log(`✓ Review complete for ${changeId}`)
        }),

      // Release: Always cleanup worktree
      (worktreeInfo) => gitService.cleanup(worktreeInfo),
    )
  })

// Helper function to handle inline comments output/posting
const handleInlineComments = (
  inlineComments: InlineComment[],
  changeId: string,
  options: ReviewOptions,
): Effect.Effect<void, Error, GerritApiService> =>
  Effect.gen(function* () {
    if (!options.comment) {
      // Display mode
      if (inlineComments.length > 0) {
        yield* Console.log('\n━━━━━━ INLINE COMMENTS ━━━━━━')
        for (const comment of inlineComments) {
          yield* Console.log(`\n📍 ${comment.file}${comment.line ? `:${comment.line}` : ''}`)
          yield* Console.log(comment.message)
        }
      } else {
        yield* Console.log('\n→ No inline comments')
      }
    } else {
      // Comment posting mode
      if (inlineComments.length > 0) {
        yield* Console.log('\n━━━━━━ INLINE COMMENTS TO POST ━━━━━━')
        for (const comment of inlineComments) {
          yield* Console.log(`\n📍 ${comment.file}${comment.line ? `:${comment.line}` : ''}`)
          yield* Console.log(comment.message)
        }
        yield* Console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

        const shouldPost =
          options.yes || (yield* promptUser('\nPost these inline comments to Gerrit?'))

        if (shouldPost) {
          yield* pipe(
            commentCommandWithInput(changeId, JSON.stringify(inlineComments), { batch: true }),
            Effect.catchAll((error) =>
              Effect.gen(function* () {
                yield* Console.error(`✗ Failed to post inline comments: ${error}`)
                return yield* Effect.fail(error)
              }),
            ),
          )
          yield* Console.log(`✓ Inline comments posted for ${changeId}`)
        } else {
          yield* Console.log('→ Inline comments not posted')
        }
      }
    }
  })

// Helper function to handle overall review output/posting
const handleOverallReview = (
  overallResponse: string,
  changeId: string,
  options: ReviewOptions,
): Effect.Effect<void, Error, GerritApiService> =>
  Effect.gen(function* () {
    if (!options.comment) {
      // Display mode
      yield* Console.log('\n━━━━━━ OVERALL REVIEW ━━━━━━')
      yield* Console.log(overallResponse)
      yield* Console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    } else {
      // Comment posting mode
      yield* Console.log('\n━━━━━━ OVERALL REVIEW TO POST ━━━━━━')
      yield* Console.log(overallResponse)
      yield* Console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

      const shouldPost = options.yes || (yield* promptUser('\nPost this overall review to Gerrit?'))

      if (shouldPost) {
        yield* pipe(
          commentCommandWithInput(changeId, overallResponse, {}),
          Effect.catchAll((error) =>
            Effect.gen(function* () {
              yield* Console.error(`✗ Failed to post review comment: ${error}`)
              return yield* Effect.fail(error)
            }),
          ),
        )
        yield* Console.log(`✓ Overall review posted for ${changeId}`)
      } else {
        yield* Console.log('→ Overall review not posted')
      }
    }
  })
