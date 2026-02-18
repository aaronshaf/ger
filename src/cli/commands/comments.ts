import { Effect } from 'effect'
import { type ApiError, GerritApiService } from '@/api/gerrit'
import type { CommentInfo } from '@/schemas/gerrit'
import { formatCommentsPretty, formatCommentsXml } from '@/utils/comment-formatters'
import { getDiffContext } from '@/utils/diff-context'

interface CommentsOptions {
  xml?: boolean
  json?: boolean
}

const getCommentsForChange = (
  changeId: string,
): Effect.Effect<CommentInfo[], ApiError, GerritApiService> =>
  Effect.gen(function* () {
    const gerritApi = yield* GerritApiService

    // Get all comments for the change - let errors propagate for proper handling
    const comments = yield* gerritApi.getComments(changeId)

    // Flatten all comments from all files
    const allComments: CommentInfo[] = []
    for (const [path, fileComments] of Object.entries(comments)) {
      for (const comment of fileComments) {
        allComments.push({
          ...comment,
          path: path === '/COMMIT_MSG' ? 'Commit Message' : path,
        })
      }
    }

    // Sort by path and then by line number
    allComments.sort((a, b) => {
      const pathCompare = (a.path || '').localeCompare(b.path || '')
      if (pathCompare !== 0) return pathCompare
      return (a.line || 0) - (b.line || 0)
    })

    return allComments
  })

export const commentsCommand = (
  changeId: string,
  options: CommentsOptions,
): Effect.Effect<void, ApiError | Error, GerritApiService> =>
  Effect.gen(function* () {
    // Get all comments
    const comments = yield* getCommentsForChange(changeId)

    // Get context for each comment using concurrent requests with unbounded concurrency
    const contextEffects = comments.map((comment) =>
      comment.path && comment.line
        ? getDiffContext(changeId, comment.path, comment.line).pipe(
            Effect.map((context) => ({ comment, context })),
            // Graceful degradation for diff fetch failures
            Effect.catchAll(() => Effect.succeed({ comment, context: undefined })),
          )
        : Effect.succeed({ comment, context: undefined }),
    )

    // Execute all context fetches concurrently with unbounded concurrency
    const commentsWithContext = yield* Effect.all(contextEffects, {
      concurrency: 'unbounded',
    })

    // Format output
    if (options.json) {
      const jsonOutput = {
        status: 'success',
        change_id: changeId,
        comment_count: commentsWithContext.length,
        comments: commentsWithContext.map(({ comment, context }) => ({
          id: comment.id,
          ...(comment.path ? { path: comment.path } : {}),
          ...(comment.line ? { line: comment.line } : {}),
          ...(comment.range ? { range: comment.range } : {}),
          ...(comment.author
            ? {
                author: {
                  ...(comment.author.name ? { name: comment.author.name } : {}),
                  ...(comment.author.email ? { email: comment.author.email } : {}),
                  ...(comment.author._account_id !== undefined
                    ? { account_id: comment.author._account_id }
                    : {}),
                },
              }
            : {}),
          ...(comment.updated ? { updated: comment.updated } : {}),
          ...(comment.unresolved !== undefined ? { unresolved: comment.unresolved } : {}),
          ...(comment.in_reply_to ? { in_reply_to: comment.in_reply_to } : {}),
          message: comment.message,
          ...(context ? { diff_context: context } : {}),
        })),
      }
      console.log(JSON.stringify(jsonOutput, null, 2))
    } else if (options.xml) {
      formatCommentsXml(changeId, commentsWithContext)
    } else {
      formatCommentsPretty(commentsWithContext)
    }
  }).pipe(
    // Regional error boundary for the entire command
    Effect.catchTag('ApiError', (error) => {
      if (options.json) {
        console.log(JSON.stringify({ status: 'error', error: error.message }, null, 2))
      } else if (options.xml) {
        console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
        console.log(`<comments_result>`)
        console.log(`  <status>error</status>`)
        console.log(`  <error><![CDATA[${error.message}]]></error>`)
        console.log(`</comments_result>`)
      } else {
        console.error(`✗ Failed to fetch comments: ${error.message}`)
      }
      return Effect.succeed(undefined)
    }),
  )
