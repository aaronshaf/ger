import { Effect, Schema } from 'effect'
import { type ApiError, GerritApiService } from '@/api/gerrit'
import type { CommentInfo, MessageInfo } from '@/schemas/gerrit'
import { sanitizeCDATA, escapeXML } from '@/utils/shell-safety'
import { getChangeIdFromHead, GitError, NoChangeIdError } from '@/utils/git-commit'

// Schema for validating extract-url options
const ExtractUrlOptionsSchema: Schema.Schema<
  {
    readonly includeComments?: boolean
    readonly regex?: boolean
    readonly xml?: boolean
    readonly json?: boolean
  },
  {
    readonly includeComments?: boolean
    readonly regex?: boolean
    readonly xml?: boolean
    readonly json?: boolean
  }
> = Schema.Struct({
  includeComments: Schema.optional(Schema.Boolean),
  regex: Schema.optional(Schema.Boolean),
  xml: Schema.optional(Schema.Boolean),
  json: Schema.optional(Schema.Boolean),
})

export interface ExtractUrlOptions extends Schema.Schema.Type<typeof ExtractUrlOptionsSchema> {}

// Schema for validating pattern input
const PatternSchema: Schema.Schema<string, string> = Schema.String.pipe(
  Schema.minLength(1, { message: () => 'Pattern cannot be empty' }),
  Schema.maxLength(500, { message: () => 'Pattern is too long (max 500 characters)' }),
)

// URL matching regex - matches http:// and https:// URLs
const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g

// Regex validation error class
export class RegexValidationError extends Error {
  readonly _tag = 'RegexValidationError'
  constructor(message: string) {
    super(message)
    this.name = 'RegexValidationError'
  }
}

// Safely create regex with validation and timeout protection
const createSafeRegex = (pattern: string): Effect.Effect<RegExp, RegexValidationError> =>
  Effect.try({
    try: () => {
      // Validate regex complexity by checking for dangerous patterns
      // These patterns check for nested quantifiers that can cause ReDoS
      const dangerousPatterns = [
        /\([^)]*[+*][^)]*\)[+*]/, // Nested quantifiers like (a+)+ or (a*)*
        /\([^)]*[+*][^)]*\)[+*?]/, // Nested quantifiers with ? like (a+)+?
        /\[[^\]]*\][+*]{2,}/, // Character class with multiple quantifiers like [a-z]++
      ]

      for (const dangerous of dangerousPatterns) {
        if (dangerous.test(pattern)) {
          throw new RegexValidationError(
            'Pattern contains potentially dangerous nested quantifiers that could cause performance issues',
          )
        }
      }

      // Try to create the regex - this will throw if syntax is invalid
      return new RegExp(pattern)
    },
    catch: (error) => {
      if (error instanceof RegexValidationError) {
        return error
      }
      return new RegexValidationError(
        `Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`,
      )
    },
  })

const extractUrlsFromText = (
  text: string,
  pattern: string,
  useRegex: boolean,
): Effect.Effect<readonly string[], RegexValidationError> =>
  Effect.gen(function* () {
    // First, find all URLs in the text
    const urls = text.match(URL_REGEX) || []

    // Filter URLs by pattern
    if (useRegex) {
      const regex = yield* createSafeRegex(pattern)
      return urls.filter((url) => regex.test(url))
    } else {
      // Substring match (case-insensitive)
      const lowerPattern = pattern.toLowerCase()
      return urls.filter((url) => url.toLowerCase().includes(lowerPattern))
    }
  })

const getCommentsAndMessages = (
  changeId: string,
): Effect.Effect<
  { readonly comments: readonly CommentInfo[]; readonly messages: readonly MessageInfo[] },
  ApiError,
  GerritApiService
> =>
  Effect.gen(function* () {
    const gerritApi = yield* GerritApiService

    // Get both inline comments and review messages concurrently
    const [comments, messages] = yield* Effect.all(
      [gerritApi.getComments(changeId), gerritApi.getMessages(changeId)],
      { concurrency: 'unbounded' },
    )

    // Flatten all inline comments from all files using functional patterns
    const allComments = Object.entries(comments).flatMap(([path, fileComments]) =>
      fileComments.map((comment) => ({
        ...comment,
        path: path === '/COMMIT_MSG' ? 'Commit Message' : path,
      })),
    )

    // Sort inline comments by date (ascending - oldest first)
    const sortedComments = [...allComments].sort((a, b) => {
      const dateA = a.updated ? new Date(a.updated).getTime() : 0
      const dateB = b.updated ? new Date(b.updated).getTime() : 0
      return dateA - dateB
    })

    // Sort messages by date (ascending - oldest first)
    const sortedMessages = [...messages].sort((a, b) => {
      const dateA = new Date(a.date).getTime()
      const dateB = new Date(b.date).getTime()
      return dateA - dateB
    })

    return { comments: sortedComments, messages: sortedMessages }
  })

