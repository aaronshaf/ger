import { Effect } from 'effect'
import { type ApiError, GerritApiService } from '@/api/gerrit'
import type { CommentInfo, MessageInfo } from '@/schemas/gerrit'
import { formatCommentsPretty } from '@/utils/comment-formatters'
import { getDiffContext } from '@/utils/diff-context'
import { formatDiffPretty } from '@/utils/diff-formatters'
import { sanitizeCDATA, escapeXML } from '@/utils/shell-safety'
import { formatDate } from '@/utils/formatters'
import { getChangeIdFromHead, GitError, NoChangeIdError } from '@/utils/git-commit'

export const SHOW_HELP_TEXT = `
Examples:
  # Show specific change (using change number)
  $ ger show 392385

  # Show specific change (using Change-ID)
  $ ger show If5a3ae8cb5a107e187447802358417f311d0c4b1

  # Auto-detect Change-ID from HEAD commit
  $ ger show
  $ ger show --xml
  $ ger show --json

  # Extract build failure URL with jq
  $ ger show 392090 --json | jq -r '.messages[] | select(.message | contains("Build Failed")) | .message' | grep -oP 'https://[^\\s]+'

Note: When no change-id is provided, it will be automatically extracted from the
      Change-ID footer in your HEAD commit. You must be in a git repository with
      a commit that has a Change-ID.`

interface ShowOptions {
  xml?: boolean
  json?: boolean
}

interface ReviewerIdentity {
  accountId?: number
  name?: string
  email?: string
  username?: string
}

interface ChangeDetails {
  id: string
  number: number
  subject: string
  status: string
  project: string
  branch: string
  owner: {
    name?: string
    email?: string
  }
  created?: string
  updated?: string
  commitMessage: string
  topic?: string
  reviewers: ReviewerIdentity[]
  ccs: ReviewerIdentity[]
}

const formatReviewerLabel = (reviewer: ReviewerIdentity): string => {
  const preferredIdentity = reviewer.name || reviewer.email || reviewer.username
  if (!preferredIdentity) {
    if (reviewer.accountId !== undefined) {
      return `Account ${reviewer.accountId}`
    }
    return 'Unknown Reviewer'
  }

  if (reviewer.email && reviewer.name && reviewer.name !== reviewer.email) {
    return `${reviewer.name} <${reviewer.email}>`
  }

  return preferredIdentity
}

const getChangeDetails = (
  changeId: string,
): Effect.Effect<ChangeDetails, ApiError, GerritApiService> =>
  Effect.gen(function* () {
    const gerritApi = yield* GerritApiService
    const change = yield* gerritApi.getChange(changeId)

    let reviewerMap = change.reviewers
    const hasReviewerData =
      (reviewerMap?.REVIEWER?.length ?? 0) > 0 || (reviewerMap?.CC?.length ?? 0) > 0

    if (!hasReviewerData) {
      const detailedChanges = yield* gerritApi
        .listChanges(`change:${change.change_id}`)
        .pipe(Effect.catchAll(() => Effect.succeed([])))
      const detailedChange =
        detailedChanges.find((candidate) => candidate.change_id === change.change_id) ||
        detailedChanges[0]
      reviewerMap = detailedChange?.reviewers
    }

    return {
      id: change.change_id,
      number: change._number,
      subject: change.subject,
      status: change.status,
      project: change.project,
      branch: change.branch,
      owner: {
        name: change.owner?.name,
        email: change.owner?.email,
      },
      created: change.created,
      updated: change.updated,
      commitMessage: change.subject, // For now, using subject as commit message
      topic: change.topic,
      reviewers: (reviewerMap?.REVIEWER ?? []).map((reviewer) => ({
        accountId: reviewer._account_id,
        name: reviewer.name,
        email: reviewer.email,
        username: reviewer.username,
      })),
      ccs: (reviewerMap?.CC ?? []).map((cc) => ({
        accountId: cc._account_id,
        name: cc.name,
        email: cc.email,
        username: cc.username,
      })),
    }
  })

