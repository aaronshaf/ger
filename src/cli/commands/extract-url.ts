import { Effect } from 'effect'
import { type ApiError, GerritApiService } from '@/api/gerrit'
import type { CommentInfo, MessageInfo } from '@/schemas/gerrit'
import { sanitizeCDATA, escapeXML } from '@/utils/shell-safety'
import { getChangeIdFromHead, GitError, NoChangeIdError } from '@/utils/git-commit'

interface ExtractUrlOptions {
  includeComments?: boolean
  regex?: boolean
  xml?: boolean
  json?: boolean
}

// URL matching regex - matches http:// and https:// URLs
const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g

const extractUrlsFromText = (text: string, pattern: string, useRegex: boolean): string[] => {
  // First, find all URLs in the text
  const urls = text.match(URL_REGEX) || []

  // Filter URLs by pattern
  if (useRegex) {
    const regex = new RegExp(pattern)
    return urls.filter((url) => regex.test(url))
  } else {
    // Substring match (case-insensitive)
    const lowerPattern = pattern.toLowerCase()
    return urls.filter((url) => url.toLowerCase().includes(lowerPattern))
  }
}

const getCommentsAndMessages = (
  changeId: string,
): Effect.Effect<
  { comments: CommentInfo[]; messages: MessageInfo[] },
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

    // Flatten all inline comments from all files
    const allComments: CommentInfo[] = []
    for (const [path, fileComments] of Object.entries(comments)) {
      for (const comment of fileComments) {
        allComments.push({
          ...comment,
          path: path === '/COMMIT_MSG' ? 'Commit Message' : path,
        })
      }
    }

    // Sort inline comments by date (ascending - oldest first)
    allComments.sort((a, b) => {
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

    return { comments: allComments, messages: sortedMessages }
  })

const extractUrlsFromChange = (
  changeId: string,
  pattern: string,
  options: ExtractUrlOptions,
): Effect.Effect<string[], ApiError, GerritApiService> =>
  Effect.gen(function* () {
    const { comments, messages } = yield* getCommentsAndMessages(changeId)

    const urls: string[] = []

    // Extract URLs from messages
    for (const message of messages) {
      const messageUrls = extractUrlsFromText(message.message, pattern, options.regex || false)
      urls.push(...messageUrls)
    }

    // Optionally extract URLs from comments
    if (options.includeComments) {
      for (const comment of comments) {
        if (comment.message) {
          const commentUrls = extractUrlsFromText(comment.message, pattern, options.regex || false)
          urls.push(...commentUrls)
        }
      }
    }

    return urls
  })

const formatUrlsPretty = (urls: string[]): void => {
  for (const url of urls) {
    console.log(url)
  }
}

const formatUrlsXml = (urls: string[]): void => {
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
}

const formatUrlsJson = (urls: string[]): void => {
  const output = {
    status: 'success',
    urls,
  }
  console.log(JSON.stringify(output, null, 2))
}

export const extractUrlCommand = (
  pattern: string,
  changeId: string | undefined,
  options: ExtractUrlOptions,
): Effect.Effect<void, ApiError | Error | GitError | NoChangeIdError, GerritApiService> =>
  Effect.gen(function* () {
    // Auto-detect Change-ID from HEAD commit if not provided
    const resolvedChangeId = changeId || (yield* getChangeIdFromHead())

    // Extract URLs
    const urls = yield* extractUrlsFromChange(resolvedChangeId, pattern, options)

    // Format output
    if (options.json) {
      formatUrlsJson(urls)
    } else if (options.xml) {
      formatUrlsXml(urls)
    } else {
      formatUrlsPretty(urls)
    }
  }).pipe(
    // Regional error boundary for the entire command
    Effect.catchAll((error) => {
      const errorMessage =
        error instanceof GitError || error instanceof NoChangeIdError || error instanceof Error
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
      return Effect.succeed(undefined)
    }),
  )