const extractUrlsFromChange = (
  changeId: string,
  pattern: string,
  options: ExtractUrlOptions,
): Effect.Effect<readonly string[], ApiError | RegexValidationError, GerritApiService> =>
  Effect.gen(function* () {
    const { comments, messages } = yield* getCommentsAndMessages(changeId)

    // Extract URLs from messages using functional patterns
    const messageUrls = yield* Effect.all(
      messages.map((message) =>
        extractUrlsFromText(message.message, pattern, options.regex || false),
      ),
      { concurrency: 'unbounded' },
    )

    // Optionally extract URLs from comments
    const commentUrls = options.includeComments
      ? yield* Effect.all(
          comments
            .filter((comment) => comment.message !== undefined)
            .map((comment) =>
              extractUrlsFromText(comment.message!, pattern, options.regex || false),
            ),
          { concurrency: 'unbounded' },
        )
      : []

    // Flatten all URLs
    return [...messageUrls.flat(), ...commentUrls.flat()]
  })

const formatUrlsPretty = (urls: readonly string[]): Effect.Effect<void> =>
  Effect.sync(() => {
    for (const url of urls) {
      console.log(url)
    }
  })

const formatUrlsXml = (urls: readonly string[]): Effect.Effect<void> =>
  Effect.sync(() => {
    console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
    console.log(`<extract_url_result>`)
    console.log(`  <status>success</status>`)
    console.log(`  <urls>`)
    console.log(`    <count>${urls.length}</count>`)
    for (const url of urls) {
      console.log(`    <url>${escapeXML(url)}</url>`)
    }
    console.log(`  </urls>`)
    console.log(`</extract_url_result>`)
  })

const formatUrlsJson = (urls: readonly string[]): Effect.Effect<void> =>
  Effect.sync(() => {
    const output = {
      status: 'success',
      urls,
    }
    console.log(JSON.stringify(output, null, 2))
  })

export const extractUrlCommand = (
  pattern: string,
  changeId: string | undefined,
  options: ExtractUrlOptions,
): Effect.Effect<
  void,
  ApiError | Error | GitError | NoChangeIdError | RegexValidationError,
  GerritApiService
> =>
  Effect.gen(function* () {
    // Validate inputs using Effect Schema
    const validatedPattern = yield* Schema.decodeUnknown(PatternSchema)(pattern)
    const validatedOptions = yield* Schema.decodeUnknown(ExtractUrlOptionsSchema)(options)

    // Auto-detect Change-ID from HEAD commit if not provided
    const resolvedChangeId = changeId || (yield* getChangeIdFromHead())

    // Extract URLs
    const urls = yield* extractUrlsFromChange(resolvedChangeId, validatedPattern, validatedOptions)

    // Format output using Effect-wrapped functions
    if (validatedOptions.json) {
      yield* formatUrlsJson(urls)
    } else if (validatedOptions.xml) {
      yield* formatUrlsXml(urls)
    } else {
      yield* formatUrlsPretty(urls)
    }
  }).pipe(
    // Regional error boundary for the entire command
    Effect.catchAll((error) =>
      Effect.sync(() => {
        const errorMessage =
          error instanceof GitError ||
          error instanceof NoChangeIdError ||
          error instanceof RegexValidationError ||
          error instanceof Error
            ? error.message
            : String(error)

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                status: 'error',
                error: errorMessage,
              },
              null,
              2,
            ),
          )
        } else if (options.xml) {
          console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
          console.log(`<extract_url_result>`)
          console.log(`  <status>error</status>`)
          console.log(`  <error><![CDATA[${sanitizeCDATA(errorMessage)}]]></error>`)
          console.log(`</extract_url_result>`)
        } else {
          console.error(`✗ Error: ${errorMessage}`)
        }
      }),
    ),
  )