const getDiffForChange = (changeId: string): Effect.Effect<string, ApiError, GerritApiService> =>
  Effect.gen(function* () {
    const gerritApi = yield* GerritApiService
    const diff = yield* gerritApi.getDiff(changeId, { format: 'unified' })
    return typeof diff === 'string' ? diff : JSON.stringify(diff, null, 2)
  })

const getCommentsAndMessagesForChange = (
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

const formatShowPretty = (
  changeDetails: ChangeDetails,
  diff: string,
  commentsWithContext: Array<{ comment: CommentInfo; context?: any }>,
  messages: MessageInfo[],
): void => {
  // Change details header
  console.log('━'.repeat(80))
  console.log(`📋 Change ${changeDetails.number}: ${changeDetails.subject}`)
  console.log('━'.repeat(80))
  console.log()

  // Metadata
  console.log('📝 Details:')
  console.log(`   Project: ${changeDetails.project}`)
  console.log(`   Branch: ${changeDetails.branch}`)
  console.log(`   Status: ${changeDetails.status}`)
  if (changeDetails.topic) {
    console.log(`   Topic: ${changeDetails.topic}`)
  }
  console.log(`   Owner: ${changeDetails.owner.name || changeDetails.owner.email || 'Unknown'}`)
  console.log(
    `   Created: ${changeDetails.created ? formatDate(changeDetails.created) : 'Unknown'}`,
  )
  console.log(
    `   Updated: ${changeDetails.updated ? formatDate(changeDetails.updated) : 'Unknown'}`,
  )
  if (changeDetails.reviewers.length > 0) {
    console.log(
      `   Reviewers: ${changeDetails.reviewers.map((reviewer) => formatReviewerLabel(reviewer)).join(', ')}`,
    )
  }
  if (changeDetails.ccs.length > 0) {
    console.log(`   CCs: ${changeDetails.ccs.map((cc) => formatReviewerLabel(cc)).join(', ')}`)
  }
  console.log(`   Change-Id: ${changeDetails.id}`)
  console.log()

  // Diff section
  console.log('🔍 Diff:')
  console.log('─'.repeat(40))
  console.log(formatDiffPretty(diff))
  console.log()

  // Comments and Messages section
  const hasComments = commentsWithContext.length > 0
  const hasMessages = messages.length > 0

  if (hasComments) {
    console.log('💬 Inline Comments:')
    console.log('─'.repeat(40))
    formatCommentsPretty(commentsWithContext)
    console.log()
  }

  if (hasMessages) {
    console.log('📝 Review Activity:')
    console.log('─'.repeat(40))
    for (const message of messages) {
      const author = message.author?.name || 'Unknown'
      const date = formatDate(message.date)
      const cleanMessage = message.message.trim()

      // Skip very short automated messages
      if (
        cleanMessage.length < 10 &&
        (cleanMessage.includes('Build') || cleanMessage.includes('Patch'))
      ) {
        continue
      }

      console.log(`📅 ${date} - ${author}`)
      console.log(`   ${cleanMessage}`)
      console.log()
    }
  }

  if (!hasComments && !hasMessages) {
    console.log('💬 Comments & Activity:')
    console.log('─'.repeat(40))
    console.log('No comments or review activity found.')
  }
}

// Helper to remove undefined values from objects
const removeUndefined = <T extends Record<string, any>>(obj: T): Partial<T> => {
  return Object.fromEntries(
    Object.entries(obj).filter(([_, value]) => value !== undefined),
  ) as Partial<T>
}

const formatShowJson = async (
  changeDetails: ChangeDetails,
  diff: string,
  commentsWithContext: Array<{ comment: CommentInfo; context?: any }>,
  messages: MessageInfo[],
): Promise<void> => {
  const output = {
    status: 'success',
    change: removeUndefined({
      id: changeDetails.id,
      number: changeDetails.number,
      subject: changeDetails.subject,
      status: changeDetails.status,
      project: changeDetails.project,
      branch: changeDetails.branch,
      topic: changeDetails.topic,
      owner: removeUndefined(changeDetails.owner),
      reviewers: changeDetails.reviewers.map((reviewer) =>
        removeUndefined({
          account_id: reviewer.accountId,
          name: reviewer.name,
          email: reviewer.email,
          username: reviewer.username,
        }),
      ),
      ccs: changeDetails.ccs.map((cc) =>
        removeUndefined({
          account_id: cc.accountId,
          name: cc.name,
          email: cc.email,
          username: cc.username,
        }),
      ),
      created: changeDetails.created,
      updated: changeDetails.updated,
    }),
    diff,
    comments: commentsWithContext.map(({ comment, context }) =>
      removeUndefined({
        id: comment.id,
        path: comment.path,
        line: comment.line,
        range: comment.range,
        author: comment.author
          ? removeUndefined({
              name: comment.author.name,
              email: comment.author.email,
              account_id: comment.author._account_id,
            })
          : undefined,
        updated: comment.updated,
        message: comment.message,
        unresolved: comment.unresolved,
        in_reply_to: comment.in_reply_to,
        context,
      }),
    ),
    messages: messages.map((message) =>
      removeUndefined({
        id: message.id,
        author: message.author
          ? removeUndefined({
              name: message.author.name,
              email: message.author.email,
              account_id: message.author._account_id,
            })
          : undefined,
        date: message.date,
        message: message.message,
        revision: message._revision_number,
        tag: message.tag,
      }),
    ),
  }

  const jsonOutput = JSON.stringify(output, null, 2) + '\n'
  // Write to stdout and ensure all data is flushed before process exits
  // Using process.stdout.write with drain handling for large payloads
  return new Promise<void>((resolve, reject) => {
    const written = process.stdout.write(jsonOutput, (err) => {
      if (err) {
        reject(err)
      } else {
        resolve()
      }
    })

    if (!written) {
      // If write returned false, buffer is full, wait for drain
      process.stdout.once('drain', resolve)
      process.stdout.once('error', reject)
    }
  })
}

const formatShowXml = async (
  changeDetails: ChangeDetails,
  diff: string,
  commentsWithContext: Array<{ comment: CommentInfo; context?: any }>,
  messages: MessageInfo[],
): Promise<void> => {
  // Build complete XML output as a single string to avoid multiple writes
  const xmlParts: string[] = []
  xmlParts.push(`<?xml version="1.0" encoding="UTF-8"?>`)
  xmlParts.push(`<show_result>`)
  xmlParts.push(`  <status>success</status>`)
  xmlParts.push(`  <change>`)
  xmlParts.push(`    <id>${escapeXML(changeDetails.id)}</id>`)
  xmlParts.push(`    <number>${changeDetails.number}</number>`)
  xmlParts.push(`    <subject><![CDATA[${sanitizeCDATA(changeDetails.subject)}]]></subject>`)
  xmlParts.push(`    <status>${escapeXML(changeDetails.status)}</status>`)
  xmlParts.push(`    <project>${escapeXML(changeDetails.project)}</project>`)
  xmlParts.push(`    <branch>${escapeXML(changeDetails.branch)}</branch>`)
  if (changeDetails.topic) {
    xmlParts.push(`    <topic><![CDATA[${sanitizeCDATA(changeDetails.topic)}]]></topic>`)
  }
  xmlParts.push(`    <owner>`)
  if (changeDetails.owner.name) {
    xmlParts.push(`      <name><![CDATA[${sanitizeCDATA(changeDetails.owner.name)}]]></name>`)
  }
  if (changeDetails.owner.email) {
    xmlParts.push(`      <email>${escapeXML(changeDetails.owner.email)}</email>`)
  }
  xmlParts.push(`    </owner>`)
  xmlParts.push(`    <reviewers>`)
  xmlParts.push(`      <count>${changeDetails.reviewers.length}</count>`)
  for (const reviewer of changeDetails.reviewers) {
    xmlParts.push(`      <reviewer>`)
    if (reviewer.accountId !== undefined) {
      xmlParts.push(`        <account_id>${reviewer.accountId}</account_id>`)
    }
    if (reviewer.name) {
      xmlParts.push(`        <name><![CDATA[${sanitizeCDATA(reviewer.name)}]]></name>`)
    }
    if (reviewer.email) {
      xmlParts.push(`        <email>${escapeXML(reviewer.email)}</email>`)
    }
    if (reviewer.username) {
      xmlParts.push(`        <username>${escapeXML(reviewer.username)}</username>`)
    }
    xmlParts.push(`      </reviewer>`)
  }
  xmlParts.push(`    </reviewers>`)
  xmlParts.push(`    <ccs>`)
  xmlParts.push(`      <count>${changeDetails.ccs.length}</count>`)
  for (const cc of changeDetails.ccs) {
    xmlParts.push(`      <cc>`)
    if (cc.accountId !== undefined) {
      xmlParts.push(`        <account_id>${cc.accountId}</account_id>`)
    }
    if (cc.name) {
      xmlParts.push(`        <name><![CDATA[${sanitizeCDATA(cc.name)}]]></name>`)
    }
    if (cc.email) {
      xmlParts.push(`        <email>${escapeXML(cc.email)}</email>`)
    }
    if (cc.username) {
      xmlParts.push(`        <username>${escapeXML(cc.username)}</username>`)
    }
    xmlParts.push(`      </cc>`)
  }
  xmlParts.push(`    </ccs>`)
  xmlParts.push(`    <created>${escapeXML(changeDetails.created || '')}</created>`)
  xmlParts.push(`    <updated>${escapeXML(changeDetails.updated || '')}</updated>`)
  xmlParts.push(`  </change>`)
  xmlParts.push(`  <diff><![CDATA[${sanitizeCDATA(diff)}]]></diff>`)

  // Comments section
  xmlParts.push(`  <comments>`)
  xmlParts.push(`    <count>${commentsWithContext.length}</count>`)
  for (const { comment } of commentsWithContext) {
    xmlParts.push(`    <comment>`)
    if (comment.id) xmlParts.push(`      <id>${escapeXML(comment.id)}</id>`)
    if (comment.path) xmlParts.push(`      <path><![CDATA[${sanitizeCDATA(comment.path)}]]></path>`)
    if (comment.line) xmlParts.push(`      <line>${comment.line}</line>`)
    if (comment.author?.name) {
      xmlParts.push(`      <author><![CDATA[${sanitizeCDATA(comment.author.name)}]]></author>`)
    }
    if (comment.updated) xmlParts.push(`      <updated>${escapeXML(comment.updated)}</updated>`)
    if (comment.message) {
      xmlParts.push(`      <message><![CDATA[${sanitizeCDATA(comment.message)}]]></message>`)
    }
    if (comment.unresolved) xmlParts.push(`      <unresolved>true</unresolved>`)
    xmlParts.push(`    </comment>`)
  }
  xmlParts.push(`  </comments>`)

  // Messages section
  xmlParts.push(`  <messages>`)
  xmlParts.push(`    <count>${messages.length}</count>`)
  for (const message of messages) {
    xmlParts.push(`    <message>`)
    xmlParts.push(`      <id>${escapeXML(message.id)}</id>`)
    if (message.author?.name) {
      xmlParts.push(`      <author><![CDATA[${sanitizeCDATA(message.author.name)}]]></author>`)
    }
    if (message.author?._account_id) {
      xmlParts.push(`      <author_id>${message.author._account_id}</author_id>`)
    }
    xmlParts.push(`      <date>${escapeXML(message.date)}</date>`)
    if (message._revision_number) {
      xmlParts.push(`      <revision>${message._revision_number}</revision>`)
    }
    if (message.tag) {
      xmlParts.push(`      <tag>${escapeXML(message.tag)}</tag>`)
    }
    xmlParts.push(`      <message><![CDATA[${sanitizeCDATA(message.message)}]]></message>`)
    xmlParts.push(`    </message>`)
  }
  xmlParts.push(`  </messages>`)
  xmlParts.push(`</show_result>`)

  const xmlOutput = xmlParts.join('\n') + '\n'
  // Write to stdout with proper drain handling for large payloads
  return new Promise<void>((resolve, reject) => {
    const written = process.stdout.write(xmlOutput, (err) => {
      if (err) {
        reject(err)
      } else {
        resolve()
      }
    })

    if (!written) {
      process.stdout.once('drain', resolve)
      process.stdout.once('error', reject)
    }
  })
}

export const showCommand = (
  changeId: string | undefined,
  options: ShowOptions,
): Effect.Effect<void, ApiError | Error | GitError | NoChangeIdError, GerritApiService> =>
  Effect.gen(function* () {
    // Auto-detect Change-ID from HEAD commit if not provided
    const resolvedChangeId = changeId || (yield* getChangeIdFromHead())

    // Fetch all data concurrently
    const [changeDetails, diff, commentsAndMessages] = yield* Effect.all(
      [
        getChangeDetails(resolvedChangeId),
        getDiffForChange(resolvedChangeId),
        getCommentsAndMessagesForChange(resolvedChangeId),
      ],
      { concurrency: 'unbounded' },
    )

    const { comments, messages } = commentsAndMessages

    // Get context for each comment using concurrent requests
    const contextEffects = comments.map((comment) =>
      comment.path && comment.line
        ? getDiffContext(resolvedChangeId, comment.path, comment.line).pipe(
            Effect.map((context) => ({ comment, context })),
            // Graceful degradation for diff fetch failures
            Effect.catchAll(() => Effect.succeed({ comment, context: undefined })),
          )
        : Effect.succeed({ comment, context: undefined }),
    )

    // Execute all context fetches concurrently
    const commentsWithContext = yield* Effect.all(contextEffects, {
      concurrency: 'unbounded',
    })

    // Format output
    if (options.json) {
      yield* Effect.promise(() =>
        formatShowJson(changeDetails, diff, commentsWithContext, messages),
      )
    } else if (options.xml) {
      yield* Effect.promise(() => formatShowXml(changeDetails, diff, commentsWithContext, messages))
    } else {
      formatShowPretty(changeDetails, diff, commentsWithContext, messages)
    }
  }).pipe(
    // Regional error boundary for the entire command
    Effect.catchAll((error) => {
      const errorMessage =
        error instanceof GitError || error instanceof NoChangeIdError || error instanceof Error
          ? error.message
          : String(error)

      if (options.json) {
        return Effect.promise(
          () =>
            new Promise<void>((resolve, reject) => {
              const errorOutput =
                JSON.stringify(
                  {
                    status: 'error',
                    error: errorMessage,
                  },
                  null,
                  2,
                ) + '\n'
              const written = process.stdout.write(errorOutput, (err) => {
                if (err) {
                  reject(err)
                } else {
                  resolve()
                }
              })

              if (!written) {
                // Wait for drain if buffer is full
                process.stdout.once('drain', resolve)
                process.stdout.once('error', reject)
              }
            }),
        )
      } else if (options.xml) {
        return Effect.promise(
          () =>
            new Promise<void>((resolve, reject) => {
              const xmlError =
                `<?xml version="1.0" encoding="UTF-8"?>\n` +
                `<show_result>\n` +
                `  <status>error</status>\n` +
                `  <error><![CDATA[${sanitizeCDATA(errorMessage)}]]></error>\n` +
                `</show_result>\n`
              const written = process.stdout.write(xmlError, (err) => {
                if (err) {
                  reject(err)
                } else {
                  resolve()
                }
              })

              if (!written) {
                process.stdout.once('drain', resolve)
                process.stdout.once('error', reject)
              }
            }),
        )
      } else {
        console.error(`✗ Error: ${errorMessage}`)
      }
      return Effect.succeed(undefined)
    }),
  )
